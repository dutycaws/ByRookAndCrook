begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,role,aud) values
  ('53000000-0000-4000-8000-000000000001','codex-owner@example.test','authenticated','authenticated'),
  ('53000000-0000-4000-8000-000000000002','codex-other@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='53000000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
create temporary table pg_temp.codex_fixture as
select save.id as save_id, resident.id as resident_id
from public.tavern_saves save
join private.world_npc_instances resident on resident.save_id = save.id
where save.user_id='53000000-0000-4000-8000-000000000001'
order by resident.id limit 1;
grant select on pg_temp.codex_fixture to authenticated;

insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at,input_snapshot,input_version)
select '53000000-0000-4000-8000-000000000010',save_id,3,0,'codex-settlement','completed',clock_timestamp(),'{}','fixture-v1' from pg_temp.codex_fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
values
 ('53000000-0000-4000-8000-000000000011','53000000-0000-4000-8000-000000000010',1,'canon','completed','codex-canon','{}','fixture-v1'),
 ('53000000-0000-4000-8000-000000000012','53000000-0000-4000-8000-000000000010',2,'procedural_world','completed','codex-procedural','{}','procedural-world-v1');
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,subject_instance_id,status,input_fingerprint,input_snapshot,input_version)
select '53000000-0000-4000-8000-000000000013','53000000-0000-4000-8000-000000000010',3,'resident',resident_id,'completed','codex-resident','{}','fixture-v1' from pg_temp.codex_fixture;

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '53000000-0000-4000-8000-000000000020'::uuid,save_id,'location','old-mill','procedural','fixture-v1',jsonb_build_object('secret','secret-pressure'),'discovered',3 from pg_temp.codex_fixture
union all
select '53000000-0000-4000-8000-000000000021'::uuid,save_id,'item','hidden-ledger','procedural','procedural-world-v1',jsonb_build_object('secret','never-visible'),'undiscovered',3 from pg_temp.codex_fixture
union all
select '53000000-0000-4000-8000-000000000022'::uuid,save_id,'location','watchtower','procedural','procedural-world-v1',jsonb_build_object('secret','generated-private-payload'),'active',3 from pg_temp.codex_fixture;
insert into private.world_public_discoveries(settlement_id,job_id,canonical_entity_id,save_id,day_number,title,summary)
select '53000000-0000-4000-8000-000000000010','53000000-0000-4000-8000-000000000011','53000000-0000-4000-8000-000000000020',save_id,3,'Old Mill','A weathered landmark on the north road.' from pg_temp.codex_fixture;
insert into private.world_procedural_public_events(settlement_id,job_id,command_ordinal,canonical_entity_id,save_id,day_number,template_key,title,summary,reuse_key)
select '53000000-0000-4000-8000-000000000010','53000000-0000-4000-8000-000000000012',0,'53000000-0000-4000-8000-000000000020',save_id,3,'market-day','Market day returns','Merchants gather by the old mill.','old-mill-market' from pg_temp.codex_fixture;
insert into private.resident_evolution_entries(job_id,instance_id,save_id,day_number,profile_revision,disposition)
select '53000000-0000-4000-8000-000000000013',resident_id,save_id,3,2,jsonb_build_object('version','resident-disposition-v1','state','changed','profileRevision',2,'summary','The resident has become more watchful.') from pg_temp.codex_fixture;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='53000000-0000-4000-8000-000000000001';
create temporary table pg_temp.public_codex as select public.world_public_codex(save_id) result from pg_temp.codex_fixture;
select ok((select result ?& array['version','entities','publicEvents','dispositions'] and not (result ?| array['jobs','snapshots','checkpoints','receipts','payload','pressure','beliefs','prompts','usage']) from pg_temp.public_codex),'codex has only its exact public top-level projection');
select is((select result#>>'{entities,0,title}' from pg_temp.public_codex),'Old Mill','codex exposes a discovered canonical entity');
select is((select jsonb_array_length(result->'entities') from pg_temp.public_codex),2,'undiscovered canonical entities are excluded while an explicit procedural public outcome is visible');
select ok((select exists(select 1 from jsonb_array_elements(result->'entities') item where item->>'title'='Watchtower' and item#>>'{provenance,kind}'='procedural_entity_outcome') from pg_temp.public_codex),'a generated entity reaches the codex only through the public outcome projection');
select is((select result#>>'{publicEvents,0,title}' from pg_temp.public_codex),'Market day returns','codex exposes the public procedural event summary');
select ok((select result#>>'{dispositions,0,provenance,kind}'='resident_evolution' and result#>>'{dispositions,0,summary}'='The resident has become more watchful.' from pg_temp.public_codex),'codex attributes a public resident disposition summary');
select ok((select position('secret-pressure' in result::text)=0 and position('never-visible' in result::text)=0 and position('generated-private-payload' in result::text)=0 from pg_temp.public_codex),'codex does not project private entity payloads');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='53000000-0000-4000-8000-000000000002';
select throws_ok(format('select public.world_public_codex(%L)',save_id),'PT404',null,'another keeper cannot read this codex') from pg_temp.codex_fixture;
reset role;
select ok(not has_table_privilege('authenticated','private.world_canonical_entities','select'),'players cannot read canonical records directly');
select ok(has_function_privilege('authenticated','public.world_public_codex(uuid)','execute'),'players can use the owner-scoped codex projection');

select * from finish();
rollback;
