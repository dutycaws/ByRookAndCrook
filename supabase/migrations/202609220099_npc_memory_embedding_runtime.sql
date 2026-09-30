-- Issue #33 checkpoint 3: durable, source-bound embedding work.  SQL only
-- plans and accepts evidence; a service worker remains the provider boundary.
begin;

create or replace function private.world_npc_memory_embedding_input(p_source private.world_npc_memory_sources)
returns jsonb language sql stable security definer set search_path='' as $f$
  select jsonb_build_object('version','npc-memory-embedding-input-v1','sourceKind',p_source.source_kind,
    'sourceId',p_source.source_id,'sourceVersion',p_source.source_version,'sourceHash',p_source.source_hash,
    'ledgerSequence',p_source.ledger_sequence,'envelope',p_source.envelope)
$f$;

create or replace function private.world_npc_memory_embedding_enqueue_source(p_source private.world_npc_memory_sources)
returns boolean language plpgsql security definer set search_path='' as $f$
declare p private.world_npc_memory_embedding_profiles;
begin
  select * into p from private.world_npc_memory_embedding_profiles where active and invalidated_at is null;
  if not found then return false; end if;
  insert into private.world_npc_memory_outbox(save_id,instance_id,source_kind,source_id,source_version,source_sequence,source_hash,processor_kind,processor_version)
  values(p_source.save_id,p_source.instance_id,p_source.source_kind,p_source.source_id,p_source.source_version,p_source.ledger_sequence,p_source.source_hash,'embedding',p.processor_version)
  on conflict(source_kind,source_id,source_version,processor_kind,processor_version) do nothing;
  return found;
end $f$;

create or replace function public.world_npc_memory_embedding_schedule(p_limit integer default 16)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare p private.world_npc_memory_embedding_profiles; made integer:=0; s private.world_npc_memory_sources;
begin
  perform private.world_settlement_assert_service();
  select * into p from private.world_npc_memory_embedding_profiles where active and invalidated_at is null;
  if not found then return jsonb_build_object('scheduled',0,'semanticAvailable',false,'reason','no_active_profile'); end if;
  for s in select * from private.world_npc_memory_sources source_row where source_row.disclosure_class<>'system'
    and not exists(select 1 from private.world_npc_memory_outbox j where j.source_kind=source_row.source_kind and j.source_id=source_row.source_id and j.source_version=source_row.source_version and j.processor_kind='embedding' and j.processor_version=p.processor_version)
    order by source_row.instance_id,source_row.ledger_sequence,source_row.source_id limit greatest(0,least(coalesce(p_limit,16),32)) loop
    if private.world_npc_memory_embedding_enqueue_source(s) then made:=made+1; end if;
  end loop;
  return jsonb_build_object('scheduled',made,'semanticAvailable',true,'profileId',p.id,'processorVersion',p.processor_version);
end $f$;

