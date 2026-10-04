-- Immutable, privacy-safe provenance for resident package publication and
-- materialization.  This stores identifiers, hashes, timings, and typed
-- outcomes only; NPC sheets, profiles, prompts, and provider payloads never
-- enter this projection.
begin;

create table private.npc_resident_package_observations (
  id bigint generated always as identity primary key,
  operation text not null check(operation in ('publication','materialization')),
  status text not null check(status in ('completed','failed')),
  source_kind text not null check(source_kind in ('first_party','community','promoted','unknown')),
  actor_id uuid,
  npc_id uuid,
  version_id uuid,
  package_id uuid,
  package_hash text check(package_hash is null or package_hash ~ '^[a-f0-9]{64}$'),
  save_id uuid,
  instance_id uuid,
  error_code text check(error_code is null or error_code ~ '^[A-Z0-9]{5}$'),
  duration_ms integer check(duration_ms is null or duration_ms between 0 and 600000),
  occurred_at timestamptz not null default clock_timestamp(),
  check((status='completed' and error_code is null) or (status='failed' and error_code is not null))
);
create index npc_resident_package_observations_recent_idx
  on private.npc_resident_package_observations(occurred_at desc,id desc);
create index npc_resident_package_observations_npc_idx
  on private.npc_resident_package_observations(npc_id,version_id,occurred_at desc);
create index npc_resident_package_observations_save_idx
  on private.npc_resident_package_observations(save_id,instance_id,occurred_at desc)
  where save_id is not null;
create trigger npc_resident_package_observations_append_only
  before update or delete on private.npc_resident_package_observations
  for each row execute function private.world_history_append_only();

create function private.npc_record_resident_package_observation(
  p_operation text,p_status text,p_source_kind text,p_actor_id uuid,
  p_npc_id uuid,p_version_id uuid,p_package_id uuid,p_package_hash text,
  p_save_id uuid,p_instance_id uuid,p_error_code text,p_duration_ms integer
) returns void language plpgsql security definer set search_path='' as $f$
begin
  insert into private.npc_resident_package_observations(
    operation,status,source_kind,actor_id,npc_id,version_id,package_id,package_hash,
    save_id,instance_id,error_code,duration_ms
  ) values(
    p_operation,p_status,p_source_kind,p_actor_id,p_npc_id,p_version_id,p_package_id,p_package_hash,
    p_save_id,p_instance_id,p_error_code,p_duration_ms
  );
end $f$;

-- Successful package publication is projected by the immutable package insert.
create function private.npc_observe_resident_package_publication()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  perform private.npc_record_resident_package_observation(
    'publication','completed',new.source_kind,coalesce(new.published_by,auth.uid()),
    new.npc_id,new.version_id,new.id,new.package_hash,new.save_id,null,null,null
  );
  return new;
end $f$;
create trigger npc_resident_package_publication_observed
  after insert on private.npc_version_resident_packages
  for each row execute function private.npc_observe_resident_package_publication();

-- A pin is created in the same transaction as the instance and resident
-- profile, so it is the durable materialization success boundary.
create function private.npc_observe_resident_package_materialization()
returns trigger language plpgsql security definer set search_path='' as $f$
declare p private.npc_version_resident_packages;
begin
  select * into p from private.npc_version_resident_packages where id=new.package_id;
  perform private.npc_record_resident_package_observation(
    'materialization','completed',p.source_kind,auth.uid(),
    new.npc_id,new.version_id,new.package_id,new.package_hash,new.save_id,new.instance_id,null,null
  );
  return new;
end $f$;
create trigger npc_resident_package_materialization_observed
  after insert on private.world_resident_package_pins
  for each row execute function private.npc_observe_resident_package_materialization();

-- PostgreSQL rolls back an in-transaction audit row with a re-raised error.
-- Callers therefore record a caught package failure through this service-only
-- seam after their failed transaction has ended.  It accepts error *codes*,
-- never exception messages or request/sheet payloads.
create function public.npc_resident_package_record_failure(
  p_operation text,p_source_kind text,p_actor_id uuid,
  p_npc_id uuid,p_version_id uuid,p_package_id uuid default null,p_package_hash text default null,
  p_save_id uuid default null,p_instance_id uuid default null,p_error_code text default null,
  p_duration_ms integer default null
) returns void language plpgsql security definer set search_path='' as $f$
declare p private.npc_version_resident_packages;
begin
  perform private.prompt_registry_assert_service();
  if p_operation not in ('publication','materialization')
    or p_source_kind not in ('first_party','community','promoted','unknown')
    or p_error_code is null or p_error_code !~ '^[A-Z0-9]{5}$'
    or p_duration_ms is not null and p_duration_ms not between 0 and 600000 then
    raise sqlstate 'PT400' using message='Invalid resident package failure observation';
  end if;
  if p_package_id is not null then
    select * into p from private.npc_version_resident_packages where id=p_package_id;
    if not found or p.npc_id is distinct from p_npc_id or p.version_id is distinct from p_version_id
      or p.package_hash is distinct from p_package_hash or p.source_kind is distinct from p_source_kind then
      raise sqlstate 'PT400' using message='Package failure observation does not match its immutable package';
    end if;
  elsif p_package_hash is not null then
    raise sqlstate 'PT400' using message='Package hash requires a package identifier';
  end if;
  perform private.npc_record_resident_package_observation(
    p_operation,'failed',p_source_kind,p_actor_id,p_npc_id,p_version_id,p_package_id,p_package_hash,
    p_save_id,p_instance_id,p_error_code,p_duration_ms
  );
end $f$;

-- This is intentionally projection-only and administrator-only.  It does not
-- reveal frozen sheets, resident profiles, prompts, exception messages, or
-- arbitrary request metadata.
create function public.npc_resident_package_observations_recent(p_limit integer default 50)
returns table(
  id bigint,operation text,status text,source_kind text,actor_id uuid,npc_id uuid,version_id uuid,
  package_id uuid,package_hash text,save_id uuid,instance_id uuid,error_code text,duration_ms integer,
  occurred_at timestamptz
) language plpgsql security definer set search_path='' as $f$
begin
  perform private.prompt_registry_assert_admin();
  if p_limit is null or p_limit not between 1 and 100 then
    raise sqlstate 'PT400' using message='Observation limit must be between 1 and 100';
  end if;
  return query
    select o.id,o.operation,o.status,o.source_kind,o.actor_id,o.npc_id,o.version_id,
      o.package_id,o.package_hash,o.save_id,o.instance_id,o.error_code,o.duration_ms,o.occurred_at
    from private.npc_resident_package_observations o
    order by o.occurred_at desc,o.id desc
    limit p_limit;
end $f$;

revoke all on table private.npc_resident_package_observations from public,anon,authenticated,service_role;
revoke all on function private.npc_record_resident_package_observation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.npc_resident_package_record_failure(text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,text,integer),public.npc_resident_package_observations_recent(integer) from public,anon,authenticated,service_role;
grant execute on function public.npc_resident_package_record_failure(text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,text,integer) to service_role;
grant execute on function public.npc_resident_package_observations_recent(integer) to authenticated;

commit;
