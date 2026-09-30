begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select has_function('public','world_npc_memory_summary_record_dispatch_result',array['uuid','uuid','integer','jsonb','text','text'],'v2 receipt RPC exists');
select ok(not has_function_privilege('authenticated','public.world_npc_memory_summary_record_dispatch_result(uuid,uuid,integer,jsonb,text,text)','EXECUTE'),'authenticated cannot record provider results');
select ok(not has_table_privilege('authenticated','private.world_npc_memory_summary_dispatches','SELECT'),'authenticated cannot read receipts');

-- Source-backed, byte-exact Unicode evidence for every receipt in this fixture.
insert into auth.users(id,email,role,aud) values ('19400000-0000-4000-8000-000000000001','summary-v2-results@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19400000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
create temporary table pg_temp.fixture as
select (snapshot#>>'{save,id}')::uuid save_id,(snapshot->'roster'->0->>'instanceId')::uuid instance_id,
 (snapshot->'roster'->0->>'npcId')::uuid npc_id,(snapshot->'roster'->0->>'versionId')::uuid version_id,(snapshot#>>'{save,revision}')::bigint revision
from (select public.npc_bar_snapshot() snapshot) x;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '19400000-0000-4001-8000-000000000001',save_id,instance_id,npc_id,version_id,'19400000-0000-4000-8000-000000000001','Unicode result evidence',0,revision,1,'completed',clock_timestamp()+interval '5 minutes',jsonb_build_object('reply','Cafe'||chr(769)||' 中文 العربية 🦉'),clock_timestamp() from pg_temp.fixture;
select private.world_npc_memory_project_source('dialogue_turn','19400000-0000-4001-8000-000000000001');
insert into private.world_npc_memories(id,turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,observer_instance_id)
select '19400000-0000-4002-8000-000000000001','19400000-0000-4001-8000-000000000001',instance_id,'interaction','Exact: Cafe'||chr(769)||' 中文 العربية 🦉','Cafe'||chr(769)||' 中文 العربية 🦉','npc',3,'{}',save_id,'19400000-0000-4003-8000-000000000001',1,'dialogue_turn','19400000-0000-4001-8000-000000000001',1,private.world_npc_memory_source_hash('dialogue_turn','19400000-0000-4001-8000-000000000001'),1,0,1,0,'attributed','npc_known',instance_id from pg_temp.fixture;

create function pg_temp.new_set(p_key text,p_processor text default null) returns uuid language plpgsql as $f$
declare v_set uuid;
begin
 select id into v_set from private.world_npc_memory_register_summary_set('episode_summary',p_key,
  (select ledger_sequence from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='19400000-0000-4001-8000-000000000001' and disclosure_class='npc_known'),'npc_known',
  jsonb_build_array(jsonb_build_object('ordinal',0,'sourceKind','dialogue_turn','sourceId','19400000-0000-4001-8000-000000000001'::uuid,'sourceVersion',1)),
  jsonb_build_array(jsonb_build_object('batchOrdinal',0,'firstLeafOrdinal',0,'lastLeafOrdinal',0,'leafCount',1)),coalesce(p_processor,'npc-memory-summary-v2'));
 return v_set;
end $f$;
select set_config('test.primary_set',pg_temp.new_set('received-primary')::text,true);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.primary_claim as select public.world_npc_memory_claim('summary','npc-memory-summary-v2') claim;
reset role;
select set_config('test.job',(select claim->>'id' from pg_temp.primary_claim),true);
select set_config('test.fence',(select claim->>'fence' from pg_temp.primary_claim),true);
select set_config('test.leaves',(select jsonb_agg(jsonb_build_object('ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence) order by ordinal)::text from private.world_npc_memory_summary_leaves where set_id=current_setting('test.primary_set')::uuid),true);
select set_config('test.citation',(select jsonb_build_object('leafOrdinal',0,'recordId',id,'speaker',speaker,'quote',quote,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash)::text from private.world_npc_memories where id='19400000-0000-4002-8000-000000000001'),true);
select set_config('test.result',jsonb_build_object('version','npc-memory-summary-v2','mode','model','summary','Exact multilingual evidence.','citations',jsonb_build_array(current_setting('test.citation')::jsonb),'protectedRefs',current_setting('test.leaves')::jsonb,'leaves',current_setting('test.leaves')::jsonb)::text,true);

set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.world_npc_memory_summary_prepare_dispatch(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0)$$,'v2 receipt prepares');
select lives_ok($$select public.world_npc_memory_summary_mark_dispatched(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,'provider-primary')$$,'v2 receipt marks dispatched');
select is(public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,current_setting('test.result')::jsonb,'gpt-test','provider-primary')->>'status','received','valid v2 result is received');
reset role;
select is((select state from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),'received','received state persists');
select is((select result_hash from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),encode(extensions.digest(private.world_canonical_json(current_setting('test.result')::jsonb),'sha256'),'hex'),'canonical result hash persists');
select is((select model from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),'gpt-test','model provenance persists');
select is((select provider_request_id from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),'provider-primary','provider request provenance persists');
select ok((select result_recorded_at is not null from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),'receipt timestamp persists');
set local role service_role; set local request.jwt.claim.role='service_role';
select is(public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,current_setting('test.result')::jsonb,'gpt-test','provider-primary')->>'status','reused','exact result replay is reused');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{summary}','"different"'),'gpt-test','provider-primary')$$,'PT409',null,'divergent result replay conflicts');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,current_setting('test.result')::jsonb,'other-model','provider-primary')$$,'PT409',null,'divergent model replay conflicts');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,current_setting('test.result')::jsonb,'gpt-test','other-provider')$$,'PT409',null,'divergent provider replay conflicts');
select is(public.world_npc_memory_summary_recover_dispatch(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0)->>'directive','reuse_result','same-fence received recovery reuses the result');
reset role;

-- Invalid v2 evidence is rejected before the receipt can be replayed.
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{citations}','{}'),'gpt-test','provider-primary')$$,'PT400',null,'malformed citations fail closed');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{protectedRefs}','[]'),'gpt-test','provider-primary')$$,'PT400',null,'protected refs must be exact');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{leaves}','[]'),'gpt-test','provider-primary')$$,'PT400',null,'leaves must be exact');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{citations,0,quote}','"fabricated"'),'gpt-test','provider-primary')$$,'PT400',null,'fabricated quote fails');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{citations,0,quote}',to_jsonb('Café 中文 العربية 🦉'::text)),'gpt-test','provider-primary')$$,'PT400',null,'Unicode-normalized quote is not exact');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{citations,0,speaker}','"keeper"'),'gpt-test','provider-primary')$$,'PT400',null,'wrong speaker fails');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{citations,0,sourceId}',to_jsonb(extensions.gen_random_uuid()::text)),'gpt-test','provider-primary')$$,'PT400',null,'wrong source fails');
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,jsonb_set(current_setting('test.result')::jsonb,'{citations}',jsonb_build_array(current_setting('test.citation')::jsonb,current_setting('test.citation')::jsonb)),'gpt-test','provider-primary')$$,'PT400',null,'noncanonical citation order fails');
reset role;

