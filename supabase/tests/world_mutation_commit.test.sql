begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- V2 packages, materialized by create_tavern, are the sole source of runtime
-- state. This test intentionally does not recreate the removed V1 profile or
-- evolution-pin fixture.
insert into auth.users(id,email,role,aud)
values ('17300000-0000-4000-8000-000000000001','mutation-owner@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='17300000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as
select (snapshot#>>'{save,id}')::uuid as save_id,
       (select (value->>'instanceId')::uuid
          from jsonb_array_elements(snapshot->'roster') value
         where value->>'npcId'='18181818-1818-4181-8181-181818181818') as lira,
       (select (value->>'instanceId')::uuid
          from jsonb_array_elements(snapshot->'roster') value
         where value->>'npcId'='28282828-2828-4282-8282-282828282828') as torvin
from (select public.npc_bar_snapshot() snapshot) source;
reset role;

select is((select count(*)::integer from private.npc_version_resident_packages where source_kind='first_party'),2,'exactly two first-party V2 packages are installed');
select is((select count(*)::integer from private.world_resident_package_pins pin join pg_temp.fixture f on f.lira=pin.instance_id or f.torvin=pin.instance_id),2,'seeded roster residents each have one immutable package pin');
select ok((select count(*)=2 from private.world_resident_profiles p join pg_temp.fixture f on p.instance_id in (f.lira,f.torvin) where p.profile_schema_version='personality-schema-v1'),'materialized packages create typed resident profiles');
select ok((select capability_envelope->'allowedWorldEffects' ? 'adjust_relationship' and personality_schema->'dimensions' @> '[{"key":"duty","initialValue":85}]'::jsonb from private.npc_version_resident_packages where version_id='18181818-1818-4181-8181-181818181819'),'Lira package preserves its authored V2 personality and resolved capability');
select ok((select capability_envelope->'allowedApproaches' ? 'trade' and personality_schema->'dimensions' @> '[{"key":"fairness","initialValue":85}]'::jsonb from private.npc_version_resident_packages where version_id='28282828-2828-4282-8282-282828282829'),'Torvin package preserves its authored V2 personality and resolved capability');

create temporary table pg_temp.work(settlement_id uuid,job_id uuid,fence uuid,proposal jsonb,proposal_fingerprint text);
insert into pg_temp.work
select '17300000-0000-4000-8000-000000000101'::uuid,
       '17300000-0000-4000-8000-000000000102'::uuid,
       '17300000-0000-4000-8000-000000000103'::uuid,
       jsonb_build_object('kind','recorded','source','package-v2'),
       encode(extensions.digest(private.world_canonical_json(jsonb_build_object('kind','recorded','source','package-v2')),'sha256'),'hex');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
select settlement_id,save_id,10,0,'v2-mutation','processing',fence,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','package-v2'
from pg_temp.work cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,subject_instance_id,status,input_fingerprint,input_snapshot,input_version)
select job_id,settlement_id,1,'resident',lira,'processing','v2-job','{}','package-v2'
from pg_temp.work cross join pg_temp.fixture;
grant select on pg_temp.work to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',settlement_id,job_id,fence,proposal,proposal_fingerprint,'A package event.'),'42501',null,'authenticated callers cannot commit server-owned world mutations') from pg_temp.work;
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',settlement_id,job_id,fence,'[]','not-a-fingerprint','A package event.'),'PT400',null,'non-object mutation input is rejected before a receipt exists') from pg_temp.work;
reset role;
select is((select count(*) from private.world_resident_mutation_receipts where job_id=(select job_id from pg_temp.work)),0::bigint,'invalid mutation request leaves no committed receipt');
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.result as
select public.world_settlement_commit_mutation(settlement_id,job_id,fence,proposal,proposal_fingerprint,'A package event.') result
from pg_temp.work;
reset role;

select is((select result->>'outcome' from pg_temp.result),'recorded','service commit records the V2 mutation envelope');
select is((select result->>'rulesVersion' from pg_temp.result),'evolving-world-v1','receipt retains the current world-mutation rules contract');
select ok((select result @> jsonb_build_object('status','completed','publicDigest','A package event.') and not (result ?| array['profile','pressure','proposal','roll']) from pg_temp.result),'public receipt excludes private resident state');
select is((select count(*) from private.world_resident_mutation_receipts where job_id=(select job_id from pg_temp.work)),1::bigint,'one mutation receipt is durable');

set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select public.world_settlement_commit_mutation(settlement_id,job_id,fence,proposal,proposal_fingerprint,'A package event.') from pg_temp.work),(select result from pg_temp.result),'same V2 request replays its exact receipt');
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',settlement_id,job_id,fence,jsonb_build_object('kind','different'),encode(extensions.digest('{"kind":"different"}','sha256'),'hex'),'A package event.'),'PT409',null,'a changed proposal cannot overwrite an existing receipt') from pg_temp.work;
reset role;

select * from finish();
rollback;
