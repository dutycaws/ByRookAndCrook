-- Separate player-selected dialogue intent from inventory-backed hospitality.
-- Legacy Pour Ale cards and serving receipts remain readable under their v1 meaning.
begin;

create table public.intent_card_catalog (
  card_key text not null,
  version text not null,
  display_name text not null,
  description text not null,
  prompt_instruction text not null,
  primary key (card_key, version),
  check (card_key in ('charm', 'insight', 'resolve', 'rumor')),
  check (version = 'intent-v1')
);

insert into public.intent_card_catalog values
  ('charm', 'intent-v1', 'Charm',
    'Frame the keeper’s words with warmth and personal appeal.',
    'The keeper deliberately chose a warm, personable approach. Treat it as an attempt, never guaranteed agreement.'),
  ('insight', 'intent-v1', 'Insight',
    'Ask with patience and close attention to what the patron knows.',
    'The keeper deliberately chose a curious, perceptive approach. It cannot unlock private or unknown facts.'),
  ('resolve', 'intent-v1', 'Resolve',
    'Speak plainly and stand firmly behind the proposed course.',
    'The keeper deliberately chose a firm, direct approach. It does not compel the patron to agree.'),
  ('rumor', 'intent-v1', 'Rumor',
    'Present the message as tavern hearsay that still needs verification.',
    'The keeper deliberately framed this as a rumor. Treat every factual claim as unverified hearsay.');

create table public.intent_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  card_key text not null,
  catalog_version text not null default 'intent-v1',
  tier text not null check (tier in ('fine', 'superior', 'exceptional')),
  source_kind text not null check (source_kind in ('starter', 'brew', 'bake')),
  source_key text not null,
  source_beverage_id uuid,
  created_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, source_kind, source_key),
  foreign key (card_key, catalog_version)
    references public.intent_card_catalog(card_key, version),
  foreign key (save_id, source_beverage_id)
    references public.beverages(save_id, id),
  check ((source_kind = 'brew') = (source_beverage_id is not null))
);

-- Food inventory is established here so every hospitality receipt can use real,
-- typed foreign keys. Bakery adds production/session provenance in the next slice.
create table public.foods (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  name text not null,
  recipe_key text not null,
  quality_index smallint not null check (quality_index between 0 and 6),
  day_number integer not null check (day_number > 0),
  source_action_id uuid not null,
  created_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, source_action_id)
);

create table public.intent_card_plays (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  turn_id uuid not null references public.dialogue_turns(id) on delete cascade,
  actor_id uuid not null,
  patron_key text not null references public.patron_catalog(patron_key),
  card_id uuid not null,
  day_number integer not null check (day_number > 0),
  card_key text not null,
  tier text not null check (tier in ('fine', 'superior', 'exceptional')),
  created_at timestamptz not null default now(),
  primary key (save_id, turn_id),
  unique (save_id, card_id),
  foreign key (save_id, actor_id)
    references public.tavern_saves(id, user_id) on delete cascade,
  foreign key (save_id, card_id)
    references public.intent_cards(save_id, id)
);

-- This is the canonical item-consumption ledger for both standalone hospitality
-- and dialogue-linked offerings. It also retains the exact immutable receipt.
create table public.hospitality_events (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null,
  patron_key text not null references public.patron_catalog(patron_key),
  item_kind text not null check (item_kind in ('beverage', 'food')),
  beverage_id uuid,
  food_id uuid,
  legacy_card_id uuid,
  turn_id uuid references public.dialogue_turns(id) on delete cascade,
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  day_number integer not null check (day_number > 0),
  item_name text not null,
  quality_index smallint not null check (quality_index between 0 and 6),
  gold_earned integer not null check (gold_earned > 0),
  relationship_change integer not null,
  result jsonb not null,
  rules_version text not null check (rules_version in ('serving-v1', 'hospitality-v2')),
  committed_revision bigint not null check (committed_revision > 0),
  created_at timestamptz not null default now(),
  primary key (save_id, action_id),
  foreign key (save_id, actor_id)
    references public.tavern_saves(id, user_id) on delete cascade,
  foreign key (save_id, beverage_id)
    references public.beverages(save_id, id),
  foreign key (save_id, food_id)
    references public.foods(save_id, id),
  foreign key (save_id, legacy_card_id)
    references public.social_cards(save_id, id),
  check (
    (item_kind = 'beverage' and beverage_id is not null and food_id is null)
    or (item_kind = 'food' and food_id is not null and beverage_id is null)
  ),
  check (legacy_card_id is null or item_kind = 'beverage')
);

