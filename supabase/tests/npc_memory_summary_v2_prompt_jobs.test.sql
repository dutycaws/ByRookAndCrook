begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

select is(
  (select array_agg(prompt_key order by prompt_key) from private.prompt_release_entries
   where release_id=(select release_id from private.prompt_registry_active_release)),
  (select array_agg(prompt_key order by prompt_key) from private.prompt_registry_manifest),
  'active release contains the exact current manifest key set'
);
select is((select count(*) from private.prompt_registry_manifest where prompt_key in ('npc_memory.summary','npc_memory.summary.v2')),2::bigint,'v1 and v2 prompt keys coexist');
select is((select contract_hash from private.prompt_registry_manifest where prompt_key='npc_memory.summary.v2'),'f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03','v2 manifest uses the canonical TS contract hash');
select is((select content_hash from private.prompt_revisions where prompt_key='npc_memory.summary.v2' and revision_number=1),'c713a47206e9df5906d8fe01736bfbf386c5b35f215feca213b2896c8f0a4718','v2 prompt body hash is canonical');
select set_config('test.active_release',(select release_id::text from private.prompt_registry_active_release),true);
select set_config('test.prior_release',(select id::text from private.prompt_releases where label='NPC memory summary prompt baseline'),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
select ok(not ((public.prompt_registry_service_resolve(current_setting('test.prior_release')::uuid)->'prompts') ? 'npc_memory.summary.v2'),'historical v1 release legally omits v2');
select ok((public.prompt_registry_service_resolve(current_setting('test.prior_release')::uuid)->'prompts') ? 'npc_memory.summary','historical release retains v1');
select ok((public.prompt_registry_service_resolve(current_setting('test.active_release')::uuid)->'prompts') ? 'npc_memory.summary.v2','active release resolves v2');
reset role;
reset request.jwt.claim.role;
select ok(not has_function_privilege('authenticated','public.world_npc_memory_enqueue_v2_summaries(integer)','EXECUTE'),'v2 backfill is service-only');
select ok(not has_function_privilege('service_role','private.world_npc_memory_summary_dispatch_assert(uuid,uuid,integer)','EXECUTE'),'private dispatch assertion is not a service RPC');
select ok(not has_table_privilege('authenticated','private.world_npc_memory_outbox','SELECT'),'browser role cannot read durable summary jobs');
select ok(to_regprocedure('public.world_npc_memory_summary_record_dispatch_result(uuid,uuid,integer,jsonb)') is null,'result recording is not activated in A1');
select ok(to_regprocedure('public.world_npc_memory_summary_complete_v2(uuid,uuid,text)') is null,'v2 completion is not activated in A1');
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_enqueue_v2_summaries(0)$$,'PT400',null,'v2 backfill lower bound is enforced');
select throws_ok($$select public.world_npc_memory_enqueue_v2_summaries(9)$$,'PT400',null,'v2 backfill upper bound is enforced');
reset role;
reset request.jwt.claim.role;

