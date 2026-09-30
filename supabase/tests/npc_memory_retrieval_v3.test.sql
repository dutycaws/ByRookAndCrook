begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
select has_index('private','world_npc_memories','world_npc_memory_search','v3 retains the ledger FTS GIN index');
insert into auth.users(id,email,role,aud) values
 ('19700000-0000-4000-8000-000000000001','retrieval-owner@test','authenticated','authenticated'),
 ('19700000-0000-4000-8000-000000000002','retrieval-other@test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19700000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.f as select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,(x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id,(x#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() x) q;
grant select on pg_temp.f to service_role;
reset role;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select id,save_id,instance_id,npc_id,version_id,'19700000-0000-4000-8000-000000000001',text,seq,revision,1,'completed',clock_timestamp(),jsonb_build_object('reply','reply '||seq),clock_timestamp()
from pg_temp.f cross join (values
 ('19700000-0000-4001-8000-000000000001'::uuid,'Open quest vow',0),('19700000-0000-4001-8000-000000000002'::uuid,'Fox lantern exact phrase',1),('19700000-0000-4001-8000-000000000003'::uuid,'Private review only',2),('19700000-0000-4001-8000-000000000004'::uuid,'After cutoff phrase',9)
) v(id,text,seq);
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status)
select id,id,instance_id,save_id,root,version,'promise',text,quote,'npc',importance,'{}','dialogue_turn',id,1,repeat(hash,64),1,seq,1,seq,'attributed',disclosure,status
from pg_temp.f cross join (values
 ('19700000-0000-4001-8000-000000000001'::uuid,'19700000-0000-4002-8000-000000000001'::uuid,1,'Open quest vow','open vow',3,0,'npc_known','unresolved','a'),
 ('19700000-0000-4001-8000-000000000002'::uuid,'19700000-0000-4002-8000-000000000002'::uuid,1,'Fox lantern exact phrase','fox lantern',2,1,'npc_known',null,'b'),
 ('19700000-0000-4001-8000-000000000003'::uuid,'19700000-0000-4002-8000-000000000003'::uuid,1,'Private review only','secret review',3,2,'npc_private',null,'c'),
 ('19700000-0000-4001-8000-000000000004'::uuid,'19700000-0000-4002-8000-000000000004'::uuid,1,'After cutoff phrase','after cutoff',3,9,'npc_known',null,'d')
 ) as v(id,root,version,text,quote,importance,seq,disclosure,status,hash);
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19700000-0000-4000-8000-000000000001';
select throws_ok(format('select public.npc_memory_retrieve(%L,%L,12,null,%L)',(select instance_id from pg_temp.f),'anything','review'),'42501',null,'authenticated review elevation fails before candidate selection');
select is((select public.npc_memory_retrieve(instance_id,'fox',12,1,'speech')->>'retrievalVersion' from pg_temp.f),'npc-memory-retrieval-v3','speech retrieval reports v3 contract');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_retrieve(instance_id,'fox',12,1,'speech')->'items') i where i->>'selection_reason'='lexical'),'lexical query records a machine-readable lexical reason after protected obligations');
select is((select i->>'quote' from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_retrieve(instance_id,'fox',12,1,'speech')->'items') i where i->>'selection_reason'='lexical'),'fox lantern','exact lexical reference ranks deterministically within lexical tier');
select ok(position('secret review' in (select public.npc_memory_retrieve(instance_id,'',12,9,'speech')::text from pg_temp.f))=0,'speech output and fallback never expose npc_private');
select ok(position('after cutoff' in (select public.npc_memory_retrieve(instance_id,'',12,1,'speech')::text from pg_temp.f))=0,'cutoff excludes records fallback and manifest sources');
select is((select public.npc_memory_retrieve(instance_id,'',12,1,'speech')->'sourceFallback'->0->>'keeper' from pg_temp.f),'Open quest vow','fallback is the canonical completed dialogue exchange, not derived prose');
select ok(not exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_retrieve(instance_id,'',12,1,'speech')->'sourceManifest') m where m->>'id'='19700000-0000-4001-8000-000000000004'),'manifest excludes the post-cutoff fallback source');
select ok(not exists(select 1 from pg_temp.f scope cross join lateral jsonb_array_elements(public.npc_memory_retrieve(scope.instance_id,'',12,1,'speech')->'sourceFallback') fallback where not exists(select 1 from jsonb_array_elements(public.npc_memory_retrieve(scope.instance_id,'',12,1,'speech')->'sourceManifest') manifest where manifest->>'id'=fallback->>'turnId')),'every emitted fallback turn has a canonical manifest identity');
select is((select public.npc_memory_retrieve(instance_id,'none',12,1,'speech')->'items'->0->>'selection_reason' from pg_temp.f),'unresolved_commitment','no lexical match deliberately retains relational obligation first');
select is((select public.npc_memory_retrieve(instance_id,'none',12,1,'speech')::text from pg_temp.f),(select public.npc_memory_retrieve(instance_id,'none',12,1,'speech')::text from pg_temp.f),'complete no-match retrieval is byte-for-byte deterministic');
reset role;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select '19700000-0000-4001-8000-000000000005',save_id,instance_id,npc_id,version_id,'19700000-0000-4000-8000-000000000001','The vow was withdrawn.',3,revision,1,'completed',clock_timestamp(),'{"reply":"withdrawn"}',clock_timestamp() from pg_temp.f;
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status)
select '19700000-0000-4001-8000-000000000005','19700000-0000-4001-8000-000000000005',instance_id,save_id,'19700000-0000-4002-8000-000000000001',2,'promise','The prior vow is withdrawn.','withdrawn vow','npc',3,'{}','dialogue_turn','19700000-0000-4001-8000-000000000005',1,repeat('e',64),1,3,1,3,'attributed','npc_known','withdrawn' from pg_temp.f;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at) select id,save_id,instance_id,npc_id,version_id,'19700000-0000-4000-8000-000000000001',text,seq,revision,1,'completed',clock_timestamp(),jsonb_build_object('reply','ref'),clock_timestamp() from pg_temp.f cross join (values ('19700000-0000-4001-8000-000000000006'::uuid,'Moonwell reference',4),('19700000-0000-4001-8000-000000000007'::uuid,'Other reference',5)) v(id,text,seq);
insert into private.world_npc_memories(id,turn_id,instance_id,save_id,record_root_id,record_version,kind,text,quote,speaker,importance,entity_refs,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class)
select id,id,instance_id,save_id,root,1,'interaction',text,quote,'npc',2,refs,'dialogue_turn',id,1,repeat(hash,64),1,seq,1,seq,'attributed','npc_known' from pg_temp.f cross join (values ('19700000-0000-4001-8000-000000000006'::uuid,'19700000-0000-4002-8000-000000000006'::uuid,'Moonwell reference','Moonwell',4,array['Moonwell']::text[],'f'),('19700000-0000-4001-8000-000000000007'::uuid,'19700000-0000-4002-8000-000000000007'::uuid,'Other reference','Other',5,array['Other']::text[],'g')) v(id,root,text,quote,seq,refs,hash);
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19700000-0000-4000-8000-000000000001';
select ok(not exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_retrieve(instance_id,'none',12,3,'speech')->'items') i where i->>'quote'='open vow'),'later withdrawn correction suppresses older unresolved root version');
select is((select public.npc_memory_retrieve(instance_id,'none',12,3,'speech')->'items'->0->>'selection_reason' from pg_temp.f),'important_recent','withdrawn root no longer receives unresolved priority');
select ok(exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_retrieve(instance_id,'Moonwell',12,5,'speech')->'items') i where i->>'quote'='Moonwell' and i->>'selection_reason'='exact_reference') and not exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_retrieve(instance_id,'Moonwell',12,5,'speech')->'items') i where i->>'quote'='Other' and i->>'selection_reason'='exact_reference'),'exact entity reference selects only the matching entity row');
reset role;
select throws_ok(format('select public.npc_memory_retrieve(%L,%L,0,null,%L)',(select instance_id from pg_temp.f),'','transition'),'42501',null,'public transition elevation is denied');
reset role;
set local role service_role; set local request.jwt.claim.role='service_role';
select ok(position('secret review' in (select public.npc_memory_retrieve_for_actor('19700000-0000-4000-8000-000000000001',instance_id,'secret',12,9,'review')::text from pg_temp.f))>0,'service role may request validated review view');
select throws_ok(format('select public.npc_memory_retrieve_for_actor(%L,%L,%L,12,null,%L)','19700000-0000-4000-8000-000000000002',(select instance_id from pg_temp.f),'fox','speech'),'PT404',null,'service actor still requires explicit save ownership');
select throws_ok(format('select public.npc_memory_retrieve_for_actor(%L,%L,%L,12,null,null)','19700000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'fox'),'PT400',null,'service null view is rejected before disclosure selection');
select is((select public.npc_memory_retrieve_for_actor('19700000-0000-4000-8000-000000000001',instance_id,'',12,1,'speech')->'sourceManifest' from pg_temp.f),
 (select public.npc_memory_retrieve_for_actor('19700000-0000-4000-8000-000000000001',instance_id,'',12,1,'speech')->'sourceManifest' from pg_temp.f),'repeat retrieval has deterministic canonical manifest order');
reset role;
select * from finish(); rollback;
