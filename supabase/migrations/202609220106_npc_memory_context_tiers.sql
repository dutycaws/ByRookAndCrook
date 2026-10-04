-- Issue #33: transition evidence is an independently budgeted attachment.
begin;
create or replace function public.world_quest_transition_checkpoint(p_transition_id uuid,p_fence uuid,p_stage text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare t private.world_quest_transitions; c private.world_quest_transition_checkpoints;
begin
  perform private.world_settlement_assert_service();
  if p_stage not in ('memory_context','proposer','critic','repair','final_critic') or jsonb_typeof(p_payload)<>'object'
     or octet_length(p_payload::text) > (case when p_stage='memory_context' then 524288 else 16384 end) then
    raise sqlstate 'PT400' using message='Quest transition checkpoint is invalid';
  end if;
  t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  insert into private.world_quest_transition_checkpoints(transition_id,fence,stage,payload)
  values(t.id,p_fence,p_stage,p_payload) returning * into c;
  return jsonb_build_object('checkpointId',c.id,'stage',c.stage,'payload',c.payload);
exception when unique_violation then
  select * into c from private.world_quest_transition_checkpoints where transition_id=p_transition_id and fence=p_fence and stage=p_stage;
  if c.payload<>p_payload then raise sqlstate 'PT409' using message='Quest transition checkpoint replay differs'; end if;
  return jsonb_build_object('checkpointId',c.id,'stage',c.stage,'payload',c.payload);
end $f$;
commit;
