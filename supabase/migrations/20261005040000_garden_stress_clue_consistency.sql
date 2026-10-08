begin;

-- Keep visible plant observations internally consistent: when a recognized
-- stress symptom is present, omit the generic healthy-leaf reassurance.
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
  v_has_stress_clue boolean := false;
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
      if v_clue is not null then
        v_has_stress_clue := true;
        if not v_clue = any(v_clues) then
          v_clues := array_append(v_clues, v_clue);
        end if;
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
  elsif v_plant.health >= 76 and not v_has_stress_clue and v_plant.lifecycle <> 'dead' then
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

revoke all on function private.garden_observation_clues(uuid, uuid)
  from public, anon, authenticated;

commit;
