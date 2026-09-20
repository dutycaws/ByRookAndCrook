-- Issue #30 runtime hard cutover. Every new resident comes from an immutable
-- V2 package. This migration promotes canonical NPC entities directly into a
-- V2 sheet; it contains no V1 conversion or compatibility materializer.
begin;

-- Generated deep residents are package-backed identities without an author.
-- The original community platform only admitted authored and first-party rows.
alter table private.npc_identities drop constraint npc_identities_origin_check;
alter table private.npc_identities drop constraint npc_identities_check;
alter table private.npc_identities
  add constraint npc_identities_origin_check check (origin in ('first_party','community','procedural')),
  add constraint npc_identities_creator_check check (
    (origin = 'community' and creator_id is not null)
    or (origin in ('first_party','procedural') and creator_id is null)
  );

-- The package-backed arrival path shares the tavern's current resident limit.
create or replace function private.world_capacity(p_save uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select greatest(2, save_row.community_npc_level + 1)
  from public.tavern_saves save_row
  where save_row.id = p_save
$function$;

revoke all on function private.world_capacity(uuid) from public, anon, authenticated;
grant execute on function private.world_capacity(uuid) to service_role;

create table private.world_promoted_npc_package_receipts (
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  package_id uuid not null references private.npc_version_resident_packages(id) on delete restrict,
  instance_id uuid not null references private.world_npc_instances(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (canonical_entity_id, save_id),
  unique (save_id, npc_id),
  check (jsonb_typeof(result) = 'object')
);
create trigger world_promoted_npc_package_receipts_immutable
before update or delete on private.world_promoted_npc_package_receipts
for each row execute function private.world_history_append_only();

-- This adaptation owns only the authored fields of a generated canonical NPC.
-- It has no capability input: the fixed server allowlist below is resolved by
-- the package guard before the resident can be materialized.
create function private.world_promoted_npc_sheet_v2(p_entity private.world_canonical_entities)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare p jsonb := p_entity.payload->'payload'; v_identity jsonb; v_appearance jsonb; v_skills jsonb; v_name text;
begin
  if jsonb_typeof(p->'identity') <> 'object' then
    raise sqlstate 'PT422' using message='Canonical NPC lacks a promotable identity';
  end if;
  v_identity := p->'identity';
  v_name := coalesce(v_identity->>'name',p_entity.entity_key);
  v_appearance := coalesce(p->'appearance','{}'::jsonb);
  v_skills := case p#>>'{capabilities,archetypeKey}'
    when 'ranger' then '{"scouting":4,"combat":3,"diplomacy":2,"trade":1}'::jsonb
    when 'merchant' then '{"scouting":1,"combat":1,"diplomacy":4,"trade":4}'::jsonb
    when 'scout' then '{"scouting":4,"combat":2,"diplomacy":3,"trade":1}'::jsonb
    else '{"scouting":2,"combat":2,"diplomacy":3,"trade":2}'::jsonb end;
  return jsonb_build_object(
    'schemaVersion','npc-sheet-v2',
    'rating','standard',
    'identity',v_identity,
    'appearance',jsonb_build_object(
      'physicalAppearance',coalesce(v_appearance->>'physicalAppearance','A capable traveler shaped by a changing world.'),
      'silhouette',coalesce(v_appearance->>'attire','A practical cloak and well-used gear suited for the road.'),
      'palette',jsonb_build_array('tavern-amber','forest-green'),
      'attire',coalesce(v_appearance->>'attire','A practical cloak and well-used gear suited for the road.'),
      'notableFeatures',coalesce(v_appearance->>'notableFeatures','A small token from the road they chose to leave behind.'),
      'mood',coalesce(v_appearance->>'mood','Patient and attentive while learning who can be trusted.')
    ),
    'personality',jsonb_build_object(
      'dimensions',jsonb_build_array(
        jsonb_build_object('key','resolve','label','Resolve','negativeAnchor','yielding','positiveAnchor','steadfast','initialValue',50,'volatility',1,'ordinaryChangeThreshold',25,'definingRuptureThreshold',100),
        jsonb_build_object('key','empathy','label','Empathy','negativeAnchor','detached','positiveAnchor','compassionate','initialValue',50,'volatility',1,'ordinaryChangeThreshold',25,'definingRuptureThreshold',100),
        jsonb_build_object('key','openness','label','Openness','negativeAnchor','guarded','positiveAnchor','open','initialValue',50,'volatility',1,'ordinaryChangeThreshold',25,'definingRuptureThreshold',100)
      ),
      'collections',jsonb_build_array(
        jsonb_build_object('kind','value','maximumEntries',6),jsonb_build_object('kind','boundary','maximumEntries',6),
        jsonb_build_object('kind','preference','maximumEntries',6),jsonb_build_object('kind','aversion','maximumEntries',6),
        jsonb_build_object('kind','voice_trait','maximumEntries',2)
      ),
      'initialEntries',jsonb_build_array(
        jsonb_build_object('id','value_community','kind','value','text','Protect the people who offered a place at the tavern.','core',true,'active',true),
        jsonb_build_object('id','boundary_companions','kind','boundary','text','Will not abandon a companion in danger.','core',true,'active',true),
        jsonb_build_object('id','preference_preparation','kind','preference','text','Prefers careful preparation and useful plans.','core',false,'active',true),
        jsonb_build_object('id','aversion_recklessness','kind','aversion','text','Rejects reckless promises and needless danger.','core',true,'active',true),
        jsonb_build_object('id','voice_plain','kind','voice_trait','text',coalesce(v_identity->>'voice','Speaks plainly about what can be seen and done.'),'core',true,'active',true)
      )
    ),
    'lore',jsonb_build_object('entities','[]'::jsonb,'npcReferences','[]'::jsonb,'relationships','[]'::jsonb,'facts','[]'::jsonb),
    'skills',v_skills,
    'campaign',jsonb_build_object('durableGoal','Build a dependable place in the evolving world around the tavern.',
      'milestones',jsonb_build_array(jsonb_build_object(
        'id','settle-in','title','Settle in','outcome','Learn where help is needed and become a dependable tavern regular.',
        'motivation','A clear first commitment gives this newcomer a place in the community.','constraints',jsonb_build_array('avoid reckless promises'),
        'allowedTargets',jsonb_build_array(p_entity.entity_key),'difficulty',2,
        'successNews',v_name||' has begun to make a place in the tavern community.',
        'nonSuccessNews',v_name||' is still finding their footing around the tavern.',
        'retiredTargets','[]'::jsonb,'permanentLoss',null,
        'startingPlan',jsonb_build_array(jsonb_build_object('action','prepare','approach','diplomacy'),jsonb_build_object('action','attempt','approach','diplomacy'))
      )))
  );
end $f$;

create or replace function private.seed_world_npcs(p_save uuid)
returns void language plpgsql security definer set search_path='' as $f$
declare v_day integer; row record;
begin
  select current_day into v_day from public.tavern_saves where id=p_save for update;
  if not found then raise sqlstate 'PT404' using message='Tavern save not found'; end if;
  for row in
    select c.npc_id,c.active_version_id
    from private.npc_first_party_catalog_identities c
    join private.npc_version_resident_packages p on p.npc_id=c.npc_id and p.version_id=c.active_version_id
      and p.source_kind='first_party' and p.save_id is null
    order by c.starting_roster_order,c.identity_key
  loop
    perform private.world_materialize_resident_from_version(p_save,row.npc_id,row.active_version_id,v_day);
  end loop;
end $f$;

create or replace function private.maybe_arrive_world_npc(p_save uuid,p_day integer,p_action uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_count integer; v_draw integer; v_selected_npc uuid; v_selected_version uuid; v_rating boolean; v_capacity integer; v_result jsonb; v_materialized record;
begin
  if exists(select 1 from private.world_npc_arrival_receipts where save_id=p_save and day=p_day) then
    return (select result from private.world_npc_arrival_receipts where save_id=p_save and day=p_day);
  end if;
  select count(*) into v_capacity from private.world_npc_instances where save_id=p_save and status in ('active','between','settled','failed','abandoned');
  if v_capacity >= private.world_capacity(p_save) then
    v_result:=jsonb_build_object('arrived',false,'reason','capacity');
    insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,result) values(p_save,p_day,p_action,0,v_result);
    return v_result;
  end if;
  select mature_content_enabled and adult_attested_at is not null into v_rating
  from public.player_profiles profile join public.tavern_saves save on save.user_id=profile.user_id where save.id=p_save;
  with eligible as (
    select i.id,i.current_published_version_id
    from private.npc_identities i
    join private.npc_version_resident_packages p on p.npc_id=i.id and p.version_id=i.current_published_version_id
      and p.source_kind='community' and p.save_id is null
    where i.origin='community' and i.status='published'
      and (i.rating='standard' or coalesce(v_rating,false))
      and not exists(select 1 from private.world_npc_instances w where w.save_id=p_save and w.npc_id=i.id)
      and not exists(select 1 from private.world_npc_tombstones t where t.save_id=p_save and t.npc_id=i.id)
  ) select count(*) into v_count from eligible;
  if v_count > 0 then
    v_draw:=floor(random()*v_count)::integer;
    with eligible as (
      select i.id,i.current_published_version_id,row_number() over(order by i.id)-1 as rn
      from private.npc_identities i
      join private.npc_version_resident_packages p on p.npc_id=i.id and p.version_id=i.current_published_version_id
        and p.source_kind='community' and p.save_id is null
      where i.origin='community' and i.status='published'
        and (i.rating='standard' or coalesce(v_rating,false))
        and not exists(select 1 from private.world_npc_instances w where w.save_id=p_save and w.npc_id=i.id)
        and not exists(select 1 from private.world_npc_tombstones t where t.save_id=p_save and t.npc_id=i.id)
    ) select id,current_published_version_id into strict v_selected_npc,v_selected_version from eligible where rn=v_draw;
    select * into v_materialized from private.world_materialize_resident_from_version(p_save,v_selected_npc,v_selected_version,p_day);
    if not found then raise sqlstate 'PT409' using message='Selected community NPC lacks its current immutable package'; end if;
    v_result:=jsonb_build_object('arrived',true,'npcId',v_selected_npc,'versionId',v_selected_version);
  else
    v_result:=jsonb_build_object('arrived',false,'reason','no_eligible');
  end if;
  insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,draw,selected_npc_id,selected_version_id,result)
    values(p_save,p_day,p_action,v_count,v_draw,v_selected_npc,v_selected_version,v_result);
  return v_result;
end $f$;

-- Package pins are the only authority for runtime personality schema and
-- allowed actions.  No profile can be refreshed by an identity pointer.
create or replace function private.world_frozen_resident_evolution_base(p_instance_id uuid)
returns jsonb language plpgsql stable strict security definer set search_path='' as $f$
declare profile private.world_resident_profiles; package private.npc_version_resident_packages;
begin
  select p.* into profile from private.world_resident_profiles p where p.instance_id=p_instance_id;
  select package_row.* into package
  from private.world_resident_package_pins pin
  join private.npc_version_resident_packages package_row on package_row.id=pin.package_id
  where pin.instance_id=p_instance_id and pin.save_id=profile.save_id and package_row.package_hash=pin.package_hash;
  if not found then return null; end if;
  return jsonb_build_object('residentId',profile.instance_id,'npcId',profile.npc_id,
    'profileRevision',profile.profile_revision,'profile',profile.current_profile,
    'pressureByDimension',profile.pressure,'schema',package.personality_schema,'capability',package.capability_envelope);
end $f$;

create or replace function private.world_procedural_resident_capability(p_save_id uuid,p_instance_id uuid)
returns jsonb language sql stable security definer set search_path='' as $f$
  select package.capability_envelope
  from private.world_npc_instances instance
  join private.world_resident_package_pins pin on pin.instance_id=instance.id and pin.save_id=instance.save_id
  join private.npc_version_resident_packages package on package.id=pin.package_id and package.package_hash=pin.package_hash
  where instance.id=p_instance_id and instance.save_id=p_save_id and instance.status='active'
$f$;

create or replace function private.world_procedural_world_context(p_save_id uuid)
returns jsonb language sql stable security definer set search_path='' as $f$
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
  ) select jsonb_build_object(
    'version','procedural-world-v1',
    'entityKinds',coalesce((select jsonb_object_agg(reference,entity_kind order by reference) from entity_candidates),'{}'::jsonb),
    'activeGeneratedEntityCount',(select count(*) from private.world_canonical_entities e where e.save_id=p_save_id and e.origin='procedural' and e.lifecycle='active'),
    'activeQuestByResident',coalesce((select jsonb_object_agg(resident_id,quest order by resident_id) from active_quests),'{}'::jsonb),
    'capabilities',coalesce((select jsonb_object_agg(resident_id,capability order by resident_id) from resident_capabilities),'{}'::jsonb)
  )
