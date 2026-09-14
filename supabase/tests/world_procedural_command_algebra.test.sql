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
alter table pg_temp.fixture add column source_resident_id uuid, add column unprivileged_resident_id uuid;
update pg_temp.fixture set source_resident_id=(select id from private.world_npc_instances where save_id=pg_temp.fixture.save_id order by id limit 1);
update pg_temp.fixture set unprivileged_resident_id=(select id from private.world_npc_instances where save_id=pg_temp.fixture.save_id and id<>pg_temp.fixture.source_resident_id order by id limit 1);

-- The fixture pins only the old pilot capability.  This isolated database test
-- grants a frozen test-only capability so positive command admission proves the
-- authorization check rather than bypassing it in production content.
set local session_replication_role=replica;
update private.world_resident_evolution_pins set capability=jsonb_build_object(
  'allowedWorldEffects',jsonb_build_array('create_entity','create_quest','update_quest','record_world_event'),
  'allowedActions',jsonb_build_array('prepare','attempt','wait','abandon'),
  'allowedApproaches',jsonb_build_array('scouting','combat','diplomacy','trade'),
  'allowedTargetKinds',jsonb_build_array('npc','location','faction','item','recipe','world_event'),
  'socialCapabilities','[]'::jsonb,'irreversibleEffects','[]'::jsonb
) where instance_id=(select source_resident_id from pg_temp.fixture);
set local session_replication_role=origin;

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '18000000-0000-4000-8000-000000000010',save_id,'location','millhaven','authored','fixture-v1','{}','active',1 from pg_temp.fixture;
insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values('18000000-0000-4000-8000-000000000010','created','{}','fixture-v1');
create temporary table pg_temp.attempt(s uuid,j uuid,f uuid);
insert into pg_temp.attempt values ('18000000-0000-4000-8000-000000000020','18000000-0000-4000-8000-000000000021','18000000-0000-4000-8000-000000000022');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
select s,save_id,4,1,'procedural-fixture','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.attempt cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
select j,s,1,'canon','processing','procedural-job','{}','procedural-world-v1' from pg_temp.attempt;
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
select ok((select result @> jsonb_build_object('status','completed','rulesVersion','procedural-world-v1','settlementId',s,'jobId',j) and result ? 'proposalFingerprint' from pg_temp.result cross join pg_temp.attempt), 'valid entity and public event commands return a safe stable receipt');
select ok(exists(select 1 from private.world_canonical_entities e join pg_temp.fixture f on f.save_id=e.save_id where e.entity_kind='location' and e.entity_key='old-mill' and e.origin='procedural'), 'place alias normalizes to the registered location key and the server assigns its id');
select is((select count(*) from private.world_procedural_public_events where job_id=(select j from pg_temp.attempt)), 1::bigint, 'public event operation records one server-owned public event');
select ok((select template_key='market-day' and canonical_entity_id in (select id from private.world_canonical_entities where entity_key='old-mill-market') from private.world_procedural_public_events where job_id=(select j from pg_temp.attempt)), 'public event reuses the canonical entity registry with registered template metadata');
set local role service_role; set local request.jwt.claim.role='service_role';
select is(public.world_settlement_commit_procedural_world((select s from pg_temp.attempt),(select j from pg_temp.attempt),(select f from pg_temp.attempt),pg_temp.proposal()),(select result from pg_temp.result), 'identical replay returns the exact receipt');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.attempt),(select j from pg_temp.attempt),(select f from pg_temp.attempt),jsonb_set(pg_temp.proposal(),'{commands,0,proposedName}','"Changed Mill"'))$$, 'PT409', null, 'changed replay conflicts before duplicating world state');
reset role;
select is((select count(*) from private.world_procedural_public_events where job_id=(select j from pg_temp.attempt)), 1::bigint, 'replay does not duplicate the public event operation');

select lives_ok($$insert into private.world_procedural_quests(save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day) select f.save_id,i.id,'active','successor-quest','fixture-one','{}',4 from pg_temp.fixture f join private.world_npc_instances i on i.save_id=f.save_id limit 1$$, 'one direct active successor quest can be recorded for a resident');
select throws_ok($$insert into private.world_procedural_quests(save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day) select q.save_id,q.instance_id,'active','successor-quest','fixture-two','{}',4 from private.world_procedural_quests q where q.input_fingerprint='fixture-one'$$, '23505', null, 'unique active-quest index prevents a second active successor quest');

create temporary table pg_temp.invalid(s uuid,j uuid,f uuid);
insert into pg_temp.invalid values ('18000000-0000-4000-8000-000000000030','18000000-0000-4000-8000-000000000031','18000000-0000-4000-8000-000000000032');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version) select s,save_id,5,1,'procedural-invalid','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.invalid cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version) select j,s,1,'canon','processing','procedural-invalid-job','{}','procedural-world-v1' from pg_temp.invalid;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.invalid;
grant select on pg_temp.invalid to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','entityKind','location','entityKey','bad','archetypeKey','landmark','proposedName','Bad','payload',jsonb_build_object('script','no')))))$$, 'PT400', null, 'unsafe payloads are rejected before authoritative writes');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'entityKind','location','entityKey','bad','archetypeKey','landmark','proposedName','Bad','payload',jsonb_build_object('nested',jsonb_build_object('script','no'))))))$$, 'PT400', null, 'nested executable payload keys are rejected before authoritative writes');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'entityKind','location','entityKey','deep','archetypeKey','landmark','proposedName','Deep','payload','{"one":{"two":{"three":{"four":"deep"}}}}'::jsonb))))$$, 'PT400', null, 'an otherwise-safe payload beyond the recursive depth bound is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select unprivileged_resident_id::text from pg_temp.fixture),'entityKind','location','entityKey','capability-denied','archetypeKey','landmark','proposedName','Capability denied','payload',jsonb_build_object('region','north')))))$$, 'PT400', null, 'a well-formed entity command without frozen initiating capability is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId',(select unprivileged_resident_id::text from pg_temp.fixture),'templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','Denied market','summary','A well-formed event without authority.','reuseKey','denied-market'))))$$, 'PT400', null, 'a well-formed public event without frozen initiating capability is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','First market','summary','The first meaning.','reuseKey','duplicate-market'),jsonb_build_object('operation','public_event','effectKind','record_world_event','sourceResidentId',(select source_resident_id::text from pg_temp.fixture),'templateKey','market-day','participantEntityRefs',jsonb_build_array('millhaven'),'title','Second market','summary','A conflicting meaning.','reuseKey','duplicate-market'))))$$, '23505', null, 'duplicate public-event keys cannot attach conflicting meanings within one job');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.invalid),(select j from pg_temp.invalid),(select f from pg_temp.invalid),jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(jsonb_build_object('operation','retire','effectKind','retire_entity','entityId','millhaven','reason','too soon'))))$$, 'PT400', null, 'retirement is reserved for the later irreversible capability and warning gate');
reset role;
select is((select count(*) from private.world_procedural_command_receipts where job_id=(select j from pg_temp.invalid)),0::bigint, 'invalid command does not leave a receipt');
select is((select count(*) from private.world_procedural_public_events where job_id=(select j from pg_temp.invalid)),0::bigint, 'capability-denied public event creates no provenance row');

select * from finish();
rollback;