create unique index hospitality_beverage_once
  on public.hospitality_events(save_id, beverage_id) where beverage_id is not null;
create unique index hospitality_food_once
  on public.hospitality_events(save_id, food_id) where food_id is not null;
create unique index hospitality_legacy_card_once
  on public.hospitality_events(save_id, legacy_card_id) where legacy_card_id is not null;
create unique index hospitality_dialogue_once
  on public.hospitality_events(save_id, turn_id) where turn_id is not null;
create index hospitality_actor_idx on public.hospitality_events(actor_id);
create index hospitality_patron_day_idx on public.hospitality_events(save_id, patron_key, day_number);

-- Preserve v1 result JSON byte-for-byte while making its consumed inventory
-- visible to every v2 availability predicate.
insert into public.hospitality_events (
  save_id, action_id, actor_id, patron_key, item_kind, beverage_id,
  legacy_card_id, input_expected_revision, day_number, item_name,
  quality_index, gold_earned, relationship_change, result, rules_version,
  committed_revision, created_at
)
select e.save_id, e.action_id, e.actor_id, e.patron_key, 'beverage', e.beverage_id,
  e.card_id, e.input_expected_revision, e.day_number,
  coalesce(e.result->>'beverageName', b.name), b.quality_index,
  e.gold_earned, e.relationship_change, e.result, 'serving-v1',
  e.committed_revision, e.created_at
from public.serving_events e
join public.beverages b on b.save_id = e.save_id and b.id = e.beverage_id
on conflict (save_id, action_id) do nothing;

alter table public.intent_card_catalog enable row level security;
alter table public.intent_cards enable row level security;
alter table public.foods enable row level security;
alter table public.intent_card_plays enable row level security;
alter table public.hospitality_events enable row level security;

create policy intent_catalog_read on public.intent_card_catalog
  for select to authenticated using (true);
create policy intent_cards_read_own on public.intent_cards
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s
    where s.id = intent_cards.save_id and s.user_id = (select auth.uid())
  ));
create policy foods_read_own on public.foods
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s
    where s.id = foods.save_id and s.user_id = (select auth.uid())
  ));
create policy intent_card_plays_read_own on public.intent_card_plays
  for select to authenticated using (actor_id = (select auth.uid()));
create policy hospitality_events_read_own on public.hospitality_events
  for select to authenticated using (actor_id = (select auth.uid()));

revoke all on public.intent_card_catalog, public.intent_cards, public.foods,
  public.intent_card_plays, public.hospitality_events from public, anon, authenticated;
grant select on public.intent_card_catalog, public.intent_cards, public.foods,
  public.intent_card_plays, public.hospitality_events to authenticated;
grant all on public.intent_card_catalog, public.intent_cards, public.foods,
  public.intent_card_plays, public.hospitality_events to service_role;

