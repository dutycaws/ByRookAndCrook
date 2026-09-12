begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values('16800000-0000-4000-8000-000000000001','apiary-day@example.test',
  'authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16800000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'apiary scenario provisions');

reset role;
update public.garden_plants set lifecycle='growing',growth_progress=10,flowering_days_remaining=0;
update public.garden_plants set lifecycle='flowering',growth_progress=75,flowering_days_remaining=3
where cell_id=(select id from public.garden_cells where layout_key='c1');
create temporary table single_colony_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;
select ok((select coalesce(sum((colony->>'allocatedForage')::integer),0)>0
  from single_colony_plan,lateral jsonb_array_elements(plan->'colonies') colony),
  'a flowering crop supplies finite forage to the starter colony');

set constraints all deferred;
insert into public.apiary_hives(save_id,cell_id,installed_day)
select (select id from public.tavern_saves),id,1 from public.garden_cells where layout_key='c3';
select private.sync_garden_cells((select id from public.tavern_saves),
  array[(select id from public.garden_cells where layout_key='c3')]);
insert into public.apiary_colonies(save_id,hive_id,established_day)
select (select id from public.tavern_saves),h.id,1 from public.apiary_hives h
join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3';
create temporary table two_colony_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;
select ok((select coalesce(sum((colony->>'allocatedForage')::integer),0)
    from two_colony_plan,lateral jsonb_array_elements(plan->'colonies') colony)
  <= (select coalesce(sum((colony->>'allocatedForage')::integer),0)
    from single_colony_plan,lateral jsonb_array_elements(plan->'colonies') colony),
  'adding a colony does not duplicate fixed floral forage');
select is((select count(*) from two_colony_plan,lateral jsonb_array_elements(plan->'colonies')),
  2::bigint,'shared forage resolution includes both colonies');
select ok((select bool_and((colony->>'allocatedForage')::integer>=0)
  from two_colony_plan,lateral jsonb_array_elements(plan->'colonies') colony),
  'deterministic allocation never creates negative forage');
select is((select plan->>'planFingerprint' from two_colony_plan),
  private.resolve_garden_day((select id from public.tavern_saves),1)->>'planFingerprint',
  'repeated apiary projection keeps the same plan fingerprint');

update public.garden_plants set lifecycle='growing',growth_progress=10,flowering_days_remaining=0;
update public.garden_weather set weather_key='rainy' where day_number=1;
update public.apiary_colonies ac set brood=2000,varroa_pressure=10,chalkbrood_pressure=10,
  nosema_pressure=10,treatment_key=null,treatment_days_remaining=0
from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
where ac.hive_id=h.id and c.layout_key='c2';
update public.apiary_colonies ac set nosema_pressure=40
from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
where ac.hive_id=h.id and c.layout_key='c3';
create temporary table disease_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;
select is((select (colony->>'varroa')::integer from disease_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  12,'Varroa follows local brood-linked parasite pressure');
select is((select (colony->>'chalkbrood')::integer from disease_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  14,'Chalkbrood follows the persisted rainy-day dampness route');
select is((select (colony->>'nosema')::integer from disease_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  13,'Nosema follows the overlapping-forage colony route');
select isnt((select (colony->>'varroa')::integer from disease_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  (select (colony->>'chalkbrood')::integer from disease_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  'distinct conditions do not collapse into one generic disease meter');

set constraints all deferred;
update public.garden_cells set unlocked=true where layout_key='c23';
insert into public.apiary_hives(save_id,cell_id,installed_day)
select (select id from public.tavern_saves),id,1 from public.garden_cells where layout_key='c23';
select private.sync_garden_cells((select id from public.tavern_saves),
  array[(select id from public.garden_cells where layout_key='c23')]);
insert into public.apiary_colonies(save_id,hive_id,nosema_pressure,established_day)
select (select id from public.tavern_saves),h.id,40,1 from public.apiary_hives h
join public.garden_cells c on c.id=h.cell_id where c.layout_key='c23';
update public.apiary_colonies ac set nosema_pressure=5
from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
where ac.hive_id=h.id and c.layout_key='c3';
create temporary table distant_disease_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;
select ok((select private.hex_distance(target.col,target.row,source.col,source.row)>4
  from public.garden_cells target,public.garden_cells source
  where target.layout_key='c2' and source.layout_key='c23'),
  'the negative Nosema fixture places the infected source outside the overlapping forage neighborhood');
select is((select (colony->>'nosema')::integer from distant_disease_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  9,'a distant high-pressure colony cannot transmit Nosema through an unrelated local hive');

update public.apiary_colonies ac set treatment_key='varroa',treatment_days_remaining=3,
  treatment_tradeoff='no-honey-production-or-extraction',floral_honey=10
from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
where ac.hive_id=h.id and c.layout_key='c2';
update public.garden_plants set lifecycle='flowering',growth_progress=75,flowering_days_remaining=3
where cell_id=(select id from public.garden_cells where layout_key='c1');
create temporary table treatment_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;
select is((select (colony->>'varroa')::integer from treatment_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  3,'Varroa treatment reduces its named pressure');
select is((select (colony->>'chalkbrood')::integer from treatment_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  14,'Varroa treatment does not also cure Chalkbrood');
select is((select (colony->>'nosema')::integer from treatment_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  9,'Varroa treatment does not alter Nosema beyond its independent daily recovery');
select is((select (colony->>'treatmentDays')::integer from treatment_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  2,'treatment downtime advances once at the day boundary');
select is((select (colony->>'floralHoney')::integer from treatment_plan,
  lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  10,'active treatment suppresses floral-honey production');

update public.garden_plants set lifecycle='growing',growth_progress=10,flowering_days_remaining=0;
update public.apiary_colonies ac set food_stores=40,feed_stores=36,floral_honey=4,
  treatment_key=null,treatment_days_remaining=0
from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
where ac.hive_id=h.id and c.layout_key='c2';
select is((select (colony->>'floralHoney')::integer
  from jsonb_array_elements(private.resolve_garden_day((select id from public.tavern_saves),1)->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  4,'feed-supported survival without flowers produces no extractable honey');

update public.apiary_colonies ac set health=1,food_stores=0,varroa_pressure=70,
  chalkbrood_pressure=70,nosema_pressure=70,threat_days=2,treatment_key=null,treatment_days_remaining=0
from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
where ac.hive_id=h.id and c.layout_key='c2';
create temporary table loss_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;
select is((select (colony->>'lost')::boolean from loss_plan,lateral jsonb_array_elements(plan->'colonies') colony
  where (colony->>'hiveId')::uuid=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2')),
  true,'sustained severe untreated decline reaches permanent colony loss');
select ok(exists(select 1 from loss_plan,lateral jsonb_array_elements(plan#>'{report,events}') event
  where event->>'kind'='colony-warning' and event->>'layoutKey'='c2'),
  'the terminal colony state still emits a visible warning report');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16800000-0000-4000-8000-000000000001';
select lives_ok($$ select public.advance_tavern_day(
  (select id from public.tavern_saves),'16800000-0000-4000-8000-000000000010',0) $$,
  'permanent colony loss commits through the day boundary');
reset role;
select is((select count(*) from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),0::bigint,'lost colony is removed permanently');
select is((select count(*) from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id
  where c.layout_key='c2'),1::bigint,'colony loss leaves hive equipment available for replacement');

select * from finish();
rollback;
