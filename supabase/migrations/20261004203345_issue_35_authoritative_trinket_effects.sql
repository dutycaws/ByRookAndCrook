-- Apply equipped trinket effects at the existing authoritative action fences.
-- The saved receipt snapshots the effect totals used for each committed action.
begin;

create or replace function private.world_npc_apply_hospitality(
  p_actor uuid,p_save uuid,p_instance uuid,p_kind text,p_item uuid,p_action uuid,p_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  save_row public.tavern_saves;
  resident private.world_npc_instances;
  beverage public.beverages;
  food public.foods;
  prior private.world_npc_hospitality_events;
  item_name text;
  item_quality integer;
  relationship_delta integer;
  base_gold integer;
  revenue_bonus_basis_points integer;
  gold_earned integer;
  result jsonb;
begin
  if p_actor is null or p_save is null or p_instance is null or p_kind not in ('beverage','food')
    or p_item is null or p_action is null or p_revision is null then
    raise sqlstate 'PT400' using message='Invalid hospitality request';
  end if;

  select * into save_row from public.tavern_saves where id=p_save and user_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or offering not found'; end if;
  select * into prior from private.world_npc_hospitality_events where save_id=p_save and action_id=p_action;
  if found then
    if prior.instance_id=p_instance and prior.item_kind=p_kind
      and coalesce(prior.beverage_id,prior.food_id)=p_item and prior.input_expected_revision=p_revision then
      return prior.result;
    end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for different input';
  end if;
  if save_row.revision<>p_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before serving'; end if;
  select * into resident from private.world_npc_instances where id=p_instance and save_id=p_save for update;
  if not found or resident.status in ('dead','departed','dismissed','removed','quarantined') then
    raise sqlstate 'PT422' using message='This guest is unavailable';
  end if;

  if p_kind='beverage' then
    select * into beverage from public.beverages where save_id=p_save and id=p_item;
    if not found or exists(select 1 from private.world_npc_hospitality_events
      where save_id=p_save and beverage_id=p_item) then
      raise sqlstate 'PT409' using message='Drink is unavailable';
    end if;
    item_name:=beverage.name;
    item_quality:=beverage.quality_index;
  else
    select * into food from public.foods where save_id=p_save and id=p_item;
    if not found or exists(select 1 from private.world_npc_hospitality_events
      where save_id=p_save and food_id=p_item) then
      raise sqlstate 'PT409' using message='Food is unavailable';
    end if;
    item_name:=food.name;
    item_quality:=food.quality_index;
  end if;

  relationship_delta:=private.world_npc_apply_relationship_change(
    p_instance,save_row.current_day,
    case when item_quality>=4 then 2 when item_quality>=2 then 1 when item_quality=1 then -1 else -2 end,
    'hospitality',p_item,null
  );
  base_gold:=(array[1,3,6,10,16,25,40])[item_quality+1];
  select case when p_kind='food' then effects.food_revenue_basis_points
    else effects.drink_revenue_basis_points end
    into revenue_bonus_basis_points
  from private.trinket_effect_totals(p_save) effects;
  gold_earned:=round(base_gold::numeric*(10000+revenue_bonus_basis_points)::numeric/10000)::integer;

  result:=jsonb_build_object(
    'actionId',p_action,'instanceId',p_instance,'itemKind',p_kind,'itemId',p_item,'itemName',item_name,
    'qualityIndex',item_quality,'baseGoldEarned',base_gold,
    'trinketRevenueBonusBasisPoints',revenue_bonus_basis_points,
    'goldEarned',gold_earned,'goldBalance',save_row.gold+gold_earned,
    'relationshipChange',relationship_delta,
    'relationship',greatest(0,least(100,resident.relationship+relationship_delta)),
    'dayNumber',save_row.current_day,'committedRevision',save_row.revision+1,
    'rulesVersion','world-hospitality-v2','trinketRulesVersion','trinket-effects-v1'
  );

  update public.tavern_saves set gold=gold+gold_earned,revision=revision+1,updated_at=now() where id=p_save;
  insert into private.world_npc_hospitality_events(
    save_id,action_id,actor_id,instance_id,item_kind,beverage_id,food_id,input_expected_revision,
    day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision
  ) values(
    p_save,p_action,p_actor,p_instance,p_kind,case when p_kind='beverage' then p_item end,
    case when p_kind='food' then p_item end,p_revision,save_row.current_day,item_name,item_quality,
    gold_earned,relationship_delta,result,save_row.revision+1
  );
  return result;
end
$fn$;

create or replace function public.harvest_crop(
  p_save_id uuid,p_cell_id uuid,p_action_id uuid,p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_actor uuid:=auth.uid();
  v_save public.tavern_saves;
  v_cell public.garden_cells;
  v_plant public.garden_plants;
  v_profile public.garden_species_profiles;
  v_action public.game_actions;
  v_batch uuid:=extensions.gen_random_uuid();
  v_base_quality smallint;
  v_quality smallint;
  v_trinket_quality_bonus smallint;
  v_quantity integer;
  v_brew smallint;
  v_bake smallint;
  v_result jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_cell_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision<0 then
    raise sqlstate 'PT400' using message='Invalid harvest request';
  end if;
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

  v_base_quality:=private.garden_quality_index(v_plant.care_good_days,v_plant.care_total_days,
    v_plant.stress_points,v_plant.companion_points,v_plant.pollination_points);
  v_quantity:=v_profile.base_yield+case when v_profile.pollination_eligible
    and v_plant.pollination_points*2>=greatest(1,v_plant.care_total_days) then 1 else 0 end;
  if v_plant.ready_since_day is not null and v_save.current_day-v_plant.ready_since_day>=3 then
    v_base_quality:=greatest(0,v_base_quality-1);
    v_quantity:=greatest(1,v_quantity-1);
  end if;

  select effects.harvest_quality into v_trinket_quality_bonus
  from private.trinket_effect_totals(p_save_id) effects;
  v_trinket_quality_bonus:=coalesce(v_trinket_quality_bonus,0);
  v_quality:=greatest(0,least(6,v_base_quality+v_trinket_quality_bonus))::smallint;
  v_brew:=private.recipe_modifier(v_profile.base_brew_bonus,v_quality);
  v_bake:=private.recipe_modifier(v_profile.base_bake_bonus,v_quality);
  v_result:=jsonb_build_object(
    'actionId',p_action_id,'cellId',p_cell_id,'ingredientBatchId',v_batch,
    'quantity',v_quantity,'baseQualityIndex',v_base_quality,
    'trinketQualityBonus',v_trinket_quality_bonus,'qualityIndex',v_quality,
    'brewBonus',v_brew,'bakeBonus',v_bake,
    'committedRevision',v_save.revision+1,'rulesVersion','garden-apiary-v1',
    'trinketRulesVersion','trinket-effects-v1',
    'regrowing',v_profile.regrows,'productionCycle',v_plant.production_cycle
  );

  insert into public.game_actions(save_id,action_id,actor_id,command_kind,input_cell_id,
    input_expected_revision,rules_version,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,'harvest_crop',p_cell_id,p_expected_revision,
    'garden-apiary-v1',v_result,v_save.revision+1);
  insert into public.ingredient_batches(id,save_id,rules_version,plant_key,quality_index,quantity,
    brew_bonus,bake_bonus,source_cell_id,source_action_id)
  values(v_batch,p_save_id,'garden-apiary-v1',v_plant.species_key,v_quality,v_quantity,
    v_brew,v_bake,p_cell_id,p_action_id);

  if v_profile.regrows then
    update public.garden_plants set lifecycle='regrowing',growth_progress=35,
      production_cycle=production_cycle+1,care_good_days=0,care_total_days=0,
      stress_points=0,companion_points=0,pollination_points=0,flowering_days_remaining=0,
      ready_since_day=null,threat_days=0,updated_at=now() where id=v_plant.id;
    update public.garden_cells set growth_stage=1,updated_at=now() where id=p_cell_id;
  else
    delete from public.garden_plants where id=v_plant.id;
    update public.garden_cells set kind='empty',plant_key=null,growth_stage=null,
      water=null,health=null,updated_at=now() where id=p_cell_id;
  end if;
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=p_save_id;
  return v_result;
end
$function$;

commit;
