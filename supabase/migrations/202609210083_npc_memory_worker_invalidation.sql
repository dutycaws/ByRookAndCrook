-- Issue #33 iteration 1: expose the derived-memory queue only to the service
-- worker, bind completion to its original source, and leave a durable fence
-- receipt when a resident is removed while work is in flight.
begin;

create table private.world_npc_memory_invalidations (
  job_id uuid primary key,
  save_id uuid not null,
  instance_id uuid not null,
  fence uuid not null,
  source_kind text not null,
  source_id uuid not null,
  source_version bigint not null,
  reason text not null check (reason in ('resident_removed')),
  invalidated_at timestamptz not null default clock_timestamp()
);

create index world_npc_memory_invalidations_instance
  on private.world_npc_memory_invalidations(instance_id, invalidated_at desc);

-- A failed derived job is a coverage gap, not an examined source.  In
-- particular, a later completed job must not make an earlier failure appear
-- contiguous or safe to omit from canonical fallback.
create or replace function private.world_npc_memory_refresh_watermark(
  p_instance_id uuid,p_processor_kind text,p_processor_version text
) returns void language plpgsql security definer set search_path='' as $function$
declare v_max bigint; v_examined bigint; v_gap bigint;
begin
  select max(source_sequence) into v_max
  from private.world_npc_memory_outbox
  where instance_id=p_instance_id and processor_kind=p_processor_kind and processor_version=p_processor_version;
  select max(source_sequence) into v_examined
  from (
    select source_sequence
    from private.world_npc_memory_outbox
    where instance_id=p_instance_id and processor_kind=p_processor_kind and processor_version=p_processor_version
    group by source_sequence
    having bool_and(status in ('completed','invalidated','failed'))
  ) examined_coordinates;
  if v_max is not null then
    -- Source sequences start at zero.  Grouping makes several source records
    -- at one coordinate a gap until every record at that coordinate is final.
    select min(sequence_value) into v_gap
    from generate_series(0,v_max) as sequence_row(sequence_value)
    left join lateral (
      select bool_and(status in ('completed','invalidated')) final
      from private.world_npc_memory_outbox
      where instance_id=p_instance_id and processor_kind=p_processor_kind
        and processor_version=p_processor_version and source_sequence=sequence_value
    ) grouped on true
    where coalesce(grouped.final,false)=false;
  end if;
  insert into private.world_npc_memory_watermarks(instance_id,processor_kind,processor_version,contiguous_sequence,examined_through_sequence,gap_sequence)
  values(p_instance_id,p_processor_kind,p_processor_version,coalesce(v_gap-1,v_max,-1),coalesce(v_examined,-1),v_gap)
  on conflict(instance_id,processor_kind,processor_version) do update
    set contiguous_sequence=excluded.contiguous_sequence,
        examined_through_sequence=excluded.examined_through_sequence,
        gap_sequence=excluded.gap_sequence,
        updated_at=clock_timestamp();
end $function$;

create function private.world_npc_memory_invalidate_instance()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  insert into private.world_npc_memory_invalidations(job_id,save_id,instance_id,fence,source_kind,source_id,source_version,reason)
  select job.id,job.save_id,job.instance_id,job.fence,job.source_kind,job.source_id,job.source_version,'resident_removed'
  from private.world_npc_memory_outbox job
  where job.instance_id=old.id and job.status='processing'
  on conflict(job_id) do nothing;
  return old;
end $function$;

drop trigger if exists world_npc_memory_invalidate_before_resident_delete on private.world_npc_instances;
create trigger world_npc_memory_invalidate_before_resident_delete
before delete on private.world_npc_instances
for each row execute function private.world_npc_memory_invalidate_instance();

