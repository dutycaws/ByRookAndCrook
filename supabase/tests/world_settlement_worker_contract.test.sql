begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users(id,email,role,aud) values ('17200000-0000-4000-8000-000000000001','worker-owner@example.test','authenticated','authenticated'),('17200000-0000-4000-8000-000000000002','worker-other@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id) values ('17200000-0000-4000-8000-000000000010','17200000-0000-4000-8000-000000000001'),('17200000-0000-4000-8000-000000000011','17200000-0000-4000-8000-000000000002');

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.enqueue as select public.world_settlement_enqueue('17200000-0000-4000-8000-000000000010','17200000-0000-4000-8000-000000000020',0,'{"garden":"frozen"}'::jsonb,'settlement-input-v1') value;
grant select on pg_temp.enqueue to authenticated;
select is((select value->>'status' from pg_temp.enqueue),'queued','service enqueue creates a queued settlement');
select is((select value->>'replayed' from pg_temp.enqueue),'false','first enqueue is not replayed');
reset role;
select is((select world_phase from public.tavern_saves where id='17200000-0000-4000-8000-000000000010'),'settling','enqueue places save in settling phase without advancing the day');
select is((select count(*) from private.world_settlement_jobs where settlement_id=(select (value->>'settlementId')::uuid from pg_temp.enqueue)),7::bigint,'enqueue creates deterministic ordered job rows');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_settlement_enqueue('17200000-0000-4000-8000-000000000010','17200000-0000-4000-8000-000000000020',0,'{"ignored":"replay"}'::jsonb,'settlement-input-v1')->>'replayed'),'true','same save action replays exact enqueue receipt');
select throws_ok($$select public.world_settlement_enqueue('17200000-0000-4000-8000-000000000010','17200000-0000-4000-8000-000000000021',1,'{}'::jsonb,'settlement-input-v1')$$,'PT409',null,'stale revision cannot enqueue settlement work');
select is((public.world_settlement_enqueue('17200000-0000-4000-8000-000000000011','17200000-0000-4000-8000-000000000022',0,jsonb_build_object('text',repeat('x',11900)),'settlement-input-v1')->>'status'),'queued','boundary input that remains within every derived job snapshot is accepted');
select throws_ok($$select public.world_settlement_enqueue('17200000-0000-4000-8000-000000000011','17200000-0000-4000-8000-000000000023',0,jsonb_build_object('text',repeat('x',12000)),'settlement-input-v1')$$,'PT400',null,'oversize frozen input is rejected before enqueue');
reset role;
set local role postgres;
update private.world_settlement_jobs set status='skipped' where settlement_id=(select id from private.world_settlements where save_id='17200000-0000-4000-8000-000000000011');
update private.world_settlements set status='skipped',completed_at=clock_timestamp() where save_id='17200000-0000-4000-8000-000000000011';
update public.tavern_saves set world_phase='open' where id='17200000-0000-4000-8000-000000000011';
reset role;
select throws_ok($$update private.world_settlements set input_version='mutated' where id=(select (value->>'settlementId')::uuid from pg_temp.enqueue)$$,'55000',null,'settlement frozen input version is immutable');
select throws_ok($$update private.world_settlement_jobs set input_snapshot='{}'::jsonb where settlement_id=(select (value->>'settlementId')::uuid from pg_temp.enqueue)$$,'55000',null,'job frozen input snapshot is immutable');