$f$;

create or replace function private.world_promote_canonical_npc(p_save_id uuid,p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare entity private.world_canonical_entities; lifecycle private.world_generated_entity_lifecycle; prior private.world_promoted_npc_package_receipts;
  identity_id uuid:=extensions.gen_random_uuid(); version_id uuid:=extensions.gen_random_uuid(); sheet jsonb; derived jsonb; envelope jsonb;
  definition_hash text; options_hash text; sheet_hash text; package_hash text; package_id uuid; materialized record; normalized text; v_day integer;
  option_ids text[]:=array['quest.action.prepare','quest.action.wait','quest.action.attempt','quest.action.abandon','quest.approach.scouting','quest.approach.combat','quest.approach.diplomacy','quest.approach.trade','effect.adjust_relationship','effect.create_quest','effect.update_quest','effect.create_entity','effect.record_world_event','social.conceal','social.misdirect','social.deceive','social.share_gossip'];
begin
  perform private.world_settlement_assert_service();
  select * into prior from private.world_promoted_npc_package_receipts where canonical_entity_id=p_entity_id and save_id=p_save_id;
  if found then return prior.result || jsonb_build_object('replayed',true); end if;
  select * into entity from private.world_canonical_entities where id=p_entity_id and save_id=p_save_id for update;
  -- A concurrent materializer may have completed while this caller waited on
  -- the canonical entity lock. Re-read the durable receipt before any writes.
  select * into prior from private.world_promoted_npc_package_receipts where canonical_entity_id=p_entity_id and save_id=p_save_id;
  if found then return prior.result || jsonb_build_object('replayed',true); end if;
  select * into lifecycle from private.world_generated_entity_lifecycle where entity_id=p_entity_id and save_id=p_save_id for update;
  if not found or entity.entity_kind<>'npc' or entity.origin<>'procedural' or entity.lifecycle<>'active'
    or lifecycle.entity_role<>'deep_npc' then
    raise sqlstate 'PT409' using message='Only an active promoted deep canonical NPC can enter the resident runtime';
  end if;
  sheet:=private.world_promoted_npc_sheet_v2(entity);
  sheet_hash:=encode(extensions.digest(private.npc_canonical_json(sheet),'sha256'),'hex');
  derived:=private.npc_derive_v2_resident_definition(sheet);
  envelope:=private.npc_resolve_capability_options('community-capability-options-v1',option_ids);
  definition_hash:=private.npc_resident_definition_hash(derived->'personalitySchema',derived->'initialProfile',derived->'appearance',envelope);
  options_hash:=encode(extensions.digest(private.npc_canonical_json(envelope),'sha256'),'hex');
  package_hash:=private.npc_resident_package_hash(identity_id,version_id,'promoted',p_save_id,sheet_hash,definition_hash,derived->'personalitySchema',derived->'initialProfile',derived->'appearance',envelope,'community-capability-options-v1',option_ids,options_hash,'{}'::text[]);
  normalized:='generated-'||entity.entity_key||'-'||replace(left(entity.id::text,8),'-','');
  insert into private.npc_identities(id,origin,normalized_name,status,rating) values(identity_id,'procedural',normalized,'published','standard');
  insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,published_at)
    values(version_id,identity_id,1,'npc-sheet-v2',sheet,sheet_hash,'published',clock_timestamp());
  insert into private.npc_version_resident_packages(npc_id,version_id,source_kind,save_id,frozen_sheet_hash,definition_hash,personality_schema,initial_profile,appearance_spec,capability_envelope,capability_registry_version,capability_option_ids,resolved_options_hash,terminal_outcomes,package_hash)
    values(identity_id,version_id,'promoted',p_save_id,sheet_hash,definition_hash,derived->'personalitySchema',derived->'initialProfile',derived->'appearance',envelope,'community-capability-options-v1',option_ids,options_hash,'{}'::text[],package_hash)
    returning id into package_id;
  select current_day into v_day from public.tavern_saves where id=p_save_id;
  select * into materialized from private.world_materialize_resident_from_version(p_save_id,identity_id,version_id,v_day);
  if not found then raise sqlstate 'PT409' using message='Promoted NPC package did not materialize'; end if;
  insert into private.world_promoted_npc_package_receipts(canonical_entity_id,save_id,npc_id,version_id,package_id,instance_id,result)
    values(p_entity_id,p_save_id,identity_id,version_id,package_id,materialized.instance_id,
      jsonb_build_object('status','promoted','replayed',false,'entityId',p_entity_id,'npcId',identity_id,'versionId',version_id,'instanceId',materialized.instance_id));
  return (select result from private.world_promoted_npc_package_receipts where canonical_entity_id=p_entity_id and save_id=p_save_id);
