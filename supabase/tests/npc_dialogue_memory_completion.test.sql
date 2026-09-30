begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users(id,email,role,aud) values ('18500000-0000-4000-8000-000000000001','completion-owner@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18500000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as
select (snapshot#>>'{save,id}')::uuid save_id,(snapshot->'roster'->0->>'instanceId')::uuid instance_id,(snapshot->'roster'->0->>'npcId')::uuid npc_id,(snapshot->'roster'->0->>'versionId')::uuid version_id,(snapshot#>>'{save,revision}')::bigint revision
from (select public.npc_bar_snapshot() snapshot) x;
grant select on pg_temp.fixture to service_role;
reset role;

create temporary table pg_temp.quest as
select quest.id,quest.target_refs from private.world_quests quest join pg_temp.fixture fixture on fixture.instance_id=quest.instance_id where quest.state='active';

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000010',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Will you fund a guide, not weapons?',0,revision,1,'processing','18500000-0000-4000-8000-000000000011',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','quest','reaction',0,'evidence','','intention',null)),
'speak',jsonb_build_object('value',jsonb_build_object('text','I will fund a guide, not weapons.')),
'remember',jsonb_build_object('value',jsonb_build_object('memories',jsonb_build_array(jsonb_build_object('kind','promise','text','I will fund a guide, not weapons.','quote','I will fund a guide, not weapons.','speaker','npc','priorCommitmentId',null,'commitmentStatus','unresolved')))))
from pg_temp.fixture;

set local role service_role;
set local request.jwt.claim.role='service_role';
select lives_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000010','18500000-0000-4000-8000-000000000011')$$,'completion persists source-backed promise');
reset role;
select is((select commitment_status from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),'unresolved','new NPC promise is unresolved');
select is((select quote from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),'I will fund a guide, not weapons.','promise quote is exact NPC source text');
select is((select source_hash from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),encode(extensions.digest(convert_to('Will you fund a guide, not weapons?'||E'\n'||'I will fund a guide, not weapons.','utf8'),'sha256'),'hex'),'source hash is deterministic from exact exchange');
select is((select record_version from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),1,'initial record is root version one');
select is((select jsonb_build_array(occurred_day,occurred_sequence,learned_day,learned_sequence) from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),'[1,0,1,0]'::jsonb,'occurred and learned coordinates are immutable dialogue coordinates');
select ok((select participant_actor_id='18500000-0000-4000-8000-000000000001' and observer_instance_id=instance_id from private.world_npc_memories join pg_temp.fixture using(instance_id) where turn_id='18500000-0000-4000-8000-000000000010'),'participant and observer are SQL-owned');
select ok((select related_quest_id=(select id from pg_temp.quest) and entity_refs=(select target_refs from pg_temp.quest) from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),'quest provenance uses only the active SQL-owned quest and targets');
select is((select count(*) from private.world_npc_memory_outbox where source_id='18500000-0000-4000-8000-000000000010'),1::bigint,'completion enqueues exactly one extract job');
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000010','18500000-0000-4000-8000-000000000011')$$,'completed retry is idempotent');
reset role;
select is((select count(*) from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),1::bigint,'retry creates no duplicate memory');
select is((select count(*) from private.world_npc_memory_outbox where source_id='18500000-0000-4000-8000-000000000010'),1::bigint,'retry creates no duplicate extract work');

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000012',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Do you still promise?',1,revision,1,'processing','18500000-0000-4000-8000-000000000013',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','quest','reaction',0,'evidence','','intention',null)),
'speak',jsonb_build_object('value',jsonb_build_object('text','I withdraw that promise.')),
'remember',jsonb_build_object('value',jsonb_build_object('memories',jsonb_build_array(jsonb_build_object('kind','promise','text','I withdraw that promise.','quote','I withdraw that promise.','speaker','npc','priorCommitmentId',(select id from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),'commitmentStatus','withdrawn')))))
from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000012','18500000-0000-4000-8000-000000000013')$$,'withdrawal writes next immutable version');
reset role;
select is((select array_agg(commitment_status order by record_version) from private.world_npc_memories where record_root_id=(select record_root_id from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010')),array['unresolved','withdrawn']::text[],'withdrawal retains immutable v1 and writes v2');
select ok((select correction_memory_id is not null and record_version=2 from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000012'),'v2 links to prior commitment');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((select public.npc_memory_retrieve_for_actor('18500000-0000-4000-8000-000000000001',instance_id,'',12,0)->'items'->0->>'commitment_status' from pg_temp.fixture),'unresolved','pre-withdrawal cutoff sees v1 unresolved');
select is((select public.npc_memory_retrieve_for_actor('18500000-0000-4000-8000-000000000001',instance_id,'',12,1)->'items'->0->>'commitment_status' from pg_temp.fixture),'withdrawn','post-withdrawal cutoff selects only v2');
reset role;

-- A completed exchange with no remember output still advances the examined
-- source stream, but creates no derived authoritative memory rows.
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000014',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Thank you.',2,revision,1,'processing','18500000-0000-4000-8000-000000000015',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','personal','reaction',0,'evidence','','intention',null)),'speak',jsonb_build_object('value',jsonb_build_object('text','You are welcome.')),'remember',jsonb_build_object('value',jsonb_build_object('memories','[]'::jsonb)))
from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000014','18500000-0000-4000-8000-000000000015')$$,'no-remember completion remains authoritative');
reset role;
select is((select count(*) from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000014'),0::bigint,'no-remember turn creates no memory rows');
select is((select count(*) from private.world_npc_memory_outbox where source_id='18500000-0000-4000-8000-000000000014'),1::bigint,'no-remember turn still enqueues one examined extract source');

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until)
select '18500000-0000-4000-8000-000000000016',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Failed source.',3,revision,1,'failed','18500000-0000-4000-8000-000000000017',clock_timestamp()-interval '1 second' from pg_temp.fixture;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until)
select '18500000-0000-4000-8000-000000000017',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Cancelled source.',4,revision,1,'cancelled','18500000-0000-4000-8000-000000000018',clock_timestamp()-interval '1 second' from pg_temp.fixture;
select ok(not exists(select 1 from private.world_npc_memories where turn_id in ('18500000-0000-4000-8000-000000000016','18500000-0000-4000-8000-000000000017')) and not exists(select 1 from private.world_npc_memory_outbox where source_id in ('18500000-0000-4000-8000-000000000016','18500000-0000-4000-8000-000000000017')),'failed and cancelled source states create neither memory nor extract work');

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000018',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Bad quote request.',3,revision,1,'processing','18500000-0000-4000-8000-000000000019',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','personal','reaction',0,'evidence','','intention',null)),'speak',jsonb_build_object('value',jsonb_build_object('text','Actual reply.')),'remember',jsonb_build_object('value',jsonb_build_object('memories',jsonb_build_array(jsonb_build_object('kind','npc_statement','text','Invalid quote.','quote','not in reply','speaker','npc','priorCommitmentId',null,'commitmentStatus',null))))) from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000018','18500000-0000-4000-8000-000000000019')$$,'PT400',null,'invalid remember quote rejects completion atomically');
reset role;
select ok((select status='processing' from private.world_npc_dialogue_turns where id='18500000-0000-4000-8000-000000000018') and not exists(select 1 from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000018') and not exists(select 1 from private.world_npc_memory_outbox where source_id='18500000-0000-4000-8000-000000000018'),'invalid remember output rolls back turn, memory, and outbox');
update private.world_npc_dialogue_turns set status='failed' where id='18500000-0000-4000-8000-000000000018';

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000020',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','I fulfilled it.',3,revision,1,'processing','18500000-0000-4000-8000-000000000021',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','personal','reaction',0,'evidence','','intention',null)),'speak',jsonb_build_object('value',jsonb_build_object('text','I hear your claim.')),'remember',jsonb_build_object('value',jsonb_build_object('memories',jsonb_build_array(jsonb_build_object('kind','keeper_claim','text','The keeper says it is fulfilled.','quote','I fulfilled it.','speaker','keeper','priorCommitmentId',null,'commitmentStatus','fulfilled'))))) from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000020','18500000-0000-4000-8000-000000000021')$$,'PT400',null,'keeper claim cannot fulfill a commitment');
reset role;
select ok((select status='processing' from private.world_npc_dialogue_turns where id='18500000-0000-4000-8000-000000000020') and not exists(select 1 from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000020') and not exists(select 1 from private.world_npc_memory_outbox where source_id='18500000-0000-4000-8000-000000000020'),'keeper fulfillment attempt rolls back all authoritative effects');
update private.world_npc_dialogue_turns set status='failed' where id='18500000-0000-4000-8000-000000000020';
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000022',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Do you restore it?',3,revision,1,'processing','18500000-0000-4000-8000-000000000023',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','personal','reaction',0,'evidence','','intention',null)),'speak',jsonb_build_object('value',jsonb_build_object('text','No.')),'remember',jsonb_build_object('value',jsonb_build_object('memories',jsonb_build_array(jsonb_build_object('kind','promise','text','No.','quote','No.','speaker','npc','priorCommitmentId',(select id from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000010'),'commitmentStatus','withdrawn'))))) from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000022','18500000-0000-4000-8000-000000000023')$$,'PT400',null,'stale v1 commitment ID cannot receive a second correction');
reset role;
select ok((select status='processing' from private.world_npc_dialogue_turns where id='18500000-0000-4000-8000-000000000022') and not exists(select 1 from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000022'),'stale prior correction rolls back atomically');
update private.world_npc_dialogue_turns set status='failed' where id='18500000-0000-4000-8000-000000000022';
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,checkpoints)
select '18500000-0000-4000-8000-000000000024',save_id,instance_id,npc_id,version_id,'18500000-0000-4000-8000-000000000001','Bad identifier.',3,revision,1,'processing','18500000-0000-4000-8000-000000000025',clock_timestamp()+interval '5 minutes',
jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object('stance','respond','subject','personal','reaction',0,'evidence','','intention',null)),'speak',jsonb_build_object('value',jsonb_build_object('text','No.')),'remember',jsonb_build_object('value',jsonb_build_object('memories',jsonb_build_array(jsonb_build_object('kind','promise','text','No.','quote','No.','speaker','npc','priorCommitmentId','not-a-uuid','commitmentStatus','withdrawn'))))) from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.npc_dialogue_complete('18500000-0000-4000-8000-000000000001','18500000-0000-4000-8000-000000000024','18500000-0000-4000-8000-000000000025')$$,'PT400',null,'malformed commitment ID is a recoverable contract rejection');
reset role;
select ok((select status='processing' from private.world_npc_dialogue_turns where id='18500000-0000-4000-8000-000000000024') and not exists(select 1 from private.world_npc_memories where turn_id='18500000-0000-4000-8000-000000000024') and not exists(select 1 from private.world_npc_memory_outbox where source_id='18500000-0000-4000-8000-000000000024'),'malformed commitment ID rolls back authoritative effects');
select * from finish();
rollback;
