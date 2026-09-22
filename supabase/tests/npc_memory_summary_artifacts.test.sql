begin;
create extension if not exists pgtap with schema extensions;
select plan(41);
select ok(not has_function_privilege('authenticated','public.world_npc_memory_summary_load(uuid,uuid,integer)','EXECUTE'),'authenticated cannot execute the summary loader');

-- A real 65-leaf closed episode gives the loader both its maximum-sized batch
-- and its tail batch. This uses authoritative dialogue sources, rather than
-- constructing leaves directly.
insert into auth.users(id,email,role,aud) values
 ('19000000-0000-4000-8000-000000000001','summary-loader@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19000000-0000-4000-8000-000000000001';
select public.create_tavern(); reset role;
create temporary table pg_temp.fixture as
select (snapshot#>>'{save,id}')::uuid save_id,(snapshot->'roster'->0->>'instanceId')::uuid instance_id,(snapshot->'roster'->0->>'npcId')::uuid npc_id,(snapshot->'roster'->0->>'versionId')::uuid version_id,(snapshot#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() snapshot) x;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select ('19000000-0000-4001-8000-'||lpad(g::text,12,'0'))::uuid,f.save_id,f.instance_id,f.npc_id,f.version_id,'19000000-0000-4000-8000-000000000001','Summary source '||g,g,f.revision,1,'completed',clock_timestamp()+interval '5 minutes',jsonb_build_object('reply','Summary reply '||g),clock_timestamp() from pg_temp.fixture f cross join generate_series(0,64) g;
select private.world_npc_memory_project_source('dialogue_turn',('19000000-0000-4001-8000-'||lpad(g::text,12,'0'))::uuid) from generate_series(0,64) g;
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,observer_instance_id)
select t.id,t.instance_id,'interaction','Meaningful summary source '||t.input_sequence,'Summary reply','npc',2,'{}',t.save_id,extensions.gen_random_uuid(),1,'dialogue_turn',t.id,1,private.world_npc_memory_source_hash('dialogue_turn',t.id),1,t.input_sequence,1,t.input_sequence,'attributed','npc_known',t.instance_id from private.world_npc_dialogue_turns t where t.instance_id=(select instance_id from pg_temp.fixture);
update public.tavern_saves set current_day=2 where id=(select save_id from pg_temp.fixture);
update private.world_npc_memory_outbox set status='completed',completed_at=clock_timestamp(),lease_until=null where instance_id=(select instance_id from pg_temp.fixture) and processor_kind='extract';
select private.world_npc_memory_refresh_watermark((select instance_id from pg_temp.fixture),'extract','npc-memory-v1');
select is((private.world_npc_memory_request_episode((select instance_id from pg_temp.fixture),1,64)).status,'pending','65-source closure is pending');
select is(private.world_npc_memory_schedule_closures((select instance_id from pg_temp.fixture)),1,'65-source closure registers exactly once');
create temporary table pg_temp.summary_set as select * from private.world_npc_memory_summary_sets where instance_id=(select instance_id from pg_temp.fixture) and disclosure_class='npc_known';
select is((select count(*) from pg_temp.summary_set),1::bigint,'one npc-known summary set exists');
select is((select count(*) from private.world_npc_memory_summary_leaves where set_id=(select id from pg_temp.summary_set)),65::bigint,'set preserves all 65 leaves');
select is((select array_agg(jsonb_build_array(first_leaf_ordinal,last_leaf_ordinal) order by batch_ordinal) from private.world_npc_memory_summary_batches where set_id=(select id from pg_temp.summary_set)),array['[0,63]'::jsonb,'[64,64]'::jsonb],'batches are exactly 0..63 and 64');
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,observer_instance_id)
select t.id,t.instance_id,'interaction','Private sentinel','Private sentinel','npc',2,'{}',t.save_id,extensions.gen_random_uuid(),1,'dialogue_turn',t.id,1,private.world_npc_memory_source_hash('dialogue_turn',t.id),1,t.input_sequence,1,t.input_sequence,'attributed','npc_private',t.instance_id from private.world_npc_dialogue_turns t where t.instance_id=(select instance_id from pg_temp.fixture) and t.input_sequence=0;

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim as select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
select set_config('test.summary_job',(select claim->>'id' from pg_temp.claim),true);
select set_config('test.summary_fence',(select claim->>'fence' from pg_temp.claim),true);
select set_config('test.summary_pin',public.prompt_registry_service_work_release('npc_memory_summary',current_setting('test.summary_job')::uuid)::text,true);
select lives_ok($$select public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,current_setting('test.summary_fence')::uuid,0)$$,'service role loads a valid summary batch');
select set_config('test.batch0',public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,current_setting('test.summary_fence')::uuid,0)::text,true);
select set_config('test.batch1',public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,current_setting('test.summary_fence')::uuid,1)::text,true);
reset role; reset request.jwt.claim.role;
select is(jsonb_array_length(current_setting('test.batch0')::jsonb->'leaves'),64,'batch zero loads exactly 64 leaves');
select is((select array_agg((x->>'ordinal')::integer order by (x->>'ordinal')::integer) from jsonb_array_elements(current_setting('test.batch0')::jsonb->'leaves') x),array(select generate_series(0,63)),'batch zero has ordinals 0 through 63');
select is(jsonb_array_length(current_setting('test.batch1')::jsonb->'leaves'),1,'batch one loads exactly one leaf');
select is((current_setting('test.batch1')::jsonb#>>'{leaves,0,ordinal}')::integer,64,'batch one contains ordinal 64');
select is((current_setting('test.batch0')::jsonb#>>'{leaves,0,sourceHash}'),(select source_hash from private.world_npc_memory_summary_leaves where set_id=(select id from pg_temp.summary_set) and ordinal=0),'loader returns the pinned source hash');
select is((select array_agg(x->>'sourceId' order by (x->>'ordinal')::integer) from jsonb_array_elements(current_setting('test.batch0')::jsonb->'leaves') x),(select array_agg(source_id::text order by ordinal) from private.world_npc_memory_summary_leaves where set_id=(select id from pg_temp.summary_set) and ordinal<64),'loader preserves stable source order');
select is((current_setting('test.batch0')::jsonb#>>'{leaves,0,records,0,disclosureClass}'),'npc_known','loader returns only authorized records');
select ok(not exists(select 1 from jsonb_array_elements(current_setting('test.batch0')::jsonb->'leaves') l cross join lateral jsonb_array_elements(l->'records') r where r->>'disclosureClass'<>'npc_known'),'loader never cross-discloses records');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,current_setting('test.summary_fence')::uuid,2)$$,'PT404',null,'unknown batch is rejected');
select throws_ok($$select public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,extensions.gen_random_uuid(),0)$$,'PT409',null,'wrong fence is rejected');
reset role; reset request.jwt.claim.role;
update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second' where id=current_setting('test.summary_job')::uuid;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,current_setting('test.summary_fence')::uuid,0)$$,'PT409',null,'expired lease is rejected');
reset role; reset request.jwt.claim.role;
update private.world_npc_memory_outbox set lease_until=clock_timestamp()+interval '5 minutes' where id=current_setting('test.summary_job')::uuid;
update private.world_npc_memory_summary_sets set closure_status='invalidated',invalidated_at=clock_timestamp() where id=(select id from pg_temp.summary_set);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_summary_load(current_setting('test.summary_job')::uuid,current_setting('test.summary_fence')::uuid,0)$$,'PT409',null,'invalidated set is rejected');
reset role; reset request.jwt.claim.role;

select is((select prompt_release_id::text from private.world_npc_memory_outbox where id=current_setting('test.summary_job')::uuid),current_setting('test.summary_pin'),'summary job pins its release');
select set_config('test.old_dialogue_release',(select id::text from private.prompt_releases where release_number=1),true);
update private.prompt_registry_active_release set release_id=current_setting('test.old_dialogue_release')::uuid,updated_at=clock_timestamp() where singleton;
select is((select prompt_release_id::text from private.world_npc_memory_outbox where id=current_setting('test.summary_job')::uuid),current_setting('test.summary_pin'),'active-release switch cannot rewrite the job pin');
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.prompt_registry_service_resolve(current_setting('test.old_dialogue_release')::uuid)$$,'old release remains resolvable for dialogue');
select ok(not ((public.prompt_registry_service_resolve(current_setting('test.old_dialogue_release')::uuid)->'prompts') ? 'npc_memory.summary'),'old release has no summary prompt');
select ok((public.prompt_registry_service_resolve(current_setting('test.summary_pin')::uuid)->'prompts') ? 'npc_memory.summary','pinned release resolves the summary prompt');
reset role; reset request.jwt.claim.role;
update private.prompt_registry_active_release set release_id=current_setting('test.summary_pin')::uuid,updated_at=clock_timestamp() where singleton;

-- Completion is a separate, immutable proof from loading.  The database owns
-- all identity fields and hashes this canonical, complete manifest itself.
create temporary table pg_temp.completion_set as select (private.world_npc_memory_register_summary_set('episode_summary','completion-proof',64,'npc_known',(select jsonb_agg(jsonb_build_object('ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version) order by ordinal) from private.world_npc_memory_summary_leaves where set_id=(select id from pg_temp.summary_set)),(select jsonb_agg(jsonb_build_object('batchOrdinal',batch_ordinal,'firstLeafOrdinal',first_leaf_ordinal,'lastLeafOrdinal',last_leaf_ordinal,'leafCount',leaf_count) order by batch_ordinal) from private.world_npc_memory_summary_batches where set_id=(select id from pg_temp.summary_set)))).*;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.completion_claim as select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
reset role; reset request.jwt.claim.role;
select set_config('test.completion_artifact',(with source as (select j.*,s.summary_kind,s.disclosure_class,s.set_version,s.set_hash,s.id set_id,e.revision_id from private.world_npc_memory_outbox j join private.world_npc_memory_summary_sets s on s.id=j.source_id join private.prompt_release_entries e on e.release_id=j.prompt_release_id and e.prompt_key='npc_memory.summary' where j.id=(select (claim->>'id')::uuid from pg_temp.completion_claim)), payload as (select source.*,jsonb_build_object('version','npc-memory-summary-v1','mode','model','summary','A bounded model summary.','citations',jsonb_build_array(jsonb_build_object('leafOrdinal',0)),'protectedRefs','[]'::jsonb,'leaves',(select jsonb_agg(jsonb_build_object('ordinal',l.ordinal,'sourceKind',l.source_kind,'sourceId',l.source_id,'sourceVersion',l.source_version,'sourceHash',l.source_hash,'ledgerSequence',l.ledger_sequence) order by l.ordinal) from private.world_npc_memory_summary_leaves l where l.set_id=source.set_id),'batches',(select jsonb_agg(jsonb_build_object('ordinal',b.batch_ordinal,'firstLeafOrdinal',b.first_leaf_ordinal,'lastLeafOrdinal',b.last_leaf_ordinal,'leafCount',b.leaf_count) order by b.batch_ordinal) from private.world_npc_memory_summary_batches b where b.set_id=source.set_id)) content from source) select jsonb_build_array(jsonb_build_object('artifactKind',summary_kind,'sourceKind','memory_set','sourceIds',jsonb_build_array(set_id),'sourceVersions',jsonb_build_array(set_version),'sourceHash',set_hash,'processorVersion',processor_version,'disclosureClass',disclosure_class,'content',content,'contentHash',encode(extensions.digest(private.world_canonical_json(content),'sha256'),'hex'),'promptReleaseId',prompt_release_id,'promptRevisionId',revision_id,'promptKey','npc_memory.summary','contractId','npc-memory-summary-v1','contractHash','2a28c283d9fada5bc5e8b501356b6fc423305fb7cd6e5b1c1e686b038e45745e','model','test-model')) from payload)::text,true);
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.world_npc_memory_complete((select (claim->>'id')::uuid from pg_temp.completion_claim),(select (claim->>'fence')::uuid from pg_temp.completion_claim),current_setting('test.completion_artifact')::jsonb,null)$$,'model summary completion succeeds');
select lives_ok($$select public.world_npc_memory_complete((select (claim->>'id')::uuid from pg_temp.completion_claim),(select (claim->>'fence')::uuid from pg_temp.completion_claim),current_setting('test.completion_artifact')::jsonb,null)$$,'identical lost response is idempotent');
reset role; reset request.jwt.claim.role;
reset role; reset request.jwt.claim.role;
select set_config('test.divergent_completion_artifact',(with changed as (select jsonb_set(current_setting('test.completion_artifact')::jsonb,'{0,content,summary}','"Divergent but valid summary."'::jsonb) payload) select jsonb_set(payload,'{0,contentHash}',to_jsonb(encode(extensions.digest(private.world_canonical_json(payload#>'{0,content}'),'sha256'),'hex')))::text from changed),true);
select set_config('test.tampered_completion_artifact',(with changed as (select jsonb_set(current_setting('test.completion_artifact')::jsonb,'{0,content,leaves,0,sourceHash}','"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'::jsonb) payload) select jsonb_set(payload,'{0,contentHash}',to_jsonb(encode(extensions.digest(private.world_canonical_json(payload#>'{0,content}'),'sha256'),'hex')))::text from changed),true);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_complete((select (claim->>'id')::uuid from pg_temp.completion_claim),(select (claim->>'fence')::uuid from pg_temp.completion_claim),current_setting('test.divergent_completion_artifact')::jsonb,null)$$,'PT409',null,'divergent completed replay is rejected');
select throws_ok($$select public.world_npc_memory_complete((select (claim->>'id')::uuid from pg_temp.completion_claim),(select (claim->>'fence')::uuid from pg_temp.completion_claim),current_setting('test.tampered_completion_artifact')::jsonb,null)$$,'PT400',null,'tampered complete leaf manifest is rejected');
reset role; reset request.jwt.claim.role;
select is((select count(*) from private.world_npc_memory_artifacts where source_ids=array[(select id from pg_temp.completion_set)]),1::bigint,'completion inserts exactly one artifact');
select is((select content_hash from private.world_npc_memory_artifacts where source_ids=array[(select id from pg_temp.completion_set)]),encode(extensions.digest(private.world_canonical_json((current_setting('test.completion_artifact')::jsonb->0)->'content'),'sha256'),'hex'),'artifact uses canonical content hash');
select throws_ok($$update private.world_npc_memory_artifacts set content='{}'::jsonb where source_ids=array[(select id from pg_temp.completion_set)]$$,'PT409',null,'artifact update is denied');
select throws_ok($$delete from private.world_npc_memory_artifacts where source_ids=array[(select id from pg_temp.completion_set)]$$,'PT409',null,'artifact direct delete is denied');

-- A bounded service pass touches one pending request even when an older
-- request is a permanent gap.
insert into private.world_npc_memory_closure_requests(save_id,instance_id,summary_kind,closure_key,closed_day,cutoff_ledger_sequence,status,reason,requested_at,attempted_at)
values ((select save_id from pg_temp.fixture),(select instance_id from pg_temp.fixture),'episode_summary','fairness-gap',99,999,'blocked_gap','extract_gap',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'),
       ((select save_id from pg_temp.fixture),(select instance_id from pg_temp.fixture),'episode_summary','fairness-pending',1,64,'pending','pending',clock_timestamp()-interval '1 hour',null);
set local role service_role; set local request.jwt.claim.role='service_role';
select is(public.world_npc_memory_schedule_closures(1),1,'limit-one pass registers the later eligible pending request');
reset role; reset request.jwt.claim.role;
select is((select status from private.world_npc_memory_closure_requests where instance_id=(select instance_id from pg_temp.fixture) and closure_key='fairness-gap'),'blocked_gap','older gap remains blocked');
select is((select status from private.world_npc_memory_closure_requests where instance_id=(select instance_id from pg_temp.fixture) and closure_key='fairness-pending'),'registered','later pending request is not starved');
select ok((select max(attempts)<=1 from private.world_npc_memory_closure_requests where instance_id=(select instance_id from pg_temp.fixture) and closure_key in ('fairness-gap','fairness-pending')),'bounded pass touches no more than its one-request limit');

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.error_claim as select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
reset role; reset request.jwt.claim.role;
create temporary table pg_temp.error_watermark as select updated_at from private.world_npc_memory_watermarks where instance_id=(select instance_id from pg_temp.fixture) and processor_kind='summary' and processor_version='npc-memory-v1';
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.world_npc_memory_complete((select (claim->>'id')::uuid from pg_temp.error_claim),(select (claim->>'fence')::uuid from pg_temp.error_claim),'[]'::jsonb,'model_unavailable')$$,'summary error completion succeeds');
reset role; reset request.jwt.claim.role;
select is((select status from private.world_npc_memory_outbox where id=(select (claim->>'id')::uuid from pg_temp.error_claim)),'failed','summary error completion marks the job failed');
select ok((select updated_at >= (select updated_at from pg_temp.error_watermark) from private.world_npc_memory_watermarks where instance_id=(select instance_id from pg_temp.fixture) and processor_kind='summary' and processor_version='npc-memory-v1'),'summary error completion refreshes watermark');

-- Resident purge is the sole deletion path for an accepted artifact.
delete from private.world_npc_instances where id=(select instance_id from pg_temp.fixture);
select is((select count(*) from private.world_npc_memory_artifacts where source_ids=array[(select id from pg_temp.completion_set)]),0::bigint,'resident purge cascades a completed summary artifact');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_complete((select (claim->>'id')::uuid from pg_temp.completion_claim),(select (claim->>'fence')::uuid from pg_temp.completion_claim),current_setting('test.completion_artifact')::jsonb,null)$$,'PT409',null,'purged completed work cannot be resurrected');
reset role; reset request.jwt.claim.role;

select * from finish();
rollback;
