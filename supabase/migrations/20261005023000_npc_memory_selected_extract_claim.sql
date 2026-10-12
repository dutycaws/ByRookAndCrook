begin;

-- A service-only claim seam for one explicitly selected offline extract job.
-- The normal kind/version claim remains the global queue contract.
create function private.world_npc_memory_claim_selected_extract(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job private.world_npc_memory_outbox;
begin
  select * into job
  from private.world_npc_memory_outbox
  where id = p_job_id
    and source_kind in ('dialogue_turn', 'quest_event', 'hospitality', 'resident_evolution')
    and processor_kind = 'extract'
    and processor_version = 'npc-memory-v1'
    and (
      status = 'pending'
      or (status = 'processing' and lease_until < clock_timestamp())
    )
  for update skip locked;

  if not found then
    return jsonb_build_object('status', 'idle');
  end if;

  update private.world_npc_memory_outbox
  set status = 'processing',
      fence = extensions.gen_random_uuid(),
      lease_until = clock_timestamp() + interval '5 minutes',
      attempts = attempts + 1,
      error_code = null
  where id = job.id
  returning * into job;

  return jsonb_build_object(
    'id', job.id,
    'fence', job.fence,
    'saveId', job.save_id,
    'instanceId', job.instance_id,
    'sourceKind', job.source_kind,
    'sourceId', job.source_id,
    'sourceVersion', job.source_version,
    'sourceHash', job.source_hash
  );
end;
$function$;

create function public.world_npc_memory_claim_selected_extract(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.world_settlement_assert_service();
  return private.world_npc_memory_claim_selected_extract(p_job_id);
end;
$function$;

revoke all on function private.world_npc_memory_claim_selected_extract(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.world_npc_memory_claim_selected_extract(uuid)
  from public, anon, authenticated;
grant execute on function public.world_npc_memory_claim_selected_extract(uuid)
  to service_role;

commit;
