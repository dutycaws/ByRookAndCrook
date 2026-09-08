alter table public.tavern_saves
  add column gold bigint not null default 0 check (gold >= 0);

create table public.patron_catalog (
  patron_key text primary key,
  display_name text not null,
  title text not null,
  icon text not null,
  description text not null,
  initial_relationship integer not null check (initial_relationship between 0 and 100),
  prices integer[] not null check (array_length(prices, 1) = 7 and array_lower(prices, 1) = 1 and 0 < all(prices)),
  arc_title text not null,
  arc_steps text[] not null check (array_length(arc_steps, 1) > 0),
  rules_version text not null check (rules_version = 'serving-v1')
);

insert into public.patron_catalog values
  ('lira', 'Lira Nightwind', 'Elven Ranger', '🏹',
   'A ranger following rumors of a bandit camp east of Millhaven. Rare drinks and dependable hospitality earn her trust.',
   45, array[2,5,8,12,18,28,45], 'The Bandit Camp', array[
     'Lira begins asking about the bandit camp east of Millhaven.',
     'Lira locates the old camp road and gathers reliable intelligence.',
     'Lira recruits a local scout and prepares her allies.',
     'Lira and her allies depart for the camp at dawn.',
     'Lira returns victorious. The bandit camp is cleared.'
   ], 'serving-v1'),
  ('torvin', 'Torvin Ashbeard', 'Dwarven Merchant', '💎',
   'A merchant guarding a peculiar gemstone. A good pour helps him settle his nerves before the deal.',
   22, array[1,3,6,10,16,25,40], 'The Gemstone Deal', array[
     'Torvin reveals the gemstone he brought from the eastern mines.',
     'Torvin shares the heartstone’s origin and finds a prospective buyer.',
     'The buyer arrives. Torvin prepares to negotiate the sale.',
     'Torvin closes the gemstone deal and celebrates his good fortune.'
   ], 'serving-v1');

create table public.patron_states (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  patron_key text not null references public.patron_catalog(patron_key),
  relationship integer not null check (relationship between 0 and 100),
  arc_progress integer not null default 0 check (arc_progress between 0 and 5),
  updated_at timestamptz not null default now(),
  primary key (save_id, patron_key)
);

alter table public.social_cards add constraint social_cards_save_id_id_key unique (save_id, id);

-- A serving event is also the immutable action receipt and consumption record.
create table public.serving_events (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null,
  patron_key text not null references public.patron_catalog(patron_key),
  beverage_id uuid not null,
  card_id uuid,
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  day_number integer not null check (day_number > 0),
  gold_earned integer not null check (gold_earned > 0),
  relationship_change integer not null,
  arc_change integer not null check (arc_change between -1 and 1),
  result jsonb not null,
  rules_version text not null check (rules_version = 'serving-v1'),
  committed_revision bigint not null check (committed_revision > 0),
  created_at timestamptz not null default now(),
  primary key (save_id, action_id),
  unique (save_id, beverage_id),
  unique (save_id, card_id),
  foreign key (save_id, actor_id) references public.tavern_saves(id, user_id) on delete cascade,
  foreign key (save_id, beverage_id) references public.beverages(save_id, id),
  foreign key (save_id, card_id) references public.social_cards(save_id, id)
);
create index serving_events_actor_idx on public.serving_events(actor_id);
create index serving_events_patron_idx on public.serving_events(patron_key);

alter table public.patron_catalog enable row level security;
alter table public.patron_states enable row level security;
alter table public.serving_events enable row level security;
create policy patron_catalog_read on public.patron_catalog for select to authenticated using (true);
create policy patron_states_read_own on public.patron_states for select to authenticated using (
  exists (select 1 from public.tavern_saves s where s.id = patron_states.save_id and s.user_id = (select auth.uid()))
);
create policy serving_events_read_own on public.serving_events for select to authenticated using (actor_id = (select auth.uid()));
revoke all on public.patron_catalog, public.patron_states, public.serving_events from public, anon, authenticated;
grant select on public.patron_catalog, public.patron_states, public.serving_events to authenticated;
grant all on public.patron_catalog, public.patron_states, public.serving_events to service_role;

create function public.get_bar_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'save', jsonb_build_object('id', s.id, 'revision', s.revision, 'gold', s.gold, 'currentDay', s.current_day),
    'patrons', (select jsonb_agg(jsonb_build_object(
      'key', p.patron_key, 'name', p.display_name, 'title', p.title, 'icon', p.icon,
      'description', p.description, 'prices', p.prices, 'arcTitle', p.arc_title,
      'relationship', coalesce(ps.relationship, p.initial_relationship),
      'arcProgress', coalesce(ps.arc_progress, 0), 'arcTotal', array_length(p.arc_steps, 1),
      'story', coalesce(p.arc_steps[ps.arc_progress], 'Their story is just beginning.')
    ) order by p.patron_key) from public.patron_catalog p
      left join public.patron_states ps on ps.save_id = s.id and ps.patron_key = p.patron_key),
    'beverages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'qualityIndex', b.quality_index
    ) order by b.created_at desc, b.id) from public.beverages b where b.save_id = s.id
      and not exists (select 1 from public.serving_events e where e.save_id = s.id and e.beverage_id = b.id)), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'displayName', c.display_name, 'tier', c.tier,
      'relationshipGain', c.relationship_gain, 'goldMultiplier', c.gold_multiplier
    ) order by c.created_at desc, c.id) from public.social_cards c where c.save_id = s.id
      and not exists (select 1 from public.serving_events e where e.save_id = s.id and e.card_id = c.id)), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(recent.result order by recent.committed_revision desc)
      from (select e.result, e.committed_revision from public.serving_events e where e.save_id = s.id
        order by e.committed_revision desc limit 20) recent), '[]'::jsonb)
  ) from public.tavern_saves s where s.user_id = auth.uid();
