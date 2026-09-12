-- Add the single authoritative garden projection/commit kernel and integrate it
-- into the latest day, harvest, and snapshot boundaries.
begin;

create or replace function private.clamp_int(p_value integer, p_min integer, p_max integer)
returns integer language sql immutable set search_path = '' as $$
  select greatest(p_min, least(p_max, p_value));
$$;

create or replace function private.garden_quality_index(
  p_good_days integer,
  p_total_days integer,
  p_stress_points integer,
  p_companion_points integer,
  p_pollination_points integer
)
returns smallint language sql immutable set search_path = '' as $$
  select private.clamp_int(
    (case when p_total_days <= 0 then 3 else
      round(
        2.0
        + 4.0 * p_good_days / p_total_days
        - least(2.0, p_stress_points / greatest(20.0, p_total_days * 12.0))
        + greatest(-0.75, least(0.75, p_companion_points / greatest(20.0, p_total_days * 8.0)))
        + least(0.5, p_pollination_points / greatest(20.0, p_total_days * 10.0))
      )::integer
    end)::integer,
    0, 6
  )::smallint;
$$;

create or replace function private.garden_symptoms(
  p_n integer, p_p integer, p_k integer, p_moisture integer, p_light integer,
  p_health integer, p_profile public.garden_species_profiles
)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(symptom order by priority, code), '[]'::jsonb)
  from (
    select 1 priority, 'critical-health' code,
      jsonb_build_object('code','critical-health','severity','critical','label','Plant failing',
        'cause','Health has fallen into the critical range. Correct the listed care problems before another day passes.') symptom
      where p_health <= 20
    union all
    select 2, 'nitrogen-low', jsonb_build_object('code','nitrogen-low','severity','warning','label','Pale leaves',
      'cause','Local nitrogen is below this species'' preferred range.') where p_n < p_profile.n_min
    union all
    select 2, 'phosphorus-low', jsonb_build_object('code','phosphorus-low','severity','warning','label','Slow roots',
      'cause','Local phosphorus is below this species'' preferred range.') where p_p < p_profile.p_min
    union all
    select 2, 'potassium-low', jsonb_build_object('code','potassium-low','severity','warning','label','Weak growth',
      'cause','Local potassium is below this species'' preferred range.') where p_k < p_profile.k_min
    union all
    select 2, 'nitrogen-high', jsonb_build_object('code','nitrogen-high','severity','warning','label','Nitrogen excess',
      'cause','Local nitrogen exceeds this species'' preferred range; another dose will intensify stress.') where p_n > p_profile.n_max
    union all
    select 2, 'phosphorus-high', jsonb_build_object('code','phosphorus-high','severity','warning','label','Phosphorus excess',
      'cause','Local phosphorus exceeds this species'' preferred range; another dose will intensify stress.') where p_p > p_profile.p_max
    union all
    select 2, 'potassium-high', jsonb_build_object('code','potassium-high','severity','warning','label','Potassium excess',
      'cause','Local potassium exceeds this species'' preferred range; another dose will intensify stress.') where p_k > p_profile.k_max
    union all
    select 2, 'underwatered', jsonb_build_object('code','underwatered','severity','warning','label','Dry and wilting',
      'cause','Moisture is below this species'' preferred range.') where p_moisture < p_profile.moisture_min
    union all
    select 2, 'overwatered', jsonb_build_object('code','overwatered','severity','warning','label','Waterlogged soil',
      'cause','Moisture is above this species'' preferred range; more water will increase stress.') where p_moisture > p_profile.moisture_max
    union all
    select 2, 'light-low', jsonb_build_object('code','light-low','severity','warning','label','Reaching for light',
      'cause','Site and neighboring shade leave too little effective light.') where p_light < p_profile.light_min
    union all
    select 2, 'light-high', jsonb_build_object('code','light-high','severity','warning','label','Sun-scorched',
      'cause','Effective light exceeds this species'' tolerance.') where p_light > p_profile.light_max
  ) symptoms;
$$;

