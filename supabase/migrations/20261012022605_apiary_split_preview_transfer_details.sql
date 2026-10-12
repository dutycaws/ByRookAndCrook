-- Expose the exact resources an apiary split will move before committing.
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
      'requirements',jsonb_build_object('adults',10000,'brood',2000,'foodStores',30,'health',60),
      'targetHiveId',v_hive.id,
      'transferred',case when v_colony.id is null then null else jsonb_build_object(
        'adults',floor(v_colony.adults/2.0)::integer,
        'brood',floor(v_colony.brood/2.0)::integer,
        'foodStores',floor(v_colony.food_stores/2.0)::integer,
        'floralHoney',floor(v_colony.floral_honey/2.0)::integer,
        'feedStores',floor(v_colony.feed_stores/2.0)::integer) end,
      'canCommit',v_can);
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

revoke all on function public.preview_apiary_command(text,jsonb) from public,anon;
grant execute on function public.preview_apiary_command(text,jsonb) to authenticated;

commit;
