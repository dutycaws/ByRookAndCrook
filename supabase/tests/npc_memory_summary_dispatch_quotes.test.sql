begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

select has_function('public','world_npc_memory_summary_prepare_dispatch',array['uuid','uuid','integer'],'prepare-dispatch RPC exists');
select has_function('public','world_npc_memory_summary_mark_dispatched',array['uuid','uuid','integer','text'],'mark-dispatched RPC exists');
select has_function('public','world_npc_memory_summary_recover_dispatch',array['uuid','uuid','integer'],'recovery RPC exists');
select ok(not has_function_privilege('authenticated','public.world_npc_memory_summary_prepare_dispatch(uuid,uuid,integer)','EXECUTE'),'authenticated cannot prepare provider dispatch');
select ok(not has_table_privilege('authenticated','private.world_npc_memory_summary_dispatches','SELECT'),'authenticated cannot read durable dispatch receipts');
select ok(not has_table_privilege('service_role','private.world_npc_memory_summary_dispatches','SELECT'),'service role cannot bypass receipt RPCs');

-- Build one authoritative Unicode-bearing source and a genuine v1 summary job.
insert into auth.users(id,email,role,aud) values
 ('19200000-0000-4000-8000-000000000001','summary-dispatch@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='19200000-0000-4000-8000-000000000001';
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
  '19200000-0000-4001-8000-000000000001',save_id,instance_id,npc_id,version_id,
  '19200000-0000-4000-8000-000000000001','Unicode evidence',0,revision,1,
  'completed',clock_timestamp()+interval '5 minutes',
  jsonb_build_object('reply','Cafe'||chr(769)||' 中文 العربية 🦉'),clock_timestamp()
from pg_temp.fixture;

select private.world_npc_memory_project_source(
  'dialogue_turn','19200000-0000-4001-8000-000000000001'
);

insert into private.world_npc_memories(
  id,turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,
  record_root_id,record_version,source_kind,source_id,source_version,source_hash,
  occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,
  disclosure_class,observer_instance_id
)
select
  '19200000-0000-4002-8000-000000000001',
  '19200000-0000-4001-8000-000000000001',instance_id,'interaction',
  'Exact: Cafe'||chr(769)||' 中文 العربية 🦉','Cafe'||chr(769)||' 中文 العربية 🦉',
  'npc',3,'{}',save_id,'19200000-0000-4003-8000-000000000001',1,
  'dialogue_turn','19200000-0000-4001-8000-000000000001',1,
  private.world_npc_memory_source_hash('dialogue_turn','19200000-0000-4001-8000-000000000001'),
  1,0,1,0,'attributed','npc_known',instance_id
from pg_temp.fixture;

-- Same source tuple, wrong disclosure lane: it must never validate for this set.
insert into private.world_npc_memories(
  id,turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,
  record_root_id,record_version,source_kind,source_id,source_version,source_hash,
  occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,
  disclosure_class,observer_instance_id
)
select
  '19200000-0000-4002-8000-000000000002',
  '19200000-0000-4001-8000-000000000001',instance_id,'interaction',
  'Private exact text','Private exact text','npc',3,'{}',save_id,
  '19200000-0000-4003-8000-000000000002',1,
  'dialogue_turn','19200000-0000-4001-8000-000000000001',1,
  private.world_npc_memory_source_hash('dialogue_turn','19200000-0000-4001-8000-000000000001'),
  1,0,1,0,'attributed','npc_private',instance_id
from pg_temp.fixture;

create temporary table pg_temp.summary_set as
select (private.world_npc_memory_register_summary_set(
  'episode_summary','dispatch-receipt-primary',
  (select ledger_sequence from private.world_npc_memory_sources
   where source_kind='dialogue_turn'
     and source_id='19200000-0000-4001-8000-000000000001'
     and disclosure_class='npc_known'),
  'npc_known',
  jsonb_build_array(jsonb_build_object(
    'ordinal',0,'sourceKind','dialogue_turn',
    'sourceId','19200000-0000-4001-8000-000000000001'::uuid,
    'sourceVersion',1
  )),
  jsonb_build_array(jsonb_build_object(
    'batchOrdinal',0,'firstLeafOrdinal',0,'lastLeafOrdinal',0,'leafCount',1
  ))
)).*;

set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim as
select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
reset role;
reset request.jwt.claim.role;
select set_config('test.job',(select claim->>'id' from pg_temp.claim),true);
select set_config('test.fence',(select claim->>'fence' from pg_temp.claim),true);

set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
  $$select public.world_npc_memory_summary_mark_dispatched(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,null
  )$$,'PT409',null,'mark requires a prepared receipt');
select set_config('test.prepared',public.world_npc_memory_summary_prepare_dispatch(
  current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0
)::text,true);
reset role;
reset request.jwt.claim.role;

