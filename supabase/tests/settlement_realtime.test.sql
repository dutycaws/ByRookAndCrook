begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,role,aud) values
('19800000-0000-4000-8000-000000000001','settlement-realtime-owner@example.test','authenticated','authenticated'),
('19800000-0000-4000-8000-000000000002','settlement-realtime-other@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='19800000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
-- Ignore setup emissions and isolate a single settlement's events.
delete from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001';
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint)
select '19800000-0000-4000-8000-000000000010',save_id,99,0,'realtime-fixture' from pg_temp.fixture;
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),1::bigint,'settlement insert emits a notification');
update private.world_settlements set lease_until=clock_timestamp()+interval '60 seconds',fence=extensions.gen_random_uuid()
where id='19800000-0000-4000-8000-000000000010';
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),1::bigint,'lease heartbeat does not broadcast');
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,input_fingerprint)
values ('19800000-0000-4000-8000-000000000011','19800000-0000-4000-8000-000000000010',1,'snapshot','realtime-fixture');
update private.world_settlement_jobs set status='completed' where id='19800000-0000-4000-8000-000000000011';
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),3::bigint,'job creation and progress changes broadcast');
update private.world_settlement_jobs set usage='{"tokens":1}' where id='19800000-0000-4000-8000-000000000011';
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),3::bigint,'job bookkeeping does not broadcast');
update private.world_settlements set status='completed',public_digest='Morning is ready.' where id='19800000-0000-4000-8000-000000000010';
delete from private.world_settlement_jobs where id='19800000-0000-4000-8000-000000000011';
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),5::bigint,'completion and changed progress totals broadcast');
select ok((select bool_and(private and extension='broadcast' and event='settlement_changed') from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),'all notifications use private Broadcast');
select ok((select bool_and((payload - 'id') = '{"settlementId":"19800000-0000-4000-8000-000000000010"}'::jsonb) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),'application payload includes only settlement identity alongside the Realtime message id');
select ok(not has_function_privilege('authenticated','private.world_settlement_notify(uuid)','execute'),'browser cannot invoke notification helper');
set local role authenticated;
set local realtime.topic='settlements:19800000-0000-4000-8000-000000000001';
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),5::bigint,'owner can receive its private channel');
set local request.jwt.claim.sub='19800000-0000-4000-8000-000000000002';
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),0::bigint,'another user cannot join the owner channel');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private) values ('settlements:19800000-0000-4000-8000-000000000002','broadcast','settlement_changed','{}',true)$$,'42501',null,'clients cannot spoof notifications');
reset role;
set local role anon;
select is((select count(*) from realtime.messages where topic='settlements:19800000-0000-4000-8000-000000000001'),0::bigint,'anonymous clients cannot receive settlement notifications');
reset role;
select * from finish();
rollback;