create or replace function private.garden_day_input(p_save_id uuid, p_day integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rulesVersion', s.garden_rules_version,
    'day', p_day,
    'plotCount', s.garden_plot_count,
    'weather', jsonb_build_object('key', w.weather_key, 'rainfall', wp.rainfall,
      'drying', wp.drying, 'lightDelta', wp.light_delta),
    'cells', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'layoutKey', c.layout_key, 'col', c.col, 'row', c.row,
      'n', c.soil_n, 'p', c.soil_p, 'k', c.soil_k, 'moisture', c.soil_moisture,
      'quality', c.soil_quality, 'siteLight', c.site_light,
      'plant', case when gp.id is null then null else jsonb_build_object(
        'id', gp.id, 'species', gp.species_key, 'lifecycle', gp.lifecycle,
        'ageDays', gp.age_days, 'progress', gp.growth_progress, 'health', gp.health,
        'cycle', gp.production_cycle, 'goodDays', gp.care_good_days,
        'totalDays', gp.care_total_days, 'stress', gp.stress_points,
        'companion', gp.companion_points, 'pollination', gp.pollination_points,
        'floweringRemaining', gp.flowering_days_remaining, 'readySinceDay', gp.ready_since_day,
        'threatDays', gp.threat_days
      ) end,
      'hive', case when h.id is null then null else jsonb_build_object(
        'id', h.id, 'condition', h.equipment_condition,
        'colony', case when ac.id is null then null else jsonb_build_object(
          'id', ac.id, 'adults', ac.adults, 'brood', ac.brood, 'health', ac.health,
          'food', ac.food_stores, 'floralHoney', ac.floral_honey, 'feed', ac.feed_stores,
          'varroa', ac.varroa_pressure, 'chalkbrood', ac.chalkbrood_pressure,
          'nosema', ac.nosema_pressure, 'treatment', ac.treatment_key,
          'treatmentDays', ac.treatment_days_remaining, 'threatDays', ac.threat_days
        ) end
      ) end
    ) order by c.layout_key) from public.garden_cells c
      left join public.garden_plants gp on gp.save_id=c.save_id and gp.cell_id=c.id
      left join public.apiary_hives h on h.save_id=c.save_id and h.cell_id=c.id
      left join public.apiary_colonies ac on ac.save_id=h.save_id and ac.hive_id=h.id
      where c.save_id=s.id and c.unlocked), '[]'::jsonb),
    'compost', coalesce((select jsonb_agg(to_jsonb(j) order by j.id)
      from public.garden_compost_jobs j where j.save_id=s.id), '[]'::jsonb)
  )
  from public.tavern_saves s
  join public.garden_weather w on w.save_id=s.id and w.day_number=p_day
  join public.garden_weather_profiles wp on wp.rules_version=w.rules_version and wp.weather_key=w.weather_key
  where s.id=p_save_id;
$$;

