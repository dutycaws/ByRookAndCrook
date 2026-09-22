-- Issue #30 later package operations. Package primitives live in 202609135000.
begin;

create function private.world_resident_requires_package() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if not exists(select 1 from private.npc_version_resident_packages p where p.npc_id=new.npc_id and p.version_id=new.version_id and ((p.source_kind in ('first_party','community') and p.save_id is null) or (p.source_kind='promoted' and p.save_id=new.save_id))) then
    raise exception using errcode='23514',message='Residents must be materialized from an exact immutable package';
  end if;
  return new;
end $function$;
create trigger world_resident_requires_package before insert on private.world_npc_instances for each row execute function private.world_resident_requires_package();

create function private.world_materialize_resident_from_version(p_save_id uuid,p_npc_id uuid,p_version_id uuid,p_arrived_day integer)
returns table(instance_id uuid,version_id uuid,package_id uuid,package_hash text) language plpgsql security definer set search_path='' as $function$
declare package_row private.npc_version_resident_packages; version_row private.npc_versions; existing private.world_npc_instances;
begin
  select p.* into package_row from private.npc_version_resident_packages p where p.npc_id=p_npc_id and p.version_id=p_version_id and ((p.source_kind in ('first_party','community') and p.save_id is null) or (p.source_kind='promoted' and p.save_id=p_save_id));
  if not found then return; end if;
  perform 1 from public.tavern_saves where id=p_save_id for update;
  select v.* into version_row from private.npc_versions v where v.id=p_version_id and v.npc_id=p_npc_id;
  if not found or p_arrived_day<0 then return; end if;
  select resident.* into existing from private.world_npc_instances resident where resident.save_id=p_save_id and resident.npc_id=p_npc_id for update;
  if found then
    select pin.instance_id,pin.version_id,pin.package_id,pin.package_hash into instance_id,version_id,package_id,package_hash from private.world_resident_package_pins pin where pin.instance_id=existing.id;
    if found then return next; return; end if;
    raise sqlstate 'PT409' using message='Existing resident lacks an immutable package pin';
  end if;
  insert into private.world_npc_instances(save_id,npc_id,version_id,arrived_day) values(p_save_id,p_npc_id,p_version_id,p_arrived_day) returning id into instance_id;
  insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,pressure,profile_schema_version,capability_source_version,appearance_source_version,public_disposition)
  values(instance_id,p_save_id,p_npc_id,p_version_id,version_row.sheet,package_row.initial_profile,
    coalesce((select jsonb_object_agg(d->>'key',0) from jsonb_array_elements(package_row.personality_schema->'dimensions') d),'{}'::jsonb),
    coalesce(package_row.personality_schema->>'version','resident-package-v1'),'resident-package-v1',coalesce(package_row.appearance_spec->>'version','npc-sheet-v2'),
    jsonb_build_object('name',version_row.sheet#>>'{identity,name}','title',version_row.sheet#>>'{identity,title}'));
  insert into private.world_resident_package_pins(instance_id,save_id,npc_id,version_id,package_id,package_hash) values(instance_id,p_save_id,p_npc_id,p_version_id,package_row.id,package_row.package_hash);
  version_id:=p_version_id; package_id:=package_row.id; package_hash:=package_row.package_hash;
  return next;
end $function$;

create function private.npc_install_first_party_release(p_npc_id uuid,p_identity_key text,p_roster_order integer,p_version_id uuid,p_release_key text,p_version_number integer,p_active boolean,p_sheet jsonb,p_option_ids text[])
returns uuid language plpgsql security definer set search_path='' as $function$
declare sheet_hash text; envelope jsonb; definition_hash text; options_hash text; package_hash_value text; schema jsonb; profile jsonb; appearance jsonb; derived jsonb; terminal_outcomes text[];
begin
  if p_identity_key !~ '^[a-z][a-z0-9_-]{1,79}$' or p_release_key !~ '^[a-z][a-z0-9_-]{1,79}$' or p_roster_order<0 or p_version_number<1 or p_sheet->>'schemaVersion'<>'npc-sheet-v2' then raise sqlstate 'PT400' using message='Invalid first-party catalog release'; end if;
  sheet_hash:=encode(extensions.digest(private.npc_canonical_json(p_sheet),'sha256'),'hex');
  envelope:=private.npc_resolve_capability_options('community-capability-options-v1',p_option_ids);
  derived:=private.npc_derive_v2_resident_definition(p_sheet); schema:=derived->'personalitySchema'; profile:=derived->'initialProfile'; appearance:=derived->'appearance';
  select coalesce(array_agg(distinct loss->>'kind' order by loss->>'kind'),'{}'::text[]) into terminal_outcomes from jsonb_array_elements(coalesce(p_sheet#>'{campaign,milestones}','[]'::jsonb)) milestone cross join lateral jsonb_array_elements(case when jsonb_typeof(milestone->'permanentLoss')='object' then jsonb_build_array(milestone->'permanentLoss') else '[]'::jsonb end) loss where loss->>'kind' in ('dead','departed');
  definition_hash:=private.npc_resident_definition_hash(schema,profile,appearance,envelope);
  options_hash:=encode(extensions.digest(private.npc_canonical_json(envelope),'sha256'),'hex');
  package_hash_value:=private.npc_resident_package_hash(p_npc_id,p_version_id,'first_party',null,sheet_hash,definition_hash,schema,profile,appearance,envelope,'community-capability-options-v1',p_option_ids,options_hash,terminal_outcomes);
  insert into private.npc_identities(id,origin,normalized_name,status,rating) values(p_npc_id,'first_party',p_identity_key,'published',coalesce(p_sheet->>'rating','standard')) on conflict(id) do nothing;
  insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,published_at) values(p_version_id,p_npc_id,p_version_number,'npc-sheet-v2',p_sheet,sheet_hash,'published',clock_timestamp()) on conflict(id) do nothing;
  insert into private.npc_version_resident_packages(npc_id,version_id,source_kind,frozen_sheet_hash,definition_hash,personality_schema,initial_profile,appearance_spec,capability_envelope,capability_registry_version,capability_option_ids,resolved_options_hash,terminal_outcomes,package_hash) values(p_npc_id,p_version_id,'first_party',sheet_hash,definition_hash,schema,profile,appearance,envelope,'community-capability-options-v1',p_option_ids,options_hash,terminal_outcomes,package_hash_value) on conflict(version_id) do nothing;
  insert into private.npc_first_party_catalog_releases(npc_id,version_id,release_key) values(p_npc_id,p_version_id,p_release_key) on conflict(version_id) do nothing;
  if p_active then
    update private.npc_identities set current_published_version_id=p_version_id,status='published' where id=p_npc_id;
    insert into private.npc_first_party_catalog_identities(npc_id,identity_key,starting_roster_order,active_release_key,active_version_id) values(p_npc_id,p_identity_key,p_roster_order,p_release_key,p_version_id) on conflict(npc_id) do update set identity_key=excluded.identity_key,starting_roster_order=excluded.starting_roster_order,active_release_key=excluded.active_release_key,active_version_id=excluded.active_version_id,updated_at=clock_timestamp();
  end if;
  return p_version_id;
end $function$;

alter table private.world_npc_tombstones drop constraint if exists world_npc_tombstones_reason_check;
alter table private.world_npc_tombstones add constraint world_npc_tombstones_reason_check check(reason in ('dismissed','mature_purged','quarantined','banned','retired','dead','departed'));
create table private.world_resident_terminal_candidates (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  proposer_instance_id uuid not null references private.world_npc_instances(id) on delete cascade, package_id uuid not null references private.npc_version_resident_packages(id) on delete restrict,
  outcome text not null check(outcome in ('dead','departed')), campaign_template_key text not null check(campaign_template_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  critic_approved boolean not null default false, warned_day integer, created_at timestamptz not null default clock_timestamp(), resolved_at timestamptz,
  unique(save_id,proposer_instance_id,outcome)
);
create function private.world_resident_terminal_candidate_guard() returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='UPDATE' and (new.save_id<>old.save_id or new.proposer_instance_id<>old.proposer_instance_id or new.package_id<>old.package_id or new.outcome<>old.outcome or new.campaign_template_key<>old.campaign_template_key) then raise exception using errcode='55000',message='Terminal candidate identity is immutable'; end if;
  if not exists(select 1 from private.world_npc_instances i join private.world_resident_package_pins pin on pin.instance_id=i.id join private.npc_version_resident_packages p on p.id=pin.package_id join private.npc_versions v on v.id=i.version_id where i.id=new.proposer_instance_id and i.save_id=new.save_id and p.id=new.package_id and new.outcome=any(p.terminal_outcomes) and exists(select 1 from jsonb_array_elements(coalesce(v.sheet#>'{campaign,milestones}','[]'::jsonb)) milestone where milestone->>'id'=new.campaign_template_key and milestone#>>'{permanentLoss,kind}'=new.outcome)) then raise exception using errcode='23514',message='Terminal candidate requires an exact self package outcome'; end if;
  return new;
end $function$;
create trigger world_resident_terminal_candidate_guard before insert or update on private.world_resident_terminal_candidates for each row execute function private.world_resident_terminal_candidate_guard();

create function private.world_retire_self(p_candidate_id uuid) returns jsonb language plpgsql security definer set search_path='' as $function$
declare candidate private.world_resident_terminal_candidates; current_day integer; instance private.world_npc_instances;
begin
  perform private.world_settlement_assert_service();
  select * into candidate from private.world_resident_terminal_candidates where id=p_candidate_id for update;
  if not found then raise sqlstate 'PT404' using message='Terminal candidate not found'; end if;
  if candidate.resolved_at is not null then return jsonb_build_object('status','replayed','outcome',candidate.outcome); end if;
  select save.current_day into current_day from public.tavern_saves save where save.id=candidate.save_id for update;
  select * into instance from private.world_npc_instances where id=candidate.proposer_instance_id and save_id=candidate.save_id for update;
  if not candidate.critic_approved or candidate.warned_day is null or current_day<candidate.warned_day+1 then raise sqlstate 'PT409' using message='Terminal self outcome requires critic approval and one full warned day'; end if;
  update private.world_npc_instances set status=candidate.outcome where id=instance.id and save_id=candidate.save_id;
  insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason) values(candidate.save_id,instance.npc_id,instance.version_id,candidate.outcome) on conflict do nothing;
  update private.world_resident_terminal_candidates set resolved_at=clock_timestamp() where id=candidate.id;
  return jsonb_build_object('status','retired','outcome',candidate.outcome,'instanceId',instance.id);
end $function$;

revoke all on table private.world_resident_terminal_candidates from public,anon,authenticated,service_role;
revoke all on function private.world_materialize_resident_from_version(uuid,uuid,uuid,integer),private.npc_install_first_party_release(uuid,text,integer,uuid,text,integer,boolean,jsonb,text[]),private.world_retire_self(uuid) from public,anon,authenticated,service_role;
grant execute on function private.world_materialize_resident_from_version(uuid,uuid,uuid,integer),private.npc_install_first_party_release(uuid,text,integer,uuid,text,integer,boolean,jsonb,text[]),private.world_retire_self(uuid) to service_role;

commit;
