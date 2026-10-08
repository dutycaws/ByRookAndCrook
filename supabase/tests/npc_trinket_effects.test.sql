begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users(id,email,role,aud)
values('76000000-0000-4000-8000-000000000001','trinket-effects@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
select lives_ok($$select public.create_tavern()$$,'the effect journey provisions a playable tavern');
reset role;

create temporary table pg_temp.save_fixture as
select id as save_id,user_id,revision as initial_revision,gold as initial_gold
from public.tavern_saves where user_id='76000000-0000-4000-8000-000000000001';
create temporary table pg_temp.lira_identity as
select npc_id,active_version_id from private.npc_first_party_catalog_identities where identity_key='lira';
select ok(exists(select 1 from pg_temp.lira_identity),'published Lira version is available');
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.lira_resident as
select * from private.world_materialize_resident_from_version(
  (select save_id from pg_temp.save_fixture),
  (select npc_id from pg_temp.lira_identity),
  (select active_version_id from pg_temp.lira_identity),1
);
create temporary table pg_temp.lira_quest as
select id as quest_id,save_id,instance_id,package_id,package_hash,version_id
from private.world_quests
where save_id=(select save_id from pg_temp.save_fixture)
  and instance_id=(select instance_id from pg_temp.lira_resident)
  and origin='authored_milestone' and authored_milestone_index=0;
create temporary table pg_temp.lira_prepare as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.lira_quest),1,null);
create temporary table pg_temp.lira_success as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.lira_quest),2,0);
select is((select outcome from pg_temp.lira_success),'succeeded','Lira completes the authored initial quest through the lifecycle resolver');
select ok(exists(select 1 from private.world_quest_trinket_grant_receipts receipt
  where receipt.source_event_id=(select id from pg_temp.lira_success) and receipt.status='granted'),
  'the successful terminal event commits its authored trinket grant receipt');
select ok(exists(select 1 from private.world_owned_trinkets item
  where item.save_id=(select save_id from pg_temp.save_fixture)
    and item.source_event_id=(select id from pg_temp.lira_success)
    and item.catalog_id='harvest_quality' and item.active_slot=0),
  'Lira''s earned harvest-quality trinket is persisted and active');

-- Additional active revenue trinkets are inventory fixtures backed by real,
-- scope-valid quest/event rows so the hospitality RPC exercises persisted totals.
create temporary table pg_temp.food_source_quests(source_number integer,quest_id uuid);
with parent as (
  select * from pg_temp.lira_quest
), inserted as (
  insert into private.world_quests(
    save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,
    title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,
    state,current_step,preparation,scheduled_for_day,activated_day
  )
  select parent.save_id,parent.instance_id,parent.package_id,parent.package_hash,parent.version_id,
    'generated_successor',parent.quest_id,
    'Revenue effect source','Persist a trinket effect fixture.','Test-only event provenance.',
    '{}'::text[],'{}'::text[],0,
    '[{"action":"prepare","approach":"scouting"},{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb,
    '[{"action":"prepare","approach":"scouting"},{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb,
    'active',0,0,10,10
  from parent returning id
)
insert into pg_temp.food_source_quests(source_number,quest_id)
select fixture.source_number,inserted.id
from inserted cross join generate_series(1,3) as fixture(source_number);

