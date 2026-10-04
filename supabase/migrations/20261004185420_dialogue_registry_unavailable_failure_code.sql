begin;

-- Registry outages happen after a turn is claimed, so this checkpoint must
-- persist the specific retryable failure instead of falling back to
-- GENERATION_FAILED.
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
    update private.world_npc_dialogue_turns set status='failed',error_code=case when p_value->>'code' in ('BUDGET','CONSISTENCY','STRUCTURE','PROVIDER_FAILED','CONTEXT_BUDGET','REGISTRY_UNAVAILABLE') then p_value->>'code' else 'GENERATION_FAILED' end where id=t.id;
    update private.world_npc_dialogue_attempts set status='failed',finished_at=now(),error_code=(select error_code from private.world_npc_dialogue_turns where id=t.id) where fence=p_fence;
  elsif p_stage in ('base','memory','context0','context1','investigate0','investigate1','deliberate','decision','speak','review','rewrite','rereview','remember','frozen_context') or p_stage ~ '^frozen_context:[0-9]+$' then
    update private.world_npc_dialogue_turns set checkpoints=jsonb_set(checkpoints,array[p_stage],coalesce(p_value,'null'::jsonb),true) where id=t.id;
  else raise sqlstate 'PT400' using message='Unknown dialogue stage'; end if;
end $f$;

commit;
