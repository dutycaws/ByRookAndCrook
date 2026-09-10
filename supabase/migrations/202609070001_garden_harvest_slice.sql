create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.plant_catalog (
  rules_version text not null,
  plant_key text not null,
  display_name text not null,
  icon text not null,
  base_brew_bonus smallint not null check (base_brew_bonus >= 0),
  base_bake_bonus smallint not null check (base_bake_bonus >= 0),
  primary key (rules_version, plant_key)
);

create table public.tavern_saves (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rules_version text not null default 'harvest-v1',
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (id, user_id)
);

create table public.garden_cells (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  layout_key text not null,
  col smallint not null check (col between 0 and 2),
  row smallint not null check (row between 0 and 3),
  kind text not null check (kind in ('empty', 'plant', 'beehive')),
  rules_version text not null,
  plant_key text,
  growth_stage smallint check (growth_stage between 0 and 3),
  water smallint check (water between 0 and 100),
  health smallint check (health between 0 and 100),
  updated_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, layout_key),
  unique (save_id, col, row),
  foreign key (rules_version, plant_key)
    references public.plant_catalog(rules_version, plant_key),
  check (
    (kind = 'plant' and plant_key is not null and growth_stage is not null and water is not null and health is not null)
    or (kind in ('empty', 'beehive') and plant_key is null and growth_stage is null and water is null and health is null)
  )
);

create table public.game_actions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_kind text not null check (command_kind in ('harvest_crop')),
  input_cell_id uuid not null,
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  rules_version text not null,
  result jsonb not null,
  committed_revision bigint not null check (committed_revision >= 1),
  created_at timestamptz not null default now(),
  primary key (save_id, action_id),
  foreign key (save_id, actor_id)
    references public.tavern_saves(id, user_id) on delete cascade,
  foreign key (save_id, input_cell_id)
    references public.garden_cells(save_id, id)
);

create table public.ingredient_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  rules_version text not null,
  plant_key text not null,
  quality_index smallint not null check (quality_index between 0 and 6),
  quantity integer not null check (quantity > 0),
  brew_bonus smallint not null check (brew_bonus >= 0),
  bake_bonus smallint not null check (bake_bonus >= 0),
  source_cell_id uuid not null,
  source_action_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (rules_version, plant_key)
    references public.plant_catalog(rules_version, plant_key),
  foreign key (save_id, source_cell_id)
    references public.garden_cells(save_id, id),
  foreign key (save_id, source_action_id)
    references public.game_actions(save_id, action_id),
  unique (save_id, source_action_id)
);

create index garden_cells_save_id_idx on public.garden_cells(save_id);
create index ingredient_batches_save_id_idx on public.ingredient_batches(save_id);
create index game_actions_actor_id_idx on public.game_actions(actor_id);

insert into public.plant_catalog
  (rules_version, plant_key, display_name, icon, base_brew_bonus, base_bake_bonus)
values
  ('harvest-v1', 'hops', 'Hops', '🌿', 2, 0),
  ('harvest-v1', 'chamomile', 'Chamomile', '🌼', 2, 1),
  ('harvest-v1', 'lavender', 'Lavender', '💜', 2, 1),
  ('harvest-v1', 'fennel', 'Fennel', '🌾', 1, 2),
  ('harvest-v1', 'sage', 'Sage', '🌿', 0, 2),
  ('harvest-v1', 'pepper', 'Pepper', '🌶️', 0, 2),
  ('harvest-v1', 'tomatoes', 'Tomatoes', '🍅', 0, 1);

create or replace function private.quality_index(
  growth_stage smallint,
  health smallint
)
returns smallint
language sql
immutable
strict
set search_path = ''
as $$
  select least(
    6,
    greatest(
      0,
      growth_stage::integer + case when health >= 80 then 2 when health >= 50 then 1 else 0 end
    )
  )::smallint;
$$;

create or replace function private.recipe_modifier(
  base_bonus smallint,
  quality_index smallint
)
returns smallint
language sql
immutable
strict
set search_path = ''
as $$
  select (base_bonus::integer * case when quality_index >= 4 then 2 when quality_index >= 2 then 1 else 0 end)::smallint;
$$;