select is(current_setting('test.prepared')::jsonb->>'state','prepared','prepare creates a prepared receipt');
set local role service_role;
set local request.jwt.claim.role='service_role';
select is(
  public.world_npc_memory_summary_prepare_dispatch(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0
  )->>'idempotencyKey',
  current_setting('test.prepared')::jsonb->>'idempotencyKey',
  'exact prepare replay returns the stable idempotency key'
);
reset role;
reset request.jwt.claim.role;
select is((select count(*) from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),1::bigint,'prepare replay keeps one receipt');
select throws_ok(
  $$update private.world_npc_memory_summary_dispatches set request_hash=repeat('a',64)
    where job_id=current_setting('test.job')::uuid$$,
  'PT409',null,'direct receipt update is denied');
select throws_ok(
  $$delete from private.world_npc_memory_summary_dispatches
    where job_id=current_setting('test.job')::uuid$$,
  'PT409',null,'direct receipt delete is denied');
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
  $$select public.world_npc_memory_summary_prepare_dispatch(
    current_setting('test.job')::uuid,extensions.gen_random_uuid(),0
  )$$,'PT409',null,'prepare rejects a wrong fence');
select lives_ok(
  $$select public.world_npc_memory_summary_mark_dispatched(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,'provider-request-1'
  )$$,'prepared receipt can be marked dispatched');
reset role;
reset request.jwt.claim.role;
select is((select state from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),'dispatched','mark persists the dispatched state');
set local role service_role;
set local request.jwt.claim.role='service_role';
select lives_ok(
  $$select public.world_npc_memory_summary_mark_dispatched(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,'provider-request-1'
  )$$,'identical mark replay is idempotent');
select is(
  public.world_npc_memory_summary_recover_dispatch(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0
  )->>'directive','fallback_only','same-fence recovery is fallback-only');
