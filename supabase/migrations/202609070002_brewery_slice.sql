alter table public.tavern_saves
  add column current_day integer not null default 1 check (current_day > 0),
  add column day_minigame_completed boolean not null default false;

alter table public.ingredient_batches
  add column consumed_quantity integer not null default 0,
  add constraint ingredient_batches_consumed_quantity_check
    check (consumed_quantity >= 0 and consumed_quantity <= quantity),
  add constraint ingredient_batches_save_id_id_key unique (save_id, id);

create table public.brew_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  ingredient_batch_id uuid not null,
  ingredient_quality_index smallint not null check (ingredient_quality_index between 0 and 6),
  ingredient_brew_bonus smallint not null check (ingredient_brew_bonus >= 0),
  rules_version text not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default clock_timestamp(),
  duration_seconds integer not null default 30 check (duration_seconds = 30),
  completed_at timestamptz,
  perfect_ticks integer check (perfect_ticks >= 0),
  good_ticks integer check (good_ticks >= 0),
  total_ticks integer check (total_ticks between 0 and 160),
  stir_score smallint check (stir_score between 0 and 6),
  quality_index smallint check (quality_index between 0 and 6),
  created_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, day_number),
  foreign key (save_id, ingredient_batch_id)
    references public.ingredient_batches(save_id, id),
  check (
    (status = 'active' and completed_at is null and perfect_ticks is null and good_ticks is null
      and total_ticks is null and stir_score is null and quality_index is null)
    or
    (status = 'completed' and completed_at is not null and perfect_ticks is not null and good_ticks is not null
      and total_ticks is not null and stir_score is not null and quality_index is not null
      and perfect_ticks + good_ticks <= total_ticks)
  )
);

create table public.beverages (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  brew_session_id uuid not null,
  ingredient_batch_id uuid not null,
  rules_version text not null,
  name text not null,
  quality_index smallint not null check (quality_index between 0 and 6),
  created_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, brew_session_id),
  foreign key (save_id, brew_session_id)
    references public.brew_sessions(save_id, id),
  foreign key (save_id, ingredient_batch_id)
    references public.ingredient_batches(save_id, id)
);

create table public.social_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  source_beverage_id uuid not null,
  card_key text not null check (card_key = 'pour-ale'),
  display_name text not null,
  tier text not null check (tier in ('fine', 'superior', 'exceptional')),
  relationship_gain smallint not null check (relationship_gain > 0),
  gold_multiplier numeric(3, 2) not null check (gold_multiplier > 0),
  created_at timestamptz not null default now(),
  unique (save_id, source_beverage_id),
  foreign key (save_id, source_beverage_id)
    references public.beverages(save_id, id)
);

create table public.craft_actions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_kind text not null check (command_kind in ('start_brew', 'complete_brew', 'advance_day')),
  subject_id uuid,
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  input_perfect_ticks integer,
  input_good_ticks integer,
  input_total_ticks integer,
  result jsonb not null,
  committed_revision bigint not null check (committed_revision >= 1),
  created_at timestamptz not null default now(),
  primary key (save_id, action_id),
  foreign key (save_id, actor_id)
    references public.tavern_saves(id, user_id) on delete cascade,
  check (
    (command_kind = 'start_brew' and subject_id is not null and input_perfect_ticks is null
      and input_good_ticks is null and input_total_ticks is null)
    or
    (command_kind = 'complete_brew' and subject_id is not null and input_perfect_ticks is not null
      and input_good_ticks is not null and input_total_ticks is not null)
    or
    (command_kind = 'advance_day' and subject_id is null and input_perfect_ticks is null
      and input_good_ticks is null and input_total_ticks is null)
  )
);

create index brew_sessions_save_id_idx on public.brew_sessions(save_id);
create index beverages_save_id_idx on public.beverages(save_id);
create index social_cards_save_id_idx on public.social_cards(save_id);
create index craft_actions_actor_id_idx on public.craft_actions(actor_id);

create or replace function private.brew_name(quality_index smallint)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case quality_index
    when 0 then 'Spoiled Wort'
    when 1 then 'Murky Mead'
    when 2 then 'Rough Mead'
    when 3 then 'Honest Mead'
    when 4 then 'Sunlit Meadow Mead'
    when 5 then 'Eldritch Reserve'
    when 6 then 'Ambrosial Draught'
  end;
$$;

alter table public.brew_sessions enable row level security;
alter table public.beverages enable row level security;
alter table public.social_cards enable row level security;
alter table public.craft_actions enable row level security;

create policy brew_sessions_read_own on public.brew_sessions
  for select to authenticated using (
    exists (
      select 1 from public.tavern_saves s
      where s.id = brew_sessions.save_id and s.user_id = (select auth.uid())
    )
  );

