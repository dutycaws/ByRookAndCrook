-- Establish the versioned garden/apiary model while preserving the original
-- cell identities and every existing crafting and NPC contract.
begin;

alter table public.tavern_saves
  add column garden_rules_version text not null default 'garden-apiary-v1',
  add column garden_plot_count smallint not null default 12
    check (garden_plot_count in (12, 16, 24));

alter table public.garden_cells
  drop constraint if exists garden_cells_col_check,
  drop constraint if exists garden_cells_row_check;
alter table public.garden_cells
  add constraint garden_cells_col_check check (col between 0 and 5),
  add constraint garden_cells_row_check check (row between 0 and 3),
  add column unlocked boolean not null default true,
  add column soil_n smallint not null default 60 check (soil_n between 0 and 100),
  add column soil_p smallint not null default 60 check (soil_p between 0 and 100),
  add column soil_k smallint not null default 60 check (soil_k between 0 and 100),
  add column soil_moisture smallint not null default 55 check (soil_moisture between 0 and 100),
  add column soil_quality smallint not null default 60 check (soil_quality between 0 and 100),
  add column site_light smallint not null default 75 check (site_light between 0 and 100);

create table public.garden_species_profiles (
  rules_version text not null,
  species_key text not null,
  display_name text not null,
  icon text not null,
  primary_product text not null,
  maturity_days smallint not null check (maturity_days between 1 and 30),
  regrowth_days smallint check (regrowth_days between 1 and 30),
  regrows boolean not null,
  moisture_min smallint not null check (moisture_min between 0 and 100),
  moisture_max smallint not null check (moisture_max between 0 and 100),
  n_min smallint not null check (n_min between 0 and 100),
  p_min smallint not null check (p_min between 0 and 100),
  k_min smallint not null check (k_min between 0 and 100),
  n_use smallint not null check (n_use between 0 and 20),
  p_use smallint not null check (p_use between 0 and 20),
  k_use smallint not null check (k_use between 0 and 20),
  light_min smallint not null check (light_min between 0 and 100),
  light_max smallint not null check (light_max between 0 and 100),
  height_class smallint not null check (height_class between 0 and 4),
  flowering_start smallint not null check (flowering_start between 0 and 100),
  flowering_days smallint not null check (flowering_days between 0 and 30),
  base_yield smallint not null check (base_yield between 1 and 10),
  forage_value smallint not null check (forage_value between 0 and 20),
  pollination_eligible boolean not null,
  base_brew_bonus smallint not null check (base_brew_bonus between 0 and 6),
  base_bake_bonus smallint not null check (base_bake_bonus between 0 and 6),
  primary key (rules_version, species_key),
  check (moisture_min <= moisture_max),
  check (light_min <= light_max),
  check ((regrows and regrowth_days is not null) or (not regrows and regrowth_days is null))
);

insert into public.garden_species_profiles values
  ('garden-apiary-v1','hops','Hops','🌿','cones',6,3,true,45,72,38,34,42,5,4,5,55,95,4,62,3,1,4,false,2,0),
  ('garden-apiary-v1','chamomile','Chamomile','🌼','flowers',3,2,true,42,70,30,28,28,3,3,3,45,95,1,58,4,1,5,true,2,1),
  ('garden-apiary-v1','lavender','Lavender','💜','flowers',5,3,true,28,55,28,32,30,3,3,3,62,100,2,64,4,1,5,true,2,1),
  ('garden-apiary-v1','fennel','Fennel','🌾','seeds',5,null,false,40,68,34,38,34,4,4,4,58,100,3,62,3,1,5,true,1,2),
  ('garden-apiary-v1','sage','Sage','🌿','leaves',3,2,true,30,58,24,28,28,3,3,3,52,100,1,70,2,1,2,false,0,2),
  ('garden-apiary-v1','pepper','Pepper','🌶️','fruit',5,3,true,48,72,45,42,48,5,5,5,62,100,2,66,3,1,3,true,0,2),
  ('garden-apiary-v1','tomatoes','Tomatoes','🍅','fruit',4,3,true,50,76,48,42,52,5,5,6,58,100,3,64,3,1,3,true,0,1),
  ('garden-apiary-v1','clover','Clover','☘️','cover crop',3,2,true,38,72,18,22,20,1,2,2,42,100,0,55,8,1,8,true,0,0);

