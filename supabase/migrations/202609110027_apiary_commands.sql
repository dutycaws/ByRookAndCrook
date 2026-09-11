-- Add authoritative apiary management and honey provenance without changing
-- the existing crop, crafting, serving, or day-advance signatures.
begin;

alter table public.ingredient_batches
  drop constraint ingredient_batches_save_id_source_action_id_fkey,
  alter column source_action_id drop not null,
  add column source_kind text not null default 'crop'
    check (source_kind in ('crop','honey')),
  add column source_apiary_action_id uuid,
  add column provenance jsonb not null default '{}'::jsonb,
  add constraint ingredient_batches_crop_source_fkey
    foreign key (save_id,source_action_id)
    references public.game_actions(save_id,action_id),
  add constraint ingredient_batches_apiary_source_fkey
    foreign key (save_id,source_apiary_action_id)
    references public.garden_actions(save_id,action_id)
    deferrable initially deferred,
  add constraint ingredient_batches_source_provenance_check check (
    (source_kind='crop' and source_action_id is not null and source_apiary_action_id is null)
    or (source_kind='honey' and source_action_id is null and source_apiary_action_id is not null)
  ),
  add constraint ingredient_batches_apiary_source_key
    unique (save_id,source_apiary_action_id);

create function private.canonical_apiary_payload(p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_allowed text[]; v_required text[];
begin
  if jsonb_typeof(p_payload)<>'object' then
    raise sqlstate 'PT400' using message='Apiary payload must be an object';
  end if;
  case p_command_kind
    when 'install_hive' then v_allowed:=array['cellId']; v_required:=v_allowed;
    when 'install_colony' then v_allowed:=array['hiveId']; v_required:=v_allowed;
    when 'feed' then v_allowed:=array['colonyId','quantity']; v_required:=v_allowed;
    when 'treat' then v_allowed:=array['colonyId','treatmentItemKey']; v_required:=v_allowed;
    when 'split' then v_allowed:=array['sourceColonyId','targetHiveId']; v_required:=v_allowed;
    when 'extract_honey' then v_allowed:=array['colonyId','quantity']; v_required:=v_allowed;
    else raise sqlstate 'PT400' using message='Unsupported apiary command';
  end case;
  if exists(select 1 from jsonb_object_keys(p_payload) key where not key=any(v_allowed))
    or exists(select 1 from unnest(v_required) key where not p_payload?key or p_payload->key='null'::jsonb) then
    raise sqlstate 'PT400' using message='Apiary payload fields do not match the command';
  end if;
  if p_command_kind='install_hive' and jsonb_typeof(p_payload->'cellId')<>'string' then
    raise sqlstate 'PT400' using message='cellId must be a string';
  elsif p_command_kind='install_colony' and jsonb_typeof(p_payload->'hiveId')<>'string' then
    raise sqlstate 'PT400' using message='hiveId must be a string';
  elsif p_command_kind in ('feed','extract_honey') and
    (jsonb_typeof(p_payload->'colonyId')<>'string' or jsonb_typeof(p_payload->'quantity')<>'number') then
    raise sqlstate 'PT400' using message='Apiary colony and quantity fields are invalid';
  elsif p_command_kind='treat' and
    (jsonb_typeof(p_payload->'colonyId')<>'string' or jsonb_typeof(p_payload->'treatmentItemKey')<>'string') then
    raise sqlstate 'PT400' using message='Apiary treatment fields are invalid';
  elsif p_command_kind='split' and
    (jsonb_typeof(p_payload->'sourceColonyId')<>'string' or jsonb_typeof(p_payload->'targetHiveId')<>'string') then
    raise sqlstate 'PT400' using message='Apiary split fields are invalid';
  end if;
  if p_command_kind in ('feed','extract_honey')
    and (p_payload->>'quantity')::numeric<>trunc((p_payload->>'quantity')::numeric) then
    raise sqlstate 'PT400' using message='Apiary quantity must be a whole number';
  end if;

  case p_command_kind
    when 'install_hive' then return jsonb_build_object('cellId',(p_payload->>'cellId')::uuid);
    when 'install_colony' then return jsonb_build_object('hiveId',(p_payload->>'hiveId')::uuid);
    when 'feed' then return jsonb_build_object('colonyId',(p_payload->>'colonyId')::uuid,
      'quantity',(p_payload->>'quantity')::integer);
    when 'treat' then return jsonb_build_object('colonyId',(p_payload->>'colonyId')::uuid,
      'treatmentItemKey',p_payload->>'treatmentItemKey');
    when 'split' then return jsonb_build_object('sourceColonyId',(p_payload->>'sourceColonyId')::uuid,
      'targetHiveId',(p_payload->>'targetHiveId')::uuid);
    when 'extract_honey' then return jsonb_build_object('colonyId',(p_payload->>'colonyId')::uuid,
      'quantity',(p_payload->>'quantity')::integer);
  end case;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid apiary command payload';
end;
$$;

create function private.apiary_symptoms(
  p_food integer,p_health integer,p_varroa integer,p_chalkbrood integer,p_nosema integer
)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(symptom order by ordinal),'[]'::jsonb) from (
    values
      (1,case when p_food<12 then jsonb_build_object('code','low-stores','severity',case when p_food=0 then 'critical' else 'warning' end,
        'label','Food stores are low','cause','The colony lacks its twelve-unit protected food reserve.') end),
      (2,case when p_health<=25 then jsonb_build_object('code','health-critical','severity','critical',
        'label','Colony loss warning','cause','Sustained starvation or severe untreated illness can permanently remove this colony.') end),
      (3,case when p_varroa>=25 then jsonb_build_object('code','varroa-pressure','severity',case when p_varroa>=60 then 'critical' else 'warning' end,
        'label','Varroa pressure','cause','Parasite pressure is affecting adult bees and brood.') end),
      (4,case when p_chalkbrood>=25 then jsonb_build_object('code','chalkbrood-pressure','severity',case when p_chalkbrood>=60 then 'critical' else 'warning' end,
        'label','Chalkbrood pressure','cause','Damp conditions are stressing the colony brood.') end),
      (5,case when p_nosema>=25 then jsonb_build_object('code','nosema-pressure','severity',case when p_nosema>=60 then 'critical' else 'warning' end,
        'label','Nosema pressure','cause','Adult-bee disease pressure is reducing colony productivity.') end)
  ) symptoms(ordinal,symptom) where symptom is not null;
