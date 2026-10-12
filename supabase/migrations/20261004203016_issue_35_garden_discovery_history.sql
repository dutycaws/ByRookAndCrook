-- Project qualitative garden clues separately from the simulation's private
-- numeric state. The UI can inspect these strings without receiving a diagnosis
-- or a prescribed treatment.
begin;

create or replace function private.garden_observation_clues(
  p_save_id uuid,
  p_cell_id uuid
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cell public.garden_cells%rowtype;
  v_plant public.garden_plants%rowtype;
  v_profile public.garden_species_profiles%rowtype;
  v_colony public.apiary_colonies%rowtype;
  v_symptom jsonb;
  v_clue text;
  v_clues text[] := array[]::text[];
  v_species_name text;
  v_has_visited_bees boolean := false;
begin
  select * into v_cell
  from public.garden_cells
  where save_id = p_save_id and id = p_cell_id;
  if not found then return v_clues; end if;

  -- These describe what a player might notice by looking at or touching the
  -- bed. Keep the thresholds inside the projection and never return the values.
  v_clues := array_append(v_clues, case
    when v_cell.soil_moisture <= 28 then 'The topsoil feels dry and loose.'
    when v_cell.soil_moisture >= 78 then 'The topsoil is heavy and slick.'
    else 'The topsoil feels cool with a little dampness.'
  end);
  v_clues := array_append(v_clues, case
    when v_cell.soil_quality < 38 then 'The bed feels thin and packed beneath the surface.'
    when v_cell.soil_quality >= 70 then 'The soil is dark and crumbly.'
    else 'The soil has a firm, even texture.'
  end);
  v_clues := array_append(v_clues, case
    when v_cell.site_light < 42 then 'Shade crosses this plot for much of the day.'
    when v_cell.site_light >= 70 then 'This plot is open to bright light.'
    else 'Sun and shade move across this plot.'
  end);

  select * into v_plant
  from public.garden_plants
  where save_id = p_save_id and cell_id = p_cell_id;
  if found then
    select * into v_profile
    from public.garden_species_profiles
    where rules_version = v_plant.rules_version and species_key = v_plant.species_key;

    for v_symptom in
      select value
      from jsonb_array_elements(private.garden_symptoms(
        v_cell.soil_n, v_cell.soil_p, v_cell.soil_k, v_cell.soil_moisture,
        v_cell.site_light, v_plant.health, v_profile
      ))
    loop
      v_clue := case v_symptom->>'code'
        when 'critical-health' then 'The leaves hang low, and several stems look brittle.'
        when 'nitrogen-low' then 'Older leaves have faded from their usual color.'
        when 'phosphorus-low' then 'New growth is slow and sparse.'
        when 'potassium-low' then 'The leaf edges look worn and uneven.'
        when 'nitrogen-high' then 'Long, soft stems carry plenty of leaves but few visible buds.'
        when 'phosphorus-high' then 'The newest leaves look unusually dark.'
        when 'potassium-high' then 'The newest leaf edges curl inward.'
        when 'underwatered' then 'The upper leaves droop, and the soil feels dry.'
        when 'overwatered' then 'The soil stays heavy, and lower leaves are turning yellow.'
        when 'light-low' then 'The stems lean toward the brighter edge of the plot.'
        when 'light-high' then 'Leaves on the sun-facing side show pale patches.'
        else null
      end;
      if v_clue is not null and not v_clue = any(v_clues) then
        v_clues := array_append(v_clues, v_clue);
      end if;
    end loop;

    if v_plant.lifecycle in ('flowering', 'mature') and v_plant.flowering_days_remaining > 0 then
      v_clues := array_append(v_clues, 'Open flowers remain on the plant.');
      select exists (
        select 1
        from public.apiary_hives h
        join public.garden_cells hc on hc.save_id = h.save_id and hc.id = h.cell_id
        join public.apiary_colonies ac on ac.save_id = h.save_id and ac.hive_id = h.id
        where h.save_id = p_save_id
          and ac.health > 0
          and private.hex_distance(v_cell.col, v_cell.row, hc.col, hc.row) <= 2
      ) into v_has_visited_bees;
      if v_has_visited_bees and v_profile.forage_value > 0 then
        v_clues := array_append(v_clues, 'A bee moves between the nearby hive and these flowers.');
      elsif v_profile.forage_value > 0 then
        v_clues := array_append(v_clues, 'The open flowers offer a small patch of forage.');
      end if;
  elsif v_plant.health >= 76 and v_plant.lifecycle <> 'dead' then
      v_clues := array_append(v_clues, 'The leaves hold their color and the stems stand upright.');
    end if;
  end if;

  -- Name close plant neighbors without exposing the authored companion effect
  -- or saying which arrangement is best.
  for v_species_name in
    select sp.display_name
    from public.garden_cells neighbor
    join public.garden_plants nearby on nearby.save_id = neighbor.save_id and nearby.cell_id = neighbor.id
    join public.garden_species_profiles sp on sp.rules_version = nearby.rules_version and sp.species_key = nearby.species_key
    where neighbor.save_id = p_save_id
      and neighbor.id <> p_cell_id
      and private.hex_distance(v_cell.col, v_cell.row, neighbor.col, neighbor.row) = 1
    order by neighbor.layout_key
  loop
    v_clue := v_species_name || ' grows beside this plot.';
    if not v_clue = any(v_clues) then v_clues := array_append(v_clues, v_clue); end if;
  end loop;

  select ac.* into v_colony
  from public.apiary_colonies ac
  join public.apiary_hives h on h.save_id = ac.save_id and h.id = ac.hive_id
  where h.save_id = p_save_id and h.cell_id = p_cell_id;
  if found then
    for v_symptom in
      select value
      from jsonb_array_elements(private.apiary_symptoms(
        v_colony.food_stores, v_colony.health, v_colony.varroa_pressure,
        v_colony.chalkbrood_pressure, v_colony.nosema_pressure
      ))
    loop
      v_clue := case v_symptom->>'code'
        when 'low-stores' then 'Only a little food is visible in the hive.'
        when 'health-critical' then 'Few workers are coming and going at the entrance.'
        when 'varroa-pressure' then 'Some workers move slowly across the hive entrance.'
        when 'chalkbrood-pressure' then 'A few brood cells look mottled.'
        when 'nosema-pressure' then 'The returning bees arrive in uneven little groups.'
        else null
      end;
      if v_clue is not null and not v_clue = any(v_clues) then
        v_clues := array_append(v_clues, v_clue);
      end if;
    end loop;
  elsif v_cell.kind = 'beehive' then
    v_clues := array_append(v_clues, 'The hive is quiet, with no colony installed.');
  end if;

  return v_clues;
end;
$$;

-- Convert authored simulation ranges into short, readable planting guidance.
-- Never send the underlying thresholds through the garden snapshot.
create or replace function private.garden_seed_guidance(
  p_rules_version text,
  p_species_key text
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when profile.species_key is null then array[]::text[] else array_remove(array[
    case
      when profile.light_min >= 60 then 'Prefers a bright, open spot.'
      when profile.light_min >= 48 then 'Grows well with sun for much of the day.'
      else 'Tolerates a little more shade than sun-loving crops.'
    end,
    case
      when profile.moisture_min >= 48 then 'Prefers steady moisture.'
      when profile.moisture_min >= 38 then 'Likes soil that stays evenly damp.'
      else 'Prefers a lighter touch with watering.'
    end,
    case when profile.forage_value > 0 then 'Its flowers offer forage for bees.' end,
    case when profile.regrows then 'Can produce again after its first harvest.' end,
    case when profile.height_class >= 3 then 'Give its taller growth room beside lower plants.' end
  ], null) end
  from (select 1) seed
  left join public.garden_species_profiles profile
    on profile.rules_version = p_rules_version and profile.species_key = p_species_key;
$$;

create table public.garden_plot_history (
  id bigint generated always as identity primary key,
  save_id uuid not null,
  cell_id uuid not null,
  day_number integer not null check (day_number > 0),
  event_kind text not null check (event_kind in (
    'planting', 'removal', 'watering', 'fertilizer', 'daily_observation'
  )),
  label text not null,
  quantity integer check (quantity is null or quantity >= 0),
  unit text,
  created_at timestamptz not null default now(),
  foreign key (save_id, cell_id) references public.garden_cells(save_id, id) on delete cascade
);

create index garden_plot_history_recent_idx
  on public.garden_plot_history(save_id, cell_id, day_number desc, id desc);

alter table public.garden_plot_history enable row level security;
revoke all on public.garden_plot_history from public, anon, authenticated;

create or replace function private.record_garden_action_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day integer;
  v_cell_id uuid;
  v_item_name text;
  v_plant_name text;
  v_quantity integer;
begin
  select current_day into v_day from public.tavern_saves where id = new.save_id;

  if new.command_kind = 'plant' then
    v_cell_id := (new.input_payload->>'cellId')::uuid;
    select display_name into v_plant_name from public.garden_species_profiles
    where rules_version = new.rules_version and species_key = new.result#>>'{result,speciesKey}';
    insert into public.garden_plot_history(save_id, cell_id, day_number, event_kind, label)
    values(new.save_id, v_cell_id, v_day, 'planting', 'Planted ' || coalesce(v_plant_name, 'a seed'));

  elsif new.command_kind = 'remove' then
    v_cell_id := (new.input_payload->>'cellId')::uuid;
    select display_name into v_plant_name from public.garden_species_profiles
    where rules_version = new.rules_version and species_key = new.result#>>'{result,speciesKey}';
    insert into public.garden_plot_history(save_id, cell_id, day_number, event_kind, label)
    values(new.save_id, v_cell_id, v_day, 'removal', 'Removed ' || coalesce(v_plant_name, 'the plant'));

  elsif new.command_kind = 'incorporate_clover' then
    v_cell_id := (new.input_payload->>'cellId')::uuid;
    insert into public.garden_plot_history(save_id, cell_id, day_number, event_kind, label)
    values(new.save_id, v_cell_id, v_day, 'removal', 'Incorporated clover');

  elsif new.command_kind in ('water', 'amend') then
    v_quantity := (new.input_payload->>'dose')::integer;
    if new.command_kind = 'water' then
      v_item_name := 'Watered';
    else
      select display_name into v_item_name from public.garden_item_catalog
      where rules_version = new.rules_version and item_key = new.input_payload->>'itemKey';
      v_item_name := 'Applied ' || coalesce(v_item_name, 'fertilizer');
    end if;

    insert into public.garden_plot_history(save_id, cell_id, day_number, event_kind, label, quantity, unit)
    select new.save_id, target.cell_id::uuid, v_day,
      case when new.command_kind = 'water' then 'watering' else 'fertilizer' end,
      v_item_name, v_quantity, case when new.command_kind = 'water' then 'water' else 'dose' end
    from jsonb_array_elements_text(new.input_payload->'cellIds') as target(cell_id);
  end if;

  return new;
end;
$$;

create trigger garden_actions_record_plot_history
after insert on public.garden_actions
for each row execute function private.record_garden_action_history();

create or replace function private.record_garden_harvest_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_day integer;
begin
  select current_day into v_day from public.tavern_saves where id = new.save_id;
  select display_name into v_name
  from public.garden_plants plant
  join public.garden_species_profiles profile
    on profile.rules_version = plant.rules_version and profile.species_key = plant.species_key
  where plant.save_id = new.save_id and plant.cell_id = new.input_cell_id;
  insert into public.garden_plot_history(save_id, cell_id, day_number, event_kind, label)
  values(new.save_id, new.input_cell_id, v_day, 'removal', 'Harvested ' || coalesce(v_name, 'the crop'));
  return new;
end;
$$;

create trigger game_actions_record_plot_harvest
after insert on public.game_actions
for each row when (new.command_kind = 'harvest_crop')
execute function private.record_garden_harvest_history();

create or replace function private.record_garden_daily_observations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell record;
  v_clue text;
begin
  -- Keep the seven most recent game days. History is a compact learning aid,
  -- not a permanent event archive.
  delete from public.garden_plot_history
  where save_id = new.save_id and day_number < greatest(1, new.day_number - 6);

  for v_cell in
    select id from public.garden_cells
    where save_id = new.save_id and unlocked
    order by layout_key
  loop
    foreach v_clue in array private.garden_observation_clues(new.save_id, v_cell.id)
    loop
      insert into public.garden_plot_history(save_id, cell_id, day_number, event_kind, label)
      values(new.save_id, v_cell.id, new.day_number, 'daily_observation', v_clue);
    end loop;
  end loop;
  return new;
end;
$$;

create trigger garden_day_resolutions_record_observations
after insert on public.garden_day_resolutions
for each row execute function private.record_garden_daily_observations();

create or replace function private.garden_discovery_projection(p_save_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(
    c.id::text,
    jsonb_build_object(
      'observations', to_jsonb(private.garden_observation_clues(p_save_id, c.id)),
      'careHistory', coalesce((
        select jsonb_agg(jsonb_build_object(
          'dayNumber', history.day_number,
          'kind', history.event_kind,
          'label', history.label,
          'quantity', history.quantity,
          'unit', history.unit
        ) order by history.day_number, history.id)
        from public.garden_plot_history history
        join public.tavern_saves save on save.id = history.save_id
        where history.save_id = p_save_id and history.cell_id = c.id
          and history.day_number between greatest(1, save.current_day - 6) and save.current_day
      ), '[]'::jsonb)
    )
  ), '{}'::jsonb)
  from public.garden_cells c
  where c.save_id = p_save_id;
$$;

revoke all on function private.garden_observation_clues(uuid, uuid),
  private.garden_seed_guidance(text, text),
  private.garden_discovery_projection(uuid),
  private.record_garden_action_history(),
  private.record_garden_harvest_history(),
  private.record_garden_daily_observations() from public, anon, authenticated;

commit;
