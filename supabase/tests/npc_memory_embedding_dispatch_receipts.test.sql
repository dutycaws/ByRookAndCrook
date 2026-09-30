begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

select has_function('public','world_npc_memory_embedding_prepare_dispatch',array['uuid','uuid'],'embedding receipt prepare RPC exists');
select has_function('public','world_npc_memory_embedding_mark_dispatched',array['uuid','uuid'],'embedding receipt mark RPC exists');
select has_function('public','world_npc_memory_embedding_recover_dispatch',array['uuid','uuid'],'embedding receipt recovery RPC exists');
select ok(not has_function_privilege('authenticated','public.world_npc_memory_embedding_prepare_dispatch(uuid,uuid)','EXECUTE'),'authenticated cannot prepare embedding dispatch');
select ok(not has_function_privilege('authenticated','public.world_npc_memory_embedding_mark_dispatched(uuid,uuid)','EXECUTE'),'authenticated cannot mark embedding dispatch');
select ok(not has_function_privilege('authenticated','public.world_npc_memory_embedding_recover_dispatch(uuid,uuid)','EXECUTE'),'authenticated cannot recover embedding dispatch');
select ok(not has_table_privilege('service_role','private.world_npc_memory_embedding_dispatches','SELECT'),'service role cannot bypass embedding receipt RPCs');

insert into auth.users(id,email,role,aud) values ('20000000-0000-4000-8000-000000000001','embedding-receipts@test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='20000000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.f as
select (x#>>'{save,id}')::uuid save_id,(x->'roster'->0->>'instanceId')::uuid instance_id,
 (x->'roster'->0->>'npcId')::uuid npc_id,(x->'roster'->0->>'versionId')::uuid version_id,
 (x#>>'{save,revision}')::bigint revision from (select public.npc_bar_snapshot() x) q;
grant select on pg_temp.f to service_role;
reset role;

insert into private.world_npc_memory_embedding_profiles(id,processor_version,model,dimensions)
values ('20000000-0000-4000-8000-000000000101','npc-embedding-receipt-v1','receipt-model',3),
 ('20000000-0000-4000-8000-000000000102','npc-embedding-receipt-v2','receipt-model-v2',2);
set local role service_role; set local request.jwt.claim.role='service_role';
select public.world_npc_memory_embedding_profile_activate('20000000-0000-4000-8000-000000000101');
reset role;

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result,completed_at)
select id,save_id,instance_id,npc_id,version_id,'20000000-0000-4000-8000-000000000001',message,seq,revision,1,'completed',clock_timestamp(),'{}',clock_timestamp()
from pg_temp.f cross join (values
 ('20000000-0000-4001-8000-000000000001'::uuid,'Receipt source one',0),
 ('20000000-0000-4001-8000-000000000002'::uuid,'Receipt source two',1),
 ('20000000-0000-4001-8000-000000000003'::uuid,'Receipt source three',2),
 ('20000000-0000-4001-8000-000000000004'::uuid,'Receipt source four',3),
 ('20000000-0000-4001-8000-000000000005'::uuid,'Receipt source five',4),
 ('20000000-0000-4001-8000-000000000006'::uuid,'Receipt source six',5)
) v(id,message,seq);
select private.world_npc_memory_register_source('dialogue_turn',id) from (values
 ('20000000-0000-4001-8000-000000000001'::uuid),('20000000-0000-4001-8000-000000000002'::uuid),
 ('20000000-0000-4001-8000-000000000003'::uuid),('20000000-0000-4001-8000-000000000004'::uuid),
 ('20000000-0000-4001-8000-000000000005'::uuid),('20000000-0000-4001-8000-000000000006'::uuid)
) v(id) order by id;
set local role service_role; set local request.jwt.claim.role='service_role';
select public.world_npc_memory_embedding_schedule(6);

create temporary table pg_temp.c1 as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c1),'20000000-0000-4001-8000-000000000001','first receipt claim belongs to its fixture source');
create temporary table pg_temp.r1 as select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) receipt from pg_temp.c1;
reset role;
select is((select receipt->>'directive' from pg_temp.r1),'dispatch_authorized','prepare creates one durable dispatch authorization');
select is(
 (select receipt->>'requestHash' from pg_temp.r1),
 (select encode(extensions.digest(private.world_canonical_json(jsonb_build_object(
   'model',receipt->'model','input',receipt->'inputText','dimensions',receipt->'dimensions','encoding_format','float'
 )),'sha256'),'hex') from pg_temp.r1),
 'receipt request hash binds the exact canonical HTTP body including float encoding');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_prepare_dispatch(%L,%L)',(select claim->>'id' from pg_temp.c1),'20000000-0000-4000-8000-000000000099'),'PT409',null,'conflicting fence cannot prepare a receipt');
