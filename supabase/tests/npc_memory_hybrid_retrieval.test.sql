begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
select has_function('private','world_npc_memory_evidence_retrieve',array['uuid','uuid','text','bigint','text','text[]','integer','integer','integer','uuid','text','text','integer','extensions.vector'],'private hybrid evidence boundary exists');
select has_function('public','npc_memory_evidence_retrieve_for_actor',array['uuid','uuid','text','bigint','text','text[]','integer','integer','integer','uuid','text','text','integer','extensions.vector'],'service evidence facade exists');
select ok(not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where a.amname in ('ivfflat','hnsw')),'hybrid retrieval adds no approximate vector index');
insert into auth.users(id,email,role,aud) values
 ('20200000-0000-4000-8000-000000000001','hybrid-owner@test','authenticated','authenticated'),
 ('20200000-0000-4000-8000-000000000002','hybrid-other@test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='20200000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.f as select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,(x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id,(x#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() x) q;
grant select on pg_temp.f to service_role;
reset role;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select id,save_id,instance_id,npc_id,version_id,'20200000-0000-4000-8000-000000000001',text,seq,revision,1,'completed',clock_timestamp(),jsonb_build_object('reply','reply '||seq),clock_timestamp()
from pg_temp.f cross join (values
 ('20200000-0000-4001-8000-000000000001'::uuid,0,'Moonwell promise'),
 ('20200000-0000-4001-8000-000000000002'::uuid,1,'Private council'),
 ('20200000-0000-4001-8000-000000000003'::uuid,2,'Fresh canonical source'),
 ('20200000-0000-4001-8000-000000000004'::uuid,3,'New corrected promise'),
 ('20200000-0000-4001-8000-000000000005'::uuid,4,'Low recent one'),
 ('20200000-0000-4001-8000-000000000006'::uuid,5,'Low recent two'),
 ('20200000-0000-4001-8000-000000000007'::uuid,6,'System only')
) v(id,seq,text);
insert into private.world_npc_memory_sources(source_kind,source_id,source_version,save_id,instance_id,ledger_sequence,source_hash,disclosure_class,occurred_day,occurred_sequence,learned_day,learned_sequence,envelope)
select 'dialogue_turn',id,1,save_id,instance_id,seq,repeat(hash,64),disclosure,1,seq,1,seq,jsonb_build_object('kind','dialogue_turn','id',id,'version',1,'ledgerSequence',seq,'keeper',text)
from pg_temp.f cross join (values
 ('20200000-0000-4001-8000-000000000001'::uuid,0,'Moonwell promise','npc_known','a'),
 ('20200000-0000-4001-8000-000000000002'::uuid,1,'Private council','npc_private','b'),
 ('20200000-0000-4001-8000-000000000003'::uuid,2,'Fresh canonical source','npc_known','c'),
 ('20200000-0000-4001-8000-000000000004'::uuid,3,'New corrected promise','npc_known','d'),
 ('20200000-0000-4001-8000-000000000005'::uuid,4,'Low recent one','npc_known','e'),
 ('20200000-0000-4001-8000-000000000006'::uuid,5,'Low recent two','npc_known','f'),
 ('20200000-0000-4001-8000-000000000007'::uuid,6,'System only','system','a')
) v(id,seq,text,disclosure,hash);
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,correction_memory_id)
select id,id,instance_id,save_id,root,version,'promise',text,quote,'npc',importance,refs,'dialogue_turn',id,1,repeat(hash,64),1,seq,1,seq,'attributed',disclosure,status,correction
from pg_temp.f cross join (values
 ('20200000-0000-4001-8000-000000000001'::uuid,'20200000-0000-4002-8000-000000000001'::uuid,1,0,'Moonwell promise','Moonwell',3,array['Moonwell']::text[],'npc_known','unresolved',null::uuid,'a'),
 ('20200000-0000-4001-8000-000000000002'::uuid,'20200000-0000-4002-8000-000000000002'::uuid,1,1,'Private council','private',3,'{}','npc_private',null,null::uuid,'b'),
 ('20200000-0000-4001-8000-000000000004'::uuid,'20200000-0000-4002-8000-000000000001'::uuid,2,3,'New corrected promise','withdrawn',3,array['Moonwell']::text[],'npc_known','withdrawn','20200000-0000-4001-8000-000000000001'::uuid,'d'),
 ('20200000-0000-4001-8000-000000000005'::uuid,'20200000-0000-4002-8000-000000000005'::uuid,1,4,'Low recent one','low one',1,'{}','npc_known',null,'20200000-0000-4001-8000-000000000002'::uuid,'e'),
 ('20200000-0000-4001-8000-000000000006'::uuid,'20200000-0000-4002-8000-000000000006'::uuid,1,5,'Low recent two','low two',1,'{}','npc_known',null,null::uuid,'f'),
 ('20200000-0000-4001-8000-000000000007'::uuid,'20200000-0000-4002-8000-000000000007'::uuid,1,6,'System only','system-only',3,'{}','system',null,null::uuid,'a')
) v(id,root,version,seq,text,quote,importance,refs,disclosure,status,correction,hash);
reset role;
insert into private.world_npc_memory_embedding_profiles(id,processor_version,model,dimensions) values('20200000-0000-4003-8000-000000000001','hybrid-v1','hybrid-model',2);
set local role service_role; set local request.jwt.claim.role='service_role';
select public.world_npc_memory_embedding_profile_activate('20200000-0000-4003-8000-000000000001');
reset role;
insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
select save_id,instance_id,'embedding','dialogue_turn',array['20200000-0000-4001-8000-000000000004'::uuid],array[1],repeat('d',64),'hybrid-v1','hybrid-model','npc_known',jsonb_build_object('inputHash',repeat('d',64)),encode(extensions.digest(private.world_canonical_json(jsonb_build_object('inputHash',repeat('d',64))),'sha256'),'hex'),'[1,0]'::extensions.vector,2,'20200000-0000-4003-8000-000000000001'::uuid from pg_temp.f;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.npc_memory_evidence_retrieve_for_actor(null,null,'speech',null,'',array[]::text[],12,24,6)$$,'PT400',null,'null scope is rejected before data access');
select throws_ok(format($$select public.npc_memory_evidence_retrieve_for_actor(%L,%L,'speech',null,' bad ',array[]::text[],12,24,6)$$,'20200000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f)),'PT400',null,'non-normalized query is rejected');
select throws_ok(format($$select public.npc_memory_evidence_retrieve_for_actor(%L,%L,'speech',null,'',array[]::text[],12,24,6,'20200000-0000-4000-8000-000000000001',null,null,null,null)$$,'20200000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f)),'PT400',null,'partial embedding identity is rejected');
select throws_ok(format($$select public.npc_memory_evidence_retrieve_for_actor(%L,%L,'speech',null,'',array[]::text[],12,24,6)$$,'20200000-0000-4000-8000-000000000002',(select instance_id from pg_temp.f)),'PT404',null,'service role still validates save ownership');
select is((select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'Moonwell',array['Moonwell']::text[],12,24,6)->>'retrievalVersion' from pg_temp.f),'npc-memory-evidence-v4','hybrid contract version is fixed');
select ok(position('private' in (select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)::text from pg_temp.f))=0,'speech never emits npc_private evidence');
select ok(position('private' in (select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'review',null,'',array[]::text[],12,24,6)::text from pg_temp.f))=0,'review never emits npc_private evidence');
select ok(position('private' in (select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'deliberation',null,'',array[]::text[],12,24,6)::text from pg_temp.f))>0,'deliberation can emit npc_private evidence');
select ok(position('system-only' in (select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'deliberation',null,'',array[]::text[],12,24,6)::text from pg_temp.f))=0,'system evidence is never emitted');
select ok(not exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',2,'',array[]::text[],12,24,6)->'items') i where i->>'quote'='withdrawn'),'cutoff never exceeds caller ledger cutoff');
select ok(not exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'items') i where i->>'quote'='Moonwell'),'current record versions suppress older roots');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',2,'Moonwell',array['Moonwell']::text[],12,24,6)->'items') i where i->'selectionReasons' ? 'exact_reference'),'exact known reference is labeled relationally');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,1)->'sourceFallback') i where i->>'sourceId'='20200000-0000-4001-8000-000000000003'),'unindexed current source is surfaced as canonical fallback');
select is((select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'Moonwell',array['Moonwell']::text[],12,24,6)::text from pg_temp.f),(select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'Moonwell',array['Moonwell']::text[],12,24,6)::text from pg_temp.f),'fusion, bundles, and manifest are deterministic');
select throws_ok(format($$select public.npc_memory_evidence_retrieve_for_actor(%L,%L,'speech',null,'',array[]::text[],12,8,6)$$,'20200000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f)),'PT400',null,'candidate budget cannot fall below result budget');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'bundles') b cross join lateral jsonb_array_elements(b->'members') m where m->>'quote'='Moonwell'),'bundle includes historical root evidence rather than only current rows');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'items') i where i ?& array['truthClass','disclosureClass','relatedQuestId','correctionMemoryId','entityRefs','importance','occurredDay','occurredSequence','learnedDay','learnedSequence']),'selected evidence has complete typed metadata');
select ok((select (public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'items'->0->'selectionReasons') = (select to_jsonb(array_agg(distinct x order by x)) from jsonb_array_elements_text(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'items'->0->'selectionReasons') x) from pg_temp.f),'selection reasons are distinct');
select is((select i->>'quote' from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'items') with ordinality q(i,n) where i->'selectionReasons' ? 'important_recent' order by n desc limit 1),'low one','recent-only candidates use deterministic recent rank order');
select ok((select (public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'coverage'->>'complete')='false' and exists(select 1 from jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'',array[]::text[],12,24,6)->'bundles') b where b->'coverage'->'missingRequiredIds' ? '20200000-0000-4001-8000-000000000002' and (b->'coverage'->>'requiredTotal')::integer>(b->'coverage'->>'requiredIncluded')::integer) from pg_temp.f),'unavailable correction is an explicit required coverage gap');
select is((select public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'Moonwell',array['Moonwell']::text[],12,24,6,'20200000-0000-4003-8000-000000000001','hybrid-v1','hybrid-model',2,'[1,0]'::extensions.vector)->'semantic'->>'availability' from pg_temp.f),'ready','exact profile-bound semantic channel is available');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('20200000-0000-4000-8000-000000000001',instance_id,'speech',null,'Moonwell',array['Moonwell']::text[],12,24,6,'20200000-0000-4003-8000-000000000001','hybrid-v1','hybrid-model',2,'[1,0]'::extensions.vector)->'items') i where i->'selectionReasons' ? 'semantic_exact'),'semantic rank is fused into eligible evidence');
reset role;
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='20200000-0000-4000-8000-000000000001';
select throws_ok(format($$select public.npc_memory_evidence_retrieve_for_actor(%L,%L,'speech',null,'',array[]::text[],12,24,6)$$,'20200000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f)),'42501',null,'authenticated callers cannot use server evidence boundary');
select * from finish();
rollback;
