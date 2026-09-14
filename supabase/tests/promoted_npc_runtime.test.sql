begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('private','world_promoted_npc_definitions','promoted canonical NPC definitions are private and durable');
select has_table('private','world_promoted_npc_receipts','promotion keeps an immutable exact replay receipt');
select has_function('public','world_promote_canonical_npc',array['uuid','uuid'],'promotion uses a service-only canonical bridge');
select ok(not has_function_privilege('authenticated','public.world_promote_canonical_npc(uuid,uuid)','execute'),'players cannot promote arbitrary canon into the dialogue runtime');

insert into auth.users(id,email,role,aud) values
 ('15800000-0000-4000-8000-000000000001','promoted-owner@example.test','authenticated','authenticated'),
 ('15800000-0000-4000-8000-000000000002','promoted-other@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15800000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
grant select on pg_temp.fixture to service_role;

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15800000-0000-4000-8000-000000000103',save_id,'npc','mara-fenn','procedural','procedural-world-v1',
jsonb_build_object('archetypeKey','supporting-actor','proposedName','Mara Fenn','payload',jsonb_build_object(
  'identity',jsonb_build_object('name','Mara Fenn','title','Roadside Courier','shortDescription','A reliable courier who knows the turning paths around the tavern and nearby roads.','voice','Direct and observant, with a preference for useful details over dramatic claims.'),
  'role','courier','homeLocation','old-road'
)),'active',1 from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_promote_canonical_npc((select save_id from pg_temp.fixture),'15800000-0000-4000-8000-000000000103')$$,'PT409',null,'an active but unpromoted supporting actor cannot enter the deep resident runtime');
select is((public.world_promote_supporting_actor((select save_id from pg_temp.fixture),'15800000-0000-4000-8000-000000000103','Recurring courier now anchors a quest')->>'status'),'promoted','supporting actor promotion records the lifecycle transition before deep runtime creation');
create temporary table pg_temp.supporting_promoted as select public.world_promote_canonical_npc(save_id,'15800000-0000-4000-8000-000000000103') result from pg_temp.fixture;
select is((select result->>'status' from pg_temp.supporting_promoted),'promoted','a lifecycle-promoted supporting actor joins the generic resident runtime');
reset role;
select is((select definition_version from private.world_promoted_npc_definitions where canonical_entity_id='15800000-0000-4000-8000-000000000103'),'promoted-supporting-template-v1','the frozen promoted definition records the versioned supporting template');

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15800000-0000-4000-8000-000000000101',save_id,'npc','rowan-vale','procedural','procedural-world-v1',
jsonb_build_object('archetypeKey','deep-npc','proposedName','Rowan Vale','payload',jsonb_build_object(
  'identity',jsonb_build_object('name','Rowan Vale','title','Wandering Scout','shortDescription','A patient traveler who listens before choosing the next safe trail.','voice','Quiet and practical, with careful observations and a habit of naming concrete risks.'),
  'profile',jsonb_build_object('values',jsonb_build_array('protect travelers'),'likes',jsonb_build_array('careful maps'),'dislikes',jsonb_build_array('recklessness'),'boundaries',jsonb_build_array('Will not abandon a companion in danger')),
  'capabilities',jsonb_build_object('archetypeKey','scout'),
  'appearance',jsonb_build_object('physicalAppearance','A weathered traveler with alert eyes and a steady, patient expression.','attire','A forest-green cloak, practical boots, and a well-kept travel pack.','notableFeatures','A braided trail cord and a small brass compass worn close to the heart.','mood','Watchful but approachable when the room feels safe and the purpose is clear.')
)),'active',1 from pg_temp.fixture;

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.promoted as select public.world_promote_canonical_npc(save_id,'15800000-0000-4000-8000-000000000101') result from pg_temp.fixture;
select is((select result->>'status' from pg_temp.promoted),'promoted','service promotion returns a resident receipt');
select is((select result->>'replayed' from pg_temp.promoted),'false','first promotion creates a frozen generated resident');
grant select on pg_temp.promoted to authenticated;
reset role;
select ok(exists(select 1 from private.world_promoted_npc_definitions d join private.world_npc_instances i on i.npc_id=d.npc_id and i.save_id=d.save_id where d.canonical_entity_id='15800000-0000-4000-8000-000000000101'),'promotion creates one save-scoped resident instance');
select ok(exists(select 1 from private.world_resident_profiles p join private.world_resident_evolution_pins pin on pin.instance_id=p.instance_id join private.world_promoted_npc_definitions d on d.npc_id=p.npc_id where d.canonical_entity_id='15800000-0000-4000-8000-000000000101' and p.profile_schema_version='personality-schema-v1' and pin.definition_version='promoted-resident-v1'),'promotion freezes profile and capability pins before the resident exists');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_promote_canonical_npc((select save_id from pg_temp.fixture),'15800000-0000-4000-8000-000000000101')->>'replayed'),'true','exact canonical promotion replays the same resident identity');
select is((public.world_promote_canonical_npc((select save_id from pg_temp.fixture),'15800000-0000-4000-8000-000000000101')->>'instanceId'),(select result->>'instanceId' from pg_temp.promoted),'promotion replay preserves the exact generated resident instance');
reset role;

set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15800000-0000-4000-8000-000000000001';
select ok(jsonb_array_length(public.npc_roster())>=3,'the roster remains a bounded mixed-origin projection');
select ok(exists(select 1 from jsonb_array_elements(public.npc_roster()) row where row->>'name'='Rowan Vale' and row->>'origin'='procedural' and row->>'creator' is null),'owner sees a generated resident through the normal roster contract');
select ok(public.npc_journals(array[(select (result->>'instanceId')::uuid from pg_temp.promoted)]) ? (select result->>'instanceId' from pg_temp.promoted),'owner receives the generated resident through the normal journal contract');
reset role;

set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15800000-0000-4000-8000-000000000002';
select is(public.npc_resident((select (result->>'instanceId')::uuid from pg_temp.promoted)),null,'another save cannot select the promoted resident');
select is(public.npc_journals(array[(select (result->>'instanceId')::uuid from pg_temp.promoted)]),'{}'::jsonb,'another save cannot read the promoted resident journal');
reset role;

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15800000-0000-4000-8000-000000000102',save_id,'npc','broken-scout','procedural','procedural-world-v1',jsonb_build_object('archetypeKey','deep-npc','proposedName','Broken Scout','payload',jsonb_build_object('identity',jsonb_build_object('name','Broken Scout'))),'active',1 from pg_temp.fixture;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_promote_canonical_npc((select save_id from pg_temp.fixture),'15800000-0000-4000-8000-000000000102')$$,'PT422',null,'incomplete canonical NPC payload cannot become a deep resident');
reset role;

select ok(not has_table_privilege('authenticated','private.world_promoted_npc_definitions','select'),'players cannot read frozen promoted profiles or capabilities');
select * from finish();
rollback;