create policy beverages_read_own on public.beverages
  for select to authenticated using (
    exists (
      select 1 from public.tavern_saves s
      where s.id = beverages.save_id and s.user_id = (select auth.uid())
    )
  );

create policy social_cards_read_own on public.social_cards
  for select to authenticated using (
    exists (
      select 1 from public.tavern_saves s
      where s.id = social_cards.save_id and s.user_id = (select auth.uid())
    )
  );

create policy craft_actions_read_own on public.craft_actions
  for select to authenticated using (actor_id = (select auth.uid()));

revoke all on public.brew_sessions, public.beverages, public.social_cards, public.craft_actions
  from public, anon, authenticated;
grant select on public.brew_sessions, public.beverages, public.social_cards, public.craft_actions
  to authenticated;
grant all on public.brew_sessions, public.beverages, public.social_cards, public.craft_actions
  to service_role;

create or replace function public.get_tavern_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with owned_save as (
    select s.*
    from public.tavern_saves s
    where s.user_id = auth.uid()
    limit 1
  )
  select jsonb_build_object(
    'save', jsonb_build_object(
      'id', s.id,
      'rulesVersion', s.rules_version,
      'revision', s.revision,
      'currentDay', s.current_day,
      'dayMinigameCompleted', s.day_minigame_completed
    ),
    'cells', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'layoutKey', c.layout_key,
          'col', c.col,
          'row', c.row,
          'kind', c.kind,
          'plantKey', c.plant_key,
          'plantName', pc.display_name,
          'icon', case when c.kind = 'beehive' then '🍯' else pc.icon end,
          'growthStage', c.growth_stage,
          'water', c.water,
          'health', c.health,
          'harvestable', c.kind = 'plant' and c.growth_stage = 3,
          'preview', case
            when c.kind = 'plant' and c.growth_stage = 3 then
              jsonb_build_object(
                'qualityIndex', private.quality_index(c.growth_stage, c.health),
                'quantity', 1 + case when exists (
                  select 1 from public.garden_cells hive
                  where hive.save_id = c.save_id and hive.kind = 'beehive'
                    and private.hex_distance(c.col, c.row, hive.col, hive.row) = 1
                ) then 1 else 0 end,
                'hasHiveBonus', exists (
                  select 1 from public.garden_cells hive
                  where hive.save_id = c.save_id and hive.kind = 'beehive'
                    and private.hex_distance(c.col, c.row, hive.col, hive.row) = 1
                ),
                'brewBonus', private.recipe_modifier(pc.base_brew_bonus, private.quality_index(c.growth_stage, c.health)),
                'bakeBonus', private.recipe_modifier(pc.base_bake_bonus, private.quality_index(c.growth_stage, c.health))
              )
            else null
          end
        ) order by c.row, c.col
      )
      from public.garden_cells c
      left join public.plant_catalog pc
        on pc.rules_version = c.rules_version and pc.plant_key = c.plant_key
      where c.save_id = s.id
    ), '[]'::jsonb),
    'ingredients', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'plantKey', b.plant_key,
          'plantName', pc.display_name,
          'icon', pc.icon,
          'qualityIndex', b.quality_index,
          'quantity', b.quantity - b.consumed_quantity,
          'brewBonus', b.brew_bonus,
          'bakeBonus', b.bake_bonus,
          'sourceCellId', b.source_cell_id,
          'createdAt', b.created_at
        ) order by b.created_at desc, b.id
      )
      from public.ingredient_batches b
      join public.plant_catalog pc
        on pc.rules_version = b.rules_version and pc.plant_key = b.plant_key
      where b.save_id = s.id and b.quantity > b.consumed_quantity
    ), '[]'::jsonb),
    'brewery', jsonb_build_object(
      'activeSession', (
        select jsonb_build_object(
          'id', bs.id,
          'ingredientBatchId', bs.ingredient_batch_id,
          'plantKey', b.plant_key,
          'plantName', pc.display_name,
          'icon', pc.icon,
          'ingredientQualityIndex', bs.ingredient_quality_index,
          'ingredientBrewBonus', bs.ingredient_brew_bonus,
          'startedAt', bs.started_at,
          'durationSeconds', bs.duration_seconds
        )
        from public.brew_sessions bs
        join public.ingredient_batches b on b.save_id = bs.save_id and b.id = bs.ingredient_batch_id
        join public.plant_catalog pc on pc.rules_version = b.rules_version and pc.plant_key = b.plant_key
        where bs.save_id = s.id and bs.day_number = s.current_day and bs.status = 'active'
      ),
      'beverages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'name', v.name,
            'qualityIndex', v.quality_index,
            'ingredientBatchId', v.ingredient_batch_id,
            'dayNumber', bs.day_number,
            'createdAt', v.created_at
          ) order by v.created_at desc, v.id
        )
        from public.beverages v
        join public.brew_sessions bs on bs.save_id = v.save_id and bs.id = v.brew_session_id
        where v.save_id = s.id
      ), '[]'::jsonb),
      'socialCards', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', sc.id,
            'cardKey', sc.card_key,
            'displayName', sc.display_name,
            'tier', sc.tier,
            'relationshipGain', sc.relationship_gain,
            'goldMultiplier', sc.gold_multiplier,
            'sourceBeverageId', sc.source_beverage_id,
            'createdAt', sc.created_at
          ) order by sc.created_at desc, sc.id
        )
        from public.social_cards sc
        where sc.save_id = s.id
      ), '[]'::jsonb)
    )
  )
  from owned_save s;