create function private.ensure_intent_cards(p_save uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.intent_cards
    (save_id, card_key, tier, source_kind, source_key)
  values
    (p_save, 'charm', 'fine', 'starter', 'starter-charm'),
    (p_save, 'insight', 'fine', 'starter', 'starter-insight'),
    (p_save, 'resolve', 'fine', 'starter', 'starter-resolve'),
    (p_save, 'rumor', 'fine', 'starter', 'starter-rumor')
  on conflict (save_id, source_kind, source_key) do nothing;
$$;
revoke all on function private.ensure_intent_cards(uuid) from public, anon, authenticated;

do $$ declare s record; begin
  for s in select id from public.tavern_saves loop
    perform private.ensure_intent_cards(s.id);
  end loop;
end $$;

alter function public.create_tavern() rename to create_tavern_before_interactions_v2;
alter function public.create_tavern_before_interactions_v2() set schema private;
revoke all on function private.create_tavern_before_interactions_v2() from public, anon, authenticated;
create function public.create_tavern()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := private.create_tavern_before_interactions_v2();
  perform private.ensure_intent_cards((result->>'saveId')::uuid);
  return result;
end;
$$;
revoke all on function public.create_tavern() from public, anon;
grant execute on function public.create_tavern() to authenticated;

-- Keep old completed craft receipts stable. Only newly completed brews issue
-- v2 intent cards, and no new Pour Ale entitlement is retained.
alter function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  rename to complete_brew_before_intents_v2;
alter function public.complete_brew_before_intents_v2(uuid, uuid, uuid, bigint, integer, integer, integer)
  set schema private;
revoke all on function private.complete_brew_before_intents_v2(uuid, uuid, uuid, bigint, integer, integer, integer)
  from public, anon, authenticated;

create function public.complete_brew(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_perfect_ticks integer,
  p_good_ticks integer,
  p_total_ticks integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  v_result jsonb;
  old_card uuid;
  new_card uuid;
  quality integer;
  card_key text;
  tier text;
begin
  select a.result into prior
  from public.craft_actions a
  join public.tavern_saves s on s.id = a.save_id and s.user_id = auth.uid()
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then return prior; end if;

  v_result := private.complete_brew_before_intents_v2(
    p_save_id, p_session_id, p_action_id, p_expected_revision,
    p_perfect_ticks, p_good_ticks, p_total_ticks
  );
  quality := (v_result->>'qualityIndex')::integer;
  old_card := nullif(v_result->>'socialCardId', '')::uuid;
  if old_card is not null then
    delete from public.social_cards where save_id = p_save_id and id = old_card;
  end if;

  if quality >= 2 then
    card_key := case when quality >= 5 then 'resolve' when quality >= 4 then 'insight' else 'charm' end;
    tier := case when quality >= 5 then 'exceptional' when quality >= 4 then 'superior' else 'fine' end;
    insert into public.intent_cards
      (save_id, card_key, tier, source_kind, source_key, source_beverage_id)
    values
      (p_save_id, card_key, tier, 'brew', v_result->>'beverageId', (v_result->>'beverageId')::uuid)
    on conflict (save_id, source_kind, source_key) do update set source_key = excluded.source_key
    returning id into new_card;
  end if;

  v_result := (v_result - 'socialCardId') || jsonb_build_object(
    'intentCardId', new_card,
    'intentCardKey', card_key,
    'intentCardTier', tier,
    'rulesVersion', 'brew-v2'
  );
  update public.craft_actions set result = v_result
  where save_id = p_save_id and action_id = p_action_id;
  return v_result;
end;
$$;
revoke all on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  from public, anon;
grant execute on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  to authenticated;

create function private.apply_hospitality_v2(
  p_actor uuid,
  p_save_id uuid,
  p_patron_key text,
  p_item_kind text,
  p_item_id uuid,
  p_legacy_card_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_turn_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.tavern_saves;
  patron public.patron_catalog;
  patron_state public.patron_states;
  beverage public.beverages;
  food public.foods;
  legacy_card public.social_cards;
  prior public.hospitality_events;
  item_name text;
  quality integer;
  v_gold integer;
  v_relationship integer;
  v_story text;
  v_receipt jsonb;
begin
  if p_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_patron_key is null or p_item_kind not in ('beverage', 'food')
    or p_item_id is null or p_action_id is null or p_expected_revision is null
    or p_expected_revision < 0 or (p_legacy_card_id is not null and p_item_kind <> 'beverage') then
    raise sqlstate 'PT400' using message = 'Invalid hospitality request';
  end if;

  select * into s from public.tavern_saves
  where id = p_save_id and user_id = p_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;

  select * into prior from public.hospitality_events
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if prior.patron_key = p_patron_key and prior.item_kind = p_item_kind
      and coalesce(prior.beverage_id, prior.food_id) = p_item_id
      and prior.legacy_card_id is not distinct from p_legacy_card_id
      and prior.input_expected_revision = p_expected_revision
      and prior.turn_id is not distinct from p_turn_id then
      return prior.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if s.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; review the latest hospitality before serving';
  end if;
  if exists (
    select 1 from private.npc_lives
    where save_id = p_save_id and patron_key = p_patron_key and availability <> 'present'
  ) then raise sqlstate 'PT422' using message = 'This patron is not available'; end if;

  select * into patron from public.patron_catalog where patron_key = p_patron_key;
  if not found then raise sqlstate 'PT404' using message = 'Patron not found'; end if;

  if p_item_kind = 'beverage' then
    select * into beverage from public.beverages
    where save_id = p_save_id and id = p_item_id;
    if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
    if exists (select 1 from public.hospitality_events where save_id = p_save_id and beverage_id = p_item_id) then
      raise sqlstate 'PT409' using message = 'This beverage has already been served';
    end if;
    item_name := beverage.name;
    quality := beverage.quality_index;
  else
    select * into food from public.foods where save_id = p_save_id and id = p_item_id;
    if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
    if exists (select 1 from public.hospitality_events where save_id = p_save_id and food_id = p_item_id) then
      raise sqlstate 'PT409' using message = 'This food has already been served';
    end if;
    item_name := food.name;
    quality := food.quality_index;
  end if;

  if p_legacy_card_id is not null then
    select * into legacy_card from public.social_cards
    where save_id = p_save_id and id = p_legacy_card_id;
    if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
    if exists (
      select 1 from public.hospitality_events
      where save_id = p_save_id and legacy_card_id = p_legacy_card_id
    ) then raise sqlstate 'PT409' using message = 'This legacy Pour Ale card has already been used'; end if;
  end if;

  insert into public.patron_states (save_id, patron_key, relationship)
  values (p_save_id, p_patron_key, patron.initial_relationship) on conflict do nothing;
  select * into patron_state from public.patron_states
  where save_id = p_save_id and patron_key = p_patron_key for update;

  v_gold := round(patron.prices[quality + 1] * coalesce(legacy_card.gold_multiplier, 1))::integer;
  v_relationship := least(100, greatest(0,
    patron_state.relationship + coalesce(legacy_card.relationship_gain, 0)
    + case when quality >= 4 then 6 when quality >= 2 then 3 when quality = 1 then -2 else -4 end
  ));
  v_story := case when p_item_kind = 'food'
    then 'A shared plate shapes trust and tonight’s preparations. Quest actions occur after closing.'
    else 'A welcome drink shapes trust and tonight’s preparations. Quest actions occur after closing.' end;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'patronKey', p_patron_key,
    'patronName', patron.display_name,
    'itemKind', p_item_kind,
    'itemId', p_item_id,
    'itemName', item_name,
    'beverageId', case when p_item_kind = 'beverage' then p_item_id end,
    'beverageName', case when p_item_kind = 'beverage' then item_name end,
    'foodId', case when p_item_kind = 'food' then p_item_id end,
    'foodName', case when p_item_kind = 'food' then item_name end,
    'qualityIndex', quality,
    'cardId', p_legacy_card_id,
    'goldEarned', v_gold,
    'goldBalance', s.gold + v_gold,
    'relationshipChange', v_relationship - patron_state.relationship,
    'relationship', v_relationship,
    'arcChange', 0,
    'arcProgress', patron_state.arc_progress,
    'arcTotal', array_length(patron.arc_steps, 1),
    'storyEvent', v_story,
    'dayNumber', s.current_day,
    'committedRevision', s.revision + 1,
    'rulesVersion', 'hospitality-v2'
  );

  update public.patron_states set relationship = v_relationship, updated_at = now()
  where save_id = p_save_id and patron_key = p_patron_key;
  update public.tavern_saves set gold = gold + v_gold,
    revision = revision + 1, updated_at = now()
  where id = p_save_id;

  insert into public.hospitality_events (
    save_id, action_id, actor_id, patron_key, item_kind, beverage_id, food_id,
    legacy_card_id, turn_id, input_expected_revision, day_number, item_name,
    quality_index, gold_earned, relationship_change, result, rules_version,
    committed_revision
  ) values (
    p_save_id, p_action_id, p_actor, p_patron_key, p_item_kind,
    case when p_item_kind = 'beverage' then p_item_id end,
    case when p_item_kind = 'food' then p_item_id end,
    p_legacy_card_id, p_turn_id, p_expected_revision, s.current_day, item_name,
    quality, v_gold, v_relationship - patron_state.relationship, v_receipt,
    'hospitality-v2', s.revision + 1
  );
  return v_receipt;
end;
$$;
revoke all on function private.apply_hospitality_v2(uuid, uuid, text, text, uuid, uuid, uuid, bigint, uuid)
  from public, anon, authenticated;

create function public.serve_hospitality(
  p_save_id uuid,
  p_patron_key text,
  p_item_kind text,
  p_item_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_legacy_card_id uuid default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.apply_hospitality_v2(
    auth.uid(), p_save_id, p_patron_key, p_item_kind, p_item_id,
    p_legacy_card_id, p_action_id, p_expected_revision, null
  );
$$;
revoke all on function public.serve_hospitality(uuid, text, text, uuid, uuid, bigint, uuid)
  from public, anon;
grant execute on function public.serve_hospitality(uuid, text, text, uuid, uuid, bigint, uuid)
  to authenticated;

create or replace function public.serve_beverage(
  p_save_id uuid,
  p_patron_key text,
  p_beverage_id uuid,
  p_card_id uuid default null,
  p_action_id uuid default null,
  p_expected_revision bigint default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.apply_hospitality_v2(
    auth.uid(), p_save_id, p_patron_key, 'beverage', p_beverage_id,
    p_card_id, p_action_id, p_expected_revision, null
  );
$$;
revoke all on function public.serve_beverage(uuid, text, uuid, uuid, uuid, bigint)
  from public, anon;
grant execute on function public.serve_beverage(uuid, text, uuid, uuid, uuid, bigint)
  to authenticated;

create or replace function public.get_bar_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'save', jsonb_build_object(
      'id', s.id, 'revision', s.revision, 'gold', s.gold, 'currentDay', s.current_day
    ),
    'patrons', (select jsonb_agg(jsonb_build_object(
      'key', p.patron_key, 'name', p.display_name, 'title', p.title, 'icon', p.icon,
      'description', p.description, 'prices', p.prices, 'arcTitle', p.arc_title,
      'relationship', coalesce(ps.relationship, p.initial_relationship),
      'arcProgress', coalesce(ps.arc_progress, 0),
      'arcTotal', array_length(p.arc_steps, 1),
      'story', coalesce(p.arc_steps[ps.arc_progress], 'Their story is just beginning.')
    ) order by p.patron_key)
      from public.patron_catalog p
      left join public.patron_states ps on ps.save_id = s.id and ps.patron_key = p.patron_key),
    'beverages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'kind', 'beverage', 'name', b.name, 'qualityIndex', b.quality_index
    ) order by b.created_at desc, b.id)
      from public.beverages b where b.save_id = s.id and not exists (
        select 1 from public.hospitality_events e
        where e.save_id = s.id and e.beverage_id = b.id
      )), '[]'::jsonb),
    'foods', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'kind', 'food', 'name', f.name, 'qualityIndex', f.quality_index
    ) order by f.created_at desc, f.id)
      from public.foods f where f.save_id = s.id and not exists (
        select 1 from public.hospitality_events e
        where e.save_id = s.id and e.food_id = f.id
      )), '[]'::jsonb),
    'intentCards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'cardKey', c.card_key, 'displayName', catalog.display_name,
      'description', catalog.description, 'tier', c.tier
    ) order by c.created_at, c.id)
      from public.intent_cards c
      join public.intent_card_catalog catalog
        on catalog.card_key = c.card_key and catalog.version = c.catalog_version
      where c.save_id = s.id and not exists (
        select 1 from public.intent_card_plays play
        where play.save_id = s.id and play.card_id = c.id
      )), '[]'::jsonb),
    'legacyCards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'displayName', 'Legacy ' || c.display_name, 'tier', c.tier,
      'relationshipGain', c.relationship_gain, 'goldMultiplier', c.gold_multiplier
    ) order by c.created_at desc, c.id)
      from public.social_cards c where c.save_id = s.id and not exists (
        select 1 from public.hospitality_events e
        where e.save_id = s.id and e.legacy_card_id = c.id
      )), '[]'::jsonb),
    -- Compatibility alias for the old Bar until the v2 UI lands in this ticket.
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'displayName', 'Legacy ' || c.display_name, 'tier', c.tier,
      'relationshipGain', c.relationship_gain, 'goldMultiplier', c.gold_multiplier
    ) order by c.created_at desc, c.id)
      from public.social_cards c where c.save_id = s.id and not exists (
        select 1 from public.hospitality_events e
        where e.save_id = s.id and e.legacy_card_id = c.id
      )), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(recent.result order by recent.committed_revision desc)
      from (select e.result, e.committed_revision from public.hospitality_events e
        where e.save_id = s.id order by e.committed_revision desc limit 20) recent), '[]'::jsonb)
  )
  from public.tavern_saves s where s.user_id = auth.uid();
