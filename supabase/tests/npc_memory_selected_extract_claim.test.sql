begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select has_function('public', 'world_npc_memory_claim_selected_extract', array['uuid'], 'targeted extract claim RPC exists');
select ok(has_function_privilege('service_role', 'public.world_npc_memory_claim_selected_extract(uuid)', 'EXECUTE'), 'service role can claim selected extract work');
select ok(not exists (
  select 1
  from pg_proc procedure_row
  cross join lateral aclexplode(coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))) permission
  where procedure_row.oid = 'public.world_npc_memory_claim_selected_extract(uuid)'::regprocedure
    and permission.grantee = 0
    and permission.privilege_type = 'EXECUTE'
), 'PUBLIC cannot claim selected extract work');
select ok(not has_function_privilege('anon', 'public.world_npc_memory_claim_selected_extract(uuid)', 'EXECUTE'), 'anonymous cannot claim selected extract work');
select ok(not has_function_privilege('authenticated', 'public.world_npc_memory_claim_selected_extract(uuid)', 'EXECUTE'), 'authenticated cannot claim selected extract work');
select ok(not has_function_privilege('service_role', 'private.world_npc_memory_claim_selected_extract(uuid)', 'EXECUTE'), 'private claim implementation is not an RPC');

insert into auth.users(id, email, role, aud) values
  ('19800000-0000-4000-8000-000000000001', 'selected-extract-claim@example.test', 'authenticated', 'authenticated');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '19800000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;
create temporary table pg_temp.fixture as
select
  (snapshot#>>'{save,id}')::uuid as save_id,
  (snapshot->'roster'->0->>'instanceId')::uuid as instance_id
from (select public.npc_bar_snapshot() as snapshot) source;

select set_config('test.selected_extract_job', '19800000-0000-4000-8000-000000000020', true);
select set_config('test.older_extract_job', '19800000-0000-4000-8000-000000000021', true);
select set_config('test.summary_job', '19800000-0000-4000-8000-000000000022', true);
select set_config('test.active_extract_job', '19800000-0000-4000-8000-000000000023', true);
select set_config('test.expired_extract_job', '19800000-0000-4000-8000-000000000024', true);
select set_config('test.wrong_version_job', '19800000-0000-4000-8000-000000000025', true);
select set_config('test.memory_set_extract_job', '19800000-0000-4000-8000-000000000026', true);
select set_config('test.completed_extract_job', '19800000-0000-4000-8000-000000000027', true);
select set_config('test.older_fence', '19800000-0000-4000-8000-000000000049', true);
select set_config('test.old_fence', '19800000-0000-4000-8000-000000000050', true);
select set_config('test.active_fence', '19800000-0000-4000-8000-000000000051', true);

-- An older eligible extract job and a summary job prove this RPC never drains another queue item.
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, fence, created_at
)
select current_setting('test.older_extract_job')::uuid, save_id, instance_id, 'dialogue_turn',
       '19800000-0000-4000-8000-000000000031', 1, 1, repeat('b', 64), 'extract',
       'npc-memory-v1', 'pending', current_setting('test.older_fence')::uuid, clock_timestamp() - interval '1 minute'
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, created_at
)
select current_setting('test.selected_extract_job')::uuid, save_id, instance_id, 'quest_event',
       '19800000-0000-4000-8000-000000000030', 1, 2, repeat('a', 64), 'extract',
       'npc-memory-v1', 'pending', clock_timestamp()
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, summary_protocol, summary_prompt_key, status
)
select current_setting('test.summary_job')::uuid, save_id, instance_id, 'memory_set',
       '19800000-0000-4000-8000-000000000032', 1, 3, repeat('c', 64), 'summary',
       'npc-memory-summary-v2', 'v2', 'npc_memory.summary.v2', 'pending'
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, fence, lease_until, attempts
)
select current_setting('test.active_extract_job')::uuid, save_id, instance_id, 'hospitality',
       '19800000-0000-4000-8000-000000000033', 1, 4, repeat('d', 64), 'extract',
       'npc-memory-v1', 'processing', current_setting('test.active_fence')::uuid,
       clock_timestamp() + interval '5 minutes', 2
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, fence, lease_until, attempts
)
select current_setting('test.expired_extract_job')::uuid, save_id, instance_id, 'resident_evolution',
       '19800000-0000-4000-8000-000000000034', 1, 5, repeat('e', 64), 'extract',
       'npc-memory-v1', 'processing', current_setting('test.old_fence')::uuid,
       clock_timestamp() - interval '1 second', 3
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status
)
select current_setting('test.wrong_version_job')::uuid, save_id, instance_id, 'dialogue_turn',
       '19800000-0000-4000-8000-000000000035', 1, 6, repeat('f', 64), 'extract',
       'npc-memory-v2', 'pending'
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, summary_protocol, summary_prompt_key, status
)
select current_setting('test.memory_set_extract_job')::uuid, save_id, instance_id, 'memory_set',
       '19800000-0000-4000-8000-000000000036', 1, 7, repeat('1', 64), 'summary',
       'npc-memory-summary-v2', 'v2', 'npc_memory.summary.v2', 'pending'