$$;

create or replace function public.serve_beverage(
  p_save_id uuid, p_patron_key text, p_beverage_id uuid, p_card_id uuid default null,
  p_action_id uuid default null, p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves%rowtype;
  v_patron public.patron_catalog%rowtype;
  v_state public.patron_states%rowtype;
  v_beverage public.beverages%rowtype;
  v_card public.social_cards%rowtype;
  v_prior public.serving_events%rowtype;
  v_gold integer;
  v_relationship integer;
  v_progress integer;
  v_story text;
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_beverage_id is null or p_action_id is null or p_patron_key is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid serving request';
  end if;
  select * into v_save from public.tavern_saves where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
  select * into v_prior from public.serving_events where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_prior.patron_key = p_patron_key and v_prior.beverage_id = p_beverage_id
      and v_prior.card_id is not distinct from p_card_id and v_prior.input_expected_revision = p_expected_revision then
      return v_prior.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; review the latest bar before serving';
  end if;
  select * into v_patron from public.patron_catalog where patron_key = p_patron_key;
  if not found then raise sqlstate 'PT404' using message = 'Patron not found'; end if;
  select * into v_beverage from public.beverages where save_id = p_save_id and id = p_beverage_id;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
  if exists (select 1 from public.serving_events where save_id = p_save_id and beverage_id = p_beverage_id) then
    raise sqlstate 'PT409' using message = 'This beverage has already been served';
  end if;
  if p_card_id is not null then
    select * into v_card from public.social_cards where save_id = p_save_id and id = p_card_id;
    if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
    if exists (select 1 from public.serving_events where save_id = p_save_id and card_id = p_card_id) then
      raise sqlstate 'PT409' using message = 'This social card has already been played';
    end if;
  end if;

  insert into public.patron_states (save_id, patron_key, relationship)
    values (p_save_id, p_patron_key, v_patron.initial_relationship) on conflict do nothing;
  select * into v_state from public.patron_states where save_id = p_save_id and patron_key = p_patron_key for update;

  v_gold := round(v_patron.prices[v_beverage.quality_index + 1] * coalesce(v_card.gold_multiplier, 1))::integer;
  v_relationship := least(100, greatest(0, v_state.relationship + coalesce(v_card.relationship_gain, 0)
    + case when v_beverage.quality_index >= 4 then 6 when v_beverage.quality_index >= 2 then 3
      when v_beverage.quality_index = 1 then -2 else -4 end));
  v_progress := least(array_length(v_patron.arc_steps, 1), greatest(0, v_state.arc_progress
    + case when v_beverage.quality_index >= 4 then 1 when v_beverage.quality_index <= 1 then -1 else 0 end));
  v_story := case
    when v_progress > v_state.arc_progress then v_patron.arc_steps[v_progress]
    when v_progress < v_state.arc_progress then 'Poor hospitality sets back ' || v_patron.display_name || '’s preparations.'
    when v_beverage.quality_index <= 1 then 'The poor drink leaves ' || v_patron.display_name || ' disappointed.'
    when v_progress = array_length(v_patron.arc_steps, 1) then 'Their story is resolved. Your hospitality is still welcome.'
    else 'A welcome drink. Their plans remain unchanged tonight.' end;
  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'patronKey', p_patron_key, 'patronName', v_patron.display_name,
    'beverageId', p_beverage_id, 'beverageName', v_beverage.name, 'qualityIndex', v_beverage.quality_index,
    'cardId', p_card_id, 'goldEarned', v_gold, 'goldBalance', v_save.gold + v_gold,
    'relationshipChange', v_relationship - v_state.relationship, 'relationship', v_relationship,
    'arcChange', v_progress - v_state.arc_progress, 'arcProgress', v_progress,
    'arcTotal', array_length(v_patron.arc_steps, 1), 'storyEvent', v_story,
    'dayNumber', v_save.current_day, 'committedRevision', v_save.revision + 1, 'rulesVersion', 'serving-v1'
  );
  update public.patron_states set relationship = v_relationship, arc_progress = v_progress, updated_at = now()
    where save_id = p_save_id and patron_key = p_patron_key;
  update public.tavern_saves set gold = gold + v_gold, revision = revision + 1, updated_at = now() where id = p_save_id;
  insert into public.serving_events (save_id, action_id, actor_id, patron_key, beverage_id, card_id,
    input_expected_revision, day_number, gold_earned, relationship_change, arc_change, result, rules_version, committed_revision)
  values (p_save_id, p_action_id, v_actor, p_patron_key, p_beverage_id, p_card_id, p_expected_revision,
    v_save.current_day, v_gold, v_relationship - v_state.relationship, v_progress - v_state.arc_progress,
    v_receipt, 'serving-v1', v_save.revision + 1);
  return v_receipt;
end;
$$;

revoke all on function public.get_bar_snapshot() from public, anon, authenticated;
revoke all on function public.serve_beverage(uuid,text,uuid,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.get_bar_snapshot() to authenticated;
grant execute on function public.serve_beverage(uuid,text,uuid,uuid,uuid,bigint) to authenticated;
