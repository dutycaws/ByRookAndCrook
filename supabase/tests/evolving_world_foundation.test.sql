begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users(id,email,role,aud) values
 ('17100000-0000-4000-8000-000000000001','world-owner@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id) values ('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000001');
insert into private.world_npc_instances(id,save_id,npc_id,version_id,arrived_day)
values ('17100000-0000-4000-8000-000000000020','17100000-0000-4000-8000-000000000010','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
insert into private.world_npc_instances(id,save_id,npc_id,version_id,arrived_day)
values ('17100000-0000-4000-8000-000000000022','17100000-0000-4000-8000-000000000010','28282828-2828-4282-8282-282828282828','28282828-2828-4282-8282-282828282829',1);

select ok(not has_table_privilege('authenticated','private.world_canonical_entities','select'),'canonical world entities are private');
select ok(not has_table_privilege('authenticated','private.world_settlements','select'),'settlement internals are private');
select has_function('public','advance_tavern_day',array['uuid','uuid','bigint'],'existing public advance-day wrapper remains callable by name');
select has_function('private','advance_tavern_day_before_community_npcs',array['uuid','uuid','bigint'],'existing private advance-day wrapper chain remains intact');
select is((select world_phase from public.tavern_saves where id='17100000-0000-4000-8000-000000000010'),'open','existing saves receive the additive open world phase');

insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,lifecycle,payload) values
 ('17100000-0000-4000-8000-000000000010','location','old-road','authored','discovered','{"name":"Old Road"}');
select is((select lifecycle from private.world_canonical_entities where entity_key='old-road'),'discovered','canonical entity records retain discovery lifecycle');
select throws_ok($$insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,payload) values ('17100000-0000-4000-8000-000000000010','location','old-road','procedural','{}')$$,null,null,'canonical key is unique within a save and entity kind');
insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) select id,'created','{}','world-v1' from private.world_canonical_entities where entity_key='old-road';
select throws_ok($$update private.world_canonical_entity_history set event_kind='revised'$$,'55000',null,'canonical history is append-only');
select throws_ok($$update private.world_canonical_entities set payload='{"rewritten":true}' where entity_key='old-road'$$,'55000',null,'canonical payload cannot be rewritten outside an append-only revision path');
select throws_ok($$delete from private.world_canonical_entities where entity_key='old-road'$$,'55000',null,'canonical entities cannot be deleted with their history');

select is((select version_id from private.world_resident_profiles where instance_id='17100000-0000-4000-8000-000000000020'),'18181818-1818-4181-8181-181818181819'::uuid,'resident profile backfill pins immutable NPC version');
select is((select profile_schema_version from private.world_resident_profiles where instance_id='17100000-0000-4000-8000-000000000020'),'resident-profile-compat-v1','backfill gives every resident an explicit compatibility profile schema');
select ok((select current_profile ? 'identity' and public_disposition ? 'name' from private.world_resident_profiles where instance_id='17100000-0000-4000-8000-000000000020'),'current profile and bounded public disposition are separate from frozen source pins');
insert into private.world_resident_personality_ledger(instance_id,profile_revision,receipt_key,delta) values ('17100000-0000-4000-8000-000000000020',1,'17100000-0000-4000-8000-000000000021','{"caution":2}');
select throws_ok($$delete from private.world_resident_personality_ledger$$,'55000',null,'personality ledger is append-only');
select throws_ok($$update private.world_resident_profiles set current_profile='{"changed":true}' where instance_id='17100000-0000-4000-8000-000000000020'$$,'55000',null,'profile state cannot change without a receipt-backed revision');
insert into private.world_resident_beliefs(instance_id,fingerprint,statement,confidence,provenance) values ('17100000-0000-4000-8000-000000000020','oldroadv1','The old road is dangerous.',70,'authored');
select throws_ok($$insert into private.world_resident_beliefs(instance_id,fingerprint,statement,confidence,provenance) values ('17100000-0000-4000-8000-000000000020','oldroadv1','Duplicate belief.',60,'event')$$,null,null,'one active belief fingerprint exists per resident');
insert into private.world_resident_belief_history(belief_id,event_kind) select id,'retired' from private.world_resident_beliefs where fingerprint='oldroadv1';
select lives_ok($$update private.world_resident_beliefs set active=false,contradiction_status='retracted',retired_at=clock_timestamp() where fingerprint='oldroadv1'$$,'beliefs support a controlled retraction after append-only history');
insert into private.world_social_edges(save_id,from_instance_id,to_instance_id,trust,affection,respect,fear,obligation) values
 ('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000020',(select id from private.world_npc_instances where save_id='17100000-0000-4000-8000-000000000010' and id<>'17100000-0000-4000-8000-000000000020' limit 1),10,0,20,-10,5);
select ok((select trust=10 and fear=-10 from private.world_social_edges limit 1),'directed social edges preserve bounded relationship dimensions');

insert into private.world_procedural_quests(save_id,instance_id,primitive_key,input_fingerprint,payload,started_day) values
 ('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000020','scout-route','quest-input-v1','{}',1);
