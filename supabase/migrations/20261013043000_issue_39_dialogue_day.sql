-- Issue #39 admission/commit fence and single-RPC day boundary.
begin;

alter table private.world_npc_dialogue_turns add column if not exists daily_card_id uuid;
create index if not exists world_npc_dialogue_turns_daily_card_idx
  on private.world_npc_dialogue_turns(save_id,daily_card_id) where daily_card_id is not null;

-- The old day command remains responsible for its existing receipt, gold, and world effects.
alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_issue39;
alter function public.advance_tavern_day_before_issue39(uuid,uuid,bigint) set schema private;
revoke all on function private.advance_tavern_day_before_issue39(uuid,uuid,bigint) from public,anon,authenticated;

create or replace function private.daily_deck_prepare(p_save_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves%rowtype; d public.daily_decks%rowtype;
begin
  select * into s from public.tavern_saves where id=p_save_id for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  -- Materialize additions before closing their ledger rows.  Removed source cards
  -- remain immutable history; their physical copy is simply permanently consumed.
  if exists(select 1 from public.daily_decks where save_id=s.id and day_number=s.current_day and phase<>'preparation') then return; end if;
  insert into public.intent_cards(save_id,card_key,tier,source_kind,source_key)
  select s.id,x.card_key,'fine','seed','issue39-seed-'||x.id::text
  from public.daily_deck_changes x
  where x.save_id=s.id and x.applied_at is null and x.effective_day<=s.current_day
    and x.change_kind='add_social'
  on conflict(save_id,source_kind,source_key) do nothing;
  update public.daily_deck_cards c set pile='consumed',updated_at=now()
  from public.daily_deck_changes x
  where x.save_id=s.id and x.change_kind='remove_social' and x.card_id=c.id
    and x.applied_at is null and x.effective_day<=s.current_day and c.save_id=s.id;
  update public.daily_deck_changes set applied_at=now()
  where save_id=s.id and applied_at is null and effective_day<=s.current_day;
  select * into d from public.daily_decks where save_id=s.id and day_number=s.current_day for update;
  if not found then
    insert into public.daily_decks(save_id,day_number,phase,guest_ids)
    values(s.id,s.current_day,'preparation',coalesce(array(select id from private.world_npc_instances where save_id=s.id and status='active'),'{}')) returning * into d;
  end if;
  update public.daily_decks set guest_ids=coalesce(array(select id from private.world_npc_instances where save_id=s.id and status='active' order by id),'{}') where id=d.id;
  update public.daily_deck_cards set pile='discard',updated_at=now()
  where save_id=s.id and deck_id<>d.id and pile='hand';
  update public.daily_deck_cards set deck_id=d.id,pile='draw',position=null,updated_at=now()
  where save_id=s.id and pile in ('draw','discard');
  insert into public.daily_deck_cards(save_id,deck_id,source_kind,source_id)
  select s.id,d.id,'social',i.id from public.intent_cards i
  where i.save_id=s.id and i.card_key in ('charm','insight','rumor')
    and not exists(select 1 from public.daily_deck_cards old where old.save_id=s.id and old.source_kind='social' and old.source_id=i.id and old.pile='consumed')
  on conflict(save_id,source_kind,source_id) do update set deck_id=excluded.deck_id,pile='draw',position=null,updated_at=now()
    where public.daily_deck_cards.pile<>'consumed';
  insert into public.daily_deck_cards(save_id,deck_id,source_kind,source_id)
  select s.id,d.id,'food',f.id from public.foods f
  where f.save_id=s.id and not exists(select 1 from private.world_npc_hospitality_events e where e.save_id=s.id and e.food_id=f.id)
  on conflict(save_id,source_kind,source_id) do update set deck_id=excluded.deck_id,pile='draw',position=null,updated_at=now()
    where public.daily_deck_cards.pile<>'consumed';
  insert into public.daily_deck_cards(save_id,deck_id,source_kind,source_id)
  select s.id,d.id,'beverage',b.id from public.beverages b
  where b.save_id=s.id and not exists(select 1 from private.world_npc_hospitality_events e where e.save_id=s.id and e.beverage_id=b.id)
  on conflict(save_id,source_kind,source_id) do update set deck_id=excluded.deck_id,pile='draw',position=null,updated_at=now()
    where public.daily_deck_cards.pile<>'consumed';
end $$;
revoke all on function private.daily_deck_prepare(uuid) from public,anon,authenticated;

create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves%rowtype; d public.daily_decks%rowtype; prior public.craft_actions%rowtype; v_result jsonb;
begin
  -- The predecessor checks/replays craft_actions before its revision guard.
  select * into s from public.tavern_saves where id=p_save_id and user_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into prior from public.craft_actions where save_id=s.id and action_id=p_action_id;
  if found then
    if prior.command_kind='advance_day' and prior.input_expected_revision=p_expected_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier already used';
  end if;
  select * into d from public.daily_decks where save_id=s.id and day_number=s.current_day for update;
  if found and d.phase='service' then
    update public.daily_deck_cards set pile='discard',updated_at=now()
      where deck_id=d.id and pile='hand';
    update public.daily_decks set phase='closed',closed_at=now() where id=d.id;
  end if;
  v_result:=private.advance_tavern_day_before_issue39(p_save_id,p_action_id,p_expected_revision);
  perform private.daily_deck_prepare(p_save_id);
  v_result:=v_result || jsonb_build_object('dailyDeck',private.daily_deck_payload(p_save_id));
  update public.craft_actions receipt set result=v_result where receipt.save_id=p_save_id and receipt.action_id=p_action_id;
  return v_result;
end $$;
revoke all on function public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;

alter function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid)
  rename to npc_dialogue_begin_before_issue39;
