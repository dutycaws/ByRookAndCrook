begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- This fixture uses source occurred_day coverage rather than thirty day-close
-- mutations: retrieval reads the immutable source ledger, not wall-clock play.
insert into auth.users(id,email,role,aud) values
 ('65000000-0000-4000-8000-000000000001','horizon-owner@test','authenticated','authenticated'),
 ('65000000-0000-4000-8000-000000000002','horizon-other@test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='65000000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.horizon as
 select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,
   (x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id
 from (select public.npc_bar_snapshot() x) s;
grant select on pg_temp.horizon to service_role;
reset role;

-- Produce an authored terminal quest and a real generated-successor row. Both
-- IDs are subsequently carried by memory records, not synthetic text labels.
update public.tavern_saves set current_day=4,world_phase='open' where id=(select save_id from pg_temp.horizon);
create temporary table pg_temp.authored_prepare as
 select * from private.world_resolve_quest_step((select id from private.world_quests where save_id=(select save_id from pg_temp.horizon) and instance_id=(select instance_id from pg_temp.horizon)),4,0);
create temporary table pg_temp.authored_terminal as
 select * from private.world_resolve_quest_step((select quest_id from pg_temp.authored_prepare),5,0);
create temporary table pg_temp.quest_ids(authored_id uuid,successor_id uuid);
insert into pg_temp.quest_ids(authored_id) select quest_id from pg_temp.authored_terminal;
insert into private.world_quests(id,save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day)
select '65000000-0000-4000-8000-000000000900',q.save_id,q.instance_id,q.package_id,q.package_hash,q.version_id,
 'generated_successor',q.id,'Guide the successor caravan','Carry the guide charter forward','The terminal quest made a successor necessary',q.constraints,q.target_refs,q.difficulty,q.definition_plan,q.definition_plan,'scheduled',0,0,30
from private.world_quests q where q.id=(select authored_id from pg_temp.quest_ids);
update pg_temp.quest_ids set successor_id='65000000-0000-4000-8000-000000000900';

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select ('65000000-0000-4000-8000-'||lpad(day::text,12,'0'))::uuid,save_id,instance_id,npc_id,version_id,
 '65000000-0000-4000-8000-000000000001',
 case day when 1 then 'I will fund a guide, not weapons.' when 2 then 'I withdraw the weapons promise; fund the guide only.' when 30 then 'The successor caravan inherits the guide charter.' else 'Irrelevant tavern weather memory '||day end,
 day,0,day,'completed',clock_timestamp(),jsonb_build_object('reply','day '||day),clock_timestamp()
from pg_temp.horizon cross join generate_series(1,30) day;
insert into private.world_npc_memory_sources(source_kind,source_id,source_version,save_id,instance_id,ledger_sequence,source_hash,disclosure_class,occurred_day,occurred_sequence,learned_day,learned_sequence,envelope)
select 'dialogue_turn',('65000000-0000-4000-8000-'||lpad(day::text,12,'0'))::uuid,1,save_id,instance_id,100+day,lpad(to_hex(day),64,'0'),
 case when day=29 then 'npc_private' else 'npc_known' end,day,day,day,day,
 jsonb_build_object('kind','dialogue_turn','id',('65000000-0000-4000-8000-'||lpad(day::text,12,'0')),'version',1,'ledgerSequence',100+day)
from pg_temp.horizon cross join generate_series(1,30) day;
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,correction_memory_id,related_quest_id)
select case day when 1 then '65000000-0000-4000-8000-000000000101'::uuid when 2 then '65000000-0000-4000-8000-000000000102'::uuid else ('65000000-0000-4001-8000-'||lpad(day::text,12,'0'))::uuid end,
 ('65000000-0000-4000-8000-'||lpad(day::text,12,'0'))::uuid,instance_id,save_id,
 case when day in (1,2) then '65000000-0000-4000-8000-000000000101'::uuid else ('65000000-0000-4001-8000-'||lpad(day::text,12,'0'))::uuid end,
 case when day=2 then 2 else 1 end,
 'promise',case day when 1 then 'I will fund a guide, not weapons.' when 2 then 'I withdraw the weapons promise; fund the guide only.' when 30 then 'Generated successor inherits the guide charter.' else 'Irrelevant tavern weather memory '||day end,
 case day when 1 then 'fund a guide, not weapons' when 2 then 'withdraw guide only' when 30 then 'successor guide charter' else 'irrelevant '||day end,'npc',
 case when day in (1,2,30) then 3 else 1 end,
 case when day in (1,2) then array['guide','weapons']::text[] when day=30 then array['successor','guide']::text[] else array['irrelevant']::text[] end,
 'dialogue_turn',('65000000-0000-4000-8000-'||lpad(day::text,12,'0'))::uuid,1,lpad(to_hex(day),64,'0'),day,day,day,day,
 'attributed',case when day=29 then 'npc_private' else 'npc_known' end,
 case when day=1 then 'unresolved' when day=2 then 'withdrawn' else null end,
 case when day=2 then '65000000-0000-4000-8000-000000000101'::uuid else null end,
 case when day=30 then (select successor_id from pg_temp.quest_ids) else (select authored_id from pg_temp.quest_ids) end
from pg_temp.horizon cross join generate_series(1,30) day;

-- A pending day-28 source is intentionally unindexed, exercising explicit
-- fallback rather than treating recall absence as proof of no evidence.
delete from private.world_npc_memories where source_id='65000000-0000-4000-8000-000000000028';
select private.world_npc_memory_enqueue((select save_id from pg_temp.horizon),(select instance_id from pg_temp.horizon),'dialogue_turn','65000000-0000-4000-8000-000000000028',1,0,lpad(to_hex(28),64,'0'));

-- Separate save and resident scope records are deliberately tempting query
-- matches and must never cross the selected instance boundary.
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='65000000-0000-4000-8000-000000000002';
select public.create_tavern();
create temporary table pg_temp.other_save as
 select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,(x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id from (select public.npc_bar_snapshot() x) s;
reset role;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '65000000-0000-4000-8000-000000000777',save_id,instance_id,npc_id,version_id,'65000000-0000-4000-8000-000000000002','fund a guide cross-save trap',1,0,1,'completed',clock_timestamp(),'{}',clock_timestamp() from pg_temp.other_save;
insert into private.world_npc_memory_sources(source_kind,source_id,source_version,save_id,instance_id,ledger_sequence,source_hash,disclosure_class,occurred_day,occurred_sequence,learned_day,learned_sequence,envelope)
select 'dialogue_turn','65000000-0000-4000-8000-000000000777',1,save_id,instance_id,1,repeat('7',64),'npc_known',1,1,1,1,
 jsonb_build_object('kind','dialogue_turn','id','65000000-0000-4000-8000-000000000777','version',1,'ledgerSequence',1) from pg_temp.other_save;
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class)
select '65000000-0000-4000-8000-000000000778','65000000-0000-4000-8000-000000000777',instance_id,save_id,'65000000-0000-4000-8000-000000000778',1,'promise','fund a guide cross-save trap','cross-save trap','npc',3,array['guide']::text[],'dialogue_turn','65000000-0000-4000-8000-000000000777',1,repeat('7',64),1,1,1,1,'attributed','npc_known' from pg_temp.other_save;

insert into private.world_npc_memory_embedding_profiles(id,processor_version,model,dimensions)
 values('65000000-0000-4000-8000-000000000950','horizon-v1','horizon-model',2);
set local role service_role; set local request.jwt.claim.role='service_role';
select public.world_npc_memory_embedding_profile_activate('65000000-0000-4000-8000-000000000950');
reset role;
insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
select save_id,instance_id,'embedding','dialogue_turn',array['65000000-0000-4000-8000-000000000002'::uuid],array[1],lpad(to_hex(2),64,'0'),'horizon-v1','horizon-model','npc_known',
 jsonb_build_object('inputHash',lpad(to_hex(2),64,'0')),encode(extensions.digest(private.world_canonical_json(jsonb_build_object('inputHash',lpad(to_hex(2),64,'0'))),'sha256'),'hex'),'[1,0]'::extensions.vector,2,'65000000-0000-4000-8000-000000000950'::uuid from pg_temp.horizon;

-- Same-save multi-NPC trap: materialize a different packaged catalog resident
-- and give it a tempting guide record. Retrieval remains instance-scoped.
create temporary table pg_temp.same_save_npc as
 select resident.instance_id,catalog.npc_id,catalog.version_id
 from pg_temp.horizon h
 cross join lateral (select npc_id,version_id from private.npc_version_resident_packages where npc_id<>h.npc_id order by npc_id limit 1) catalog
 cross join lateral private.world_materialize_resident_from_version(h.save_id,catalog.npc_id,catalog.version_id,1) resident;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '65000000-0000-4000-8000-000000000779',h.save_id,n.instance_id,n.npc_id,n.version_id,'65000000-0000-4000-8000-000000000001','fund a guide same-save NPC trap',1,0,1,'completed',clock_timestamp(),'{}',clock_timestamp() from pg_temp.horizon h cross join pg_temp.same_save_npc n;
insert into private.world_npc_memory_sources(source_kind,source_id,source_version,save_id,instance_id,ledger_sequence,source_hash,disclosure_class,occurred_day,occurred_sequence,learned_day,learned_sequence,envelope)
select 'dialogue_turn','65000000-0000-4000-8000-000000000779',1,h.save_id,n.instance_id,1000,repeat('9',64),'npc_known',1,1,1,1,jsonb_build_object('kind','dialogue_turn','id','65000000-0000-4000-8000-000000000779','version',1,'ledgerSequence',1000) from pg_temp.horizon h cross join pg_temp.same_save_npc n;
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class)
select '65000000-0000-4000-8000-000000000780','65000000-0000-4000-8000-000000000779',n.instance_id,h.save_id,'65000000-0000-4000-8000-000000000780',1,'promise','fund a guide same-save NPC trap','same-save trap','npc',3,array['guide']::text[],'dialogue_turn','65000000-0000-4000-8000-000000000779',1,repeat('9',64),1,1,1,1,'attributed','npc_known' from pg_temp.horizon h cross join pg_temp.same_save_npc n;