insert into auth.users(id,email,role,aud) values
 ('19300000-0000-4000-8000-000000000001','summary-v2-jobs@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='19300000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
create temporary table pg_temp.fixture as
select
 (snapshot#>>'{save,id}')::uuid save_id,
 (snapshot->'roster'->0->>'instanceId')::uuid instance_id,
 (snapshot->'roster'->0->>'npcId')::uuid npc_id,
 (snapshot->'roster'->0->>'versionId')::uuid version_id,
 (snapshot#>>'{save,revision}')::bigint revision
from (select public.npc_bar_snapshot() snapshot) x;
insert into private.world_npc_dialogue_turns(
 id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,
 source_revision,day_number,status,lease_until,result,completed_at
)
select
 '19300000-0000-4001-8000-000000000001',save_id,instance_id,npc_id,version_id,
 '19300000-0000-4000-8000-000000000001','Prompt job source',0,revision,1,
 'completed',clock_timestamp()+interval '5 minutes','{"reply":"Pinned source."}',clock_timestamp()
from pg_temp.fixture;
select private.world_npc_memory_project_source('dialogue_turn','19300000-0000-4001-8000-000000000001');
select set_config('test.cutoff',(select ledger_sequence::text from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='19300000-0000-4001-8000-000000000001' and disclosure_class='npc_known'),true);

-- Create two genuinely historical v1 jobs while the prior v1-complete release
-- is active, then restore the v2 release before bounded backfill.
update private.prompt_registry_active_release set release_id=current_setting('test.prior_release')::uuid,updated_at=clock_timestamp() where singleton;
create temporary table pg_temp.legacy_a as
select (private.world_npc_memory_register_summary_set(
 'episode_summary','legacy-a',current_setting('test.cutoff')::bigint,'npc_known',
 '[{"ordinal":0,"sourceKind":"dialogue_turn","sourceId":"19300000-0000-4001-8000-000000000001","sourceVersion":1}]'::jsonb,
 '[{"batchOrdinal":0,"firstLeafOrdinal":0,"lastLeafOrdinal":0,"leafCount":1}]'::jsonb,
 'npc-memory-v1'
)).*;
create temporary table pg_temp.legacy_b as
select (private.world_npc_memory_register_summary_set(
 'episode_summary','legacy-b',current_setting('test.cutoff')::bigint,'npc_known',
 '[{"ordinal":0,"sourceKind":"dialogue_turn","sourceId":"19300000-0000-4001-8000-000000000001","sourceVersion":1}]'::jsonb,
 '[{"batchOrdinal":0,"firstLeafOrdinal":0,"lastLeafOrdinal":0,"leafCount":1}]'::jsonb,
 'npc-memory-v1'
)).*;
select set_config('test.legacy_a',(select id::text from pg_temp.legacy_a),true);
update private.prompt_registry_active_release set release_id=current_setting('test.active_release')::uuid,updated_at=clock_timestamp() where singleton;

select is((select count(*) from private.world_npc_memory_outbox where instance_id=(select instance_id from pg_temp.fixture) and source_kind='memory_set' and processor_version='npc-memory-v1'),2::bigint,'explicit legacy setup creates two v1 jobs');
select ok(not exists(
 select 1 from private.world_npc_memory_outbox
 where instance_id=(select instance_id from pg_temp.fixture) and source_kind='memory_set' and processor_version='npc-memory-v1'
   and (summary_protocol<>'v1' or summary_prompt_key<>'npc_memory.summary')
),'legacy jobs use the exact v1 protocol/key pair');
select ok(not exists(
 select 1 from private.world_npc_memory_outbox
 where instance_id=(select instance_id from pg_temp.fixture) and source_kind='memory_set' and processor_version='npc-memory-v1'
   and prompt_release_id<>current_setting('test.prior_release')::uuid
),'legacy jobs retain their historical release pin');
set local role service_role;
set local request.jwt.claim.role='service_role';
select is(public.world_npc_memory_enqueue_v2_summaries(1),1,'first limit-one pass backfills one old set');
select is(public.world_npc_memory_enqueue_v2_summaries(1),1,'second limit-one pass progresses to the next old set');
select is(public.world_npc_memory_enqueue_v2_summaries(1),0,'third pass reports no insert instead of inflating conflicts');
reset role;
reset request.jwt.claim.role;
select is((select count(*) from private.world_npc_memory_outbox where instance_id=(select instance_id from pg_temp.fixture) and source_kind='memory_set' and processor_version='npc-memory-v1'),2::bigint,'additive backfill never mutates or deletes v1 jobs');
select is((select count(*) from private.world_npc_memory_outbox where instance_id=(select instance_id from pg_temp.fixture) and processor_version='npc-memory-summary-v2'),2::bigint,'bounded backfill adds one v2 job beside each old set');

create temporary table pg_temp.fresh as
select (private.world_npc_memory_register_summary_set(
 'episode_summary','fresh-v2',current_setting('test.cutoff')::bigint,'npc_known',
 '[{"ordinal":0,"sourceKind":"dialogue_turn","sourceId":"19300000-0000-4001-8000-000000000001","sourceVersion":1}]'::jsonb,
 '[{"batchOrdinal":0,"firstLeafOrdinal":0,"lastLeafOrdinal":0,"leafCount":1}]'::jsonb
)).*;
select is((select count(*) from private.world_npc_memory_outbox where source_id=(select id from pg_temp.fresh) and processor_version='npc-memory-summary-v2'),1::bigint,'default fresh registration creates exactly one v2 job');
select is((select count(*) from private.world_npc_memory_outbox where source_id=(select id from pg_temp.fresh) and processor_version='npc-memory-v1'),0::bigint,'default fresh registration creates no v1 job');
select is(
 (select id from private.world_npc_memory_register_summary_set(
  'episode_summary','fresh-v2',current_setting('test.cutoff')::bigint,'npc_known',
  '[{"ordinal":0,"sourceKind":"dialogue_turn","sourceId":"19300000-0000-4001-8000-000000000001","sourceVersion":1}]'::jsonb,
  '[{"batchOrdinal":0,"firstLeafOrdinal":0,"lastLeafOrdinal":0,"leafCount":1}]'::jsonb
 )),
 (select id from pg_temp.fresh),
 'repeated fresh registration reuses the immutable set'
);
select is((select count(*) from private.world_npc_memory_outbox where source_id=(select id from pg_temp.fresh) and processor_version='npc-memory-summary-v2'),1::bigint,'repeated registration does not duplicate v2 work');
select ok(not exists(
 select 1 from private.world_npc_memory_outbox
 where instance_id=(select instance_id from pg_temp.fixture) and processor_version='npc-memory-summary-v2'
   and (summary_protocol<>'v2' or summary_prompt_key<>'npc_memory.summary.v2')
),'all v2 jobs use the exact protocol/key pair');
select throws_ok(
 $$insert into private.world_npc_memory_outbox(
   save_id,instance_id,source_kind,source_id,source_version,source_sequence,source_hash,
   processor_kind,processor_version,summary_protocol,summary_prompt_key
 ) select save_id,instance_id,'memory_set',id,set_version,cutoff_ledger_sequence,set_hash,
   'summary','npc-memory-v1','v2','npc_memory.summary.v2' from pg_temp.fresh$$,
 '23514',null,'illegal processor/protocol/key tuple is rejected');
select throws_ok(
 $$update private.world_npc_memory_outbox set summary_prompt_key='npc_memory.summary.v2'
   where source_kind='memory_set' and processor_version='npc-memory-v1'$$,
 'PT409',null,'durable legacy prompt pin is immutable');

set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.v1_claim as select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
select set_config('test.v1_job',(select claim->>'id' from pg_temp.v1_claim),true);
select set_config('test.v1_fence',(select claim->>'fence' from pg_temp.v1_claim),true);
select set_config('test.v1_load',public.world_npc_memory_summary_load(
 current_setting('test.v1_job')::uuid,current_setting('test.v1_fence')::uuid,0
)::text,true);
select set_config('test.v1_prepare',public.world_npc_memory_summary_prepare_dispatch(
 current_setting('test.v1_job')::uuid,current_setting('test.v1_fence')::uuid,0
)::text,true);
reset role;
reset request.jwt.claim.role;
select ok(current_setting('test.v1_job',true) is not null,'historical v1 work remains claimable');
select is(current_setting('test.v1_load')::jsonb->>'promptKey','npc_memory.summary','v1 loader retains the v1 prompt key');
select is(current_setting('test.v1_prepare')::jsonb->>'state','prepared','historical v1 dispatch preparation remains accepted');
select is(current_setting('test.v1_prepare')::jsonb->>'identityHash',(
 select encode(extensions.digest(private.world_canonical_json(jsonb_build_object(
  'jobId',j.id,'fence',j.fence,'batchOrdinal',0,'sourceHash',j.source_hash,
  'sourceVersion',j.source_version,'processorVersion',j.processor_version,
  'promptReleaseId',j.prompt_release_id
 )),'sha256'),'hex')
 from private.world_npc_memory_outbox j where j.id=current_setting('test.v1_job')::uuid
),'v1 dispatch identity remains byte-compatible with the 092 formula');
set local role service_role;
set local request.jwt.claim.role='service_role';
select is(public.prompt_registry_service_work_release('npc_memory_summary',current_setting('test.v1_job')::uuid)::text,current_setting('test.prior_release'),'v1 work resolves its historical release');
select is(public.prompt_registry_service_work_release('npc_memory_summary_set',current_setting('test.legacy_a')::uuid)::text,current_setting('test.prior_release'),'legacy set resolver branch remains compatible');
reset role;
reset request.jwt.claim.role;

set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.v2_claim as select public.world_npc_memory_claim('summary','npc-memory-summary-v2') claim;
select set_config('test.v2_job',(select claim->>'id' from pg_temp.v2_claim),true);
select set_config('test.v2_fence',(select claim->>'fence' from pg_temp.v2_claim),true);
select set_config('test.v2_load',public.world_npc_memory_summary_load(
 current_setting('test.v2_job')::uuid,current_setting('test.v2_fence')::uuid,0
)::text,true);
select set_config('test.v2_prepare',public.world_npc_memory_summary_prepare_dispatch(
 current_setting('test.v2_job')::uuid,current_setting('test.v2_fence')::uuid,0
)::text,true);
reset role;
reset request.jwt.claim.role;
select ok(current_setting('test.v2_job',true) is not null,'v2 work is claimable through its distinct processor');
select is(current_setting('test.v2_load')::jsonb->>'promptKey','npc_memory.summary.v2','v2 loader returns the pinned v2 key');
select is(current_setting('test.v2_load')::jsonb->>'promptRevisionId',(
 select e.revision_id::text from private.prompt_release_entries e
 where e.release_id=current_setting('test.active_release')::uuid and e.prompt_key='npc_memory.summary.v2'
),'v2 loader returns the matching v2 revision');
set local role service_role;
set local request.jwt.claim.role='service_role';
select is(public.prompt_registry_service_work_release('npc_memory_summary_v2',current_setting('test.v2_job')::uuid)::text,current_setting('test.active_release'),'v2 work resolves its pinned active release');
reset role;
reset request.jwt.claim.role;
select is(current_setting('test.v2_prepare')::jsonb->>'state','prepared','v2 dispatch preparation succeeds');
select is(current_setting('test.v2_prepare')::jsonb->>'identityHash',(
 select encode(extensions.digest(private.world_canonical_json(
  jsonb_build_object(
   'jobId',j.id,'fence',j.fence,'batchOrdinal',0,'sourceHash',j.source_hash,
   'sourceVersion',j.source_version,'processorVersion',j.processor_version,
   'promptReleaseId',j.prompt_release_id
  ) || jsonb_build_object('summaryProtocol',j.summary_protocol,'summaryPromptKey',j.summary_prompt_key)
 ),'sha256'),'hex')
 from private.world_npc_memory_outbox j where j.id=current_setting('test.v2_job')::uuid
),'v2 receipt identity commits to protocol and prompt key');
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
 $$select public.world_npc_memory_summary_load(
   current_setting('test.v2_job')::uuid,extensions.gen_random_uuid(),0
 )$$,'PT409',null,'v2 loader rejects a wrong fence');
select is(public.prompt_registry_service_work_release('dialogue','19300000-0000-4001-8000-000000000001')::text,current_setting('test.active_release'),'unrelated dialogue work-release branch remains intact');
reset role;
reset request.jwt.claim.role;

update private.world_npc_memory_summary_sets
set closure_status='invalidated',invalidated_at=clock_timestamp()
where id=(select source_id from private.world_npc_memory_outbox where id=current_setting('test.v2_job')::uuid);
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
 $$select public.world_npc_memory_summary_load(
   current_setting('test.v2_job')::uuid,current_setting('test.v2_fence')::uuid,0
 )$$,'PT409',null,'invalidated v2 set cannot be loaded');
reset role;
reset request.jwt.claim.role;
delete from private.world_npc_instances where id=(select instance_id from pg_temp.fixture);
select is((select count(*) from private.world_npc_memory_outbox where instance_id=(select instance_id from pg_temp.fixture)),0::bigint,'resident purge cascades v1 and v2 jobs');

select * from finish();
rollback;
