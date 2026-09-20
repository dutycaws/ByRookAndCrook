-- Issue #31 Packet 3B: fenced, service-only terminal quest transitions.
-- Terminal-event context is immutable; providers may retry work but only a current
-- fenced worker can make one bounded successor or departure durable.
begin;

create function private.world_quest_transition_exact_keys(p_value jsonb, p_keys text[])
returns boolean language sql immutable set search_path='' as $function$
  select jsonb_typeof(p_value)='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_value) key)
        is not distinct from (select array_agg(key order by key) from unnest(p_keys) key)
$function$;

create function private.world_quest_transition_text(p_value jsonb, p_key text, p_max integer)
returns boolean language sql immutable set search_path='' as $function$
  select jsonb_typeof(p_value->p_key)='string'
    and length(btrim(p_value->>p_key)) between 1 and p_max
$function$;

create function private.world_quest_transition_plan_is_valid(p_plan jsonb)
returns boolean language plpgsql immutable set search_path='' as $function$
declare step jsonb;
begin
  if not private.world_quest_plan_is_valid(p_plan) then return false; end if;
  for step in select value from jsonb_array_elements(p_plan) loop
    if not private.world_quest_transition_exact_keys(step,array['action','approach']) then return false; end if;
  end loop;
  return true;
end $function$;

alter table private.world_quest_transitions
  add column if not exists lease_until timestamptz,
  add column if not exists fence uuid,
  add column if not exists attempt_count integer not null default 0 check(attempt_count >= 0),
  add column if not exists farewell_day integer;
alter table private.world_quest_transitions
  drop constraint if exists world_quest_transitions_check,
  drop constraint if exists world_quest_transitions_check2,
  add constraint world_quest_transitions_processing_lease check (
    (status='processing') = (processing_started_at is not null and lease_until is not null and fence is not null)
  );

create table private.world_quest_transition_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  transition_id uuid not null references private.world_quest_transitions(id) on delete cascade,
  attempt_number integer not null check(attempt_number > 0),
  fence uuid not null,
  claimed_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null,
  unique(transition_id,attempt_number), unique(transition_id,fence)
);
create trigger world_quest_transition_attempts_append_only before update or delete
on private.world_quest_transition_attempts for each row execute function private.world_history_append_only();

create table private.world_quest_transition_checkpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  transition_id uuid not null references private.world_quest_transitions(id) on delete cascade,
  fence uuid not null,
  stage text not null check(stage in ('proposer','critic','repair','final_critic')),
  payload jsonb not null check(jsonb_typeof(payload) in ('object','array')),
  created_at timestamptz not null default clock_timestamp(),
  unique(transition_id,fence,stage)
);
create trigger world_quest_transition_checkpoints_append_only before update or delete
on private.world_quest_transition_checkpoints for each row execute function private.world_history_append_only();

create table private.world_quest_transition_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  transition_id uuid not null references private.world_quest_transitions(id) on delete cascade,
  terminal_event_id uuid not null references private.world_quest_events(id) on delete cascade,
  kind text not null check(kind in ('failed','committed')),
  fence uuid,
  failure_code text,
  decision jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check((kind='failed') = (failure_code is not null)),
  check((kind='committed') = (decision is not null))
);
create unique index world_quest_transition_one_commit_receipt on private.world_quest_transition_receipts(transition_id) where kind='committed';
create trigger world_quest_transition_receipts_append_only before update or delete
on private.world_quest_transition_receipts for each row execute function private.world_history_append_only();

