begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
insert into auth.users(id,email,role,aud) values ('19900000-0000-4000-8000-000000000001','embedding-runtime@test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19900000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.f as select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,(x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id,(x#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() x) q;
grant select on pg_temp.f to service_role;
reset role;
insert into private.world_npc_memory_embedding_profiles(id,processor_version,model,dimensions) values
 ('19900000-0000-4000-8000-000000000101','npc-embedding-runtime-v3','runtime-model',3),
 ('19900000-0000-4000-8000-000000000102','npc-embedding-runtime-v4','runtime-model-v4',2);
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.world_npc_memory_embedding_profile_activate('19900000-0000-4000-8000-000000000101')$$,'service activates the runtime profile');
reset role;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '19900000-0000-4001-8000-000000000001',save_id,instance_id,npc_id,version_id,'19900000-0000-4000-8000-000000000001','Canonical source for embedding',0,revision,1,'completed',clock_timestamp(),'{"reply":"Canonical reply"}',clock_timestamp() from pg_temp.f;
select private.world_npc_memory_register_source('dialogue_turn','19900000-0000-4001-8000-000000000001');
select is((select count(*) from private.world_npc_memory_outbox where source_id='19900000-0000-4001-8000-000000000001' and processor_kind='embedding' and processor_version='npc-embedding-runtime-v3'),0::bigint,'new authoritative source performs no provider work in its gameplay transaction');
set local role authenticated; set local request.jwt.claim.role='authenticated';
select throws_ok($$select public.world_npc_memory_embedding_schedule(1)$$,'42501',null,'embedding scheduler is service-only');
reset role;
set local role service_role; set local request.jwt.claim.role='service_role';
select is((select public.world_npc_memory_embedding_schedule(32)->>'scheduled'),'1','bounded service scheduler enqueues the new authoritative source');
create temporary table pg_temp.claim as select public.world_npc_memory_claim('embedding','npc-embedding-runtime-v3') claim;
select is((select claim->>'sourceId' from pg_temp.claim),'19900000-0000-4001-8000-000000000001','claim is bound to the registered source');
create temporary table pg_temp.plan as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.claim;
grant select on pg_temp.plan to service_role;
select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.claim;
select public.world_npc_memory_embedding_mark_dispatched((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.claim;
select is((select plan->'profile'->>'id' from pg_temp.plan),'19900000-0000-4000-8000-000000000101','plan pins the active immutable profile');
select ok((select plan->>'inputHash' ~ '^[0-9a-f]{64}$' and plan->'input'->'envelope' is not null from pg_temp.plan),'plan has deterministic canonical source input and hash');
select is((select plan::text from pg_temp.plan),(select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid)::text from pg_temp.claim),'plan is byte-for-byte deterministic under the live fence');
select throws_ok(format('select public.world_npc_memory_embedding_plan(%L,%L)',(select claim->>'id' from pg_temp.claim),'19900000-0000-4000-8000-000000000099'),'PT409',null,'wrong fence cannot load embedding input');
select is((select public.world_npc_memory_embedding_accept((claim->>'id')::uuid,(claim->>'fence')::uuid,'19900000-0000-4000-8000-000000000101',plan->>'inputHash','runtime-model',3,'[1,0,0]'::extensions.vector,'request-1','{"promptTokens":4,"totalTokens":4}'::jsonb)->>'status' from pg_temp.claim cross join pg_temp.plan),'completed','dedicated completion accepts exactly one valid profile-bound vector');
reset role;
select ok((select a.embedding_profile_id='19900000-0000-4000-8000-000000000101'::uuid and a.model='runtime-model' and a.embedding_dimensions=3 and a.content->>'inputHash'=p.plan->>'inputHash' from private.world_npc_memory_artifacts a cross join pg_temp.plan p where a.artifact_kind='embedding' and a.processor_version='npc-embedding-runtime-v3'),'accepted artifact retains exact profile and plan provenance');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((select public.world_npc_memory_embedding_accept((claim->>'id')::uuid,(claim->>'fence')::uuid,'19900000-0000-4000-8000-000000000101',plan->>'inputHash','runtime-model',3,'[1,0,0]'::extensions.vector,'request-1','{"promptTokens":4,"totalTokens":4}'::jsonb)->>'status' from pg_temp.claim cross join pg_temp.plan),'reused','lost-response replay reuses the one immutable artifact');
select lives_ok($$select public.world_npc_memory_embedding_profile_activate('19900000-0000-4000-8000-000000000102')$$,'profile can switch after an accepted embedding');
select is((select public.world_npc_memory_embedding_accept((claim->>'id')::uuid,(claim->>'fence')::uuid,'19900000-0000-4000-8000-000000000101',plan->>'inputHash','runtime-model',3,'[1,0,0]'::extensions.vector,'request-1','{"promptTokens":4,"totalTokens":4}'::jsonb)->>'status' from pg_temp.claim cross join pg_temp.plan),'reused','completed replay remains exact after its profile is inactive');
select public.world_npc_memory_embedding_profile_activate('19900000-0000-4000-8000-000000000101');
reset role;
select is((select count(*) from private.world_npc_memory_artifacts where source_ids=array['19900000-0000-4001-8000-000000000001'::uuid] and artifact_kind='embedding' and processor_version='npc-embedding-runtime-v3'),1::bigint,'replay creates no duplicate embedding artifact');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_accept(%L,%L,%L,%L,%L,3,%L::extensions.vector,%L,%L::jsonb)',(select claim->>'id' from pg_temp.claim),(select claim->>'fence' from pg_temp.claim),'19900000-0000-4000-8000-000000000101',(select plan->>'inputHash' from pg_temp.plan),'runtime-model','[0,1,0]','request-1','{"promptTokens":4,"totalTokens":4}'),'PT409',null,'divergent replay cannot replace an accepted vector');
reset role;

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '19900000-0000-4001-8000-000000000002',save_id,instance_id,npc_id,version_id,'19900000-0000-4000-8000-000000000001','Failure source',1,revision,1,'completed',clock_timestamp(),'{}',clock_timestamp() from pg_temp.f;
select private.world_npc_memory_register_source('dialogue_turn','19900000-0000-4001-8000-000000000002');
create temporary table pg_temp.generic_payload as select jsonb_build_array(jsonb_build_object('artifactKind','embedding','sourceKind','dialogue_turn','disclosureClass','npc_known','model','runtime-model','content','{}'::jsonb,'contentHash',encode(extensions.digest(private.world_canonical_json('{}'::jsonb),'sha256'),'hex'),'embedding','[1,0,0]','embeddingDimensions',3)) payload;
grant select on pg_temp.generic_payload to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select public.world_npc_memory_embedding_schedule(1);
create temporary table pg_temp.failure_claim as select public.world_npc_memory_claim('embedding','npc-embedding-runtime-v3') claim;
select is((select claim->>'sourceId' from pg_temp.failure_claim),'19900000-0000-4001-8000-000000000002','failure claim belongs to its registered fixture source');
create temporary table pg_temp.failure_plan as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.failure_claim;
select throws_ok(format('select public.world_npc_memory_complete(%L,%L,%L::jsonb,null)',(select claim->>'id' from pg_temp.failure_claim),(select claim->>'fence' from pg_temp.failure_claim),(select payload::text from pg_temp.generic_payload)),'PT409','Embedding work requires receipt-gated completion','generic completion cannot bypass the receipt-gated embedding path');
select is((select public.world_npc_memory_embedding_accept((claim->>'id')::uuid,(claim->>'fence')::uuid,'19900000-0000-4000-8000-000000000101',plan->>'inputHash',null,null,null,null,'{}'::jsonb,'provider_timeout')->>'status' from pg_temp.failure_claim cross join pg_temp.failure_plan),'failed','provider failure is durable without an artifact');
reset role;
select ok(not exists(select 1 from private.world_npc_memory_artifacts where source_ids=array['19900000-0000-4001-8000-000000000002'::uuid]) and exists(select 1 from private.world_npc_memory_outbox where source_id='19900000-0000-4001-8000-000000000002' and status='failed' and error_code='provider_timeout'),'failed work stores only a safe code and leaves no artifact');
select is((select gap_sequence from private.world_npc_memory_watermarks where instance_id=(select instance_id from pg_temp.f) and processor_kind='embedding' and processor_version='npc-embedding-runtime-v3'),1::bigint,'failed embedding work remains visible as a watermark gap');

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select id,save_id,instance_id,npc_id,version_id,'19900000-0000-4000-8000-000000000001',message,seq,revision,1,'completed',clock_timestamp(),'{}',clock_timestamp() from pg_temp.f cross join (values
 ('19900000-0000-4001-8000-000000000003'::uuid,'Mutable source',2),('19900000-0000-4001-8000-000000000004'::uuid,'Lease source',3)
) q(id,message,seq);
select private.world_npc_memory_register_source('dialogue_turn',id) from (values ('19900000-0000-4001-8000-000000000003'::uuid),('19900000-0000-4001-8000-000000000004'::uuid)) q(id) order by id;
set local role service_role; set local request.jwt.claim.role='service_role'; select public.world_npc_memory_embedding_schedule(2);
create temporary table pg_temp.mut_claim as select public.world_npc_memory_claim('embedding','npc-embedding-runtime-v3') claim;
select is((select claim->>'sourceId' from pg_temp.mut_claim),'19900000-0000-4001-8000-000000000003','mutation claim belongs to its registered fixture source');
create temporary table pg_temp.mut_plan as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.mut_claim;
reset role; update private.world_npc_dialogue_turns set message='Mutated after plan' where id='19900000-0000-4001-8000-000000000003';
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_accept(%L,%L,%L,%L,null,null,null,null,%L::jsonb,%L)',(select claim->>'id' from pg_temp.mut_claim),(select claim->>'fence' from pg_temp.mut_claim),'19900000-0000-4000-8000-000000000101',(select plan->>'inputHash' from pg_temp.mut_plan),'{}','provider_timeout'),'PT409',null,'raw authoritative source mutation rejects late completion before terminal update');
reset role; select ok(not exists(select 1 from private.world_npc_memory_artifacts where source_ids=array['19900000-0000-4001-8000-000000000003'::uuid]) and exists(select 1 from private.world_npc_memory_outbox where source_id='19900000-0000-4001-8000-000000000003' and status='processing'),'source mutation creates no artifact and leaves job nonterminal');
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.lease_claim as select public.world_npc_memory_claim('embedding','npc-embedding-runtime-v3') claim;
select is((select claim->>'sourceId' from pg_temp.lease_claim),'19900000-0000-4001-8000-000000000004','lease claim belongs to its registered fixture source');
create temporary table pg_temp.lease_plan as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.lease_claim;
reset role; update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second' where id=(select (claim->>'id')::uuid from pg_temp.lease_claim);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_accept(%L,%L,%L,%L,null,null,null,null,%L::jsonb,%L)',(select claim->>'id' from pg_temp.lease_claim),(select claim->>'fence' from pg_temp.lease_claim),'19900000-0000-4000-8000-000000000101',(select plan->>'inputHash' from pg_temp.lease_plan),'{}','provider_timeout'),'PT409',null,'expired lease rejects late embedding completion');
create temporary table pg_temp.expired_retry_claim as select public.world_npc_memory_claim('embedding','npc-embedding-runtime-v3') claim;
select is((select claim->>'sourceId' from pg_temp.expired_retry_claim),'19900000-0000-4001-8000-000000000004','expired lease reclaim belongs to its fixture source');
create temporary table pg_temp.expired_retry_plan as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.expired_retry_claim;
create temporary table pg_temp.expired_retry_result as select public.world_npc_memory_embedding_accept((claim->>'id')::uuid,(claim->>'fence')::uuid,'19900000-0000-4000-8000-000000000101',plan->>'inputHash',null,null,null,null,'{}'::jsonb,'provider_timeout') result from pg_temp.expired_retry_claim cross join pg_temp.expired_retry_plan;
reset role;
select ok((select result->>'status'='failed' and not exists(select 1 from private.world_npc_memory_artifacts where source_ids=array['19900000-0000-4001-8000-000000000004'::uuid]) from pg_temp.expired_retry_result),'reclaimed expired work can fail without creating an artifact');
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '19900000-0000-4001-8000-000000000005',save_id,instance_id,npc_id,version_id,'19900000-0000-4000-8000-000000000001','Profile switch source',4,revision,1,'completed',clock_timestamp(),'{}',clock_timestamp() from pg_temp.f;
select private.world_npc_memory_register_source('dialogue_turn','19900000-0000-4001-8000-000000000005');
set local role service_role; set local request.jwt.claim.role='service_role'; select public.world_npc_memory_embedding_schedule(1);
create temporary table pg_temp.switch_claim as select public.world_npc_memory_claim('embedding','npc-embedding-runtime-v3') claim;
select is((select claim->>'sourceId' from pg_temp.switch_claim),'19900000-0000-4001-8000-000000000005','profile-switch claim belongs to its registered fixture source');
create temporary table pg_temp.switch_plan as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.switch_claim;
select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.switch_claim;
select public.world_npc_memory_embedding_mark_dispatched((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.switch_claim;
select throws_ok(format('select public.world_npc_memory_embedding_accept(%L,%L,%L,%L,%L,3,%L::extensions.vector,%L,%L::jsonb)',(select claim->>'id' from pg_temp.switch_claim),(select claim->>'fence' from pg_temp.switch_claim),'19900000-0000-4000-8000-000000000101',(select plan->>'inputHash' from pg_temp.switch_plan),'runtime-model','[1,0,0]','request-switch','{"promptTokens":1,"totalTokens":1,"note":"prose"}'),'PT400',null,'provider usage rejects extra prose keys');
select throws_ok(format('select public.world_npc_memory_embedding_accept(%L,%L,%L,%L,null,null,null,null,%L::jsonb,%L)',(select claim->>'id' from pg_temp.switch_claim),(select claim->>'fence' from pg_temp.switch_claim),'19900000-0000-4000-8000-000000000101',(select plan->>'inputHash' from pg_temp.switch_plan),'{}','unknown_failure'),'PT409',null,'embedding failure rejects unknown error codes');
select public.world_npc_memory_embedding_profile_activate('19900000-0000-4000-8000-000000000102');
select throws_ok(format('select public.world_npc_memory_embedding_accept(%L,%L,%L,%L,%L,3,%L::extensions.vector,%L,%L::jsonb)',(select claim->>'id' from pg_temp.switch_claim),(select claim->>'fence' from pg_temp.switch_claim),'19900000-0000-4000-8000-000000000101',(select plan->>'inputHash' from pg_temp.switch_plan),'runtime-model','[1,0,0]','request-switch','{"promptTokens":1,"totalTokens":1}'),'PT409',null,'in-flight completion is rejected after its active profile switches');
reset role;
select ok(not exists(select 1 from private.world_npc_memory_artifacts where source_ids=array[(select (claim->>'sourceId')::uuid from pg_temp.switch_claim)]) and exists(select 1 from private.world_npc_memory_outbox where id=(select (claim->>'id')::uuid from pg_temp.switch_claim) and status='processing'),'profile-switch rejection creates no artifact and leaves the job nonterminal');
set local role service_role; set local request.jwt.claim.role='service_role'; select public.world_npc_memory_embedding_profile_activate('19900000-0000-4000-8000-000000000101');
reset role;
select * from finish(); rollback;