$$;

create function public.preview_apiary_command(p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_save public.tavern_saves; v_cell public.garden_cells; v_hive public.apiary_hives;
  v_colony public.apiary_colonies; v_item public.garden_item_catalog;
  v_available integer:=0; v_quantity integer:=0; v_surplus integer:=0; v_can boolean:=false;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  p_payload:=private.canonical_apiary_payload(p_command_kind,p_payload);
  select * into v_save from public.tavern_saves where user_id=auth.uid();
  if not found then return null; end if;

  if p_command_kind='install_hive' then
    select * into v_cell from public.garden_cells where save_id=v_save.id and id=(p_payload->>'cellId')::uuid and unlocked;
    select coalesce(quantity,0) into v_available from public.garden_inventory
      where save_id=v_save.id and item_key='hive_equipment';
    v_can:=v_cell.id is not null and v_cell.kind='empty' and coalesce(v_available,0)>0;
    return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,'availableEquipment',coalesce(v_available,0),
      'targetKind',v_cell.kind,'canCommit',v_can);
  elsif p_command_kind='install_colony' then
    select * into v_hive from public.apiary_hives where save_id=v_save.id and id=(p_payload->>'hiveId')::uuid;
    select coalesce(quantity,0) into v_available from public.garden_inventory
      where save_id=v_save.id and item_key='replacement_colony';
    v_can:=v_hive.id is not null and coalesce(v_available,0)>0 and not exists(
      select 1 from public.apiary_colonies where save_id=v_save.id and hive_id=v_hive.id);
    return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,'availableColonies',coalesce(v_available,0),
      'canCommit',v_can);
  end if;

  select * into v_colony from public.apiary_colonies where save_id=v_save.id and id=(p_payload->>'colonyId')::uuid;
  if p_command_kind='split' then
    select * into v_colony from public.apiary_colonies where save_id=v_save.id and id=(p_payload->>'sourceColonyId')::uuid;
    select * into v_hive from public.apiary_hives where save_id=v_save.id and id=(p_payload->>'targetHiveId')::uuid;
    v_can:=v_colony.id is not null and v_hive.id is not null and v_colony.adults>=10000 and v_colony.brood>=2000
      and v_colony.food_stores>=30 and v_colony.health>=60 and not exists(
        select 1 from public.apiary_colonies where save_id=v_save.id and hive_id=v_hive.id);
    return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
      'requirements',jsonb_build_object('adults',10000,'brood',2000,'foodStores',30,'health',60),'canCommit',v_can);
  end if;
  if v_colony.id is null then raise sqlstate 'PT404' using message='Colony not found'; end if;

  if p_command_kind='feed' then
    v_quantity:=(p_payload->>'quantity')::integer;
    select coalesce(quantity,0) into v_available from public.garden_inventory
      where save_id=v_save.id and item_key='bee_feed';
    v_can:=v_quantity between 1 and 10 and coalesce(v_available,0)>=v_quantity;
    return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,'availableFeed',coalesce(v_available,0),
      'foodStoresBefore',v_colony.food_stores,'foodStoresAfter',least(1000,v_colony.food_stores+18*v_quantity),
      'floralHoneyAfter',v_colony.floral_honey,'canCommit',v_can);
  elsif p_command_kind='treat' then
    select * into v_item from public.garden_item_catalog where rules_version=v_save.garden_rules_version
      and item_key=p_payload->>'treatmentItemKey' and item_kind='treatment';
    select coalesce(quantity,0) into v_available from public.garden_inventory where save_id=v_save.id
      and item_key=p_payload->>'treatmentItemKey';
    v_can:=v_item.item_key is not null and coalesce(v_available,0)>0 and v_colony.treatment_days_remaining=0;
    return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
      'problem',v_item.effect->>'problem','durationDays',3,'tradeoff','no-honey-production-or-extraction',
      'availableTreatment',coalesce(v_available,0),'canCommit',v_can);
  elsif p_command_kind='extract_honey' then
    v_quantity:=(p_payload->>'quantity')::integer; v_surplus:=greatest(0,v_colony.floral_honey-4);
    v_can:=v_quantity between 1 and 20 and v_quantity<=v_surplus and v_colony.treatment_days_remaining=0;
    return jsonb_build_object('commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',p_payload,
      'floralHoney',v_colony.floral_honey,'protectedHoneyReserve',4,'extractableSurplus',v_surplus,
      'treatmentRestricted',v_colony.treatment_days_remaining>0,'canCommit',v_can);
  end if;
  raise sqlstate 'PT400' using message='Unsupported apiary preview';
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid apiary preview';
end;
$$;

