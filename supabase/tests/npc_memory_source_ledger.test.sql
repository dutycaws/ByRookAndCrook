begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- This fixture deliberately drives the four canonical producers directly.  It
-- proves their ledger/evidence/outbox contract without a provider.
insert into auth.users(id,email,role,aud) values
 ('18600000-0000-4000-8000-000000000001','ledger-owner@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18600000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
-- The local development database can contain prior ad-hoc fixture rows.  This
-- test owns this UUID namespace and removes only its derived receipts.
delete from private.world_npc_memory_outbox where source_id between '18600000-0000-4000-8000-000000000001'::uuid and '18600000-0000-4000-8000-000000000099'::uuid;
delete from private.world_npc_memories where source_id between '18600000-0000-4000-8000-000000000001'::uuid and '18600000-0000-4000-8000-000000000099'::uuid;
delete from private.world_npc_memory_sources where source_id between '18600000-0000-4000-8000-000000000001'::uuid and '18600000-0000-4000-8000-000000000099'::uuid;
create temporary table pg_temp.f as
select (snapshot#>>'{save,id}')::uuid save_id,(snapshot->'roster'->0->>'instanceId')::uuid instance_id,
 (snapshot->'roster'->0->>'npcId')::uuid npc_id,(snapshot->'roster'->0->>'versionId')::uuid version_id,
 (snapshot#>>'{save,revision}')::bigint revision
from (select public.npc_bar_snapshot() snapshot) x;

-- Dialogue source preserves its historic exchange hash and its own input
-- coordinate, never the new ledger coordinate.
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '18600000-0000-4000-8000-000000000010',save_id,instance_id,npc_id,version_id,'18600000-0000-4000-8000-000000000001','A first exact exchange.',0,revision,1,'processing',clock_timestamp()+interval '5 minutes','{"reply":"An exact reply."}',null from pg_temp.f;
update private.world_npc_dialogue_turns set status='completed',completed_at=clock_timestamp()-interval '10 minutes' where id='18600000-0000-4000-8000-000000000010';
select ok(exists(select 1 from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='18600000-0000-4000-8000-000000000010' and source_hash=encode(extensions.digest(convert_to('A first exact exchange.'||E'\n'||'An exact reply.','utf8'),'sha256'),'hex') and occurred_sequence=0),'dialogue is registered with its exact established source hash and cutoff');
select is((select source_version from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='18600000-0000-4000-8000-000000000010'),1::bigint,'dialogue source is version one');
select is((select disclosure_class from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='18600000-0000-4000-8000-000000000010'),'npc_known','dialogue disclosure is NPC-known');
select is((select envelope->>'keeper' from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='18600000-0000-4000-8000-000000000010'),'A first exact exchange.','dialogue envelope preserves the keeper source');
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,observer_instance_id,related_quest_id)
select '18600000-0000-4000-8000-000000000010',f.instance_id,'promise','I will guard the quest.','An exact reply.','npc',3,q.target_refs,f.save_id,'18600000-0000-0000-0000-000000000099',1,'dialogue_turn','18600000-0000-4000-8000-000000000010',1,encode(extensions.digest(convert_to('A first exact exchange.'||E'\n'||'An exact reply.','utf8'),'sha256'),'hex'),1,0,1,0,'attributed','npc_known','unresolved',f.instance_id,q.id from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;

-- A manually persisted earlier quest promise is fulfilled only by the
-- terminal canonical quest source; its v1 remains immutable.
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,observer_instance_id,related_quest_id)
select '18600000-0000-4000-8000-000000000010',f.instance_id,'promise','I will finish the quest.','An exact reply.','npc',3,q.target_refs,f.save_id,'18600000-0000-4000-8000-000000000011',1,'dialogue_turn','18600000-0000-4000-8000-000000000010',1,encode(extensions.digest(convert_to('A first exact exchange.'||E'\n'||'An exact reply.','utf8'),'sha256'),'hex'),1,0,1,0,'attributed','npc_known','unresolved',f.instance_id,q.id from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;

insert into private.world_quest_events(id,quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,narration,public_news)
select '18600000-0000-4000-8000-000000000020',q.id,f.save_id,f.instance_id,9,0,'attempt','scouting',1,q.difficulty,0,0,0,0,50,1,'succeeded','The quest reached its authoritative ending.',true from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000020');
select ok((select count(*)=1 from private.world_npc_memory_sources where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020'),'quest event has one scoped ledger record');
select ok((select count(*)=1 from private.world_npc_memories where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020' and speaker='system' and truth_class='canonical' and commitment_status is null),'quest event projects one canonical base-evidence row');
select ok((select count(*)=1 from private.world_npc_memory_outbox where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020'),'quest event enqueues exactly one job');
select is((select source_version from private.world_npc_memory_sources where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020'),1::bigint,'quest source is version one');
select ok((select source_hash=private.world_npc_memory_source_hash('quest_event','18600000-0000-4000-8000-000000000020') from private.world_npc_memory_sources where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020'),'quest hash is the canonical envelope hash');
select is((select array_agg(commitment_status order by record_version) from private.world_npc_memories where record_root_id='18600000-0000-4000-8000-000000000011'),array['unresolved','fulfilled']::text[],'terminal success writes an immutable fulfilled version');

-- A promise made after the terminal receipt is ineligible for historical
-- fulfillment, and a nonterminal receipt cannot change either root.
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,observer_instance_id,related_quest_id)
select '18600000-0000-4000-8000-000000000010',f.instance_id,'promise','Later promise.','An exact reply.','npc',3,q.target_refs,f.save_id,'18600000-0000-4000-8000-000000000012',1,'dialogue_turn','18600000-0000-4000-8000-000000000010',1,repeat('a',64),10,99,10,99,'attributed','npc_known','unresolved',f.instance_id,q.id from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;
select is((select commitment_status from private.world_npc_memories where record_root_id='18600000-0000-4000-8000-000000000012'),'unresolved','terminal source does not fulfill a post-event promise');

insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id)
select '18600000-0000-4000-8000-000000000030',save_id,'Ledger loaf','ledger-loaf',3,9,'18600000-0000-4000-8000-000000000031' from pg_temp.f;
insert into private.world_npc_hospitality_events(save_id,action_id,actor_id,instance_id,item_kind,food_id,input_expected_revision,day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision)
select save_id,'18600000-0000-4000-8000-000000000032','18600000-0000-4000-8000-000000000001',instance_id,'food','18600000-0000-4000-8000-000000000030',revision,9,'Ledger loaf',3,0,1,'{}',revision+1 from pg_temp.f;
select private.world_npc_memory_project_source('hospitality','18600000-0000-4000-8000-000000000032');
select ok(exists(select 1 from private.world_npc_memory_sources where source_kind='hospitality' and disclosure_class='npc_known' and occurred_sequence=0),'hospitality captures event-time dialogue cutoff and disclosure');
select ok(exists(select 1 from private.world_npc_memories where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032' and source_version=1 and speaker='system' and truth_class='canonical' and disclosure_class='npc_known' and commitment_status is null),'hospitality projects exact canonical base evidence');
select is((select source_version from private.world_npc_memory_sources where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032'),1::bigint,'hospitality source is version one');
select is((select source_hash from private.world_npc_memory_sources where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032'),private.world_npc_memory_source_hash('hospitality','18600000-0000-4000-8000-000000000032'),'hospitality hash is stable over its source envelope');
insert into auth.users(id,email,role,aud) values ('18600000-0000-0000-0000-000000000002','ledger-second@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='18600000-0000-0000-0000-000000000002'; select public.create_tavern(); reset role;
create temporary table pg_temp.f2 as select (snapshot#>>'{save,id}')::uuid save_id,(snapshot->'roster'->0->>'instanceId')::uuid instance_id,(snapshot#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() snapshot) x;
insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id) select '18600000-0000-0000-0000-000000000030',save_id,'Second loaf','second-loaf',3,9,'18600000-0000-0000-0000-000000000031' from pg_temp.f2;
select throws_ok($$insert into private.world_npc_hospitality_events(save_id,action_id,actor_id,instance_id,item_kind,food_id,input_expected_revision,day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision) select f2.save_id,'18600000-0000-4000-8000-000000000032','18600000-0000-0000-0000-000000000002',f2.instance_id,'food','18600000-0000-0000-0000-000000000030',f2.revision,9,'collision',3,0,0,'{}',f2.revision+1 from pg_temp.f2$$,'23505',null,'hospitality action receipt is globally unique across saves');
select ok(not exists(select 1 from private.world_npc_memory_sources where source_kind='hospitality' and instance_id=(select instance_id from pg_temp.f2)),'rejected second-save hospitality creates no ledger source');

-- Evolution is an npc-private canonical source.  The settlement/job rows are
-- the authoritative producer guard, not model-created state.
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at,input_snapshot,input_version)
select '18600000-0000-4000-8000-000000000040',save_id,9,revision,'ledger-settlement','completed',clock_timestamp(),'{}','fixture-v1' from pg_temp.f;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,subject_instance_id,status,input_fingerprint,input_snapshot,input_version)
select '18600000-0000-4000-8000-000000000041','18600000-0000-4000-8000-000000000040',1,'resident',instance_id,'completed','ledger-job','{}','fixture-v1' from pg_temp.f;
insert into private.resident_evolution_entries(job_id,instance_id,save_id,day_number,profile_revision,disposition)
select '18600000-0000-4000-8000-000000000041',instance_id,save_id,9,1,'{"summary":"More watchful."}' from pg_temp.f;
select ok((select disclosure_class='npc_private' from private.world_npc_memory_sources where source_kind='resident_evolution' and source_id='18600000-0000-4000-8000-000000000041') and exists(select 1 from private.world_npc_memory_outbox where source_kind='resident_evolution'),'evolution produces private canonical evidence and one job');
select is((select source_version from private.world_npc_memory_sources where source_kind='resident_evolution' and source_id='18600000-0000-4000-8000-000000000041'),1::bigint,'evolution source is version one');
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '18600000-0000-0000-0000-000000000098',save_id,instance_id,npc_id,version_id,'18600000-0000-4000-8000-000000000001','Later dialogue.',1,revision,9,'processing',clock_timestamp()+interval '5 minutes','{"reply":"Later reply."}',null from pg_temp.f;
update private.world_npc_dialogue_turns set status='completed',completed_at=clock_timestamp() where id='18600000-0000-0000-0000-000000000098';
select is((select occurred_sequence from private.world_npc_memory_sources where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032'),0::bigint,'hospitality cutoff remains captured before later dialogue');
select is((select count(*) from private.world_npc_memory_outbox where source_id in ('18600000-0000-4000-8000-000000000010','18600000-0000-4000-8000-000000000020','18600000-0000-4000-8000-000000000032','18600000-0000-4000-8000-000000000041')),4::bigint,'all four source kinds enqueue exactly one extract job');
select ok((select array_agg(ledger_sequence order by ledger_sequence)=array[0,1,2,3,4]::bigint[] from private.world_npc_memory_sources where instance_id=(select instance_id from pg_temp.f)),'mixed source registration is contiguous per instance');
select is((select occurred_sequence from private.world_npc_memory_sources where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032'),0::bigint,'non-dialogue cutoff remains stable after later dialogue');

-- Registration is idempotent and does not create an extra source coordinate.
create temporary table pg_temp.before_retry as select ledger_sequence from private.world_npc_memory_sources where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020';
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000020');
select is((select count(*) from private.world_npc_memory_sources where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000020'),1::bigint,'retry has no duplicate source or phantom ledger gap');
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000020');
select is((select count(*) from private.world_npc_memories where related_quest_id=(select id from private.world_quests where instance_id=(select instance_id from pg_temp.f) order by created_at limit 1) and commitment_status='fulfilled'),2::bigint,'terminal replay fulfills both eligible unresolved roots exactly once');
select ok(exists(select 1 from private.world_npc_memories where record_root_id='18600000-0000-0000-0000-000000000099' and commitment_status='fulfilled'),'replayed terminal receipt does not leave an eligible root unresolved');
select is((select commitment_status from private.world_npc_memories where record_root_id='18600000-0000-4000-8000-000000000012' and record_version=1),'unresolved','post-event promise remains unresolved after terminal replay');

update private.world_npc_memory_outbox set status='completed',lease_until=null,completed_at=clock_timestamp() where instance_id=(select instance_id from pg_temp.f) and source_kind<>'quest_event' and status='pending';
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim as select public.world_npc_memory_claim('extract','npc-memory-v1') claim;
select is((select jsonb_build_array(claim->>'sourceKind',claim->>'sourceId') from pg_temp.claim),jsonb_build_array('quest_event','18600000-0000-4000-8000-000000000020'),'completion fixture claims its own non-dialogue quest source');
select lives_ok(format('select public.world_npc_memory_complete(%L,%L,%L::jsonb,null)',(select claim->>'id' from pg_temp.claim),(select claim->>'fence' from pg_temp.claim),'[]'),'valid non-dialogue source completion accepts its matching fence');
reset role;
select is((select status from private.world_npc_memory_outbox where id=(select (claim->>'id')::uuid from pg_temp.claim)),'completed','non-dialogue completion records a completed extract job');
select is((select jsonb_build_array(contiguous_sequence,examined_through_sequence,gap_sequence) from private.world_npc_memory_watermarks where instance_id=(select instance_id from pg_temp.f) and processor_kind='extract' and processor_version='npc-memory-v1'),'[4,4,null]'::jsonb,'extract watermark is contiguous after all source jobs complete');
select ok(not exists(select 1 from private.world_npc_memories where source_kind='dialogue_turn' and source_id='18600000-0000-4000-8000-000000000010' and commitment_status='fulfilled'),'dialogue source never fulfills a commitment by itself');
-- Worker rejection matrix: a non-dialogue job cannot accept a tampered source
-- hash, an over-disclosing artifact, or an explicit invalidation fence.
update private.world_npc_memory_outbox set status='processing',fence='18600000-0000-4000-8000-000000000026',lease_until=clock_timestamp()+interval '5 minutes',source_hash=repeat('c',64)
where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032';
create temporary table pg_temp.tampered_lease as select id,fence from private.world_npc_memory_outbox where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032';
grant select on pg_temp.tampered_lease to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_complete((select id from pg_temp.tampered_lease), '18600000-0000-4000-8000-000000000026','[]'::jsonb,null)$$,'PT409',null,'tampered non-dialogue source hash is rejected');
reset role;
select is((select status from private.world_npc_memory_outbox where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032'),'processing','rejected hash does not mark the job completed');
update private.world_npc_memory_outbox set source_hash=private.world_npc_memory_source_hash('hospitality','18600000-0000-4000-8000-000000000032')
where source_kind='hospitality' and source_id='18600000-0000-4000-8000-000000000032';
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_complete((select id from pg_temp.tampered_lease), '18600000-0000-4000-8000-000000000026','[{"artifactKind":"episode_summary","sourceKind":"hospitality","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","disclosureClass":"npc_private"}]'::jsonb,null)$$,'PT400',null,'artifact disclosure cannot exceed the authoritative source');
reset role;
update private.world_npc_memory_outbox set status='processing',fence='18600000-0000-4000-8000-000000000027',lease_until=clock_timestamp()+interval '5 minutes'
where source_kind='resident_evolution' and source_id='18600000-0000-4000-8000-000000000041';
create temporary table pg_temp.invalidated_lease as select id,fence from private.world_npc_memory_outbox where source_kind='resident_evolution' and source_id='18600000-0000-4000-8000-000000000041';
grant select on pg_temp.invalidated_lease to service_role;
insert into private.world_npc_memory_invalidations(job_id,save_id,instance_id,fence,source_kind,source_id,source_version,reason)
select o.id,o.save_id,o.instance_id,o.fence,o.source_kind,o.source_id,o.source_version,'resident_removed' from private.world_npc_memory_outbox o where o.id=(select id from pg_temp.invalidated_lease);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_npc_memory_complete((select id from pg_temp.invalidated_lease),(select fence from pg_temp.invalidated_lease),'[]'::jsonb,null)$$,'PT409',null,'late completion after explicit resident invalidation fence is rejected');
reset role;
-- A nonterminal authoritative quest event never fulfills a commitment, even
-- when the live trigger and a migration-equivalent replay both run.
insert into private.world_quest_events(id,quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,narration,public_news)
select '18600000-0000-4000-8000-000000000021',q.id,f.save_id,f.instance_id,8,0,'prepare','scouting',1,q.difficulty,0,1,0,0,null,null,'prepared','The quest continues.',false from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000021');
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000021');
select is((select commitment_status from private.world_npc_memories where record_root_id='18600000-0000-4000-8000-000000000012' and record_version=1),'unresolved','nonterminal quest event and replay never fulfill a commitment');
select is((select count(*) from private.world_npc_memory_sources where source_kind='quest_event' and source_id='18600000-0000-4000-8000-000000000021'),1::bigint,'nonterminal live/replay projection has one source');
-- A directly-completed historical dialogue does not fire the live UPDATE
-- trigger; the idempotent project helper is the migration backfill equivalent.
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '18600000-0000-0000-0000-000000000097',save_id,instance_id,npc_id,version_id,'18600000-0000-4000-8000-000000000001','Historical direct completion.',2,revision,9,'completed',clock_timestamp()+interval '5 minutes','{"reply":"Historical reply."}',clock_timestamp() from pg_temp.f;
select ok(not exists(select 1 from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='18600000-0000-0000-0000-000000000097'),'direct completed insert does not pretend to be the live transition');
select private.world_npc_memory_project_source('dialogue_turn','18600000-0000-0000-0000-000000000097');
select private.world_npc_memory_project_source('dialogue_turn','18600000-0000-0000-0000-000000000097');
select is((select count(*) from private.world_npc_memory_sources where source_kind='dialogue_turn' and source_id='18600000-0000-0000-0000-000000000097'),1::bigint,'historical helper replay yields one dialogue source');
select is((select count(*) from private.world_npc_memory_outbox where source_kind='dialogue_turn' and source_id='18600000-0000-0000-0000-000000000097'),1::bigint,'historical helper replay yields one extract job');
-- A terminal non-success receipt is authoritative but cannot fulfill promises.
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,observer_instance_id,related_quest_id)
select '18600000-0000-4000-8000-000000000010',f.instance_id,'promise','I will try again.','An exact reply.','npc',3,q.target_refs,f.save_id,'18600000-0000-0000-0000-000000000013',1,'dialogue_turn','18600000-0000-4000-8000-000000000010',1,encode(extensions.digest(convert_to('A first exact exchange.'||E'\n'||'An exact reply.','utf8'),'sha256'),'hex'),1,0,1,0,'attributed','npc_known','unresolved',f.instance_id,q.id from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;
insert into private.world_quest_events(id,quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,narration,public_news)
select '18600000-0000-4000-8000-000000000022',q.id,f.save_id,f.instance_id,10,0,'attempt','scouting',1,q.difficulty,0,0,0,0,50,99,'failed','The quest failed authoritatively.',false from pg_temp.f f join lateral (select * from private.world_quests where instance_id=f.instance_id order by created_at limit 1) q on true;
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000022');
select private.world_npc_memory_project_source('quest_event','18600000-0000-4000-8000-000000000022');
select is((select commitment_status from private.world_npc_memories where record_root_id='18600000-0000-0000-0000-000000000013' and record_version=1),'unresolved','terminal failed quest and replay leave the commitment unresolved');
select * from finish();
rollback;
