begin;
-- Frozen v4 artifacts are versioned checkpoints, while all other stage names
-- remain closed. This keeps stale/fence behavior in the mature RPC unchanged.
create or replace function public.npc_dialogue_checkpoint(p_actor uuid,p_turn_id uuid,p_fence uuid,p_stage text,p_value jsonb default null)
returns void language plpgsql security definer set search_path='' as $f$
declare t private.world_npc_dialogue_turns;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor for update;
  if not found or t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Dialogue attempt expired'; end if;
  if p_stage='reserve' then
    if t.calls>=8 then raise sqlstate 'PT429' using message='Dialogue call budget reached'; end if;
    update private.world_npc_dialogue_turns set calls=calls+1 where id=t.id;
    update private.world_npc_dialogue_attempts set calls=calls+1 where fence=p_fence;
  elsif p_stage='fail' then
    update private.world_npc_dialogue_turns set status='failed',error_code=case when p_value->>'code' in ('BUDGET','CONSISTENCY','STRUCTURE','PROVIDER_FAILED','CONTEXT_BUDGET') then p_value->>'code' else 'GENERATION_FAILED' end where id=t.id;
    update private.world_npc_dialogue_attempts set status='failed',finished_at=now(),error_code=(select error_code from private.world_npc_dialogue_turns where id=t.id) where fence=p_fence;
  elsif p_stage in ('base','memory','context0','context1','investigate0','investigate1','deliberate','decision','speak','review','rewrite','rereview','remember','frozen_context') or p_stage ~ '^frozen_context:[0-9]+$' then
    update private.world_npc_dialogue_turns set checkpoints=jsonb_set(checkpoints,array[p_stage],coalesce(p_value,'null'::jsonb),true) where id=t.id;
  else raise sqlstate 'PT400' using message='Unknown dialogue stage'; end if;
end $f$;

-- Quest-transition opening can be a no-op when no transition is due. A
-- terminal settlement must nevertheless release the gameplay phase.
create or replace function private.world_settlement_finalize_deadline(p_settlement_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare s private.world_settlements; receipt jsonb;
begin
 select * into s from private.world_settlements where id=p_settlement_id for update;
 if not found then raise sqlstate 'PT404'; end if;
 if s.status in ('completed','failed','skipped','expired') then return s.terminal_receipt; end if;
 if s.deadline_at>clock_timestamp() then return null; end if;
 update private.world_settlement_attempts set status='expired',failure_code='DEADLINE_EXPIRED',finished_at=clock_timestamp() where job_id in(select id from private.world_settlement_jobs where settlement_id=s.id) and status='processing';
 update private.world_settlement_jobs set status='skipped',failure_code='DEADLINE_NOOP',completed_at=clock_timestamp() where settlement_id=s.id and status not in('completed','skipped');
 receipt:=jsonb_build_object('settlementId',s.id,'status','expired','publicSummary','The day settled without new world changes.');
  update private.world_settlements set status='expired',fence=null,lease_until=null,failure_code='DEADLINE_EXPIRED',skip_reason='deadline_noop',terminal_receipt=receipt,completed_at=clock_timestamp() where id=s.id;
  insert into private.world_settlement_outbox(settlement_id,event_key,payload) values(s.id,'deadline_noop',jsonb_build_object('summary','The day settled without new world changes.')) on conflict do nothing;
  -- A live transition lease remains authoritative and keeps the save settling.
  -- Only work with no live owner is explicitly deferred for a later opening.
  update private.world_quest_transitions
     set status='awaiting',fence=null,lease_until=null,next_eligible_day=greatest(next_eligible_day,(select current_day+1 from public.tavern_saves where id=s.save_id))
   where save_id=s.save_id and next_eligible_day<=(select current_day from public.tavern_saves where id=s.save_id)
     and (status='awaiting' or (status='processing' and lease_until<=clock_timestamp()));
  perform private.world_quest_transition_maybe_open(s.save_id);
  return receipt;
end $f$;

commit;