create temporary table pg_temp.food_source_events(source_number integer,quest_id uuid,event_id uuid);
with inserted as (
  insert into private.world_quest_events(
    quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,
    preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome
  )
  select quest.id,quest.save_id,quest.instance_id,10+source.source_number,source.source_number-1,
    case when source.source_number=3 then 'attempt' else 'prepare' end,
    'scouting',1,0,
    case when source.source_number=3 then 2 else source.source_number-1 end,
    case when source.source_number=3 then 2 else source.source_number end,
    0,0,case when source.source_number=3 then 50 end,
    case when source.source_number=3 then 99 end,
    case when source.source_number=3 then 'setback' else 'prepared' end
  from pg_temp.food_source_quests source
  join private.world_quests quest on quest.id=source.quest_id
  returning quest_id,id,step_index
)
insert into pg_temp.food_source_events(source_number,quest_id,event_id)
select inserted.step_index+1,inserted.quest_id,inserted.id from inserted;
insert into private.world_owned_trinkets(
  save_id,source_instance_id,source_npc_id,source_version_id,source_quest_id,source_event_id,
  source_milestone_key,catalog_id,artwork_id,name,dedication,active_slot
)
select (select save_id from pg_temp.save_fixture),(select instance_id from pg_temp.lira_resident),
  (select npc_id from pg_temp.lira_identity),(select active_version_id from pg_temp.lira_identity),
  source.quest_id,source.event_id,'food-revenue-fixture-'||source.source_number,
  'food_revenue','brass-seal','Fixture Revenue Token '||source.source_number,
  'A persisted fixture trinket for the hospitality revenue test.',source.source_number::smallint
from pg_temp.food_source_events source;
select is((select count(*) from private.world_owned_trinkets item
  where item.save_id=(select save_id from pg_temp.save_fixture) and item.catalog_id='food_revenue'),
  3::bigint,'three active revenue trinkets are persisted in distinct slots');
select is((select jsonb_build_object('foodBasisPoints',totals.food_revenue_basis_points,
    'drinkBasisPoints',totals.drink_revenue_basis_points,'harvestQuality',totals.harvest_quality)
  from private.trinket_effect_totals((select save_id from pg_temp.save_fixture)) totals),
  '{"foodBasisPoints":1500,"drinkBasisPoints":0,"harvestQuality":1}'::jsonb,
  'authoritative effect totals sum active rows and include Lira''s earned harvest effect');

insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id)
select '76000000-0000-4000-8000-000000000101',save_id,'Fine garden supper','trinket-effect-fixture',5,1,
  '76000000-0000-4000-8000-000000000102'
from pg_temp.save_fixture;
create temporary table pg_temp.food_hospitality(result jsonb);
grant select on pg_temp.save_fixture,pg_temp.lira_resident,pg_temp.food_hospitality to authenticated;
grant insert on pg_temp.food_hospitality to authenticated;
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
insert into pg_temp.food_hospitality
select public.npc_serve_hospitality(
  (select save_id from pg_temp.save_fixture),(select instance_id from pg_temp.lira_resident),
  'food','76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000103',
  (select initial_revision from pg_temp.save_fixture)
);
select is((select result->>'baseGoldEarned' from pg_temp.food_hospitality),'25',
  'food quality five uses the existing 25-gold base curve');
select is((select result->>'trinketRevenueBonusBasisPoints' from pg_temp.food_hospitality),'1500',
  'hospitality snapshots all three active revenue effects');
select is((select result->>'goldEarned' from pg_temp.food_hospitality),'29',
  'three five-percent effects apply once and round 25 times 1.15 to 29');
select is(public.npc_serve_hospitality(
  (select save_id from pg_temp.save_fixture),(select instance_id from pg_temp.lira_resident),
  'food','76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000103',
  (select initial_revision from pg_temp.save_fixture)
), (select result from pg_temp.food_hospitality),
  'exact hospitality action replay returns the trinket-aware committed receipt');
reset role;
select is((select save.gold-fixture.initial_gold from public.tavern_saves save
  cross join pg_temp.save_fixture fixture where save.id=fixture.save_id),29::bigint,
  'the save balance commits the rounded food revenue exactly once');
select is((select result->>'rulesVersion' from pg_temp.food_hospitality),'world-hospitality-v2',
  'the authoritative hospitality receipt is versioned');

insert into public.garden_inventory(save_id,item_key,quantity)
select save_id,'seed_clover',3 from pg_temp.save_fixture
on conflict(save_id,item_key) do update set quantity=excluded.quantity;
create temporary table pg_temp.first_plant_target as
select id as cell_id from public.garden_cells
where save_id=(select save_id from pg_temp.save_fixture) and unlocked and kind='empty'
order by row,col limit 1;
grant select on pg_temp.first_plant_target to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
select lives_ok($$select public.garden_command(
  (select save_id from pg_temp.save_fixture),'76000000-0000-4000-8000-000000000104',
  (select initial_revision+1 from pg_temp.save_fixture),'plant',
  jsonb_build_object('cellId',(select cell_id from pg_temp.first_plant_target),'seedItemKey','seed_clover'))$$,
  'plant command creates the crop through the public garden path');
