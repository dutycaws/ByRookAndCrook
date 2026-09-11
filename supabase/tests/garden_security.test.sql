begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id,email,role,aud,created_at,updated_at) values
  ('16400000-0000-4000-8000-000000000001','garden-owner-a@example.test','authenticated','authenticated',now(),now()),
  ('16400000-0000-4000-8000-000000000002','garden-owner-b@example.test','authenticated','authenticated',now(),now());

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16400000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'first garden owner provisions');
set local request.jwt.claim.sub='16400000-0000-4000-8000-000000000002';
select lives_ok($$ select public.create_tavern() $$,'second garden owner provisions');

set local request.jwt.claim.sub='16400000-0000-4000-8000-000000000001';
select is((select count(*) from public.garden_cells),24::bigint,
  'row-level security exposes only the signed-in owner garden');
select is(public.get_tavern_snapshot()#>>'{save,id}',
  (select id::text from public.tavern_saves),
  'snapshot is derived only from the signed-in owner save');
select is(public.project_garden_day()->>'day','1',
  'projection is derived only from the signed-in owner save');

reset role;
create temporary table other_save as
select s.id save_id,c.id cell_id from public.tavern_saves s
join public.garden_cells c on c.save_id=s.id and c.layout_key='c0'
where s.user_id='16400000-0000-4000-8000-000000000002';
grant select on other_save to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16400000-0000-4000-8000-000000000001';
select throws_ok($$ select public.advance_tavern_day(
  (select save_id from other_save),'16400000-0000-4000-8000-000000000010',0) $$,
  'PT404','Tavern not found','one owner cannot advance another owner garden');
select throws_ok($$ select public.harvest_crop(
  (select save_id from other_save),(select cell_id from other_save),
  '16400000-0000-4000-8000-000000000011',0) $$,
  'PT404','Tavern or garden cell not found','one owner cannot harvest another owner garden');

set local role anon;
set local request.jwt.claim.role='anon';
set local request.jwt.claim.sub='';
select throws_ok($$ select public.project_garden_day() $$,
  '42501','permission denied for function project_garden_day',
  'anonymous callers cannot invoke garden projection');

select * from finish();
rollback;