create or replace function public.world_npc_memory_embedding_plan(p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; s private.world_npc_memory_sources; p private.world_npc_memory_embedding_profiles; input jsonb; h text;
begin
  perform private.world_settlement_assert_service();
  select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or j.processor_kind<>'embedding' or j.status<>'processing' or j.fence<>p_fence or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Embedding work fence is stale'; end if;
  select * into p from private.world_npc_memory_embedding_profiles where processor_version=j.processor_version and active and invalidated_at is null;
  if not found then raise sqlstate 'PT409' using message='Embedding profile is no longer active'; end if;
  select * into s from private.world_npc_memory_sources where source_kind=j.source_kind and source_id=j.source_id and source_version=j.source_version;
  if not found or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.source_hash<>j.source_hash or s.ledger_sequence<>j.source_sequence or s.disclosure_class='system' or private.world_npc_memory_source_hash(j.source_kind,j.source_id)<>j.source_hash then raise sqlstate 'PT409' using message='Embedding source is stale or unavailable'; end if;
  input:=private.world_npc_memory_embedding_input(s); h:=encode(extensions.digest(private.world_canonical_json(input),'sha256'),'hex');
  if input->'envelope' is null or input->'envelope'='{}'::jsonb then raise sqlstate 'PT409' using message='Embedding input is empty'; end if;
  return jsonb_build_object('jobId',j.id,'fence',j.fence,'profile',jsonb_build_object('id',p.id,'processorVersion',p.processor_version,'model',p.model,'dimensions',p.dimensions),'source',jsonb_build_object('kind',s.source_kind,'id',s.source_id,'version',s.source_version,'hash',s.source_hash,'ledgerSequence',s.ledger_sequence,'disclosureClass',s.disclosure_class),'input',input,'inputHash',h);
end $f$;

create or replace function public.world_npc_memory_embedding_complete(
 p_job_id uuid,p_fence uuid,p_profile_id uuid,p_input_hash text,p_model text,p_dimensions integer,p_embedding extensions.vector,p_provider_request_id text default null,p_provider_usage jsonb default '{}'::jsonb,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; s private.world_npc_memory_sources; p private.world_npc_memory_embedding_profiles; input jsonb; h text; content jsonb; ch text; a private.world_npc_memory_artifacts;
begin
  perform private.world_settlement_assert_service(); select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or j.processor_kind<>'embedding' or j.fence<>p_fence then raise sqlstate 'PT409' using message='Embedding work fence is stale'; end if;
  select * into p from private.world_npc_memory_embedding_profiles where id=p_profile_id and processor_version=j.processor_version and invalidated_at is null;
  if not found or (j.status<>'completed' and not p.active) then raise sqlstate 'PT409' using message='Embedding profile is stale'; end if;
  select * into s from private.world_npc_memory_sources where source_kind=j.source_kind and source_id=j.source_id and source_version=j.source_version;
  if not found or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.source_hash<>j.source_hash or s.ledger_sequence<>j.source_sequence or s.disclosure_class='system' or private.world_npc_memory_source_hash(j.source_kind,j.source_id)<>j.source_hash then raise sqlstate 'PT409' using message='Embedding source is stale or unavailable'; end if;
  input:=private.world_npc_memory_embedding_input(s); h:=encode(extensions.digest(private.world_canonical_json(input),'sha256'),'hex');
  if p_input_hash is distinct from h then raise sqlstate 'PT409' using message='Embedding input hash is stale'; end if;
  if p_error_code is not null then
    if j.status<>'processing' or j.lease_until<=clock_timestamp() or p_error_code not in ('provider_timeout','provider_unavailable','provider_malformed','worker_failed') then raise sqlstate 'PT409' using message='Embedding failure is stale or invalid'; end if;
    update private.world_npc_memory_outbox set status='failed',examined_at=clock_timestamp(),lease_until=null,error_code=p_error_code where id=j.id;
    perform private.world_npc_memory_refresh_watermark(j.instance_id,j.processor_kind,j.processor_version); return jsonb_build_object('status','failed');
  end if;
  if p_model is distinct from p.model or p_dimensions is distinct from p.dimensions or p_embedding is null or extensions.vector_dims(p_embedding)<>p.dimensions or extensions.vector_norm(p_embedding)<=0
     or not private.world_json_keys_exact(p_provider_usage,array['promptTokens','totalTokens'])
     or jsonb_typeof(p_provider_usage->'promptTokens')<>'number' or jsonb_typeof(p_provider_usage->'totalTokens')<>'number'
     or p_provider_usage->>'promptTokens' !~ '^[0-9]+$' or p_provider_usage->>'totalTokens' !~ '^[0-9]+$'
     or (p_provider_usage->>'totalTokens')::bigint<(p_provider_usage->>'promptTokens')::bigint
     or p_provider_request_id is null or p_provider_request_id !~ '^[A-Za-z0-9._:-]{1,200}$' then raise sqlstate 'PT400' using message='Embedding provider result is invalid'; end if;
  content:=jsonb_build_object('version','npc-memory-embedding-v3','inputHash',h,'providerUsage',p_provider_usage,'providerRequestId',p_provider_request_id); ch:=encode(extensions.digest(private.world_canonical_json(content),'sha256'),'hex');
  if j.status='completed' then
    select * into a from private.world_npc_memory_artifacts where instance_id=j.instance_id and artifact_kind='embedding' and source_hash=j.source_hash and processor_version=j.processor_version;
    if not found or a.embedding_profile_id<>p.id or a.model<>p.model or a.embedding_dimensions<>p.dimensions or a.embedding::text<>p_embedding::text or a.content<>content or a.content_hash<>ch then raise sqlstate 'PT409' using message='Embedding completion replay conflicts'; end if;
    return jsonb_build_object('status','reused','contentHash',ch);
  end if;
  if j.status<>'processing' or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Embedding work fence is stale'; end if;
  insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,disclosure_class,content,content_hash,embedding,embedding_dimensions,embedding_profile_id)
  values(j.save_id,j.instance_id,'embedding',j.source_kind,array[j.source_id],array[j.source_version],j.source_hash,j.processor_version,p.model,s.disclosure_class,content,ch,p_embedding,p.dimensions,p.id);
  update private.world_npc_memory_outbox set status='completed',examined_at=clock_timestamp(),completed_at=clock_timestamp(),lease_until=null where id=j.id;
  perform private.world_npc_memory_refresh_watermark(j.instance_id,j.processor_kind,j.processor_version); return jsonb_build_object('status','completed','contentHash',ch);
end $f$;

revoke all on function private.world_npc_memory_embedding_input(private.world_npc_memory_sources),private.world_npc_memory_embedding_enqueue_source(private.world_npc_memory_sources) from public,anon,authenticated,service_role;
revoke all on function public.world_npc_memory_embedding_schedule(integer),public.world_npc_memory_embedding_plan(uuid,uuid),public.world_npc_memory_embedding_complete(uuid,uuid,uuid,text,text,integer,extensions.vector,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.world_npc_memory_embedding_schedule(integer),public.world_npc_memory_embedding_plan(uuid,uuid),public.world_npc_memory_embedding_complete(uuid,uuid,uuid,text,text,integer,extensions.vector,text,jsonb,text) to service_role;
commit;
