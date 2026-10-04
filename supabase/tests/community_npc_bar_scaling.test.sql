begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,email,role,aud) values
  ('18300000-0000-4000-8000-000000000011','bar-scale@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18300000-0000-4000-8000-000000000011';
select public.create_tavern();
reset role;
grant usage on schema private to service_role;
grant select on private.npc_versions to service_role;
grant select on public.tavern_saves to service_role;
set local role service_role;
create temporary table pg_temp.scale_npcs(id uuid primary key, version_id uuid not null);
do $fixture$
declare n integer; npc_id uuid; version_id uuid; fixture_sheet jsonb;
begin
  select version.sheet into fixture_sheet from private.npc_versions version where version.id='18181818-1818-4181-8181-181818181819';
  for n in 1..21 loop
    npc_id:=extensions.gen_random_uuid(); version_id:=extensions.gen_random_uuid();
    fixture_sheet:=jsonb_set(jsonb_set(fixture_sheet,'{identity,name}',to_jsonb(format('Scale Resident %s',n))),'{identity,shortDescription}',to_jsonb(format('A package-backed pagination fixture resident %s.',n)));
    perform private.npc_install_first_party_release(
      npc_id,format('scale-resident-%s',n),n+2,version_id,'v1',1,true,fixture_sheet,
      array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal']
    );
    insert into pg_temp.scale_npcs values(npc_id,version_id);
  end loop;
end
$fixture$;
select private.world_materialize_resident_from_version(
  (select id from public.tavern_saves where user_id='18300000-0000-4000-8000-000000000011'::uuid),id,version_id,1
) from pg_temp.scale_npcs;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18300000-0000-4000-8000-000000000011';

select is(jsonb_array_length(public.npc_roster()),20,'the first roster page clamps at twenty residents');
create temporary table pg_temp.first_page as select public.npc_roster() value;
create temporary table pg_temp.second_page as select public.npc_roster(20,(value->19->>'instanceId')::uuid,null) value from pg_temp.first_page;
select is(jsonb_array_length((select value from pg_temp.second_page)),3,'the cursor exposes a usable second roster page');
select is((select count(*) from jsonb_array_elements((select value from pg_temp.first_page)) a join jsonb_array_elements((select value from pg_temp.second_page)) b on a->>'instanceId'=b->>'instanceId'),0::bigint,'cursor pages do not overlap');
select is((public.npc_roster(20,null,'Lira')->0->>'name'),'Lira Nightwind','roster search filters before pagination');
select is(public.npc_roster(20,null,'no such resident'),'[]'::jsonb,'roster search returns an empty bounded page');
create temporary table pg_temp.bar_instance as select (public.npc_roster()->0->>'instanceId')::uuid id;
select is((public.npc_resident((select id from pg_temp.bar_instance))->>'instanceId'),(select id::text from pg_temp.bar_instance),'deep links resolve a resident outside the cursor protocol');
select is((public.npc_journals(array[(select id from pg_temp.bar_instance)])#>>(array[(select id::text from pg_temp.bar_instance),'instanceId'])),(select id::text from pg_temp.bar_instance),'selected-journal query is owner-scoped and keyed by the requested resident');
select is(jsonb_array_length(public.npc_bar_summary()->'roster'),0,'bounded Bar summary never aggregates a roster');
select public.npc_dismiss((select id from pg_temp.bar_instance));
select is((select count(*) from jsonb_array_elements(public.npc_roster()) r where r->>'instanceId'=(select id::text from pg_temp.bar_instance)),0::bigint,'dismissed residents leave the active roster');
select is((public.npc_archived_roster()->0->>'instanceId'),(select id::text from pg_temp.bar_instance),'dismissed residents remain discoverable through the bounded private archive');
select is(public.npc_resident((select id from pg_temp.bar_instance)),null::jsonb,'a normal direct link cannot restore a dismissed resident');
select is((public.npc_archived_resident((select id from pg_temp.bar_instance))->>'instanceId'),(select id::text from pg_temp.bar_instance),'the explicit archive lookup can reopen the dismissed journal');

select * from finish();
rollback;
