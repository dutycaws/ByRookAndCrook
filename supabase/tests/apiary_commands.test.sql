begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values
  ('16700000-0000-4000-8000-000000000001','apiary-owner@example.test','authenticated','authenticated',now(),now()),
  ('16700000-0000-4000-8000-000000000002','apiary-stranger@example.test','authenticated','authenticated',now(),now());

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'apiary owner provisions');

reset role;
insert into public.garden_inventory(save_id,item_key,quantity) values
  ((select id from public.tavern_saves where user_id='16700000-0000-4000-8000-000000000001'),'hive_equipment',2),
  ((select id from public.tavern_saves where user_id='16700000-0000-4000-8000-000000000001'),'replacement_colony',1),
  ((select id from public.tavern_saves where user_id='16700000-0000-4000-8000-000000000001'),'bee_feed',2),
  ((select id from public.tavern_saves where user_id='16700000-0000-4000-8000-000000000001'),'treatment_varroa',1);
create temporary table apiary_receipts(label text,receipt jsonb);
grant select,insert on apiary_receipts to authenticated;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select is((public.preview_apiary_command('install_hive',jsonb_build_object(
  'cellId',(select id from public.garden_cells where layout_key='c3')))->>'basedOnRevision')::integer,
  0,'apiary preview records its revision boundary');
select is((select revision from public.tavern_saves),0::bigint,'apiary preview is read-only');

insert into apiary_receipts select 'hive-c3',public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000010',0,'install_hive',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3')));
select is((select kind from public.garden_cells where layout_key='c3'),'beehive','installing equipment occupies empty soil');
select is((select count(*) from public.apiary_hives),2::bigint,'installed equipment creates a second hive');
select is((select quantity from public.garden_inventory where item_key='hive_equipment'),1,'installing a hive consumes one equipment item');
select is((select count(*) from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3'),0::bigint,'new equipment begins without a colony');
insert into apiary_receipts select 'hive-c3-replay',public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000010',0,'install_hive',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3')));
select is((select receipt from apiary_receipts where label='hive-c3'),
  (select receipt from apiary_receipts where label='hive-c3-replay'),'identical hive retries return the exact receipt');
select is((select revision from public.tavern_saves),1::bigint,'hive replay changes no state');
select throws_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000010',0,'install_colony',
  jsonb_build_object('hiveId',(select id from public.apiary_hives order by installed_day,id limit 1))) $$,
  'PT409','Action identifier was already used for a different request','an apiary action identifier cannot change meaning');

insert into apiary_receipts select 'colony-c3',public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000011',1,'install_colony',
  jsonb_build_object('hiveId',(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3')));
select is((select count(*) from public.apiary_colonies),2::bigint,'replacement adds one colony to retained equipment');
select is((select floral_honey from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3'),0,'a purchased replacement colony contains no extractable honey');
select is((select quantity from public.garden_inventory where item_key='replacement_colony'),0,'replacement colony inventory is consumed');

select is((public.preview_apiary_command('feed',jsonb_build_object(
  'colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),'quantity',2))->>'canCommit')::boolean,
  true,'feeding preview validates current supply');
select lives_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000012',2,'feed',
  jsonb_build_object('colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),'quantity',2)) $$,
  'feeding commits through the authoritative command');
select is((select food_stores from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),60,'feed increases survival stores');
select is((select feed_stores from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),36,'feed origin remains separately accounted');
select is((select floral_honey from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),4,'feed never becomes floral honey');
select is((select quantity from public.garden_inventory where item_key='bee_feed'),0,'feeding consumes the selected quantity');

select is(public.preview_apiary_command('treat',jsonb_build_object(
  'colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),
  'treatmentItemKey','treatment_varroa'))->>'problem','varroa','treatment preview identifies the condition-specific effect');
select lives_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000013',3,'treat',
  jsonb_build_object('colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),'treatmentItemKey','treatment_varroa')) $$,
  'condition-specific treatment commits');
select is((select treatment_key from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),'varroa','the selected treatment targets only Varroa');
select is((select treatment_days_remaining from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),3::smallint,'treatment establishes three days of downtime');
select is((select quantity from public.garden_inventory where item_key='treatment_varroa'),0,'treatment consumes one supply');
select throws_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000014',4,'extract_honey',
  jsonb_build_object('colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2'),'quantity',1)) $$,
  'PT409','Honey cannot be extracted during treatment','treatment downtime blocks honey extraction');
select is((select revision from public.tavern_saves),4::bigint,'rejected extraction changes no revision');

select lives_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000015',4,'install_hive',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c5'))) $$,
  'a second empty hive can be installed');
