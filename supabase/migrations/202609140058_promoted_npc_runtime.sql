-- Issue #17: turn an eligible canonical deep NPC into the same immutable,
-- save-scoped resident runtime used by authored residents.  Canonical data stays
-- canonical; the generated identity and version are a frozen adapter, never a
-- mutable copy of the entity payload.
begin;

alter table private.npc_identities drop constraint if exists npc_identities_origin_check;
alter table private.npc_identities add constraint npc_identities_origin_check
  check(origin in ('first_party','community','procedural'));
alter table private.npc_identities drop constraint if exists npc_identities_check;
alter table private.npc_identities add constraint npc_identities_creator_origin_check
  check((origin='community') = (creator_id is not null));

create table private.world_promoted_npc_definitions (
  canonical_entity_id uuid primary key references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid not null unique references private.npc_identities(id) on delete restrict,
  version_id uuid not null unique references private.npc_versions(id) on delete restrict,
  definition_version text not null default 'promoted-resident-v1',
  registry_version text not null default 'primitive-registry-v1',
  personality_schema jsonb not null,
  initial_profile jsonb not null,
  capability_envelope jsonb not null,
  appearance_spec jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check(jsonb_typeof(personality_schema)='object' and jsonb_typeof(initial_profile)='object'
    and jsonb_typeof(capability_envelope)='object' and jsonb_typeof(appearance_spec)='object')
);
create unique index world_promoted_npc_definition_save_entity
  on private.world_promoted_npc_definitions(save_id,canonical_entity_id);
create trigger world_promoted_npc_definitions_immutable
  before update or delete on private.world_promoted_npc_definitions
  for each row execute function private.world_history_append_only();
create table private.world_promoted_npc_receipts (
  canonical_entity_id uuid primary key references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check(jsonb_typeof(result)='object')
);
create trigger world_promoted_npc_receipts_immutable
  before update or delete on private.world_promoted_npc_receipts
  for each row execute function private.world_history_append_only();

-- Supporting actors never carry a model-authored deep profile. This is the
-- authored, versioned template used when lifecycle evidence promotes one.
create table private.world_promoted_supporting_templates (
  archetype_key text primary key check(archetype_key='supporting-actor'),
  definition_version text not null default 'promoted-supporting-template-v1',
  registry_version text not null default 'primitive-registry-v1',
  personality_schema jsonb not null,
  initial_profile jsonb not null,
  capability_envelope jsonb not null,
  appearance_spec jsonb not null,
  check(jsonb_typeof(personality_schema)='object' and jsonb_typeof(initial_profile)='object'
    and jsonb_typeof(capability_envelope)='object' and jsonb_typeof(appearance_spec)='object')
);
create trigger world_promoted_supporting_templates_immutable
  before update or delete on private.world_promoted_supporting_templates
  for each row execute function private.world_history_append_only();
insert into private.world_promoted_supporting_templates(archetype_key,personality_schema,initial_profile,capability_envelope,appearance_spec) values(
  'supporting-actor',
  '{"version":"personality-schema-v1","dimensions":[{"key":"resolve","label":"Resolve","negativeAnchor":"yielding","positiveAnchor":"steadfast","initialValue":50,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false},{"key":"empathy","label":"Empathy","negativeAnchor":"detached","positiveAnchor":"compassionate","initialValue":50,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false},{"key":"openness","label":"Openness","negativeAnchor":"guarded","positiveAnchor":"open","initialValue":50,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false}],"collections":[{"kind":"value","maximumEntries":6},{"kind":"boundary","maximumEntries":6},{"kind":"preference","maximumEntries":6},{"kind":"aversion","maximumEntries":6},{"kind":"voice_trait","maximumEntries":1}]}'::jsonb,
  '{"dimensions":{"resolve":50,"empathy":50,"openness":50},"entries":[{"id":"supporting-value-community","kind":"value","text":"protect the people who offered a place at the tavern","core":true,"active":true},{"id":"supporting-preference-care","kind":"preference","text":"careful preparation","core":false,"active":true},{"id":"supporting-aversion-recklessness","kind":"aversion","text":"recklessness","core":false,"active":true},{"id":"supporting-boundary-companions","kind":"boundary","text":"Will not abandon a companion in danger","core":true,"active":true},{"id":"supporting-voice","kind":"voice_trait","text":"Speaks plainly about what can be seen and done, without pretending to know more.","core":true,"active":true}]}'::jsonb,
  '{"version":"capabilities-v1","allowedActions":["prepare","attempt","wait","abandon"],"allowedApproaches":["scouting","combat","diplomacy","trade"],"allowedWorldEffects":["adjust_relationship","create_quest","update_quest","create_entity","record_world_event"],"allowedTargetKinds":["npc","location","faction","item","recipe","world_event"],"socialCapabilities":["conceal","deceive","share_gossip"],"irreversibleEffects":[]}'::jsonb,
  '{"version":"npc-sheet-v1","physicalIdentity":"A capable traveler whose expression changes slowly as trust is earned.","silhouette":"A practical cloak and well-used gear suited for the road.","attire":"A practical cloak and well-used gear suited for the road.","distinguishingFeatures":["A small token from the road they chose to leave behind."],"palette":["tavern-amber","forest-green"],"renderingTemplateKey":"tavern-portrait"}'::jsonb
);