end $f$;

-- A committed procedural command is immutable before this service-only step
-- runs. Read only the exact command receipt, materialize its deep NPCs through
-- V2 packages, and let the package receipt make retries an exact replay.
create function public.world_materialize_procedural_npc_packages(
  p_settlement_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settlement private.world_settlements;
  receipt private.world_procedural_command_receipts;
  operation jsonb;
  v_entity_id uuid;
  promotion jsonb;
  materialized_count integer := 0;
begin
  perform private.world_settlement_assert_service();
  select * into settlement
  from private.world_settlements
  where id = p_settlement_id
  for share;
  if not found then raise sqlstate 'PT404' using message = 'Settlement not found'; end if;

  select * into receipt
  from private.world_procedural_command_receipts
  where job_id = p_job_id
  for share;
  if not found or not exists (
    select 1 from private.world_settlement_jobs job
    where job.id = p_job_id and job.settlement_id = settlement.id
      and job.job_kind = 'procedural_world'
  ) then
    raise sqlstate 'PT409' using message = 'Procedural command receipt is unavailable';
  end if;

  for operation in
    select value
    from jsonb_array_elements(coalesce(receipt.result -> 'operations', '[]'::jsonb))
    where value ->> 'operation' = 'entity'
      and value ->> 'entityKind' = 'npc'
      and coalesce((value ->> 'reused')::boolean, false) = false
  loop
    begin
      v_entity_id := (operation ->> 'entityId')::uuid;
    exception when invalid_text_representation then
      raise sqlstate 'PT409' using message = 'Procedural command receipt has an invalid canonical entity';
    end;
    if exists (
      select 1
      from private.world_canonical_entities entity
      join private.world_generated_entity_lifecycle lifecycle on lifecycle.entity_id = entity.id
      where entity.id = v_entity_id
        and entity.save_id = settlement.save_id
        and entity.origin = 'procedural'
        and entity.entity_kind = 'npc'
        and entity.lifecycle = 'active'
        and lifecycle.entity_role = 'deep_npc'
    ) then
      promotion := private.world_promote_canonical_npc(settlement.save_id, v_entity_id);
      if not coalesce((promotion ->> 'replayed')::boolean, false) then
        materialized_count := materialized_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when materialized_count > 0 then 'completed' else 'reused' end,
    'promotedCount', materialized_count
  );
end
$function$;

create function public.world_retry_procedural_npc_package_materialization(
  p_settlement_id uuid,
  p_job_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select public.world_materialize_procedural_npc_packages(p_settlement_id, p_job_id)
$function$;

revoke all on table private.world_promoted_npc_package_receipts from public,anon,authenticated,service_role;
revoke all on function private.world_promoted_npc_sheet_v2(private.world_canonical_entities),private.world_promote_canonical_npc(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.world_materialize_procedural_npc_packages(uuid,uuid),public.world_retry_procedural_npc_package_materialization(uuid,uuid) from public,anon,authenticated;
grant execute on function private.world_procedural_resident_capability(uuid,uuid),private.world_frozen_resident_evolution_base(uuid),private.world_promote_canonical_npc(uuid,uuid) to service_role;
grant execute on function public.world_materialize_procedural_npc_packages(uuid,uuid),public.world_retry_procedural_npc_package_materialization(uuid,uuid) to service_role;

commit;