select is((select public.world_npc_memory_embedding_mark_dispatched((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c1),'dispatch_once','mark writes the one-shot receipt before provider call');
select is((select public.world_npc_memory_embedding_mark_dispatched((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c1),'fail_only','a repeated mark cannot authorize another provider call');
select is((select public.world_npc_memory_embedding_recover_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c1),'fail_only','a current-fence dispatched receipt forbids a second send');
reset role;
select is((select state from private.world_npc_memory_embedding_dispatches where job_id=(select (claim->>'id')::uuid from pg_temp.c1)),'terminalize_required','recovery records a deterministic terminalize-only state');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_mark_dispatched(%L,%L)',(select claim->>'id' from pg_temp.c1),(select claim->>'fence' from pg_temp.c1)),'PT409',null,'terminalize-only receipt cannot be marked or resent');
reset role;
select throws_ok(format('update private.world_npc_memory_embedding_dispatches set input_hash=%L where job_id=%L','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',(select claim->>'id' from pg_temp.c1)),'PT409',null,'receipt input binding is immutable');
select throws_ok(format('delete from private.world_npc_memory_embedding_dispatches where job_id=%L',(select claim->>'id' from pg_temp.c1)),'PT409',null,'receipt cannot be deleted while its job exists');
select throws_ok(format('update private.world_npc_memory_embedding_dispatches set dispatched_at=clock_timestamp() where job_id=%L',(select claim->>'id' from pg_temp.c1)),'PT409',null,'terminalize transition never permits dispatch timestamp rewriting');

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.c2 as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c2),'20000000-0000-4001-8000-000000000002','prepared-receipt claim belongs to its fixture source');
select is((select public.world_npc_memory_embedding_recover_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c2),'prepare_required','recovery has an explicit no-receipt directive');
create temporary table pg_temp.r2 as select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) receipt from pg_temp.c2;
select is((select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c2),'fail_only','a repeated prepare cannot authorize a second provider call');
-- Reclaim under a new fence: recovery must fail-only even when the earlier
-- process died before its HTTP call (prepared) or after it (dispatched).
reset role;
update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second' where id=(select (claim->>'id')::uuid from pg_temp.c2);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.c2_reclaimed as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c2_reclaimed),'20000000-0000-4001-8000-000000000002','reclaimed prepared-receipt claim remains on its fixture source');
select is((select public.world_npc_memory_embedding_recover_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c2_reclaimed),'fail_only','reclaimed prepared receipt never authorizes resend');
select is((select public.world_npc_memory_embedding_recover_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'reason' from pg_temp.c2_reclaimed),'prior_fence_receipt_exists','reclaimed receipt has a deterministic prior-fence reason');

create temporary table pg_temp.c3 as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c3),'20000000-0000-4001-8000-000000000003','dispatched-receipt claim belongs to its fixture source');
select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.c3;
select public.world_npc_memory_embedding_mark_dispatched((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.c3;
reset role;
update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second' where id=(select (claim->>'id')::uuid from pg_temp.c3);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.c3_reclaimed as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c3_reclaimed),'20000000-0000-4001-8000-000000000003','reclaimed dispatched-receipt claim remains on its fixture source');
select is((select public.world_npc_memory_embedding_recover_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid)->>'directive' from pg_temp.c3_reclaimed),'fail_only','reclaimed dispatched receipt never authorizes resend');

create temporary table pg_temp.c4 as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c4),'20000000-0000-4001-8000-000000000004','profile-change claim belongs to its fixture source');
select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.c4;
create temporary table pg_temp.p4 as select public.world_npc_memory_embedding_plan((claim->>'id')::uuid,(claim->>'fence')::uuid) plan from pg_temp.c4;
reset role;
select ok((select plan->>'inputText'=private.world_canonical_json(plan->'input') from pg_temp.p4),'plan exports the canonical input text bound by the HTTP request hash');
set local role service_role; set local request.jwt.claim.role='service_role';
select public.world_npc_memory_embedding_profile_activate('20000000-0000-4000-8000-000000000102');
select throws_ok(format('select public.world_npc_memory_embedding_mark_dispatched(%L,%L)',(select claim->>'id' from pg_temp.c4),(select claim->>'fence' from pg_temp.c4)),'PT409',null,'profile change rejects a stale receipt dispatch');
select public.world_npc_memory_embedding_profile_activate('20000000-0000-4000-8000-000000000101');
reset role;
insert into private.world_npc_memory_invalidations(job_id,save_id,instance_id,fence,source_kind,source_id,source_version,reason)
select (claim->>'id')::uuid,save_id,instance_id,(claim->>'fence')::uuid,'dialogue_turn',(claim->>'sourceId')::uuid,1,'resident_removed'
from pg_temp.c4 cross join pg_temp.f;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_recover_dispatch(%L,%L)',(select claim->>'id' from pg_temp.c4),(select claim->>'fence' from pg_temp.c4)),'PT409',null,'matching invalidation rejects receipt recovery');
reset role;
delete from private.world_npc_memory_invalidations where job_id=(select (claim->>'id')::uuid from pg_temp.c4);
update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second' where id=(select (claim->>'id')::uuid from pg_temp.c4);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_recover_dispatch(%L,%L)',(select claim->>'id' from pg_temp.c4),(select claim->>'fence' from pg_temp.c4)),'PT409',null,'expired lease independently rejects receipt recovery');
reset role;
update private.world_npc_memory_outbox set status='failed',lease_until=null,error_code='worker_failed' where id=(select (claim->>'id')::uuid from pg_temp.c4);
set local role service_role; set local request.jwt.claim.role='service_role';

