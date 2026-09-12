begin;

create extension if not exists pgtap with schema extensions;
select plan(53);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values('16500000-0000-4000-8000-000000000001','garden-commands@example.test',
  'authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16500000-0000-4000-8000-000000000001';

select lives_ok($$ select public.create_tavern() $$,'command garden provisions');
select is((public.preview_garden_command('water',jsonb_build_object(
  'cellIds',jsonb_build_array((select id from public.garden_cells where layout_key='c3')),'dose',10))->>'basedOnRevision')::integer,
  0,'care preview records its revision boundary');
select is((select revision from public.tavern_saves),0::bigint,'preview is read-only');

create temporary table command_receipts(label text,receipt jsonb);
insert into command_receipts select 'plant',public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000010',0,'plant',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),'seedItemKey','seed_hops'));
select is((select revision from public.tavern_saves),1::bigint,'plant increments the save revision once');
select is((select quantity from public.garden_inventory where item_key='seed_hops'),1,'plant consumes one named seed');
select is((select kind from public.garden_cells where layout_key='c3'),'plant','plant marks the target occupied');
select is((select species_key from public.garden_plants p join public.garden_cells c on c.id=p.cell_id
  where c.layout_key='c3'),'hops','plant species is derived from the server seed catalog');

insert into command_receipts select 'plant-replay',public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000010',0,'plant',
  jsonb_build_object('seedItemKey','seed_hops','cellId',(select id from public.garden_cells where layout_key='c3')));
select is((select receipt from command_receipts where label='plant'),
  (select receipt from command_receipts where label='plant-replay'),'plant retry returns the exact receipt');
select is((select revision from public.tavern_saves),1::bigint,'plant retry changes no state');
select throws_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000010',0,'remove',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'))) $$,
  'PT409','Action identifier was already used for a different request','action identifiers cannot change meaning');
select throws_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000011',0,'water',
  jsonb_build_object('cellIds',jsonb_build_array((select id from public.garden_cells where layout_key='c3')),'dose',10)) $$,
  'PT409','Garden state changed; refresh before acting','stale care is rejected');

reset role;
update public.garden_cells set soil_n=11 where layout_key='c3';
update public.garden_cells set soil_n=88 where layout_key='c5';
create temporary table moved_identity as select p.id from public.garden_plants p
join public.garden_cells c on c.id=p.cell_id where c.layout_key='c3';
grant select on moved_identity to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16500000-0000-4000-8000-000000000001';
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000012',1,'move',
  jsonb_build_object('sourceCellId',(select id from public.garden_cells where layout_key='c3'),
    'targetCellId',(select id from public.garden_cells where layout_key='c5'))) $$,
  'plant moves to empty soil');
select is((select cell_id from public.garden_plants where id=(select id from moved_identity)),
  (select id from public.garden_cells where layout_key='c5'),'the same plant identity moves');
select is((select soil_n from public.garden_cells where layout_key='c3'),11::smallint,'source soil stays on its hex');
select is((select soil_n from public.garden_cells where layout_key='c5'),88::smallint,'target soil stays on its hex');

select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000013',2,'move',
  jsonb_build_object('sourceCellId',(select id from public.garden_cells where layout_key='c5'),
    'targetCellId',(select id from public.garden_cells where layout_key='c2'))) $$,
  'plant and hive swap atomically');
select is((select kind from public.garden_cells where layout_key='c2'),'plant','swap moves the plant to hive soil');
select is((select kind from public.garden_cells where layout_key='c5'),'beehive','swap moves the intact hive to plant soil');

select is((public.preview_garden_command('water',jsonb_build_object('cellIds',jsonb_build_array(
  (select id from public.garden_cells where layout_key='c3'),
  (select id from public.garden_cells where layout_key='c2')),'dose',10))->>'targetCount')::integer,
  2,'batch preview covers every target');
insert into command_receipts select 'water',public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000014',3,'water',
  jsonb_build_object('cellIds',jsonb_build_array(
    (select id from public.garden_cells where layout_key='c3'),
    (select id from public.garden_cells where layout_key='c2')),'dose',10));
select is((select soil_moisture from public.garden_cells where layout_key='c2'),65::smallint,'water applies the dose to a planted target');
select is((select soil_moisture from public.garden_cells where layout_key='c3'),65::smallint,'water explicitly supports unlocked empty soil');
insert into command_receipts select 'water-replay',public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000014',3,'water',
  jsonb_build_object('dose',10,'cellIds',jsonb_build_array(
    (select id from public.garden_cells where layout_key='c2'),
    (select id from public.garden_cells where layout_key='c3'))));
select is((select receipt from command_receipts where label='water'),
  (select receipt from command_receipts where label='water-replay'),
  'reordered batch targets canonicalize to the exact saved receipt');
select is((select revision from public.tavern_saves),4::bigint,'batch replay does not increment revision');

reset role;
update public.tavern_saves set gold=100 where user_id='16500000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16500000-0000-4000-8000-000000000001';
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000015',4,'purchase',
  '{"itemKey":"amendment_n","quantity":2}'::jsonb) $$,'purchase uses the versioned shop');
