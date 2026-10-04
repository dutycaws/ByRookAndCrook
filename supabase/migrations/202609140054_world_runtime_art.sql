-- Issue #17: nonblocking, private runtime-art jobs. Canonical state never waits for rendering.
begin;

create table private.world_runtime_art_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete cascade,
  appearance_version text not null check(char_length(appearance_version) between 1 and 128),
  public_appearance text not null check(char_length(public_appearance) between 1 and 1000),
  prompt_hash text not null check(prompt_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check(status in ('queued','processing','accepted','failed_moderated','failed_provider','failed_storage')),
  attempt integer not null default 0 check(attempt>=0),
  fence uuid,
  lease_until timestamptz,
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(save_id,canonical_entity_id,appearance_version,prompt_hash)
);
create table private.world_runtime_art_renders (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references private.world_runtime_art_jobs(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete cascade,
  appearance_version text not null,
  prompt_hash text not null check(prompt_hash ~ '^[0-9a-f]{64}$'),
  runtime_key text not null check(runtime_key ~ '^accepted/[0-9a-f-]{36}/[0-9A-Za-z._-]{1,128}/[0-9a-f]{64}\.png$'),
  mime_type text not null check(mime_type='image/png'),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default clock_timestamp(),
  replaced_render_id uuid references private.world_runtime_art_renders(id) on delete restrict,
  unique(save_id,canonical_entity_id,appearance_version,prompt_hash,sha256)
);
create table private.world_runtime_art_current (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete cascade,
  render_id uuid not null references private.world_runtime_art_renders(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(save_id,canonical_entity_id)
);
create table private.world_runtime_art_appearances (
  canonical_entity_id uuid primary key references private.world_canonical_entities(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  appearance_version text not null check(char_length(appearance_version) between 1 and 128),
  public_appearance text not null check(char_length(public_appearance) between 1 and 1000),
  updated_at timestamptz not null default clock_timestamp()
);

create function private.world_runtime_art_enqueue_appearance() returns trigger language plpgsql security definer set search_path='' as $$
declare v_hash text; v_appearance text;
begin
  v_appearance:=regexp_replace(btrim(new.public_appearance),'\s+',' ','g');
  v_hash := encode(extensions.digest(convert_to(new.canonical_entity_id::text || ':' || new.appearance_version || ':' || v_appearance,'utf8'),'sha256'),'hex');
  insert into private.world_runtime_art_jobs(save_id,canonical_entity_id,appearance_version,public_appearance,prompt_hash)
  values(new.save_id,new.canonical_entity_id,new.appearance_version,v_appearance,v_hash)
  on conflict(save_id,canonical_entity_id,appearance_version,prompt_hash) do nothing;
  return new;
end $$;
create trigger world_runtime_art_enqueue_appearance_insert
  after insert on private.world_runtime_art_appearances for each row
  execute function private.world_runtime_art_enqueue_appearance();
create trigger world_runtime_art_enqueue_appearance_update
  after update of appearance_version on private.world_runtime_art_appearances for each row
  when (old.appearance_version is distinct from new.appearance_version)
  execute function private.world_runtime_art_enqueue_appearance();

-- Canonical insert seeds immutable provenance. Art refreshes use only explicit
-- appearance-record updates; canonical source and payload remain append-only.
create function private.world_runtime_art_seed_appearance() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.world_runtime_art_appearances(canonical_entity_id,save_id,appearance_version,public_appearance)
  values(new.id,new.save_id,coalesce(nullif(new.source_version,''),'world-v1'),regexp_replace(btrim(new.entity_key),'\s+',' ','g'))
  on conflict(canonical_entity_id) do nothing;
  return new;
end $$;
create trigger world_runtime_art_enqueue_entity_insert
  after insert on private.world_canonical_entities for each row
  when (new.lifecycle in ('discovered','active')) execute function private.world_runtime_art_seed_appearance();

-- Existing prototype saves do not replay INSERT triggers when this migration is
-- applied, so seed them once through the same appearance/enqueue path.
insert into private.world_runtime_art_appearances(canonical_entity_id,save_id,appearance_version,public_appearance)
select id,save_id,coalesce(nullif(source_version,''),'world-v1'),regexp_replace(btrim(entity_key),'\s+',' ','g')
from private.world_canonical_entities
where lifecycle in ('discovered','active')
on conflict(canonical_entity_id) do nothing;

create function private.world_runtime_art_assert_service() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise sqlstate 'PT403'; end if;
end $$;
create function private.world_runtime_art_runtime_key(p_job_id uuid,p_appearance_version text,p_sha256 text) returns text language sql immutable set search_path='' as $$
  select 'accepted/' || p_job_id::text || '/' || left(regexp_replace(p_appearance_version,'[^0-9A-Za-z._-]','_','g'),128) || '/' || p_sha256 || '.png'
$$;

create function public.world_runtime_art_set_appearance(p_save_id uuid,p_entity_id uuid,p_appearance_version text,p_public_appearance text) returns void language plpgsql security definer set search_path='' as $$
declare prior private.world_runtime_art_appearances; normalized_version text; normalized_appearance text;
begin
  perform private.world_runtime_art_assert_service();
  normalized_version:=btrim(coalesce(p_appearance_version,'')); normalized_appearance:=regexp_replace(btrim(coalesce(p_public_appearance,'')),'\s+',' ','g');
  if char_length(normalized_version) not between 1 and 128 or char_length(normalized_appearance) not between 1 and 1000 then raise sqlstate 'PT400'; end if;
  select * into prior from private.world_runtime_art_appearances where save_id=p_save_id and canonical_entity_id=p_entity_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  if prior.appearance_version=normalized_version and prior.public_appearance<>normalized_appearance then raise sqlstate 'PT409' using message='A changed public appearance requires a new appearance version'; end if;
  update private.world_runtime_art_appearances set appearance_version=normalized_version,public_appearance=normalized_appearance,updated_at=clock_timestamp()
  where save_id=p_save_id and canonical_entity_id=p_entity_id;
end $$;

create function public.world_runtime_art_claim_next(p_lease_seconds integer default 60) returns jsonb language plpgsql security definer set search_path='' as $$
declare claimed private.world_runtime_art_jobs;
begin
  perform private.world_runtime_art_assert_service();
  if p_lease_seconds not between 15 and 300 then raise sqlstate 'PT400'; end if;
  select j.* into claimed from private.world_runtime_art_jobs j
  where j.status='queued' or (j.status='processing' and j.lease_until<clock_timestamp())
  order by j.created_at,j.id for update skip locked limit 1;
  if not found then return null; end if;
  update private.world_runtime_art_jobs set status='processing',attempt=claimed.attempt+1,fence=extensions.gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),failure_code=null where id=claimed.id returning * into claimed;
  return jsonb_build_object('jobId',claimed.id,'saveId',claimed.save_id,'entityId',claimed.canonical_entity_id,'appearanceVersion',claimed.appearance_version,'publicAppearance',claimed.public_appearance,'attempt',claimed.attempt,'fence',claimed.fence);
end $$;

create function public.world_runtime_art_accept(p_job_id uuid,p_attempt integer,p_fence uuid,p_runtime_key text,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.world_runtime_art_jobs; render private.world_runtime_art_renders; prior uuid; inserted boolean:=false;
begin
  perform private.world_runtime_art_assert_service();
  select * into job from private.world_runtime_art_jobs where id=p_job_id for update;
  if not found or job.status<>'processing' or job.attempt<>p_attempt or job.fence is distinct from p_fence or job.lease_until<=clock_timestamp()
    or p_runtime_key !~ '^accepted/[0-9a-f-]{36}/[0-9A-Za-z._-]{1,128}/[0-9a-f]{64}\.png$'
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_runtime_key <> private.world_runtime_art_runtime_key(job.id,job.appearance_version,p_sha256) then raise sqlstate 'PT400'; end if;
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

create function public.world_runtime_art_fail(p_job_id uuid,p_attempt integer,p_fence uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.world_runtime_art_assert_service();
  if p_status not in ('failed_moderated','failed_provider','failed_storage') then raise sqlstate 'PT400'; end if;
  update private.world_runtime_art_jobs set status=p_status,fence=null,lease_until=null,completed_at=clock_timestamp(),failure_code=p_status
  where id=p_job_id and status='processing' and attempt=p_attempt and fence=p_fence and lease_until>clock_timestamp();
  if not found then raise sqlstate 'PT409'; end if;
end $$;

-- Replacement is deliberately separate from worker completion: only an already
-- accepted job may advance its render pointer outside a leased claim.
create function public.world_runtime_art_replace_accepted(p_job_id uuid,p_runtime_key text,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.world_runtime_art_jobs; render private.world_runtime_art_renders; prior uuid; inserted boolean:=false;
begin
  perform private.world_runtime_art_assert_service();
  select * into job from private.world_runtime_art_jobs where id=p_job_id for update;
  if not found or job.status<>'accepted' or p_runtime_key !~ '^accepted/[0-9a-f-]{36}/[0-9A-Za-z._-]{1,128}/[0-9a-f]{64}\.png$' or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_runtime_key <> private.world_runtime_art_runtime_key(job.id,job.appearance_version,p_sha256) then raise sqlstate 'PT400'; end if;
  select render_id into prior from private.world_runtime_art_current where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id for update;
  insert into private.world_runtime_art_renders(job_id,save_id,canonical_entity_id,appearance_version,prompt_hash,runtime_key,mime_type,sha256,replaced_render_id)
  values(job.id,job.save_id,job.canonical_entity_id,job.appearance_version,job.prompt_hash,p_runtime_key,'image/png',p_sha256,prior)
  on conflict(save_id,canonical_entity_id,appearance_version,prompt_hash,sha256) do nothing returning * into render;
  inserted:=found;
  if render.id is null then select * into render from private.world_runtime_art_renders where save_id=job.save_id and canonical_entity_id=job.canonical_entity_id and appearance_version=job.appearance_version and prompt_hash=job.prompt_hash and sha256=p_sha256; end if;
  insert into private.world_runtime_art_current(save_id,canonical_entity_id,render_id) values(job.save_id,job.canonical_entity_id,render.id) on conflict(save_id,canonical_entity_id) do update set render_id=excluded.render_id,updated_at=clock_timestamp();
  return jsonb_build_object('status','accepted','renderId',render.id,'reused',not inserted);
end $$;

-- The player projection returns one effective state per entity and never a storage path or signed token.
create function public.world_runtime_art_projection(p_save_id uuid) returns jsonb language sql security definer set search_path='' as $$
  with latest as (
    select distinct on (j.canonical_entity_id) j.*
    from private.world_runtime_art_jobs j
    where j.save_id=p_save_id
    order by j.canonical_entity_id,j.created_at desc,j.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId',j.canonical_entity_id,
    'appearanceVersion',j.appearance_version,
    'status',case when j.status='accepted' and r.job_id=j.id then 'accepted' else 'placeholder' end,
    'placeholder',jsonb_build_object('style','world-runtime-art-v1'),
    'render',case when j.status='accepted' and r.job_id=j.id then jsonb_build_object('renderId',r.id,'mimeType',r.mime_type) else null end
  ) order by j.created_at desc,j.id desc),'[]'::jsonb)
  from latest j
  left join private.world_runtime_art_current c on c.save_id=j.save_id and c.canonical_entity_id=j.canonical_entity_id
  left join private.world_runtime_art_renders r on r.id=c.render_id
  join public.tavern_saves s on s.id=j.save_id and s.user_id=auth.uid()
$$;

-- Owner authorization is intentionally opaque; only a server service role may resolve a storage key.
create function public.world_runtime_art_authorize_delivery(p_save_id uuid,p_entity_id uuid,p_render_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.tavern_saves s where s.id=p_save_id and s.user_id=auth.uid())
    or not exists(select 1 from private.world_runtime_art_current c where c.save_id=p_save_id and c.canonical_entity_id=p_entity_id and c.render_id=p_render_id) then raise sqlstate 'PT404'; end if;
  return jsonb_build_object('renderId',p_render_id);
end $$;
create function public.world_runtime_art_service_runtime_key(p_render_id uuid) returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('runtimeKey',r.runtime_key)
  from private.world_runtime_art_renders r
  join private.world_runtime_art_current c on c.render_id=r.id
  where r.id=p_render_id
$$;

revoke all on private.world_runtime_art_jobs,private.world_runtime_art_renders,private.world_runtime_art_current,private.world_runtime_art_appearances from public,anon,authenticated;
revoke all on function public.world_runtime_art_projection(uuid),public.world_runtime_art_authorize_delivery(uuid,uuid,uuid) from public,anon;
grant execute on function public.world_runtime_art_projection(uuid),public.world_runtime_art_authorize_delivery(uuid,uuid,uuid) to authenticated;
revoke all on function public.world_runtime_art_accept(uuid,integer,uuid,text,text),public.world_runtime_art_replace_accepted(uuid,text,text),public.world_runtime_art_fail(uuid,integer,uuid,text),public.world_runtime_art_service_runtime_key(uuid),public.world_runtime_art_set_appearance(uuid,uuid,text,text),public.world_runtime_art_claim_next(integer) from public,anon,authenticated;
grant execute on function public.world_runtime_art_accept(uuid,integer,uuid,text,text),public.world_runtime_art_replace_accepted(uuid,text,text),public.world_runtime_art_fail(uuid,integer,uuid,text),public.world_runtime_art_service_runtime_key(uuid),public.world_runtime_art_set_appearance(uuid,uuid,text,text),public.world_runtime_art_claim_next(integer) to service_role;
commit;