-- Twenty fixed labels are a reproducible recall corpus.  Each records v3,
-- lexical v4, hybrid v4, and a generous authorized v4 baseline plus measured
-- response bytes and a non-threshold database elapsed measurement.
create temporary table pg_temp.labeled_queries(label text primary key,query text,refs text[],expected_source uuid);
insert into pg_temp.labeled_queries
select shape||'-'||repeat_no,query,refs,expected_source
from (values
 ('guide-fund','fund a guide',array['guide']::text[],'65000000-0000-4000-8000-000000000002'::uuid),
 ('guide-constraint','guide not weapons',array['guide']::text[],'65000000-0000-4000-8000-000000000002'::uuid),
 ('guide-withdrawal','weapons promise withdrawal',array['weapons']::text[],'65000000-0000-4000-8000-000000000002'::uuid),
 ('successor-charter','successor guide charter',array['successor']::text[],'65000000-0000-4000-8000-000000000030'::uuid),
 ('successor-inherit','inheriting guide',array['guide','successor']::text[],'65000000-0000-4000-8000-000000000030'::uuid)
 ) shape(shape,query,refs,expected_source) cross join generate_series(1,4) repeat_no;
grant select on pg_temp.labeled_queries to service_role;
grant select on pg_temp.quest_ids to service_role;
grant usage on schema private to service_role;
grant select on private.world_npc_memory_sources,private.world_npc_memories,private.world_quests,private.world_npc_memory_outbox,private.world_npc_memory_artifacts to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create function pg_temp.measure_evidence(p_query text,p_refs text[],p_limit integer,p_candidates integer,p_semantic boolean)
returns table(result jsonb,elapsed_microseconds bigint) language plpgsql as $f$
declare started timestamptz;
begin
 started:=clock_timestamp();
 result:=case when p_semantic then public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,p_query,p_refs,p_limit,p_candidates,16,'65000000-0000-4000-8000-000000000950','horizon-v1','horizon-model',2,'[1,0]'::extensions.vector)
 else public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,p_query,p_refs,p_limit,p_candidates,16) end;
 elapsed_microseconds:=greatest(0,(extract(epoch from clock_timestamp()-started)*1000000)::bigint);
 return next;
