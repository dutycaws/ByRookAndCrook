begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
select ok(not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='private' and t.relname='world_npc_memory_artifacts' and am.amname in ('ivfflat','hnsw')),'semantic retrieval has no approximate vector index');

insert into auth.users(id,email,role,aud) values
 ('19800000-0000-4000-8000-000000000001','embedding-owner@test','authenticated','authenticated'),
 ('19800000-0000-4000-8000-000000000002','embedding-other@test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19800000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.f as select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,(x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id,(x#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() x) q;
grant select on pg_temp.f to service_role;
reset role;

insert into private.world_npc_memory_embedding_profiles(id,processor_version,model,dimensions) values
 ('19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3),
 ('19800000-0000-4000-8000-000000000102','npc-embedding-v4','model-b',2);
select throws_ok($$insert into private.world_npc_memory_embedding_profiles(processor_version,model,dimensions) values('npc-embedding-v3','other-model',4)$$,'23505',null,'processor version cannot identify multiple immutable embedding profiles');
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok($$select public.world_npc_memory_embedding_profile_activate('19800000-0000-4000-8000-000000000101')$$,'service role activates one immutable embedding profile');
reset role;
select is((select count(*) from private.world_npc_memory_embedding_profiles where active and invalidated_at is null),1::bigint,'exactly one embedding profile is active');
select throws_ok($$update private.world_npc_memory_embedding_profiles set model='tampered' where id='19800000-0000-4000-8000-000000000101'$$,'PT409',null,'profile model/version/dimensions identity is immutable');

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select id,save_id,instance_id,npc_id,version_id,'19800000-0000-4000-8000-000000000001',message,seq,revision,1,'completed',clock_timestamp(),jsonb_build_object('reply','reply '||seq),clock_timestamp()
from pg_temp.f cross join (values
 ('19800000-0000-4001-8000-000000000001'::uuid,'semantic first',0),
 ('19800000-0000-4001-8000-000000000002'::uuid,'semantic tie',1),
 ('19800000-0000-4001-8000-000000000003'::uuid,'private semantic',2),
 ('19800000-0000-4001-8000-000000000005'::uuid,'invalidated semantic',3),
 ('19800000-0000-4001-8000-000000000004'::uuid,'future semantic',9)
) v(id,message,seq);
select private.world_npc_memory_register_source('dialogue_turn',id) from (values
 ('19800000-0000-4001-8000-000000000001'::uuid),('19800000-0000-4001-8000-000000000002'::uuid),
 ('19800000-0000-4001-8000-000000000003'::uuid),('19800000-0000-4001-8000-000000000004'::uuid),
 ('19800000-0000-4001-8000-000000000005'::uuid)
) v(id);
update private.world_npc_memory_sources set disclosure_class='npc_private' where source_id='19800000-0000-4001-8000-000000000003';

insert into private.world_npc_memory_artifacts(id,save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
select a.artifact_id,f.save_id,f.instance_id,'embedding','dialogue_turn',array[a.source_id],array[1],s.source_hash,a.version,a.model,s.disclosure_class,
 jsonb_build_object('sourceId',a.source_id),encode(extensions.digest(private.world_canonical_json(jsonb_build_object('sourceId',a.source_id)),'sha256'),'hex'),a.vector,a.dimensions,a.profile_id
from pg_temp.f f cross join (values
 ('19800000-0000-4002-8000-000000000001'::uuid,'19800000-0000-4001-8000-000000000001'::uuid,'npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,'19800000-0000-4000-8000-000000000101'::uuid),
 ('19800000-0000-4002-8000-000000000002'::uuid,'19800000-0000-4001-8000-000000000002'::uuid,'npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,'19800000-0000-4000-8000-000000000101'::uuid),
 ('19800000-0000-4002-8000-000000000003'::uuid,'19800000-0000-4001-8000-000000000003'::uuid,'npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,'19800000-0000-4000-8000-000000000101'::uuid),
 ('19800000-0000-4002-8000-000000000004'::uuid,'19800000-0000-4001-8000-000000000004'::uuid,'npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,'19800000-0000-4000-8000-000000000101'::uuid),
 ('19800000-0000-4002-8000-000000000005'::uuid,'19800000-0000-4001-8000-000000000001'::uuid,'npc-embedding-v4','model-b',2,'[1,0]'::extensions.vector,'19800000-0000-4000-8000-000000000102'::uuid)
) a(artifact_id,source_id,version,model,dimensions,vector,profile_id) join private.world_npc_memory_sources s on s.source_id=a.source_id and s.source_kind='dialogue_turn';

select throws_ok($$insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
 select save_id,instance_id,'embedding','dialogue_turn',array['19800000-0000-4001-8000-000000000001'::uuid],array[1],source_hash,'npc-embedding-v3','model-a',disclosure_class,'{}'::jsonb,encode(extensions.digest(private.world_canonical_json('{}'::jsonb),'sha256'),'hex'),'[1,0]'::extensions.vector,2,'19800000-0000-4000-8000-000000000101'::uuid from private.world_npc_memory_sources where source_id='19800000-0000-4001-8000-000000000001'$$,'PT400',null,'artifact vector dimensions must exactly match its profile');
select throws_ok($$insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
 select save_id,instance_id,'embedding','dialogue_turn',array['19800000-0000-4001-8000-000000000001'::uuid],array[1],source_hash,'npc-embedding-v3',null,disclosure_class,'{}'::jsonb,encode(extensions.digest(private.world_canonical_json('{}'::jsonb),'sha256'),'hex'),'[1,0,0]'::extensions.vector,3,'19800000-0000-4000-8000-000000000101'::uuid from private.world_npc_memory_sources where source_id='19800000-0000-4001-8000-000000000001'$$,'PT400',null,'embedding model is required and profile-bound');
select throws_ok($$insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
 select save_id,instance_id,'embedding','dialogue_turn',array['19800000-0000-4001-8000-000000000001'::uuid],array[1],source_hash,'npc-embedding-v3','model-a',disclosure_class,'{}'::jsonb,encode(extensions.digest(private.world_canonical_json('{}'::jsonb),'sha256'),'hex'),'[0,0,0]'::extensions.vector,3,'19800000-0000-4000-8000-000000000101'::uuid from private.world_npc_memory_sources where source_id='19800000-0000-4001-8000-000000000001'$$,'PT400',null,'zero-norm artifact vectors are rejected before storage');
select lives_ok($$insert into private.world_npc_memory_artifacts(id,save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id,invalidated_at)
 select '19800000-0000-4002-8000-000000000006'::uuid,save_id,instance_id,'embedding','dialogue_turn',array['19800000-0000-4001-8000-000000000005'::uuid],array[1],source_hash,'npc-embedding-v3','model-a',disclosure_class,jsonb_build_object('sourceId','19800000-0000-4001-8000-000000000005'),encode(extensions.digest(private.world_canonical_json(jsonb_build_object('sourceId','19800000-0000-4001-8000-000000000005')),'sha256'),'hex'),'[1,0,0]'::extensions.vector,3,'19800000-0000-4000-8000-000000000101'::uuid,clock_timestamp() from private.world_npc_memory_sources where source_id='19800000-0000-4001-8000-000000000005'$$,'invalidated embedding history remains immutable but is not active');
select throws_ok($$update private.world_npc_memory_artifacts set content='{}'::jsonb where id='19800000-0000-4002-8000-000000000001'$$,'PT409',null,'accepted profile-bound artifact is immutable');

insert into private.world_npc_memory_outbox(save_id,instance_id,source_kind,source_id,source_version,source_sequence,source_hash,processor_kind,processor_version)
select save_id,instance_id,'dialogue_turn',source_id,source_version,ledger_sequence,source_hash,'embedding','npc-embedding-v3'
from private.world_npc_memory_sources where source_id='19800000-0000-4001-8000-000000000001';
create temporary table pg_temp.generic_embedding_payload as
select jsonb_build_array(jsonb_build_object('artifactKind','embedding','sourceKind','dialogue_turn','disclosureClass','npc_known','model','model-a','content',jsonb_build_object('sourceId','19800000-0000-4001-8000-000000000001'),'contentHash',encode(extensions.digest(private.world_canonical_json(jsonb_build_object('sourceId','19800000-0000-4001-8000-000000000001')),'sha256'),'hex'),'embedding','[1,0,0]','embeddingDimensions',3)) payload;
grant select on pg_temp.generic_embedding_payload to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.embedding_claim as select public.world_npc_memory_claim('embedding','npc-embedding-v3') claim;
select throws_ok(format('select public.world_npc_memory_complete(%L,%L,%L::jsonb,null)',
 (select claim->>'id' from pg_temp.embedding_claim),(select claim->>'fence' from pg_temp.embedding_claim),
 (select payload::text from pg_temp.generic_embedding_payload)
 ),
 'PT400','Embedding artifact must reference a profile','generic completion rejects an otherwise valid unprofiled embedding artifact');
reset role;

set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='19800000-0000-4000-8000-000000000001';
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,3,%L::extensions.vector)', '19800000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a','[1,0,0]'),'42501',null,'semantic retrieval is service-only');
reset role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,3,%L::extensions.vector,12,1,null)', '19800000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a','[1,0,0]'),'PT400',null,'null semantic view is rejected before retrieval');
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,2,%L::extensions.vector)', '19800000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a','[1,0]'),'PT400',null,'query vector dimensions are checked before similarity search');
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,3,%L::extensions.vector)', '19800000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a','[0,0,0]'),'PT400',null,'zero-norm query vectors are rejected before cosine ranking');
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,3,%L::extensions.vector)', '19800000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000102','npc-embedding-v4','model-b','[1,0]'),'PT400',null,'inactive profile/version cannot mix into active semantic search');
select is((select jsonb_agg(i->>'artifactId' order by ordinal) from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,12,1,'speech')->'items') with ordinality x(i,ordinal)),jsonb_build_array('19800000-0000-4002-8000-000000000001','19800000-0000-4002-8000-000000000002'),'exact cosine ties use stable artifact id ordering and exclude future/private/profile-mismatched rows');
select ok(not exists(select 1 from pg_temp.f cross join lateral jsonb_array_elements(public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,12,9,'speech')->'items') i where i->>'artifactId' in ('19800000-0000-4002-8000-000000000003','19800000-0000-4002-8000-000000000006')),'speech excludes private and invalidated embedding artifacts before cosine ranking');
select ok(position('19800000-0000-4002-8000-000000000003' in (select public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,12,9,'review')::text from pg_temp.f))>0,'validated service review may include private semantic evidence');
select is((select public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3,'[0,0,1]'::extensions.vector,12,-1,'speech')->>'availability' from pg_temp.f),'no_candidates','valid profile with no eligible candidates reports machine-readable availability');
select is((select public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,null,null,null,null,null,12,1,'speech')->>'semanticAvailable' from pg_temp.f),'false','missing profile never claims semantic relevance');
select is((select public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,12,1,'speech')::text from pg_temp.f),(select public.npc_memory_semantic_retrieve_for_actor('19800000-0000-4000-8000-000000000001',instance_id,'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a',3,'[1,0,0]'::extensions.vector,12,1,'speech')::text from pg_temp.f),'semantic results are byte-for-byte deterministic');
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,3,%L::extensions.vector)', '19800000-0000-4000-8000-000000000002',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a','[1,0,0]'),'PT404',null,'service actor remains scoped to the owning save and instance');
select lives_ok($$select public.world_npc_memory_embedding_profile_activate('19800000-0000-4000-8000-000000000102')$$,'activation safely swaps from v3 to v4 under the one-active index');
reset role;
select is((select id::text from private.world_npc_memory_embedding_profiles where active),'19800000-0000-4000-8000-000000000102','v4 is the sole active profile after swap');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.npc_memory_semantic_retrieve_for_actor(%L,%L,%L,%L,%L,3,%L::extensions.vector)', '19800000-0000-4000-8000-000000000001',(select instance_id from pg_temp.f),'19800000-0000-4000-8000-000000000101','npc-embedding-v3','model-a','[1,0,0]'),'PT400',null,'deactivated v3 profile is rejected for search');
select lives_ok($$select public.world_npc_memory_embedding_profile_activate('19800000-0000-4000-8000-000000000101')$$,'activation safely restores v3 for subsequent rebuild passes');
reset role;
select * from finish();
rollback;