select is((select count(*) from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c5'),
  1::bigint,'split target equipment persists without a colony');

reset role;
create temporary table split_baseline as
select ac.id,ac.save_id,12000::integer adults,2400::integer brood,50::integer food_stores,12::integer floral_honey,
  10::integer feed_stores,44::smallint varroa,31::smallint chalkbrood,36::smallint nosema
from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
join public.garden_cells c on c.id=h.cell_id where c.layout_key='c2';
grant select on split_baseline to authenticated;
update public.apiary_colonies ac set adults=b.adults,brood=b.brood,food_stores=b.food_stores,
  floral_honey=b.floral_honey,feed_stores=b.feed_stores,varroa_pressure=b.varroa,
  chalkbrood_pressure=b.chalkbrood,nosema_pressure=b.nosema
from split_baseline b where ac.id=b.id;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select is((public.preview_apiary_command('split',jsonb_build_object(
  'sourceColonyId',(select id from split_baseline),
  'targetHiveId',(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c5')))->>'canCommit')::boolean,
  true,'strong-colony split preview exposes satisfied requirements');
insert into apiary_receipts select 'split',public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000016',5,'split',
  jsonb_build_object('sourceColonyId',(select id from split_baseline),
    'targetHiveId',(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c5')));
select is((select count(*) from public.apiary_colonies),3::bigint,'split creates exactly one additional colony');
select is((select sum(adults) from public.apiary_colonies where id in ((select id from split_baseline),
  (select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split'))),
  (select adults::bigint from split_baseline),'split conserves adult population');
select is((select sum(brood) from public.apiary_colonies where id in ((select id from split_baseline),
  (select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split'))),
  (select brood::bigint from split_baseline),'split conserves brood');
select is((select sum(food_stores) from public.apiary_colonies where id in ((select id from split_baseline),
  (select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split'))),
  (select food_stores::bigint from split_baseline),'split conserves food stores');
select is((select sum(floral_honey) from public.apiary_colonies where id in ((select id from split_baseline),
  (select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split'))),
  (select floral_honey::bigint from split_baseline),'split conserves floral honey');
select is((select sum(feed_stores) from public.apiary_colonies where id in ((select id from split_baseline),
  (select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split'))),
  (select feed_stores::bigint from split_baseline),'split conserves feed-origin stores');
select is((select jsonb_build_object('varroa',varroa_pressure,'chalkbrood',chalkbrood_pressure,'nosema',nosema_pressure)
  from public.apiary_colonies where id=(select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split')),
  jsonb_build_object('varroa',44,'chalkbrood',31,'nosema',36),'split carries every distinct health pressure');
select is((select jsonb_build_object('key',treatment_key,'days',treatment_days_remaining)
  from public.apiary_colonies where id=(select (receipt#>>'{result,newColonyId}')::uuid from apiary_receipts where label='split')),
  jsonb_build_object('key','varroa','days',3),'split carries active treatment state instead of cleansing the colony');

reset role;
update public.apiary_colonies set floral_honey=14,health=90,varroa_pressure=5,
  chalkbrood_pressure=2,nosema_pressure=2,treatment_key=null,treatment_days_remaining=0,treatment_tradeoff=null
where hive_id=(select h.id from public.apiary_hives h join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select is((public.preview_apiary_command('extract_honey',jsonb_build_object(
  'colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3'),'quantity',5))->>'extractableSurplus')::integer,
  10,'honey preview exposes only safe floral surplus');
select throws_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000017',6,'extract_honey',
  jsonb_build_object('colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3'),'quantity',11)) $$,
  'PT422','Only safe floral-honey surplus can be extracted','essential honey reserve cannot be extracted');
select is((select revision from public.tavern_saves),6::bigint,'unsafe extraction changes no revision');
insert into apiary_receipts select 'honey',public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000018',6,'extract_honey',
  jsonb_build_object('colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3'),'quantity',5));
select is((select floral_honey from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
  join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3'),9,'extraction removes only the selected floral honey');
select is((select jsonb_build_object('kind',source_kind,'plant',plant_key,'quantity',quantity,
  'apiaryAction',source_apiary_action_id,'cropAction',source_action_id,'provenanceKind',provenance->>'kind')
  from public.ingredient_batches where id=(select (receipt#>>'{result,ingredientBatchId}')::uuid from apiary_receipts where label='honey')),
  jsonb_build_object('kind','honey','plant','honey','quantity',5,'apiaryAction','16700000-0000-4000-8000-000000000018'::uuid,
    'cropAction',null,'provenanceKind','honey'),'honey batch records immutable apiary provenance');
select is(((public.get_tavern_snapshot()->'ingredients'->0)->>'sourceKind'),'honey','snapshot exposes honey as a normal available ingredient');
insert into apiary_receipts select 'honey-replay',public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000018',6,'extract_honey',
  jsonb_build_object('quantity',5,'colonyId',(select ac.id from public.apiary_colonies ac join public.apiary_hives h on h.id=ac.hive_id
    join public.garden_cells c on c.id=h.cell_id where c.layout_key='c3')));
select is((select receipt from apiary_receipts where label='honey'),
  (select receipt from apiary_receipts where label='honey-replay'),'honey extraction retry returns its exact receipt');
select is((select count(*) from public.ingredient_batches where source_kind='honey'),1::bigint,'honey replay creates no duplicate batch');
select is((select revision from public.tavern_saves),7::bigint,'honey replay increments no revision');
select throws_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000019',7,'feed',
  jsonb_build_object('colonyId',(select id from split_baseline),'quantity',1,'surprise','honey')) $$,
  'PT400','Apiary payload fields do not match the command','unknown payload fields are rejected');
select throws_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16700000-0000-4000-8000-000000000021',7,'feed',
  jsonb_build_object('colonyId',(select id from split_baseline),'quantity',1.5)) $$,
  'PT400','Apiary quantity must be a whole number','fractional quantities are rejected before canonicalization');
select is((select revision from public.tavern_saves),7::bigint,'invalid payload changes no state');
select throws_ok($$ update public.apiary_colonies set floral_honey=100 $$,
  '42501',null,'players cannot directly alter colony resources');
select ok(not has_function_privilege('anon','public.apiary_command(uuid,uuid,bigint,text,jsonb)','EXECUTE'),
  'anonymous clients cannot execute apiary commands');
select ok(not has_function_privilege('anon','public.preview_apiary_command(text,jsonb)','EXECUTE'),
  'anonymous clients cannot preview private apiary state');

set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000002';
select lives_ok($$ select public.create_tavern() $$,'stranger provisions independently');
select throws_ok($$ select public.apiary_command(
  (select save_id from split_baseline),
  '16700000-0000-4000-8000-000000000020',7,'feed',jsonb_build_object(
    'colonyId',(select id from split_baseline),'quantity',1)) $$,
  'PT404','Tavern not found','another player cannot mutate the owner apiary');

select * from finish();
rollback;