create function public.apiary_command(
  p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_command_kind text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_save public.tavern_saves; v_prior public.garden_actions;
  v_cell public.garden_cells; v_hive public.apiary_hives; v_target_hive public.apiary_hives;
  v_colony public.apiary_colonies; v_item public.garden_item_catalog;
  v_cell_id uuid; v_hive_id uuid; v_colony_id uuid; v_target_hive_id uuid;
  v_quantity integer; v_food integer; v_problem text; v_surplus integer; v_quality smallint;
  v_new_colony_id uuid; v_batch_id uuid; v_result jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0
    or p_command_kind not in ('install_hive','install_colony','feed','treat','split','extract_honey')
    or jsonb_typeof(p_payload)<>'object' then
    raise sqlstate 'PT400' using message='Invalid apiary command';
  end if;
  p_payload:=private.canonical_apiary_payload(p_command_kind,p_payload);
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into v_prior from public.garden_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_prior.command_kind='apiary_'||p_command_kind and v_prior.input_payload=p_payload
      and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if v_save.revision<>p_expected_revision then
    raise sqlstate 'PT409' using message='Garden state changed; refresh before acting';
  end if;

  if p_command_kind='install_hive' then
    v_cell_id:=(p_payload->>'cellId')::uuid;
    select * into v_cell from public.garden_cells where save_id=p_save_id and id=v_cell_id and unlocked for update;
    if not found then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    if v_cell.kind<>'empty' then raise sqlstate 'PT422' using message='Hive equipment requires empty soil'; end if;
    update public.garden_inventory set quantity=quantity-1,updated_at=now()
      where save_id=p_save_id and item_key='hive_equipment' and quantity>=1;
    if not found then raise sqlstate 'PT422' using message='No hive equipment is available'; end if;
    insert into public.apiary_hives(save_id,cell_id,installed_day)
      values(p_save_id,v_cell_id,v_save.current_day) returning id into v_hive_id;
    perform private.sync_garden_cells(p_save_id,array[v_cell_id]);
    v_result:=jsonb_build_object('hiveId',v_hive_id,'cellId',v_cell_id,'equipmentConsumed',1,'hasColony',false);

  elsif p_command_kind='install_colony' then
    v_hive_id:=(p_payload->>'hiveId')::uuid;
    select * into v_hive from public.apiary_hives where save_id=p_save_id and id=v_hive_id for update;
    if not found then raise sqlstate 'PT404' using message='Hive not found'; end if;
    if exists(select 1 from public.apiary_colonies where save_id=p_save_id and hive_id=v_hive_id) then
      raise sqlstate 'PT422' using message='That hive already has a colony';
    end if;
    update public.garden_inventory set quantity=quantity-1,updated_at=now()
      where save_id=p_save_id and item_key='replacement_colony' and quantity>=1;
    if not found then raise sqlstate 'PT422' using message='No replacement colony is available'; end if;
    insert into public.apiary_colonies(save_id,hive_id,adults,brood,health,food_stores,floral_honey,
      feed_stores,varroa_pressure,chalkbrood_pressure,nosema_pressure,established_day)
    values(p_save_id,v_hive_id,5000,1000,75,18,0,0,5,2,2,v_save.current_day)
    returning id into v_colony_id;
    v_result:=jsonb_build_object('hiveId',v_hive_id,'colonyId',v_colony_id,'colonyConsumed',1,
      'floralHoney',0,'equipmentRetained',true);

  elsif p_command_kind='feed' then
    v_colony_id:=(p_payload->>'colonyId')::uuid; v_quantity:=(p_payload->>'quantity')::integer;
    if v_quantity<1 or v_quantity>10 then raise sqlstate 'PT400' using message='Feed quantity must be between 1 and 10'; end if;
    select * into v_colony from public.apiary_colonies where save_id=p_save_id and id=v_colony_id for update;
    if not found then raise sqlstate 'PT404' using message='Colony not found'; end if;
    update public.garden_inventory set quantity=quantity-v_quantity,updated_at=now()
      where save_id=p_save_id and item_key='bee_feed' and quantity>=v_quantity;
    if not found then raise sqlstate 'PT422' using message='Not enough colony feed'; end if;
    v_food:=least(1000,v_colony.food_stores+18*v_quantity);
    update public.apiary_colonies set food_stores=v_food,
      feed_stores=least(1000,feed_stores+18*v_quantity),updated_at=now() where id=v_colony_id;
    v_result:=jsonb_build_object('colonyId',v_colony_id,'unitsConsumed',v_quantity,
      'foodStoresBefore',v_colony.food_stores,'foodStoresAfter',v_food,
      'floralHoneyBefore',v_colony.floral_honey,'floralHoneyAfter',v_colony.floral_honey);

  elsif p_command_kind='treat' then
    v_colony_id:=(p_payload->>'colonyId')::uuid;
    select * into v_colony from public.apiary_colonies where save_id=p_save_id and id=v_colony_id for update;
    if not found then raise sqlstate 'PT404' using message='Colony not found'; end if;
    if v_colony.treatment_days_remaining>0 then raise sqlstate 'PT409' using message='A colony treatment is already active'; end if;
    select * into v_item from public.garden_item_catalog where rules_version=v_save.garden_rules_version
      and item_key=p_payload->>'treatmentItemKey' and item_kind='treatment';
    if not found then raise sqlstate 'PT422' using message='Choose a valid apiary treatment'; end if;
    v_problem:=v_item.effect->>'problem';
    update public.garden_inventory set quantity=quantity-1,updated_at=now()
      where save_id=p_save_id and item_key=v_item.item_key and quantity>=1;
    if not found then raise sqlstate 'PT422' using message='That treatment is not available'; end if;
    update public.apiary_colonies set treatment_key=v_problem,treatment_days_remaining=3,
      treatment_tradeoff='no-honey-production-or-extraction',updated_at=now() where id=v_colony_id;
    v_result:=jsonb_build_object('colonyId',v_colony_id,'problem',v_problem,'durationDays',3,
      'tradeoff','no-honey-production-or-extraction','itemConsumed',v_item.item_key);

  elsif p_command_kind='split' then
    v_colony_id:=(p_payload->>'sourceColonyId')::uuid;
    v_target_hive_id:=(p_payload->>'targetHiveId')::uuid;
    select * into v_colony from public.apiary_colonies where save_id=p_save_id and id=v_colony_id for update;
    if not found then raise sqlstate 'PT404' using message='Source colony not found'; end if;
    select * into v_target_hive from public.apiary_hives where save_id=p_save_id and id=v_target_hive_id for update;
    if not found then raise sqlstate 'PT404' using message='Target hive not found'; end if;
    if exists(select 1 from public.apiary_colonies where save_id=p_save_id and hive_id=v_target_hive_id) then
      raise sqlstate 'PT422' using message='The target hive already has a colony';
    end if;
    if v_colony.adults<10000 or v_colony.brood<2000 or v_colony.food_stores<30 or v_colony.health<60 then
      raise sqlstate 'PT422' using message='The source colony is not strong enough to split safely';
    end if;
    update public.apiary_colonies set adults=adults-floor(v_colony.adults/2.0)::integer,
      brood=brood-floor(v_colony.brood/2.0)::integer,
      food_stores=food_stores-floor(v_colony.food_stores/2.0)::integer,
      floral_honey=floral_honey-floor(v_colony.floral_honey/2.0)::integer,
      feed_stores=feed_stores-floor(v_colony.feed_stores/2.0)::integer,updated_at=now()
      where id=v_colony_id;
    insert into public.apiary_colonies(save_id,hive_id,adults,brood,health,food_stores,floral_honey,
      feed_stores,varroa_pressure,chalkbrood_pressure,nosema_pressure,treatment_key,
      treatment_days_remaining,treatment_tradeoff,threat_days,established_day)
    values(p_save_id,v_target_hive_id,floor(v_colony.adults/2.0)::integer,
      floor(v_colony.brood/2.0)::integer,v_colony.health,floor(v_colony.food_stores/2.0)::integer,
      floor(v_colony.floral_honey/2.0)::integer,floor(v_colony.feed_stores/2.0)::integer,
      v_colony.varroa_pressure,v_colony.chalkbrood_pressure,v_colony.nosema_pressure,
      v_colony.treatment_key,v_colony.treatment_days_remaining,v_colony.treatment_tradeoff,
      v_colony.threat_days,v_save.current_day) returning id into v_new_colony_id;
    v_result:=jsonb_build_object('sourceColonyId',v_colony_id,'newColonyId',v_new_colony_id,
      'targetHiveId',v_target_hive_id,'transferred',jsonb_build_object(
        'adults',floor(v_colony.adults/2.0)::integer,'brood',floor(v_colony.brood/2.0)::integer,
        'foodStores',floor(v_colony.food_stores/2.0)::integer,'floralHoney',floor(v_colony.floral_honey/2.0)::integer,
        'feedStores',floor(v_colony.feed_stores/2.0)::integer),
      'pressuresCarried',jsonb_build_object('varroa',v_colony.varroa_pressure,
        'chalkbrood',v_colony.chalkbrood_pressure,'nosema',v_colony.nosema_pressure));

  elsif p_command_kind='extract_honey' then
    v_colony_id:=(p_payload->>'colonyId')::uuid; v_quantity:=(p_payload->>'quantity')::integer;
    if v_quantity<1 or v_quantity>20 then raise sqlstate 'PT400' using message='Honey quantity must be between 1 and 20'; end if;
    select * into v_colony from public.apiary_colonies where save_id=p_save_id and id=v_colony_id for update;
    if not found then raise sqlstate 'PT404' using message='Colony not found'; end if;
    if v_colony.treatment_days_remaining>0 then raise sqlstate 'PT409' using message='Honey cannot be extracted during treatment'; end if;
    v_surplus:=greatest(0,v_colony.floral_honey-4);
    if v_quantity>v_surplus then raise sqlstate 'PT422' using message='Only safe floral-honey surplus can be extracted'; end if;
    select * into strict v_hive from public.apiary_hives where save_id=p_save_id and id=v_colony.hive_id;
    v_quality:=least(6,greatest(0,round((v_colony.health-greatest(
      v_colony.varroa_pressure,v_colony.chalkbrood_pressure,v_colony.nosema_pressure)/2.0)/15.0)::integer))::smallint;
    v_batch_id:=extensions.gen_random_uuid();
    update public.apiary_colonies set floral_honey=floral_honey-v_quantity,updated_at=now() where id=v_colony_id;
    insert into public.ingredient_batches(id,save_id,rules_version,plant_key,quality_index,quantity,
      brew_bonus,bake_bonus,source_cell_id,source_action_id,source_kind,source_apiary_action_id,provenance)
    values(v_batch_id,p_save_id,v_save.garden_rules_version,'honey',v_quality,v_quantity,
      private.recipe_modifier(2::smallint,v_quality),private.recipe_modifier(2::smallint,v_quality),v_hive.cell_id,null,
      'honey',p_action_id,jsonb_build_object('kind','honey','rulesVersion',v_save.garden_rules_version,
        'hiveId',v_hive.id,'colonyId',v_colony.id,'extractedDay',v_save.current_day,
        'colonyHealth',v_colony.health,'varroaPressure',v_colony.varroa_pressure,
        'chalkbroodPressure',v_colony.chalkbrood_pressure,'nosemaPressure',v_colony.nosema_pressure,
        'floralHoneyBefore',v_colony.floral_honey,'protectedHoneyReserve',4));
    v_result:=jsonb_build_object('colonyId',v_colony_id,'ingredientBatchId',v_batch_id,
      'quantity',v_quantity,'qualityIndex',v_quality,'floralHoneyRemaining',v_colony.floral_honey-v_quantity,
      'protectedHoneyReserve',4);
  end if;

  v_result:=jsonb_build_object('actionId',p_action_id,'commandKind',p_command_kind,
    'committedRevision',v_save.revision+1,'rulesVersion',v_save.garden_rules_version,
    'normalizedPayload',p_payload,'result',v_result);
  insert into public.garden_actions(save_id,action_id,actor_id,command_kind,input_payload,
    input_expected_revision,rules_version,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,'apiary_'||p_command_kind,p_payload,p_expected_revision,
    v_save.garden_rules_version,v_result,v_save.revision+1);
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=p_save_id;
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid apiary command payload';
end;
$$;

alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_apiary_commands;
alter function public.get_tavern_snapshot_before_apiary_commands() set schema private;
create function public.get_tavern_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_save_id uuid; v_cells jsonb;
begin
  v_result:=private.get_tavern_snapshot_before_apiary_commands();
  if v_result is null then return null; end if;
  v_save_id:=(v_result#>>'{save,id}')::uuid;

  select coalesce(jsonb_agg(case when ac.id is null then e.cell else
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(e.cell,
      '{hive,colony,feedStores}',to_jsonb(ac.feed_stores),true),
      '{hive,colony,treatmentTradeoff}',coalesce(to_jsonb(ac.treatment_tradeoff),'null'::jsonb),true),
      '{hive,colony,threatDays}',to_jsonb(ac.threat_days),true),
      '{hive,colony,symptoms}',private.apiary_symptoms(ac.food_stores,ac.health,ac.varroa_pressure,
        ac.chalkbrood_pressure,ac.nosema_pressure),true),
      '{hive,colony,extractableSurplus}',to_jsonb(case when ac.treatment_days_remaining>0 then 0
        else greatest(0,ac.floral_honey-4) end),true)
    end order by e.ordinality),'[]'::jsonb) into v_cells
  from jsonb_array_elements(v_result->'cells') with ordinality e(cell,ordinality)
  left join public.apiary_hives h on h.save_id=v_save_id and h.id=nullif(e.cell#>>'{hive,id}','')::uuid
  left join public.apiary_colonies ac on ac.save_id=h.save_id and ac.hive_id=h.id;
  v_result:=jsonb_set(v_result,'{cells}',v_cells,true);

  return jsonb_set(v_result,'{ingredients}',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',b.id,'plantKey',b.plant_key,'plantName',pc.display_name,'icon',pc.icon,
      'qualityIndex',b.quality_index,'quantity',b.quantity-b.consumed_quantity-b.composted_quantity,
      'brewBonus',b.brew_bonus,'bakeBonus',b.bake_bonus,'sourceCellId',b.source_cell_id,
      'sourceKind',b.source_kind,'provenance',b.provenance,
      'consumedQuantity',b.consumed_quantity,'compostedQuantity',b.composted_quantity,
      'createdAt',b.created_at) order by b.created_at desc,b.id)
    from public.ingredient_batches b
    join public.plant_catalog pc on pc.rules_version=b.rules_version and pc.plant_key=b.plant_key
    where b.save_id=v_save_id and b.quantity>b.consumed_quantity+b.composted_quantity
  ),'[]'::jsonb),true);
end;
$$;

revoke all on function private.canonical_apiary_payload(text,jsonb),
  private.apiary_symptoms(integer,integer,integer,integer,integer),
  private.get_tavern_snapshot_before_apiary_commands() from public,anon,authenticated;
revoke all on function public.preview_apiary_command(text,jsonb),
  public.apiary_command(uuid,uuid,bigint,text,jsonb),public.get_tavern_snapshot() from public,anon;
grant execute on function public.preview_apiary_command(text,jsonb),
  public.apiary_command(uuid,uuid,bigint,text,jsonb),public.get_tavern_snapshot() to authenticated;

commit;