alter function public.npc_dialogue_begin_before_issue39(uuid,uuid,uuid,text,bigint,uuid,text,uuid) set schema private;
revoke all on function private.npc_dialogue_begin_before_issue39(uuid,uuid,uuid,text,bigint,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.npc_dialogue_begin(
  p_actor uuid,p_turn_id uuid,p_npc_id uuid,p_message text,p_expected_sequence bigint,
  p_intent_card_id uuid default null,p_offering_kind text default null,p_offering_item_id uuid default null,
  p_daily_card_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; s public.tavern_saves%rowtype; c public.daily_deck_cards%rowtype;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into s from public.tavern_saves where user_id=p_actor order by updated_at desc limit 1;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  -- Existing completed/processing turns retain the predecessor's idempotent semantics.
  if exists(select 1 from private.world_npc_dialogue_turns where id=p_turn_id and save_id=s.id) then
    if not exists(select 1 from private.world_npc_dialogue_turns where id=p_turn_id and save_id=s.id and daily_card_id is not distinct from p_daily_card_id) then raise sqlstate 'PT409' using message='Dialogue retry must use the same daily card'; end if;
    if p_intent_card_id is not null and not exists(select 1 from public.daily_deck_cards where id=p_daily_card_id and source_kind='social' and source_id=p_intent_card_id) then raise sqlstate 'PT409' using message='Daily social card does not match the requested copy'; end if;
    return private.npc_dialogue_begin_before_issue39(p_actor,p_turn_id,p_npc_id,p_message,p_expected_sequence,null,p_offering_kind,p_offering_item_id);
  end if;
  if p_daily_card_id is null then raise sqlstate 'PT409' using message='A drawn daily card is required'; end if;
  c:=private.daily_deck_admit(s.id,p_daily_card_id);
  if c.source_kind='social' then
    if p_intent_card_id is not null and p_intent_card_id is distinct from c.source_id then raise sqlstate 'PT409' using message='Daily social card does not match the requested copy'; end if;
    if p_offering_kind is not null or p_offering_item_id is not null then raise sqlstate 'PT400' using message='Social card cannot include an offering'; end if;
    -- Legacy intent play history is permanent; the daily copy is the consumable now.
    result:=private.npc_dialogue_begin_before_issue39(p_actor,p_turn_id,p_npc_id,p_message,p_expected_sequence,null,null,null);
  else
    if p_intent_card_id is not null or p_offering_kind is distinct from c.source_kind or p_offering_item_id is distinct from c.source_id then
      raise sqlstate 'PT409' using message='Daily serving card does not match the requested item';
    end if;
    result:=private.npc_dialogue_begin_before_issue39(p_actor,p_turn_id,p_npc_id,p_message,p_expected_sequence,null,p_offering_kind,p_offering_item_id);
  end if;
  update private.world_npc_dialogue_turns set daily_card_id=p_daily_card_id where id=p_turn_id and save_id=s.id;
  return result || jsonb_build_object('dailyCardId',p_daily_card_id);
end $$;
revoke all on function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid,uuid) to service_role;

alter function public.npc_dialogue_complete(uuid,uuid,uuid) rename to npc_dialogue_complete_before_issue39;
alter function public.npc_dialogue_complete_before_issue39(uuid,uuid,uuid) set schema private;
revoke all on function private.npc_dialogue_complete_before_issue39(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.npc_dialogue_complete(p_actor uuid,p_turn_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.world_npc_dialogue_turns%rowtype; v_result jsonb;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id for update;
  if not found then raise sqlstate 'PT404' using message='Dialogue turn not found'; end if;
  if t.status='completed' then return private.npc_dialogue_complete_before_issue39(p_actor,p_turn_id,p_fence); end if;
  if t.daily_card_id is null then raise sqlstate 'PT409' using message='Dialogue turn has no daily card'; end if;
  v_result:=private.npc_dialogue_complete_before_issue39(p_actor,p_turn_id,p_fence);
  perform private.daily_deck_commit(t.save_id,t.daily_card_id);
  v_result:=v_result || jsonb_build_object('dailyCardId',t.daily_card_id);
  update private.world_npc_dialogue_turns set result=v_result where id=t.id;
  return v_result;
end $$;
revoke all on function public.npc_dialogue_complete(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.npc_dialogue_complete(uuid,uuid,uuid) to service_role;

-- Direct legacy hospitality skipped the NPC dialogue transaction and the hand.
-- Every serving exchange now goes through npc_dialogue_begin/complete.
create or replace function public.npc_serve_hospitality(
 p_save_id uuid,p_instance_id uuid,p_item_kind text,p_item_id uuid,p_action_id uuid,p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise sqlstate 'PT409' using message='Serving requires a drawn daily card and dialogue exchange';
end $$;

commit;