$$;

create or replace function public.start_brew(
  p_save_id uuid,
  p_ingredient_batch_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves%rowtype;
  v_batch public.ingredient_batches%rowtype;
  v_action public.craft_actions%rowtype;
  v_session_id uuid := extensions.gen_random_uuid();
  v_started_at timestamptz := clock_timestamp();
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_ingredient_batch_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid brew request';
  end if;

  select s.* into v_save from public.tavern_saves s
  where s.id = p_save_id and s.user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  select a.* into v_action from public.craft_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    if v_action.command_kind = 'start_brew' and v_action.subject_id = p_ingredient_batch_id
      and v_action.input_expected_revision = p_expected_revision then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before brewing';
  end if;
  if v_save.day_minigame_completed then
    raise sqlstate 'PT422' using message = 'The daily tavern minigame is already complete';
  end if;
  if exists (select 1 from public.brew_sessions bs where bs.save_id = p_save_id and bs.day_number = v_save.current_day) then
    raise sqlstate 'PT409' using message = 'A brew already exists for this tavern day';
  end if;

  select b.* into v_batch from public.ingredient_batches b
  where b.save_id = p_save_id and b.id = p_ingredient_batch_id and b.quantity > b.consumed_quantity
  for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'sessionId', v_session_id,
    'ingredientBatchId', p_ingredient_batch_id,
    'startedAt', v_started_at,
    'durationSeconds', 30,
    'committedRevision', v_save.revision + 1,
    'dayNumber', v_save.current_day
  );

  insert into public.brew_sessions
    (id, save_id, day_number, ingredient_batch_id, ingredient_quality_index,
     ingredient_brew_bonus, rules_version, started_at)
  values
    (v_session_id, p_save_id, v_save.current_day, p_ingredient_batch_id,
     v_batch.quality_index, v_batch.brew_bonus, v_save.rules_version, v_started_at);

  update public.tavern_saves set revision = revision + 1, updated_at = now() where id = p_save_id;

  insert into public.craft_actions
    (save_id, action_id, actor_id, command_kind, subject_id, input_expected_revision, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'start_brew', p_ingredient_batch_id,
     p_expected_revision, v_receipt, v_save.revision + 1);

  return v_receipt;
end;
$$;