reset role;
reset request.jwt.claim.role;
select is((select state from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.job')::uuid),'fallback_required','same-fence recovery terminalizes the receipt');
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
  $$select public.world_npc_memory_summary_prepare_dispatch(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0
  )$$,'PT409',null,'terminalized receipt cannot be prepared again');
select throws_ok(
  $$select public.world_npc_memory_summary_mark_dispatched(
    current_setting('test.job')::uuid,current_setting('test.fence')::uuid,0,null
  )$$,'PT409',null,'terminalized receipt cannot be dispatched again');
reset role;
reset request.jwt.claim.role;

-- A second genuine job proves an expired prepared attempt cannot be redispatched
-- after a new worker fence reclaims it.
create temporary table pg_temp.reclaim_set as
select (private.world_npc_memory_register_summary_set(
  'episode_summary','dispatch-receipt-reclaim',
  (select ledger_sequence from private.world_npc_memory_sources
   where source_kind='dialogue_turn'
     and source_id='19200000-0000-4001-8000-000000000001'
     and disclosure_class='npc_known'),
  'npc_known',
  jsonb_build_array(jsonb_build_object(
    'ordinal',0,'sourceKind','dialogue_turn',
    'sourceId','19200000-0000-4001-8000-000000000001'::uuid,
    'sourceVersion',1
  )),
  jsonb_build_array(jsonb_build_object(
    'batchOrdinal',0,'firstLeafOrdinal',0,'lastLeafOrdinal',0,'leafCount',1
  ))
)).*;
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.reclaim_claim as
select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
select set_config('test.reclaim_job',(select claim->>'id' from pg_temp.reclaim_claim),true);
select set_config('test.old_fence',(select claim->>'fence' from pg_temp.reclaim_claim),true);
select lives_ok(
  $$select public.world_npc_memory_summary_prepare_dispatch(
    current_setting('test.reclaim_job')::uuid,current_setting('test.old_fence')::uuid,0
  )$$,'second job prepares a receipt');
reset role;
reset request.jwt.claim.role;
update private.world_npc_memory_outbox
set lease_until=clock_timestamp()-interval '1 second'
where id=current_setting('test.reclaim_job')::uuid;
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.reclaimed as
select public.world_npc_memory_claim('summary','npc-memory-v1') claim;
reset role;
reset request.jwt.claim.role;
select set_config('test.new_fence',(select claim->>'fence' from pg_temp.reclaimed),true);
select isnt(current_setting('test.new_fence'),current_setting('test.old_fence'),'reclaim issues a new fence');
set local role service_role;
set local request.jwt.claim.role='service_role';
select is(
  public.world_npc_memory_summary_recover_dispatch(
    current_setting('test.reclaim_job')::uuid,current_setting('test.new_fence')::uuid,0
  )->>'directive','fallback_only','new-fence recovery is fallback-only');
reset role;
reset request.jwt.claim.role;
select is((select state from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.reclaim_job')::uuid),'fallback_required','reclaim terminalizes the old prepared receipt');
select is((select count(*) from private.world_npc_memory_summary_dispatches where job_id=current_setting('test.reclaim_job')::uuid),1::bigint,'reclaim never creates a second receipt');
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
  $$select public.world_npc_memory_summary_prepare_dispatch(
    current_setting('test.reclaim_job')::uuid,current_setting('test.new_fence')::uuid,0
  )$$,'PT409',null,'new fence cannot prepare an ambiguous provider attempt');
select throws_ok(
  $$select public.world_npc_memory_summary_mark_dispatched(
    current_setting('test.reclaim_job')::uuid,current_setting('test.new_fence')::uuid,0,null
  )$$,'PT409',null,'new fence cannot dispatch an ambiguous provider attempt');
reset role;
reset request.jwt.claim.role;

-- Future v2 validators are pure and dormant. They validate exact source-backed
-- quotations without making v2 jobs or artifacts routable in this migration.
select set_config('test.expected_leaves',(
  select jsonb_agg(jsonb_build_object(
    'ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,
    'sourceVersion',source_version,'sourceHash',source_hash,
    'ledgerSequence',ledger_sequence
  ) order by ordinal)::text
  from private.world_npc_memory_summary_leaves
  where set_id=(select id from pg_temp.summary_set)
),true);
select set_config('test.expected_batches',(
  select jsonb_agg(jsonb_build_object(
    'ordinal',batch_ordinal,'firstLeafOrdinal',first_leaf_ordinal,
    'lastLeafOrdinal',last_leaf_ordinal,'leafCount',leaf_count
  ) order by batch_ordinal)::text
  from private.world_npc_memory_summary_batches
  where set_id=(select id from pg_temp.summary_set)
),true);
select set_config('test.valid_citation',(
  select jsonb_build_object(
    'leafOrdinal',0,'recordId',m.id,'speaker',m.speaker,'quote',m.quote,
    'sourceKind',m.source_kind,'sourceId',m.source_id,
    'sourceVersion',m.source_version,'sourceHash',m.source_hash
  )::text
  from private.world_npc_memories m
  where m.id='19200000-0000-4002-8000-000000000001'
),true);
select set_config('test.valid_batch',jsonb_build_object(
  'version','npc-memory-summary-v2','mode','model',
  'citations',jsonb_build_array(current_setting('test.valid_citation')::jsonb),
  'protectedRefs',current_setting('test.expected_leaves')::jsonb,
  'leaves',current_setting('test.expected_leaves')::jsonb
)::text,true);
select set_config('test.valid_content',jsonb_build_object(
  'version','npc-memory-summary-v2','mode','model',
  'summary','Exact multilingual evidence.',
  'citations',jsonb_build_array(current_setting('test.valid_citation')::jsonb),
  'protectedRefs',current_setting('test.expected_leaves')::jsonb,
  'leaves',current_setting('test.expected_leaves')::jsonb,
  'batches',current_setting('test.expected_batches')::jsonb
)::text,true);

select ok(private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,current_setting('test.valid_batch')::jsonb
),'batch validator accepts exact CJK, Arabic, combining-mark, and emoji evidence');
select ok(private.world_npc_memory_summary_v2_content_valid(
  (select id from pg_temp.summary_set),current_setting('test.valid_content')::jsonb
),'whole-set validator accepts the exact source-backed manifest');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,quote}','"fabricated quote"')
),'fabricated quote is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,quote}',to_jsonb('Café 中文 العربية 🦉'::text))
),'Unicode-normalized but non-exact quote is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,recordId}',to_jsonb('19200000-0000-4002-8000-000000000002'::text))
),'record from a different disclosure lane is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,speaker}','"player"')
),'wrong speaker is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,sourceId}',to_jsonb(extensions.gen_random_uuid()::text))
),'wrong source id is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,sourceVersion}','2')
),'wrong source version is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,sourceHash}',to_jsonb(repeat('a',64)))
),'wrong source hash is rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations}',
    jsonb_build_array(current_setting('test.valid_citation')::jsonb,current_setting('test.valid_citation')::jsonb))
),'duplicate noncanonical citations are rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,recordId}','"not-a-uuid"')
),'malformed record UUID fails closed');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,sourceVersion}','"NaN"')
),'malformed source version fails closed');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,extra}','true')
),'citation extra keys are rejected');
select ok(not private.world_npc_memory_summary_v2_content_valid(
  (select id from pg_temp.summary_set),
  jsonb_set(current_setting('test.valid_content')::jsonb,'{protectedRefs}','[]')
),'altered protected references are rejected');
select ok(not private.world_npc_memory_summary_v2_batch_valid(
  (select id from pg_temp.summary_set),0,
  jsonb_set(current_setting('test.valid_batch')::jsonb,'{citations,0,leafOrdinal}','1')
),'citation outside its batch leaf range is rejected');

update private.world_npc_memory_summary_sets
set closure_status='invalidated',invalidated_at=clock_timestamp()
where id=(select id from pg_temp.reclaim_set);
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(
  $$select public.world_npc_memory_summary_recover_dispatch(
    current_setting('test.reclaim_job')::uuid,current_setting('test.new_fence')::uuid,0
  )$$,'PT409',null,'invalidated set cannot recover a dispatch');
reset role;
reset request.jwt.claim.role;

delete from private.world_npc_instances where id=(select instance_id from pg_temp.fixture);
select is((select count(*) from private.world_npc_memory_summary_dispatches),0::bigint,'resident purge cascades all dispatch receipts');

select * from finish();
rollback;
