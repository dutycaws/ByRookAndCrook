begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
select is((select public.npc_memory_retrieve_for_actor('18100000-0000-4000-8000-000000000001',instance_id,'promise')->'items'->0->>'quote' from pg_temp.memory_fixture),'I will fund a guide, not weapons.','service retrieval scopes evidence to the supplied player actor');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000002';
select public.create_tavern();
select throws_ok(format('select public.npc_memory_retrieve(%L,%L)',(select instance_id from pg_temp.memory_fixture),'promise'),'PT404',null,'another save cannot retrieve the resident evidence');
reset role;

select lives_ok($$select private.world_npc_memory_complete(id,fence,'[]'::jsonb) from private.world_npc_memory_outbox where source_id='18100000-0000-4000-8000-000000000010' and processor_kind='extract'$$,'accepted no-memory examination is durable');
select is((select status from private.world_npc_memory_outbox where source_id='18100000-0000-4000-8000-000000000010' and processor_kind='extract'),'completed','examined source is distinct from an unprocessed gap');

select * from finish();
rollback;
