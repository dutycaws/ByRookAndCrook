begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

select has_function('public', 'world_npc_memory_claim_selected', array['uuid'], 'targeted summary claim RPC exists');
select ok(has_function_privilege('service_role', 'public.world_npc_memory_claim_selected(uuid)', 'EXECUTE'), 'service role can claim selected summary work');
select ok(not exists (
  select 1
  from pg_proc procedure_row
  cross join lateral aclexplode(coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))) permission
  where procedure_row.oid = 'public.world_npc_memory_claim_selected(uuid)'::regprocedure
    and permission.grantee = 0
    and permission.privilege_type = 'EXECUTE'
), 'PUBLIC cannot claim selected summary work');
select ok(not has_function_privilege('anon', 'public.world_npc_memory_claim_selected(uuid)', 'EXECUTE'), 'anonymous cannot claim selected summary work');
select ok(not has_function_privilege('authenticated', 'public.world_npc_memory_claim_selected(uuid)', 'EXECUTE'), 'authenticated cannot claim selected summary work');
select ok(not has_function_privilege('service_role', 'private.world_npc_memory_claim_selected(uuid)', 'EXECUTE'), 'private claim implementation is not an RPC');

insert into auth.users(id, email, role, aud) values
  ('19900000-0000-4000-8000-000000000001', 'selected-memory-claim@example.test', 'authenticated', 'authenticated');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '19900000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
create temporary table pg_temp.fixture as
select
  (snapshot#>>'{save,id}')::uuid as save_id,
  (snapshot->'roster'->0->>'instanceId')::uuid as instance_id
from (select public.npc_bar_snapshot() as snapshot) source;

select set_config('test.selected_job', '19900000-0000-4000-8000-000000000020', true);
select set_config('test.other_job', '19900000-0000-4000-8000-000000000021', true);
select set_config('test.wrong_lane_job', '19900000-0000-4000-8000-000000000022', true);
select set_config('test.selected_source', '19900000-0000-4000-8000-000000000030', true);
select set_config('test.other_source', '19900000-0000-4000-8000-000000000031', true);
select set_config('test.wrong_lane_source', '19900000-0000-4000-8000-000000000032', true);

-- The other eligible job is older, so a global claim would take it first.
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, created_at
)
select current_setting('test.other_job')::uuid, save_id, instance_id, 'memory_set',
       current_setting('test.other_source')::uuid, 1, 1, repeat('b', 64), 'summary',
       'npc-memory-summary-v2', 'pending', clock_timestamp() - interval '1 minute'
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status
)
select current_setting('test.wrong_lane_job')::uuid, save_id, instance_id, 'dialogue_turn',
       current_setting('test.wrong_lane_source')::uuid, 1, 3, repeat('c', 64), 'extract',
       'npc-memory-v1', 'pending'
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, created_at
)
select current_setting('test.selected_job')::uuid, save_id, instance_id, 'memory_set',
       current_setting('test.selected_source')::uuid, 1, 2, repeat('a', 64), 'summary',
       'npc-memory-summary-v2', 'pending', clock_timestamp()
from pg_temp.fixture;

-- The JWT assertion remains in force even if a service role is misconfigured.
set local role service_role;
set local request.jwt.claim.role = 'authenticated';
select throws_ok(
  format('select public.world_npc_memory_claim_selected(%L)', current_setting('test.selected_job')),
  'PT403', null, 'a non-service JWT cannot claim selected work'
);
reset role;
reset request.jwt.claim.role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select set_config('test.first_claim', public.world_npc_memory_claim_selected(current_setting('test.selected_job')::uuid)::text, true);
reset role;

select is(current_setting('test.first_claim')::jsonb->>'id', current_setting('test.selected_job'), 'only the selected job is returned');
select is(current_setting('test.first_claim')::jsonb->>'saveId', (select save_id::text from pg_temp.fixture), 'claim includes its owning save');
select is(current_setting('test.first_claim')::jsonb->>'instanceId', (select instance_id::text from pg_temp.fixture), 'claim includes its NPC instance');
select is(current_setting('test.first_claim')::jsonb->>'sourceKind', 'memory_set', 'claim shape identifies the memory set');
select is(current_setting('test.first_claim')::jsonb->>'sourceId', current_setting('test.selected_source'), 'claim shape retains the selected source');
select is(current_setting('test.first_claim')::jsonb->>'sourceVersion', '1', 'claim retains the source version');
select is(current_setting('test.first_claim')::jsonb->>'sourceHash', repeat('a', 64), 'claim retains the source hash');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.selected_job')::uuid), 'processing', 'selected job receives a lease');
select is((select attempts from private.world_npc_memory_outbox where id=current_setting('test.selected_job')::uuid), 1, 'selected job attempt count advances');
select is((select fence::text from private.world_npc_memory_outbox where id=current_setting('test.selected_job')::uuid), current_setting('test.first_claim')::jsonb->>'fence', 'returned fence matches the lease');
select ok((select lease_until > clock_timestamp() from private.world_npc_memory_outbox where id=current_setting('test.selected_job')::uuid), 'selected job receives the standard five-minute lease');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.other_job')::uuid), 'pending', 'older unrelated job stays pending');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select is(public.world_npc_memory_claim_selected(current_setting('test.selected_job')::uuid)->>'status', 'idle', 'a second claim cannot steal the active selected lease');
select is(public.world_npc_memory_claim_selected(current_setting('test.wrong_lane_job')::uuid)->>'status', 'idle', 'a non-summary-v2 job is not claimable through the selected summary RPC');
reset role;
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.other_job')::uuid), 'pending', 'unselected eligible summary job remains pending');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.wrong_lane_job')::uuid), 'pending', 'ineligible job remains pending');

update private.world_npc_memory_outbox
set lease_until = clock_timestamp() - interval '1 second'
where id = current_setting('test.selected_job')::uuid;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
select set_config('test.reclaimed', public.world_npc_memory_claim_selected(current_setting('test.selected_job')::uuid)::text, true);
reset role;

select is(current_setting('test.reclaimed')::jsonb->>'id', current_setting('test.selected_job'), 'expired selected work can be reclaimed by id');
select isnt(current_setting('test.reclaimed')::jsonb->>'fence', current_setting('test.first_claim')::jsonb->>'fence', 'reclaim replaces the fencing token');
select is((select attempts from private.world_npc_memory_outbox where id=current_setting('test.selected_job')::uuid), 2, 'reclaim advances the existing attempt counter');
select is((select fence::text from private.world_npc_memory_outbox where id=current_setting('test.selected_job')::uuid), current_setting('test.reclaimed')::jsonb->>'fence', 'reclaim persists its returned fence');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.other_job')::uuid), 'pending', 'reclaim still leaves unrelated work untouched');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.wrong_lane_job')::uuid), 'pending', 'reclaim leaves ineligible work untouched');

select * from finish();
rollback;
