begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('service_role','public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb)','execute'), 'service worker owns procedural command commits');
select ok(not has_function_privilege('authenticated','public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb)','execute'), 'players cannot submit procedural world commands');
select ok(not has_table_privilege('authenticated','private.world_procedural_command_receipts','select'), 'players cannot read private command receipts');
select is((select array_agg(effect_kind order by effect_kind) from private.world_procedural_effect_registry), array['create_entity','create_quest','record_world_event','retire_entity','update_quest'], 'effect registry exposes only the finite procedural command algebra');
select throws_ok($$insert into private.world_procedural_quest_primitives(primitive_key,allowed_actions,allowed_approaches) values('invented-quest',array['prepare','attempt','wait','abandon'],array['scouting','combat','diplomacy','trade'])$$, '23514', null, 'quest primitive registry rejects arbitrary generated grammar');

insert into auth.users(id,email,role,aud) values ('18000000-0000-4000-8000-000000000001','procedural-owner@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='18000000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as
select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
alter table pg_temp.fixture add column source_resident_id uuid;
update pg_temp.fixture set source_resident_id=(select id from private.world_npc_instances where save_id=pg_temp.fixture.save_id order by id limit 1);

-- The package is immutable and is the only procedural capability source.
select ok((private.world_procedural_resident_capability((select save_id from pg_temp.fixture),(select source_resident_id from pg_temp.fixture))->'allowedWorldEffects' ? 'create_entity'), 'the fixture source receives its reviewed package capability');
select throws_ok($$update private.npc_version_resident_packages set capability_envelope='{}'::jsonb where id=(select package_id from private.world_resident_package_pins where instance_id=(select source_resident_id from pg_temp.fixture))$$, '55000', null, 'the source resident package remains immutable');

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '18000000-0000-4000-8000-000000000010',save_id,'location','millhaven','authored','fixture-v1','{}','active',1 from pg_temp.fixture;
insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values('18000000-0000-4000-8000-000000000010','created','{}','fixture-v1');
create temporary table pg_temp.attempt(s uuid,j uuid,f uuid);
insert into pg_temp.attempt values ('18000000-0000-4000-8000-000000000020','18000000-0000-4000-8000-000000000021','18000000-0000-4000-8000-000000000022');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
select s,save_id,4,1,'procedural-fixture','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.attempt cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
select j,s,1,'procedural_world','processing',encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),private.world_procedural_world_context(save_id),'procedural-world-v1' from pg_temp.attempt cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until)
select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.attempt;

create function pg_temp.proposal() returns jsonb language sql as $$
 select jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(
  jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'entityKind','place','entityKey','Old Mill','archetypeKey','landmark','proposedName','Old Mill','payload',jsonb_build_object('region','north','tags',jsonb_build_array('ruin'))),
  jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','Market day returns','summary','Merchants gather by the old mill.','reuseKey','old-mill-market')
 )) $$;
grant select on pg_temp.attempt,pg_temp.fixture to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.result as select public.world_settlement_commit_procedural_world(s,j,f,pg_temp.proposal()) result from pg_temp.attempt;
reset role;
select ok((select result @> jsonb_build_object('status','completed','rulesVersion','procedural-world-v1','settlementId',s,'jobId',j,'replayed',false) and result ? 'proposalFingerprint' from pg_temp.result cross join pg_temp.attempt), 'valid entity and public event commands return a safe stable receipt');
select ok(exists(select 1 from private.world_canonical_entities e join pg_temp.fixture f on f.save_id=e.save_id where e.entity_kind='location' and e.entity_key='old-mill' and e.origin='procedural'), 'place alias normalizes to the registered location key and the server assigns its id');
select is((select count(*) from private.world_procedural_public_events where job_id=(select j from pg_temp.attempt)), 1::bigint, 'public event operation records one server-owned public event');
select ok((select template_key='market-day' and canonical_entity_id in (select id from private.world_canonical_entities where entity_key='old-mill-market') from private.world_procedural_public_events where job_id=(select j from pg_temp.attempt)), 'public event reuses the canonical entity registry with registered template metadata');
set local role service_role; set local request.jwt.claim.role='service_role';
select ok((public.world_settlement_commit_procedural_world((select s from pg_temp.attempt),(select j from pg_temp.attempt),(select f from pg_temp.attempt),pg_temp.proposal())->>'replayed')='true', 'identical replay has a server-only replay discriminator');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.attempt),(select j from pg_temp.attempt),(select f from pg_temp.attempt),jsonb_set(pg_temp.proposal(),'{commands,0,proposedName}','"Changed Mill"'))$$, 'PT409', null, 'changed replay conflicts before duplicating world state');
reset role;
select is((select count(*) from private.world_procedural_public_events where job_id=(select j from pg_temp.attempt)), 1::bigint, 'replay does not duplicate the public event operation');