create or replace function public.complete_brew(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_perfect_ticks integer,
  p_good_ticks integer,
  p_total_ticks integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves%rowtype;
  v_session public.brew_sessions%rowtype;
  v_action public.craft_actions%rowtype;
  v_beverage_id uuid := extensions.gen_random_uuid();
  v_card_id uuid;
  v_stir_score smallint;
  v_quality smallint;
  v_tier text;
  v_name text;
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_perfect_ticks is null or p_good_ticks is null or p_total_ticks is null
    or p_perfect_ticks < 0 or p_good_ticks < 0 or p_total_ticks < 0 or p_total_ticks > 160
    or p_perfect_ticks + p_good_ticks > p_total_ticks then
    raise sqlstate 'PT400' using message = 'Invalid brew completion';
  end if;

  select s.* into v_save from public.tavern_saves s
  where s.id = p_save_id and s.user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or brew not found'; end if;

  select a.* into v_action from public.craft_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    if v_action.command_kind = 'complete_brew' and v_action.subject_id = p_session_id
      and v_action.input_expected_revision = p_expected_revision
      and v_action.input_perfect_ticks = p_perfect_ticks and v_action.input_good_ticks = p_good_ticks
      and v_action.input_total_ticks = p_total_ticks then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before bottling';
  end if;

  select bs.* into v_session from public.brew_sessions bs
  where bs.save_id = p_save_id and bs.id = p_session_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or brew not found'; end if;
  if v_session.status <> 'active' then raise sqlstate 'PT409' using message = 'This brew is already complete'; end if;
  if v_session.day_number <> v_save.current_day or v_save.day_minigame_completed then
    raise sqlstate 'PT422' using message = 'This brew cannot be completed on the current tavern day';
  end if;
  if clock_timestamp() < v_session.started_at + make_interval(secs => v_session.duration_seconds) then
    raise sqlstate 'PT422' using message = 'The wort must be stirred for thirty seconds';
  end if;

  perform 1 from public.ingredient_batches b
  where b.save_id = p_save_id and b.id = v_session.ingredient_batch_id and b.quantity > b.consumed_quantity
  for update;
  if not found then raise sqlstate 'PT409' using message = 'The selected ingredient is no longer available'; end if;

  v_stir_score := least(6, greatest(0,
    round(6.0 * least(120.0, p_perfect_ticks + (p_good_ticks * 0.5)) / 120.0)
  ))::smallint;
  v_quality := least(6, greatest(0,
    round((v_session.ingredient_quality_index::numeric + v_stir_score::numeric) / 2.0)
      + case when v_session.ingredient_brew_bonus >= 4 then 1 else 0 end
  ))::smallint;
  v_name := private.brew_name(v_quality);

  insert into public.beverages
    (id, save_id, brew_session_id, ingredient_batch_id, rules_version, name, quality_index)
  values
    (v_beverage_id, p_save_id, p_session_id, v_session.ingredient_batch_id,
     v_session.rules_version, v_name, v_quality);

  if v_quality >= 2 then
    v_card_id := extensions.gen_random_uuid();
    v_tier := case when v_quality <= 3 then 'fine' when v_quality = 4 then 'superior' else 'exceptional' end;
    insert into public.social_cards
      (id, save_id, source_beverage_id, card_key, display_name, tier, relationship_gain, gold_multiplier)
    values
      (v_card_id, p_save_id, v_beverage_id, 'pour-ale', 'Pour Ale', v_tier,
       case v_tier when 'exceptional' then 10 when 'superior' then 7 else 5 end,
       case v_tier when 'exceptional' then 2.00 when 'superior' then 1.50 else 1.20 end);
  end if;

  update public.ingredient_batches set consumed_quantity = consumed_quantity + 1
  where save_id = p_save_id and id = v_session.ingredient_batch_id;

  update public.brew_sessions
  set status = 'completed', completed_at = clock_timestamp(), perfect_ticks = p_perfect_ticks,
      good_ticks = p_good_ticks, total_ticks = p_total_ticks, stir_score = v_stir_score,
      quality_index = v_quality
  where save_id = p_save_id and id = p_session_id;

  update public.tavern_saves
  set revision = revision + 1, day_minigame_completed = true, updated_at = now()
  where id = p_save_id;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'sessionId', p_session_id,
    'beverageId', v_beverage_id,
    'socialCardId', v_card_id,
    'beverageName', v_name,
    'qualityIndex', v_quality,
    'stirScore', v_stir_score,
    'committedRevision', v_save.revision + 1,
    'dayNumber', v_save.current_day,
    'rulesVersion', v_save.rules_version
  );

  insert into public.craft_actions
    (save_id, action_id, actor_id, command_kind, subject_id, input_expected_revision,
     input_perfect_ticks, input_good_ticks, input_total_ticks, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'complete_brew', p_session_id, p_expected_revision,
     p_perfect_ticks, p_good_ticks, p_total_ticks, v_receipt, v_save.revision + 1);

  return v_receipt;
end;
$$;

create or replace function public.advance_tavern_day(
  p_save_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves%rowtype;
  v_action public.craft_actions%rowtype;
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid day transition';
  end if;

  select s.* into v_save from public.tavern_saves s
  where s.id = p_save_id and s.user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern not found'; end if;

  select a.* into v_action from public.craft_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    if v_action.command_kind = 'advance_day' and v_action.input_expected_revision = p_expected_revision
      then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before ending the day';
  end if;
  if not v_save.day_minigame_completed then
    raise sqlstate 'PT422' using message = 'Complete the daily tavern minigame before ending the day';
  end if;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'newDay', v_save.current_day + 1,
    'committedRevision', v_save.revision + 1
  );

  update public.tavern_saves
  set current_day = current_day + 1, day_minigame_completed = false,
      revision = revision + 1, updated_at = now()
  where id = p_save_id;

  insert into public.craft_actions
    (save_id, action_id, actor_id, command_kind, subject_id, input_expected_revision, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'advance_day', null, p_expected_revision,
     v_receipt, v_save.revision + 1);

  return v_receipt;
end;
$$;

revoke all on function public.start_brew(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.advance_tavern_day(uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public.start_brew(uuid, uuid, uuid, bigint) to authenticated;
grant execute on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer) to authenticated;
grant execute on function public.advance_tavern_day(uuid, uuid, bigint) to authenticated;