end $f$;
create function pg_temp.measure_v3(p_query text)
returns table(result jsonb,elapsed_microseconds bigint) language plpgsql as $f$
declare started timestamptz;
begin
 started:=clock_timestamp();
 result:=public.npc_memory_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),p_query,32,130,'speech');
 elapsed_microseconds:=greatest(0,(extract(epoch from clock_timestamp()-started)*1000000)::bigint);
 return next;
end $f$;
create temporary table pg_temp.measurements(label text,channel text,selected_count integer,required_source_recalled boolean,response_bytes integer,query_elapsed_microseconds bigint,maintenance_count integer,embedding_count integer,retry_count integer);
insert into pg_temp.measurements
select q.label,channel,coalesce(jsonb_array_length(result->'items'),0),
 exists(select 1 from jsonb_array_elements(coalesce(result->'items','[]'::jsonb)) item where item->>'sourceId'=q.expected_source::text)
   or exists(select 1 from jsonb_array_elements(coalesce(result->'bundles','[]'::jsonb)) bundle cross join lateral jsonb_array_elements(bundle->'members') member where member->>'sourceId'=q.expected_source::text),
 octet_length(result::text),elapsed_microseconds,
 (select count(*) from private.world_npc_memory_outbox where instance_id=(select instance_id from pg_temp.horizon)),
 (select count(*) from private.world_npc_memory_artifacts where instance_id=(select instance_id from pg_temp.horizon) and artifact_kind='embedding'),
 (select count(*) from private.world_npc_memory_outbox where instance_id=(select instance_id from pg_temp.horizon) and attempts>0)