insert into public.plant_catalog
  (rules_version, plant_key, display_name, icon, base_brew_bonus, base_bake_bonus)
select rules_version, species_key, display_name, icon, base_brew_bonus, base_bake_bonus
from public.garden_species_profiles
union all
select 'garden-apiary-v1', 'honey', 'Floral Honey', '🍯', 2::smallint, 2::smallint
on conflict do nothing;

create table public.garden_companion_rules (
  rules_version text not null,
  species_a text not null,
  species_b text not null,
  effect smallint not null check (effect between -10 and 10 and effect <> 0),
  reason text not null,
  primary key (rules_version, species_a, species_b),
  foreign key (rules_version, species_a)
    references public.garden_species_profiles(rules_version, species_key),
  foreign key (rules_version, species_b)
    references public.garden_species_profiles(rules_version, species_key),
  check (species_a < species_b)
);

insert into public.garden_companion_rules values
  ('garden-apiary-v1','chamomile','tomatoes',4,'Chamomile supports a diverse low canopy beside tomatoes.'),
  ('garden-apiary-v1','clover','hops',3,'Established clover adds low flowering cover beneath tall hops.'),
  ('garden-apiary-v1','lavender','sage',4,'Both plants favor a dry, open bed edge.'),
  ('garden-apiary-v1','fennel','tomatoes',-6,'Tall fennel competes with demanding tomatoes for light and space.'),
  ('garden-apiary-v1','pepper','tomatoes',-3,'Two demanding fruiting plants intensify the same local care pressure.');

create table public.garden_weather_profiles (
  rules_version text not null,
  weather_key text not null,
  display_name text not null,
  rainfall smallint not null check (rainfall between 0 and 40),
  drying smallint not null check (drying between 0 and 40),
  light_delta smallint not null check (light_delta between -40 and 20),
  primary key (rules_version, weather_key)
);
insert into public.garden_weather_profiles values
  ('garden-apiary-v1','clear','Clear',0,14,8),
  ('garden-apiary-v1','cloudy','Cloudy',0,7,-10),
  ('garden-apiary-v1','rainy','Rainy',24,2,-20);

create table public.garden_plants (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  cell_id uuid not null,
  rules_version text not null,
  species_key text not null,
  lifecycle text not null check (lifecycle in ('seedling','growing','flowering','mature','regrowing','dead')),
  age_days integer not null default 0 check (age_days >= 0),
  growth_progress smallint not null default 0 check (growth_progress between 0 and 100),
  health smallint not null default 80 check (health between 0 and 100),
  production_cycle integer not null default 1 check (production_cycle >= 1),
  care_good_days integer not null default 0 check (care_good_days >= 0),
  care_total_days integer not null default 0 check (care_total_days >= 0),
  stress_points integer not null default 0 check (stress_points >= 0),
  companion_points integer not null default 0,
  pollination_points integer not null default 0 check (pollination_points >= 0),
  flowering_days_remaining smallint not null default 0 check (flowering_days_remaining >= 0),
  ready_since_day integer,
  threat_days smallint not null default 0 check (threat_days >= 0),
  planted_day integer not null check (planted_day > 0),
  updated_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, cell_id) deferrable initially deferred,
  foreign key (save_id, cell_id) references public.garden_cells(save_id, id),
  foreign key (rules_version, species_key)
    references public.garden_species_profiles(rules_version, species_key)
);

create table public.apiary_hives (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  cell_id uuid not null,
  equipment_condition smallint not null default 100 check (equipment_condition between 0 and 100),
  installed_day integer not null check (installed_day > 0),
  updated_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, cell_id) deferrable initially deferred,
  foreign key (save_id, cell_id) references public.garden_cells(save_id, id)
);

-- A garden cell has exactly one authoritative occupancy representation. The
-- checks are deferred so move and swap commands can update the cell and its
-- occupant rows in either order inside one transaction.
create or replace function private.enforce_garden_cell_occupancy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_save_id uuid := case when tg_op = 'DELETE' then old.save_id else new.save_id end;
  v_cell_id uuid;
  v_kind text;
  v_plants integer;
  v_hives integer;