$$;
revoke all on function public.get_bar_snapshot() from public, anon;
grant execute on function public.get_bar_snapshot() to authenticated;

-- New and historical food/drink hospitality share the overnight modifier.
create or replace function private.npc_hospitality(p_save uuid, p_patron text, p_day integer)
returns integer language sql stable set search_path = '' as $$
  select greatest(-3, least(3, coalesce(sum(e.quality_index - 3), 0)))::integer
  from public.hospitality_events e
  where e.save_id = p_save and e.patron_key = p_patron and e.day_number = p_day;
$$;
revoke all on function private.npc_hospitality(uuid, text, integer)
  from public, anon, authenticated;

-- Augment the existing game snapshot without rewriting the stable garden and
-- brewery projection. Legacy socialCards remain present as production history.
alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_interactions_v2;
alter function public.get_tavern_snapshot_before_interactions_v2() set schema private;
revoke all on function private.get_tavern_snapshot_before_interactions_v2()
  from public, anon, authenticated;
create function public.get_tavern_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  v_save_id uuid;
begin
  result := private.get_tavern_snapshot_before_interactions_v2();
  if result is null then return null; end if;
  v_save_id := (result->'save'->>'id')::uuid;
  result := jsonb_set(result, '{brewery,intentCards}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'cardKey', c.card_key, 'displayName', catalog.display_name,
      'description', catalog.description, 'tier', c.tier,
      'sourceBeverageId', c.source_beverage_id, 'createdAt', c.created_at
    ) order by c.created_at, c.id)
    from public.intent_cards c
    join public.intent_card_catalog catalog
      on catalog.card_key = c.card_key and catalog.version = c.catalog_version
    where c.save_id = v_save_id and not exists (
      select 1 from public.intent_card_plays play
      where play.save_id = v_save_id and play.card_id = c.id
    )
  ), '[]'::jsonb), true);
  return result || jsonb_build_object('foods', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'recipeKey', f.recipe_key,
      'qualityIndex', f.quality_index, 'dayNumber', f.day_number,
      'createdAt', f.created_at
    ) order by f.created_at desc, f.id)
    from public.foods f where f.save_id = v_save_id
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_tavern_snapshot() from public, anon;
grant execute on function public.get_tavern_snapshot() to authenticated;

commit;