select throws_ok($$insert into private.world_procedural_quests(save_id,instance_id,primitive_key,input_fingerprint,payload,started_day) values ('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000020','duplicate','x','{}',1)$$,null,null,'one active procedural quest exists per resident');
select throws_ok($$insert into private.world_effect_receipts(save_id,effect_key,capability,critic_status,public_full_day,input_fingerprint) values ('17100000-0000-4000-8000-000000000010','permanent-loss','irreversible','pending',false,'effect-v1')$$,null,null,'irreversible effects require approved critic and public full-day validation');
insert into private.world_effect_receipts(save_id,effect_key,capability,critic_status,public_full_day,input_fingerprint) values ('17100000-0000-4000-8000-000000000010','permanent-loss','irreversible','approved',true,'effect-v1');
select is((select capability from private.world_effect_receipts where effect_key='permanent-loss'),'irreversible','validated irreversible effect receipt can be recorded');
select throws_ok($$insert into private.world_effect_receipts(save_id,effect_key,capability,critic_status,public_full_day,input_fingerprint,committed_at) values ('17100000-0000-4000-8000-000000000010','bypass-loss','irreversible','approved',true,'effect-bypass',clock_timestamp())$$,'23514',null,'caller-supplied critic flags cannot commit an irreversible effect without immutable capability and warning proof');
update public.tavern_saves set current_day=2 where id='17100000-0000-4000-8000-000000000010';
insert into private.world_effect_warnings(id,save_id,target_instance_id,warning_key,visible_day) values ('17100000-0000-4000-8000-000000000023','17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000020','loss-warning',1);
insert into private.world_irreversible_capabilities(id,save_id,target_instance_id,capability_key,critic_approved,immutable_at) values ('17100000-0000-4000-8000-000000000024','17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000020','loss-v1',true,clock_timestamp());
insert into private.world_effect_receipts(save_id,effect_key,capability,critic_status,public_full_day,input_fingerprint,target_instance_id,capability_id,warning_id,committed_at) values ('17100000-0000-4000-8000-000000000010','proved-loss','irreversible','approved',true,'effect-proved','17100000-0000-4000-8000-000000000020','17100000-0000-4000-8000-000000000024','17100000-0000-4000-8000-000000000023',clock_timestamp());
select throws_ok($$update private.world_irreversible_capabilities set critic_approved=false where id='17100000-0000-4000-8000-000000000024'$$,'55000',null,'immutable capability approval cannot be toggled after it is pinned');
insert into private.world_effect_receipts(save_id,effect_key,capability,input_fingerprint) values ('17100000-0000-4000-8000-000000000010','repeatable-rumor','reversible','rumor-1'),('17100000-0000-4000-8000-000000000010','repeatable-rumor','reversible','rumor-2');
select is((select count(*) from private.world_effect_receipts where effect_key='repeatable-rumor'),2::bigint,'same registered effect type may recur with a new causal fingerprint');

insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,deadline_at) values ('17100000-0000-4000-8000-000000000030','17100000-0000-4000-8000-000000000010',1,0,'settlement-v1',clock_timestamp()+interval '120 seconds');
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,input_fingerprint) values
 ('17100000-0000-4000-8000-000000000031','17100000-0000-4000-8000-000000000030',1,'snapshot','job-1'),
 ('17100000-0000-4000-8000-000000000032','17100000-0000-4000-8000-000000000030',2,'canon','job-2');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at,fence,lease_until) values
 ('17100000-0000-4000-8000-000000000040','17100000-0000-4000-8000-000000000010',2,0,'reclaim-v1','processing',clock_timestamp()+interval '30 seconds','17100000-0000-4000-8000-000000000041',clock_timestamp()-interval '1 second');
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,input_fingerprint,status) values
 ('17100000-0000-4000-8000-000000000042','17100000-0000-4000-8000-000000000040',1,'snapshot','reclaim-job','processing');
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values
 ('17100000-0000-4000-8000-000000000042',1,'17100000-0000-4000-8000-000000000041',clock_timestamp()-interval '1 second');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at,terminal_receipt) values ('17100000-0000-4000-8000-000000000043','17100000-0000-4000-8000-000000000010',4,0,'terminal-v1','completed',clock_timestamp()-interval '1 hour','{"status":"completed"}');
select throws_ok($$insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint) values ('17100000-0000-4000-8000-000000000030',1,'resident','duplicate-order')$$,null,null,'settlement jobs have a stable unique order');

