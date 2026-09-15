-- Issue #17: immutable v2 procedural capability baseline for pilot residents.
-- Existing evolution pins remain historical evidence.  The narrowly-scoped
-- source below is used only by procedural world context and command admission.
begin;

create table private.world_pilot_resident_procedural_definitions (
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  definition_version text not null check (definition_version='pilot-resident-v2'),
  registry_version text not null check (registry_version='pilot-residents-v2'),
  personality_schema jsonb not null,
  initial_profile jsonb not null,
  capability_envelope jsonb not null,
  appearance_source jsonb not null,
  appearance_spec jsonb not null,
  primary key (npc_id, version_id, definition_version),
  check (jsonb_typeof(personality_schema)='object' and jsonb_typeof(initial_profile)='object' and jsonb_typeof(capability_envelope)='object' and jsonb_typeof(appearance_source)='object' and jsonb_typeof(appearance_spec)='object')
);

create function private.world_pilot_resident_procedural_definition_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode='55000', message='Pilot procedural definitions are immutable';
  end if;
  return new;
end $$;
create trigger world_pilot_resident_procedural_definition_immutable
before update or delete on private.world_pilot_resident_procedural_definitions
for each row execute function private.world_pilot_resident_procedural_definition_guard();

insert into private.world_pilot_resident_procedural_definitions(
  npc_id,version_id,definition_version,registry_version,personality_schema,initial_profile,capability_envelope,appearance_source,appearance_spec
)
select npc_id,version_id,'pilot-resident-v2','pilot-residents-v2',personality_schema,initial_profile,
  jsonb_set(
    jsonb_set(capability_envelope,'{allowedWorldEffects}',
      '["adjust_relationship","create_entity","create_quest","update_quest","record_world_event"]'::jsonb),
    '{allowedTargetKinds}','["npc","location","faction","item","recipe","world_event"]'::jsonb),
  appearance_source,appearance_spec
from private.world_pilot_resident_definitions;

create table private.world_resident_procedural_capability_sources (
  instance_id uuid primary key references private.world_npc_instances(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  definition_version text not null,
  registry_version text not null,
  capability_envelope jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(capability_envelope)='object')
);

create function private.world_resident_procedural_capability_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    -- A source may be removed only by the FK cascade from its resident or its
    -- save.  A save cascade can reach this row before its resident cascade,
    -- so both parent scopes must be considered.
    if not exists (select 1 from private.world_npc_instances where id=old.instance_id)
      or not exists (select 1 from public.tavern_saves where id=old.save_id) then
      return old;
    end if;
    raise exception using errcode='55000',message='Resident procedural capability sources are immutable';
  end if;
  if tg_op='UPDATE' then raise exception using errcode='55000',message='Resident procedural capability sources are immutable'; end if;
  if not exists(select 1 from private.world_npc_instances i where i.id=new.instance_id and i.save_id=new.save_id and i.npc_id=new.npc_id and i.version_id=new.version_id) then
    raise exception using errcode='23514',message='Procedural capability source must match its resident instance';
  end if;
  if not exists(select 1 from private.world_pilot_resident_procedural_definitions d where d.npc_id=new.npc_id and d.version_id=new.version_id and d.definition_version=new.definition_version and d.registry_version=new.registry_version and d.capability_envelope=new.capability_envelope) then
    raise exception using errcode='23514',message='Procedural capability source must copy an immutable pilot definition';
  end if;
  return new;
end $$;
create trigger world_resident_procedural_capability_source_immutable
before insert or update or delete on private.world_resident_procedural_capability_sources
for each row execute function private.world_resident_procedural_capability_source_guard();

create function private.world_install_pilot_procedural_capability_source(p_instance_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.world_resident_procedural_capability_sources(instance_id,save_id,npc_id,version_id,definition_version,registry_version,capability_envelope)
  select i.id,i.save_id,i.npc_id,i.version_id,d.definition_version,d.registry_version,d.capability_envelope
  from private.world_npc_instances i
  join private.world_pilot_resident_procedural_definitions d on d.npc_id=i.npc_id and d.version_id=i.version_id
  where i.id=p_instance_id
  on conflict(instance_id) do nothing;
end $$;

create function private.world_resident_procedural_capability_source_backfill()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.world_install_pilot_procedural_capability_source(new.id);
  return new;
end $$;
create trigger world_resident_procedural_capability_source_on_instance
  after insert on private.world_npc_instances
  for each row execute function private.world_resident_procedural_capability_source_backfill();

-- The one-time prototype baseline installs a distinct immutable source alongside
-- each historical evolution pin; it neither updates nor deletes those pins.
insert into private.world_resident_procedural_capability_sources(instance_id,save_id,npc_id,version_id,definition_version,registry_version,capability_envelope)
select i.id,i.save_id,i.npc_id,i.version_id,d.definition_version,d.registry_version,d.capability_envelope
from private.world_npc_instances i
join private.world_pilot_resident_procedural_definitions d on d.npc_id=i.npc_id and d.version_id=i.version_id
on conflict(instance_id) do nothing;

create function private.world_procedural_resident_capability(p_save_id uuid,p_instance_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(source.capability_envelope,pin.capability)
  from private.world_npc_instances instance
  join private.world_resident_evolution_pins pin on pin.instance_id=instance.id and pin.save_id=instance.save_id
  left join private.world_resident_procedural_capability_sources source on source.instance_id=instance.id and source.save_id=instance.save_id
  where instance.id=p_instance_id and instance.save_id=p_save_id and instance.status='active'
$$;

create or replace function private.world_procedural_world_context(p_save_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with entity_candidates as (
    select i.id::text as reference, 'npc'::text as entity_kind from private.world_npc_instances i where i.save_id=p_save_id and i.status='active'
    union all
    select e.id::text,e.entity_kind from private.world_canonical_entities e where e.save_id=p_save_id and e.lifecycle in ('discovered','active')
  ), active_quests as (
    select q.instance_id::text as resident_id,jsonb_build_object('id',q.id,'primitiveKey',q.primitive_key) as quest
    from private.world_procedural_quests q where q.save_id=p_save_id and q.state='active'
  ), resident_capabilities as (
    select i.id::text as resident_id, private.world_procedural_resident_capability(i.save_id,i.id) as capability
    from private.world_npc_instances i where i.save_id=p_save_id and i.status='active'
  )
  select jsonb_build_object(
    'version','procedural-world-v1',
    'entityKinds',coalesce((select jsonb_object_agg(reference,entity_kind order by reference) from entity_candidates),'{}'::jsonb),
    'activeGeneratedEntityCount',(select count(*) from private.world_canonical_entities e where e.save_id=p_save_id and e.origin='procedural' and e.lifecycle='active'),
    'activeQuestByResident',coalesce((select jsonb_object_agg(resident_id,quest order by resident_id) from active_quests),'{}'::jsonb),
    'capabilities',coalesce((select jsonb_object_agg(resident_id,capability order by resident_id) from resident_capabilities),'{}'::jsonb)
  )
$$;
revoke all on table private.world_pilot_resident_procedural_definitions,private.world_resident_procedural_capability_sources from public,anon,authenticated,service_role;
revoke all on function private.world_pilot_resident_procedural_definition_guard(),private.world_resident_procedural_capability_source_guard(),private.world_install_pilot_procedural_capability_source(uuid),private.world_resident_procedural_capability_source_backfill(),private.world_procedural_resident_capability(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.world_procedural_resident_capability(uuid,uuid) to service_role;
commit;