reset role;
set local request.jwt.claim.role='service_role';
update public.garden_plants set lifecycle='mature',care_good_days=3,care_total_days=4,
  stress_points=0,companion_points=0,pollination_points=0,ready_since_day=1
where save_id=(select save_id from pg_temp.save_fixture)
  and cell_id=(select cell_id from pg_temp.first_plant_target);
create temporary table pg_temp.first_harvest(result jsonb);
grant select on pg_temp.first_harvest to authenticated;
grant insert on pg_temp.first_harvest to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
insert into pg_temp.first_harvest
select public.harvest_crop((select save_id from pg_temp.save_fixture),
  (select cell_id from pg_temp.first_plant_target),'76000000-0000-4000-8000-000000000105',
  (select initial_revision+2 from pg_temp.save_fixture));
select is((select jsonb_build_object('base',result->'baseQualityIndex','bonus',result->'trinketQualityBonus','final',result->'qualityIndex')
  from pg_temp.first_harvest),'{"base":5,"bonus":1,"final":6}'::jsonb,
  'Lira''s earned trinket raises a real harvested batch from quality five to six');
select is((select batch.quality_index from public.ingredient_batches batch
  where batch.id=(select (result->>'ingredientBatchId')::uuid from pg_temp.first_harvest)),6::smallint,
  'the trinket-adjusted harvest quality is persisted on the ingredient batch');
select is(public.harvest_crop((select save_id from pg_temp.save_fixture),
  (select cell_id from pg_temp.first_plant_target),'76000000-0000-4000-8000-000000000105',
  (select initial_revision+2 from pg_temp.save_fixture)),(select result from pg_temp.first_harvest),
  'exact harvest replay returns its original effect-aware receipt');
select is((select result->>'trinketRulesVersion' from pg_temp.first_harvest),'trinket-effects-v1',
  'the persisted harvest receipt identifies its trinket rules version');
reset role;

-- Base quality six plus the active harvest bonus must remain within the game cap.
create temporary table pg_temp.second_plant_target as
select id as cell_id from public.garden_cells
where save_id=(select save_id from pg_temp.save_fixture) and unlocked and kind='empty'
order by row,col limit 1;
grant select on pg_temp.second_plant_target to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
select lives_ok($$select public.garden_command(
  (select save_id from pg_temp.save_fixture),'76000000-0000-4000-8000-000000000106',
  (select initial_revision+3 from pg_temp.save_fixture),'plant',
  jsonb_build_object('cellId',(select cell_id from pg_temp.second_plant_target),'seedItemKey','seed_clover'))$$,
  'a second crop can be planted for the quality-cap check');
reset role;
set local request.jwt.claim.role='service_role';
update public.garden_plants set lifecycle='mature',care_good_days=4,care_total_days=4,
  stress_points=0,companion_points=0,pollination_points=0,ready_since_day=1
where save_id=(select save_id from pg_temp.save_fixture)
  and cell_id=(select cell_id from pg_temp.second_plant_target);
create temporary table pg_temp.second_harvest(result jsonb);
grant select on pg_temp.second_harvest to authenticated;
grant insert on pg_temp.second_harvest to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
insert into pg_temp.second_harvest
select public.harvest_crop((select save_id from pg_temp.save_fixture),
  (select cell_id from pg_temp.second_plant_target),'76000000-0000-4000-8000-000000000107',
  (select initial_revision+4 from pg_temp.save_fixture));
select is((select jsonb_build_object('base',result->'baseQualityIndex','bonus',result->'trinketQualityBonus','final',result->'qualityIndex')
  from pg_temp.second_harvest),'{"base":6,"bonus":1,"final":6}'::jsonb,
  'harvest quality clamps at six when the trinket bonus exceeds the base cap');
