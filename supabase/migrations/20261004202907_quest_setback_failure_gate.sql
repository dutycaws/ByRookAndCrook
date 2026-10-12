begin;

-- Failed authored attempts remain recoverable until their pinned authoring
-- policy is exhausted, and every attempt is still recorded as one event per
-- closing day. Replaying a close therefore cannot manufacture a setback.
alter table private.world_quest_events
  drop constraint if exists world_quest_events_outcome_check;
alter table private.world_quest_events
  add constraint world_quest_events_outcome_check
    check (outcome in ('prepared','waited','succeeded','setback','failed','abandoned'));

create or replace function private.world_quest_failure_gate(
  p_quest_id uuid,
  p_include_current_failure boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  quest_row private.world_quests;
  version_sheet jsonb;
  milestone jsonb;
  failure_condition jsonb;
  permanent_loss jsonb;
  warning_item jsonb;
  warning_text text;
  max_attempts integer;
  attempt_count integer;
  condition_exhausted boolean := false;
  terminal_failure_allowed boolean := false;
begin
  select * into quest_row from private.world_quests where id=p_quest_id;
  if not found then
    return jsonb_build_object(
      'attemptCount',0,
      'conditionExhausted',false,
      'terminalFailureAllowed',false,
      'mandatoryDisposition',null
    );
  end if;

  if quest_row.origin='authored_milestone' then
    select version.sheet into version_sheet
    from private.npc_versions version where version.id=quest_row.version_id;
    milestone:=version_sheet#>array['campaign','milestones',quest_row.authored_milestone_index::text];
  end if;

  failure_condition:=milestone->'failureCondition';
  permanent_loss:=milestone->'permanentLoss';
  if jsonb_typeof(failure_condition)='object'
    and failure_condition->>'type'='attempt_allowance_exhausted'
    and jsonb_typeof(failure_condition->'maxAttempts')='number' then
    if (failure_condition->>'maxAttempts')::numeric=trunc((failure_condition->>'maxAttempts')::numeric)
      and (failure_condition->>'maxAttempts')::numeric between 3 and 10 then
      max_attempts:=(failure_condition->>'maxAttempts')::integer;
    end if;
  end if;

  select count(*)::integer into attempt_count
  from private.world_quest_events event_row
  where event_row.quest_id=quest_row.id
    and event_row.action='attempt'
    and event_row.outcome in ('setback','failed');
  if p_include_current_failure then attempt_count:=attempt_count+1; end if;

  condition_exhausted:=max_attempts is not null and attempt_count>=max_attempts;
  terminal_failure_allowed:=condition_exhausted and attempt_count>=3;

  if jsonb_typeof(milestone->'warnings')='array' then
    for warning_item in select value from jsonb_array_elements(milestone->'warnings') loop
      if jsonb_typeof(warning_item)='object'
        and jsonb_typeof(warning_item->'afterSetbacks')='number' then
        if (warning_item->>'afterSetbacks')::numeric=trunc((warning_item->>'afterSetbacks')::numeric)
          and (warning_item->>'afterSetbacks')::numeric between 1 and 10
          and (warning_item->>'afterSetbacks')::integer=attempt_count
          and jsonb_typeof(warning_item->'text')='string'
          and char_length(btrim(warning_item->>'text')) between 1 and 500 then
          warning_text:=btrim(warning_item->>'text');
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'attemptCount',attempt_count,
    'failureCondition',case when max_attempts is not null then failure_condition else null end,
    'conditionExhausted',condition_exhausted,
    'terminalFailureAllowed',terminal_failure_allowed,
    'warning',warning_text,
    'permanentLoss',permanent_loss,
    'nonSuccessNews',milestone->'nonSuccessNews',
    'mandatoryDisposition',case
      when terminal_failure_allowed and permanent_loss->>'kind'='departed' then 'departure'
      else null
    end
  );
end
$function$;

create or replace function private.world_resolve_quest_step(p_quest_id uuid,p_closing_day integer,p_draw_override integer default null)
returns private.world_quest_events
language plpgsql
security definer
set search_path=''
as $function$
declare
  q private.world_quests;
  prior private.world_quest_events;
  step jsonb;
  action_name text;
  approach_name text;
  v_skill integer;
  v_hospitality integer;
  v_readiness integer;
  v_chance integer;
  v_draw integer;
  v_outcome text;
  v_narration text:='';
  v_public_news boolean:=false;
  event_row private.world_quest_events;
  v_context jsonb;
  v_failure_gate jsonb;
  v_attempt_count integer;
