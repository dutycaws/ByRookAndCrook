begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select has_function('public','world_discover_procedural_npc_promotions',array['uuid','uuid'],'promotion discovery is scoped to a procedural settlement job');
select has_function('public','world_retry_procedural_npc_promotion',array['uuid','uuid'],'failed promotion work has a bounded service retry seam');
select ok(not has_function_privilege('authenticated','public.world_discover_procedural_npc_promotions(uuid,uuid)','execute'),'players cannot sweep generated NPCs into the runtime');
select ok(not has_function_privilege('authenticated','public.world_retry_procedural_npc_promotion(uuid,uuid)','execute'),'players cannot requeue settlement work');

insert into auth.users(id,email,role,aud) values
 ('15900000-0000-4000-8000-000000000001','bridge-owner@example.test','authenticated','authenticated'),
 ('15900000-0000-4000-8000-000000000002','bridge-other@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15900000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
grant select on pg_temp.fixture to service_role;
reset role;

insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at)
select '15900000-0000-4000-8000-000000000010',save_id,1,1,repeat('a',64),'queued',clock_timestamp()+interval '2 minutes' from pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint)
values ('15900000-0000-4000-8000-000000000011','15900000-0000-4000-8000-000000000010',1,'procedural_world','completed',repeat('a',64));

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15900000-0000-4000-8000-000000000101',save_id,'npc','bridge-rowan','procedural','procedural-world-v1',
jsonb_build_object('archetypeKey','deep-npc','proposedName','Bridge Rowan','payload',jsonb_build_object(
  'identity',jsonb_build_object('name','Bridge Rowan','title','Scout','shortDescription','A careful scout who keeps the road safe for travelers.','voice','Plainspoken and alert, with a habit of naming practical risks before acting.'),
  'profile',jsonb_build_object('values',jsonb_build_array('protect travelers'),'likes',jsonb_build_array('careful maps'),'dislikes',jsonb_build_array('recklessness'),'boundaries',jsonb_build_array('Will not abandon a companion in danger')),
  'capabilities',jsonb_build_object('archetypeKey','scout'),
  'appearance',jsonb_build_object('physicalAppearance','A weathered traveler with alert eyes and a steady expression.','attire','A forest cloak, practical boots, and a well-kept travel pack.','notableFeatures','A braided trail cord and a brass compass worn close to the heart.','mood','Watchful and approachable when the room feels safe and the purpose is clear.')
)),'active',1 from pg_temp.fixture;
insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15900000-0000-4000-8000-000000000102',save_id,'npc','bridge-mara','procedural','procedural-world-v1',
jsonb_build_object('archetypeKey','supporting-actor','proposedName','Bridge Mara','payload',jsonb_build_object(
  'identity',jsonb_build_object('name','Bridge Mara','title','Courier','shortDescription','A reliable courier who knows the turning paths around the tavern.','voice','Direct and observant, with a preference for useful details over drama.'),
  'role','courier','homeLocation','old-road'
)),'active',1 from pg_temp.fixture;
insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15900000-0000-4000-8000-000000000103',save_id,'npc','unrelated-deep','procedural','procedural-world-v1',
jsonb_build_object('archetypeKey','deep-npc','proposedName','Unrelated Deep','payload',jsonb_build_object(
  'identity',jsonb_build_object('name','Unrelated Deep','title','Scout','shortDescription','A careful scout who keeps the road safe for travelers.','voice','Plainspoken and alert, with a habit of naming practical risks before acting.'),
  'profile',jsonb_build_object('values',jsonb_build_array('protect travelers'),'likes',jsonb_build_array('careful maps'),'dislikes',jsonb_build_array('recklessness'),'boundaries',jsonb_build_array('Will not abandon a companion in danger')),
  'capabilities',jsonb_build_object('archetypeKey','scout'),
  'appearance',jsonb_build_object('physicalAppearance','A weathered traveler with alert eyes and a steady expression.','attire','A forest cloak, practical boots, and a well-kept travel pack.','notableFeatures','A braided trail cord and a brass compass worn close to the heart.','mood','Watchful and approachable when the room feels safe and the purpose is clear.')
)),'active',1 from pg_temp.fixture;