update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second' where id=current_setting('test.job')::uuid;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.reclaimed as select public.world_npc_memory_claim('summary','npc-memory-summary-v2') claim;
reset role;
select set_config('test.new_fence',(select claim->>'fence' from pg_temp.reclaimed),true);
select isnt(current_setting('test.new_fence'),current_setting('test.fence'),'reclaim gets a new job fence');
set local role service_role; set local request.jwt.claim.role='service_role';
select is(public.world_npc_memory_summary_recover_dispatch(current_setting('test.job')::uuid,current_setting('test.new_fence')::uuid,0)->>'directive','reuse_result','new fence reuses received result');
reset role;
select is((select fence::text from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),current_setting('test.fence'),'received receipt retains original fence');

-- Non-received receipt shapes cannot be dispatched after recovery.
select set_config('test.prepared_set',pg_temp.new_set('received-prepared')::text,true);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.prepared_claim as select public.world_npc_memory_claim('summary','npc-memory-summary-v2') claim;
select set_config('test.prepared_job',(select claim->>'id' from pg_temp.prepared_claim),true); select set_config('test.prepared_fence',(select claim->>'fence' from pg_temp.prepared_claim),true);
select public.world_npc_memory_summary_prepare_dispatch(current_setting('test.prepared_job')::uuid,current_setting('test.prepared_fence')::uuid,0);
select is(public.world_npc_memory_summary_recover_dispatch(current_setting('test.prepared_job')::uuid,current_setting('test.prepared_fence')::uuid,0)->>'directive','fallback_only','prepared receipt recovers fallback only');
select throws_ok($$select public.world_npc_memory_summary_mark_dispatched(current_setting('test.prepared_job')::uuid,current_setting('test.prepared_fence')::uuid,0,null)$$,'PT409',null,'recovered prepared receipt cannot redispatch');
reset role;
select set_config('test.dispatched_set',pg_temp.new_set('received-dispatched')::text,true);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.dispatched_claim as select public.world_npc_memory_claim('summary','npc-memory-summary-v2') claim;
select set_config('test.dispatched_job',(select claim->>'id' from pg_temp.dispatched_claim),true); select set_config('test.dispatched_fence',(select claim->>'fence' from pg_temp.dispatched_claim),true);
select public.world_npc_memory_summary_prepare_dispatch(current_setting('test.dispatched_job')::uuid,current_setting('test.dispatched_fence')::uuid,0);
select public.world_npc_memory_summary_mark_dispatched(current_setting('test.dispatched_job')::uuid,current_setting('test.dispatched_fence')::uuid,0,'provider-dispatched');
select is(public.world_npc_memory_summary_recover_dispatch(current_setting('test.dispatched_job')::uuid,current_setting('test.dispatched_fence')::uuid,0)->>'directive','fallback_only','dispatched receipt recovers fallback only');
select throws_ok($$select public.world_npc_memory_summary_mark_dispatched(current_setting('test.dispatched_job')::uuid,current_setting('test.dispatched_fence')::uuid,0,null)$$,'PT409',null,'recovered dispatched receipt cannot redispatch');
reset role;
select set_config('test.missing_set',pg_temp.new_set('received-missing')::text,true);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.missing_claim as select public.world_npc_memory_claim('summary','npc-memory-summary-v2') claim;
select set_config('test.missing_job',(select claim->>'id' from pg_temp.missing_claim),true); select set_config('test.missing_fence',(select claim->>'fence' from pg_temp.missing_claim),true);
select is(public.world_npc_memory_summary_recover_dispatch(current_setting('test.missing_job')::uuid,current_setting('test.missing_fence')::uuid,0)->>'directive','fallback_only','missing receipt recovers fallback only');
select throws_ok($$select public.world_npc_memory_summary_mark_dispatched(current_setting('test.missing_job')::uuid,current_setting('test.missing_fence')::uuid,0,null)$$,'PT409',null,'missing receipt cannot dispatch without prepare');
reset role;

