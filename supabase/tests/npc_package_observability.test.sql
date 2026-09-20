begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('private','npc_resident_package_observations','resident package observations have a private append-only projection');
select has_function('public','npc_resident_package_record_failure',array['text','text','uuid','uuid','uuid','uuid','text','uuid','uuid','text','integer'],'service failure recorder has the typed identifier-only contract');
select has_function('public','npc_resident_package_observations_recent',array['integer'],'administrator projection reader has the bounded contract');

insert into auth.users(id,email,role,aud) values
  ('40000000-0000-4000-8000-000000000001','package-observer@example.test','authenticated','authenticated'),
  ('40000000-0000-4000-8000-000000000002','package-admin@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id) values
  ('40000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000001');
insert into private.npc_capabilities(user_id,capability,granted_by,reason)
values('40000000-0000-4000-8000-000000000002','admin','40000000-0000-4000-8000-000000000002','fixture');

select lives_ok($$select private.npc_install_first_party_release(
  '40000000-0000-4000-8000-000000000021','observability-warden',1,
  '40000000-0000-4000-8000-000000000022','observability-v1',1,true,
  (select sheet from private.npc_versions where id='18181818-1818-4181-8181-181818181819'),
  array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal']
)$$,'new immutable package publication creates an observable release boundary');
select ok(exists(
  select 1 from private.npc_resident_package_observations o
  join private.npc_version_resident_packages p on p.id=o.package_id
  where o.operation='publication' and o.status='completed' and o.npc_id=p.npc_id
    and o.version_id=p.version_id and o.package_hash=p.package_hash
),'immutable package inserts produce identifier-and-hash-only publication observations');
select ok(not exists(
  select 1 from information_schema.columns
  where table_schema='private' and table_name='npc_resident_package_observations'
    and column_name in ('sheet','frozen_sheet','profile','prompt','error_message','metadata','payload')
),'the observation projection has no private sheet, prompt, profile, payload, or error-message column');

set local request.jwt.claim.role='service_role';
select lives_ok($$select * from private.world_materialize_resident_from_version(
  '40000000-0000-4000-8000-000000000011',
  '40000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-000000000022',1
)$$,'materializer creates the first-party fixture resident');
select lives_ok($$select public.npc_resident_package_record_failure(
  'materialization','first_party','40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000022',
  (select id from private.npc_version_resident_packages where version_id='40000000-0000-4000-8000-000000000022'),
  (select package_hash from private.npc_version_resident_packages where version_id='40000000-0000-4000-8000-000000000022'),
  '40000000-0000-4000-8000-000000000011',null,'PT409',37
)$$,'service can record a caught typed failure without a private payload');
reset role;

select ok(exists(
  select 1 from private.npc_resident_package_observations o
  where o.operation='materialization' and o.status='completed'
    and o.save_id='40000000-0000-4000-8000-000000000011'
    and o.instance_id is not null and o.error_code is null
),'package pin creation emits a materialization success observation');
select ok(exists(
  select 1 from private.npc_resident_package_observations o
  where o.operation='materialization' and o.status='failed'
    and o.error_code='PT409' and o.duration_ms=37
    and o.actor_id='40000000-0000-4000-8000-000000000001'
),'failure recorder keeps only the typed error code, timing, actor, and immutable identifiers');
select throws_ok($$set local request.jwt.claim.role='service_role'; select public.npc_resident_package_record_failure('materialization','first_party',null,'40000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000022',null,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',null,null,'PT400',1)$$,'PT400',null,'a package hash cannot be recorded without its immutable package id');

set local request.jwt.claim.sub='40000000-0000-4000-8000-000000000002';
select ok((select count(*) from public.npc_resident_package_observations_recent(20)) >= 2,'administrator can read the narrow identifier-only projection');
reset request.jwt.claim.sub;
select throws_ok($$select public.npc_resident_package_observations_recent(1)$$,'PT403',null,'non-administrators cannot read any observability projection row');
select throws_ok($$update private.npc_resident_package_observations set error_code='PT400' where id=(select min(id) from private.npc_resident_package_observations)$$,'55000',null,'observations are append-only');

select * from finish();
rollback;