create or replace function private.hex_distance(
  col_a smallint,
  row_a smallint,
  col_b smallint,
  row_b smallint
)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  with axial as (
    select
      col_a::integer - ((row_a::integer - (row_a::integer & 1)) / 2) as q_a,
      row_a::integer as r_a,
      col_b::integer - ((row_b::integer - (row_b::integer & 1)) / 2) as q_b,
      row_b::integer as r_b
  )
  select (abs(q_a - q_b) + abs(r_a - r_b) + abs((q_a + r_a) - (q_b + r_b))) / 2
  from axial;
$$;

alter table public.plant_catalog enable row level security;
alter table public.tavern_saves enable row level security;
alter table public.garden_cells enable row level security;
alter table public.game_actions enable row level security;
alter table public.ingredient_batches enable row level security;

create policy plant_catalog_read on public.plant_catalog
  for select to authenticated using (true);

create policy tavern_saves_read_own on public.tavern_saves
  for select to authenticated using (user_id = (select auth.uid()));

create policy garden_cells_read_own on public.garden_cells
  for select to authenticated using (
    exists (
      select 1 from public.tavern_saves s
      where s.id = garden_cells.save_id and s.user_id = (select auth.uid())
    )
  );

create policy ingredient_batches_read_own on public.ingredient_batches
  for select to authenticated using (
    exists (
      select 1 from public.tavern_saves s
      where s.id = ingredient_batches.save_id and s.user_id = (select auth.uid())
    )
  );

create policy game_actions_read_own on public.game_actions
  for select to authenticated using (actor_id = (select auth.uid()));

revoke all on all tables in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.plant_catalog, public.tavern_saves, public.garden_cells,
  public.ingredient_batches, public.game_actions to authenticated;

grant usage on schema private to authenticated;
grant execute on function private.quality_index(smallint, smallint) to authenticated;
grant execute on function private.recipe_modifier(smallint, smallint) to authenticated;
grant execute on function private.hex_distance(smallint, smallint, smallint, smallint) to authenticated;

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
      'revision', s.revision
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
                  select 1
                  from public.garden_cells hive
                  where hive.save_id = c.save_id
                    and hive.kind = 'beehive'
                    and private.hex_distance(c.col, c.row, hive.col, hive.row) = 1
                ) then 1 else 0 end,
                'hasHiveBonus', exists (
                  select 1
                  from public.garden_cells hive
                  where hive.save_id = c.save_id
                    and hive.kind = 'beehive'
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
          'quantity', b.quantity,
          'brewBonus', b.brew_bonus,
          'bakeBonus', b.bake_bonus,
          'sourceCellId', b.source_cell_id,
          'createdAt', b.created_at
        ) order by b.created_at desc, b.id
      )
      from public.ingredient_batches b
      join public.plant_catalog pc
        on pc.rules_version = b.rules_version and pc.plant_key = b.plant_key
      where b.save_id = s.id
    ), '[]'::jsonb)
  )
  from owned_save s;
$$;

create or replace function public.create_tavern()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_save_id uuid;
  v_created boolean := false;
begin
  if v_actor is null then
    raise sqlstate 'PT401' using message = 'Authentication required';
  end if;

  insert into public.tavern_saves (user_id, rules_version)
  values (v_actor, 'harvest-v1')
  on conflict (user_id) do nothing
  returning id into v_save_id;

  if v_save_id is not null then
    v_created := true;

    insert into public.garden_cells
      (save_id, layout_key, col, row, kind, rules_version, plant_key, growth_stage, water, health)
    values
      (v_save_id, 'c0',  0, 0, 'plant',   'harvest-v1', 'hops',      3, 70, 90),
      (v_save_id, 'c1',  1, 0, 'plant',   'harvest-v1', 'fennel',   3, 55, 85),
      (v_save_id, 'c2',  2, 0, 'beehive', 'harvest-v1', null,       null, null, null),
      (v_save_id, 'c3',  0, 1, 'empty',   'harvest-v1', null,       null, null, null),
      (v_save_id, 'c4',  1, 1, 'plant',   'harvest-v1', 'pepper',   2, 78, 88),
      (v_save_id, 'c5',  2, 1, 'empty',   'harvest-v1', null,       null, null, null),
      (v_save_id, 'c6',  0, 2, 'plant',   'harvest-v1', 'chamomile',1, 42, 72),
      (v_save_id, 'c7',  1, 2, 'plant',   'harvest-v1', 'tomatoes', 3, 80, 91),
      (v_save_id, 'c8',  2, 2, 'plant',   'harvest-v1', 'lavender', 2, 60, 80),
      (v_save_id, 'c9',  0, 3, 'empty',   'harvest-v1', null,       null, null, null),
      (v_save_id, 'c10', 1, 3, 'plant',   'harvest-v1', 'sage',     1, 35, 65),
      (v_save_id, 'c11', 2, 3, 'empty',   'harvest-v1', null,       null, null, null);
  else
    select s.id into v_save_id
    from public.tavern_saves s
    where s.user_id = v_actor;
  end if;

  return jsonb_build_object('saveId', v_save_id, 'created', v_created);