create temporary table pg_temp.c5 as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c5),'20000000-0000-4001-8000-000000000005','source-mutation claim belongs to its fixture source');
select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.c5;
reset role;
update private.world_npc_dialogue_turns set message='source changed after receipt preparation'
 where id=(select (claim->>'sourceId')::uuid from pg_temp.c5);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_mark_dispatched(%L,%L)',(select claim->>'id' from pg_temp.c5),(select claim->>'fence' from pg_temp.c5)),'PT409',null,'source mutation rejects a stale receipt dispatch');

create temporary table pg_temp.c6 as select public.world_npc_memory_claim('embedding','npc-embedding-receipt-v1') claim;
select is((select claim->>'sourceId' from pg_temp.c6),'20000000-0000-4001-8000-000000000006','expired-lease claim belongs to its fixture source');
select public.world_npc_memory_embedding_prepare_dispatch((claim->>'id')::uuid,(claim->>'fence')::uuid) from pg_temp.c6;
reset role;
update private.world_npc_memory_outbox set lease_until=clock_timestamp()-interval '1 second'
 where id=(select (claim->>'id')::uuid from pg_temp.c6);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_npc_memory_embedding_recover_dispatch(%L,%L)',(select claim->>'id' from pg_temp.c6),(select claim->>'fence' from pg_temp.c6)),'PT409',null,'expired lease independently rejects receipt recovery');

reset role;
select * from finish();
rollback;
