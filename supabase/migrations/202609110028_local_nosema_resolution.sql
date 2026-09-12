-- Constrain Nosema transmission to colonies whose forage neighborhoods overlap.
begin;
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
    v_treatment_days:=greatest(0,v_colony.treatment_days_remaining-1);
    v_varroa:=private.clamp_int(v_colony.varroa_pressure
      +(case when v_colony.brood>1500 then 2 else 1 end)
      -(case when v_colony.treatment_key='varroa' and v_colony.treatment_days_remaining>0 then 9 else 0 end),0,100);
    v_chalk:=private.clamp_int(v_colony.chalkbrood_pressure
      +(case when v_weather.weather_key='rainy' then 4 else -1 end)
      -(case when v_colony.treatment_key='chalkbrood' and v_colony.treatment_days_remaining>0 then 8 else 0 end),0,100);
    v_nosema:=private.clamp_int(v_colony.nosema_pressure
      +(case when exists(
        select 1 from public.apiary_colonies n
        join public.apiary_hives nh on nh.save_id=n.save_id and nh.id=n.hive_id
        join public.garden_cells nc on nc.save_id=nh.save_id and nc.id=nh.cell_id
        where n.save_id=p_save_id and n.id<>v_colony.id and n.health>0 and n.nosema_pressure>=35
          and private.hex_distance(v_colony.col,v_colony.row,nc.col,nc.row)<=4
      ) then 3 else -1 end)
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
revoke all on function private.resolve_garden_day(uuid,integer) from public,anon,authenticated;
commit;
