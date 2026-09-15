begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(not has_table_privilege('authenticated','private.world_pilot_resident_procedural_definitions','select'),'players cannot read pilot procedural definitions');
select ok(not has_table_privilege('authenticated','private.world_resident_procedural_capability_sources','select'),'players cannot read resident procedural capability sources');

insert into auth.users(id,email,role,aud) values ('16000000-0000-4000-8000-000000000001','pilot-procedural-owner@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='16000000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
alter table pg_temp.fixture add column resident_id uuid;
update pg_temp.fixture set resident_id=(select id from private.world_npc_instances where save_id=pg_temp.fixture.save_id order by id limit 1);

select is((select definition_version from private.world_resident_evolution_pins where instance_id=(select resident_id from pg_temp.fixture)),'pilot-resident-v1','the historical evolution pin remains unchanged');
select is((select definition_version from private.world_resident_procedural_capability_sources where instance_id=(select resident_id from pg_temp.fixture)),'pilot-resident-v2','fresh tavern insert trigger installs the immutable procedural source');
select ok((select capability_envelope->'allowedWorldEffects' ?& array['create_entity','create_quest','update_quest','record_world_event'] and capability_envelope->'allowedTargetKinds' ?& array['npc','item','recipe','world_event'] and not capability_envelope->'irreversibleEffects' ? 'retire_entity' from private.world_resident_procedural_capability_sources where instance_id=(select resident_id from pg_temp.fixture)),'the active source grants exactly the finite procedural effects without retirement');
select ok(not (private.world_procedural_resident_capability((select save_id from pg_temp.fixture),(select resident_id from pg_temp.fixture))->'allowedWorldEffects' ? 'retire_entity'),'context resolver excludes irreversible retirement');
select throws_ok($$update private.world_resident_procedural_capability_sources set definition_version='pilot-resident-v1'$$,'55000',null,'resident procedural capability sources are immutable');
select throws_ok($$delete from private.world_resident_procedural_capability_sources$$,'55000',null,'direct source deletion remains rejected');
select throws_ok($$delete from private.world_pilot_resident_procedural_definitions$$,'55000',null,'pilot procedural definitions are immutable');
select lives_ok($$select private.world_install_pilot_procedural_capability_source((select resident_id from pg_temp.fixture))$$,'installer is idempotent after fresh-trigger activation');
select is((select count(*) from private.world_resident_procedural_capability_sources where instance_id=(select resident_id from pg_temp.fixture)),1::bigint,'fresh-trigger activation retains exactly one immutable source');

create temporary table pg_temp.attempt(s uuid,j uuid,f uuid);
insert into pg_temp.attempt values ('16000000-0000-4000-8000-000000000020','16000000-0000-4000-8000-000000000021','16000000-0000-4000-8000-000000000022');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
select s,save_id,2,0,'pilot-procedural-baseline','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.attempt cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
select j,s,1,'procedural_world','processing',encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),private.world_procedural_world_context(save_id),'procedural-world-v1' from pg_temp.attempt cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.attempt;
create function pg_temp.proposal() returns jsonb language sql as $$
  select jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(
    jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select resident_id::text from pg_temp.fixture),'entityKind','npc','entityKey','procedural-scout','archetypeKey','deep-npc','proposedName','A Procedural Scout','payload',jsonb_build_object('region','north')),
    jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select resident_id::text from pg_temp.fixture),'entityKind','item','entityKey','procedural-provisions','archetypeKey','trade-good','proposedName','Procedural Provisions','payload',jsonb_build_object('region','north')),
    jsonb_build_object('operation','quest','effectKind','create_quest','ownerResidentId',(select resident_id::text from pg_temp.fixture),'primitiveKey','successor-quest','action','prepare','approach','scouting','targetEntityRefs',jsonb_build_array((select resident_id::text from pg_temp.fixture)),'motivation','Prepare supplies for the next settlement.')
  ))
$$;
grant select on pg_temp.fixture,pg_temp.attempt to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.result as select public.world_settlement_commit_procedural_world(s,j,f,pg_temp.proposal()) result from pg_temp.attempt;
reset role;
select ok((select result->>'status'='completed' and jsonb_array_length(result->'operations')=3 from pg_temp.result),'fresh pilot capability context accepts NPC, item, and successor quest commands');
select ok(exists(select 1 from private.world_canonical_entities where save_id=(select save_id from pg_temp.fixture) and entity_kind='npc' and entity_key='procedural-scout') and exists(select 1 from private.world_canonical_entities where save_id=(select save_id from pg_temp.fixture) and entity_kind='item' and entity_key='procedural-provisions') and exists(select 1 from private.world_procedural_quests where save_id=(select save_id from pg_temp.fixture) and primitive_key='successor-quest'),'the valid commit materializes the finite NPC item and successor quest path');

insert into auth.users(id,email,role,aud) values ('16000000-0000-4000-8000-000000000002','pilot-procedural-cleanup@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='16000000-0000-4000-8000-000000000002';
select public.create_tavern();
create temporary table pg_temp.cleanup_fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
select lives_ok($$delete from public.tavern_saves where id=(select save_id from pg_temp.cleanup_fixture)$$,'save cleanup cascades through procedural capability sources without bypassing immutability');

select * from finish();
rollback;
