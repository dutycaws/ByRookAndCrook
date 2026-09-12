begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users(id,email,role,aud,created_at,updated_at) values
  ('16600000-0000-4000-8000-000000000001','compost-brew@example.test','authenticated','authenticated',now(),now()),
  ('16600000-0000-4000-8000-000000000002','compost-available@example.test','authenticated','authenticated',now(),now()),
  ('16600000-0000-4000-8000-000000000003','compost-bake@example.test','authenticated','authenticated',now(),now());

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16600000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'brew reservation garden provisions');
select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),(select id from public.garden_cells where layout_key='c0'),
  '16600000-0000-4000-8000-000000000010',0) $$,'brew reservation ingredient harvests');
select lives_ok($$ select public.start_brew(
  (select id from public.tavern_saves),(select id from public.ingredient_batches),
  '16600000-0000-4000-8000-000000000011',1) $$,'ingredient enters an active brew');
select throws_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16600000-0000-4000-8000-000000000012',2,'compost_ingredient',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),
    'ingredientBatchId',(select id from public.ingredient_batches),'quantity',1)) $$,
  'PT409','That ingredient is reserved for the active craft','active brew ingredient cannot be composted');
select is((select composted_quantity from public.ingredient_batches),0,'failed brew conflict allocates no compost');
select is((select revision from public.tavern_saves),2::bigint,'failed brew conflict changes no revision');

set local request.jwt.claim.sub='16600000-0000-4000-8000-000000000002';
select lives_ok($$ select public.create_tavern() $$,'available compost garden provisions');
select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),(select id from public.garden_cells where layout_key='c0'),
  '16600000-0000-4000-8000-000000000020',0) $$,'available ingredient harvests');
select lives_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16600000-0000-4000-8000-000000000021',1,'compost_ingredient',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),
    'ingredientBatchId',(select id from public.ingredient_batches),'quantity',1)) $$,
  'unreserved ingredient becomes delayed compost');
select is((select composted_quantity from public.ingredient_batches),1,'compost has separate allocation accounting');
select is((select consumed_quantity from public.ingredient_batches),0,'compost does not impersonate craft consumption');
select is(jsonb_array_length(public.get_tavern_snapshot()->'ingredients'),0,
  'fully composted ingredients disappear from available crafting stock');
select throws_ok($$ select public.start_brew(
  (select id from public.tavern_saves),(select id from public.ingredient_batches),
  '16600000-0000-4000-8000-000000000022',2) $$,
  'PT404','Tavern or ingredient not found','craft start rejects fully composted stock');
select is((select count(*) from public.brew_sessions),0::bigint,'rejected composted stock creates no brew session');

set local request.jwt.claim.sub='16600000-0000-4000-8000-000000000003';
select lives_ok($$ select public.create_tavern() $$,'bake reservation garden provisions');
select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),(select id from public.garden_cells where layout_key='c0'),
  '16600000-0000-4000-8000-000000000030',0) $$,'bake reservation ingredient harvests');
select lives_ok($$ select public.start_bake(
  (select id from public.tavern_saves),(select id from public.ingredient_batches),
  '16600000-0000-4000-8000-000000000031',1) $$,'ingredient enters an active bake');
select throws_ok($$ select public.garden_command(
  (select id from public.tavern_saves),'16600000-0000-4000-8000-000000000032',2,'compost_ingredient',
  jsonb_build_object('cellId',(select id from public.garden_cells where layout_key='c3'),
    'ingredientBatchId',(select id from public.ingredient_batches),'quantity',1)) $$,
  'PT409','That ingredient is reserved for the active craft','active bake ingredient cannot be composted');
select is((select composted_quantity from public.ingredient_batches),0,'failed bake conflict allocates no compost');

select * from finish();
rollback;
