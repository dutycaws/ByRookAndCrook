-- Issue #39: social cards come from the garden; crafts create only serving stock.
begin;

-- These use the existing seed purchase/plant/day-resolution loop.  Their yields are
-- still useful provenance for the garden ledger, but only their harvest schedules a
-- social-card copy for the following morning.
insert into public.garden_species_profiles values
  ('garden-apiary-v1','charm_bloom','Charm Bloom','🌸','petals',4,2,true,38,70,30,30,32,82,82,82,3,3,3,48,95,1,55,3,1,3,true,1,1),
  ('garden-apiary-v1','insight_iris','Insight Iris','🪻','petals',5,3,true,32,62,28,32,30,78,80,80,3,3,3,55,95,2,60,3,1,3,true,1,1),
  ('garden-apiary-v1','rumor_thyme','Rumor Thyme','🌱','leaves',4,2,true,35,66,26,28,26,78,78,78,3,3,3,45,95,1,58,3,1,3,true,1,1)
on conflict (rules_version,species_key) do nothing;

insert into public.plant_catalog (rules_version,plant_key,display_name,icon,base_brew_bonus,base_bake_bonus)
select rules_version,species_key,display_name,icon,base_brew_bonus,base_bake_bonus
from public.garden_species_profiles
where rules_version='garden-apiary-v1' and species_key in ('charm_bloom','insight_iris','rumor_thyme')
on conflict do nothing;

insert into public.garden_item_catalog (rules_version,item_key,item_kind,display_name,price,effect) values
  ('garden-apiary-v1','seed_charm_bloom','seed','Charm Bloom seed',8,'{"species":"charm_bloom"}'::jsonb),
  ('garden-apiary-v1','seed_insight_iris','seed','Insight Iris seed',9,'{"species":"insight_iris"}'::jsonb),
  ('garden-apiary-v1','seed_rumor_thyme','seed','Rumor Thyme seed',8,'{"species":"rumor_thyme"}'::jsonb)
on conflict (rules_version,item_key) do nothing;

-- Existing saves have already been initialized by the shop-stock migration, so add
-- the new catalog rows without resetting today's remaining quantities.
do $$ declare v_save record; begin
  for v_save in select id,current_day from public.tavern_saves loop
    perform private.ensure_garden_shop_stock(v_save.id,v_save.current_day,false);
  end loop;
end $$;

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
  v_social_card_key text;
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
  v_social_card_key:=case v_plant.species_key
    when 'charm_bloom' then 'charm'
    when 'insight_iris' then 'insight'
    when 'rumor_thyme' then 'rumor'
  end;
  v_result:=jsonb_build_object(
    'actionId',p_action_id,'cellId',p_cell_id,'ingredientBatchId',v_batch,
    'quantity',v_quantity,'baseQualityIndex',v_base_quality,
    'trinketQualityBonus',v_trinket_quality_bonus,'qualityIndex',v_quality,
    'brewBonus',v_brew,'bakeBonus',v_bake,
    'committedRevision',v_save.revision+1,'rulesVersion','garden-apiary-v1',
    'trinketRulesVersion','trinket-effects-v1',
    'regrowing',v_profile.regrows,'productionCycle',v_plant.production_cycle
  );
  if v_social_card_key is not null then
    v_result:=v_result||jsonb_build_object('scheduledSocialCardKey',v_social_card_key,'socialCardEffectiveDay',v_save.current_day+1);
  end if;

  insert into public.game_actions(save_id,action_id,actor_id,command_kind,input_cell_id,
    input_expected_revision,rules_version,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,'harvest_crop',p_cell_id,p_expected_revision,
    'garden-apiary-v1',v_result,v_save.revision+1);
  insert into public.ingredient_batches(id,save_id,rules_version,plant_key,quality_index,quantity,
    brew_bonus,bake_bonus,source_cell_id,source_action_id)
  values(v_batch,p_save_id,'garden-apiary-v1',v_plant.species_key,v_quality,v_quantity,
    v_brew,v_bake,p_cell_id,p_action_id);
  if v_social_card_key is not null then
    insert into public.daily_deck_changes(save_id,effective_day,change_kind,card_key,source_action_id)
    values(p_save_id,v_save.current_day+1,'add_social',v_social_card_key,p_action_id);
  end if;

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

