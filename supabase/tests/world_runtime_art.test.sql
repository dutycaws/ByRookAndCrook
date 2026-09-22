begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- claim_next is deliberately global FIFO.  Isolate this fixture from durable
-- jobs that may already be present in a preserved test database; rollback
-- restores their exact queue state when this test completes.
update private.world_runtime_art_jobs
set status='failed_provider', fence=null, lease_until=null,
    completed_at=coalesce(completed_at,clock_timestamp()), failure_code='failed_provider'
where status='queued' or (status='processing' and lease_until<clock_timestamp());

insert into auth.users(id,email,role,aud) values ('19000000-0000-4000-8000-000000000001','runtime-art-owner@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='19000000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as
select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id,
       '19000000-0000-4000-8000-000000000002'::uuid entity_id;
grant select on pg_temp.fixture to service_role;
reset role;

-- Regression guard: an unrelated older queued job must be drained explicitly,
-- rather than silently becoming the fixture's first claim on a shared stack.
insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '19000000-0000-4000-8000-000000000003',save_id,'item','runtime-art-unrelated','procedural','unrelated-v1','{}','active',1 from pg_temp.fixture;
create temporary table pg_temp.unrelated_job as
select j.id job_id, j.save_id
from private.world_runtime_art_jobs j
join pg_temp.fixture f on f.save_id=j.save_id
where j.canonical_entity_id='19000000-0000-4000-8000-000000000003';
update private.world_runtime_art_jobs j
set created_at=clock_timestamp()-interval '1 hour'
from pg_temp.unrelated_job u
where j.id=u.job_id and j.save_id=u.save_id;
grant select on pg_temp.unrelated_job to service_role;

insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select '19000000-0000-4000-8000-000000000002',save_id,'item','runtime-art-lantern','procedural','art-v1','{}','active',1 from pg_temp.fixture;
select is((select count(*) from private.world_runtime_art_jobs j join pg_temp.fixture f on f.save_id=j.save_id where j.canonical_entity_id=f.entity_id),1::bigint,'canonical INSERT enqueues exactly one fixture runtime-art job');
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.world_runtime_art_set_appearance((select save_id from pg_temp.fixture),'19000000-0000-4000-8000-000000000002','art-v2','  brass   lantern  ');
select throws_ok(
  format('select public.world_runtime_art_set_appearance(%L,%L,%L,%L)',(select save_id from pg_temp.fixture),'19000000-0000-4000-8000-000000000002','art-v2','changed brass lantern'),
  'PT409',null,'same-version public appearance mutation is rejected');
-- Queue v3 before v2 is claimed: each job must retain its immutable normalized snapshot.
select public.world_runtime_art_set_appearance((select save_id from pg_temp.fixture),'19000000-0000-4000-8000-000000000002','art-v3','silver lantern');
reset role;
create temporary table pg_temp.fixture_jobs as
select j.id job_id,j.save_id,j.appearance_version
from private.world_runtime_art_jobs j
join pg_temp.fixture f on f.save_id=j.save_id and f.entity_id=j.canonical_entity_id;
grant select on pg_temp.fixture_jobs to service_role;
select is((select count(*) from pg_temp.fixture_jobs),3::bigint,'each explicit appearance-version UPDATE enqueues one additional fixture job');
select throws_ok($$update private.world_canonical_entities set source_version='art-v4' where id='19000000-0000-4000-8000-000000000002'$$,'55000',null,'canonical provenance remains append-only rather than enqueueing art');
select is((select count(*) from pg_temp.fixture_jobs),3::bigint,'canonical provenance changes cannot enqueue art directly');
select is((select j.public_appearance from private.world_runtime_art_jobs j join pg_temp.fixture_jobs fj on fj.job_id=j.id and fj.save_id=j.save_id where fj.appearance_version='art-v2'),'brass lantern','v2 queues its normalized immutable public appearance snapshot');
select is((select j.prompt_hash from private.world_runtime_art_jobs j join pg_temp.fixture_jobs fj on fj.job_id=j.id and fj.save_id=j.save_id where fj.appearance_version='art-v2'), 'a5f61f76c47f28e03b9c6174de3138a6a007deeaafe93cddc7186538ab54bc73','SQL prompt hash matches the normalized public-spec formula');

set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim_unrelated as select public.world_runtime_art_claim_next() result;
grant select on pg_temp.claim_unrelated to service_role;
select is((select (result->>'jobId')::uuid from pg_temp.claim_unrelated),(select job_id from pg_temp.unrelated_job),'older unrelated queued job is claimed before the fixture under global FIFO');
select lives_ok(
  format('select public.world_runtime_art_fail(%L,%s,%L,%L)',
    (select result->>'jobId' from pg_temp.claim_unrelated),
    (select result->>'attempt' from pg_temp.claim_unrelated),
    (select result->>'fence' from pg_temp.claim_unrelated),'failed_provider'),
  'unrelated regression job is terminally drained before fixture lifecycle assertions');
create temporary table pg_temp.claim_one as select public.world_runtime_art_claim_next() result;
grant select on pg_temp.claim_one to service_role;
select is((select (result->>'jobId')::uuid from pg_temp.claim_one),(select job_id from pg_temp.fixture_jobs where appearance_version='art-v1'),'first fixture claim is bound to the captured v1 job');
select is((select result->>'publicAppearance' from pg_temp.claim_one),'runtime-art-lantern','first claim returns its own v1 snapshot rather than a later appearance');
select is((select result->>'attempt' from pg_temp.claim_one),'1','first claim starts attempt one');
reset role;
update private.world_runtime_art_jobs j set lease_until=clock_timestamp()-interval '1 second'
from pg_temp.fixture_jobs fj
where j.id=fj.job_id and j.save_id=fj.save_id and fj.appearance_version='art-v1';
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim_reclaimed as select public.world_runtime_art_claim_next() result;
grant select on pg_temp.claim_reclaimed to service_role;
select is((select result->>'jobId' from pg_temp.claim_reclaimed),(select result->>'jobId' from pg_temp.claim_one),'expired processing job is reclaimed atomically');
select is((select result->>'attempt' from pg_temp.claim_reclaimed),'2','reclaim increments durable attempt count');
select isnt((select result->>'fence' from pg_temp.claim_reclaimed),(select result->>'fence' from pg_temp.claim_one),'reclaim issues a new claim fence');
select throws_ok(
  format('select public.world_runtime_art_accept(%L,%s,%L,%L,%L)',
    (select result->>'jobId' from pg_temp.claim_one),
    (select result->>'attempt' from pg_temp.claim_one),
    (select result->>'fence' from pg_temp.claim_one),
    'accepted/'||(select result->>'jobId' from pg_temp.claim_one)||'/art-v1/'||repeat('a',64)||'.png',repeat('a',64)),
  'PT400',null,'a stale attempt cannot accept after reclaim');
select lives_ok(
  format('select public.world_runtime_art_fail(%L,%s,%L,%L)',
    (select result->>'jobId' from pg_temp.claim_reclaimed),
    (select result->>'attempt' from pg_temp.claim_reclaimed),
    (select result->>'fence' from pg_temp.claim_reclaimed),'failed_provider'),
  'the current fenced attempt can terminally fail');
reset role;
select is((select j.status from private.world_runtime_art_jobs j join pg_temp.fixture_jobs fj on fj.job_id=j.id and fj.save_id=j.save_id where fj.appearance_version='art-v1'),'failed_provider','terminal failure closes the prior fixture lease');
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim_two as select public.world_runtime_art_claim_next() result;
grant select on pg_temp.claim_two to service_role;
select is((select (result->>'jobId')::uuid from pg_temp.claim_two),(select job_id from pg_temp.fixture_jobs where appearance_version='art-v2'),'second fixture claim is bound to the captured v2 job');
select isnt((select result->>'jobId' from pg_temp.claim_two),(select result->>'jobId' from pg_temp.claim_one),'terminal failed job is never reclaimed');
select is((select result->>'publicAppearance' from pg_temp.claim_two),'brass lantern','v2 claim retains queued v2 snapshot after later v3 update');
select is((select result->>'appearanceVersion' from pg_temp.claim_two),'art-v2','v2 claim retains its queued version');
select throws_ok(
  format('select public.world_runtime_art_accept(%L,%s,%L,%L,%L)',
    (select result->>'jobId' from pg_temp.claim_two),
    (select result->>'attempt' from pg_temp.claim_two),
    (select result->>'fence' from pg_temp.claim_two),
    'accepted/'||(select result->>'jobId' from pg_temp.claim_two)||'/art-v2/'||repeat('b',64)||'.png',repeat('a',64)),
  'PT400',null,'accept rejects a storage key whose filename does not match its recorded SHA');
select lives_ok(
  format('select public.world_runtime_art_accept(%L,%s,%L,%L,%L)',
    (select result->>'jobId' from pg_temp.claim_two),
    (select result->>'attempt' from pg_temp.claim_two),
    (select result->>'fence' from pg_temp.claim_two),
    'accepted/'||(select result->>'jobId' from pg_temp.claim_two)||'/art-v2/'||repeat('a',64)||'.png',repeat('a',64)),
  'the current fenced attempt accepts its verified render');
select lives_ok(
  format('select public.world_runtime_art_replace_accepted(%L,%L,%L)',
    (select result->>'jobId' from pg_temp.claim_two),
    'accepted/'||(select result->>'jobId' from pg_temp.claim_two)||'/art-v2/'||repeat('b',64)||'.png',repeat('b',64)),
  'same-spec replacement is separate from a claimed worker completion');
reset role;
select is((select count(*) from private.world_runtime_art_renders r join pg_temp.fixture_jobs fj on fj.job_id=r.job_id and fj.save_id=r.save_id where fj.appearance_version='art-v2'),2::bigint,'accepted replacements retain immutable render history');
select is((select r.sha256 from private.world_runtime_art_current c join private.world_runtime_art_renders r on r.id=c.render_id join pg_temp.fixture f on f.save_id=c.save_id and f.entity_id=c.canonical_entity_id),repeat('b',64),'current pointer advances to latest accepted replacement');
create temporary table pg_temp.current_render as select c.render_id from private.world_runtime_art_current c join pg_temp.fixture f on f.save_id=c.save_id and f.entity_id=c.canonical_entity_id;
grant select on pg_temp.current_render to authenticated;
select ok(has_function_privilege('service_role','public.world_runtime_art_service_runtime_key(uuid)','execute'),'only service can resolve a runtime storage key');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='19000000-0000-4000-8000-000000000001';
select is((select count(*) from jsonb_array_elements(public.world_runtime_art_projection((select save_id from pg_temp.fixture))) item where item->>'entityId'=(select entity_id::text from pg_temp.fixture)),1::bigint,'projection contains only the latest effective fixture entity state');
select ok(not (public.world_runtime_art_projection((select save_id from pg_temp.fixture))::text ~ 'runtimeKey|accepted/|token'),'projection never exposes storage keys or tokens');
select ok((select public.world_runtime_art_authorize_delivery((select save_id from pg_temp.fixture),(select entity_id from pg_temp.fixture),(select render_id from pg_temp.current_render)) ? 'renderId'),'owner receives only an opaque render authorization');
select throws_ok($$select public.world_runtime_art_service_runtime_key('19000000-0000-4000-8000-000000000002')$$,'42501',null,'authenticated callers cannot resolve private storage keys');
reset role;
select ok(not has_table_privilege('authenticated','private.world_runtime_art_jobs','select'),'players cannot read private runtime-art jobs');
select * from finish();
rollback;