create or replace function private.world_npc_memory_complete(
  p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null
) returns void language plpgsql security definer set search_path='' as $function$
declare job private.world_npc_memory_outbox; artifact jsonb; current_hash text;
begin
  if exists(select 1 from private.world_npc_memory_invalidations invalidation
            where invalidation.job_id=p_job_id and invalidation.fence=p_fence) then
    raise sqlstate 'PT409' using message='Memory work fence is stale';
  end if;
  select * into job from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or job.fence<>p_fence or job.status<>'processing' or job.lease_until<=clock_timestamp() then
    raise sqlstate 'PT409' using message='Memory work fence is stale';
  end if;
  if p_error_code is not null then
    update private.world_npc_memory_outbox set status='failed',examined_at=clock_timestamp(),error_code=left(p_error_code,120),lease_until=null where id=job.id;
    perform private.world_npc_memory_refresh_watermark(job.instance_id,job.processor_kind,job.processor_version);
    return;
  end if;
  if job.source_kind='dialogue_turn' then
    select encode(extensions.digest(convert_to(turn.message || E'\n' || coalesce(turn.result->>'reply',''),'utf8'),'sha256'),'hex')
      into current_hash
    from private.world_npc_dialogue_turns turn
    where turn.id=job.source_id and turn.save_id=job.save_id and turn.instance_id=job.instance_id
      and turn.status='completed' and job.source_version=1;
  else
    current_hash:=null;
  end if;
  if current_hash is null or current_hash<>job.source_hash then
    raise sqlstate 'PT409' using message='Memory source changed or is unavailable';
  end if;
  if jsonb_typeof(coalesce(p_artifacts,'[]'::jsonb))<>'array' then
    raise sqlstate 'PT400' using message='Memory artifacts are invalid';
  end if;
  if p_error_code is null then
    for artifact in select value from jsonb_array_elements(coalesce(p_artifacts,'[]'::jsonb)) loop
      if artifact->>'artifactKind' not in ('episode_summary','quest_summary','embedding')
        or coalesce(artifact->>'sourceKind',job.source_kind)<>job.source_kind
        or coalesce(artifact->>'contentHash','') !~ '^[0-9a-f]{64}$'
        or coalesce(artifact->>'disclosureClass','npc_known') not in ('player_visible','npc_known','npc_private','system')
        or (artifact ? 'embeddingDimensions' and ((artifact->>'embeddingDimensions') !~ '^[0-9]+$' or nullif(artifact->>'embedding','') is null)) then
        raise sqlstate 'PT400' using message='Memory artifact does not match its source contract';
      end if;
      insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,contract_hash,disclosure_class,content,content_hash,embedding,embedding_dimensions)
      values(job.save_id,job.instance_id,artifact->>'artifactKind',coalesce(artifact->>'sourceKind',job.source_kind),array[job.source_id],array[job.source_version],job.source_hash,job.processor_version,artifact->>'model',artifact->>'contractHash',coalesce(artifact->>'disclosureClass','npc_known'),coalesce(artifact->'content','{}'::jsonb),artifact->>'contentHash',nullif(artifact->>'embedding','')::extensions.vector,nullif(artifact->>'embeddingDimensions','')::integer)
      on conflict(instance_id,artifact_kind,source_hash,processor_version) do nothing;
    end loop;
    update private.world_npc_memory_outbox set status='completed',examined_at=clock_timestamp(),completed_at=clock_timestamp(),lease_until=null where id=job.id;
  end if;
  perform private.world_npc_memory_refresh_watermark(job.instance_id,job.processor_kind,job.processor_version);
end $function$;

create function public.world_npc_memory_claim(p_processor_kind text,p_processor_version text)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.world_settlement_assert_service();
  return private.world_npc_memory_claim(p_processor_kind,p_processor_version);
end $function$;

create function public.world_npc_memory_complete(
  p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null
) returns void language plpgsql security definer set search_path='' as $function$
begin
  perform private.world_settlement_assert_service();
  perform private.world_npc_memory_complete(p_job_id,p_fence,p_artifacts,p_error_code);
end $function$;

revoke all on table private.world_npc_memory_invalidations from public,anon,authenticated,service_role;
revoke all on function private.world_npc_memory_invalidate_instance() from public,anon,authenticated;
revoke all on function public.world_npc_memory_claim(text,text),public.world_npc_memory_complete(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.world_npc_memory_claim(text,text),public.world_npc_memory_complete(uuid,uuid,jsonb,text) to service_role;

commit;