select is((select batch.quality_index from public.ingredient_batches batch
  where batch.id=(select (result->>'ingredientBatchId')::uuid from pg_temp.second_harvest)),6::smallint,
  'the capped quality, rather than the uncapped sum, is persisted on the second batch');

-- Exercise the drink effect on its own: a stored drink trinket contributes
-- nothing, while the same trinket changes the payout through dialogue once
-- equipped. The beverage dialogue journey persists and replays its receipt.
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.drink_source_event as
with inserted as (
  insert into private.world_quest_events(
    quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,
    preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome
  )
  select quest.id,quest.save_id,quest.instance_id,99,0,'prepare','scouting',1,0,0,1,0,0,null,null,'prepared'
  from private.world_quests quest
  where quest.id=(select source.quest_id from pg_temp.food_source_quests source order by source.source_number limit 1)
  returning quest_id,id as event_id
)
select * from inserted;

insert into private.world_owned_trinkets(
  save_id,source_instance_id,source_npc_id,source_version_id,source_quest_id,source_event_id,
  source_milestone_key,catalog_id,artwork_id,name,dedication,active_slot
)
select (select save_id from pg_temp.save_fixture),(select instance_id from pg_temp.lira_resident),
  (select npc_id from pg_temp.lira_identity),(select active_version_id from pg_temp.lira_identity),
  source.quest_id,source.event_id,'drink-revenue-fixture','drink_revenue','brass-seal',
  'Fixture Drink Token','A persisted fixture trinket for the beverage revenue test.',null
from pg_temp.drink_source_event source;
create temporary table pg_temp.drink_trinket as
select id as trinket_id from private.world_owned_trinkets
where save_id=(select save_id from pg_temp.save_fixture) and source_milestone_key='drink-revenue-fixture';
grant select on pg_temp.drink_trinket to authenticated;

insert into public.brew_sessions(
  id,save_id,day_number,ingredient_batch_id,ingredient_quality_index,ingredient_brew_bonus,
  rules_version,status,duration_seconds,countdown_seconds,stir_rules_version,completed_at,
  perfect_ticks,good_ticks,total_ticks,stir_score,quality_index
)
select session.id,(select save_id from pg_temp.save_fixture),session.day_number,
  (select (result->>'ingredientBatchId')::uuid from pg_temp.second_harvest),5,2,
  'harvest-v1','completed',15,2,'guide-v2',clock_timestamp(),0,0,60,0,5
from (values
  ('76000000-0000-4000-8000-000000000201'::uuid,90),
  ('76000000-0000-4000-8000-000000000202'::uuid,91)
) as session(id,day_number);
insert into public.beverages(id,save_id,brew_session_id,ingredient_batch_id,rules_version,name,quality_index)
select beverage.id,(select save_id from pg_temp.save_fixture),beverage.brew_session_id,
  (select (result->>'ingredientBatchId')::uuid from pg_temp.second_harvest),
  'harvest-v1',beverage.name,5
from (values
  ('76000000-0000-4000-8000-000000000203'::uuid,'76000000-0000-4000-8000-000000000201'::uuid,'Stored-token mead'),
  ('76000000-0000-4000-8000-000000000204'::uuid,'76000000-0000-4000-8000-000000000202'::uuid,'Equipped-token mead')
) as beverage(id,brew_session_id,name);
create temporary table pg_temp.drink_beverages as
select id,brew_session_id,name from public.beverages
where id in ('76000000-0000-4000-8000-000000000203','76000000-0000-4000-8000-000000000204');
grant select on pg_temp.drink_beverages to authenticated;

select is((select drink_revenue_basis_points from private.trinket_effect_totals(
  (select save_id from pg_temp.save_fixture))),0,'an unequipped drink trinket contributes no drink revenue');