set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim as select public.world_settlement_claim((select (value->>'settlementId')::uuid from pg_temp.enqueue)) value;
select ok((select value ? 'inputSnapshot' and value->>'inputVersion'='settlement-input-v1' from pg_temp.claim),'claim returns the frozen settlement snapshot and version');
select is((select value#>>'{inputSnapshot,sourceRevision}' from pg_temp.claim),'0','claim projects the server-pinned source revision');
select ok((select value ? 'jobInputSnapshot' and value->>'jobInputVersion'='settlement-input-v1' and value#>>'{jobInputSnapshot,jobKind}'='snapshot' from pg_temp.claim),'claim returns the job-level frozen snapshot and version');
select throws_ok($$select public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'bad-stage','{}'::jsonb)$$,'PT400',null,'unknown checkpoint stage is rejected');
create temporary table pg_temp.checkpoint as select public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'proposer','{"result":"safe"}'::jsonb,'{"tokens":3}'::jsonb,'fixture','prompt-v1') value;
select is((select value->>'status' from pg_temp.checkpoint),'recorded','fenced checkpoint is appended');
select is((public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'proposer','{}'::jsonb)->>'status'),'recorded','same fence checkpoint replay returns exact receipt');
select throws_ok($$select public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),'17200000-0000-4000-8000-000000000099','critic','{}'::jsonb)$$,'PT409',null,'stale fence cannot append a checkpoint');
select throws_ok($$select public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'critic',jsonb_build_object('text',repeat('x',17000)))$$,'PT400',null,'oversize checkpoint payload is rejected');
create temporary table pg_temp.safe as select public.world_settlement_safe_result((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'no_changes','No world changes were needed today.') value;
select is((select value->>'kind' from pg_temp.safe),'no_changes','safe no-op result commits without mechanical effects');
select is((public.world_settlement_safe_result((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'no_changes','ignored replay')->>'publicDigest'),'No world changes were needed today.','safe result replays its exact durable receipt');
reset role;

set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17200000-0000-4000-8000-000000000001';
select ok((public.world_settlement_status('17200000-0000-4000-8000-000000000010',(select (value->>'settlementId')::uuid from pg_temp.enqueue)) ? 'publicDigest'),'owner status exposes public digest');
select ok(not (public.world_settlement_status('17200000-0000-4000-8000-000000000010',(select (value->>'settlementId')::uuid from pg_temp.enqueue)) ? 'receipt'),'status redacts raw terminal receipts and worker state');
select throws_ok($$select public.world_settlement_enqueue('17200000-0000-4000-8000-000000000010','17200000-0000-4000-8000-000000000099',0,'{}'::jsonb,'x')$$,'42501',null,'clients cannot enqueue settlement work');
select throws_ok($$select public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'critic','{}'::jsonb)$$,'42501',null,'clients cannot checkpoint worker state');
select throws_ok($$select public.world_settlement_safe_result((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select (value->>'jobId')::uuid from pg_temp.claim),(select (value->>'fence')::uuid from pg_temp.claim),'rejected','client write')$$,'42501',null,'clients cannot commit safe results');
reset role;

-- Claim every remaining job. The last safe result must finish the settlement in
-- the same transaction, reopen the save, and retain an exact worker replay.
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.final_safe(job_id uuid,fence uuid,result jsonb);
do $$
declare c jsonb; v jsonb;
begin
  loop
    c:=public.world_settlement_claim((select (value->>'settlementId')::uuid from pg_temp.enqueue));
    exit when not (c ? 'jobId');
    v:=public.world_settlement_safe_result((c->>'settlementId')::uuid,(c->>'jobId')::uuid,(c->>'fence')::uuid,'no_changes','Settlement work completed safely.');
    if c->>'kind'='finalize' then insert into pg_temp.final_safe values((c->>'jobId')::uuid,(c->>'fence')::uuid,v); end if;
  end loop;
end $$;
reset role;
select is((select status from private.world_settlements where id=(select (value->>'settlementId')::uuid from pg_temp.enqueue)),'completed','seventh safe result terminalizes the settlement');
select is((select world_phase from public.tavern_saves where id='17200000-0000-4000-8000-000000000010'),'open','final safe result reopens the save');
select ok((select terminal_receipt->>'publicDigest'='Settlement work completed safely.' and fence is null from private.world_settlements where id=(select (value->>'settlementId')::uuid from pg_temp.enqueue)),'terminal receipt is public-safe and the fence is cleared');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_settlement_safe_result((select (value->>'settlementId')::uuid from pg_temp.enqueue),(select job_id from pg_temp.final_safe),(select fence from pg_temp.final_safe),'no_changes','different retry')->>'publicDigest'),'Settlement work completed safely.','final safe result has an exact durable replay');

-- A reclaimed job carries only the latest durable result of each stage, tagged
-- with the prior fence/attempt, and claim_next projects its job snapshot too.
reset role;
set local role postgres;
update public.tavern_saves set current_day=2 where id='17200000-0000-4000-8000-000000000010';
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.recovery_enqueue as select public.world_settlement_enqueue('17200000-0000-4000-8000-000000000010','17200000-0000-4000-8000-000000000024',0,'{"recovery":true}'::jsonb,'settlement-input-v1') value;
create temporary table pg_temp.recovery_claim as select public.world_settlement_claim_next() value;
select ok((select value ? 'jobInputSnapshot' and value->>'jobInputVersion'='settlement-input-v1' from pg_temp.recovery_claim),'claim_next returns a job-level frozen snapshot and version');
create temporary table pg_temp.recovery_checkpoint as select public.world_settlement_checkpoint((select (value->>'settlementId')::uuid from pg_temp.recovery_enqueue),(select (value->>'jobId')::uuid from pg_temp.recovery_claim),(select (value->>'fence')::uuid from pg_temp.recovery_claim),'proposer','{"durable":true}'::jsonb) value;
reset role;
set local role postgres;
update private.world_settlement_attempts set lease_until=clock_timestamp()-interval '1 second' where job_id=(select (value->>'jobId')::uuid from pg_temp.recovery_claim);
update private.world_settlements set lease_until=clock_timestamp()-interval '1 second' where id=(select (value->>'settlementId')::uuid from pg_temp.recovery_enqueue);
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.recovery_reclaim as select public.world_settlement_claim((select (value->>'settlementId')::uuid from pg_temp.recovery_enqueue)) value;
select ok((select value#>>'{checkpoints,0,stage}'='proposer' and value#>>'{checkpoints,0,payload,durable}'='true' and value#>>'{checkpoints,0,sourceFence}'<>(select value->>'fence' from pg_temp.recovery_reclaim) from pg_temp.recovery_reclaim),'reclaimed fence receives bounded durable checkpoints from the prior attempt');
reset role;
set local role postgres;
update private.world_settlements set deadline_at=clock_timestamp()-interval '1 second' where id=(select (value->>'settlementId')::uuid from pg_temp.recovery_enqueue);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_settlement_safe_result((select (value->>'settlementId')::uuid from pg_temp.recovery_enqueue),(select (value->>'jobId')::uuid from pg_temp.recovery_reclaim),(select (value->>'fence')::uuid from pg_temp.recovery_reclaim),'no_changes','too late')$$,'PT409',null,'safe result rejects an expired settlement deadline before writing');
reset role;

set local role postgres;
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at) values ('17200000-0000-4000-8000-000000000030','17200000-0000-4000-8000-000000000010',3,0,'deadline','queued',clock_timestamp()-interval '1 second');
insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint) values ('17200000-0000-4000-8000-000000000030',1,'snapshot','deadline');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((public.world_settlement_claim('17200000-0000-4000-8000-000000000030')->>'status'),'expired','deadline claim preserves 041 no-op finalizer behavior');
reset role;

select * from finish();
rollback;
