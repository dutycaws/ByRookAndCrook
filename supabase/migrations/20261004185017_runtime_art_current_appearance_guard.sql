-- A valid lease does not authorize publishing an obsolete appearance.

create or replace function public.world_runtime_art_accept(p_job_id uuid,p_attempt integer,p_fence uuid,p_runtime_key text,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.world_runtime_art_jobs; render private.world_runtime_art_renders; prior uuid; inserted boolean:=false;
begin
  perform private.world_runtime_art_assert_service();
  select * into job from private.world_runtime_art_jobs where id=p_job_id for update;
  if not found or job.status<>'processing' or job.attempt<>p_attempt or job.fence is distinct from p_fence or job.lease_until<=clock_timestamp()
    or p_runtime_key !~ '^accepted/[0-9a-f-]{36}/[0-9A-Za-z._-]{1,128}/[0-9a-f]{64}\.png$'
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_runtime_key <> private.world_runtime_art_runtime_key(job.id,job.appearance_version,p_sha256) then raise sqlstate 'PT400'; end if;
  -- Serialize publication against appearance changes, including when no current render exists.
  perform 1 from private.world_runtime_art_appearances
  where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id
    and appearance_version=job.appearance_version and public_appearance=job.public_appearance
  for update;
  if not found then
    raise sqlstate 'PT409' using message='Runtime art appearance has been superseded';
  end if;
  select render_id into prior from private.world_runtime_art_current where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id for update;
  insert into private.world_runtime_art_renders(job_id,save_id,canonical_entity_id,appearance_version,prompt_hash,runtime_key,mime_type,sha256,replaced_render_id)
  values(job.id,job.save_id,job.canonical_entity_id,job.appearance_version,job.prompt_hash,p_runtime_key,'image/png',p_sha256,prior)
  on conflict(save_id,canonical_entity_id,appearance_version,prompt_hash,sha256) do nothing
  returning * into render;
  inserted:=found;
  if render.id is null then
    select * into render from private.world_runtime_art_renders
    where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id and appearance_version=job.appearance_version and prompt_hash=job.prompt_hash and sha256=p_sha256;
  end if;
  insert into private.world_runtime_art_current(save_id,canonical_entity_id,render_id)
  values(job.save_id,job.canonical_entity_id,render.id)
  on conflict(save_id,canonical_entity_id) do update set render_id=excluded.render_id,updated_at=clock_timestamp();
  update private.world_runtime_art_jobs set status='accepted',failure_code=null,fence=null,lease_until=null,completed_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('status','accepted','renderId',render.id,'reused',not inserted);
end $$;

create or replace function public.world_runtime_art_replace_accepted(p_job_id uuid,p_runtime_key text,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.world_runtime_art_jobs; render private.world_runtime_art_renders; prior uuid; inserted boolean:=false;
begin
  perform private.world_runtime_art_assert_service();
  select * into job from private.world_runtime_art_jobs where id=p_job_id for update;
  if not found or job.status<>'accepted' or p_runtime_key !~ '^accepted/[0-9a-f-]{36}/[0-9A-Za-z._-]{1,128}/[0-9a-f]{64}\.png$' or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_runtime_key <> private.world_runtime_art_runtime_key(job.id,job.appearance_version,p_sha256) then raise sqlstate 'PT400'; end if;
  -- Serialize publication against appearance changes, including when no current render exists.
  perform 1 from private.world_runtime_art_appearances
  where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id
    and appearance_version=job.appearance_version and public_appearance=job.public_appearance
  for update;
  if not found then
    raise sqlstate 'PT409' using message='Runtime art appearance has been superseded';
  end if;
  select render_id into prior from private.world_runtime_art_current where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id for update;
  insert into private.world_runtime_art_renders(job_id,save_id,canonical_entity_id,appearance_version,prompt_hash,runtime_key,mime_type,sha256,replaced_render_id)
  values(job.id,job.save_id,job.canonical_entity_id,job.appearance_version,job.prompt_hash,p_runtime_key,'image/png',p_sha256,prior)
  on conflict(save_id,canonical_entity_id,appearance_version,prompt_hash,sha256) do nothing returning * into render;
  inserted:=found;
  if render.id is null then select * into render from private.world_runtime_art_renders where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id and appearance_version=job.appearance_version and prompt_hash=job.prompt_hash and sha256=p_sha256; end if;
  insert into private.world_runtime_art_current(save_id,canonical_entity_id,render_id) values(job.save_id,job.canonical_entity_id,render.id) on conflict(save_id,canonical_entity_id) do update set render_id=excluded.render_id,updated_at=clock_timestamp();
  return jsonb_build_object('status','accepted','renderId',render.id,'reused',not inserted);
end $$;