set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17100000-0000-4000-8000-000000000001';
select is((public.world_settlement_status('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000030')->>'status'),'queued','owner gets only a narrow settlement projection');
select throws_ok($$select public.world_settlement_claim('17100000-0000-4000-8000-000000000030')$$,'42501',null,'clients cannot claim settlement work');
reset role;

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.reclaimed as select public.world_settlement_claim_next() value;
select is((select value->>'jobId' from pg_temp.reclaimed),'17100000-0000-4000-8000-000000000042','claim-next discovers and reclaims an expired worker lease in deterministic deadline order');
select isnt((select value->>'fence' from pg_temp.reclaimed),'17100000-0000-4000-8000-000000000041','reclaimed work receives a new fencing token');
create temporary table pg_temp.claim as select public.world_settlement_claim('17100000-0000-4000-8000-000000000030') value;
select is((select value->>'jobId' from pg_temp.claim),'17100000-0000-4000-8000-000000000031','claim selects the lowest ordered queued job');
select lives_ok(format('select public.world_settlement_heartbeat(%L::uuid,%L::uuid)','17100000-0000-4000-8000-000000000030',(select value->>'fence' from pg_temp.claim)),'matching worker fence can renew a lease');
select throws_ok(format('select public.world_settlement_complete(%L::uuid,%L::uuid,%L::uuid,%L::jsonb)','17100000-0000-4000-8000-000000000030','17100000-0000-4000-8000-000000000031','17100000-0000-4000-8000-000000000099','{}'),'PT409',null,'stale fence cannot commit an active job');
select is((public.world_settlement_complete('17100000-0000-4000-8000-000000000030','17100000-0000-4000-8000-000000000031',(select (value->>'fence')::uuid from pg_temp.claim),'{}')->>'status'),'completed','matching fence completes its ordered job');
create temporary table pg_temp.claim_two as select public.world_settlement_claim('17100000-0000-4000-8000-000000000030') value;
select is((select value->>'jobId' from pg_temp.claim_two),'17100000-0000-4000-8000-000000000032','next claim advances deterministically to the next ordered job');
select public.world_settlement_fail('17100000-0000-4000-8000-000000000030','17100000-0000-4000-8000-000000000032',(select (value->>'fence')::uuid from pg_temp.claim_two),'TEMPORARY') as fail_receipt \gset
select is(:'fail_receipt'::jsonb->>'status','retrying','failure produces a bounded retry surface before terminal failure');
select is(:'fail_receipt'::jsonb->>'attempts','1','attempts are durably recorded with a maximum-bound counter');
create temporary table pg_temp.replay as select public.world_settlement_complete('17100000-0000-4000-8000-000000000030','17100000-0000-4000-8000-000000000031',(select (value->>'fence')::uuid from pg_temp.claim),'{}') value;
select is((select value->>'status' from pg_temp.replay),'completed','same job fence completion replays its exact durable action receipt');
reset role;

insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at) values ('17100000-0000-4000-8000-000000000050','17100000-0000-4000-8000-000000000010',3,0,'deadline-v1','queued',clock_timestamp()-interval '1 second');
insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint) values ('17100000-0000-4000-8000-000000000050',1,'snapshot','deadline-job');
update public.tavern_saves set world_phase='settling' where id='17100000-0000-4000-8000-000000000010';
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_settlement_claim('17100000-0000-4000-8000-000000000050')->>'status'),'expired','deadline finalizer returns a terminal no-op receipt');
reset role;
select is((select world_phase from public.tavern_saves where id='17100000-0000-4000-8000-000000000010'),'open','deadline finalizer reopens the settling save phase');

insert into auth.users(id,email,role,aud) values ('17100000-0000-4000-8000-000000000002','world-other@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id) values ('17100000-0000-4000-8000-000000000060','17100000-0000-4000-8000-000000000002');
insert into private.world_npc_instances(id,save_id,npc_id,version_id,arrived_day) values ('17100000-0000-4000-8000-000000000061','17100000-0000-4000-8000-000000000060','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
select throws_ok($$insert into private.world_social_edges(save_id,from_instance_id,to_instance_id) values ('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000020','17100000-0000-4000-8000-000000000061')$$,'23514',null,'directed social edges reject cross-save residents');
select throws_ok($$insert into private.world_irreversible_capabilities(save_id,target_instance_id,capability_key) values ('17100000-0000-4000-8000-000000000010','17100000-0000-4000-8000-000000000061','cross-save-capability')$$,'23514',null,'irreversible capability rejects a target from another save');
insert into private.world_effect_warnings(id,save_id,target_instance_id,warning_key,visible_day) values ('17100000-0000-4000-8000-000000000062','17100000-0000-4000-8000-000000000060','17100000-0000-4000-8000-000000000061','other-warning',1);
insert into private.world_irreversible_capabilities(id,save_id,target_instance_id,capability_key,critic_approved,immutable_at) values ('17100000-0000-4000-8000-000000000063','17100000-0000-4000-8000-000000000060','17100000-0000-4000-8000-000000000061','other-loss-v1',true,clock_timestamp());
select throws_ok($$insert into private.world_effect_receipts(save_id,effect_key,capability,critic_status,public_full_day,input_fingerprint,target_instance_id,capability_id,warning_id,committed_at) values ('17100000-0000-4000-8000-000000000010','cross-save-receipt','irreversible','approved',true,'cross-save-effect','17100000-0000-4000-8000-000000000020','17100000-0000-4000-8000-000000000063','17100000-0000-4000-8000-000000000062',clock_timestamp())$$,'23514',null,'irreversible receipt cannot combine capability or warning from another save');

select * from finish();
rollback;