-- Quest generation has moved to the canonical transition workflow. The old
-- procedural service rejects this command before touching its history table.
create temporary table pg_temp.npc_target(s uuid,j uuid,f uuid);
insert into pg_temp.npc_target values ('18000000-0000-4000-8000-000000000040','18000000-0000-4000-8000-000000000041','18000000-0000-4000-8000-000000000042');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
select s,save_id,6,1,'procedural-npc-target','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.npc_target cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
select j,s,1,'procedural_world','processing',encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),private.world_procedural_world_context(save_id),'procedural-world-v1' from pg_temp.npc_target cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.npc_target;
grant select on pg_temp.npc_target to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_settlement_commit_procedural_world(s,j,f,jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','quest','effectKind','create_quest','ownerResidentId',(select source_resident_id::text from pg_temp.fixture),'primitiveKey','successor-quest','action','prepare','approach','scouting','targetEntityRefs',jsonb_build_array((select source_resident_id::text from pg_temp.fixture)),'motivation','Meet the ranger at the old watch.')))) from pg_temp.npc_target$$,'PT400','Legacy procedural quest commands are retired; use the canonical quest transition service','general procedural generation cannot create a competing quest');
reset role;

select lives_ok($$insert into private.world_procedural_quests(save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day,ended_day) select f.save_id,i.id,'resolved','successor-quest','fixture-one','{}',4,4 from pg_temp.fixture f join private.world_npc_instances i on i.save_id=f.save_id and i.id<>f.source_resident_id limit 1$$, 'legacy procedural quest history remains readable for prototype migration');
select is(private.world_procedural_world_context((select save_id from pg_temp.fixture))->'activeQuestByResident','{}'::jsonb,'legacy quest history is never projected as current authority');

-- Every negative command receives its own lease.  That keeps an unexpected
-- acceptance from turning the remaining assertions into receipt/replay PT409s.
create temporary table pg_temp.invalid(case_key text primary key,s uuid,j uuid,f uuid);
insert into pg_temp.invalid values
  ('cross_settlement','18000000-0000-4000-8000-000000000030','18000000-0000-4000-8000-000000000031','18000000-0000-4000-8000-000000000032'),
  ('unknown_job','18000000-0000-4000-8000-000000000033','18000000-0000-4000-8000-000000000034','18000000-0000-4000-8000-000000000035'),
  ('stale_fence','18000000-0000-4000-8000-000000000036','18000000-0000-4000-8000-000000000037','18000000-0000-4000-8000-000000000038'),
  ('unsafe_payload','18000000-0000-4000-8000-000000000039','18000000-0000-4000-8000-000000000043','18000000-0000-4000-8000-000000000044'),
  ('nested_payload','18000000-0000-4000-8000-000000000045','18000000-0000-4000-8000-000000000046','18000000-0000-4000-8000-000000000047'),
  ('deep_payload','18000000-0000-4000-8000-000000000048','18000000-0000-4000-8000-000000000049','18000000-0000-4000-8000-000000000050'),
  ('denied_entity','18000000-0000-4000-8000-000000000051','18000000-0000-4000-8000-000000000052','18000000-0000-4000-8000-000000000053'),
  ('denied_event','18000000-0000-4000-8000-000000000054','18000000-0000-4000-8000-000000000055','18000000-0000-4000-8000-000000000056'),
  ('duplicate_event','18000000-0000-4000-8000-000000000057','18000000-0000-4000-8000-000000000058','18000000-0000-4000-8000-000000000059'),
  ('retire','18000000-0000-4000-8000-000000000060','18000000-0000-4000-8000-000000000061','18000000-0000-4000-8000-000000000062');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
select s,save_id,20+row_number() over(order by case_key),1,'procedural-invalid-'||case_key,'processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.invalid cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
select j,s,1,'procedural_world','processing',encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),private.world_procedural_world_context(save_id),'procedural-world-v1' from pg_temp.invalid cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.invalid;
select ok((select count(*) from private.world_settlement_jobs j join pg_temp.invalid i on i.j=j.id where j.input_snapshot->'capabilities' ? (select source_resident_id::text from pg_temp.fixture))=10,'every negative lease freezes the package-derived capability context before command admission');
grant select on pg_temp.invalid to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_settlement_commit_procedural_world((select save_id from pg_temp.fixture),(select j from pg_temp.invalid where case_key='cross_settlement'),(select f from pg_temp.invalid where case_key='cross_settlement'),pg_temp.proposal())$$, 'PT409', null, 'a job cannot be committed against another settlement');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='unknown_job'),'18000000-0000-4000-8000-000000000099',(select f from pg_temp.invalid where case_key='unknown_job'),pg_temp.proposal())$$, 'PT409', null, 'an unknown procedural job is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='stale_fence'),(select j from pg_temp.invalid where case_key='stale_fence'),'18000000-0000-4000-8000-000000000099',pg_temp.proposal())$$, 'PT409', null, 'a stale procedural fence is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='unsafe_payload'),(select j from pg_temp.invalid where case_key='unsafe_payload'),(select f from pg_temp.invalid where case_key='unsafe_payload'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','entityKind','location','entityKey','bad','archetypeKey','landmark','proposedName','Bad','payload',jsonb_build_object('script','no')))))$$, 'PT400', null, 'unsafe payloads are rejected before authoritative writes');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='nested_payload'),(select j from pg_temp.invalid where case_key='nested_payload'),(select f from pg_temp.invalid where case_key='nested_payload'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'entityKind','location','entityKey','bad','archetypeKey','landmark','proposedName','Bad','payload',jsonb_build_object('nested',jsonb_build_object('script','no'))))))$$, 'PT400', null, 'nested executable payload keys are rejected before authoritative writes');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='deep_payload'),(select j from pg_temp.invalid where case_key='deep_payload'),(select f from pg_temp.invalid where case_key='deep_payload'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'entityKind','location','entityKey','deep','archetypeKey','landmark','proposedName','Deep','payload','{"one":{"two":{"three":{"four":"deep"}}}}'::jsonb))))$$, 'PT400', null, 'an otherwise-safe payload beyond the recursive depth bound is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='denied_entity'),(select j from pg_temp.invalid where case_key='denied_entity'),(select f from pg_temp.invalid where case_key='denied_entity'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId','18000000-0000-4000-8000-000000000099','entityKind','location','entityKey','capability-denied','archetypeKey','landmark','proposedName','Capability denied','payload',jsonb_build_object('region','north')))))$$, 'PT400', null, 'an entity command from an identity absent from frozen package authority is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='denied_event'),(select j from pg_temp.invalid where case_key='denied_event'),(select f from pg_temp.invalid where case_key='denied_event'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId','18000000-0000-4000-8000-000000000099','templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','Denied market','summary','A well-formed event without package authority.','reuseKey','denied-market'))))$$, 'PT400', null, 'a public event from an identity absent from frozen package authority is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='duplicate_event'),(select j from pg_temp.invalid where case_key='duplicate_event'),(select f from pg_temp.invalid where case_key='duplicate_event'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','First market','summary','The first meaning.','reuseKey','duplicate-market'),jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','Second market','summary','A conflicting meaning.','reuseKey','duplicate-market'))))$$, '23505', null, 'duplicate public-event keys cannot attach conflicting meanings within one job');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid where case_key='retire'),(select j from pg_temp.invalid where case_key='retire'),(select f from pg_temp.invalid where case_key='retire'),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','retire','effectKind','retire_entity','entityId','millhaven','reason','too soon'))))$$, 'PT400', null, 'retirement is reserved for the later irreversible capability and warning gate');
reset role;
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='cross_settlement')),0::bigint, 'cross-settlement rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='unknown_job')),0::bigint, 'unknown-job rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='stale_fence')),0::bigint, 'stale-fence rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='unsafe_payload')),0::bigint, 'unsafe-payload rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='nested_payload')),0::bigint, 'nested-payload rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='deep_payload')),0::bigint, 'deep-payload rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='denied_entity')),0::bigint, 'denied-entity command leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='denied_event')),0::bigint, 'denied-event command leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='duplicate_event')),0::bigint, 'duplicate-event rejection leaves no receipt');
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid where case_key='retire')),0::bigint, 'retirement rejection leaves no receipt');
select is((select count(*) from private.world_procedural_public_events where job_id in (select j from pg_temp.invalid)),0::bigint, 'rejected commands create no public-event provenance rows');

