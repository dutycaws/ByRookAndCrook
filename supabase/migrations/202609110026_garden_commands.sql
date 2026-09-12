-- Authenticated, replayable gardening commands. Simulation remains owned by
-- the day engine; these commands mutate only immediate player decisions.
begin;

alter table public.ingredient_batches
  add column composted_quantity integer not null default 0,
  add constraint ingredient_batches_allocated_quantity_check
    check (composted_quantity >= 0 and consumed_quantity + composted_quantity <= quantity);

create function private.require_craft_ingredient_available()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(
    select 1 from public.ingredient_batches b
    where b.save_id=new.save_id and b.id=new.ingredient_batch_id
      and b.quantity>b.consumed_quantity+b.composted_quantity
  ) then
    raise sqlstate 'PT404' using message='Tavern or ingredient not found';
  end if;
  return new;
end;
$$;

create trigger brew_sessions_available_ingredient
before insert on public.brew_sessions for each row
execute function private.require_craft_ingredient_available();
create trigger bake_sessions_available_ingredient
before insert on public.bake_sessions for each row
execute function private.require_craft_ingredient_available();

create or replace function private.sync_garden_cells(p_save_id uuid, p_cell_ids uuid[])
returns void language sql security definer set search_path = '' as $$
  update public.garden_cells c set
    kind = case when p.id is not null then 'plant'
      when h.id is not null then 'beehive' else 'empty' end,
    rules_version = 'garden-apiary-v1',
    plant_key = p.species_key,
    growth_stage = case when p.id is null then null when p.lifecycle='dead' then 0
      when p.growth_progress>=100 then 3 when p.growth_progress>=50 then 2 else 1 end,
    water = case when p.id is null then null else c.soil_moisture end,
    health = p.health,
    updated_at = now()
  from (select c2.id,
      (select gp.id from public.garden_plants gp where gp.save_id=c2.save_id and gp.cell_id=c2.id) plant_id,
      (select ah.id from public.apiary_hives ah where ah.save_id=c2.save_id and ah.cell_id=c2.id) hive_id
    from public.garden_cells c2
    where c2.save_id=p_save_id and c2.id=any(p_cell_ids)) occupied
  left join public.garden_plants p on p.save_id=p_save_id and p.id=occupied.plant_id
  left join public.apiary_hives h on h.save_id=p_save_id and h.id=occupied.hive_id
  where c.save_id=p_save_id and c.id=occupied.id;
$$;

create or replace function private.garden_target_ids(p_payload jsonb)
returns uuid[] language plpgsql immutable set search_path = '' as $$
declare v_ids uuid[]; v_count integer; v_distinct integer;
begin
  if jsonb_typeof(p_payload->'cellIds') <> 'array' then
    raise sqlstate 'PT400' using message='cellIds must be an array';
  end if;
  select array_agg(value::uuid order by value::uuid),count(*),count(distinct value::uuid)
  into v_ids,v_count,v_distinct
  from jsonb_array_elements_text(p_payload->'cellIds') with ordinality;
  if v_count is null or v_count<1 or v_count>24 or v_count<>v_distinct then
    raise sqlstate 'PT400' using message='Choose between one and twenty-four distinct garden cells';
  end if;
  return v_ids;
exception when invalid_text_representation then
  raise sqlstate 'PT400' using message='cellIds contains an invalid identifier';
end;
$$;