create temporary table pg_temp.stored_drink_hospitality(result jsonb);
grant select,insert on pg_temp.stored_drink_hospitality to authenticated;
create temporary table pg_temp.drink_swap(result jsonb);
grant select,insert on pg_temp.drink_swap to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
insert into pg_temp.stored_drink_hospitality
select public.npc_serve_hospitality(
  (select save_id from pg_temp.save_fixture),(select instance_id from pg_temp.lira_resident),
  'beverage','76000000-0000-4000-8000-000000000203','76000000-0000-4000-8000-000000000205',
  (select revision from public.tavern_saves where id=(select save_id from pg_temp.save_fixture)));
select is((select result->>'trinketRevenueBonusBasisPoints' from pg_temp.stored_drink_hospitality),'0',
  'direct beverage hospitality snapshots zero bonus while the drink trinket is unequipped');
select is((select result->>'goldEarned' from pg_temp.stored_drink_hospitality),'25',
  'an unequipped drink trinket leaves the quality-five beverage payout at 25 gold');
insert into pg_temp.drink_swap
select public.npc_swap_trinket(
  (select save_id from pg_temp.save_fixture),(select trinket_id from pg_temp.drink_trinket),
  1::smallint,'76000000-0000-4000-8000-000000000206',
  (select revision from public.tavern_saves where id=(select save_id from pg_temp.save_fixture)));
select is((select result->>'status' from pg_temp.drink_swap),'swapped',
  'the drink trinket is equipped through the revision-fenced public collection RPC');
reset role;
set local request.jwt.claim.role='service_role';
select is((select drink_revenue_basis_points from private.trinket_effect_totals(
  (select save_id from pg_temp.save_fixture))),500,'the equipped drink trinket contributes its authored five-percent effect');

create temporary table pg_temp.drink_dialogue_begin as
select public.npc_dialogue_begin(
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000207',
  (select npc_id from pg_temp.lira_identity),'A toast to honest trade.',0,null,'beverage',
  '76000000-0000-4000-8000-000000000204') as value;
select is((select value->>'status' from pg_temp.drink_dialogue_begin),'processing',
  'the beverage journey begins through the server-orchestrated dialogue RPC');
select public.npc_dialogue_checkpoint(
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000207',
  (select (value->>'fence')::uuid from pg_temp.drink_dialogue_begin),'decision',
  '{"value":{"stance":"respond","reaction":0,"subject":"hospitality","evidence":"","intention":null},"validated":true}'::jsonb);
select public.npc_dialogue_checkpoint(
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000207',
  (select (value->>'fence')::uuid from pg_temp.drink_dialogue_begin),'speak',
  '{"value":{"text":"A fair measure indeed; thank you for the mead."}}'::jsonb);
create temporary table pg_temp.drink_dialogue_result as
select public.npc_dialogue_complete(
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000207',
  (select (value->>'fence')::uuid from pg_temp.drink_dialogue_begin)) as result;
select is((select jsonb_build_object('bonus',result#>>'{serving,trinketRevenueBonusBasisPoints}',
    'gold',result#>>'{serving,goldEarned}','kind',result#>>'{serving,itemKind}')
  from pg_temp.drink_dialogue_result),'{"bonus":"500","gold":"26","kind":"beverage"}'::jsonb,
  'dialogue completion applies the equipped drink effect and commits the 26-gold beverage payout');
select is((select event.gold_earned from private.world_npc_hospitality_events event
  where event.save_id=(select save_id from pg_temp.save_fixture)
    and event.action_id='76000000-0000-4000-8000-000000000207'),26,
  'dialogue beverage payout is persisted in the hospitality event ledger');
select is(public.npc_dialogue_complete(
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000207',
  (select (value->>'fence')::uuid from pg_temp.drink_dialogue_begin)),
  (select result from pg_temp.drink_dialogue_result),
  'an exact dialogue retry returns the original beverage hospitality result');
select is((select turn.status from private.world_npc_dialogue_turns turn
  where turn.id='76000000-0000-4000-8000-000000000207'),'completed',
  'the beverage turn is durably marked complete');
select is((select save.gold-fixture.initial_gold from public.tavern_saves save
  cross join pg_temp.save_fixture fixture where save.id=fixture.save_id),80::bigint,
  'food, unequipped drink, and equipped dialogue drink payouts persist exactly once');
reset role;

select * from finish();
rollback;