create table private.world_npc_departures (
  instance_id uuid primary key references private.world_npc_instances(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  transition_id uuid not null unique references private.world_quest_transitions(id) on delete restrict,
  terminal_event_id uuid not null unique references private.world_quest_events(id) on delete restrict,
  farewell_day integer not null check(farewell_day >= 0),
  state text not null default 'farewell' check(state in ('farewell','departed')),
  private_rationale text not null check(length(private_rationale) between 1 and 500),
  farewell_text text not null check(length(farewell_text) between 1 and 500),
  public_news text not null check(length(public_news) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  departed_at timestamptz,
  check((state='departed') = (departed_at is not null))
);

create function private.world_quest_transition_assert_fence(p_transition_id uuid,p_fence uuid)
returns private.world_quest_transitions language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions;
begin
  select * into t from private.world_quest_transitions where id=p_transition_id for update;
  if not found or t.status<>'processing' or t.fence is distinct from p_fence or t.lease_until<=clock_timestamp() then
    raise sqlstate 'PT409' using message='Quest transition fence is stale or unavailable';
  end if;
  if t.context_fingerprint <> encode(extensions.digest(private.world_canonical_json(t.frozen_context),'sha256'),'hex') then
    raise sqlstate 'PT409' using message='Quest transition context fingerprint changed';
  end if;
  return t;
end $function$;

create function public.world_quest_transition_claim(p_terminal_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions; v_fence uuid:=extensions.gen_random_uuid(); v_checkpoints jsonb; v_reuse_checkpoints boolean;
begin
  perform private.world_settlement_assert_service();
  select * into t from private.world_quest_transitions where terminal_event_id=p_terminal_event_id for update;
  if not found then raise sqlstate 'PT404' using message='Terminal quest transition was not found'; end if;
  if t.status='committed' then return coalesce(t.receipt,'{}'::jsonb); end if;
  if t.status='processing' and t.lease_until>clock_timestamp() then raise sqlstate 'PT409' using message='Quest transition is already leased'; end if;
  -- A contract-rejected model answer must be regenerated under the new fence.
  -- Network/timeout failures retain prior checkpoints because those values were
  -- already structurally accepted before the operational interruption.
  v_reuse_checkpoints := coalesce(t.failure_code,'') <> 'validation_rejected';
  update private.world_quest_transitions set status='processing',processing_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes',fence=v_fence,attempt_count=attempt_count+1,failure_code=null,failed_at=null
  where id=t.id returning * into t;
  insert into private.world_quest_transition_attempts(transition_id,attempt_number,fence,lease_until)
  values(t.id,t.attempt_count,v_fence,t.lease_until);
  if v_reuse_checkpoints then
    select coalesce(jsonb_agg(jsonb_build_object('stage',latest.stage,'payload',latest.payload) order by latest.stage),'[]'::jsonb)
    into v_checkpoints
    from (
      select distinct on (checkpoint.stage) checkpoint.stage,checkpoint.payload,checkpoint.created_at
      from private.world_quest_transition_checkpoints checkpoint
      where checkpoint.transition_id=t.id
      order by checkpoint.stage,checkpoint.created_at desc,checkpoint.id desc
    ) latest;
  else
    v_checkpoints := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'transitionId',t.id,'terminalEventId',t.terminal_event_id,'instanceId',t.instance_id,
    'fence',v_fence,'attempt',t.attempt_count,'leaseUntil',t.lease_until,
    'contextFingerprint',t.context_fingerprint,'frozenContext',t.frozen_context,
    'checkpoints',v_checkpoints
  );
end $function$;

create function public.world_quest_transition_claim_next()
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_terminal_event_id uuid;
begin
  perform private.world_settlement_assert_service();
  select transition.terminal_event_id into v_terminal_event_id
  from private.world_quest_transitions transition
  where transition.status='awaiting'
     or (transition.status='processing' and transition.lease_until<=clock_timestamp())
  order by transition.created_at,transition.id
  for update skip locked
  limit 1;
  if not found then return jsonb_build_object('status','idle'); end if;
  return public.world_quest_transition_claim(v_terminal_event_id);
end $function$;

create function public.world_quest_transition_heartbeat(p_transition_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions;
begin
  perform private.world_settlement_assert_service(); t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  update private.world_quest_transitions set lease_until=clock_timestamp()+interval '5 minutes' where id=t.id returning * into t;
  return jsonb_build_object('transitionId',t.id,'fence',t.fence,'leaseUntil',t.lease_until);
end $function$;

create function public.world_quest_transition_checkpoint(p_transition_id uuid,p_fence uuid,p_stage text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions; c private.world_quest_transition_checkpoints;
begin
  perform private.world_settlement_assert_service(); t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  if p_stage not in ('proposer','critic','repair','final_critic') or jsonb_typeof(p_payload) not in ('object','array') then raise sqlstate 'PT400' using message='Quest transition checkpoint is invalid'; end if;
  insert into private.world_quest_transition_checkpoints(transition_id,fence,stage,payload) values(t.id,p_fence,p_stage,p_payload)
  on conflict(transition_id,fence,stage) do nothing returning * into c;
  if not found then
    select * into c from private.world_quest_transition_checkpoints where transition_id=t.id and fence=p_fence and stage=p_stage;
    if c.payload<>p_payload then raise sqlstate 'PT409' using message='Quest transition checkpoint replay differs'; end if;
  end if;
  return jsonb_build_object('checkpointId',c.id,'stage',c.stage,'payload',c.payload);
end $function$;

create function public.world_quest_transition_fail(p_transition_id uuid,p_fence uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions;
begin
  perform private.world_settlement_assert_service(); t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  if length(btrim(coalesce(p_failure_code,''))) not between 1 and 160 then raise sqlstate 'PT400' using message='Quest transition failure code is invalid'; end if;
  insert into private.world_quest_transition_receipts(transition_id,terminal_event_id,kind,fence,failure_code,result)
  values(t.id,t.terminal_event_id,'failed',p_fence,btrim(p_failure_code),jsonb_build_object('status','awaiting'));
  update private.world_quest_transitions set status='awaiting',processing_started_at=null,lease_until=null,fence=null,failed_at=clock_timestamp(),failure_code=btrim(p_failure_code) where id=t.id;
  return jsonb_build_object('transitionId',t.id,'status','awaiting');
end $function$;

create function private.world_quest_transition_validate_proposal(p_transition private.world_quest_transitions,p_proposal jsonb)
returns text language plpgsql stable security definer set search_path='' as $function$
declare m jsonb:=p_transition.frozen_context->'nextAuthoredMilestone'; step jsonb; target text; constraint_item jsonb;
begin
  if jsonb_typeof(p_proposal)<>'object' or p_proposal->>'version'<>'quest-transition-v1'
    or p_proposal->>'terminalEventId'<>p_transition.terminal_event_id::text then return null; end if;
  if jsonb_typeof(m)='object' then
    if not private.world_quest_transition_exact_keys(p_proposal,array['version','kind','terminalEventId','milestoneId','plan'])
      or p_proposal->>'kind'<>'next_authored_milestone' or p_proposal->>'milestoneId'<>m->>'id'
      or not private.world_quest_transition_plan_is_valid(p_proposal->'plan') then return null; end if;
  elsif p_proposal->>'kind'='successor' then
    if not private.world_quest_transition_exact_keys(p_proposal,array['version','kind','terminalEventId','title','objective','motivation','constraints','targetRefs','difficulty','plan'])
      or not private.world_quest_transition_text(p_proposal,'title',120) or not private.world_quest_transition_text(p_proposal,'objective',500) or not private.world_quest_transition_text(p_proposal,'motivation',500)
      or jsonb_typeof(p_proposal->'constraints')<>'array' or jsonb_array_length(p_proposal->'constraints')>6
      or jsonb_typeof(p_proposal->'targetRefs')<>'array' or jsonb_array_length(p_proposal->'targetRefs') not between 1 and 3
      or jsonb_typeof(p_proposal->'difficulty')<>'number'
      or (p_proposal->>'difficulty')::numeric<>trunc((p_proposal->>'difficulty')::numeric)
      or (p_proposal->>'difficulty')::integer not between 0 and 4
      or not private.world_quest_transition_plan_is_valid(p_proposal->'plan')
      or not (p_transition.frozen_context->'capabilityEnvelope'->'allowedWorldEffects' ? 'create_quest') then return null; end if;
    for constraint_item in select value from jsonb_array_elements(p_proposal->'constraints') loop
      if jsonb_typeof(constraint_item)<>'string' or length(btrim(constraint_item#>>'{}')) not between 1 and 180 then return null; end if;
    end loop;
    if (select count(*) from jsonb_array_elements_text(p_proposal->'targetRefs'))
       <> (select count(distinct value) from jsonb_array_elements_text(p_proposal->'targetRefs') value) then return null; end if;
    for target in select jsonb_array_elements_text(p_proposal->'targetRefs') loop
      if not exists(select 1 from jsonb_array_elements(coalesce(p_transition.frozen_context->'validCanonicalTargets','[]'::jsonb)) valid where valid->>'id'=target or valid->>'ref'=target) then return null; end if;
    end loop;
  elsif p_proposal->>'kind'='departure' then
    if not private.world_quest_transition_exact_keys(p_proposal,array['version','kind','terminalEventId','privateRationale','farewellText','publicNews'])
      or not private.world_quest_transition_text(p_proposal,'privateRationale',500) or not private.world_quest_transition_text(p_proposal,'farewellText',500) or not private.world_quest_transition_text(p_proposal,'publicNews',500)
      or lower(p_proposal::text) ~ '\\m(death|dead|die|died|dying|kill|killed|murder|murdered|suicide|corpse|funeral)\\M' then return null; end if;
  else return null;
  end if;
  -- The frozen capability envelope, rather than the global vocabulary, is the authority.
  for step in select value from jsonb_array_elements(p_proposal->'plan') loop
    if not (p_transition.frozen_context->'capabilityEnvelope'->'allowedActions' ? (step->>'action'))
      or not (p_transition.frozen_context->'capabilityEnvelope'->'allowedApproaches' ? (step->>'approach')) then return null; end if;
  end loop;
  return p_proposal->>'kind';
end $function$;

create function public.world_quest_transition_commit(p_transition_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions; q private.world_quests; m jsonb; kind text; v_current_day integer; eligible_day integer; new_quest uuid; v_receipt jsonb; existing jsonb;
begin
  perform private.world_settlement_assert_service();
  select transition_row.receipt into existing from private.world_quest_transitions transition_row where transition_row.id=p_transition_id and transition_row.status='committed';
  if found then return existing; end if;
  t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence); kind:=private.world_quest_transition_validate_proposal(t,p_proposal);
  if kind is null then raise sqlstate 'PT400' using message='Quest transition proposal violates its frozen contract'; end if;
  select * into q from private.world_quests where id=t.quest_id for update;
  if not found or q.terminal_event_id<>t.terminal_event_id or q.state not in ('succeeded','failed','abandoned') then raise sqlstate 'PT409' using message='Quest terminal state changed'; end if;
  if exists(select 1 from private.world_quests live where live.save_id=t.save_id and live.instance_id=t.instance_id and live.state in ('scheduled','active')) then raise sqlstate 'PT409' using message='Resident already has a live quest'; end if;
  select save_row.current_day into v_current_day from public.tavern_saves save_row where save_row.id=t.save_id for update;
  if not found then raise sqlstate 'PT409' using message='Quest save no longer exists'; end if;
  eligible_day:=greatest(q.terminal_day+1,v_current_day);
  m:=t.frozen_context->'nextAuthoredMilestone';
  if kind='next_authored_milestone' then
    insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
    values(t.save_id,t.instance_id,q.package_id,q.package_hash,q.version_id,'authored_milestone',q.authored_milestone_index+1,m->>'id',coalesce(m->>'title',m->>'id'),coalesce(m->>'outcome',m->>'id'),coalesce(m->>'motivation','Pursue the next meaningful step.'),coalesce(array(select jsonb_array_elements_text(m->'constraints')),'{}'),coalesce(array(select jsonb_array_elements_text(m->'allowedTargets')),'{}'),coalesce((m->>'difficulty')::integer,0),p_proposal->'plan',p_proposal->'plan','scheduled',0,0,eligible_day,null) returning id into new_quest;
  elsif kind='successor' then
    insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
    values(t.save_id,t.instance_id,q.package_id,q.package_hash,q.version_id,'generated_successor',q.id,btrim(p_proposal->>'title'),btrim(p_proposal->>'objective'),btrim(p_proposal->>'motivation'),array(select btrim(value) from jsonb_array_elements_text(p_proposal->'constraints') value),array(select value from jsonb_array_elements_text(p_proposal->'targetRefs') value),(p_proposal->>'difficulty')::integer,p_proposal->'plan',p_proposal->'plan','scheduled',0,0,eligible_day,null) returning id into new_quest;
  else
    insert into private.world_npc_departures(instance_id,save_id,transition_id,terminal_event_id,farewell_day,private_rationale,farewell_text,public_news)
    values(t.instance_id,t.save_id,t.id,t.terminal_event_id,eligible_day,btrim(p_proposal->>'privateRationale'),btrim(p_proposal->>'farewellText'),btrim(p_proposal->>'publicNews'));
  end if;
  if new_quest is not null and eligible_day<=v_current_day then
    update private.world_quests set state='active',activated_day=v_current_day where id=new_quest and state='scheduled';
  end if;
  v_receipt:=jsonb_build_object('status','completed','rulesVersion','quest-transition-v1','transitionId',t.id,'terminalEventId',t.terminal_event_id,'kind',kind,'questId',new_quest,'scheduledForDay',case when kind<>'departure' then eligible_day else null end,'activatedDay',case when new_quest is not null and eligible_day<=v_current_day then v_current_day else null end,'farewellDay',case when kind='departure' then eligible_day else null end);
  insert into private.world_quest_transition_receipts(transition_id,terminal_event_id,kind,fence,decision,result) values(t.id,t.terminal_event_id,'committed',p_fence,p_proposal,v_receipt);
  update private.world_quest_transitions set status='committed',decision=p_proposal,result=v_receipt,receipt=v_receipt,committed_at=clock_timestamp(),processing_started_at=null,lease_until=null,fence=null,farewell_day=case when kind='departure' then eligible_day else null end where id=t.id;
  return v_receipt;
end $function$;

create function private.world_quest_departure_state(p_save_id uuid,p_instance_id uuid)
returns text language sql stable security definer set search_path='' as $function$
  select state from private.world_npc_departures where save_id=p_save_id and instance_id=p_instance_id
$function$;

create function private.world_quest_departure_close_after_day()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.current_day <= old.current_day then return new; end if;
  update private.world_quests quest set state='active',activated_day=new.current_day
  where quest.save_id=new.id and quest.state='scheduled' and quest.scheduled_for_day<=new.current_day;
  update private.world_npc_departures departure
  set state='departed', departed_at=clock_timestamp()
  where departure.save_id=new.id and departure.state='farewell' and departure.farewell_day=old.current_day;
  update private.world_npc_instances resident set status='departed',settled_day=old.current_day
  from private.world_npc_departures departure
  where departure.save_id=new.id and departure.instance_id=resident.id and departure.state='departed'
    and resident.status<>'departed';
  -- Preserve the no-reuse terminal record after the farewell closes. The
  -- instance remains available for historical/journal reads, while future
  -- materialization sees the save-local departed tombstone.
  insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason)
  select resident.save_id,resident.npc_id,resident.version_id,'departed'
  from private.world_npc_instances resident
  join private.world_npc_departures departure on departure.instance_id=resident.id
  where departure.save_id=new.id and departure.state='departed'
  on conflict do nothing;
  return new;
end $function$;
drop trigger if exists world_quest_departure_close_after_day on public.tavern_saves;
create trigger world_quest_departure_close_after_day after update of current_day on public.tavern_saves
for each row execute function private.world_quest_departure_close_after_day();

revoke all on table private.world_quest_transition_attempts,private.world_quest_transition_checkpoints,private.world_quest_transition_receipts,private.world_npc_departures from public,anon,authenticated,service_role;
revoke all on function private.world_quest_transition_exact_keys(jsonb,text[]),private.world_quest_transition_text(jsonb,text,integer),private.world_quest_transition_plan_is_valid(jsonb),private.world_quest_transition_assert_fence(uuid,uuid),private.world_quest_transition_validate_proposal(private.world_quest_transitions,jsonb),private.world_quest_departure_state(uuid,uuid),private.world_quest_departure_close_after_day() from public,anon,authenticated;
revoke all on function public.world_quest_transition_claim(uuid),public.world_quest_transition_claim_next(),public.world_quest_transition_heartbeat(uuid,uuid),public.world_quest_transition_checkpoint(uuid,uuid,text,jsonb),public.world_quest_transition_fail(uuid,uuid,text),public.world_quest_transition_commit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.world_quest_transition_claim(uuid),public.world_quest_transition_claim_next(),public.world_quest_transition_heartbeat(uuid,uuid),public.world_quest_transition_checkpoint(uuid,uuid,text,jsonb),public.world_quest_transition_fail(uuid,uuid,text),public.world_quest_transition_commit(uuid,uuid,jsonb) to service_role;
revoke all on function public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
commit;