begin
  if tg_table_name = 'garden_cells' then
    v_cell_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_cell_id := case when tg_op = 'DELETE' then old.cell_id else new.cell_id end;
  end if;

  select kind into v_kind
  from public.garden_cells
  where save_id = v_save_id and id = v_cell_id;

  -- Cascading deletion removes the cell before its occupants are checked.
  if not found then return null; end if;

  select count(*) into v_plants from public.garden_plants
  where save_id = v_save_id and cell_id = v_cell_id;
  select count(*) into v_hives from public.apiary_hives
  where save_id = v_save_id and cell_id = v_cell_id;

  if v_plants + v_hives > 1
     or (v_kind = 'plant' and (v_plants <> 1 or v_hives <> 0))
     or (v_kind = 'beehive' and (v_hives <> 1 or v_plants <> 0))
     or (v_kind = 'empty' and (v_plants <> 0 or v_hives <> 0)) then
    raise exception using errcode = '23514',
      message = format('Garden cell %s occupancy does not match kind %s', v_cell_id, v_kind);
  end if;

  return null;
end;
$$;

create constraint trigger garden_plants_occupancy_check
after insert or update or delete on public.garden_plants
deferrable initially deferred for each row
execute function private.enforce_garden_cell_occupancy();

create constraint trigger apiary_hives_occupancy_check
after insert or update or delete on public.apiary_hives
deferrable initially deferred for each row
execute function private.enforce_garden_cell_occupancy();

create constraint trigger garden_cells_occupancy_check
after insert or update of kind on public.garden_cells
deferrable initially deferred for each row
execute function private.enforce_garden_cell_occupancy();

create table public.apiary_colonies (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  hive_id uuid not null,
  adults integer not null default 6000 check (adults between 0 and 50000),
  brood integer not null default 1200 check (brood between 0 and 20000),
  health smallint not null default 82 check (health between 0 and 100),
  food_stores integer not null default 24 check (food_stores between 0 and 1000),
  floral_honey integer not null default 4 check (floral_honey between 0 and 1000),
  feed_stores integer not null default 0 check (feed_stores between 0 and 1000),
  varroa_pressure smallint not null default 8 check (varroa_pressure between 0 and 100),
  chalkbrood_pressure smallint not null default 2 check (chalkbrood_pressure between 0 and 100),
  nosema_pressure smallint not null default 2 check (nosema_pressure between 0 and 100),
  treatment_key text check (treatment_key in ('varroa','chalkbrood','nosema')),
  treatment_days_remaining smallint not null default 0 check (treatment_days_remaining between 0 and 14),
  treatment_tradeoff text,
  threat_days smallint not null default 0 check (threat_days >= 0),
  established_day integer not null check (established_day > 0),
  updated_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, hive_id),
  foreign key (save_id, hive_id) references public.apiary_hives(save_id, id)
);

create table public.garden_item_catalog (
  rules_version text not null,
  item_key text not null,
  item_kind text not null check (item_kind in ('seed','amendment','feed','treatment','equipment','colony')),
  display_name text not null,
  price integer not null check (price between 0 and 1000),
  effect jsonb not null default '{}'::jsonb,
  primary key (rules_version, item_key)
);

insert into public.garden_item_catalog values
  ('garden-apiary-v1','seed_hops','seed','Hops seed',2,'{"species":"hops"}'),
  ('garden-apiary-v1','seed_chamomile','seed','Chamomile seed',2,'{"species":"chamomile"}'),
  ('garden-apiary-v1','seed_lavender','seed','Lavender seed',3,'{"species":"lavender"}'),
  ('garden-apiary-v1','seed_fennel','seed','Fennel seed',3,'{"species":"fennel"}'),
  ('garden-apiary-v1','seed_sage','seed','Sage seed',2,'{"species":"sage"}'),
  ('garden-apiary-v1','seed_pepper','seed','Pepper seed',4,'{"species":"pepper"}'),
  ('garden-apiary-v1','seed_tomatoes','seed','Tomato seed',4,'{"species":"tomatoes"}'),
  ('garden-apiary-v1','seed_clover','seed','Clover seed',2,'{"species":"clover"}'),
  ('garden-apiary-v1','amendment_n','amendment','Nitrogen amendment',5,'{"n":18}'),
  ('garden-apiary-v1','amendment_p','amendment','Phosphorus amendment',5,'{"p":18}'),
  ('garden-apiary-v1','amendment_k','amendment','Potassium amendment',5,'{"k":18}'),
  ('garden-apiary-v1','soil_builder','amendment','Soil builder',8,'{"quality":12}'),
  ('garden-apiary-v1','bee_feed','feed','Colony feed',4,'{"food":18}'),
  ('garden-apiary-v1','treatment_varroa','treatment','Varroa treatment',8,'{"problem":"varroa"}'),
  ('garden-apiary-v1','treatment_chalkbrood','treatment','Chalkbrood treatment',6,'{"problem":"chalkbrood"}'),
  ('garden-apiary-v1','treatment_nosema','treatment','Nosema treatment',7,'{"problem":"nosema"}'),
  ('garden-apiary-v1','hive_equipment','equipment','Empty hive equipment',30,'{}'),
  ('garden-apiary-v1','replacement_colony','colony','Replacement colony',30,'{}');

