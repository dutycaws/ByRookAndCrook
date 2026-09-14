-- Gate E2: keep the mutation implementation private and make the public RPC
-- response a stable envelope for both fresh commits and exact replays.
begin;

alter function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text)
  rename to world_settlement_commit_mutation_core;
alter function public.world_settlement_commit_mutation_core(uuid,uuid,uuid,jsonb,text,text)
  set schema private;

create function public.world_settlement_commit_mutation(
  p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb,
  p_proposal_fingerprint text,p_public_digest text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare core_result jsonb;
begin
  perform private.world_settlement_assert_service();
  if not exists(select 1 from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id) then
    raise sqlstate 'PT409' using message='Settlement job does not belong to settlement';
  end if;
  core_result:=private.world_settlement_commit_mutation_core(
    p_settlement_id,p_job_id,p_fence,p_proposal,p_proposal_fingerprint,p_public_digest
  );
  return coalesce(core_result,'{}'::jsonb) || jsonb_build_object(
    'settlementId',p_settlement_id,
    'jobId',p_job_id,
    'proposalFingerprint',p_proposal_fingerprint,
    'publicDigest',trim(p_public_digest)
  );
end $$;

revoke all on function private.world_settlement_commit_mutation_core(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) to service_role;
commit;