end;
$$;

create or replace function public.harvest_crop(
  p_save_id uuid,
  p_cell_id uuid,
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
  v_cell public.garden_cells%rowtype;
  v_catalog public.plant_catalog%rowtype;
  v_action public.game_actions%rowtype;
  v_batch_id uuid := extensions.gen_random_uuid();
  v_quality smallint;
  v_quantity integer;
  v_brew_bonus smallint;
  v_bake_bonus smallint;
  v_receipt jsonb;
begin
  if v_actor is null then
    raise sqlstate 'PT401' using message = 'Authentication required';
  end if;

  if p_save_id is null or p_cell_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid harvest request';
  end if;

  select s.* into v_save
  from public.tavern_saves s
  where s.id = p_save_id and s.user_id = v_actor
  for update;

  if not found then
    raise sqlstate 'PT404' using message = 'Tavern or garden cell not found';
  end if;

  select a.* into v_action
  from public.game_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;

  if found then
    if v_action.input_cell_id = p_cell_id
      and v_action.input_expected_revision = p_expected_revision then
      return v_action.result;
    end if;

    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Garden state changed; refresh before harvesting';
  end if;

  select c.* into v_cell
  from public.garden_cells c
  where c.save_id = p_save_id and c.id = p_cell_id
  for update;

  if not found then
    raise sqlstate 'PT404' using message = 'Tavern or garden cell not found';
  end if;

  if v_cell.kind <> 'plant' or v_cell.growth_stage <> 3 then
    raise sqlstate 'PT422' using message = 'Only a mature crop can be harvested';
  end if;

  select pc.* into strict v_catalog
  from public.plant_catalog pc
  where pc.rules_version = v_cell.rules_version and pc.plant_key = v_cell.plant_key;

  v_quality := private.quality_index(v_cell.growth_stage, v_cell.health);
  v_quantity := 1 + case when exists (
    select 1
    from public.garden_cells hive
    where hive.save_id = p_save_id
      and hive.kind = 'beehive'
      and private.hex_distance(v_cell.col, v_cell.row, hive.col, hive.row) = 1
  ) then 1 else 0 end;
  v_brew_bonus := private.recipe_modifier(v_catalog.base_brew_bonus, v_quality);
  v_bake_bonus := private.recipe_modifier(v_catalog.base_bake_bonus, v_quality);

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'cellId', p_cell_id,
    'ingredientBatchId', v_batch_id,
    'quantity', v_quantity,
    'qualityIndex', v_quality,
    'brewBonus', v_brew_bonus,
    'bakeBonus', v_bake_bonus,
    'committedRevision', v_save.revision + 1,
    'rulesVersion', v_save.rules_version
  );

  insert into public.game_actions
    (save_id, action_id, actor_id, command_kind, input_cell_id, input_expected_revision,
     rules_version, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'harvest_crop', p_cell_id, p_expected_revision,
     v_save.rules_version, v_receipt, v_save.revision + 1);

  update public.garden_cells
  set kind = 'empty', plant_key = null, growth_stage = null, water = null, health = null,
      updated_at = now()
  where save_id = p_save_id and id = p_cell_id;

  insert into public.ingredient_batches
    (id, save_id, rules_version, plant_key, quality_index, quantity, brew_bonus,
     bake_bonus, source_cell_id, source_action_id)
  values
    (v_batch_id, p_save_id, v_save.rules_version, v_cell.plant_key, v_quality, v_quantity,
     v_brew_bonus, v_bake_bonus, p_cell_id, p_action_id);

  update public.tavern_saves
  set revision = revision + 1, updated_at = now()
  where id = p_save_id;

  return v_receipt;
end;
$$;

revoke all on function public.get_tavern_snapshot() from public, anon, authenticated;
revoke all on function public.create_tavern() from public, anon, authenticated;
revoke all on function public.harvest_crop(uuid, uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public.get_tavern_snapshot() to authenticated;
grant execute on function public.create_tavern() to authenticated;
grant execute on function public.harvest_crop(uuid, uuid, uuid, bigint) to authenticated;