create table public.garden_inventory (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  item_key text not null,
  rules_version text not null default 'garden-apiary-v1',
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (save_id, item_key),
  foreign key (rules_version, item_key)
    references public.garden_item_catalog(rules_version, item_key)
);

create table public.garden_weather (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  rules_version text not null,
  weather_key text not null,
  primary key (save_id, day_number),
  foreign key (rules_version, weather_key)
    references public.garden_weather_profiles(rules_version, weather_key)
);

create table public.garden_compost_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  cell_id uuid not null,
  source_kind text not null check (source_kind in ('plant','green_manure','ingredient')),
  source_label text not null,
  ready_day integer not null check (ready_day > 0),
  releases_remaining smallint not null default 2 check (releases_remaining between 1 and 6),
  n_per_release smallint not null default 0 check (n_per_release between 0 and 30),
  p_per_release smallint not null default 0 check (p_per_release between 0 and 30),
  k_per_release smallint not null default 0 check (k_per_release between 0 and 30),
  quality_per_release smallint not null default 0 check (quality_per_release between 0 and 30),
  created_at timestamptz not null default now(),
  unique (save_id, id),
  foreign key (save_id, cell_id) references public.garden_cells(save_id, id)
);

create table public.garden_daily_grants (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  grant_key text not null,
  contents jsonb not null,
  created_at timestamptz not null default now(),
  primary key (save_id, day_number, grant_key)
);

create table public.garden_day_resolutions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  action_id uuid not null,
  rules_version text not null,
  input_fingerprint text not null,
  plan_fingerprint text not null,
  plan jsonb not null,
  report jsonb not null,
  created_at timestamptz not null default now(),
  primary key (save_id, day_number),
  unique (save_id, action_id)
);

create table public.garden_actions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null,
  command_kind text not null,
  input_payload jsonb not null,
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  rules_version text not null,
  result jsonb not null,
  committed_revision bigint not null check (committed_revision > 0),
  created_at timestamptz not null default now(),
  primary key (save_id, action_id),
  foreign key (save_id, actor_id)
    references public.tavern_saves(id, user_id) on delete cascade
);

create index garden_plants_save_idx on public.garden_plants(save_id);
create index apiary_hives_save_idx on public.apiary_hives(save_id);
create index apiary_colonies_save_idx on public.apiary_colonies(save_id);
create index garden_compost_jobs_save_idx on public.garden_compost_jobs(save_id);
create index garden_actions_actor_idx on public.garden_actions(actor_id);

alter table public.garden_species_profiles enable row level security;
alter table public.garden_companion_rules enable row level security;
alter table public.garden_weather_profiles enable row level security;
alter table public.garden_item_catalog enable row level security;
alter table public.garden_plants enable row level security;
alter table public.apiary_hives enable row level security;
alter table public.apiary_colonies enable row level security;
alter table public.garden_inventory enable row level security;
alter table public.garden_weather enable row level security;
alter table public.garden_compost_jobs enable row level security;
alter table public.garden_daily_grants enable row level security;
alter table public.garden_day_resolutions enable row level security;
alter table public.garden_actions enable row level security;

create policy garden_species_profiles_read on public.garden_species_profiles
  for select to authenticated using (true);
