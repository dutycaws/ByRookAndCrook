begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users(id,email,role,aud) values
  ('18100000-0000-4000-8000-000000000001','memory-owner@example.test','authenticated','authenticated'),
  ('18100000-0000-4000-8000-000000000002','memory-other@example.test','authenticated','authenticated');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.memory_fixture as
select (snapshot#>>'{save,id}')::uuid save_id,
       (snapshot->'roster'->0->>'instanceId')::uuid instance_id,
       (snapshot->'roster'->0->>'npcId')::uuid npc_id,
       (snapshot->'roster'->0->>'versionId')::uuid version_id,
       (snapshot#>>'{save,revision}')::bigint revision
from (select public.npc_bar_snapshot() snapshot) source;
grant select on pg_temp.memory_fixture to service_role;
reset role;

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '18100000-0000-4000-8000-000000000010',save_id,instance_id,npc_id,version_id,'18100000-0000-4000-8000-000000000001',
       'I will fund a guide, not weapons.',0,revision,1,'completed',clock_timestamp()-interval '1 second','{"reply":"I accept those conditions."}'::jsonb,clock_timestamp()
from pg_temp.memory_fixture;

select private.world_npc_memory_enqueue(save_id,instance_id,'dialogue_turn','18100000-0000-4000-8000-000000000010',1,0,
  encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'))
from pg_temp.memory_fixture;
update private.world_npc_memory_outbox set status='processing',fence='18100000-0000-4000-8000-000000000030',lease_until=clock_timestamp()+interval '5 minutes'
where source_id='18100000-0000-4000-8000-000000000010' and processor_kind='extract';
create temporary table pg_temp.memory_completion_lease as
  select id job_id,fence from private.world_npc_memory_outbox
  where source_id='18100000-0000-4000-8000-000000000010' and processor_kind='extract' and processor_version='npc-memory-v1';
grant select on pg_temp.memory_completion_lease to service_role;

insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,source_id,source_hash,occurred_day,occurred_sequence,commitment_status)
select '18100000-0000-4000-8000-000000000010',instance_id,'promise','Fund a guide but not weapons.','I will fund a guide, not weapons.','keeper',3,'{}',save_id,
       '18100000-0000-4000-8000-000000000020','18100000-0000-4000-8000-000000000010',
       encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'),1,0,'unresolved'
from pg_temp.memory_fixture;

select is((select commitment_status from private.world_npc_memories where quote='I will fund a guide, not weapons.'),'unresolved','conditional promise retains an independently queryable active status');
select ok(exists(select 1 from private.world_npc_memory_outbox where source_id='18100000-0000-4000-8000-000000000010' and processor_kind='extract'),'completed dialogue is enqueued for derived processing');
select is((select public.npc_memory_retrieve(instance_id,'promise weapons')->'items'->0->>'quote' from pg_temp.memory_fixture),'I will fund a guide, not weapons.','lexical retrieval retains the decisive source quote');
select is((select public.npc_memory_retrieve(instance_id,'')->'sourceFallback'->0->>'npc' from pg_temp.memory_fixture),'I accept those conditions.','canonical fallback keeps the NPC speaker verbatim');

select throws_ok(format('select public.npc_memory_retrieve_for_actor(%L,%L,%L)', '18100000-0000-4000-8000-000000000001', (select instance_id from pg_temp.memory_fixture), 'promise'),'42501',null,'player clients cannot choose an actor for server retrieval');
select throws_ok($$select public.world_npc_memory_claim('extract','npc-memory-v1')$$,'PT403',null,'player clients cannot claim derived memory work');
reset role;
select private.world_npc_memory_enqueue(save_id,instance_id,'dialogue_turn','18100000-0000-4000-8000-000000000010',1,0,
  encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'),'extract','service-claim-v1')
from pg_temp.memory_fixture;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
select is((select public.npc_memory_retrieve_for_actor('18100000-0000-4000-8000-000000000001',instance_id,'promise')->'items'->0->>'quote' from pg_temp.memory_fixture),'I will fund a guide, not weapons.','service retrieval scopes evidence to the supplied player actor');
select is((select public.npc_memory_retrieve_for_actor('18100000-0000-4000-8000-000000000001',instance_id,'promise')->'sourceManifest'->0 from pg_temp.memory_fixture),
  jsonb_build_object('id','18100000-0000-4000-8000-000000000010','version',1,'hash',encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'),'kind','dialogue_turn'),
  'selected dialogue evidence exposes its authoritative source id, version, hash, and kind');
reset role;
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence)
select null,instance_id,'interaction','The quest dossier names an eastern route.','eastern route','keeper',2,'{}',save_id,
       '18100000-0000-4000-8000-000000000021','quest_event','18100000-0000-4000-8000-000000000099',7,repeat('b',64),1,0
from pg_temp.memory_fixture;
set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select manifest from pg_temp.memory_fixture cross join lateral jsonb_array_elements(public.npc_memory_retrieve_for_actor('18100000-0000-4000-8000-000000000001',instance_id,'dossier')->'sourceManifest') manifest where manifest->>'kind'='quest_event'),
  jsonb_build_object('id','18100000-0000-4000-8000-000000000099','version',7,'hash',repeat('b',64),'kind','quest_event'),
  'non-dialogue selected evidence retains its ledger-backed quest-event manifest');
select is((select public.world_npc_memory_claim('extract','service-claim-v1')->>'sourceId'),'18100000-0000-4000-8000-000000000010','service worker can claim a pending derived-memory source');
reset role;

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '18100000-0000-4000-8000-000000000011',save_id,instance_id,npc_id,version_id,'18100000-0000-4000-8000-000000000001',
       'A later promise must stay beyond the frozen cutoff.',1,revision,1,'completed',clock_timestamp()-interval '1 second','{"reply":"Later."}'::jsonb,clock_timestamp()
from pg_temp.memory_fixture;
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,source_id,source_hash,occurred_day,occurred_sequence)
select '18100000-0000-4000-8000-000000000011',instance_id,'interaction','Later promise evidence.','Later promise','keeper',2,'{}',save_id,
       '18100000-0000-4000-8000-000000000022','18100000-0000-4000-8000-000000000011',repeat('c',64),1,1