from pg_temp.labeled_queries q cross join lateral (
 select 'v3'::text channel,m.result,m.elapsed_microseconds from pg_temp.measure_v3(q.query) m
 union all select 'v4_lexical',m.result,m.elapsed_microseconds from pg_temp.measure_evidence(q.query,q.refs,12,24,false) m
 union all select 'v4_hybrid',m.result,m.elapsed_microseconds from pg_temp.measure_evidence(q.query,q.refs,12,48,true) m
 union all select 'v4_authorized_baseline',m.result,m.elapsed_microseconds from pg_temp.measure_evidence(q.query,q.refs,32,128,true) m
 ) x;

select is((select count(distinct occurred_day) from private.world_npc_memory_sources where instance_id=(select instance_id from pg_temp.horizon)),30::bigint,'fixture spans thirty distinct immutable game days');
select cmp_ok((select count(*) from private.world_npc_memories where instance_id=(select instance_id from pg_temp.horizon) and importance=1),'>=',24::bigint,'fixture contains at least twenty-four irrelevant memories');
select ok(exists(select 1 from private.world_quests where id=(select authored_id from pg_temp.quest_ids) and state in ('succeeded','failed')),'fixture contains an authored terminal quest');
select ok(exists(select 1 from private.world_quests where id=(select successor_id from pg_temp.quest_ids) and origin='generated_successor' and parent_quest_id=(select authored_id from pg_temp.quest_ids)),'fixture contains a linked generated-successor quest');
select is((select count(*) from pg_temp.measurements),80::bigint,'twenty labeled cases compare four deterministic retrieval paths');
select cmp_ok((select count(*) from pg_temp.measurements where channel='v4_hybrid' and required_source_recalled),'>=',19::bigint,'hybrid achieves at least 95% required-source recall across the labeled corpus');
select is((select count(*) from pg_temp.measurements where channel='v4_hybrid' and label like 'guide-%' and required_source_recalled),12::bigint,'hybrid achieves 100% protected commitment/correction recall');
select ok(not exists(select 1 from pg_temp.labeled_queries q where q.label like 'guide-%' and not exists(select 1 from jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,q.query,q.refs,12,48,16,'65000000-0000-4000-8000-000000000950','horizon-v1','horizon-model',2,'[1,0]'::extensions.vector)->'bundles') b cross join lateral jsonb_array_elements(b->'members') m where m->>'quote' in ('fund a guide, not weapons','withdraw guide only'))),'protected commitment and attributable withdrawal are bundled for every protected query');
select ok(exists(select 1 from jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,'guide',array['guide']::text[],12,48,16)->'sourceFallback') s where s->>'sourceId'='65000000-0000-4000-8000-000000000028'),'fresh unindexed source is explicit fallback evidence');
select is((select public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,'guide',array['guide']::text[],12,48,16)::text),(select public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,'guide',array['guide']::text[],12,48,16)::text),'hybrid retrieval is deterministic across reruns');
select ok(position('cross-save trap' in public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,'guide',array['guide']::text[],12,48,16)::text)=0,'two-save evidence never crosses into the selected resident');
select ok(position('same-save trap' in public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,'guide',array['guide']::text[],12,48,16)::text)=0,'same-save second-NPC evidence never crosses the selected resident');
select ok(position('Irrelevant tavern weather memory 29' in public.npc_memory_evidence_retrieve_for_actor('65000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.horizon),'speech',130,'guide',array['guide']::text[],32,128,16)::text)=0,'speech excludes private-forbidden evidence');
select ok(not exists(select 1 from pg_temp.measurements where response_bytes<1 or query_elapsed_microseconds<0),'benchmark rows record nonnegative measured bytes and database elapsed microseconds');
select ok((select min(maintenance_count)>=1 and min(embedding_count)>=0 and min(retry_count)>=0 from pg_temp.measurements),'benchmark rows record fixture maintenance, embedding, and retry counts without claiming savings');
select ok((select count(*) from pg_temp.measurements where channel='v4_authorized_baseline' and required_source_recalled)=20,'authorized baseline supplies the required-source recall denominator');
-- Non-counting diagnostic for reproducible fixture observations. It intentionally
-- has no timing assertion and does not stand in for provider token metrics.
select jsonb_build_object('diag',jsonb_build_object(
 'channels',(select jsonb_object_agg(channel,stats) from (select channel,jsonb_build_object('p50ResponseBytes',percentile_cont(.5) within group(order by response_bytes),'p95ResponseBytes',percentile_cont(.95) within group(order by response_bytes),'p50ElapsedMicroseconds',percentile_cont(.5) within group(order by query_elapsed_microseconds),'p95ElapsedMicroseconds',percentile_cont(.95) within group(order by query_elapsed_microseconds)) stats from pg_temp.measurements group by channel) channel_stats),
 'maintenanceCount',(select max(maintenance_count) from pg_temp.measurements),'embeddingCount',(select max(embedding_count) from pg_temp.measurements),'retryCount',(select max(retry_count) from pg_temp.measurements),'providerInputTokens','UNRUN')) as diag;
select * from finish();
rollback;