create function private.canonical_garden_payload(p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_allowed text[]; v_required text[]; v_ids uuid[]; v_key text;
begin
  if jsonb_typeof(p_payload)<>'object' then raise sqlstate 'PT400' using message='Garden payload must be an object'; end if;
  case p_command_kind
    when 'plant' then v_allowed:=array['cellId','seedItemKey']; v_required:=v_allowed;
    when 'move' then v_allowed:=array['sourceCellId','targetCellId']; v_required:=v_allowed;
    when 'remove' then v_allowed:=array['cellId','compost']; v_required:=array['cellId'];
    when 'water' then v_allowed:=array['cellIds','dose']; v_required:=v_allowed;
    when 'amend' then v_allowed:=array['cellIds','itemKey','dose']; v_required:=v_allowed;
    when 'incorporate_clover' then v_allowed:=array['cellId']; v_required:=v_allowed;
    when 'compost_ingredient' then v_allowed:=array['cellId','ingredientBatchId','quantity']; v_required:=v_allowed;
    when 'purchase' then v_allowed:=array['itemKey','quantity']; v_required:=v_allowed;
    when 'expand' then v_allowed:=array['plotCount']; v_required:=v_allowed;
    else raise sqlstate 'PT400' using message='Unsupported garden command';
  end case;
  if exists(select 1 from jsonb_object_keys(p_payload) key where not key=any(v_allowed))
    or exists(select 1 from unnest(v_required) key where not p_payload?key or p_payload->key='null'::jsonb) then
    raise sqlstate 'PT400' using message='Garden payload fields do not match the command';
  end if;

  if p_command_kind in ('plant','remove','incorporate_clover','compost_ingredient')
    and jsonb_typeof(p_payload->'cellId')<>'string' then raise sqlstate 'PT400' using message='cellId must be a string'; end if;
  if p_command_kind='move' and (jsonb_typeof(p_payload->'sourceCellId')<>'string'
    or jsonb_typeof(p_payload->'targetCellId')<>'string') then raise sqlstate 'PT400' using message='Move cell identifiers must be strings'; end if;
  if p_command_kind='compost_ingredient' and jsonb_typeof(p_payload->'ingredientBatchId')<>'string'
    then raise sqlstate 'PT400' using message='ingredientBatchId must be a string'; end if;
  if p_command_kind in ('plant','amend','purchase') and jsonb_typeof(p_payload->(case when p_command_kind='plant' then 'seedItemKey' else 'itemKey' end))<>'string'
    then raise sqlstate 'PT400' using message='Item key must be a string'; end if;
  if p_command_kind in ('water','amend','compost_ingredient','purchase','expand')
    and jsonb_typeof(p_payload->(case when p_command_kind in ('water','amend') then 'dose'
      when p_command_kind in ('compost_ingredient','purchase') then 'quantity' else 'plotCount' end))<>'number'
    then raise sqlstate 'PT400' using message='Garden quantity must be a number'; end if;
  if p_command_kind='remove' and p_payload?'compost' and jsonb_typeof(p_payload->'compost')<>'boolean'
    then raise sqlstate 'PT400' using message='compost must be true or false'; end if;

  case p_command_kind
    when 'plant' then return jsonb_build_object('cellId',(p_payload->>'cellId')::uuid,
      'seedItemKey',p_payload->>'seedItemKey');
    when 'move' then return jsonb_build_object('sourceCellId',(p_payload->>'sourceCellId')::uuid,
      'targetCellId',(p_payload->>'targetCellId')::uuid);
    when 'remove' then return jsonb_build_object('cellId',(p_payload->>'cellId')::uuid,
      'compost',coalesce((p_payload->>'compost')::boolean,false));
    when 'water' then v_ids:=private.garden_target_ids(p_payload); return jsonb_build_object(
      'cellIds',to_jsonb(v_ids),'dose',(p_payload->>'dose')::integer);
    when 'amend' then v_ids:=private.garden_target_ids(p_payload); return jsonb_build_object(
      'cellIds',to_jsonb(v_ids),'itemKey',p_payload->>'itemKey','dose',(p_payload->>'dose')::integer);
    when 'incorporate_clover' then return jsonb_build_object('cellId',(p_payload->>'cellId')::uuid);
    when 'compost_ingredient' then return jsonb_build_object('cellId',(p_payload->>'cellId')::uuid,
      'ingredientBatchId',(p_payload->>'ingredientBatchId')::uuid,'quantity',(p_payload->>'quantity')::integer);
    when 'purchase' then return jsonb_build_object('itemKey',p_payload->>'itemKey',
      'quantity',(p_payload->>'quantity')::integer);
    when 'expand' then return jsonb_build_object('plotCount',(p_payload->>'plotCount')::integer);
  end case;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid garden command payload';
end;
$$;

create function public.preview_garden_command(p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_save public.tavern_saves; v_ids uuid[]; v_dose integer; v_item text;
  v_count integer; v_effect jsonb; v_required integer; v_available integer;
  v_preview jsonb:='[]'::jsonb; v_price integer;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  p_payload:=private.canonical_garden_payload(p_command_kind,p_payload);
  select * into v_save from public.tavern_saves where user_id=auth.uid();
  if not found then return null; end if;

  if p_command_kind in ('water','amend') then
    v_ids:=private.garden_target_ids(p_payload);
    v_dose:=coalesce((p_payload->>'dose')::integer,0);
    if v_dose<1 or v_dose>40 or (p_command_kind='amend' and v_dose>3) then
      raise sqlstate 'PT400' using message='Invalid care dose';
    end if;
    select count(*) into v_count from public.garden_cells
    where save_id=v_save.id and unlocked and id=any(v_ids);
    if v_count<>cardinality(v_ids) then raise sqlstate 'PT404' using message='Garden cell not found'; end if;

    if p_command_kind='water' then
      select coalesce(jsonb_agg(jsonb_build_object('cellId',c.id,'before',c.soil_moisture,
        'after',least(100,c.soil_moisture+v_dose),'warning',case
          when gp.id is not null and least(100,c.soil_moisture+v_dose)>sp.moisture_max then 'overwatering'
          else null end) order by c.layout_key),'[]'::jsonb)
      into v_preview from public.garden_cells c
      left join public.garden_plants gp on gp.save_id=c.save_id and gp.cell_id=c.id
      left join public.garden_species_profiles sp on sp.rules_version=gp.rules_version and sp.species_key=gp.species_key
      where c.save_id=v_save.id and c.id=any(v_ids);
      return jsonb_build_object('commandKind','water','basedOnRevision',v_save.revision,
        'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
        'sameDosePerTarget',v_dose,'targetCount',v_count,'resourceCost',0,'canCommit',true,'targets',v_preview);
    end if;

    v_item:=p_payload->>'itemKey';
    select effect into v_effect from public.garden_item_catalog
    where rules_version=v_save.garden_rules_version and item_key=v_item and item_kind='amendment';
    if not found then raise sqlstate 'PT422' using message='Choose a valid amendment'; end if;
    v_required:=v_count*v_dose;
    select coalesce(quantity,0) into v_available from public.garden_inventory
    where save_id=v_save.id and item_key=v_item;
    v_available:=coalesce(v_available,0);
    select coalesce(jsonb_agg(jsonb_build_object('cellId',c.id,
      'before',jsonb_build_object('n',c.soil_n,'p',c.soil_p,'k',c.soil_k,'quality',c.soil_quality),
      'after',jsonb_build_object(
        'n',least(100,c.soil_n+coalesce((v_effect->>'n')::integer,0)*v_dose),
        'p',least(100,c.soil_p+coalesce((v_effect->>'p')::integer,0)*v_dose),
        'k',least(100,c.soil_k+coalesce((v_effect->>'k')::integer,0)*v_dose),
        'quality',least(100,c.soil_quality+coalesce((v_effect->>'quality')::integer,0)*v_dose)),
      'warning',case when gp.id is not null and (
        least(100,c.soil_n+coalesce((v_effect->>'n')::integer,0)*v_dose)>sp.n_max or
        least(100,c.soil_p+coalesce((v_effect->>'p')::integer,0)*v_dose)>sp.p_max or
        least(100,c.soil_k+coalesce((v_effect->>'k')::integer,0)*v_dose)>sp.k_max)
        then 'nutrient-excess' else null end) order by c.layout_key),'[]'::jsonb)
    into v_preview from public.garden_cells c
    left join public.garden_plants gp on gp.save_id=c.save_id and gp.cell_id=c.id
    left join public.garden_species_profiles sp on sp.rules_version=gp.rules_version and sp.species_key=gp.species_key
    where c.save_id=v_save.id and c.id=any(v_ids);
    return jsonb_build_object('commandKind','amend','basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
      'itemKey',v_item,'sameDosePerTarget',v_dose,'targetCount',v_count,
      'resourceCost',v_required,'available',v_available,'canCommit',v_available>=v_required,'targets',v_preview);
  elsif p_command_kind='purchase' then
    select price into v_price from public.garden_item_catalog
    where rules_version=v_save.garden_rules_version and item_key=p_payload->>'itemKey';
    if not found then raise sqlstate 'PT422' using message='Garden item not found'; end if;
    v_count:=coalesce((p_payload->>'quantity')::integer,0);
    if v_count<1 or v_count>20 then raise sqlstate 'PT400' using message='Invalid purchase quantity'; end if;
    return jsonb_build_object('commandKind','purchase','basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
      'goldCost',v_price*v_count,'goldBalance',v_save.gold,'canCommit',v_save.gold>=v_price*v_count);
  elsif p_command_kind='expand' then
    v_count:=coalesce((p_payload->>'plotCount')::integer,0);
    v_price:=case when v_save.garden_plot_count=12 and v_count=16 then 60
      when v_save.garden_plot_count=16 and v_count=24 then 180 else null end;
    if v_price is null then raise sqlstate 'PT422' using message='That garden expansion is not currently available'; end if;
    return jsonb_build_object('commandKind','expand','basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
      'plotCount',v_count,'goldCost',v_price,'goldBalance',v_save.gold,'canCommit',v_save.gold>=v_price);
  end if;
  return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
    'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
    'requiresAuthoritativeValidation',true);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid garden preview';
end;
$$;

create function public.garden_command(
  p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_command_kind text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_save public.tavern_saves; v_prior public.garden_actions;
  v_cell public.garden_cells; v_target public.garden_cells; v_plant public.garden_plants;
  v_profile public.garden_species_profiles; v_item public.garden_item_catalog;
  v_batch public.ingredient_batches; v_ids uuid[]; v_source uuid; v_target_id uuid;
  v_species text; v_seed text; v_item_key text; v_dose integer; v_quantity integer;
  v_count integer; v_required integer; v_price integer; v_next_plots integer;
  v_compost_requested boolean; v_composted boolean:=false; v_result jsonb;
  v_source_kind text; v_target_kind text; v_warning_count integer:=0;
begin
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0
    or p_command_kind not in ('plant','move','remove','water','amend','incorporate_clover',
      'compost_ingredient','purchase','expand') or jsonb_typeof(p_payload)<>'object' then
    raise sqlstate 'PT400' using message='Invalid garden command';
  end if;
  p_payload:=private.canonical_garden_payload(p_command_kind,p_payload);

  select * into v_save from public.tavern_saves
  where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;

  select * into v_prior from public.garden_actions
  where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_prior.command_kind=p_command_kind and v_prior.input_payload=p_payload
      and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if v_save.revision<>p_expected_revision then
    raise sqlstate 'PT409' using message='Garden state changed; refresh before acting';
  end if;

  if p_command_kind='plant' then
    v_source:=(p_payload->>'cellId')::uuid; v_seed:=p_payload->>'seedItemKey';
    select * into v_cell from public.garden_cells
    where save_id=p_save_id and id=v_source and unlocked for update;
    if not found then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    if v_cell.kind<>'empty' then raise sqlstate 'PT422' using message='Only empty soil can be planted'; end if;
    select * into v_item from public.garden_item_catalog
    where rules_version=v_save.garden_rules_version and item_key=v_seed and item_kind='seed';
    if not found then raise sqlstate 'PT422' using message='Choose a valid seed'; end if;
    v_species:=v_item.effect->>'species';
    select * into strict v_profile from public.garden_species_profiles
    where rules_version=v_save.garden_rules_version and species_key=v_species;
    update public.garden_inventory set quantity=quantity-1,updated_at=now()
    where save_id=p_save_id and item_key=v_seed and quantity>=1;
    if not found then raise sqlstate 'PT422' using message='That seed is not available'; end if;
    insert into public.garden_plants(save_id,cell_id,rules_version,species_key,lifecycle,
      health,growth_progress,planted_day)
    values(p_save_id,v_source,v_save.garden_rules_version,v_species,'seedling',80,0,v_save.current_day);
    perform private.sync_garden_cells(p_save_id,array[v_source]);
    v_result:=jsonb_build_object('cellId',v_source,'speciesKey',v_species,'seedConsumed',v_seed);

  elsif p_command_kind='move' then
    v_source:=(p_payload->>'sourceCellId')::uuid; v_target_id:=(p_payload->>'targetCellId')::uuid;
    if v_source=v_target_id then raise sqlstate 'PT400' using message='Choose two different garden cells'; end if;
    perform 1 from public.garden_cells where save_id=p_save_id and unlocked
      and id=any(array[v_source,v_target_id]) order by id for update;
    if (select count(*) from public.garden_cells where save_id=p_save_id and unlocked
      and id=any(array[v_source,v_target_id]))<>2 then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    select kind into v_source_kind from public.garden_cells where save_id=p_save_id and id=v_source;
    select kind into v_target_kind from public.garden_cells where save_id=p_save_id and id=v_target_id;
    if v_source_kind='empty' then raise sqlstate 'PT422' using message='Choose a plant or hive to move'; end if;
    set constraints all deferred;
    update public.garden_plants set cell_id=case when cell_id=v_source then v_target_id else v_source end,
      updated_at=now() where save_id=p_save_id and cell_id=any(array[v_source,v_target_id]);
    update public.apiary_hives set cell_id=case when cell_id=v_source then v_target_id else v_source end,
      updated_at=now() where save_id=p_save_id and cell_id=any(array[v_source,v_target_id]);
    perform private.sync_garden_cells(p_save_id,array[v_source,v_target_id]);
    v_result:=jsonb_build_object('sourceCellId',v_source,'targetCellId',v_target_id,
      'movedKind',v_source_kind,'swappedKind',v_target_kind);

  elsif p_command_kind='remove' then
    v_source:=(p_payload->>'cellId')::uuid;
    v_compost_requested:=coalesce((p_payload->>'compost')::boolean,false);
    select * into v_cell from public.garden_cells
    where save_id=p_save_id and id=v_source and unlocked for update;
    if not found then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    select * into v_plant from public.garden_plants
    where save_id=p_save_id and cell_id=v_source for update;
    if not found then raise sqlstate 'PT422' using message='Choose a plant to remove'; end if;
    v_composted:=v_compost_requested and
      (v_plant.lifecycle='dead' or v_plant.age_days>=2 or v_plant.growth_progress>=35);
    if v_composted then
      insert into public.garden_compost_jobs(save_id,cell_id,source_kind,source_label,
        ready_day,releases_remaining,n_per_release,p_per_release,k_per_release,quality_per_release)
      values(p_save_id,v_source,'plant',v_plant.species_key,v_save.current_day+1,2,4,4,4,3);
    end if;
    delete from public.garden_plants where id=v_plant.id;
    perform private.sync_garden_cells(p_save_id,array[v_source]);
    v_result:=jsonb_build_object('cellId',v_source,'speciesKey',v_plant.species_key,
      'compostRequested',v_compost_requested,'composted',v_composted,
      'reason',case when v_compost_requested and not v_composted then 'seedling-too-young' else null end);

  elsif p_command_kind='water' then
    v_ids:=private.garden_target_ids(p_payload); v_dose:=(p_payload->>'dose')::integer;
    if v_dose<1 or v_dose>40 then raise sqlstate 'PT400' using message='Water dose must be between 1 and 40'; end if;
    perform 1 from public.garden_cells where save_id=p_save_id and unlocked and id=any(v_ids)
      order by id for update;
    select count(*) into v_count from public.garden_cells
    where save_id=p_save_id and unlocked and id=any(v_ids);
    if v_count<>cardinality(v_ids) then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    update public.garden_cells set soil_moisture=least(100,soil_moisture+v_dose),
      water=case when kind='plant' then least(100,soil_moisture+v_dose) else null end,updated_at=now()
    where save_id=p_save_id and id=any(v_ids);
    select count(*) into v_warning_count from public.garden_cells c
    join public.garden_plants gp on gp.save_id=c.save_id and gp.cell_id=c.id
    join public.garden_species_profiles sp on sp.rules_version=gp.rules_version and sp.species_key=gp.species_key
    where c.save_id=p_save_id and c.id=any(v_ids) and c.soil_moisture>sp.moisture_max;
    v_result:=jsonb_build_object('cellIds',to_jsonb(v_ids),'dose',v_dose,'targetCount',v_count,
      'resourceCost',0,'warningCount',v_warning_count);

  elsif p_command_kind='amend' then
    v_ids:=private.garden_target_ids(p_payload); v_dose:=(p_payload->>'dose')::integer;
    v_item_key:=p_payload->>'itemKey';
    if v_dose<1 or v_dose>3 then raise sqlstate 'PT400' using message='Amendment dose must be between 1 and 3'; end if;
    select * into v_item from public.garden_item_catalog
    where rules_version=v_save.garden_rules_version and item_key=v_item_key and item_kind='amendment';
    if not found then raise sqlstate 'PT422' using message='Choose a valid amendment'; end if;
    perform 1 from public.garden_cells where save_id=p_save_id and unlocked and id=any(v_ids)
      order by id for update;
    select count(*) into v_count from public.garden_cells where save_id=p_save_id and unlocked and id=any(v_ids);
    if v_count<>cardinality(v_ids) then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    v_required:=v_count*v_dose;
    update public.garden_inventory set quantity=quantity-v_required,updated_at=now()
    where save_id=p_save_id and item_key=v_item_key and quantity>=v_required;
    if not found then raise sqlstate 'PT422' using message='Not enough amendment for every selected cell'; end if;
    update public.garden_cells set
      soil_n=least(100,soil_n+coalesce((v_item.effect->>'n')::integer,0)*v_dose),
      soil_p=least(100,soil_p+coalesce((v_item.effect->>'p')::integer,0)*v_dose),
      soil_k=least(100,soil_k+coalesce((v_item.effect->>'k')::integer,0)*v_dose),
      soil_quality=least(100,soil_quality+coalesce((v_item.effect->>'quality')::integer,0)*v_dose),updated_at=now()
    where save_id=p_save_id and id=any(v_ids);
    select count(*) into v_warning_count from public.garden_cells c
    join public.garden_plants gp on gp.save_id=c.save_id and gp.cell_id=c.id
    join public.garden_species_profiles sp on sp.rules_version=gp.rules_version and sp.species_key=gp.species_key
    where c.save_id=p_save_id and c.id=any(v_ids)
      and (c.soil_n>sp.n_max or c.soil_p>sp.p_max or c.soil_k>sp.k_max);
    v_result:=jsonb_build_object('cellIds',to_jsonb(v_ids),'itemKey',v_item_key,'dose',v_dose,
      'targetCount',v_count,'unitsConsumed',v_required,'warningCount',v_warning_count);

  elsif p_command_kind='incorporate_clover' then
    v_source:=(p_payload->>'cellId')::uuid;
    select p.* into v_plant from public.garden_plants p
    join public.garden_cells c on c.save_id=p.save_id and c.id=p.cell_id
    where p.save_id=p_save_id and p.cell_id=v_source and c.unlocked for update of p;
    if not found then raise sqlstate 'PT404' using message='Garden plant not found'; end if;
    if v_plant.species_key<>'clover' or v_plant.growth_progress<55 or v_plant.lifecycle='dead' then
      raise sqlstate 'PT422' using message='Only established living clover can be incorporated';
    end if;
    insert into public.garden_compost_jobs(save_id,cell_id,source_kind,source_label,
      ready_day,releases_remaining,n_per_release,p_per_release,k_per_release,quality_per_release)
    values(p_save_id,v_source,'green_manure','clover',v_save.current_day+1,3,12,12,12,4);
    delete from public.garden_plants where id=v_plant.id;
    perform private.sync_garden_cells(p_save_id,array[v_source]);
    v_result:=jsonb_build_object('cellId',v_source,'incorporated','clover',
      'firstReleaseDay',v_save.current_day+1,'releases',3);

  elsif p_command_kind='compost_ingredient' then
    v_source:=(p_payload->>'cellId')::uuid; v_target_id:=(p_payload->>'ingredientBatchId')::uuid;
    v_quantity:=(p_payload->>'quantity')::integer;
    if v_quantity<1 then raise sqlstate 'PT400' using message='Compost quantity must be positive'; end if;
    select * into v_cell from public.garden_cells where save_id=p_save_id and id=v_source and unlocked for update;
    if not found then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    select * into v_batch from public.ingredient_batches
    where save_id=p_save_id and id=v_target_id for update;
    if not found then raise sqlstate 'PT404' using message='Ingredient batch not found'; end if;
    if exists(select 1 from public.brew_sessions where save_id=p_save_id
        and ingredient_batch_id=v_target_id and status='active')
      or exists(select 1 from public.bake_sessions where save_id=p_save_id
        and ingredient_batch_id=v_target_id and status<>'completed') then
      raise sqlstate 'PT409' using message='That ingredient is reserved for the active craft';
    end if;
    if v_batch.quantity-v_batch.consumed_quantity-v_batch.composted_quantity<v_quantity then
      raise sqlstate 'PT422' using message='Not enough unconsumed ingredient to compost';
    end if;
    update public.ingredient_batches set composted_quantity=composted_quantity+v_quantity where id=v_target_id;
    insert into public.garden_compost_jobs(save_id,cell_id,source_kind,source_label,
      ready_day,releases_remaining,n_per_release,p_per_release,k_per_release,quality_per_release)
    values(p_save_id,v_source,'ingredient',v_batch.plant_key,v_save.current_day+1,2,4,4,4,5);
    v_result:=jsonb_build_object('cellId',v_source,'ingredientBatchId',v_target_id,
      'quantityConsumed',v_quantity,'firstReleaseDay',v_save.current_day+1);

  elsif p_command_kind='purchase' then
    v_item_key:=p_payload->>'itemKey'; v_quantity:=(p_payload->>'quantity')::integer;
    if v_quantity<1 or v_quantity>20 then raise sqlstate 'PT400' using message='Purchase quantity must be between 1 and 20'; end if;
    select * into v_item from public.garden_item_catalog
    where rules_version=v_save.garden_rules_version and item_key=v_item_key;
    if not found then raise sqlstate 'PT422' using message='Garden item not found'; end if;
    v_price:=v_item.price*v_quantity;
    if v_save.gold<v_price then raise sqlstate 'PT422' using message='Not enough gold'; end if;
    update public.tavern_saves set gold=gold-v_price where id=p_save_id;
    insert into public.garden_inventory(save_id,item_key,rules_version,quantity)
    values(p_save_id,v_item_key,v_save.garden_rules_version,v_quantity)
    on conflict(save_id,item_key) do update set quantity=public.garden_inventory.quantity+excluded.quantity,updated_at=now();
    v_result:=jsonb_build_object('itemKey',v_item_key,'quantity',v_quantity,
      'goldSpent',v_price,'goldBalance',v_save.gold-v_price);

  elsif p_command_kind='expand' then
    v_next_plots:=(p_payload->>'plotCount')::integer;
    v_price:=case when v_save.garden_plot_count=12 and v_next_plots=16 then 60
      when v_save.garden_plot_count=16 and v_next_plots=24 then 180 else null end;
    if v_price is null then raise sqlstate 'PT422' using message='That garden expansion is not currently available'; end if;
    if v_save.gold<v_price then raise sqlstate 'PT422' using message='Not enough gold'; end if;
    update public.tavern_saves set garden_plot_count=v_next_plots,gold=gold-v_price where id=p_save_id;
    update public.garden_cells set unlocked=case when v_next_plots=16 then col<4 else true end,updated_at=now()
    where save_id=p_save_id;
    v_result:=jsonb_build_object('plotCount',v_next_plots,'goldSpent',v_price,
      'goldBalance',v_save.gold-v_price,'unlockedCount',v_next_plots);
  end if;

  v_result:=jsonb_build_object('actionId',p_action_id,'commandKind',p_command_kind,
    'committedRevision',v_save.revision+1,'rulesVersion',v_save.garden_rules_version,
    'normalizedPayload',p_payload,'result',v_result);
  insert into public.garden_actions(save_id,action_id,actor_id,command_kind,input_payload,
    input_expected_revision,rules_version,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,p_command_kind,p_payload,p_expected_revision,
    v_save.garden_rules_version,v_result,v_save.revision+1);
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=p_save_id;
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid garden command payload';
end;
$$;

alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_garden_commands;
alter function public.get_tavern_snapshot_before_garden_commands() set schema private;
create function public.get_tavern_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_save_id uuid;
begin
  v_result:=private.get_tavern_snapshot_before_garden_commands();
  if v_result is null then return null; end if;
  v_save_id:=(v_result#>>'{save,id}')::uuid;
  return jsonb_set(v_result,'{ingredients}',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',b.id,'plantKey',b.plant_key,'plantName',pc.display_name,'icon',pc.icon,
      'qualityIndex',b.quality_index,
      'quantity',b.quantity-b.consumed_quantity-b.composted_quantity,
      'brewBonus',b.brew_bonus,'bakeBonus',b.bake_bonus,'sourceCellId',b.source_cell_id,
      'consumedQuantity',b.consumed_quantity,'compostedQuantity',b.composted_quantity,
      'createdAt',b.created_at) order by b.created_at desc,b.id)
    from public.ingredient_batches b
    join public.plant_catalog pc on pc.rules_version=b.rules_version and pc.plant_key=b.plant_key
    where b.save_id=v_save_id and b.quantity>b.consumed_quantity+b.composted_quantity
  ),'[]'::jsonb),true);
end;
$$;

revoke all on function private.require_craft_ingredient_available(),
  private.sync_garden_cells(uuid,uuid[]),private.garden_target_ids(jsonb),
  private.canonical_garden_payload(text,jsonb),private.get_tavern_snapshot_before_garden_commands()
  from public,anon,authenticated;
revoke all on function public.preview_garden_command(text,jsonb),
  public.garden_command(uuid,uuid,bigint,text,jsonb),public.get_tavern_snapshot() from public,anon;
grant execute on function public.preview_garden_command(text,jsonb),
  public.garden_command(uuid,uuid,bigint,text,jsonb),public.get_tavern_snapshot() to authenticated;

commit;