from pg_temp.memory_fixture;
set local role service_role;
set local request.jwt.claim.role='service_role';
select is((select public.npc_memory_retrieve_for_actor('18100000-0000-4000-8000-000000000001',instance_id,'',12,0)->'sourceManifest' from pg_temp.memory_fixture),
  jsonb_build_array(jsonb_build_object('id','18100000-0000-4000-8000-000000000010','version',1,'hash',encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'),'kind','dialogue_turn'),jsonb_build_object('id','18100000-0000-4000-8000-000000000099','version',7,'hash',repeat('b',64),'kind','quest_event')),
  'manifest respects the authorized retrieval cutoff and excludes later sources');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000002';
select public.create_tavern();
select throws_ok(format('select public.npc_memory_retrieve(%L,%L)',(select instance_id from pg_temp.memory_fixture),'promise'),'PT404',null,'another save cannot retrieve the resident evidence');
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
select lives_ok($$select public.world_npc_memory_complete(job_id,fence,'[]'::jsonb) from pg_temp.memory_completion_lease$$,'accepted no-memory examination is durable through the service wrapper');
reset role;
select is((select status from private.world_npc_memory_outbox where source_id='18100000-0000-4000-8000-000000000010' and processor_kind='extract' and processor_version='npc-memory-v1'),'completed','examined source is distinct from an unprocessed gap');

-- A later terminal row cannot conceal an earlier failed coordinate.  The
-- retrieval boundary must keep canonical fallback enabled through sequence 0.
select private.world_npc_memory_enqueue(save_id,instance_id,'dialogue_turn','18100000-0000-4000-8000-000000000010',1,0,
  encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'),'extract','watermark-gap-v1')
from pg_temp.memory_fixture;
select private.world_npc_memory_enqueue(save_id,instance_id,'dialogue_turn','18100000-0000-4000-8000-000000000011',1,1,
  repeat('a',64),'extract','watermark-gap-v1')
from pg_temp.memory_fixture;
update private.world_npc_memory_outbox set status=case when source_sequence=0 then 'failed' else 'completed' end
where instance_id=(select instance_id from pg_temp.memory_fixture) and processor_version='watermark-gap-v1';
select private.world_npc_memory_refresh_watermark(instance_id,'extract','watermark-gap-v1') from pg_temp.memory_fixture;
select is((select jsonb_build_array(contiguous_sequence,examined_through_sequence,gap_sequence) from private.world_npc_memory_watermarks where instance_id=(select instance_id from pg_temp.memory_fixture) and processor_version='watermark-gap-v1'),'[-1,1,0]'::jsonb,'an early failed memory job remains a visible coverage gap while later examined work remains measurable');

select private.world_npc_memory_enqueue(save_id,instance_id,'dialogue_turn','18100000-0000-4000-8000-000000000010',1,0,
  encode(extensions.digest(convert_to('I will fund a guide, not weapons.' || E'\n' || 'I accept those conditions.','utf8'),'sha256'),'hex'),'extract','expired-fence-v1')
from pg_temp.memory_fixture;
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.expired_memory_lease as
  select public.world_npc_memory_claim('extract','expired-fence-v1') claim;
reset role;
update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second'
where id=(select (claim->>'id')::uuid from pg_temp.expired_memory_lease);
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_complete(%L,%L,%L::jsonb,null)',(select claim->>'id' from pg_temp.expired_memory_lease),(select claim->>'fence' from pg_temp.expired_memory_lease),'[]'),'PT409',null,'an expired memory lease cannot accept a late completion');
reset role;

select * from finish();
rollback;