begin
  select * into q from private.world_quests where id=p_quest_id for update;
  if not found then raise sqlstate 'PT409' using message='Quest is not resolvable'; end if;
  select * into prior from private.world_quest_events where quest_id=p_quest_id and day_number=p_closing_day;
  if found then return prior; end if;
  if q.state<>'active' or p_closing_day<q.activated_day then raise sqlstate 'PT409' using message='Quest is not resolvable'; end if;

  step:=q.current_plan->q.current_step;
  action_name:=step->>'action';
  approach_name:=step->>'approach';
  select coalesce((version.sheet->'skills'->>approach_name)::integer,0)
  into v_skill from private.npc_versions version where version.id=q.version_id;
  v_hospitality:=private.world_quest_hospitality(q.id,p_closing_day);
  v_readiness:=private.world_quest_readiness(q.preparation,v_hospitality);

  if action_name='attempt' then
    v_chance:=private.world_quest_chance(v_skill,q.difficulty,v_readiness);
    v_draw:=coalesce(p_draw_override,floor(random()*100)::integer);
    if v_draw not between 0 and 99 then raise sqlstate 'PT400' using message='Draw override is invalid'; end if;
    if v_draw<v_chance then
      v_outcome:='succeeded';
    elsif q.origin='authored_milestone' then
      v_failure_gate:=private.world_quest_failure_gate(q.id,true);
      v_attempt_count:=(v_failure_gate->>'attemptCount')::integer;
      v_outcome:=case when coalesce((v_failure_gate->>'terminalFailureAllowed')::boolean,false)
        then 'failed' else 'setback' end;
    else
      -- Generated successor failures retain their existing transition path.
      -- The transition commit below prevents such a failure from causing an
      -- irreversible departure without an exhausted authored loss policy.
      v_outcome:='failed';
    end if;
  elsif action_name='abandon' then
    v_outcome:='abandoned';
  else
    v_outcome:=case when action_name='prepare' then 'prepared' else 'waited' end;
  end if;

  if action_name in ('attempt','abandon') then
    v_public_news:=true;
    if v_outcome='setback' then
      v_narration:=coalesce(
        v_failure_gate->>'warning',
        case
          when v_attempt_count=1 then 'The attempt fell short. The quest remains open and can be tried again.'
          when v_attempt_count=2 then 'A second setback makes the quest more serious. Another missed attempt may have a lasting cost.'
          else 'The quest remains open, but repeated setbacks are making success harder to reach.'
        end
      );
    elsif q.origin='authored_milestone' then
      select coalesce(
        case when v_outcome='failed'
          then nullif(btrim(version.sheet#>>array['campaign','milestones',q.authored_milestone_index::text,'permanentLoss','outcome']),'')
          else null
        end,
        nullif(btrim(version.sheet#>>array['campaign','milestones',q.authored_milestone_index::text,case when v_outcome='succeeded' then 'successNews' else 'nonSuccessNews' end]),''),
        case when v_outcome='succeeded' then q.title||' succeeded.' else q.title||' ended without success.' end
      ) into v_narration from private.npc_versions version where version.id=q.version_id;
    else
      v_narration:=case when v_outcome='succeeded' then q.title||' succeeded.'
        when v_outcome='abandoned' then q.title||' was abandoned.'
        else q.title||' failed.' end;
    end if;
  end if;

  insert into private.world_quest_events(
    quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,
    preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,
    rules_version,narration,public_news
  ) values (
    q.id,q.save_id,q.instance_id,p_closing_day,q.current_step,action_name,approach_name,v_skill,q.difficulty,
    q.preparation,case when action_name='prepare' then least(2,q.preparation+1) else q.preparation end,
    v_hospitality,v_readiness,v_chance,v_draw,v_outcome,'quest-resolution-v2',v_narration,v_public_news
  ) returning * into event_row;

  update private.world_quests
  set preparation=event_row.preparation_after,
      current_step=case when action_name in ('prepare','wait') then current_step+1 else current_step end,
      state=case
        when action_name='attempt' and v_outcome in ('succeeded','failed') then v_outcome
        when action_name='abandon' then 'abandoned'
        else state
      end,
      terminal_day=case
        when (action_name='attempt' and v_outcome in ('succeeded','failed')) or action_name='abandon' then p_closing_day
        else terminal_day
      end,
      terminal_event_id=case
        when (action_name='attempt' and v_outcome in ('succeeded','failed')) or action_name='abandon' then event_row.id
        else terminal_event_id
      end
  where id=q.id;

  if action_name='attempt' and v_outcome='succeeded' then
    -- The reward receipt and the successful terminal event commit atomically.
    perform private.world_grant_initial_quest_trinket(q.id,event_row.id);
  end if;

  if (action_name='attempt' and v_outcome in ('succeeded','failed')) or action_name='abandon' then
    select * into q from private.world_quests where id=q.id;
    v_context:=private.world_quest_transition_context(q,event_row);
    if action_name='attempt' and v_outcome='failed' then
      if v_failure_gate is null then v_failure_gate:=private.world_quest_failure_gate(q.id,false); end if;
      v_context:=v_context||jsonb_build_object('questFailurePolicy',v_failure_gate);
    end if;
    if octet_length(v_context::text)>65536 then raise sqlstate 'PT400' using message='Quest transition context is too large'; end if;
    insert into private.world_quest_transitions(quest_id,terminal_event_id,save_id,instance_id,frozen_context,context_fingerprint)
    values(q.id,event_row.id,q.save_id,q.instance_id,v_context,
      encode(extensions.digest(private.world_canonical_json(v_context),'sha256'),'hex'))
    on conflict(terminal_event_id) do nothing;
  end if;

  return event_row;
end
$function$;

-- A final authored departure is an outcome rule, not a model suggestion. The
-- transition worker may supply prose, but it cannot turn the failed authored
-- quest into a successor after the author-selected allowance is exhausted.
create or replace function public.world_quest_transition_commit(p_transition_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  t private.world_quest_transitions;
  q private.world_quests;
  save_row public.tavern_saves;
  m jsonb;
  kind text;
  opening_day integer;
  eligible_day integer;
  new_quest uuid;
  v_receipt jsonb;
  existing jsonb;
  v_mandatory_departure boolean:=false;
  v_policy jsonb;
  v_farewell_text text;
  v_public_news text;
  departure_state text;
begin
  perform private.world_settlement_assert_service();
  select transition_row.receipt into existing
  from private.world_quest_transitions transition_row
  where transition_row.id=p_transition_id and transition_row.status='committed';
  if found then return existing; end if;

  t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  select * into save_row from public.tavern_saves where id=t.save_id for update;
  if not found then raise sqlstate 'PT409' using message='Quest save no longer exists'; end if;
  select * into q from private.world_quests where id=t.quest_id for update;
  if not found or q.terminal_event_id<>t.terminal_event_id or q.state not in ('succeeded','failed','abandoned') then
    raise sqlstate 'PT409' using message='Quest terminal state changed';
  end if;

  v_policy:=t.frozen_context->'questFailurePolicy';
  v_mandatory_departure:=q.state='failed' and v_policy->>'mandatoryDisposition'='departure'
    and coalesce((v_policy->>'terminalFailureAllowed')::boolean,false)
    and coalesce((v_policy->>'attemptCount')::integer,0)>=3;

  if v_mandatory_departure then
    v_farewell_text:=coalesce(
      nullif(btrim(v_policy->'permanentLoss'->>'outcome'),''),
      'I cannot stay after this final setback. I will leave after one last day.'
    );
    v_farewell_text:=left(v_farewell_text,500);
    v_public_news:=coalesce(
      nullif(btrim(v_policy->>'nonSuccessNews'),''),
      q.title||' has reached a final setback and will leave after one last day.'
    );
    v_public_news:=left(v_public_news,500);
    p_proposal:=jsonb_build_object(
      'version','quest-transition-v1',
      'kind','departure',
      'terminalEventId',t.terminal_event_id,
      'privateRationale',left(coalesce(nullif(btrim(v_policy->'permanentLoss'->>'outcome'),''),q.motivation),500),
      'farewellText',v_farewell_text,
      'publicNews',v_public_news
    );
  end if;

  kind:=private.world_quest_transition_validate_proposal(t,p_proposal);
  if kind is null then raise sqlstate 'PT400' using message='Quest transition proposal violates its frozen contract'; end if;
  if q.state='failed' and kind='departure' and not v_mandatory_departure then
    raise sqlstate 'PT400' using message='A failed quest needs its authored repeated-setback condition before departure';
  end if;

  if exists(select 1 from private.world_quests live where live.save_id=t.save_id and live.instance_id=t.instance_id and live.state in ('scheduled','active')) then
    raise sqlstate 'PT409' using message='Resident already has a live quest';
  end if;
  opening_day:=case when save_row.world_phase='settling' then save_row.current_day else save_row.current_day+1 end;
  eligible_day:=greatest(q.terminal_day+1,opening_day);
  m:=t.frozen_context->'nextAuthoredMilestone';

  if kind='next_authored_milestone' then
    insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
    values(t.save_id,t.instance_id,q.package_id,q.package_hash,q.version_id,'authored_milestone',q.authored_milestone_index+1,m->>'id',coalesce(m->>'title',m->>'id'),coalesce(m->>'outcome',m->>'id'),coalesce(m->>'motivation','Pursue the next meaningful step.'),coalesce(array(select jsonb_array_elements_text(m->'constraints')),'{}'),coalesce(array(select jsonb_array_elements_text(m->'allowedTargets')),'{}'),coalesce((m->>'difficulty')::integer,0),p_proposal->'plan',p_proposal->'plan',case when save_row.world_phase='settling' and eligible_day<=save_row.current_day then 'active' else 'scheduled' end,0,0,eligible_day,case when save_row.world_phase='settling' and eligible_day<=save_row.current_day then save_row.current_day else null end)
    returning id into new_quest;
  elsif kind='successor' then
    insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
    values(t.save_id,t.instance_id,q.package_id,q.package_hash,q.version_id,'generated_successor',q.id,btrim(p_proposal->>'title'),btrim(p_proposal->>'objective'),btrim(p_proposal->>'motivation'),array(select btrim(value) from jsonb_array_elements_text(p_proposal->'constraints') value),array(select value from jsonb_array_elements_text(p_proposal->'targetRefs') value),(p_proposal->>'difficulty')::integer,p_proposal->'plan',p_proposal->'plan',case when save_row.world_phase='settling' and eligible_day<=save_row.current_day then 'active' else 'scheduled' end,0,0,eligible_day,case when save_row.world_phase='settling' and eligible_day<=save_row.current_day then save_row.current_day else null end)
    returning id into new_quest;
  else
    departure_state:=case when save_row.world_phase='settling' and eligible_day<=save_row.current_day then 'farewell' else 'scheduled' end;
    insert into private.world_npc_departures(instance_id,save_id,transition_id,terminal_event_id,farewell_day,state,private_rationale,farewell_text,public_news)
    values(t.instance_id,t.save_id,t.id,t.terminal_event_id,eligible_day,departure_state,btrim(p_proposal->>'privateRationale'),btrim(p_proposal->>'farewellText'),btrim(p_proposal->>'publicNews'));
  end if;

  v_receipt:=jsonb_build_object(
    'status','completed','rulesVersion','quest-transition-v1','transitionId',t.id,
    'terminalEventId',t.terminal_event_id,'kind',kind,'questId',new_quest,
    'scheduledForDay',case when kind<>'departure' then eligible_day else null end,
    'activatedDay',case when new_quest is not null and save_row.world_phase='settling' and eligible_day<=save_row.current_day then save_row.current_day else null end,
    'farewellDay',case when kind='departure' then eligible_day else null end
  );
  insert into private.world_quest_transition_receipts(transition_id,terminal_event_id,kind,fence,decision,result)
  values(t.id,t.terminal_event_id,'committed',p_fence,p_proposal,v_receipt);
  update private.world_quest_transitions set status='committed',decision=p_proposal,result=v_receipt,receipt=v_receipt,
    committed_at=clock_timestamp(),processing_started_at=null,lease_until=null,fence=null,
    farewell_day=case when kind='departure' then eligible_day else null end
  where id=t.id;
  perform private.world_quest_transition_maybe_open(t.save_id);
  return v_receipt;
end
$function$;

revoke all on function private.world_quest_failure_gate(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.world_resolve_quest_step(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.world_quest_transition_commit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.world_quest_transition_commit(uuid,uuid,jsonb) to service_role;

commit;
