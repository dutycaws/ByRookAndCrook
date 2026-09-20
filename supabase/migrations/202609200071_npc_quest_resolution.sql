begin;

create function private.world_quest_hospitality(p_quest_id uuid,p_closing_day integer)
returns integer language sql stable security definer set search_path='' as $function$
  select greatest(-3,least(3,coalesce(sum(event.quality_index-3),0)::integer))
  from private.world_quests quest join private.world_npc_hospitality_events event
    on event.save_id=quest.save_id and event.instance_id=quest.instance_id
  where quest.id=p_quest_id and event.item_kind in ('food','beverage')
    and event.day_number between coalesce(quest.activated_day,quest.scheduled_for_day) and p_closing_day
$function$;
create function private.world_quest_readiness(p_preparation integer,p_hospitality integer)
returns integer language sql immutable set search_path='' as $function$
  select greatest(-30,least(30,10*p_preparation+5*p_hospitality))
$function$;
create function private.world_quest_chance(p_skill integer,p_difficulty integer,p_readiness integer)
returns integer language sql immutable set search_path='' as $function$
  select greatest(5,least(95,50+10*(p_skill-p_difficulty)+p_readiness))
$function$;

create function private.world_resolve_quest_step(p_quest_id uuid,p_closing_day integer,p_draw_override integer default null)
returns private.world_quest_events language plpgsql security definer set search_path='' as $function$
declare q private.world_quests; prior private.world_quest_events; step jsonb; action_name text; approach_name text; v_skill integer; v_hospitality integer; v_readiness integer; v_chance integer; v_draw integer; v_outcome text; v_narration text:=''; v_public_news boolean:=false; event_row private.world_quest_events; v_context jsonb;
begin
  select * into q from private.world_quests where id=p_quest_id for update;
  if not found then raise sqlstate 'PT409' using message='Quest is not resolvable'; end if;
  select * into prior from private.world_quest_events where quest_id=p_quest_id and day_number=p_closing_day;
  if found then return prior; end if;
  if q.state<>'active' or p_closing_day<q.activated_day then raise sqlstate 'PT409' using message='Quest is not resolvable'; end if;
  step:=q.current_plan->q.current_step; action_name:=step->>'action'; approach_name:=step->>'approach';
  select coalesce((version.sheet->'skills'->>approach_name)::integer,0) into v_skill from private.npc_versions version where version.id=q.version_id;
  v_hospitality:=private.world_quest_hospitality(q.id,p_closing_day); v_readiness:=private.world_quest_readiness(q.preparation,v_hospitality);
  if action_name='attempt' then v_chance:=private.world_quest_chance(v_skill,q.difficulty,v_readiness); v_draw:=coalesce(p_draw_override,floor(random()*100)::integer); if v_draw not between 0 and 99 then raise sqlstate 'PT400' using message='Draw override is invalid'; end if; v_outcome:=case when v_draw<v_chance then 'succeeded' else 'failed' end;
  elsif action_name='abandon' then v_outcome:='abandoned'; else v_outcome:=case when action_name='prepare' then 'prepared' else 'waited' end; end if;
  if action_name in ('attempt','abandon') then
    v_public_news:=true;
    if q.origin='authored_milestone' then
      select coalesce(
        version.sheet#>>array['campaign','milestones',q.authored_milestone_index::text,case when v_outcome='succeeded' then 'successNews' else 'nonSuccessNews' end],
        case when v_outcome='succeeded' then q.title||' succeeded.' else q.title||' ended without success.' end
      ) into v_narration from private.npc_versions version where version.id=q.version_id;
    else
      v_narration:=case when v_outcome='succeeded' then q.title||' succeeded.' when v_outcome='abandoned' then q.title||' was abandoned.' else q.title||' failed.' end;
    end if;
  end if;
  insert into private.world_quest_events(quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,rules_version,narration,public_news)
  values(q.id,q.save_id,q.instance_id,p_closing_day,q.current_step,action_name,approach_name,v_skill,q.difficulty,q.preparation,case when action_name='prepare' then least(2,q.preparation+1) else q.preparation end,v_hospitality,v_readiness,v_chance,v_draw,v_outcome,'quest-resolution-v1',v_narration,v_public_news) returning * into event_row;
  update private.world_quests set preparation=event_row.preparation_after,current_step=case when action_name in ('prepare','wait') then current_step+1 else current_step end,state=case when action_name='attempt' then v_outcome when action_name='abandon' then 'abandoned' else state end,terminal_day=case when action_name in ('attempt','abandon') then p_closing_day else terminal_day end,terminal_event_id=case when action_name in ('attempt','abandon') then event_row.id else terminal_event_id end where id=q.id;
  if action_name in ('attempt','abandon') then
    select * into q from private.world_quests where id=q.id;
    select jsonb_build_object(
      'quest',to_jsonb(q),
      'terminalEvent',to_jsonb(event_row),
      'eventHistory',coalesce((select jsonb_agg(to_jsonb(history) order by history.day_number,history.step_index,history.id) from private.world_quest_events history where history.quest_id=q.id),'[]'::jsonb),
      'versionSheet',(select version.sheet from private.npc_versions version where version.id=q.version_id),
      'capabilityEnvelope',(select package.capability_envelope from private.npc_version_resident_packages package where package.id=q.package_id),
      'registeredActions',coalesce((select package.capability_envelope->'allowedActions' from private.npc_version_resident_packages package where package.id=q.package_id),'[]'::jsonb),
      'registeredApproaches',coalesce((select package.capability_envelope->'allowedApproaches' from private.npc_version_resident_packages package where package.id=q.package_id),'[]'::jsonb),
      'validCanonicalTargets',coalesce((
        select jsonb_agg(
          jsonb_build_object('id',target.id,'ref',target.ref,'kind',target.kind)
          order by target.kind,target.ref,target.id
        )
        from (
          -- A generated successor may reuse the completed quest's immutable
          -- authored target references even when that authored lore has no
          -- row in the generated-world entity registry.  The remaining rows
          -- are the bounded, currently active canonical targets authorized by
          -- the pinned resident package.
          select distinct on (candidate.ref) candidate.id,candidate.ref,candidate.kind
          from (
            select quest_target as id,quest_target as ref,'quest_target'::text as kind
            from unnest(q.target_refs) quest_target
            union all
            select entity.id::text,entity.entity_key,entity.entity_kind
            from private.world_canonical_entities entity
            join private.npc_version_resident_packages package on package.id=q.package_id
            where entity.save_id=q.save_id and entity.lifecycle='active'
              and package.capability_envelope->'allowedTargetKinds' ? entity.entity_kind
          ) candidate
          order by candidate.ref,case when candidate.kind='quest_target' then 0 else 1 end,candidate.id
          limit 150
        ) target
      ),'[]'::jsonb),
      'currentProfile',(select profile.current_profile from private.world_resident_profiles profile where profile.instance_id=q.instance_id),
      'nextAuthoredMilestone',case when q.origin='authored_milestone' then (select version.sheet#>array['campaign','milestones',(q.authored_milestone_index+1)::text] from private.npc_versions version where version.id=q.version_id) else null end,
      'dialogueEvidence',coalesce((select jsonb_agg(jsonb_build_object('id',turn.id,'day',turn.day_number,'sequence',turn.input_sequence,'result',turn.result) order by turn.day_number desc,turn.input_sequence desc) from (select * from private.world_npc_dialogue_turns where instance_id=q.instance_id and status='completed' order by day_number desc,input_sequence desc limit 8) turn),'[]'::jsonb),
      'hospitality',coalesce((select jsonb_agg(jsonb_build_object('day',hospitality.day_number,'kind',hospitality.item_kind,'quality',hospitality.quality_index,'item',hospitality.item_name) order by hospitality.day_number,hospitality.action_id) from (select * from private.world_npc_hospitality_events where save_id=q.save_id and instance_id=q.instance_id and day_number between q.activated_day and p_closing_day order by day_number desc,action_id desc limit 32) hospitality),'[]'::jsonb),
      'beliefs',coalesce((select jsonb_agg(jsonb_build_object('fingerprint',belief.fingerprint,'statement',belief.statement,'confidence',belief.confidence,'provenance',belief.provenance,'subject',belief.subject_key) order by belief.confidence desc,belief.fingerprint) from (select * from private.world_resident_beliefs where instance_id=q.instance_id and active order by confidence desc,fingerprint limit 12) belief),'[]'::jsonb),
      'socialEdges',coalesce((select jsonb_agg(jsonb_build_object('from',edge.from_instance_id,'to',edge.to_instance_id,'trust',edge.trust,'affection',edge.affection,'respect',edge.respect,'fear',edge.fear,'obligation',edge.obligation) order by edge.from_instance_id,edge.to_instance_id) from (select * from private.world_social_edges where save_id=q.save_id and (from_instance_id=q.instance_id or to_instance_id=q.instance_id) order by updated_at desc,from_instance_id,to_instance_id limit 16) edge),'[]'::jsonb)
    ) into v_context;
    if octet_length(v_context::text)>65536 then raise sqlstate 'PT400' using message='Quest transition context is too large'; end if;
    insert into private.world_quest_transitions(quest_id,terminal_event_id,save_id,instance_id,frozen_context,context_fingerprint)
    values(
      q.id,event_row.id,q.save_id,q.instance_id,
      v_context,
      encode(extensions.digest(private.world_canonical_json(v_context),'sha256'),'hex')
    ) on conflict(terminal_event_id) do nothing;
  end if;
  return event_row;
end $function$;

alter table private.world_quest_events
  add constraint world_quest_events_readiness_range check (readiness between -30 and 30);

create or replace function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_result jsonb;
  lifecycle jsonb := '[]'::jsonb;
  exact_replay boolean := false;
  save_row public.tavern_saves;
  closing_day integer;
  quest_row record;
  event_row private.world_quest_events;
  final_state text;
  pending_transition boolean;
begin
  -- The predecessor owns the established authentication, revision, world-phase,
  -- craft, dialogue, and action-replay contract.  Detect an exact replay before
  -- resolving so its saved receipt remains byte-for-byte stable.
  select exists(
    select 1 from public.craft_actions
    where save_id=p_save_id and action_id=p_action_id and command_kind='advance_day'
      and input_expected_revision=p_expected_revision
  ) into exact_replay;

  if not exact_replay then
    select * into save_row from public.tavern_saves
    where id=p_save_id and user_id=auth.uid() for update;
    if found then closing_day:=save_row.current_day; end if;
  end if;

  if exact_replay then
    return private.advance_tavern_day_before_generated_supplies(p_save_id,p_action_id,p_expected_revision);
  end if;

  -- Resolve inside the same close transaction before its settlement snapshot
  -- is frozen. Any later predecessor rejection rolls these rows back too.
  if closing_day is not null then
    for quest_row in
      select id from private.world_quests
      where save_id=save_row.id and state='active' and activated_day<=closing_day
      order by instance_id, created_at, id
      for update
    loop
      event_row := private.world_resolve_quest_step(quest_row.id,closing_day,null);
      select state into final_state from private.world_quests where id=quest_row.id;
      pending_transition := final_state in ('succeeded','failed','abandoned') and exists(
        select 1 from private.world_quest_transitions
        where terminal_event_id=event_row.id and status='awaiting'
      );
      lifecycle := lifecycle || jsonb_build_array(jsonb_build_object(
        'questId',event_row.quest_id,'outcome',event_row.outcome,'state',final_state,
        'terminal',final_state in ('succeeded','failed','abandoned'),'pendingTransition',pending_transition
      ));
    end loop;
  end if;

  -- Resolve canonical quest events before the predecessor freezes the
  -- overnight settlement snapshot.  Any predecessor rejection still rolls
  -- back these rows with the surrounding transaction, while accepted closes
  -- can include the authoritative outcome in the same morning digest.
  v_result := private.advance_tavern_day_before_generated_supplies(p_save_id,p_action_id,p_expected_revision);

  update private.world_generated_supply_stock stock
  set remaining_quantity=definition.daily_stock,updated_at=clock_timestamp()
  from private.world_generated_supply_definitions definition
  join private.world_canonical_entities entity on entity.id=definition.canonical_entity_id
  where stock.canonical_entity_id=definition.canonical_entity_id and stock.save_id=p_save_id
    and definition.save_id=p_save_id and entity.lifecycle='active';

  v_result := v_result || jsonb_build_object('questLifecycle',lifecycle);
  update public.craft_actions set result=v_result
  where save_id=p_save_id and action_id=p_action_id and command_kind='advance_day';
  return v_result;
end $function$;

revoke all on function public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
revoke all on function private.world_quest_hospitality(uuid,integer),private.world_quest_readiness(integer,integer),private.world_quest_chance(integer,integer,integer),private.world_resolve_quest_step(uuid,integer,integer) from public,anon,authenticated;
grant execute on function private.world_resolve_quest_step(uuid,integer,integer) to service_role;
commit;