-- Craft requests are allowed only before opening.  Each public wrapper first
-- recognizes an exact completed command, so a delayed retry remains replayable
-- after the deck has moved into service.
create function private.issue39_assert_preparation(p_save_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_save public.tavern_saves%rowtype; v_phase text;
begin
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or craft not found'; end if;
  select phase into v_phase from public.daily_decks where save_id=p_save_id and day_number=v_save.current_day for update;
  if found and v_phase<>'preparation' then raise sqlstate 'PT409' using message='Brewing and baking are available only during preparation'; end if;
end $$;
revoke all on function private.issue39_assert_preparation(uuid) from public,anon,authenticated;

alter function public.start_brew(uuid,uuid,uuid,bigint) rename to start_brew_before_issue39;
alter function public.start_brew_before_issue39(uuid,uuid,uuid,bigint) set schema private;
create function public.start_brew(p_save_id uuid,p_ingredient_batch_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.craft_actions a join public.tavern_saves s on s.id=a.save_id and s.user_id=auth.uid() where a.save_id=p_save_id and a.action_id=p_action_id) then
    return private.start_brew_before_issue39(p_save_id,p_ingredient_batch_id,p_action_id,p_expected_revision);
  end if;
  perform private.issue39_assert_preparation(p_save_id);
  return private.start_brew_before_issue39(p_save_id,p_ingredient_batch_id,p_action_id,p_expected_revision);
end $$;

alter function public.start_bake(uuid,uuid,uuid,bigint) rename to start_bake_before_issue39;
alter function public.start_bake_before_issue39(uuid,uuid,uuid,bigint) set schema private;
create function public.start_bake(p_save_id uuid,p_ingredient_batch_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.bake_actions a join public.tavern_saves s on s.id=a.save_id and s.user_id=auth.uid() where a.save_id=p_save_id and a.action_id=p_action_id) then
    return private.start_bake_before_issue39(p_save_id,p_ingredient_batch_id,p_action_id,p_expected_revision);
  end if;
  perform private.issue39_assert_preparation(p_save_id);
  return private.start_bake_before_issue39(p_save_id,p_ingredient_batch_id,p_action_id,p_expected_revision);
end $$;

-- Preserve the generated-recipe overload while applying the same phase fence.
alter function public.start_bake(uuid,uuid,text,uuid,bigint) rename to start_bake_recipe_before_issue39;
alter function public.start_bake_recipe_before_issue39(uuid,uuid,text,uuid,bigint) set schema private;
create function public.start_bake(p_save_id uuid,p_ingredient_batch_id uuid,p_recipe_key text,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.bake_actions a join public.tavern_saves s on s.id=a.save_id and s.user_id=auth.uid() where a.save_id=p_save_id and a.action_id=p_action_id) then
    return private.start_bake_recipe_before_issue39(p_save_id,p_ingredient_batch_id,p_recipe_key,p_action_id,p_expected_revision);
  end if;
  perform private.issue39_assert_preparation(p_save_id);
  return private.start_bake_recipe_before_issue39(p_save_id,p_ingredient_batch_id,p_recipe_key,p_action_id,p_expected_revision);
end $$;

alter function public.complete_bake(uuid,uuid,uuid,bigint) rename to complete_bake_before_issue39;
alter function public.complete_bake_before_issue39(uuid,uuid,uuid,bigint) set schema private;
create function public.complete_bake(p_save_id uuid,p_session_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_save public.tavern_saves%rowtype;
  v_session public.bake_sessions%rowtype;
  v_action public.bake_actions%rowtype;
  v_finished timestamptz:=clock_timestamp();
  v_elapsed bigint;
  v_band text;
  v_technique smallint;
  v_base smallint;
  v_quality smallint;
  v_food uuid:=extensions.gen_random_uuid();
  v_name text;
  v_recipe_key text;
  v_generated_label text;
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise sqlstate 'PT400' using message='Invalid bake completion';
  end if;
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or bake not found'; end if;
  select * into v_action from public.bake_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_action.command_kind='complete_bake' and v_action.subject_id=p_session_id and v_action.input_expected_revision=p_expected_revision then return v_action.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  perform private.issue39_assert_preparation(p_save_id);
  if v_save.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before taking out the loaf'; end if;
  select * into v_session from public.bake_sessions where save_id=p_save_id and id=p_session_id for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or bake not found'; end if;
  if v_save.daily_craft_kind<>'bake' or v_session.day_number<>v_save.current_day or v_session.status<>'baking' then
    raise sqlstate 'PT422' using message='This loaf is not in the oven';
  end if;
  perform 1 from public.ingredient_batches where save_id=p_save_id and id=v_session.ingredient_batch_id
    and quantity>consumed_quantity for update;
  if not found then raise sqlstate 'PT409' using message='The selected ingredient is no longer available'; end if;
  v_elapsed:=greatest(0,round(extract(epoch from (v_finished-v_session.oven_started_at))*1000))::bigint;
  v_band:=private.bake_timing_band(v_elapsed);
  v_technique:=least(6,greatest(0,round(6.0*(v_session.fold_points+v_session.score_points)::numeric/18.0)))::smallint;
  v_base:=least(4,greatest(0,round((v_session.ingredient_quality_index::numeric+v_technique::numeric
    +least(4,v_session.ingredient_bake_bonus)::numeric/2.0)/3.0)))::smallint;
  v_quality:=least(6,v_base+case v_band when 'green' then 2 when 'yellow' then 1 else 0 end)::smallint;
  v_name:=private.bread_name(v_quality);
  v_recipe_key:=v_session.recipe_key;
  if v_recipe_key like 'generated-%' then
    select d.display_name into v_generated_label from private.world_generated_gameplay_definitions d
      join private.world_canonical_entities e on e.id=d.canonical_entity_id
      where d.save_id=p_save_id and d.family='herb_loaf_variant' and e.entity_key=substring(v_recipe_key from 11);
    if v_generated_label is null then raise sqlstate 'PT409' using message='Generated recipe definition is unavailable'; end if;
    v_name:=v_generated_label;
  end if;
  insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id,bake_session_id,ingredient_batch_id,rules_version)
  values(v_food,p_save_id,v_name,v_recipe_key,v_quality,v_save.current_day,p_action_id,p_session_id,v_session.ingredient_batch_id,'bake-v1');
  update public.ingredient_batches set consumed_quantity=consumed_quantity+1 where save_id=p_save_id and id=v_session.ingredient_batch_id;
  update public.bake_sessions set status='completed',completed_at=v_finished,oven_elapsed_ms=v_elapsed,timing_band=v_band,
    technique_score=v_technique,quality_index=v_quality where id=p_session_id;
  update public.tavern_saves set day_minigame_completed=true,daily_craft_kind=null,revision=revision+1,updated_at=now() where id=p_save_id;
  v_receipt:=jsonb_build_object('actionId',p_action_id,'sessionId',p_session_id,'foodId',v_food,'foodName',v_name,
    'qualityIndex',v_quality,'techniqueScore',v_technique,'timingBand',v_band,'ovenElapsedMs',v_elapsed,
    'committedRevision',v_save.revision+1,'dayNumber',v_save.current_day,'rulesVersion','bake-v1');
  if v_recipe_key<>'herb-loaf' then v_receipt:=v_receipt||jsonb_build_object('recipeKey',v_recipe_key); end if;
  insert into public.bake_actions(save_id,action_id,actor_id,command_kind,subject_id,input_expected_revision,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,'complete_bake',p_session_id,p_expected_revision,v_receipt,v_save.revision+1);
  return v_receipt;
end $$;

alter function public.complete_brew(uuid,uuid,uuid,bigint,integer,integer,integer) rename to complete_brew_before_issue39;
alter function public.complete_brew_before_issue39(uuid,uuid,uuid,bigint,integer,integer,integer) set schema private;
create function public.complete_brew(p_save_id uuid,p_session_id uuid,p_action_id uuid,p_expected_revision bigint,p_perfect_ticks integer,p_good_ticks integer,p_total_ticks integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_save public.tavern_saves%rowtype;
  v_session public.brew_sessions%rowtype;
  v_action public.craft_actions%rowtype;
  v_result jsonb;
  v_beverage_id uuid:=extensions.gen_random_uuid();
  v_stir_score smallint;
  v_quality smallint;
  v_name text;
  v_target_ticks integer;
begin
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision<0
    or p_perfect_ticks is null or p_good_ticks is null or p_total_ticks is null
    or p_perfect_ticks<0 or p_good_ticks<0 or p_total_ticks<0
    or p_total_ticks>160 or p_perfect_ticks+p_good_ticks>p_total_ticks then
    raise sqlstate 'PT400' using message='Invalid brew completion';
  end if;

  select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or brew not found'; end if;
  select * into v_action from public.craft_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_action.command_kind='complete_brew' and v_action.subject_id=p_session_id
      and v_action.input_expected_revision=p_expected_revision
      and v_action.input_perfect_ticks=p_perfect_ticks and v_action.input_good_ticks=p_good_ticks
      and v_action.input_total_ticks=p_total_ticks then return v_action.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  perform private.issue39_assert_preparation(p_save_id);
  if v_save.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before bottling'; end if;
  select * into v_session from public.brew_sessions where save_id=p_save_id and id=p_session_id for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or brew not found'; end if;
  if v_session.status<>'active' then raise sqlstate 'PT409' using message='This brew is already complete'; end if;
  if v_session.day_number<>v_save.current_day then raise sqlstate 'PT422' using message='This brew cannot be completed on the current tavern day'; end if;
  v_target_ticks:=v_session.duration_seconds*4;
  if p_total_ticks<>v_target_ticks then raise sqlstate 'PT400' using message='Guided stirring requires a complete scoring record'; end if;
  if clock_timestamp()<v_session.started_at+make_interval(secs=>v_session.countdown_seconds+v_session.duration_seconds) then
    raise sqlstate 'PT422' using message='The guided stir is still in progress';
  end if;
  perform 1 from public.ingredient_batches batch where batch.save_id=p_save_id and batch.id=v_session.ingredient_batch_id
    and batch.quantity>batch.consumed_quantity for update;
  if not found then raise sqlstate 'PT409' using message='The selected ingredient is no longer available'; end if;
  v_stir_score:=least(6,greatest(0,round(6.0*(p_perfect_ticks+p_good_ticks*0.5)/v_target_ticks)))::smallint;
  v_quality:=least(6,greatest(0,round((v_session.ingredient_quality_index::numeric+v_stir_score::numeric)/2.0)
    +case when v_session.ingredient_brew_bonus>=4 then 1 else 0 end))::smallint;
  v_name:=private.brew_name(v_quality);
  insert into public.beverages(id,save_id,brew_session_id,ingredient_batch_id,rules_version,name,quality_index)
  values(v_beverage_id,p_save_id,p_session_id,v_session.ingredient_batch_id,v_session.rules_version,v_name,v_quality);
  update public.ingredient_batches set consumed_quantity=consumed_quantity+1 where save_id=p_save_id and id=v_session.ingredient_batch_id;
  update public.brew_sessions set status='completed',completed_at=clock_timestamp(),perfect_ticks=p_perfect_ticks,
    good_ticks=p_good_ticks,total_ticks=p_total_ticks,stir_score=v_stir_score,quality_index=v_quality where id=p_session_id;
  update public.tavern_saves set revision=revision+1,day_minigame_completed=true,daily_craft_kind=null,updated_at=now() where id=p_save_id;
  v_result:=jsonb_build_object('actionId',p_action_id,'sessionId',p_session_id,'beverageId',v_beverage_id,
    'beverageName',v_name,'qualityIndex',v_quality,'stirScore',v_stir_score,
    'committedRevision',v_save.revision+1,'dayNumber',v_save.current_day,'rulesVersion','brew-v2');
  insert into public.craft_actions(save_id,action_id,actor_id,command_kind,subject_id,input_expected_revision,
    input_perfect_ticks,input_good_ticks,input_total_ticks,result,committed_revision)
  values(p_save_id,p_action_id,v_actor,'complete_brew',p_session_id,p_expected_revision,p_perfect_ticks,p_good_ticks,
    p_total_ticks,v_result,v_save.revision+1);
  return v_result;
end $$;

revoke all on function private.start_brew_before_issue39(uuid,uuid,uuid,bigint),
  private.start_bake_before_issue39(uuid,uuid,uuid,bigint),
  private.start_bake_recipe_before_issue39(uuid,uuid,text,uuid,bigint),
  private.complete_bake_before_issue39(uuid,uuid,uuid,bigint),
  private.complete_brew_before_issue39(uuid,uuid,uuid,bigint,integer,integer,integer)
from public,anon,authenticated;
revoke all on function public.start_brew(uuid,uuid,uuid,bigint),public.start_bake(uuid,uuid,uuid,bigint),public.start_bake(uuid,uuid,text,uuid,bigint),public.complete_bake(uuid,uuid,uuid,bigint),public.complete_brew(uuid,uuid,uuid,bigint,integer,integer,integer) from public,anon;
grant execute on function public.start_brew(uuid,uuid,uuid,bigint),public.start_bake(uuid,uuid,uuid,bigint),public.start_bake(uuid,uuid,text,uuid,bigint),public.complete_bake(uuid,uuid,uuid,bigint),public.complete_brew(uuid,uuid,uuid,bigint,integer,integer,integer) to authenticated;

commit;
