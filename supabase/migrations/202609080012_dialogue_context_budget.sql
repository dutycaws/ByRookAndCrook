-- Persist bounded-context failures and expose their cancellation recovery path.
begin;
create or replace function public.dialogue_checkpoint(p_actor uuid,p_turn uuid,p_fence uuid,p_stage text,p_value jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.dialogue_turns; n integer; rules private.npc_rules;
begin
  perform 1 from public.tavern_saves where user_id=p_actor for update;
  select * into t from public.dialogue_turns where id=p_turn and actor_id=p_actor for update;
  if not found or t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Conversation attempt expired'; end if;
  if p_stage='reserve' then
    insert into private.npc_usage(actor_id,day) values(p_actor,(now() at time zone 'UTC')::date) on conflict do nothing;
    select calls into n from private.npc_usage where actor_id=p_actor and day=(now() at time zone 'UTC')::date;
    select * into rules from private.npc_rules where version=t.rule_version;
    if t.calls>=rules.calls_per_turn or n>=rules.calls_per_day then raise sqlstate 'PT429' using message='Conversation generation budget reached'; end if;
    update private.npc_usage set calls=calls+1 where actor_id=p_actor and day=(now() at time zone 'UTC')::date;
    update public.dialogue_turns set calls=calls+1 where id=p_turn;
    update private.npc_attempts set calls=calls+1 where fence=p_fence;
  elsif p_stage='fail' then
    update public.dialogue_turns set status='failed',error_code=case when p_value->>'code' in ('BUDGET','CONSISTENCY','STRUCTURE','PT429','PROVIDER_FAILED','CONTEXT_BUDGET') then p_value->>'code' else 'GENERATION_FAILED' end where id=p_turn;
    update private.npc_attempts set status='failed',finished_at=now(),error_code=(select error_code from public.dialogue_turns where id=p_turn) where fence=p_fence;
  elsif p_stage in ('base','context0','context1','investigate0','investigate1','deliberate','decision','speak','review','rewrite','rereview','remember') then
    update public.dialogue_turns set checkpoints=jsonb_set(checkpoints,array[p_stage],p_value,true) where id=p_turn;
  else raise sqlstate 'PT400' using message='Unknown stage'; end if;
end; $$;

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
    'canRetry',state='failed' and coalesce(t.error_code not in ('CONSISTENCY','CONTEXT_BUDGET'),true) and (t.calls<call_limit or (
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