-- Promotion input is deliberately a small declarative adapter. It cannot carry
-- a sheet, arbitrary personality schema, executable data, or capability list.
create function private.world_promoted_npc_payload(p_payload jsonb)
returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_payload)='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload) key)
      = array['appearance','capabilities','identity','profile']
    and jsonb_typeof(p_payload->'identity')='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload->'identity') key)
      = array['name','shortDescription','title','voice']
    and char_length(btrim(coalesce(p_payload#>>'{identity,name}',''))) between 1 and 80
    and char_length(btrim(coalesce(p_payload#>>'{identity,title}',''))) between 1 and 80
    and char_length(btrim(coalesce(p_payload#>>'{identity,shortDescription}',''))) between 20 and 300
    and char_length(btrim(coalesce(p_payload#>>'{identity,voice}',''))) between 20 and 1000
    and jsonb_typeof(p_payload->'profile')='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload->'profile') key)
      = array['boundaries','dislikes','likes','values']
    and not exists(
      select 1 from jsonb_each(p_payload->'profile') groupings
      where jsonb_typeof(groupings.value)<>'array' or jsonb_array_length(groupings.value) not between 1 and 6
        or exists(select 1 from jsonb_array_elements_text(groupings.value) entry where char_length(btrim(entry)) not between 1 and 200)
    )
    and jsonb_typeof(p_payload->'capabilities')='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload->'capabilities') key)=array['archetypeKey']
    and p_payload#>>'{capabilities,archetypeKey}' in ('ranger','merchant','scout','craftsperson')
    and jsonb_typeof(p_payload->'appearance')='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload->'appearance') key)
      = array['attire','mood','notableFeatures','physicalAppearance']
    and not exists(
      select 1 from jsonb_each_text(p_payload->'appearance') fields
      where char_length(btrim(fields.value)) not between 20 and 1000
    )
$$;

create function private.world_promoted_supporting_payload(p_payload jsonb)
returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_payload)='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload) key)=array['homeLocation','identity','role']
    and jsonb_typeof(p_payload->'identity')='object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload->'identity') key)=array['name','shortDescription','title','voice']
    and char_length(btrim(coalesce(p_payload#>>'{identity,name}',''))) between 1 and 80
    and char_length(btrim(coalesce(p_payload#>>'{identity,title}',''))) between 1 and 80
    and char_length(btrim(coalesce(p_payload#>>'{identity,shortDescription}',''))) between 20 and 300
    and char_length(btrim(coalesce(p_payload#>>'{identity,voice}',''))) between 20 and 1000
    and char_length(btrim(coalesce(p_payload->>'role',''))) between 1 and 120
    and char_length(btrim(coalesce(p_payload->>'homeLocation',''))) between 1 and 120
$$;

create function private.world_promoted_npc_social_capabilities(p_archetype text)
returns jsonb language sql immutable strict set search_path='' as $$
  select case p_archetype
    when 'ranger' then jsonb_build_array('conceal','share_gossip')
    when 'merchant' then jsonb_build_array('misdirect','share_gossip')
    when 'scout' then jsonb_build_array('conceal','deceive','share_gossip')
    when 'craftsperson' then jsonb_build_array('share_gossip')
  end
$$;

create function private.world_promoted_npc_sheet(p_entity private.world_canonical_entities)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p jsonb:=p_entity.payload->'payload'; skills jsonb; target text:=p_entity.entity_key; template private.world_promoted_supporting_templates;
begin
  if p_entity.payload->>'archetypeKey'='supporting-actor' then
    if coalesce(private.world_promoted_supporting_payload(p),false) is not true then raise sqlstate 'PT422' using message='Canonical supporting actor lacks a promotable identity'; end if;
    select * into template from private.world_promoted_supporting_templates where archetype_key='supporting-actor';
    if not found then raise sqlstate 'PT409' using message='Promoted supporting template is unavailable'; end if;
    return jsonb_build_object(
      'schemaVersion','npc-sheet-v1','rating','standard','identity',p->'identity',
      'appearance',jsonb_build_object('physicalAppearance',template.appearance_spec->>'physicalIdentity','attire',template.appearance_spec->>'attire','notableFeatures',(template.appearance_spec->'distinguishingFeatures'->>0),'mood','Patient and attentive while learning who can be trusted.'),
      'personality',jsonb_build_object('values',jsonb_build_array('protect the people who offered a place at the tavern'),'likes',jsonb_build_array('careful preparation'),'dislikes',jsonb_build_array('recklessness'),'boundaries',jsonb_build_array('Will not abandon a companion in danger')),
      'lore',jsonb_build_object('entities','[]'::jsonb,'npcReferences','[]'::jsonb,'relationships','[]'::jsonb,'facts','[]'::jsonb),
      'skills','{"scouting":4,"combat":2,"diplomacy":3,"trade":1}'::jsonb,
      'campaign',jsonb_build_object('durableGoal','Build a dependable place in the evolving world around the tavern.','milestones',jsonb_build_array(
        jsonb_build_object('id','settle-in','title','Settle in','outcome','Learn where help is needed and become a dependable tavern regular.','motivation','A clear first commitment gives this newcomer a place in the community.','constraints',jsonb_build_array('avoid reckless promises'),'allowedTargets',jsonb_build_array(target),'difficulty',2,'successNews',p_entity.payload->>'proposedName'||' has begun to make a place in the tavern community.','nonSuccessNews',p_entity.payload->>'proposedName'||' is still finding their footing around the tavern.','retiredTargets','[]'::jsonb,'permanentLoss',null,'startingPlan',jsonb_build_array(jsonb_build_object('action','prepare','approach','diplomacy'),jsonb_build_object('action','attempt','approach','diplomacy'))),
        jsonb_build_object('id','contribute','title','Contribute','outcome','Put their knowledge to work for the tavern and its visitors.','motivation','Useful work makes a new relationship with the tavern durable.','constraints',jsonb_build_array('keep commitments'),'allowedTargets',jsonb_build_array(target),'difficulty',3,'successNews',p_entity.payload->>'proposedName'||' has made a lasting contribution to the tavern.','nonSuccessNews',p_entity.payload->>'proposedName'||' needs more time before taking on a larger responsibility.','retiredTargets','[]'::jsonb,'permanentLoss',null,'startingPlan',null)
      )));
  end if;
  if coalesce(private.world_promoted_npc_payload(p),false) is not true then raise sqlstate 'PT422' using message='Canonical NPC lacks a promotable deep profile'; end if;
  skills:=case p#>>'{capabilities,archetypeKey}'
    when 'ranger' then '{"scouting":4,"combat":3,"diplomacy":2,"trade":1}'::jsonb
    when 'merchant' then '{"scouting":1,"combat":1,"diplomacy":4,"trade":4}'::jsonb
    when 'scout' then '{"scouting":4,"combat":2,"diplomacy":3,"trade":1}'::jsonb
    else '{"scouting":1,"combat":2,"diplomacy":3,"trade":4}'::jsonb end;
  return jsonb_build_object(
    'schemaVersion','npc-sheet-v1','rating','standard','identity',p->'identity','appearance',p->'appearance','personality',p->'profile',
    'lore',jsonb_build_object('entities','[]'::jsonb,'npcReferences','[]'::jsonb,'relationships','[]'::jsonb,'facts','[]'::jsonb),
    'skills',skills,
    'campaign',jsonb_build_object('durableGoal','Build a dependable place in the evolving world around the tavern.',
      'milestones',jsonb_build_array(
        jsonb_build_object('id','settle-in','title','Settle in','outcome','Learn where help is needed and become a dependable tavern regular.','motivation','A clear first commitment gives this newcomer a place in the community.','constraints',jsonb_build_array('avoid reckless promises'),'allowedTargets',jsonb_build_array(target),'difficulty',2,'successNews',p_entity.payload->>'proposedName'||' has begun to make a place in the tavern community.','nonSuccessNews',p_entity.payload->>'proposedName'||' is still finding their footing around the tavern.','retiredTargets','[]'::jsonb,'permanentLoss',null,'startingPlan',jsonb_build_array(jsonb_build_object('action','prepare','approach','diplomacy'),jsonb_build_object('action','attempt','approach','diplomacy'))),
        jsonb_build_object('id','contribute','title','Contribute','outcome','Put their knowledge to work for the tavern and its visitors.','motivation','Useful work makes a new relationship with the tavern durable.','constraints',jsonb_build_array('keep commitments'),'allowedTargets',jsonb_build_array(target),'difficulty',3,'successNews',p_entity.payload->>'proposedName'||' has made a lasting contribution to the tavern.','nonSuccessNews',p_entity.payload->>'proposedName'||' needs more time before taking on a larger responsibility.','retiredTargets','[]'::jsonb,'permanentLoss',null,'startingPlan',null)
      )
    )
  );
end $$;

-- Make the existing automatic resident-profile hook recognize a promoted
-- definition before it inserts an instance. The stored definition is immutable
-- and uses the same frozen pins as the authored resident path.
create or replace function private.world_resident_profile_backfill() returns trigger language plpgsql security definer set search_path='' as $f$
declare pilot private.world_pilot_resident_definitions; promoted private.world_promoted_npc_definitions;
begin
  select * into pilot from private.world_pilot_resident_definitions where npc_id=new.npc_id and version_id=new.version_id;
  select * into promoted from private.world_promoted_npc_definitions where npc_id=new.npc_id and version_id=new.version_id and save_id=new.save_id;
  if found or pilot.npc_id is not null then
    insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,pressure,profile_schema_version,capability_source_version,appearance_source_version,public_disposition)
    select new.id,new.save_id,new.npc_id,new.version_id,v.sheet,
      coalesce(promoted.initial_profile,pilot.initial_profile),
      (select jsonb_object_agg(x->>'key',0) from jsonb_array_elements(coalesce(promoted.personality_schema,pilot.personality_schema)->'dimensions') x),
      coalesce(promoted.personality_schema,pilot.personality_schema)->>'version',
      coalesce(promoted.definition_version,pilot.definition_version),
      coalesce(promoted.appearance_spec->>'version',pilot.appearance_source->>'schemaVersion'),
      jsonb_build_object('name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}')
    from private.npc_versions v where v.id=new.version_id;
    insert into private.world_resident_evolution_pins(instance_id,save_id,npc_id,definition_version,schema,capability,registry_version)
    values(new.id,new.save_id,new.npc_id,coalesce(promoted.definition_version,pilot.definition_version),coalesce(promoted.personality_schema,pilot.personality_schema),coalesce(promoted.capability_envelope,pilot.capability_envelope),coalesce(promoted.registry_version,pilot.registry_version));
  else
    insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,public_disposition)
    select new.id,new.save_id,new.npc_id,new.version_id,v.sheet,jsonb_build_object('identity',v.sheet->'identity','personality',v.sheet->'personality'),jsonb_build_object('name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') from private.npc_versions v where v.id=new.version_id;
  end if;
  return new;
end $f$;

create function private.world_promote_canonical_npc(p_save_id uuid,p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entity private.world_canonical_entities; lifecycle private.world_generated_entity_lifecycle; existing private.world_promoted_npc_definitions; receipt private.world_promoted_npc_receipts; template private.world_promoted_supporting_templates; identity_id uuid:=extensions.gen_random_uuid(); version_id uuid:=extensions.gen_random_uuid(); instance_id uuid; sheet jsonb; schema jsonb; profile jsonb; capability jsonb; appearance jsonb; normalized text; result jsonb;
begin
  perform private.world_settlement_assert_service();
  select * into entity from private.world_canonical_entities where id=p_entity_id and save_id=p_save_id for update;
  if not found then raise sqlstate 'PT409' using message='Only an active promoted deep canonical NPC can enter the resident runtime'; end if;
  select * into receipt from private.world_promoted_npc_receipts where canonical_entity_id=p_entity_id and save_id=p_save_id;
  if found then return receipt.result || jsonb_build_object('replayed',true); end if;
  select * into existing from private.world_promoted_npc_definitions where canonical_entity_id=p_entity_id;
  if found then
    select id into instance_id from private.world_npc_instances where save_id=p_save_id and npc_id=existing.npc_id;
    raise sqlstate 'PT409' using message='Promoted NPC definition is missing its immutable receipt';
  end if;
  select * into lifecycle from private.world_generated_entity_lifecycle where entity_id=p_entity_id and save_id=p_save_id for update;
  if not found or entity.entity_kind<>'npc' or entity.origin<>'procedural' or entity.lifecycle<>'active' or lifecycle.entity_role<>'deep_npc'
    or entity.payload->>'archetypeKey' not in ('deep-npc','supporting-actor') then raise sqlstate 'PT409' using message='Only an active promoted deep canonical NPC can enter the resident runtime'; end if;
  if entity.payload->>'archetypeKey'='supporting-actor'
    and not exists(select 1 from private.world_generated_entity_lifecycle_history h where h.entity_id=entity.id and h.save_id=p_save_id and h.event_kind='promoted' and h.from_role='supporting_actor' and h.to_role='deep_npc')
  then raise sqlstate 'PT409' using message='Supporting actors require immutable promotion history'; end if;
  sheet:=private.world_promoted_npc_sheet(entity);
  perform private.assert_npc_sheet(sheet);
  normalized:='generated-'||entity.entity_key||'-'||replace(left(entity.id::text,8),'-','');
  if entity.payload->>'archetypeKey'='supporting-actor' then
    select * into template from private.world_promoted_supporting_templates where archetype_key='supporting-actor';
    if not found then raise sqlstate 'PT409' using message='Promoted supporting template is unavailable'; end if;
    schema:=template.personality_schema; profile:=template.initial_profile; capability:=template.capability_envelope; appearance:=template.appearance_spec;
  else
    schema:=jsonb_build_object('version','personality-schema-v1','dimensions',jsonb_build_array(
      jsonb_build_object('key','resolve','label','Resolve','negativeAnchor','yielding','positiveAnchor','steadfast','initialValue',50,'volatility',1,'ordinaryChangeThreshold',25,'definingRuptureThreshold',100,'core',false),
      jsonb_build_object('key','empathy','label','Empathy','negativeAnchor','detached','positiveAnchor','compassionate','initialValue',50,'volatility',1,'ordinaryChangeThreshold',25,'definingRuptureThreshold',100,'core',false),
      jsonb_build_object('key','openness','label','Openness','negativeAnchor','guarded','positiveAnchor','open','initialValue',50,'volatility',1,'ordinaryChangeThreshold',25,'definingRuptureThreshold',100,'core',false)
    ),'collections',jsonb_build_array(jsonb_build_object('kind','value','maximumEntries',6),jsonb_build_object('kind','boundary','maximumEntries',6),jsonb_build_object('kind','preference','maximumEntries',6),jsonb_build_object('kind','aversion','maximumEntries',6),jsonb_build_object('kind','voice_trait','maximumEntries',1)));
    profile:=jsonb_build_object('dimensions',jsonb_build_object('resolve',50,'empathy',50,'openness',50),'entries',(
      select jsonb_agg(jsonb_build_object('id',entity.entity_key||'-'||kind||'-'||ordinality,'kind',kind,'text',text,'core',kind in ('value','boundary'),'active',true) order by kind,ordinality)
      from (
        select 'value'::text kind,text,ordinality from jsonb_array_elements_text(entity.payload#>'{payload,profile,values}') with ordinality as values_entry(text,ordinality)
        union all select 'preference',text,ordinality from jsonb_array_elements_text(entity.payload#>'{payload,profile,likes}') with ordinality as likes_entry(text,ordinality)
        union all select 'aversion',text,ordinality from jsonb_array_elements_text(entity.payload#>'{payload,profile,dislikes}') with ordinality as dislikes_entry(text,ordinality)
        union all select 'boundary',text,ordinality from jsonb_array_elements_text(entity.payload#>'{payload,profile,boundaries}') with ordinality as boundaries_entry(text,ordinality)
        union all select 'voice_trait',entity.payload#>>'{payload,identity,voice}',1
      ) entries));
    capability:=jsonb_build_object('version','capabilities-v1','allowedActions',jsonb_build_array('prepare','attempt','wait','abandon'),'allowedApproaches',jsonb_build_array('scouting','combat','diplomacy','trade'),'allowedWorldEffects',jsonb_build_array('adjust_relationship','create_quest','update_quest','create_entity','record_world_event'),'allowedTargetKinds',jsonb_build_array('npc','location','faction','item','recipe','world_event'),'socialCapabilities',private.world_promoted_npc_social_capabilities(entity.payload#>>'{payload,capabilities,archetypeKey}'),'irreversibleEffects','[]'::jsonb);
    appearance:=jsonb_build_object('version','npc-sheet-v1','physicalIdentity',entity.payload#>>'{payload,appearance,physicalAppearance}','silhouette',entity.payload#>>'{payload,appearance,attire}','attire',entity.payload#>>'{payload,appearance,attire}','distinguishingFeatures',jsonb_build_array(entity.payload#>>'{payload,appearance,notableFeatures}'),'palette',jsonb_build_array('tavern-amber'),'renderingTemplateKey','tavern-portrait');
  end if;
  insert into private.npc_identities(id,origin,normalized_name,status,rating) values(identity_id,'procedural',normalized,'published','standard');
  insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,published_at) values(version_id,identity_id,1,'npc-sheet-v1',sheet,encode(extensions.digest(private.world_canonical_json(sheet),'sha256'),'hex'),'published',clock_timestamp());
  update private.npc_identities set current_published_version_id=version_id where id=identity_id;
  insert into private.world_promoted_npc_definitions(canonical_entity_id,save_id,npc_id,version_id,definition_version,registry_version,personality_schema,initial_profile,capability_envelope,appearance_spec) values(p_entity_id,p_save_id,identity_id,version_id,coalesce(template.definition_version,'promoted-resident-v1'),coalesce(template.registry_version,'primitive-registry-v1'),schema,profile,capability,appearance);
  insert into private.world_npc_instances(save_id,npc_id,version_id,arrived_day) select p_save_id,identity_id,version_id,current_day from public.tavern_saves where id=p_save_id returning id into instance_id;
  result:=jsonb_build_object('status','promoted','replayed',false,'entityId',p_entity_id,'npcId',identity_id,'versionId',version_id,'instanceId',instance_id);
  insert into private.world_promoted_npc_receipts(canonical_entity_id,save_id,result) values(p_entity_id,p_save_id,result);
  return result;
end $$;

create function public.world_promote_canonical_npc(p_save_id uuid,p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.world_settlement_assert_service();
  return private.world_promote_canonical_npc(p_save_id,p_entity_id);
end $$;

revoke all on table private.world_promoted_npc_definitions,private.world_promoted_npc_receipts,private.world_promoted_supporting_templates from public,anon,authenticated,service_role;
revoke all on function private.world_promoted_npc_payload(jsonb),private.world_promoted_supporting_payload(jsonb),private.world_promoted_npc_social_capabilities(text),private.world_promoted_npc_sheet(private.world_canonical_entities),private.world_promote_canonical_npc(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.world_promote_canonical_npc(uuid,uuid) from public,anon,authenticated;
grant execute on function public.world_promote_canonical_npc(uuid,uuid) to service_role;
commit;
