-- Tighten apiary splits and keep ingredient composting to one reserved-safe item.
begin;
create or replace function public.preview_apiary_command(p_command_kind text,p_payload jsonb)
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
    select h.* into v_hive
    from public.apiary_hives h
    join public.garden_cells c on c.save_id=h.save_id and c.id=h.cell_id
    where h.save_id=v_save.id and h.id=(p_payload->>'targetHiveId')::uuid
      and c.unlocked and c.kind='beehive';
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
    v_can:=v_quantity>=1 and v_quantity<=v_surplus and v_colony.treatment_days_remaining=0;
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
create or replace function public.apiary_command(
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
    select h.* into v_target_hive
    from public.apiary_hives h
    join public.garden_cells c on c.save_id=h.save_id and c.id=h.cell_id
    where h.save_id=p_save_id and h.id=v_target_hive_id
      and c.unlocked and c.kind='beehive'
    for update of h,c;
    if not found then raise sqlstate 'PT404' using message='Target hive not found or unavailable'; end if;
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
    if v_quantity<1 then raise sqlstate 'PT400' using message='Honey quantity must be positive'; end if;
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
create or replace function public.preview_garden_command(p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_result jsonb; v_save public.tavern_saves; v_stock public.garden_shop_stock;
  v_quantity integer; v_cost integer; v_reasons jsonb:='[]'::jsonb;
  v_payload jsonb; v_cell public.garden_cells; v_batch public.ingredient_batches;
  v_available integer; v_reserved boolean:=false;
begin
  if p_command_kind='compost_ingredient' then
    if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
    v_payload:=private.canonical_garden_payload(p_command_kind,p_payload);
    select * into v_save from public.tavern_saves where user_id=auth.uid();
    if not found then return null; end if;
    if (v_payload->>'quantity')::integer<>1 then
      raise sqlstate 'PT400' using message='Compost quantity must be exactly one';
    end if;
    select * into v_cell from public.garden_cells
      where save_id=v_save.id and id=(v_payload->>'cellId')::uuid and unlocked;
    if not found then raise sqlstate 'PT404' using message='Garden cell not found'; end if;
    select * into v_batch from public.ingredient_batches
      where save_id=v_save.id and id=(v_payload->>'ingredientBatchId')::uuid;
    if not found then raise sqlstate 'PT404' using message='Ingredient batch not found'; end if;
    v_available:=greatest(0,v_batch.quantity-v_batch.consumed_quantity-v_batch.composted_quantity);
    select exists(
      select 1 from public.brew_sessions
      where save_id=v_save.id and ingredient_batch_id=v_batch.id and status='active'
    ) or exists(
      select 1 from public.bake_sessions
      where save_id=v_save.id and ingredient_batch_id=v_batch.id and status<>'completed'
    ) into v_reserved;
    if v_reserved then v_reasons:=v_reasons||jsonb_build_array('reserved_for_active_craft'); end if;
    if v_available<1 then v_reasons:=v_reasons||jsonb_build_array('insufficient_ingredient'); end if;
    return jsonb_build_object(
      'commandKind',p_command_kind,'basedOnRevision',v_save.revision,
      'rulesVersion',v_save.garden_rules_version,'normalizedPayload',v_payload,
      'quantity',1,'available',v_available,'blockingReasons',v_reasons,
      'canCommit',not v_reserved and v_available>=1);
  end if;

  v_result:=private.preview_garden_command_before_shop_stock(p_command_kind,p_payload);
  if p_command_kind<>'purchase' or v_result is null then return v_result; end if;
  select * into v_save from public.tavern_saves where user_id=auth.uid();
  v_quantity:=(v_result#>>'{normalizedPayload,quantity}')::integer;
  select * into v_stock from public.garden_shop_stock
    where save_id=v_save.id and item_key=v_result#>>'{normalizedPayload,itemKey}';
  if not found then raise sqlstate 'PT422' using message='That item is not stocked today'; end if;
  v_cost:=(v_result->>'goldCost')::integer;
  if v_save.gold<v_cost then v_reasons:=v_reasons||jsonb_build_array('insufficient_gold'); end if;
  if v_stock.remaining_quantity=0 then v_reasons:=v_reasons||jsonb_build_array('depleted_stock');
  elsif v_quantity>v_stock.remaining_quantity then v_reasons:=v_reasons||jsonb_build_array('quantity_exceeds_stock'); end if;
  return v_result||jsonb_build_object(
    'dailyCap',v_stock.daily_cap,'remainingStock',v_stock.remaining_quantity,
    'restockDay',case when v_stock.remaining_quantity<v_stock.daily_cap then v_save.current_day+1 else v_stock.restock_day end,
    'requestedQuantity',v_quantity,'maxQuantity',least(20,v_stock.remaining_quantity),
    'goldDeficit',greatest(0,v_cost-v_save.gold),'blockingReasons',v_reasons,
    'status',case when jsonb_array_length(v_reasons)=0 then 'ready'
      when v_reasons ? 'insufficient_gold' then 'insufficient_gold'
      when v_reasons ? 'depleted_stock' then 'sold_out' else 'exceeds_stock' end,
    'canCommit',jsonb_array_length(v_reasons)=0);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid garden preview';
end;
$$;
create or replace function public.garden_command(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_save public.tavern_saves; v_prior public.garden_actions;
  v_item public.garden_item_catalog; v_stock public.garden_shop_stock; v_payload jsonb;
  v_quantity integer; v_cost integer; v_result jsonb;
begin
  if p_command_kind='compost_ingredient' then
    if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
    if p_save_id is null or p_action_id is null or p_expected_revision is null
      or p_expected_revision<0 or jsonb_typeof(p_payload)<>'object' then
      raise sqlstate 'PT400' using message='Invalid garden command';
    end if;
    v_payload:=private.canonical_garden_payload(p_command_kind,p_payload);
    select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
    if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
    select * into v_prior from public.garden_actions where save_id=p_save_id and action_id=p_action_id;
    if found then
      if v_prior.command_kind=p_command_kind and v_prior.input_payload=v_payload
        and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
      raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
    end if;
    if v_save.revision<>p_expected_revision then
      raise sqlstate 'PT409' using message='Garden state changed; refresh before acting';
    end if;
    if (v_payload->>'quantity')::integer<>1 then
      raise sqlstate 'PT400' using message='Compost quantity must be exactly one';
    end if;
    return private.garden_command_before_shop_stock(
      p_save_id,p_action_id,p_expected_revision,p_command_kind,v_payload);
  end if;
  if p_command_kind<>'purchase' then
    return private.garden_command_before_shop_stock(p_save_id,p_action_id,p_expected_revision,p_command_kind,p_payload);
  end if;
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload)<>'object' then
    raise sqlstate 'PT400' using message='Invalid garden command'; end if;
  v_payload:=private.canonical_garden_payload('purchase',p_payload);
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into v_prior from public.garden_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_prior.command_kind='purchase' and v_prior.input_payload=v_payload and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if v_save.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Garden state changed; refresh before acting'; end if;
  v_quantity:=(v_payload->>'quantity')::integer;
  if v_quantity<1 or v_quantity>20 then raise sqlstate 'PT400' using message='Purchase quantity must be between 1 and 20'; end if;
  select * into v_item from public.garden_item_catalog where rules_version=v_save.garden_rules_version and item_key=v_payload->>'itemKey';
  if not found then raise sqlstate 'PT422' using message='Garden item not found'; end if;
  select * into v_stock from public.garden_shop_stock where save_id=p_save_id and item_key=v_item.item_key for update;
  if not found then raise sqlstate 'PT422' using message='That item is not stocked today'; end if;
  if v_stock.remaining_quantity=0 then raise sqlstate 'PT422' using message='That item is out of stock'; end if;
  if v_quantity>v_stock.remaining_quantity then raise sqlstate 'PT422' using message='Only '||v_stock.remaining_quantity||' left in stock'; end if;
  v_cost:=v_item.price*v_quantity;
  if v_save.gold<v_cost then raise sqlstate 'PT422' using message='Not enough gold'; end if;
  update public.garden_shop_stock set remaining_quantity=remaining_quantity-v_quantity,updated_at=now()
    where save_id=p_save_id and item_key=v_item.item_key;
  update public.tavern_saves set gold=gold-v_cost where id=p_save_id;
  insert into public.garden_inventory(save_id,item_key,rules_version,quantity) values(p_save_id,v_item.item_key,v_save.garden_rules_version,v_quantity)
    on conflict(save_id,item_key) do update set quantity=public.garden_inventory.quantity+excluded.quantity,updated_at=now();
  v_result:=jsonb_build_object('actionId',p_action_id,'commandKind','purchase','committedRevision',v_save.revision+1,
    'rulesVersion',v_save.garden_rules_version,'normalizedPayload',v_payload,'result',jsonb_build_object(
      'itemKey',v_item.item_key,'quantity',v_quantity,'goldSpent',v_cost,
      'previousGold',v_save.gold,'goldBalance',v_save.gold-v_cost,
      'previousStock',v_stock.remaining_quantity,'remainingStock',v_stock.remaining_quantity-v_quantity,
      'dailyCap',v_stock.daily_cap,'restockDay',v_save.current_day+1));
  insert into public.garden_actions(save_id,action_id,actor_id,command_kind,input_payload,input_expected_revision,rules_version,result,committed_revision)
    values(p_save_id,p_action_id,v_actor,'purchase',v_payload,p_expected_revision,v_save.garden_rules_version,v_result,v_save.revision+1);
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=p_save_id;
  return v_result;
end;
$$;
revoke all on function public.preview_apiary_command(text,jsonb),
  public.apiary_command(uuid,uuid,bigint,text,jsonb),
  public.preview_garden_command(text,jsonb),
  public.garden_command(uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.preview_apiary_command(text,jsonb),
  public.apiary_command(uuid,uuid,bigint,text,jsonb),
  public.preview_garden_command(text,jsonb),
  public.garden_command(uuid,uuid,bigint,text,jsonb) to authenticated;

commit;
