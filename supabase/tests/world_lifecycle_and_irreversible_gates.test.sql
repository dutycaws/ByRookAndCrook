begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(id,email,role,aud) values
 ('15200000-0000-4000-8000-000000000001','lifecycle-owner@example.test','authenticated','authenticated'),
 ('15200000-0000-4000-8000-000000000002','lifecycle-other@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day) values
 ('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000001',1),
 ('15200000-0000-4000-8000-000000000011','15200000-0000-4000-8000-000000000002',1);

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values
 ('15200000-0000-4000-8000-000000000101','15200000-0000-4000-8000-000000000010','npc','deep-01','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000102','15200000-0000-4000-8000-000000000010','npc','deep-02','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000103','15200000-0000-4000-8000-000000000010','npc','deep-03','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000104','15200000-0000-4000-8000-000000000010','npc','deep-04','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000105','15200000-0000-4000-8000-000000000010','npc','deep-05','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000106','15200000-0000-4000-8000-000000000010','npc','deep-06','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000107','15200000-0000-4000-8000-000000000010','npc','deep-07','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000108','15200000-0000-4000-8000-000000000010','npc','deep-08','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1),
 ('15200000-0000-4000-8000-000000000109','15200000-0000-4000-8000-000000000010','npc','support-01','procedural','procedural-world-v1','{"archetypeKey":"supporting-actor"}','active',1),
 ('15200000-0000-4000-8000-000000000110','15200000-0000-4000-8000-000000000010','location','old-quarry','procedural','procedural-world-v1','{"archetypeKey":"landmark"}','active',1),
 ('15200000-0000-4000-8000-000000000111','15200000-0000-4000-8000-000000000010','world_event','old-record','authored','world-v1','{"referencedEntityIds":["15200000-0000-4000-8000-000000000101"]}','active',1),
 ('15200000-0000-4000-8000-000000000112','15200000-0000-4000-8000-000000000010','npc','deep-09-inactive','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','undiscovered',1);
select is((select count(*) from private.world_generated_entity_lifecycle where save_id='15200000-0000-4000-8000-000000000010'),11::bigint,'procedural deep, supporting, and location entities receive lifecycle records');
select is((select entity_role from private.world_generated_entity_lifecycle where entity_id='15200000-0000-4000-8000-000000000109'),'supporting_actor','supporting actor role is durable metadata');
select throws_ok($$insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values('15200000-0000-4000-8000-000000000010','npc','deep-09','procedural','procedural-world-v1','{"archetypeKey":"deep-npc"}','active',1)$$,'PT409',null,'ninth active deep NPC is rejected by the hard cap');
select lives_ok($$insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values('15200000-0000-4000-8000-000000000010','location','tenth-place','procedural','procedural-world-v1','{"archetypeKey":"landmark"}','active',1)$$,'location remains below its independent cap');
insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values('15200000-0000-4000-8000-000000000112','activated','{}','world-lifecycle-v2');
select throws_ok($$update private.world_canonical_entities set lifecycle='active' where id='15200000-0000-4000-8000-000000000112'$$,'PT409',null,'inactive generated entity cannot bypass a role cap by becoming active');
insert into private.world_effect_warnings(save_id,target_entity_id,warning_key,visible_day) values('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000101','direct-warning',1);
insert into private.world_effect_receipts(save_id,target_entity_id,effect_key,capability,critic_status,public_full_day,input_fingerprint,committed_at) values('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000101','direct-reference','reversible','approved',true,'direct-reference-v2',clock_timestamp());
select ok(private.world_generated_entity_is_protected('15200000-0000-4000-8000-000000000101'),'external history plus direct warning and receipt references protect a generated entity');

set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_promote_supporting_actor('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000109','need a leader')$$,'PT409',null,'promotion respects the deep NPC cap');
select is((public.world_demote_low_relevance_deep_npc('15200000-0000-4000-8000-000000000010','make room')->>'entityId'),'15200000-0000-4000-8000-000000000102','deterministic demotion skips the protected low-score candidate and uses explicit tie breaking');
reset role;
select is((select entity_role from private.world_generated_entity_lifecycle where entity_id='15200000-0000-4000-8000-000000000102'),'supporting_actor','demotion changes only mutable lifecycle casting');
select throws_ok($$insert into private.world_irreversible_capabilities(save_id,target_entity_id,capability_key,critic_approved,immutable_at,gate_version) values('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110','retire_entity',true,clock_timestamp(),'irreversible-gate-v2')$$,'23514',null,'arbitrary text cannot manufacture a v2 critic approval');
insert into private.world_irreversible_capabilities(id,save_id,target_entity_id,capability_key,critic_approved,immutable_at,gate_version,critic_evidence_ref) values('15200000-0000-4000-8000-000000000120','15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110','retire_entity',true,clock_timestamp(),'irreversible-gate-v2','critic-eval-immutable-v2');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_promote_supporting_actor('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000109','promote after demotion')->>'status'),'promoted','supporting actor can be promoted once capacity exists');
reset role;
insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15200000-0000-4000-8000-000000000010','npc','support-'||lpad(n::text,2,'0'),'procedural','procedural-world-v1','{"archetypeKey":"supporting-actor"}','active',1 from generate_series(2,40) n;
select throws_ok($$insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values('15200000-0000-4000-8000-000000000010','npc','support-41','procedural','procedural-world-v1','{"archetypeKey":"supporting-actor"}','active',1)$$,'PT409',null,'forty-first active supporting actor is rejected by the hard cap');
insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15200000-0000-4000-8000-000000000010','location','place-'||n,'procedural','procedural-world-v1','{"archetypeKey":"landmark"}','active',1 from generate_series(3,8) n;
select throws_ok($$insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values('15200000-0000-4000-8000-000000000010','location','place-09','procedural','procedural-world-v1','{"archetypeKey":"landmark"}','active',1)$$,'PT409',null,'ninth active location is rejected by the hard cap');
insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '15200000-0000-4000-8000-000000000010','item','generated-item-'||n,'procedural','procedural-world-v1','{}','active',1 from generate_series(1,94) n;
select throws_ok($$insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values('15200000-0000-4000-8000-000000000010','item','generated-item-095','procedural','procedural-world-v1','{}','active',1)$$,'PT409',null,'one-hundred-fifty-first active generated entity is rejected by the hard cap');
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.warning as select public.world_issue_irreversible_entity_warning('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110','15200000-0000-4000-8000-000000000120','The old quarry will close after tomorrow.') value;
select is((select value->>'status' from pg_temp.warning),'warning_issued','warning issuance returns a durable receipt');
create temporary table pg_temp.first_warning as select (value->>'capabilityId')::uuid capability_id,(value->>'warningId')::uuid warning_id from pg_temp.warning;
select throws_ok(format('select public.world_retire_generated_entity(%L::uuid,%L::uuid,(select capability_id from pg_temp.first_warning),(select warning_id from pg_temp.first_warning),%L,%L)','15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110',repeat('a',64),'too early'),'23514',null,'retirement cannot commit before one complete public warning day');
reset role;
update public.tavern_saves set current_day=2 where id='15200000-0000-4000-8000-000000000010';
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_retire_generated_entity('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110',(select capability_id from pg_temp.first_warning),(select warning_id from pg_temp.first_warning),repeat('b',64),'quarry exhausted')->>'status'),'retired','retirement commits only after the exact capability and public warning mature');
select ok((public.world_retire_generated_entity('15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110',(select capability_id from pg_temp.first_warning),(select warning_id from pg_temp.first_warning),repeat('b',64),'quarry exhausted')->>'replayed')::boolean,'retirement replays its exact immutable receipt');
select throws_ok(format('select public.world_retire_generated_entity(%L::uuid,%L::uuid,%L::uuid,(select warning_id from pg_temp.first_warning),%L,%L)','15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000110','15200000-0000-4000-8000-000000000121',repeat('b',64),'changed input'),'PT409',null,'same retirement fingerprint rejects changed immutable inputs');
reset role;
select is((select lifecycle from private.world_canonical_entities where id='15200000-0000-4000-8000-000000000110'),'retired','retirement excludes the entity from active caps while retaining canonical identity');
select ok(exists(select 1 from private.world_canonical_entity_history where entity_id='15200000-0000-4000-8000-000000000110' and event_kind='retired'),'retirement retains readable append-only canonical history');

set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15200000-0000-4000-8000-000000000001';
select is((public.world_irreversible_warning_status('15200000-0000-4000-8000-000000000010')->'warnings'->0->>'effectKey'),'retire_entity','owner receives the safe public warning projection');
select ok(not (public.world_irreversible_warning_status('15200000-0000-4000-8000-000000000010')::text ~ '(criticProof|capabilityId|inputFingerprint)'),'public warning projection excludes private gate evidence');
set local request.jwt.claim.sub='15200000-0000-4000-8000-000000000002';
select throws_ok($$select public.world_irreversible_warning_status('15200000-0000-4000-8000-000000000010')$$,'PT403',null,'other player cannot read a save warning projection');
reset role;

select * from finish();
rollback;