create policy garden_companion_rules_read on public.garden_companion_rules
  for select to authenticated using (true);
create policy garden_weather_profiles_read on public.garden_weather_profiles
  for select to authenticated using (true);
create policy garden_item_catalog_read on public.garden_item_catalog
  for select to authenticated using (true);

create policy garden_plants_read_own on public.garden_plants
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = garden_plants.save_id and s.user_id = (select auth.uid())
  ));
create policy apiary_hives_read_own on public.apiary_hives
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = apiary_hives.save_id and s.user_id = (select auth.uid())
  ));
create policy apiary_colonies_read_own on public.apiary_colonies
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = apiary_colonies.save_id and s.user_id = (select auth.uid())
  ));
create policy garden_inventory_read_own on public.garden_inventory
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = garden_inventory.save_id and s.user_id = (select auth.uid())
  ));
create policy garden_weather_read_own on public.garden_weather
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = garden_weather.save_id and s.user_id = (select auth.uid())
  ));
create policy garden_compost_jobs_read_own on public.garden_compost_jobs
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = garden_compost_jobs.save_id and s.user_id = (select auth.uid())
  ));
create policy garden_daily_grants_read_own on public.garden_daily_grants
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = garden_daily_grants.save_id and s.user_id = (select auth.uid())
  ));
create policy garden_day_resolutions_read_own on public.garden_day_resolutions
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s where s.id = garden_day_resolutions.save_id and s.user_id = (select auth.uid())
  ));
create policy garden_actions_read_own on public.garden_actions
  for select to authenticated using (actor_id = (select auth.uid()));

revoke all on public.garden_species_profiles, public.garden_companion_rules,
  public.garden_weather_profiles, public.garden_item_catalog, public.garden_plants,
  public.apiary_hives, public.apiary_colonies, public.garden_inventory,
  public.garden_weather, public.garden_compost_jobs, public.garden_daily_grants,
  public.garden_day_resolutions, public.garden_actions from public, anon, authenticated;
grant select on public.garden_species_profiles, public.garden_companion_rules,
  public.garden_weather_profiles, public.garden_item_catalog, public.garden_plants,
  public.apiary_hives, public.apiary_colonies, public.garden_inventory,
  public.garden_weather, public.garden_compost_jobs, public.garden_daily_grants,
  public.garden_day_resolutions, public.garden_actions to authenticated;
grant all on public.garden_species_profiles, public.garden_companion_rules,
  public.garden_weather_profiles, public.garden_item_catalog, public.garden_plants,
  public.apiary_hives, public.apiary_colonies, public.garden_inventory,
  public.garden_weather, public.garden_compost_jobs, public.garden_daily_grants,
  public.garden_day_resolutions, public.garden_actions to service_role;

create or replace function private.garden_weather_key(p_day integer)
returns text language sql immutable set search_path = '' as $$
  select case mod(p_day - 1, 3) when 0 then 'clear' when 1 then 'cloudy' else 'rainy' end;
$$;

