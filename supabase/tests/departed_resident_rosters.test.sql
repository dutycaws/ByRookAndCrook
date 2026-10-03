begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id,email,role,aud) values
  ('83000000-0000-4000-8000-000000000001','departed-roster@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='83000000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
create temporary table pg_temp.roster_residents as
  select resident.id,version.sheet#>>'{identity,name}' as name
  from private.world_npc_instances resident
  join public.tavern_saves save_row on save_row.id=resident.save_id
  join private.npc_versions version on version.id=resident.version_id
  where save_row.user_id='83000000-0000-4000-8000-000000000001';
grant select on pg_temp.roster_residents to authenticated;

set local role authenticated;
select is(jsonb_array_length(public.npc_roster(20,null,'Lira')),1,'a present resident remains in the playable roster');
select is((select count(*) from jsonb_array_elements(public.npc_bar_snapshot()->'roster') resident where resident->>'instanceId'=(select id::text from pg_temp.roster_residents where name='Lira Nightwind')),1::bigint,'a present resident remains in the bar snapshot');
reset role;

-- Arrange only this transaction's projection states; the browser journey covers
-- the real farewell-day transition and archive boundary.
update private.world_npc_instances set status='departed'
where id=(select id from pg_temp.roster_residents where name='Lira Nightwind');
set local role authenticated;
select is(public.npc_roster(20,null,'Lira'),'[]'::jsonb,'a departed resident leaves the playable roster');
select is((select count(*) from jsonb_array_elements(public.npc_bar_snapshot()->'roster') resident where resident->>'instanceId'=(select id::text from pg_temp.roster_residents where name='Lira Nightwind')),0::bigint,'a departed resident leaves the bar snapshot');
select is(jsonb_array_length(public.npc_archived_roster(20,null,'Lira')),1,'a departed resident remains discoverable in the archive');
select is(public.npc_archived_resident((select id from pg_temp.roster_residents where name='Lira Nightwind'))->>'status','departed','a departed resident can still be opened through the archive');
reset role;

update private.world_npc_instances set status='dismissed'
where id=(select id from pg_temp.roster_residents where name='Torvin Ashbeard');
set local role authenticated;
select is(public.npc_roster(20,null,'Torvin'),'[]'::jsonb,'a dismissed resident stays out of the playable roster');
select is((select count(*) from jsonb_array_elements(public.npc_bar_snapshot()->'roster') resident where resident->>'instanceId'=(select id::text from pg_temp.roster_residents where name='Torvin Ashbeard')),0::bigint,'a dismissed resident stays out of the bar snapshot');

select * from finish();
rollback;