create or replace function private.resolve_garden_day(p_save_id uuid, p_day integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_input jsonb;
  v_weather public.garden_weather_profiles%rowtype;
  v_cell public.garden_cells%rowtype;
  v_plant public.garden_plants%rowtype;
  v_profile public.garden_species_profiles%rowtype;
  v_colony record;
  v_jobs jsonb := '[]'::jsonb;
  v_plots jsonb := '[]'::jsonb;
  v_colonies jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_compost record;
  v_release_n integer;
  v_release_p integer;
  v_release_k integer;
  v_release_quality integer;
  v_moisture integer;
  v_light integer;
  v_shade integer;
  v_companion integer;
  v_pollinated boolean;
  v_good boolean;
  v_health_delta integer;
  v_health integer;
  v_threat integer;
  v_progress_delta integer;
  v_progress integer;
  v_lifecycle text;
  v_flowering integer;
  v_ready_day integer;
  v_forage integer;
  v_n integer;
  v_p integer;
  v_k integer;
  v_quality integer;
  v_allocated integer;
  v_competitors integer;
  v_food integer;
  v_honey integer;
  v_varroa integer;
  v_chalk integer;
  v_nosema integer;
  v_treatment_days integer;
  v_colony_health integer;
  v_colony_threat integer;
  v_core jsonb;
  v_plan_fingerprint text;
begin
  v_input := private.garden_day_input(p_save_id, p_day);
  if v_input is null then raise exception 'Garden day input unavailable'; end if;

  select wp.* into strict v_weather
  from public.garden_weather w
  join public.garden_weather_profiles wp on wp.rules_version=w.rules_version and wp.weather_key=w.weather_key
  where w.save_id=p_save_id and w.day_number=p_day;

  for v_compost in
    select j.* from public.garden_compost_jobs j
    where j.save_id=p_save_id order by j.id
  loop
    v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
      'id',v_compost.id,'cellId',v_compost.cell_id,
      'released',v_compost.ready_day <= p_day,
      'nextReadyDay',case when v_compost.ready_day <= p_day then p_day+1 else v_compost.ready_day end,
      'remaining',case when v_compost.ready_day <= p_day then v_compost.releases_remaining-1 else v_compost.releases_remaining end
    ));
  end loop;

  for v_cell in
    select * from public.garden_cells where save_id=p_save_id and unlocked order by layout_key
  loop
    select coalesce(sum(n_per_release),0), coalesce(sum(p_per_release),0),
      coalesce(sum(k_per_release),0), coalesce(sum(quality_per_release),0)
    into v_release_n,v_release_p,v_release_k,v_release_quality
    from public.garden_compost_jobs
    where save_id=p_save_id and cell_id=v_cell.id and ready_day <= p_day;

    v_moisture := private.clamp_int(
      v_cell.soil_moisture + v_weather.rainfall
      - greatest(1, v_weather.drying - round(v_cell.soil_quality / 20.0)::integer), 0, 100);
    v_n := private.clamp_int(v_cell.soil_n + v_release_n,0,100);
    v_p := private.clamp_int(v_cell.soil_p + v_release_p,0,100);
    v_k := private.clamp_int(v_cell.soil_k + v_release_k,0,100);
    v_quality := private.clamp_int(v_cell.soil_quality + v_release_quality,0,100);

    select * into v_plant from public.garden_plants
    where save_id=p_save_id and cell_id=v_cell.id;
    if found then
      select * into strict v_profile from public.garden_species_profiles
      where rules_version=v_plant.rules_version and species_key=v_plant.species_key;

      select count(*) * 8 into v_shade
      from public.garden_plants other
      join public.garden_cells oc on oc.save_id=other.save_id and oc.id=other.cell_id
      join public.garden_species_profiles op on op.rules_version=other.rules_version and op.species_key=other.species_key
      where other.save_id=p_save_id and other.id<>v_plant.id and other.lifecycle<>'dead'
        and private.hex_distance(v_cell.col,v_cell.row,oc.col,oc.row)=1
        and op.height_class > v_profile.height_class;
      v_light := private.clamp_int(v_cell.site_light + v_weather.light_delta - least(24,v_shade),0,100);

      select coalesce(sum(cr.effect),0) into v_companion
      from public.garden_plants other
      join public.garden_cells oc on oc.save_id=other.save_id and oc.id=other.cell_id
      join public.garden_companion_rules cr on cr.rules_version=v_plant.rules_version
        and cr.species_a=least(v_plant.species_key,other.species_key)
        and cr.species_b=greatest(v_plant.species_key,other.species_key)
      where other.save_id=p_save_id and other.id<>v_plant.id and other.lifecycle<>'dead'
        and private.hex_distance(v_cell.col,v_cell.row,oc.col,oc.row)=1;
      v_companion := private.clamp_int(v_companion,-10,10);

      v_pollinated := v_profile.pollination_eligible and exists (
        select 1 from public.apiary_hives h
        join public.apiary_colonies ac on ac.save_id=h.save_id and ac.hive_id=h.id and ac.health>20 and ac.adults>1000
        join public.garden_cells hc on hc.save_id=h.save_id and hc.id=h.cell_id
        where h.save_id=p_save_id and private.hex_distance(v_cell.col,v_cell.row,hc.col,hc.row)<=2
      );
      v_good := v_plant.lifecycle<>'dead'
        and v_moisture between v_profile.moisture_min and v_profile.moisture_max
        and v_cell.soil_n between v_profile.n_min and v_profile.n_max
        and v_cell.soil_p between v_profile.p_min and v_profile.p_max
        and v_cell.soil_k between v_profile.k_min and v_profile.k_max
        and v_light between v_profile.light_min and v_profile.light_max;
      v_health_delta := case when v_good then 4 else -(
        (case when v_moisture < v_profile.moisture_min or v_moisture > v_profile.moisture_max then 5 else 0 end)
        +(case when v_cell.soil_n not between v_profile.n_min and v_profile.n_max
          or v_cell.soil_p not between v_profile.p_min and v_profile.p_max
          or v_cell.soil_k not between v_profile.k_min and v_profile.k_max then 4 else 0 end)
        +(case when v_light<v_profile.light_min or v_light>v_profile.light_max then 3 else 0 end)
      ) end + round(v_companion/4.0)::integer;
      v_health := private.clamp_int(v_plant.health + v_health_delta,0,100);
      v_threat := case when v_health<=25 then v_plant.threat_days+1 else 0 end;
      if v_health=0 and v_threat>=3 then v_lifecycle:='dead';
      else v_lifecycle:=v_plant.lifecycle; end if;

      v_progress_delta := case when v_lifecycle='dead' then 0 else
        greatest(1,round(100.0/v_profile.maturity_days * case when v_good then 1.0 else .45 end)::integer)
      end;
      v_progress := private.clamp_int(v_plant.growth_progress+v_progress_delta,0,100);
      if v_lifecycle<>'dead' then
        if v_progress>=100 then v_lifecycle:='mature';
        elsif v_progress>=v_profile.flowering_start and v_profile.flowering_days>0 then v_lifecycle:='flowering';
        elsif v_plant.lifecycle='regrowing' then v_lifecycle:='regrowing';
        elsif v_progress<25 then v_lifecycle:='seedling';
        else v_lifecycle:='growing'; end if;
      end if;
      v_flowering := case
        when v_lifecycle='flowering' and v_plant.flowering_days_remaining=0 then v_profile.flowering_days
        when v_lifecycle in ('flowering','mature') then greatest(0,v_plant.flowering_days_remaining-1)
        else 0 end;
      v_ready_day := case when v_lifecycle='mature' then coalesce(v_plant.ready_since_day,p_day) else null end;
      v_forage := case when v_lifecycle in ('flowering','mature') and v_flowering>0 then v_profile.forage_value else 0 end;

      if v_lifecycle<>'dead' then
        v_n:=private.clamp_int(v_n-v_profile.n_use,0,100);
        v_p:=private.clamp_int(v_p-v_profile.p_use,0,100);
        v_k:=private.clamp_int(v_k-v_profile.k_use,0,100);
      end if;

      if not v_good or v_health<=25 then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'kind','plant-warning','targetId',v_plant.id,'layoutKey',v_cell.layout_key,
          'label',v_profile.display_name,'severity',case when v_health<=20 then 'critical' else 'warning' end,
          'message',case when v_health<=20 then v_profile.display_name||' may be lost after another neglected day.'
            else v_profile.display_name||' is under visible care stress.' end));
      elsif v_lifecycle='mature' and v_plant.lifecycle<>'mature' then
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'kind','crop-ready','targetId',v_plant.id,'layoutKey',v_cell.layout_key,
          'label',v_profile.display_name,'severity','info','message',v_profile.display_name||' is ready to harvest.'));
      end if;

      v_plots := v_plots || jsonb_build_array(jsonb_build_object(
        'cellId',v_cell.id,'layoutKey',v_cell.layout_key,'col',v_cell.col,'row',v_cell.row,
        'soil',jsonb_build_object('n',v_n,'p',v_p,'k',v_k,'moisture',v_moisture,'quality',v_quality,'light',v_light),
        'forage',v_forage,'pollinated',v_pollinated,
        'plant',jsonb_build_object('id',v_plant.id,'lifecycle',v_lifecycle,
          'ageDays',v_plant.age_days+1,'progress',v_progress,'health',v_health,
          'goodDays',v_plant.care_good_days+(case when v_good then 1 else 0 end),
          'totalDays',v_plant.care_total_days+1,
          'stress',v_plant.stress_points+(case when v_good then 0 else abs(v_health_delta) end),
          'companion',v_plant.companion_points+v_companion,
          'pollination',v_plant.pollination_points+(case when v_pollinated then 1 else 0 end),
          'floweringRemaining',v_flowering,'readySinceDay',v_ready_day,'threatDays',v_threat)
      ));
    else
      v_light:=private.clamp_int(v_cell.site_light+v_weather.light_delta,0,100);
      v_plots := v_plots || jsonb_build_array(jsonb_build_object(
        'cellId',v_cell.id,'layoutKey',v_cell.layout_key,'col',v_cell.col,'row',v_cell.row,
        'soil',jsonb_build_object('n',v_n,'p',v_p,'k',v_k,'moisture',v_moisture,'quality',v_quality,'light',v_light),
        'forage',0,'pollinated',false,'plant',null));
    end if;
  end loop;

  for v_colony in
    select ac.*, h.cell_id, hc.col, hc.row
    from public.apiary_colonies ac
    join public.apiary_hives h on h.save_id=ac.save_id and h.id=ac.hive_id
    join public.garden_cells hc on hc.save_id=h.save_id and hc.id=h.cell_id
    where ac.save_id=p_save_id order by ac.id
  loop
    select coalesce(sum((plot->>'forage')::integer / greatest(1,(
      select count(*) from public.apiary_colonies rivals
      join public.apiary_hives rh on rh.save_id=rivals.save_id and rh.id=rivals.hive_id
      join public.garden_cells rc on rc.save_id=rh.save_id and rc.id=rh.cell_id
      where rivals.save_id=p_save_id and rivals.health>0
        and private.hex_distance((plot->>'col')::smallint,(plot->>'row')::smallint,rc.col,rc.row)<=2
    ))),0)::integer into v_allocated
    from jsonb_array_elements(v_plots) plot
    where (plot->>'forage')::integer>0
      and private.hex_distance((plot->>'col')::smallint,(plot->>'row')::smallint,v_colony.col,v_colony.row)<=2;
    select count(*) into v_competitors
    from public.apiary_colonies rivals
    join public.apiary_hives rh on rh.save_id=rivals.save_id and rh.id=rivals.hive_id
    join public.garden_cells rc on rc.save_id=rh.save_id and rc.id=rh.cell_id
    where rivals.save_id=p_save_id and rivals.id<>v_colony.id and rivals.health>0
      and private.hex_distance(v_colony.col,v_colony.row,rc.col,rc.row)<=4;

    v_treatment_days:=greatest(0,v_colony.treatment_days_remaining-1);
    v_varroa:=private.clamp_int(v_colony.varroa_pressure
      +(case when v_colony.brood>1500 then 2 else 1 end)
      -(case when v_colony.treatment_key='varroa' and v_colony.treatment_days_remaining>0 then 9 else 0 end),0,100);
    v_chalk:=private.clamp_int(v_colony.chalkbrood_pressure
      +(case when v_weather.weather_key='rainy' then 4 else -1 end)
      -(case when v_colony.treatment_key='chalkbrood' and v_colony.treatment_days_remaining>0 then 8 else 0 end),0,100);
    v_nosema:=private.clamp_int(v_colony.nosema_pressure
      +(case when v_competitors>0 and exists(select 1 from public.apiary_colonies n where n.save_id=p_save_id and n.id<>v_colony.id and n.nosema_pressure>=35) then 3 else -1 end)
      -(case when v_colony.treatment_key='nosema' and v_colony.treatment_days_remaining>0 then 8 else 0 end),0,100);
    v_food:=private.clamp_int(v_colony.food_stores + floor(v_allocated/2.0)::integer - greatest(3,round(v_colony.adults/2500.0)::integer),0,1000);
    v_honey:=private.clamp_int(v_colony.floral_honey
      + case when v_colony.treatment_days_remaining>0 then 0 else floor(v_allocated/3.0)::integer end,0,1000);
    v_colony_health:=private.clamp_int(v_colony.health
      +(case when v_food>0 then 2 else -10 end)
      -(case when greatest(v_varroa,v_chalk,v_nosema)>=60 then 8 when greatest(v_varroa,v_chalk,v_nosema)>=35 then 3 else 0 end),0,100);
    v_colony_threat:=case when v_colony_health<=20 then v_colony.threat_days+1 else 0 end;

    if v_colony_health<=20 then
      v_events:=v_events||jsonb_build_array(jsonb_build_object(
        'kind','colony-warning','targetId',v_colony.id,'layoutKey',
        (select layout_key from public.garden_cells where id=v_colony.cell_id),
        'label','Bee colony','severity','critical',
        'message','The colony may be lost after another day without corrective care.'));
    end if;
    v_colonies:=v_colonies||jsonb_build_array(jsonb_build_object(
      'id',v_colony.id,'hiveId',v_colony.hive_id,'allocatedForage',v_allocated,
      'adults',private.clamp_int(v_colony.adults+(case when v_food>0 and v_colony_health>30 then 180 else -350 end),0,50000),
      'brood',private.clamp_int(v_colony.brood+(case when v_food>8 and v_colony_health>40 then 80 else -120 end),0,20000),
      'health',v_colony_health,'food',v_food,'floralHoney',v_honey,'feed',v_colony.feed_stores,
      'varroa',v_varroa,'chalkbrood',v_chalk,'nosema',v_nosema,
      'treatment',case when v_treatment_days=0 then null else v_colony.treatment_key end,
      'treatmentDays',v_treatment_days,'threatDays',v_colony_threat,
      'lost',v_colony_health=0 and v_colony_threat>=3));
  end loop;

  v_core:=jsonb_build_object(
    'rulesVersion','garden-apiary-v1','day',p_day,
    'weather',jsonb_build_object('key',v_weather.weather_key,'name',v_weather.display_name),
    'plots',v_plots,'colonies',v_colonies,'compost',v_jobs,
    'report',jsonb_build_object('day',p_day,'weather',v_weather.display_name,
      'events',v_events,'summary',case when jsonb_array_length(v_events)=0
        then 'The garden remained steady.' else jsonb_array_length(v_events)||' garden developments need attention.' end));
  v_plan_fingerprint:=md5(v_core::text);
  return v_core||jsonb_build_object('inputFingerprint',md5(v_input::text),'planFingerprint',v_plan_fingerprint);