-- A normal day close appends at most one immutable job after the pre-existing
-- canon/social chain.  Replaying the same player action does not enqueue it again.
insert into auth.users(id,email,role,aud) values ('18000000-0000-4000-8000-000000000090','procedural-close@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='18000000-0000-4000-8000-000000000090';
select public.create_tavern();
create temporary table pg_temp.close_fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
create temporary table pg_temp.close_result as select public.advance_tavern_day((select save_id from pg_temp.close_fixture),'18000000-0000-4000-8000-000000000091',0) result;
reset role;
select is((select count(*) from private.world_settlement_jobs where settlement_id=(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result) and job_kind='procedural_world'),1::bigint,'day close queues exactly one dedicated procedural-world job');
select ok((select j.input_version='procedural-world-v1' and j.input_snapshot->>'version'='procedural-world-v1' and (select count(*) from jsonb_object_keys(j.input_snapshot))=5 and j.input_snapshot ?& array['version','entityKinds','activeGeneratedEntityCount','activeQuestByResident','capabilities'] and j.input_fingerprint=encode(extensions.digest(private.world_canonical_json(j.input_snapshot),'sha256'),'hex') from private.world_settlement_jobs j where j.settlement_id=(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result) and j.job_kind='procedural_world'),'procedural job freezes only the versioned TypeScript validation context and canonical fingerprint');
select ok((select p.ordinal>(select max(c.ordinal) from private.world_settlement_jobs c where c.settlement_id=p.settlement_id and c.job_kind='canon') from private.world_settlement_jobs p where p.settlement_id=(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result) and p.job_kind='procedural_world'),'procedural work preserves canonical ordering by appending after established jobs');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='18000000-0000-4000-8000-000000000090';
select is(public.advance_tavern_day((select save_id from pg_temp.close_fixture),'18000000-0000-4000-8000-000000000091',0),(select result from pg_temp.close_result),'same player day-close action replays exactly');
reset role;
select is((select count(*) from private.world_settlement_jobs where settlement_id=(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result) and job_kind='procedural_world'),1::bigint,'day-close replay cannot create a second procedural job');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='18000000-0000-4000-8000-000000000090';
select ok(not (public.world_settlement_status((select save_id from pg_temp.close_fixture),(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result))::text ilike '%procedural-world-v1%' or public.world_settlement_status((select save_id from pg_temp.close_fixture),(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result)) ? 'inputSnapshot' or public.world_settlement_status((select save_id from pg_temp.close_fixture),(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result)) ? 'inputFingerprint' or public.world_settlement_status((select save_id from pg_temp.close_fixture),(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.close_result)) ? 'jobs'),'authenticated settlement status does not project the private procedural context, fingerprint, or job internals');
reset role;

select * from finish();
rollback;
