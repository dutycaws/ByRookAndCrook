-- Issue #30 package primitives deliberately live before the evolving-world
-- migration chain. They depend only on the UUID NPC platform introduced in
-- 030 and are the sole definition source for later world materializers.
begin;

alter table private.npc_versions
  add constraint npc_versions_id_npc_id_key unique (id, npc_id);

-- This duplicate of no world helper is intentional: package hashes must be
-- available before the evolving-world migrations introduce their own JSON
-- canonicalizer.
create function private.npc_canonical_json(p_value jsonb)
returns text language plpgsql immutable strict set search_path='' as $function$
declare item jsonb; key text; rendered text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      rendered := '{';
      for key, item in select object_item.key, object_item.value from jsonb_each(p_value) object_item order by object_item.key collate "C" loop
        rendered := rendered || case when rendered='{' then '' else ',' end || to_jsonb(key)::text || ':' || private.npc_canonical_json(item);
      end loop;
      return rendered || '}';
    when 'array' then
      rendered := '[';
      for item in select value from jsonb_array_elements(p_value) loop
        rendered := rendered || case when rendered='[' then '' else ',' end || private.npc_canonical_json(item);
      end loop;
      return rendered || ']';
    else return p_value::text;
  end case;
end $function$;

create table private.npc_capability_option_registry (
  registry_version text not null check (registry_version = 'community-capability-options-v1'),
  option_id text not null check (option_id ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  option_kind text not null check (option_kind in ('quest_action','quest_approach','world_effect','social_capability')),
  option_value text not null check (option_value ~ '^[a-z][a-z0-9_]{1,79}$'),
  target_kinds text[] not null default '{}',
  primary key (registry_version, option_id),
  unique (registry_version, option_kind, option_value),
  check (target_kinds <@ array['npc','location','faction','item','recipe','world_event']::text[])
);

insert into private.npc_capability_option_registry(registry_version,option_id,option_kind,option_value,target_kinds) values
  ('community-capability-options-v1','quest.action.prepare','quest_action','prepare','{}'),
  ('community-capability-options-v1','quest.action.wait','quest_action','wait','{}'),
  ('community-capability-options-v1','quest.action.attempt','quest_action','attempt','{}'),
  ('community-capability-options-v1','quest.action.abandon','quest_action','abandon','{}'),
  ('community-capability-options-v1','quest.approach.scouting','quest_approach','scouting','{}'),
  ('community-capability-options-v1','quest.approach.combat','quest_approach','combat','{}'),
  ('community-capability-options-v1','quest.approach.diplomacy','quest_approach','diplomacy','{}'),
  ('community-capability-options-v1','quest.approach.trade','quest_approach','trade','{}'),
  ('community-capability-options-v1','effect.adjust_relationship','world_effect','adjust_relationship',array['npc']),
  ('community-capability-options-v1','effect.create_quest','world_effect','create_quest',array['npc','location','faction','item','recipe','world_event']),
  ('community-capability-options-v1','effect.update_quest','world_effect','update_quest',array['npc','location','faction','item','recipe','world_event']),
  ('community-capability-options-v1','effect.create_entity','world_effect','create_entity',array['npc','location','faction','item','recipe','world_event']),
  ('community-capability-options-v1','effect.record_world_event','world_effect','record_world_event',array['npc','location','faction','item','recipe','world_event']),
  ('community-capability-options-v1','effect.apply_location_modifier','world_effect','apply_location_modifier',array['location']),
  ('community-capability-options-v1','effect.transfer_inventory','world_effect','transfer_inventory',array['item']),
  ('community-capability-options-v1','effect.unlock_recipe','world_effect','unlock_recipe',array['recipe']),
  ('community-capability-options-v1','effect.set_availability','world_effect','set_availability',array['npc']),
  ('community-capability-options-v1','social.conceal','social_capability','conceal','{}'),
  ('community-capability-options-v1','social.misdirect','social_capability','misdirect','{}'),
  ('community-capability-options-v1','social.deceive','social_capability','deceive','{}'),
  ('community-capability-options-v1','social.share_gossip','social_capability','share_gossip','{}');

create function private.npc_resolve_capability_options(p_registry_version text,p_option_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_ids text[]:=array(select distinct unnest(coalesce(p_option_ids,'{}'::text[])) order by 1); v_count integer; v_targets text[];
begin
  if p_registry_version<>'community-capability-options-v1' or cardinality(v_ids) is null or cardinality(v_ids)<>cardinality(coalesce(p_option_ids,'{}'::text[])) then
    raise sqlstate 'PT400' using message='Capability options must be unique current registry options';
  end if;
  select count(*) into v_count from private.npc_capability_option_registry where registry_version=p_registry_version and option_id=any(v_ids);
  if v_count<>cardinality(v_ids) then raise sqlstate 'PT400' using message='Unknown or unavailable capability option'; end if;
  select coalesce(array_agg(distinct target order by target),'{}') into v_targets from private.npc_capability_option_registry r cross join lateral unnest(r.target_kinds) target where r.registry_version=p_registry_version and r.option_id=any(v_ids);
  return jsonb_build_object(
    'version',p_registry_version,
    'allowedActions',coalesce((select jsonb_agg(option_value order by option_value) from private.npc_capability_option_registry where registry_version=p_registry_version and option_id=any(v_ids) and option_kind='quest_action'),'[]'::jsonb),
    'allowedApproaches',coalesce((select jsonb_agg(option_value order by option_value) from private.npc_capability_option_registry where registry_version=p_registry_version and option_id=any(v_ids) and option_kind='quest_approach'),'[]'::jsonb),
    'allowedWorldEffects',coalesce((select jsonb_agg(option_value order by option_value) from private.npc_capability_option_registry where registry_version=p_registry_version and option_id=any(v_ids) and option_kind='world_effect'),'[]'::jsonb),
    'allowedTargetKinds',to_jsonb(coalesce(v_targets,'{}'::text[])),
    'socialCapabilities',coalesce((select jsonb_agg(option_value order by option_value) from private.npc_capability_option_registry where registry_version=p_registry_version and option_id=any(v_ids) and option_kind='social_capability'),'[]'::jsonb),
    'irreversibleEffects','[]'::jsonb
  );
end $function$;

create function private.npc_resident_definition_hash(p_schema jsonb,p_profile jsonb,p_appearance jsonb,p_capability jsonb)
returns text language sql immutable set search_path='' as $function$
  select encode(extensions.digest(private.npc_canonical_json(jsonb_build_object('appearance',p_appearance,'capability',p_capability,'profile',p_profile,'schema',p_schema)),'sha256'),'hex')
$function$;

create function private.npc_derive_v2_resident_definition(p_sheet jsonb)
returns jsonb language plpgsql immutable strict set search_path='' as $function$
declare v_dimensions jsonb; v_collections jsonb; v_entries jsonb;
begin
  if p_sheet->>'schemaVersion'<>'npc-sheet-v2' or jsonb_typeof(p_sheet#>'{personality,dimensions}')<>'array' or jsonb_typeof(p_sheet#>'{personality,collections}')<>'array' or jsonb_typeof(p_sheet#>'{personality,initialEntries}')<>'array' or jsonb_typeof(p_sheet->'appearance')<>'object' then
    raise exception using errcode='PT400',message='NPC sheet V2 requires dimensions, collections, initial entries, and appearance';
  end if;
  select jsonb_object_agg(d->>'key',(d->>'initialValue')::integer order by d->>'key') into v_dimensions from jsonb_array_elements(p_sheet#>'{personality,dimensions}') d;
  v_collections:=p_sheet#>'{personality,collections}'; v_entries:=p_sheet#>'{personality,initialEntries}';
  if v_dimensions is null or (select count(*) from jsonb_object_keys(v_dimensions))=0 or jsonb_array_length(v_entries)=0 then raise exception using errcode='PT400',message='NPC sheet V2 resident definition cannot be empty'; end if;
  return jsonb_build_object('personalitySchema',jsonb_build_object('version','personality-schema-v1','dimensions',p_sheet#>'{personality,dimensions}','collections',v_collections),'initialProfile',jsonb_build_object('dimensions',v_dimensions,'entries',v_entries),'appearance',p_sheet->'appearance');
end $function$;

create function private.npc_resident_package_hash(p_npc_id uuid,p_version_id uuid,p_source_kind text,p_save_id uuid,p_sheet_hash text,p_definition_hash text,p_schema jsonb,p_profile jsonb,p_appearance jsonb,p_capability jsonb,p_registry_version text,p_option_ids text[],p_options_hash text,p_terminal_outcomes text[])
returns text language sql immutable set search_path='' as $function$
  select encode(extensions.digest(private.npc_canonical_json(jsonb_build_object(
    'appearance',p_appearance,'capability',p_capability,'capabilityOptionIds',to_jsonb(array(select unnest(coalesce(p_option_ids,'{}'::text[])) order by 1)),
    'definitionHash',p_definition_hash,'npcId',p_npc_id,'optionsHash',p_options_hash,'profile',p_profile,'registryVersion',p_registry_version,
    'saveId',p_save_id,'schema',p_schema,'sheetHash',p_sheet_hash,'sourceKind',p_source_kind,
    'terminalOutcomes',to_jsonb(array(select unnest(coalesce(p_terminal_outcomes,'{}'::text[])) order by 1)),'versionId',p_version_id
  )),'sha256'),'hex')
$function$;

create table private.npc_version_resident_packages (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null, version_id uuid not null unique,
  source_kind text not null check(source_kind in ('first_party','community','promoted')),
  save_id uuid references public.tavern_saves(id) on delete restrict,
  frozen_sheet_hash text not null check(frozen_sheet_hash ~ '^[a-f0-9]{64}$'), definition_hash text not null check(definition_hash ~ '^[a-f0-9]{64}$'),
  personality_schema jsonb not null, initial_profile jsonb not null, appearance_spec jsonb not null, capability_envelope jsonb not null,
  capability_registry_version text not null check(capability_registry_version='community-capability-options-v1'), capability_option_ids text[] not null default '{}',
  resolved_options_hash text not null check(resolved_options_hash ~ '^[a-f0-9]{64}$'), terminal_outcomes text[] not null default '{}' check(terminal_outcomes <@ array['dead','departed']::text[]),
  reviewer_id uuid references auth.users(id) on delete set null, published_by uuid references auth.users(id) on delete set null,
  package_hash text not null unique check(package_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(),
  foreign key(npc_id,version_id) references private.npc_versions(npc_id,id) on delete restrict,
  check((source_kind='promoted')=(save_id is not null)),
  check(jsonb_typeof(personality_schema)='object' and jsonb_typeof(initial_profile)='object' and jsonb_typeof(appearance_spec)='object' and jsonb_typeof(capability_envelope)='object')
);

create table private.npc_first_party_catalog_identities (
  npc_id uuid primary key references private.npc_identities(id) on delete restrict,
  identity_key text not null unique check(identity_key ~ '^[a-z][a-z0-9_-]{1,79}$'), starting_roster_order integer not null check(starting_roster_order>=0),
  active_release_key text not null check(active_release_key ~ '^[a-z][a-z0-9_-]{1,79}$'), active_version_id uuid not null references private.npc_versions(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);
create table private.npc_first_party_catalog_releases (
  npc_id uuid not null references private.npc_identities(id) on delete restrict, version_id uuid not null unique references private.npc_versions(id) on delete restrict,
  release_key text not null check(release_key ~ '^[a-z][a-z0-9_-]{1,79}$'), created_at timestamptz not null default clock_timestamp(),
  primary key(npc_id,release_key), foreign key(npc_id,version_id) references private.npc_versions(npc_id,id) on delete restrict
);

create function private.npc_version_resident_package_guard() returns trigger language plpgsql security definer set search_path='' as $function$
declare v_version private.npc_versions; v_identity private.npc_identities; v_resolved jsonb; v_hash text; v_version_found boolean; v_identity_found boolean;
begin
  if tg_op in ('UPDATE','DELETE') then raise exception using errcode='55000',message='Resident packages are immutable'; end if;
  select * into v_version from private.npc_versions where id=new.version_id and npc_id=new.npc_id; v_version_found:=found;
  select * into v_identity from private.npc_identities where id=new.npc_id; v_identity_found:=found;
  if not v_version_found or not v_identity_found or v_version.sheet_hash<>new.frozen_sheet_hash then raise exception using errcode='23514',message='Resident package must pin its exact NPC version and sheet hash'; end if;
  if (new.source_kind='first_party' and v_identity.origin<>'first_party') or (new.source_kind='community' and v_identity.origin<>'community') or (new.source_kind='promoted' and v_identity.origin<>'procedural') then raise exception using errcode='23514',message='Resident package source must match NPC identity origin'; end if;
  v_resolved:=private.npc_resolve_capability_options(new.capability_registry_version,new.capability_option_ids);
  if v_resolved<>new.capability_envelope or new.resolved_options_hash<>encode(extensions.digest(private.npc_canonical_json(v_resolved),'sha256'),'hex') then raise exception using errcode='23514',message='Resident package capability options must be server-resolved'; end if;
  if new.definition_hash<>private.npc_resident_definition_hash(new.personality_schema,new.initial_profile,new.appearance_spec,new.capability_envelope) then raise exception using errcode='23514',message='Resident package definition hash does not match frozen definition'; end if;
  v_hash:=private.npc_resident_package_hash(new.npc_id,new.version_id,new.source_kind,new.save_id,new.frozen_sheet_hash,new.definition_hash,new.personality_schema,new.initial_profile,new.appearance_spec,new.capability_envelope,new.capability_registry_version,new.capability_option_ids,new.resolved_options_hash,new.terminal_outcomes);
  if new.package_hash<>v_hash then raise exception using errcode='23514',message='Resident package hash does not match authoritative fields'; end if;
  return new;
end $function$;
create trigger npc_version_resident_packages_immutable before insert or update or delete on private.npc_version_resident_packages for each row execute function private.npc_version_resident_package_guard();

create function private.npc_first_party_catalog_release_guard() returns trigger language plpgsql set search_path='' as $function$
begin if tg_op in ('UPDATE','DELETE') then raise exception using errcode='55000',message='First-party catalog releases are immutable'; end if; return new; end $function$;
create trigger npc_first_party_catalog_releases_immutable before insert or update or delete on private.npc_first_party_catalog_releases for each row execute function private.npc_first_party_catalog_release_guard();

create table private.world_resident_package_pins (
  instance_id uuid primary key references private.world_npc_instances(id) on delete cascade, save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid not null, version_id uuid not null, package_id uuid not null references private.npc_version_resident_packages(id) on delete restrict,
  package_hash text not null check(package_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(),
  foreign key(npc_id,version_id) references private.npc_versions(npc_id,id) on delete restrict, unique(save_id,instance_id)
);
create function private.world_resident_package_pin_guard() returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='UPDATE' then raise exception using errcode='55000',message='Resident package pins are immutable'; end if;
  if tg_op='DELETE' then
    -- Direct edits remain forbidden. The only deletion path is the owning
    -- resident's nested foreign-key cascade during an authorised lifecycle
    -- purge. PostgreSQL invokes that cascade beneath the parent delete trigger.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception using errcode='55000',message='Resident package pins are immutable';
  end if;
  if not exists(select 1 from private.world_npc_instances i join private.npc_version_resident_packages p on p.id=new.package_id where i.id=new.instance_id and i.save_id=new.save_id and i.npc_id=new.npc_id and i.version_id=new.version_id and p.npc_id=new.npc_id and p.version_id=new.version_id and p.package_hash=new.package_hash and ((p.source_kind='promoted' and p.save_id=new.save_id) or (p.source_kind in ('first_party','community') and p.save_id is null))) then
    raise exception using errcode='23514',message='Resident package pin must match the save-pinned instance and package scope';
  end if;
  return new;
end $function$;
create trigger world_resident_package_pins_immutable before insert or update or delete on private.world_resident_package_pins for each row execute function private.world_resident_package_pin_guard();

revoke all on table private.npc_capability_option_registry,private.npc_version_resident_packages,private.npc_first_party_catalog_identities,private.npc_first_party_catalog_releases,private.world_resident_package_pins from public,anon,authenticated,service_role;
revoke all on function private.npc_resolve_capability_options(text,text[]),private.npc_resident_definition_hash(jsonb,jsonb,jsonb,jsonb),private.npc_resident_package_hash(uuid,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,jsonb,text,text[],text,text[]) from public,anon,authenticated,service_role;
grant execute on function private.npc_resolve_capability_options(text,text[]) to service_role;

commit;
