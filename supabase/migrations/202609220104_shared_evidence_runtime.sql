-- Issue #33 checkpoint 5: one frozen evidence artifact for transition retries.
begin;

alter table private.world_quest_transitions
  add column if not exists memory_cutoff_ledger_sequence bigint not null default -1 check(memory_cutoff_ledger_sequence >= -1);
update private.world_quest_transitions transition
set memory_cutoff_ledger_sequence=coalesce((select max(source.ledger_sequence) from private.world_npc_memory_sources source
  where source.instance_id=transition.instance_id and source.source_kind='quest_event' and source.source_id=transition.terminal_event_id),-1)
where memory_cutoff_ledger_sequence=-1;

create or replace function private.world_quest_transition_memory_cutoff()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if tg_op='INSERT' then
    -- Transition creation can race source-trigger ordering in the terminal
    -- resolver. Register idempotently here so the durable cutoff is always
    -- the terminal event's actual ledger sequence, never a worker-time max.
    perform private.world_npc_memory_register_source('quest_event',new.terminal_event_id);
    select coalesce(max(source.ledger_sequence),-1) into new.memory_cutoff_ledger_sequence
    from private.world_npc_memory_sources source
    where source.instance_id=new.instance_id and source.source_kind='quest_event' and source.source_id=new.terminal_event_id;
  elsif new.memory_cutoff_ledger_sequence<>old.memory_cutoff_ledger_sequence then
    raise exception using errcode='55000',message='Quest transition memory cutoff is immutable';
  end if;
  return new;
end $f$;
drop trigger if exists world_quest_transition_memory_cutoff on private.world_quest_transitions;
create trigger world_quest_transition_memory_cutoff before insert or update on private.world_quest_transitions
for each row execute function private.world_quest_transition_memory_cutoff();

alter table private.world_quest_transition_checkpoints
  drop constraint if exists world_quest_transition_checkpoints_stage_check;
alter table private.world_quest_transition_checkpoints
  add constraint world_quest_transition_checkpoints_stage_check
  check(stage in ('memory_context','proposer','critic','repair','final_critic'));

create or replace function public.world_quest_transition_checkpoint(p_transition_id uuid,p_fence uuid,p_stage text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare t private.world_quest_transitions; c private.world_quest_transition_checkpoints;
begin
  perform private.world_settlement_assert_service();
  if p_stage not in ('memory_context','proposer','critic','repair','final_critic') or jsonb_typeof(p_payload)<>'object'
     or octet_length(p_payload::text) > (case when p_stage='memory_context' then 65536 else 16384 end) then
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

create or replace function public.world_quest_transition_memory_scope(p_transition_id uuid,p_fence uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare t private.world_quest_transitions; actor uuid; cutoff bigint;
begin
  perform private.world_settlement_assert_service();
  t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  select user_id into actor from public.tavern_saves where id=t.save_id;
  cutoff:=t.memory_cutoff_ledger_sequence;
  return jsonb_build_object('actorId',actor,'instanceId',t.instance_id,'cutoffLedgerSequence',cutoff);
end $f$;

revoke all on function public.world_quest_transition_memory_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.world_quest_transition_memory_scope(uuid,uuid) to service_role;
commit;
