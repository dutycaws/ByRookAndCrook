-- Player intent cards and crafted food are inventory.  Resident-specific
-- consumption is created by the UUID world runtime, not a patron-key ledger.
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
  ('charm', 'intent-v1', 'Charm', 'Frame the keeper’s words with warmth and personal appeal.', 'The keeper deliberately chose a warm, personable approach. Treat it as an attempt, never guaranteed agreement.'),
  ('insight', 'intent-v1', 'Insight', 'Ask with patience and close attention to what the resident knows.', 'The keeper deliberately chose a curious, perceptive approach. It cannot unlock private or unknown facts.'),
  ('resolve', 'intent-v1', 'Resolve', 'Speak plainly and stand firmly behind the proposed course.', 'The keeper deliberately chose a firm, direct approach. It does not compel agreement.'),
  ('rumor', 'intent-v1', 'Rumor', 'Present the message as tavern hearsay that still needs verification.', 'The keeper deliberately framed this as a rumor. Treat every factual claim as unverified hearsay.');

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
  foreign key (card_key, catalog_version) references public.intent_card_catalog(card_key, version),
  foreign key (save_id, source_beverage_id) references public.beverages(save_id, id),
  check ((source_kind = 'brew') = (source_beverage_id is not null))
);

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

alter table public.intent_card_catalog enable row level security;
alter table public.intent_cards enable row level security;
alter table public.foods enable row level security;
create policy intent_catalog_read on public.intent_card_catalog for select to authenticated using (true);
create policy intent_cards_read_own on public.intent_cards for select to authenticated using (
  exists (select 1 from public.tavern_saves s where s.id = intent_cards.save_id and s.user_id = (select auth.uid()))
);
create policy foods_read_own on public.foods for select to authenticated using (
  exists (select 1 from public.tavern_saves s where s.id = foods.save_id and s.user_id = (select auth.uid()))
);
revoke all on public.intent_card_catalog, public.intent_cards, public.foods from public, anon, authenticated;
grant select on public.intent_card_catalog, public.intent_cards, public.foods to authenticated;
grant all on public.intent_card_catalog, public.intent_cards, public.foods to service_role;

create function private.ensure_intent_cards(p_save uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.intent_cards (save_id, card_key, tier, source_kind, source_key)
  values
    (p_save, 'charm', 'fine', 'starter', 'starter-charm'),
    (p_save, 'insight', 'fine', 'starter', 'starter-insight'),
    (p_save, 'resolve', 'fine', 'starter', 'starter-resolve'),
    (p_save, 'rumor', 'fine', 'starter', 'starter-rumor')
  on conflict (save_id, source_kind, source_key) do nothing;
$$;
revoke all on function private.ensure_intent_cards(uuid) from public, anon, authenticated;

alter function public.create_tavern() rename to create_tavern_before_intents;
alter function public.create_tavern_before_intents() set schema private;
revoke all on function private.create_tavern_before_intents() from public, anon, authenticated;
create function public.create_tavern()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := private.create_tavern_before_intents();
  perform private.ensure_intent_cards((result->>'saveId')::uuid);
  return result;
end;
$$;
revoke all on function public.create_tavern() from public, anon;
grant execute on function public.create_tavern() to authenticated;

alter function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  rename to complete_brew_before_intents;
alter function public.complete_brew_before_intents(uuid, uuid, uuid, bigint, integer, integer, integer)
  set schema private;
revoke all on function private.complete_brew_before_intents(uuid, uuid, uuid, bigint, integer, integer, integer)
  from public, anon, authenticated;
create function public.complete_brew(
  p_save_id uuid, p_session_id uuid, p_action_id uuid, p_expected_revision bigint,
  p_perfect_ticks integer, p_good_ticks integer, p_total_ticks integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; quality integer; card_key text; card_tier text; new_card uuid; old_card uuid;
begin
  v_result := private.complete_brew_before_intents(
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
    card_tier := case when quality >= 5 then 'exceptional' when quality >= 4 then 'superior' else 'fine' end;
    insert into public.intent_cards (save_id, card_key, tier, source_kind, source_key, source_beverage_id)
    values (p_save_id, card_key, card_tier, 'brew', v_result->>'beverageId', (v_result->>'beverageId')::uuid)
    on conflict (save_id, source_kind, source_key) do update set source_key = excluded.source_key
    returning id into new_card;
  end if;
  v_result := (v_result - 'socialCardId') || jsonb_build_object(
    'intentCardId', new_card, 'intentCardKey', card_key, 'intentCardTier', card_tier,
    'rulesVersion', 'brew-v2'
  );
  update public.craft_actions set result = v_result where save_id = p_save_id and action_id = p_action_id;
  return v_result;
end;
$$;
revoke all on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer) from public, anon;
grant execute on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer) to authenticated;

commit;