set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_promote_supporting_actor((select save_id from pg_temp.fixture),'15900000-0000-4000-8000-000000000102','Bridge promotion')->>'status'),'promoted','supporting actor has immutable lifecycle promotion before discovery');
reset role;
insert into private.world_procedural_command_receipts(job_id,proposal_fingerprint,canonical_proposal,result)
values ('15900000-0000-4000-8000-000000000011',repeat('a',64),'{}',jsonb_build_object('operations',jsonb_build_array(
 jsonb_build_object('operation','entity','entityId','15900000-0000-4000-8000-000000000101','entityKind','npc','reused',false),
 jsonb_build_object('operation','entity','entityId','15900000-0000-4000-8000-000000000102','entityKind','npc','reused',false)
)));
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at)
select '15900000-0000-4000-8000-000000000020',save_id,2,1,repeat('b',64),'queued',clock_timestamp()+interval '2 minutes' from pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint) values
 ('15900000-0000-4000-8000-000000000021','15900000-0000-4000-8000-000000000020',1,'procedural_world','completed',repeat('b',64)),
 ('15900000-0000-4000-8000-000000000022','15900000-0000-4000-8000-000000000020',2,'news','completed',repeat('b',64));
insert into private.world_procedural_command_receipts(job_id,proposal_fingerprint,canonical_proposal,result)
values ('15900000-0000-4000-8000-000000000021',repeat('b',64),'{}',jsonb_build_object('operations',jsonb_build_array(
 jsonb_build_object('operation','entity','entityId','15900000-0000-4000-8000-000000000103','entityKind','npc','reused',false)
)));

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.discovery as select public.world_discover_procedural_npc_promotions('15900000-0000-4000-8000-000000000010','15900000-0000-4000-8000-000000000011') result;
select is((select result->>'status' from pg_temp.discovery),'completed','discovery promotes only durable receipt-owned candidates');
select is((select result->>'promotedCount' from pg_temp.discovery),'2','bounded discovery reports count without entity identifiers');
select is((public.world_discover_procedural_npc_promotions('15900000-0000-4000-8000-000000000010','15900000-0000-4000-8000-000000000011')->>'status'),'reused','exact discovery replay is idempotent');
select throws_ok($$select public.world_retry_procedural_npc_promotion('15900000-0000-4000-8000-000000000010','15900000-0000-4000-8000-000000000011')$$,'PT409',null,'a successfully promoted receipt cannot be requeued');
select throws_ok($$select public.world_discover_procedural_npc_promotions('15900000-0000-4000-8000-000000000020','15900000-0000-4000-8000-000000000021')$$,'PT409',null,'discovery rejects a stale procedural job after later settlement work advanced');
reset role;
update private.world_settlement_jobs set status='queued',completed_at=null where id='15900000-0000-4000-8000-000000000022';
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_retry_procedural_npc_promotion('15900000-0000-4000-8000-000000000020','15900000-0000-4000-8000-000000000021')->>'status'),'retrying','an unpromoted receipt-owned candidate permits the exact job retry');
reset role;
select is((select status from private.world_settlement_jobs where id='15900000-0000-4000-8000-000000000021'),'queued','retry returns the durable command job to the normal claimer');
select is((select count(*) from private.world_promoted_npc_definitions where canonical_entity_id in ('15900000-0000-4000-8000-000000000101','15900000-0000-4000-8000-000000000102')),2::bigint,'direct deep NPCs and lifecycle-promoted supporting actors both freeze into runtime residents');
select is((select count(*) from private.world_promoted_npc_definitions where canonical_entity_id='15900000-0000-4000-8000-000000000103'),0::bigint,'receipt discovery cannot sweep an unrelated deep NPC');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_discover_procedural_npc_promotions('15900000-0000-4000-8000-000000000020','15900000-0000-4000-8000-000000000021')$$,'PT409',null,'discovery requires the completed procedural job state');
reset role;
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15900000-0000-4000-8000-000000000002';
select throws_ok($$select public.world_discover_procedural_npc_promotions('15900000-0000-4000-8000-000000000010','15900000-0000-4000-8000-000000000011')$$,'42501',null,'another player cannot invoke service discovery');
reset role;
select * from finish();
rollback;