end;
$$;

create or replace function private.apply_garden_day(
  p_save_id uuid, p_action_id uuid, p_day integer, p_plan jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_plot jsonb; v_colony jsonb; v_job jsonb; v_granted boolean;
begin
  for v_plot in select value from jsonb_array_elements(p_plan->'plots') loop
    update public.garden_cells set
      soil_n=(v_plot#>>'{soil,n}')::smallint,
      soil_p=(v_plot#>>'{soil,p}')::smallint,
      soil_k=(v_plot#>>'{soil,k}')::smallint,
      soil_moisture=(v_plot#>>'{soil,moisture}')::smallint,
      soil_quality=(v_plot#>>'{soil,quality}')::smallint,
      water=case when kind='plant' then (v_plot#>>'{soil,moisture}')::smallint else null end,
      updated_at=now()
    where save_id=p_save_id and id=(v_plot->>'cellId')::uuid;

    if v_plot->'plant' is not null and v_plot->'plant'<>'null'::jsonb then
      update public.garden_plants set
        lifecycle=v_plot#>>'{plant,lifecycle}', age_days=(v_plot#>>'{plant,ageDays}')::integer,
        growth_progress=(v_plot#>>'{plant,progress}')::smallint, health=(v_plot#>>'{plant,health}')::smallint,
        care_good_days=(v_plot#>>'{plant,goodDays}')::integer,
        care_total_days=(v_plot#>>'{plant,totalDays}')::integer,
        stress_points=(v_plot#>>'{plant,stress}')::integer,
        companion_points=(v_plot#>>'{plant,companion}')::integer,
        pollination_points=(v_plot#>>'{plant,pollination}')::integer,
        flowering_days_remaining=(v_plot#>>'{plant,floweringRemaining}')::smallint,
        ready_since_day=case when v_plot#>>'{plant,readySinceDay}' is null then null else (v_plot#>>'{plant,readySinceDay}')::integer end,
        threat_days=(v_plot#>>'{plant,threatDays}')::smallint, updated_at=now()
      where save_id=p_save_id and id=(v_plot#>>'{plant,id}')::uuid;
      update public.garden_cells set
        growth_stage=case when v_plot#>>'{plant,lifecycle}'='dead' then 0
          when (v_plot#>>'{plant,progress}')::integer>=100 then 3
          when (v_plot#>>'{plant,progress}')::integer>=50 then 2 else 1 end,
        health=(v_plot#>>'{plant,health}')::smallint
      where save_id=p_save_id and id=(v_plot->>'cellId')::uuid;
    end if;
  end loop;

  for v_job in select value from jsonb_array_elements(p_plan->'compost') loop
    if (v_job->>'released')::boolean then
      if (v_job->>'remaining')::integer<=0 then
        delete from public.garden_compost_jobs where save_id=p_save_id and id=(v_job->>'id')::uuid;
      else
        update public.garden_compost_jobs set
          ready_day=(v_job->>'nextReadyDay')::integer,
          releases_remaining=(v_job->>'remaining')::smallint
        where save_id=p_save_id and id=(v_job->>'id')::uuid;
      end if;
    end if;
  end loop;

  for v_colony in select value from jsonb_array_elements(p_plan->'colonies') loop
    if (v_colony->>'lost')::boolean then
      delete from public.apiary_colonies where save_id=p_save_id and id=(v_colony->>'id')::uuid;
    else
      update public.apiary_colonies set
        adults=(v_colony->>'adults')::integer, brood=(v_colony->>'brood')::integer,
        health=(v_colony->>'health')::smallint, food_stores=(v_colony->>'food')::integer,
        floral_honey=(v_colony->>'floralHoney')::integer, feed_stores=(v_colony->>'feed')::integer,
        varroa_pressure=(v_colony->>'varroa')::smallint,
        chalkbrood_pressure=(v_colony->>'chalkbrood')::smallint,
        nosema_pressure=(v_colony->>'nosema')::smallint,
        treatment_key=v_colony->>'treatment',
        treatment_days_remaining=(v_colony->>'treatmentDays')::smallint,
        threat_days=(v_colony->>'threatDays')::smallint, updated_at=now()
      where save_id=p_save_id and id=(v_colony->>'id')::uuid;
    end if;
  end loop;

  insert into public.garden_day_resolutions
    (save_id,day_number,action_id,rules_version,input_fingerprint,plan_fingerprint,plan,report)
  values (p_save_id,p_day,p_action_id,p_plan->>'rulesVersion',p_plan->>'inputFingerprint',
    p_plan->>'planFingerprint',p_plan,p_plan->'report');

  with inserted as (
    insert into public.garden_daily_grants(save_id,day_number,grant_key,contents)
    values(p_save_id,p_day+1,'daily-basics-v1','{"seed_hops":1,"seed_clover":1}'::jsonb)
    on conflict do nothing returning true
  ) select coalesce(bool_or(true),false) into v_granted from inserted;
  if v_granted then
    insert into public.garden_inventory(save_id,item_key,quantity)
    values(p_save_id,'seed_hops',1),(p_save_id,'seed_clover',1)
    on conflict(save_id,item_key) do update set
      quantity=public.garden_inventory.quantity+excluded.quantity, updated_at=now();
  end if;

  insert into public.garden_weather(save_id,day_number,rules_version,weather_key)
  values(p_save_id,p_day+3,'garden-apiary-v1',private.garden_weather_key(p_day+3))
  on conflict do nothing;
end;
$$;

create function public.project_garden_day()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_save public.tavern_saves;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  select * into v_save from public.tavern_saves where user_id=auth.uid();
  if not found then return null; end if;
  return private.resolve_garden_day(v_save.id,v_save.current_day);
end;
$$;

create or replace function public.harvest_crop(
  p_save_id uuid, p_cell_id uuid, p_action_id uuid, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_save public.tavern_saves; v_cell public.garden_cells;
  v_plant public.garden_plants; v_profile public.garden_species_profiles;
  v_action public.game_actions; v_batch uuid:=extensions.gen_random_uuid();
  v_quality smallint; v_quantity integer; v_brew smallint; v_bake smallint; v_result jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_cell_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0
    then raise sqlstate 'PT400' using message='Invalid harvest request'; end if;
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or garden cell not found'; end if;
  select * into v_action from public.game_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_action.input_cell_id=p_cell_id and v_action.input_expected_revision=p_expected_revision then return v_action.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if v_save.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Garden state changed; refresh before harvesting'; end if;
  select * into v_cell from public.garden_cells where save_id=p_save_id and id=p_cell_id and unlocked for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or garden cell not found'; end if;
  select * into v_plant from public.garden_plants where save_id=p_save_id and cell_id=p_cell_id for update;
  if not found or v_plant.lifecycle<>'mature' then raise sqlstate 'PT422' using message='Only a mature crop can be harvested'; end if;
  select * into strict v_profile from public.garden_species_profiles
    where rules_version=v_plant.rules_version and species_key=v_plant.species_key;
  v_quality:=private.garden_quality_index(v_plant.care_good_days,v_plant.care_total_days,
    v_plant.stress_points,v_plant.companion_points,v_plant.pollination_points);
  v_quantity:=v_profile.base_yield+case when v_profile.pollination_eligible
    and v_plant.pollination_points*2>=greatest(1,v_plant.care_total_days) then 1 else 0 end;
  if v_plant.ready_since_day is not null and v_save.current_day-v_plant.ready_since_day>=3 then
    v_quality:=greatest(0,v_quality-1); v_quantity:=greatest(1,v_quantity-1);
  end if;
  v_brew:=private.recipe_modifier(v_profile.base_brew_bonus,v_quality);
  v_bake:=private.recipe_modifier(v_profile.base_bake_bonus,v_quality);
  v_result:=jsonb_build_object('actionId',p_action_id,'cellId',p_cell_id,'ingredientBatchId',v_batch,
    'quantity',v_quantity,'qualityIndex',v_quality,'brewBonus',v_brew,'bakeBonus',v_bake,
    'committedRevision',v_save.revision+1,'rulesVersion','garden-apiary-v1',
    'regrowing',v_profile.regrows,'productionCycle',v_plant.production_cycle);
  insert into public.game_actions(save_id,action_id,actor_id,command_kind,input_cell_id,
    input_expected_revision,rules_version,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,'harvest_crop',p_cell_id,p_expected_revision,
    'garden-apiary-v1',v_result,v_save.revision+1);
  insert into public.ingredient_batches(id,save_id,rules_version,plant_key,quality_index,quantity,
    brew_bonus,bake_bonus,source_cell_id,source_action_id)
  values(v_batch,p_save_id,'garden-apiary-v1',v_plant.species_key,v_quality,v_quantity,
    v_brew,v_bake,p_cell_id,p_action_id);
  if v_profile.regrows then
    update public.garden_plants set lifecycle='regrowing',growth_progress=35,production_cycle=production_cycle+1,
      care_good_days=0,care_total_days=0,stress_points=0,companion_points=0,pollination_points=0,
      flowering_days_remaining=0,ready_since_day=null,threat_days=0,updated_at=now()
    where id=v_plant.id;
    update public.garden_cells set growth_stage=1,updated_at=now() where id=p_cell_id;
  else
    delete from public.garden_plants where id=v_plant.id;
    update public.garden_cells set kind='empty',plant_key=null,growth_stage=null,water=null,health=null,updated_at=now()
    where id=p_cell_id;
  end if;
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=p_save_id;
  return v_result;
end;
$$;

alter function public.advance_tavern_day(uuid,uuid,bigint)
  rename to advance_tavern_day_before_garden_apiary;
alter function public.advance_tavern_day_before_garden_apiary(uuid,uuid,bigint)
  set schema private;
create function public.advance_tavern_day(
  p_save_id uuid,p_action_id uuid,p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_plan jsonb; v_result jsonb;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0
    then raise sqlstate 'PT400' using message='Invalid day transition'; end if;
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into v_prior from public.craft_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_prior.command_kind='advance_day' and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier already used';
  end if;
  if v_save.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before closing'; end if;
  if exists(select 1 from public.brew_sessions where save_id=p_save_id and status='active')
    then raise sqlstate 'PT422' using message='Finish the active brew before closing'; end if;
  if exists(select 1 from public.bake_sessions where save_id=p_save_id and status<>'completed')
    then raise sqlstate 'PT422' using message='Finish the active bake before closing'; end if;
  if exists(select 1 from public.dialogue_turns where save_id=p_save_id and status='processing' and lease_until>now())
    then raise sqlstate 'PT409' using message='Finish or cancel the pending conversation before closing'; end if;
  v_plan:=private.resolve_garden_day(p_save_id,v_save.current_day);
  v_result:=private.advance_tavern_day_before_garden_apiary(p_save_id,p_action_id,p_expected_revision);
  perform private.apply_garden_day(p_save_id,p_action_id,v_save.current_day,v_plan);
  v_result:=v_result||jsonb_build_object('gardenReport',v_plan->'report','gardenPlanFingerprint',v_plan->>'planFingerprint');
  update public.craft_actions set result=v_result where save_id=p_save_id and action_id=p_action_id;
  return v_result;
end;
$$;

alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_garden_apiary;
alter function public.get_tavern_snapshot_before_garden_apiary() set schema private;
create function public.get_tavern_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_save public.tavern_saves;
begin
  v_result:=private.get_tavern_snapshot_before_garden_apiary();
  if v_result is null then return null; end if;
  select * into strict v_save from public.tavern_saves where id=(v_result#>>'{save,id}')::uuid and user_id=auth.uid();
  v_result:=jsonb_set(v_result,'{save}',(v_result->'save')||jsonb_build_object(
    'gold',v_save.gold,'gardenRulesVersion',v_save.garden_rules_version,'gardenPlotCount',v_save.garden_plot_count),true);
  v_result:=jsonb_set(v_result,'{cells}',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',c.id,'layoutKey',c.layout_key,'col',c.col,'row',c.row,'unlocked',c.unlocked,'kind',c.kind,
      'plantKey',gp.species_key,'plantName',sp.display_name,'icon',sp.icon,
      'growthStage',case when gp.id is null then null when gp.lifecycle='dead' then 0
        when gp.growth_progress>=100 then 3 when gp.growth_progress>=50 then 2 else 1 end,
      'water',case when gp.id is null then null else c.soil_moisture end,'health',gp.health,
      'harvestable',coalesce(gp.lifecycle='mature',false),
      'soil',jsonb_build_object('n',c.soil_n,'p',c.soil_p,'k',c.soil_k,
        'moisture',c.soil_moisture,'quality',c.soil_quality,'siteLight',c.site_light),
      'plant',case when gp.id is null then null else jsonb_build_object(
        'id',gp.id,'speciesKey',gp.species_key,'lifecycle',gp.lifecycle,'ageDays',gp.age_days,
        'growthProgress',gp.growth_progress,'health',gp.health,'productionCycle',gp.production_cycle,
        'floweringDaysRemaining',gp.flowering_days_remaining,'readySinceDay',gp.ready_since_day,
        'qualityIndex',private.garden_quality_index(gp.care_good_days,gp.care_total_days,
          gp.stress_points,gp.companion_points,gp.pollination_points),
        'symptoms',private.garden_symptoms(c.soil_n,c.soil_p,c.soil_k,c.soil_moisture,c.site_light,gp.health,sp)
      ) end,
      'hive',case when h.id is null then null else jsonb_build_object(
        'id',h.id,'equipmentCondition',h.equipment_condition,'hasColony',ac.id is not null,
        'colony',case when ac.id is null then null else jsonb_build_object(
          'id',ac.id,'adults',ac.adults,'brood',ac.brood,'health',ac.health,
          'foodStores',ac.food_stores,'floralHoney',ac.floral_honey,
          'protectedReserve',least(ac.food_stores,12),'extractableSurplus',greatest(0,ac.floral_honey-4),
          'varroaPressure',ac.varroa_pressure,'chalkbroodPressure',ac.chalkbrood_pressure,
          'nosemaPressure',ac.nosema_pressure,'treatmentKey',ac.treatment_key,
          'treatmentDaysRemaining',ac.treatment_days_remaining
        ) end
      ) end,
      'preview',case when gp.lifecycle='mature' then jsonb_build_object(
        'qualityIndex',private.garden_quality_index(gp.care_good_days,gp.care_total_days,
          gp.stress_points,gp.companion_points,gp.pollination_points),
        'quantity',sp.base_yield+case when sp.pollination_eligible and gp.pollination_points*2>=greatest(1,gp.care_total_days) then 1 else 0 end,
        'hasHiveBonus',sp.pollination_eligible and gp.pollination_points>0,
        'brewBonus',private.recipe_modifier(sp.base_brew_bonus,private.garden_quality_index(gp.care_good_days,gp.care_total_days,gp.stress_points,gp.companion_points,gp.pollination_points)),
        'bakeBonus',private.recipe_modifier(sp.base_bake_bonus,private.garden_quality_index(gp.care_good_days,gp.care_total_days,gp.stress_points,gp.companion_points,gp.pollination_points))
      ) else null end
    ) order by c.unlocked desc,c.col,c.row,c.layout_key)
    from public.garden_cells c
    left join public.garden_plants gp on gp.save_id=c.save_id and gp.cell_id=c.id
    left join public.garden_species_profiles sp on sp.rules_version=gp.rules_version and sp.species_key=gp.species_key
    left join public.apiary_hives h on h.save_id=c.save_id and h.cell_id=c.id
    left join public.apiary_colonies ac on ac.save_id=h.save_id and ac.hive_id=h.id
    where c.save_id=v_save.id
  ),'[]'::jsonb),true);
  v_result:=jsonb_set(v_result,'{garden}',jsonb_build_object(
    'rulesVersion',v_save.garden_rules_version,'plotCount',v_save.garden_plot_count,
    'forecast',coalesce((select jsonb_agg(jsonb_build_object('dayNumber',w.day_number,'key',w.weather_key,
      'name',wp.display_name,'rainfall',wp.rainfall,'drying',wp.drying,'lightDelta',wp.light_delta) order by w.day_number)
      from public.garden_weather w join public.garden_weather_profiles wp
        on wp.rules_version=w.rules_version and wp.weather_key=w.weather_key
      where w.save_id=v_save.id and w.day_number between v_save.current_day and v_save.current_day+2),'[]'::jsonb),
    'inventory',coalesce((select jsonb_agg(jsonb_build_object('itemKey',i.item_key,'name',c.display_name,
      'kind',c.item_kind,'quantity',i.quantity,'price',c.price,'effect',c.effect) order by c.item_kind,c.item_key)
      from public.garden_inventory i join public.garden_item_catalog c
        on c.rules_version=i.rules_version and c.item_key=i.item_key where i.save_id=v_save.id),'[]'::jsonb),
    'shop',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'name',display_name,
      'kind',item_kind,'price',price,'effect',effect) order by item_kind,item_key)
      from public.garden_item_catalog where rules_version=v_save.garden_rules_version),'[]'::jsonb),
    'compostJobs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'cellId',cell_id,
      'sourceKind',source_kind,'sourceLabel',source_label,'readyDay',ready_day,
      'releasesRemaining',releases_remaining) order by ready_day,id)
      from public.garden_compost_jobs where save_id=v_save.id),'[]'::jsonb),
    'latestReport',(select report from public.garden_day_resolutions where save_id=v_save.id order by day_number desc limit 1),
    'expansions',jsonb_build_array(
      jsonb_build_object('plotCount',16,'price',60,'available',v_save.garden_plot_count=12),
      jsonb_build_object('plotCount',24,'price',180,'available',v_save.garden_plot_count=16)
    )
  ),true);
  return v_result;
end;
$$;

revoke all on function private.clamp_int(integer,integer,integer),
  private.garden_quality_index(integer,integer,integer,integer,integer),
  private.garden_symptoms(integer,integer,integer,integer,integer,integer,public.garden_species_profiles),
  private.garden_day_input(uuid,integer), private.resolve_garden_day(uuid,integer),
  private.apply_garden_day(uuid,uuid,integer,jsonb),
  private.advance_tavern_day_before_garden_apiary(uuid,uuid,bigint),
  private.get_tavern_snapshot_before_garden_apiary() from public,anon,authenticated;
revoke all on function public.project_garden_day(),public.harvest_crop(uuid,uuid,uuid,bigint),
  public.advance_tavern_day(uuid,uuid,bigint),public.get_tavern_snapshot() from public,anon;
grant execute on function public.project_garden_day(),public.harvest_crop(uuid,uuid,uuid,bigint),
  public.advance_tavern_day(uuid,uuid,bigint),public.get_tavern_snapshot() to authenticated;

commit;
