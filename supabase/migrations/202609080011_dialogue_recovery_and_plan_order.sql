-- Guard every quest write, including trusted completion and authored initialization.
-- Existing invalid plans are rejected rather than silently rewritten.
begin;
create function private.npc_steps_executable(p_intention jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare steps jsonb:=p_intention->'steps';
begin
  if jsonb_typeof(steps) is distinct from 'array' then return false; end if;
  if jsonb_array_length(steps) not between 1 and 3 then return false; end if;
  return coalesce(steps->-1->>'action' in ('attempt','abandon'),false)
    and not exists(select 1 from jsonb_array_elements(steps) with ordinality s(value,n)
      where not coalesce(value->>'approach' in ('scouting','combat','diplomacy','trade'),false)
        or (n<jsonb_array_length(steps) and not coalesce(value->>'action' in ('prepare','wait'),false)));
end; $$;
revoke all on function private.npc_steps_executable(jsonb) from public,anon,authenticated;

alter table private.npc_quests add constraint npc_quests_executable_steps check(private.npc_steps_executable(intention));
create function private.guard_npc_steps() returns trigger language plpgsql set search_path='' as $$
begin
  if not private.npc_steps_executable(new.intention) then
    raise sqlstate 'PT400' using message='Only the final daily step may attempt or abandon the objective';
  end if;
  return new;
end; $$;
revoke all on function private.guard_npc_steps() from public,anon,authenticated;
create trigger npc_quests_guard_steps before insert or update of intention on private.npc_quests
for each row execute function private.guard_npc_steps();

-- Recovery reports whether the saved checkpoints still permit another attempt.
-- A rejected rewrite is final for this turn; replaying it cannot repair the prose.
create or replace function public.dialogue_status(p_turn uuid,p_cancel boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.dialogue_turns; state text; call_limit integer;
begin
  perform 1 from public.tavern_saves where user_id=auth.uid() for update;
  select * into t from public.dialogue_turns where id=p_turn and actor_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  if p_cancel and t.status<>'completed' then
    update private.npc_attempts set status='cancelled',finished_at=now() where turn_id=t.id and status='processing';
    update public.dialogue_turns set status='cancelled',fence=extensions.gen_random_uuid() where id=t.id returning * into t;
  end if;
  state:=case when t.status='processing' and t.lease_until<now() then 'failed' else t.status end;
  select calls_per_turn into call_limit from private.npc_rules where version=t.rule_version;
  return jsonb_build_object('status',state,'result',t.result,'error',t.error_code,
    'canRetry',state='failed' and coalesce(t.error_code<>'CONSISTENCY',true) and (t.calls<call_limit or (
      -- All eight calls may have finished before the completion response was lost.
      coalesce((coalesce(t.checkpoints->'rereview',t.checkpoints->'review')->'value'->>'ok')::boolean,false)
      and (t.checkpoints ? 'remember' or not (
        coalesce((t.checkpoints->'investigate0'->'value'->>'remember')::boolean,false)
        or coalesce((t.checkpoints->'investigate1'->'value'->>'remember')::boolean,false)
        or coalesce(t.checkpoints->'decision'->'value'->>'reaction','0')<>'0'
        or nullif(t.checkpoints->'decision'->'value'->'intention','null'::jsonb) is not null
      ))
    )),
    'input',jsonb_build_object('turnId',t.id,'patronKey',t.patron_key,'message',t.message,'expectedConversationSequence',t.input_sequence,'beverageId',t.beverage_id,'cardId',t.card_id));
end; $$;
commit;