create or replace function private.ensure_garden_ecosystem(p_save_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_day integer;
begin
  select current_day into v_day from public.tavern_saves where id = p_save_id for update;
  if not found then return; end if;

  update public.tavern_saves
  set garden_rules_version = 'garden-apiary-v1', updated_at = now()
  where id = p_save_id;

  update public.garden_cells
  set rules_version = 'garden-apiary-v1',
      soil_moisture = case when kind = 'plant' then coalesce(water, soil_moisture) else soil_moisture end
  where save_id = p_save_id;

  insert into public.garden_cells
    (save_id, layout_key, col, row, kind, rules_version, unlocked,
     soil_n, soil_p, soil_k, soil_moisture, soil_quality, site_light)
  values
    (p_save_id,'c12',3,0,'empty','garden-apiary-v1',false,60,60,60,55,60,78),
    (p_save_id,'c13',3,1,'empty','garden-apiary-v1',false,60,60,60,55,60,72),
    (p_save_id,'c14',3,2,'empty','garden-apiary-v1',false,60,60,60,55,60,75),
    (p_save_id,'c15',3,3,'empty','garden-apiary-v1',false,60,60,60,55,60,68),
    (p_save_id,'c16',4,0,'empty','garden-apiary-v1',false,55,55,55,50,55,82),
    (p_save_id,'c17',4,1,'empty','garden-apiary-v1',false,55,55,55,50,55,76),
    (p_save_id,'c18',4,2,'empty','garden-apiary-v1',false,55,55,55,50,55,70),
    (p_save_id,'c19',4,3,'empty','garden-apiary-v1',false,55,55,55,50,55,64),
    (p_save_id,'c20',5,0,'empty','garden-apiary-v1',false,50,50,50,48,52,86),
    (p_save_id,'c21',5,1,'empty','garden-apiary-v1',false,50,50,50,48,52,80),
    (p_save_id,'c22',5,2,'empty','garden-apiary-v1',false,50,50,50,48,52,74),
    (p_save_id,'c23',5,3,'empty','garden-apiary-v1',false,50,50,50,48,52,68)
  on conflict (save_id, layout_key) do nothing;

  insert into public.garden_plants
    (save_id, cell_id, rules_version, species_key, lifecycle, age_days,
     growth_progress, health, care_good_days, care_total_days, stress_points,
     flowering_days_remaining, ready_since_day, planted_day)
  select c.save_id, c.id, 'garden-apiary-v1', c.plant_key,
    case when c.growth_stage = 3 then 'mature' else 'growing' end,
    greatest(1, c.growth_stage * 2),
    case c.growth_stage when 1 then 28 when 2 then 64 else 100 end,
    c.health,
    greatest(1, round(c.health / 25.0)::integer),
    4,
    greatest(0, 100 - c.health),
    case when c.growth_stage = 3 then 2 else 0 end,
    case when c.growth_stage = 3 then v_day else null end,
    greatest(1, v_day - greatest(1, c.growth_stage * 2))
  from public.garden_cells c
  where c.save_id = p_save_id and c.kind = 'plant'
    and not exists (select 1 from public.garden_plants p where p.save_id = c.save_id and p.cell_id = c.id);

  insert into public.apiary_hives (save_id, cell_id, installed_day)
  select c.save_id, c.id, greatest(1, v_day)
  from public.garden_cells c
  where c.save_id = p_save_id and c.kind = 'beehive'
    and not exists (select 1 from public.apiary_hives h where h.save_id = c.save_id and h.cell_id = c.id);

  insert into public.apiary_colonies (save_id, hive_id, established_day)
  select h.save_id, h.id, greatest(1, v_day)
  from public.apiary_hives h
  where h.save_id = p_save_id
    and not exists (select 1 from public.apiary_colonies c where c.save_id = h.save_id and c.hive_id = h.id);

  insert into public.garden_weather (save_id, day_number, rules_version, weather_key)
  select p_save_id, d, 'garden-apiary-v1', private.garden_weather_key(d)
  from generate_series(v_day, v_day + 2) d
  on conflict do nothing;

  with granted as (
    insert into public.garden_daily_grants (save_id, day_number, grant_key, contents)
    values (p_save_id, v_day, 'migration-starter-v1', '{"seed_hops":2,"seed_clover":3}'::jsonb)
    on conflict do nothing returning 1
  )
  insert into public.garden_inventory (save_id, item_key, quantity)
  select p_save_id, item_key, quantity
  from granted, (values ('seed_hops',2),('seed_clover',3)) items(item_key,quantity)
  on conflict (save_id, item_key) do update
    set quantity = public.garden_inventory.quantity + excluded.quantity, updated_at = now();
end;
$$;

do $$
declare v_save uuid;
begin
  for v_save in select id from public.tavern_saves order by id loop
    perform private.ensure_garden_ecosystem(v_save);
  end loop;
end;
$$;

alter function public.create_tavern() rename to create_tavern_before_garden_apiary;
alter function public.create_tavern_before_garden_apiary() set schema private;
create function public.create_tavern()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := private.create_tavern_before_garden_apiary();
  perform private.ensure_garden_ecosystem((v_result->>'saveId')::uuid);
  return v_result;
end;
$$;

revoke all on function private.garden_weather_key(integer),
  private.ensure_garden_ecosystem(uuid), private.create_tavern_before_garden_apiary()
  from public, anon, authenticated;
revoke all on function public.create_tavern() from public, anon;
grant execute on function public.create_tavern() to authenticated;

commit;
