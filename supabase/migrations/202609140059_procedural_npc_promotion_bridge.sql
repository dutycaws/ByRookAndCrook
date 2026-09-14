-- Issue #17: promote only canonical NPCs created by a completed procedural
-- settlement. The bridge has no provider dependency and can safely replay after
-- the durable command receipt already exists.
begin;

create function private.world_procedural_npc_promotion_candidates(
  p_save_id uuid,
  p_job_id uuid
)
returns table(entity_id uuid) language sql stable security definer set search_path='' as $$
  select e.id
  from private.world_procedural_command_receipts r
  cross join lateral jsonb_array_elements(coalesce(r.result->'operations','[]'::jsonb)) operation
  join private.world_canonical_entities e
    on e.id=(operation->>'entityId')::uuid
    and e.save_id=p_save_id
  join private.world_generated_entity_lifecycle lifecycle
    on lifecycle.entity_id=e.id
    and lifecycle.save_id=e.save_id
  where r.job_id=p_job_id
    and operation->>'operation'='entity'
    and operation->>'entityKind'='npc'
    and coalesce((operation->>'reused')::boolean,false)=false
    and e.origin='procedural'
    and e.lifecycle='active'
    and lifecycle.entity_role='deep_npc'
    and not exists(
      select 1 from private.world_promoted_npc_definitions definition
      where definition.canonical_entity_id=e.id and definition.save_id=e.save_id
    )
  order by e.created_at,e.id
  limit 8
$$;

create function public.world_discover_procedural_npc_promotions(
  p_settlement_id uuid,
  p_job_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settlement private.world_settlements;
  v_job private.world_settlement_jobs;
  v_candidate record;
  v_promoted integer := 0;
begin
  perform private.world_settlement_assert_service();

  select s.* into v_settlement
  from private.world_settlements s
  where s.id=p_settlement_id
  for update;
  select j.* into v_job
  from private.world_settlement_jobs j
  where j.id=p_job_id and j.settlement_id=p_settlement_id
  for update;
  if not found or v_settlement.status<>'queued' or v_job.job_kind<>'procedural_world' or v_job.status<>'completed'
    or not exists(select 1 from private.world_procedural_command_receipts r where r.job_id=v_job.id)
    or exists(
      select 1 from private.world_settlement_jobs later
      where later.settlement_id=v_settlement.id
        and later.ordinal>v_job.ordinal
        and later.status<>'queued'
    )
  then
    raise sqlstate 'PT409' using message='Completed procedural settlement job is required for NPC promotion discovery';
  end if;

  -- The command receipt is the sole discovery authority. It binds this bridge
  -- to entities this job actually created, instead of allowing a service call
  -- to sweep arbitrary generated NPCs in the save.
  for v_candidate in
    select candidate.entity_id
    from private.world_procedural_npc_promotion_candidates(v_settlement.save_id,v_job.id) candidate
  loop
    perform private.world_promote_canonical_npc(v_settlement.save_id,v_candidate.entity_id);
    v_promoted:=v_promoted+1;
  end loop;

  if v_promoted=0 then
    return jsonb_build_object('status','reused','promotedCount',0);
  end if;
  return jsonb_build_object('status','completed','promotedCount',v_promoted);
end $$;

-- The command commit completes its job before the post-commit bridge runs.
-- Requeueing is deliberately limited to that completed, receipt-backed job so
-- the next claim can replay the exact command without another model call.
create function public.world_retry_procedural_npc_promotion(
  p_settlement_id uuid,
  p_job_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settlement private.world_settlements;
  v_job private.world_settlement_jobs;
begin
  perform private.world_settlement_assert_service();
  select s.* into v_settlement from private.world_settlements s where s.id=p_settlement_id for update;
  select j.* into v_job from private.world_settlement_jobs j where j.id=p_job_id and j.settlement_id=p_settlement_id for update;
  if not found or v_settlement.status<>'queued' or v_job.job_kind<>'procedural_world' or v_job.status<>'completed'
    or not exists(select 1 from private.world_procedural_command_receipts r where r.job_id=v_job.id)
    or not exists(select 1 from private.world_procedural_npc_promotion_candidates(v_settlement.save_id,v_job.id))
    or exists(
      select 1 from private.world_settlement_jobs later
      where later.settlement_id=v_settlement.id
        and later.ordinal>v_job.ordinal
        and later.status<>'queued'
    )
  then
    raise sqlstate 'PT409' using message='Completed queued procedural settlement job is required for NPC promotion retry';
  end if;

  update private.world_settlement_jobs
  set status='queued',failure_code='PROMOTION_RETRY',completed_at=null
  where id=v_job.id;
  return jsonb_build_object('status','retrying');
end $$;

revoke all on function private.world_procedural_npc_promotion_candidates(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.world_discover_procedural_npc_promotions(uuid,uuid),public.world_retry_procedural_npc_promotion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.world_discover_procedural_npc_promotions(uuid,uuid),public.world_retry_procedural_npc_promotion(uuid,uuid) to service_role;
commit;