select is((select gold from public.tavern_saves),90::bigint,'purchase debits the server price');
select is((select quantity from public.garden_inventory where item_key='amendment_n'),2,'purchase adds exact inventory');
select is((public.preview_garden_command('amend',jsonb_build_object('cellIds',jsonb_build_array(
  (select id from public.garden_cells where layout_key='c2'),
  (select id from public.garden_cells where layout_key='c3')),'itemKey','amendment_n','dose',1))->>'resourceCost')::integer,
  2,'amendment preview totals the same dose across every target');
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000016',5,'amend',
  jsonb_build_object('cellIds',jsonb_build_array(
    (select id from public.garden_cells where layout_key='c2'),
    (select id from public.garden_cells where layout_key='c3')),'itemKey','amendment_n','dose',1)) $$,
  'atomic batch amendment commits');
select is((select quantity from public.garden_inventory where item_key='amendment_n'),0,'batch consumes its total resource cost');
select results_eq($$ select layout_key,soil_n from public.garden_cells where layout_key in ('c2','c3') order by layout_key $$,
  $$ values ('c2'::text,78::smallint),('c3'::text,29::smallint) $$,
  'the same amendment dose reaches each target');
select throws_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000017',6,'amend',
  jsonb_build_object('cellIds',jsonb_build_array(
    (select id from public.garden_cells where layout_key='c2'),
    (select id from public.garden_cells where layout_key='c3')),'itemKey','amendment_n','dose',1)) $$,
  'PT422','Not enough amendment for every selected cell','insufficient batch supply rejects every target');
select results_eq($$ select layout_key,soil_n from public.garden_cells where layout_key in ('c2','c3') order by layout_key $$,
  $$ values ('c2'::text,78::smallint),('c3'::text,29::smallint) $$,
  'failed batch amendment leaves every target unchanged');
select is((select revision from public.tavern_saves),6::bigint,'failed batch amendment leaves revision unchanged');

select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000018',6,'remove',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c6'),'compost',true)) $$,
  'established plant removal can become delayed compost');
select is((select kind from public.garden_cells where layout_key='c6'),'empty','removal frees the soil');
select is((select count(*) from public.garden_compost_jobs where source_kind='plant'),1::bigint,'eligible biomass creates one compost job');

select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000019',7,'plant',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),'seedItemKey','seed_clover')) $$,
  'a clover seedling can be planted');
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000020',8,'remove',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),'compost',true)) $$,
  'a new seedling can be discarded');
select is((select result#>>'{result,composted}' from public.garden_actions
  where action_id='16500000-0000-4000-8000-000000000020'), 'false','new seedlings yield no compost');
select is((select count(*) from public.garden_compost_jobs),1::bigint,'seedling recycling creates no profitable job');

select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000021',9,'plant',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),'seedItemKey','seed_clover')) $$,
  'a second clover is planted for green manure');
reset role;
update public.garden_plants set age_days=3,growth_progress=55,lifecycle='flowering'
where cell_id=(select id from public.garden_cells where layout_key='c3');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16500000-0000-4000-8000-000000000001';
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000022',10,'incorporate_clover',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'))) $$,
  'established clover becomes delayed local green manure');
select is((select count(*) from public.garden_compost_jobs where source_kind='green_manure'),1::bigint,'green manure is persisted as a delayed release');
select is((select soil_n from public.garden_cells where layout_key='c3'),29::smallint,'incorporation has no instant nutrient effect');

reset role;
update public.tavern_saves set gold=500 where user_id='16500000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16500000-0000-4000-8000-000000000001';
insert into command_receipts select 'expand16',public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000023',11,'expand','{"plotCount":16}'::jsonb);
select is((select count(*) from public.garden_cells where unlocked),16::bigint,'first expansion unlocks sixteen stable cells');
select is((select gold from public.tavern_saves),440::bigint,'first expansion costs sixty gold');
insert into command_receipts select 'expand16-replay',public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000023',11,'expand','{"plotCount":16}'::jsonb);
select is((select receipt from command_receipts where label='expand16'),
  (select receipt from command_receipts where label='expand16-replay'),'expansion retry returns its exact receipt');
select is((select gold from public.tavern_saves),440::bigint,'expansion retry charges no gold');
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000024',12,'expand','{"plotCount":24}'::jsonb) $$,
  'second expansion follows the fixed progression');
select is((select count(*) from public.garden_cells where unlocked),24::bigint,'second expansion unlocks all twenty-four cells');
select is((select gold from public.tavern_saves),260::bigint,'second expansion costs one hundred eighty gold');

select throws_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16500000-0000-4000-8000-000000000025',13,'water',
  jsonb_build_object('cellIds',jsonb_build_array((select id from public.garden_cells limit 1)),
    'dose',5,'unexpected',true)) $$,
  'PT400','Garden payload fields do not match the command','unknown payload fields are rejected');
select is((select count(*) from public.garden_actions),13::bigint,'only successful commands have action receipts');

select * from finish();
rollback;
