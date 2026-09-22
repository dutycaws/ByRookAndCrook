-- Issue #33: completion may accept a vector only after the durable receipt
-- proves the corresponding provider request crossed the dispatch boundary.
begin;

create function public.world_npc_memory_embedding_accept(
  p_job_id uuid,p_fence uuid,p_profile_id uuid,p_input_hash text,p_model text,
  p_dimensions integer,p_embedding extensions.vector,p_provider_request_id text default null,
  p_provider_usage jsonb default '{}'::jsonb,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare b jsonb; h jsonb; r private.world_npc_memory_embedding_dispatches;
  j private.world_npc_memory_outbox; s private.world_npc_memory_sources;
  p private.world_npc_memory_embedding_profiles; input jsonb; input_hash text;
begin
  perform private.world_settlement_assert_service();
  -- Failures can occur before dispatch (configuration/preflight/provider) and
  -- must remain terminalizable.  099 owns its strict code/source/fence checks.
  if p_error_code is not null then
    return public.world_npc_memory_embedding_complete(p_job_id,p_fence,p_profile_id,p_input_hash,
      p_model,p_dimensions,p_embedding,p_provider_request_id,p_provider_usage,p_error_code);
  end if;
  select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
  if found and j.status='completed' then
    -- Exact replay does not have a live lease or necessarily active profile,
    -- but it must still reconstruct the immutable source/profile request.
    if j.processor_kind<>'embedding' or j.fence<>p_fence then raise sqlstate 'PT409' using message='Embedding completion fence is stale'; end if;
    select * into p from private.world_npc_memory_embedding_profiles where id=p_profile_id and processor_version=j.processor_version and invalidated_at is null;
    select * into s from private.world_npc_memory_sources where source_kind=j.source_kind and source_id=j.source_id and source_version=j.source_version;
    if not found or p.id is null or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.source_hash<>j.source_hash or s.ledger_sequence<>j.source_sequence or s.disclosure_class='system' or private.world_npc_memory_source_hash(j.source_kind,j.source_id)<>j.source_hash then raise sqlstate 'PT409' using message='Embedding completion replay source or profile is stale'; end if;
    input:=private.world_npc_memory_embedding_input(s); input_hash:=encode(extensions.digest(private.world_canonical_json(input),'sha256'),'hex');
    b:=jsonb_build_object('jobId',j.id,'fence',j.fence,'profileId',p.id,'processorVersion',p.processor_version,'model',p.model,'dimensions',p.dimensions,'sourceKind',s.source_kind,'sourceId',s.source_id,'sourceVersion',s.source_version,'sourceHash',s.source_hash,'input',input,'inputText',private.world_canonical_json(input),'inputHash',input_hash);
  else
    b:=private.world_npc_memory_embedding_dispatch_assert(p_job_id,p_fence);
  end if;
  h:=private.world_npc_memory_embedding_dispatch_hashes(b);
  select * into r from private.world_npc_memory_embedding_dispatches
    where job_id=(b->>'jobId')::uuid for update;
  if not found or r.state<>'dispatched' or r.fence<>(b->>'fence')::uuid
     or r.profile_id<>(b->>'profileId')::uuid or r.input_hash<>b->>'inputHash'
     or r.source_kind<>b->>'sourceKind' or r.source_id<>(b->>'sourceId')::uuid
     or r.source_version<>(b->>'sourceVersion')::bigint or r.source_hash<>b->>'sourceHash'
     or r.identity_hash<>h->>'identityHash' or r.request_hash<>h->>'requestHash'
     or p_profile_id<>(b->>'profileId')::uuid or p_input_hash<>b->>'inputHash' then
    raise sqlstate 'PT409' using message='Embedding completion dispatch receipt is stale or unavailable';
  end if;
  return public.world_npc_memory_embedding_complete(p_job_id,p_fence,p_profile_id,p_input_hash,
    p_model,p_dimensions,p_embedding,p_provider_request_id,p_provider_usage,null);
end $f$;

-- Preserve the legacy/extract worker API, but make embedding completion use
-- the receipt/profile path above exclusively.
create or replace function public.world_npc_memory_complete(
  p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null
) returns void language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox;
begin
  perform private.world_settlement_assert_service();
  select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
  if found and j.processor_kind='embedding' then
    raise sqlstate 'PT409' using message='Embedding work requires receipt-gated completion';
  end if;
  perform private.world_npc_memory_complete(p_job_id,p_fence,p_artifacts,p_error_code);
end $f$;

revoke all on function public.world_npc_memory_embedding_complete(uuid,uuid,uuid,text,text,integer,extensions.vector,text,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.world_npc_memory_embedding_accept(uuid,uuid,uuid,text,text,integer,extensions.vector,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.world_npc_memory_embedding_accept(uuid,uuid,uuid,text,text,integer,extensions.vector,text,jsonb,text)
  to service_role;
revoke all on function public.world_npc_memory_complete(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.world_npc_memory_complete(uuid,uuid,jsonb,text) to service_role;
commit;