from pg_temp.fixture;
insert into private.world_npc_memory_outbox(
  id, save_id, instance_id, source_kind, source_id, source_version, source_sequence,
  source_hash, processor_kind, processor_version, status, completed_at
)
select current_setting('test.completed_extract_job')::uuid, save_id, instance_id, 'dialogue_turn',
       '19800000-0000-4000-8000-000000000037', 1, 8, repeat('2', 64), 'extract',
       'npc-memory-v1', 'completed', clock_timestamp()
from pg_temp.fixture;

-- The service database role must still carry a service-role JWT claim.
set local role service_role;
set local request.jwt.claim.role = 'authenticated';
select throws_ok(
  format('select public.world_npc_memory_claim_selected_extract(%L)', current_setting('test.selected_extract_job')),
  'PT403', null, 'a non-service JWT cannot claim selected extract work'
);
reset role;
reset request.jwt.claim.role;

select set_config('test.selected_extract_claim', public.world_npc_memory_claim_selected_extract(current_setting('test.selected_extract_job')::uuid)::text, true);
select is(current_setting('test.selected_extract_claim')::jsonb->>'id', current_setting('test.selected_extract_job'), 'only the selected extract job is returned');
select ok((current_setting('test.selected_extract_claim')::jsonb->>'fence')::uuid is not null, 'selected extract claim has a fence');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.selected_extract_job')::uuid), 'processing', 'selected extract job becomes processing');
select is((select attempts from private.world_npc_memory_outbox where id=current_setting('test.selected_extract_job')::uuid), 1, 'selected extract attempt count increments');
select ok((select lease_until > clock_timestamp() from private.world_npc_memory_outbox where id=current_setting('test.selected_extract_job')::uuid), 'selected extract job receives a live lease');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.older_extract_job')::uuid), 'pending', 'older eligible job remains pending');
select is((select fence::text from private.world_npc_memory_outbox where id=current_setting('test.older_extract_job')::uuid), current_setting('test.older_fence'), 'older eligible job fence remains untouched');

select is(public.world_npc_memory_claim_selected_extract(current_setting('test.summary_job')::uuid)->>'status', 'idle', 'summary-v2 work is outside the extract claim lane');
select is((select status from private.world_npc_memory_outbox where id=current_setting('test.summary_job')::uuid), 'pending', 'summary-v2 job remains pending');
select is(public.world_npc_memory_claim_selected_extract(current_setting('test.active_extract_job')::uuid)->>'status', 'idle', 'active lease cannot be stolen');
select is((select attempts from private.world_npc_memory_outbox where id=current_setting('test.active_extract_job')::uuid), 2, 'active lease attempt count remains unchanged');

select set_config('test.expired_extract_claim', public.world_npc_memory_claim_selected_extract(current_setting('test.expired_extract_job')::uuid)::text, true);
select is(current_setting('test.expired_extract_claim')::jsonb->>'id', current_setting('test.expired_extract_job'), 'expired selected extract job is reclaimed');
select ok((current_setting('test.expired_extract_claim')::jsonb->>'fence')::uuid <> current_setting('test.old_fence')::uuid, 'reclaim rotates the fence');
select is((select attempts from private.world_npc_memory_outbox where id=current_setting('test.expired_extract_job')::uuid), 4, 'reclaim increments the attempt count');
select ok((select lease_until > clock_timestamp() from private.world_npc_memory_outbox where id=current_setting('test.expired_extract_job')::uuid), 'reclaim renews the lease');

select is(public.world_npc_memory_claim_selected_extract(current_setting('test.wrong_version_job')::uuid)->>'status', 'idle', 'unsupported extract version is not claimed');
select is(public.world_npc_memory_claim_selected_extract(current_setting('test.memory_set_extract_job')::uuid)->>'status', 'idle', 'memory-set source is outside the extract claim lane');
select is(public.world_npc_memory_claim_selected_extract(current_setting('test.completed_extract_job')::uuid)->>'status', 'idle', 'completed job is not reclaimed');
select is(public.world_npc_memory_claim_selected_extract('19800000-0000-4000-8000-000000000099'::uuid)->>'status', 'idle', 'unknown job id returns idle');

select * from finish();
rollback;
