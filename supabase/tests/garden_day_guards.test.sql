begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id,email,role,aud,created_at,updated_at) values
  ('16100000-0000-4000-8000-000000000001','garden-brew-guard@example.test','authenticated','authenticated',now(),now()),
  ('16100000-0000-4000-8000-000000000002','garden-bake-guard@example.test','authenticated','authenticated',now(),now()),
  ('16100000-0000-4000-8000-000000000003','garden-dialogue-guard@example.test','authenticated','authenticated',now(),now());

set local role authenticated;
set local request.jwt.claim.role='authenticated';

set local request.jwt.claim.sub='16100000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'brew-guard player can create a tavern');
select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),(select id from public.garden_cells where layout_key='c0'),
  '16100000-0000-4000-8000-000000000011',0) $$,'brew-guard setup harvests an ingredient');
select lives_ok($$ select public.start_brew(
  (select id from public.tavern_saves),(select id from public.ingredient_batches limit 1),
  '16100000-0000-4000-8000-000000000012',1) $$,'brew-guard setup starts a brew');
select throws_ok($$ select public.advance_tavern_day(
  (select id from public.tavern_saves),'16100000-0000-4000-8000-000000000013',2) $$,
  'PT422','Finish the active brew before closing','active brewing blocks garden resolution');
select is((select current_day from public.tavern_saves),1,'active brew leaves the day unchanged');
select is((select count(*) from public.garden_day_resolutions),0::bigint,'active brew creates no garden resolution');

set local request.jwt.claim.sub='16100000-0000-4000-8000-000000000002';
select lives_ok($$ select public.create_tavern() $$,'bake-guard player can create a tavern');
select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),(select id from public.garden_cells where layout_key='c0'),
  '16100000-0000-4000-8000-000000000021',0) $$,'bake-guard setup harvests an ingredient');
select lives_ok($$ select public.start_bake(
  (select id from public.tavern_saves),(select id from public.ingredient_batches limit 1),
  '16100000-0000-4000-8000-000000000022',1) $$,'bake-guard setup starts a bake');
select throws_ok($$ select public.advance_tavern_day(
  (select id from public.tavern_saves),'16100000-0000-4000-8000-000000000023',2) $$,
  'PT422','Finish the active bake before closing','active baking blocks garden resolution');
select is((select current_day from public.tavern_saves),1,'active bake leaves the day unchanged');
select is((select count(*) from public.garden_day_resolutions),0::bigint,'active bake creates no garden resolution');

set local request.jwt.claim.sub='16100000-0000-4000-8000-000000000003';
select lives_ok($$ select public.create_tavern() $$,'dialogue-guard player can create a tavern');
reset role;
insert into public.dialogue_turns(
  id,save_id,actor_id,patron_key,message,input_sequence,source_revision,day,status,lease_until
) select '16100000-0000-4000-8000-000000000031',id,user_id,'lira','How fares the road?',0,revision,current_day,
  'processing',now()+interval '5 minutes' from public.tavern_saves
where user_id='16100000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub='16100000-0000-4000-8000-000000000003';
select throws_ok($$ select public.advance_tavern_day(
  (select id from public.tavern_saves),'16100000-0000-4000-8000-000000000032',0) $$,
  'PT409','Finish or cancel the pending conversation before closing','live dialogue blocks garden resolution');
select is((select current_day from public.tavern_saves),1,'live dialogue leaves the day unchanged');
select is((select count(*) from public.garden_day_resolutions),0::bigint,'live dialogue creates no garden resolution');

select * from finish();
rollback;
