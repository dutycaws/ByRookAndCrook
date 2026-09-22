begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users(id,email,role,aud)
values ('19069000-0000-4000-8000-000000000001','optional-crafting@example.test','authenticated','authenticated');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='19069000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.optional_close as
  select id as save_id,revision,current_day,day_minigame_completed
  from public.tavern_saves
  where user_id='19069000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.advance_tavern_day((select save_id from pg_temp.optional_close),'19069000-0000-4000-8000-000000000002',(select revision from pg_temp.optional_close))$$,
  'a keeper can close a day without completing brew or bake'
);
select is(
  (select current_day from public.tavern_saves where id=(select save_id from pg_temp.optional_close)),
  2,
  'an optional-crafting close advances the day'
);
select is(
  (select day_minigame_completed from public.tavern_saves where id=(select save_id from pg_temp.optional_close)),
  false,
  'the new day starts with no completed craft marker'
);
reset role;

select * from finish();
rollback;