set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,current_setting('test.result')::jsonb,'gpt-test','provider-primary')$$,'PT409',null,'stale fence cannot record');
reset role;
select set_config('test.v1_set',pg_temp.new_set('received-v1','npc-memory-v1')::text,true);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.v1_claim as select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result((select (claim->>'id')::uuid from pg_temp.v1_claim),(select (claim->>'fence')::uuid from pg_temp.v1_claim),0,current_setting('test.result')::jsonb,'gpt-test',null)$$,'PT400',null,'v1 job cannot record v2 receipt');
reset role;
update private.world_npc_memory_summary_sets set closure_status='invalidated',invalidated_at=clock_timestamp() where id=current_setting('test.primary_set')::uuid;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_summary_recover_dispatch(current_setting('test.job')::uuid,current_setting('test.new_fence')::uuid,0)$$,'PT409',null,'invalidated set cannot reuse late result');
reset role;
select throws_ok($$update private.world_npc_memory_summary_dispatches set model='tampered' where job_id=current_setting('test.job')::uuid$$,'PT409',null,'direct receipt mutation is rejected');
delete from private.world_npc_instances where id=(select instance_id from pg_temp.fixture);
select is((select count(*) from private.world_npc_memory_summary_dispatches),0::bigint,'resident purge removes receipts');
set local role authenticated; set local request.jwt.claim.role='authenticated';
select throws_ok($$select public.world_npc_memory_summary_record_dispatch_result(extensions.gen_random_uuid(),extensions.gen_random_uuid(),0,'{}'::jsonb,'x',null)$$,'42501',null,'authenticated receipt recording is denied');
reset role;

select * from finish();
rollback;
