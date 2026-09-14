-- Gate E1: mutation commits are authorized from pinned data, never worker input.
begin;
-- This registry is deliberately private and has no service initializer.  The two
-- rows are the authored pilot contract, keyed by the immutable identity/version.
create table private.world_pilot_resident_definitions (
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  definition_version text not null,
  registry_version text not null,
  personality_schema jsonb not null,
  initial_profile jsonb not null,
  capability_envelope jsonb not null,
  appearance_source jsonb not null,
  appearance_spec jsonb not null,
  primary key (npc_id, version_id),
  check (jsonb_typeof(personality_schema)='object' and jsonb_typeof(initial_profile)='object' and jsonb_typeof(capability_envelope)='object' and jsonb_typeof(appearance_source)='object' and jsonb_typeof(appearance_spec)='object')
);
create function private.world_pilot_definition_guard() returns trigger language plpgsql set search_path='' as $f$
begin if tg_op in ('UPDATE','DELETE') then raise exception using errcode='55000', message='Pilot resident definitions are immutable'; end if; return new; end $f$;
create trigger world_pilot_definition_immutable before update or delete on private.world_pilot_resident_definitions for each row execute function private.world_pilot_definition_guard();
insert into private.world_pilot_resident_definitions(npc_id,version_id,definition_version,registry_version,personality_schema,initial_profile,capability_envelope,appearance_source,appearance_spec) values
('18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819','pilot-resident-v1','pilot-residents-v1',
$$ {"version":"personality-schema-v1","dimensions":[{"key":"duty","label":"Duty","negativeAnchor":"self-serving","positiveAnchor":"protective","initialValue":85,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":true},{"key":"caution","label":"Caution","negativeAnchor":"reckless","positiveAnchor":"careful","initialValue":70,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false},{"key":"empathy","label":"Empathy","negativeAnchor":"detached","positiveAnchor":"compassionate","initialValue":75,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false},{"key":"openness","label":"Openness","negativeAnchor":"guarded","positiveAnchor":"open","initialValue":40,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false}],"collections":[{"kind":"value","maximumEntries":6},{"kind":"boundary","maximumEntries":4},{"kind":"preference","maximumEntries":6},{"kind":"aversion","maximumEntries":6},{"kind":"motive","maximumEntries":4},{"kind":"fear","maximumEntries":4},{"kind":"coping_pattern","maximumEntries":4},{"kind":"voice_trait","maximumEntries":4}]} $$::jsonb,
$$ {"dimensions":{"duty":85,"caution":70,"empathy":75,"openness":40},"entries":[{"id":"lira_value_protect_millhaven","kind":"value","text":"protect Millhaven","core":true,"active":true},{"id":"lira_value_keep_promises","kind":"value","text":"keep promises","core":true,"active":true},{"id":"lira_value_verify_rumors","kind":"value","text":"verify rumors","core":true,"active":true},{"id":"lira_preference_careful_preparation","kind":"preference","text":"careful preparation","core":false,"active":true},{"id":"lira_preference_honest_hospitality","kind":"preference","text":"honest hospitality","core":false,"active":true},{"id":"lira_preference_quiet_woods","kind":"preference","text":"quiet woods","core":false,"active":true},{"id":"lira_aversion_recklessness","kind":"aversion","text":"recklessness","core":false,"active":true},{"id":"lira_aversion_cruelty","kind":"aversion","text":"cruelty","core":false,"active":true},{"id":"lira_aversion_boasting","kind":"aversion","text":"boasting","core":false,"active":true},{"id":"lira_boundary_no_harm_civilians","kind":"boundary","text":"Will not deliberately harm civilians","core":true,"active":true},{"id":"lira_boundary_verify_accusations","kind":"boundary","text":"Does not accept an unverified accusation as fact","core":true,"active":true},{"id":"lira_voice","kind":"voice_trait","text":"Measured, observant, dryly humorous. Short concrete sentences. Cares about people more than glory. Never speaks like an assistant.","core":true,"active":true}]} $$::jsonb,
$$ {"version":"capabilities-v1","allowedActions":["prepare","attempt","wait","abandon"],"allowedApproaches":["scouting","combat","diplomacy","trade"],"allowedWorldEffects":["adjust_relationship"],"allowedTargetKinds":["npc","location","faction","item"],"socialCapabilities":["conceal","share_gossip"],"irreversibleEffects":[]} $$::jsonb,
$$ {"npcVersionId":"18181818-1818-4181-8181-181818181819","schemaVersion":"npc-sheet-v1"} $$::jsonb,
$$ {"version":"npc-sheet-v1","physicalIdentity":"An alert elf with weathered hands and a practical ranger posture.","silhouette":"A moss-green cloak, worn boots, and a well-kept bow.","attire":"A moss-green cloak, worn boots, and a well-kept bow.","distinguishingFeatures":["A braided copper charm and a narrow scar at her left brow."],"palette":["moss-green"],"renderingTemplateKey":"tavern-portrait"} $$::jsonb),
('28282828-2828-4282-8282-282828282828','28282828-2828-4282-8282-282828282829','pilot-resident-v1','pilot-residents-v1',
$$ {"version":"personality-schema-v1","dimensions":[{"key":"fairness","label":"Fairness","negativeAnchor":"exploitative","positiveAnchor":"fair","initialValue":85,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":true},{"key":"reputation","label":"Reputation","negativeAnchor":"unconcerned","positiveAnchor":"reputation-conscious","initialValue":80,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":true},{"key":"community","label":"Community","negativeAnchor":"self-interested","positiveAnchor":"community-minded","initialValue":80,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":true},{"key":"guardedness","label":"Guardedness","negativeAnchor":"forthcoming","positiveAnchor":"guarded","initialValue":65,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100,"core":false}],"collections":[{"kind":"value","maximumEntries":6},{"kind":"boundary","maximumEntries":4},{"kind":"preference","maximumEntries":6},{"kind":"aversion","maximumEntries":6},{"kind":"motive","maximumEntries":4},{"kind":"fear","maximumEntries":4},{"kind":"coping_pattern","maximumEntries":4},{"kind":"voice_trait","maximumEntries":4}]} $$::jsonb,
$$ {"dimensions":{"fairness":85,"reputation":80,"community":80,"guardedness":65},"entries":[{"id":"torvin_value_fair_bargains","kind":"value","text":"fair bargains","core":true,"active":true},{"id":"torvin_value_protect_reputation","kind":"value","text":"protect his reputation","core":true,"active":true},{"id":"torvin_value_provide_community","kind":"value","text":"provide for his community","core":true,"active":true},{"id":"torvin_preference_patient_negotiation","kind":"preference","text":"patient negotiation","core":false,"active":true},{"id":"torvin_preference_good_craftsmanship","kind":"preference","text":"good craftsmanship","core":false,"active":true},{"id":"torvin_preference_dependable_company","kind":"preference","text":"dependable company","core":false,"active":true},{"id":"torvin_aversion_patronized","kind":"aversion","text":"being patronized","core":false,"active":true},{"id":"torvin_aversion_empty_guarantees","kind":"aversion","text":"empty guarantees","core":false,"active":true},{"id":"torvin_aversion_careless_spending","kind":"aversion","text":"careless spending","core":false,"active":true},{"id":"torvin_boundary_no_counterfeit","kind":"boundary","text":"Will not knowingly sell a counterfeit","core":true,"active":true},{"id":"torvin_boundary_keepers_gold","kind":"boundary","text":"Does not spend the keeper's gold without a real game action","core":true,"active":true},{"id":"torvin_voice","kind":"voice_trait","text":"Warm, shrewd, slightly theatrical. Uses occasional practical merchant comparisons. Pride conceals anxiety; never speaks like an assistant.","core":true,"active":true}]} $$::jsonb,
$$ {"version":"capabilities-v1","allowedActions":["prepare","attempt","wait","abandon"],"allowedApproaches":["scouting","combat","diplomacy","trade"],"allowedWorldEffects":["adjust_relationship"],"allowedTargetKinds":["npc","location","faction","item"],"socialCapabilities":["misdirect","share_gossip"],"irreversibleEffects":[]} $$::jsonb,
$$ {"npcVersionId":"28282828-2828-4282-8282-282828282829","schemaVersion":"npc-sheet-v1"} $$::jsonb,
$$ {"version":"npc-sheet-v1","physicalIdentity":"A broad dwarf with soot-dark braids and appraising eyes.","silhouette":"A layered merchant coat, brass scales, and a travel-stained satchel.","attire":"A layered merchant coat, brass scales, and a travel-stained satchel.","distinguishingFeatures":["A heavy silver ring engraved with a miners mark."],"palette":["soot-dark","brass","silver"],"renderingTemplateKey":"tavern-portrait"} $$::jsonb);

create table private.world_resident_evolution_pins(instance_id uuid primary key references private.world_npc_instances(id) on delete cascade,save_id uuid not null references public.tavern_saves(id) on delete cascade,npc_id uuid not null references private.npc_identities(id),definition_version text not null, schema jsonb not null,capability jsonb not null,registry_version text not null,created_at timestamptz not null default clock_timestamp(),check(jsonb_typeof(schema)='object' and jsonb_typeof(capability)='object'));
create function private.world_evolution_pin_guard()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op = 'DELETE' then
    -- Allow the foreign-key cascade when the resident instance itself is being purged.
    if not exists (select 1 from private.world_npc_instances where id = old.instance_id) then
      return old;
    end if;
    raise exception using errcode = '55000', message = 'Evolution definition pins are immutable';
  end if;
  if tg_op = 'UPDATE' then
    raise exception using errcode = '55000', message = 'Evolution definition pins are immutable';
  end if;
  if not exists (
    select 1 from private.world_resident_profiles p
    where p.instance_id = new.instance_id and p.save_id = new.save_id and p.npc_id = new.npc_id
  ) then
    raise exception using errcode = '23514', message = 'Evolution pin must match resident profile';
  end if;
  return new;
end $function$;
create trigger world_evolution_pin_immutable before insert or update or delete on private.world_resident_evolution_pins for each row execute function private.world_evolution_pin_guard();

-- The only source-version transition permitted by this migration is the first
-- conversion from the 041 compatibility shell to its exact pilot definition.
create or replace function private.world_profile_guard() returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if tg_op='INSERT' then
    if not exists(select 1 from private.world_npc_instances w where w.id=new.instance_id and w.save_id=new.save_id and w.npc_id=new.npc_id and w.version_id=new.version_id) then raise exception using errcode='23514',message='Resident profile must match its save-pinned NPC instance'; end if;
  elsif new.profile_schema_version<>old.profile_schema_version or new.capability_source_version<>old.capability_source_version or new.appearance_source_version<>old.appearance_source_version then
    if not (
      new.instance_id=old.instance_id and new.save_id=old.save_id and new.npc_id=old.npc_id and new.version_id=old.version_id
      and new.frozen_sheet=old.frozen_sheet
      and old.profile_schema_version='resident-profile-compat-v1' and new.profile_schema_version='personality-schema-v1'
      and exists(
        select 1 from private.world_pilot_resident_definitions d
        where d.npc_id=old.npc_id and d.version_id=old.version_id
          and new.current_profile=d.initial_profile
          and new.pressure=(select jsonb_object_agg(x->>'key',0) from jsonb_array_elements(d.personality_schema->'dimensions') x)
          and new.capability_source_version=d.definition_version
          and new.appearance_source_version=d.appearance_source->>'schemaVersion'
      )
    ) then raise exception using errcode='55000',message='Resident source pins are immutable'; end if;
  elsif new.instance_id<>old.instance_id or new.save_id<>old.save_id or new.npc_id<>old.npc_id or new.version_id<>old.version_id or new.frozen_sheet<>old.frozen_sheet then raise exception using errcode='55000',message='Resident source pins are immutable';
  end if;
  if tg_op='UPDATE' and new.profile_revision<>old.profile_revision then
    if new.profile_revision<>old.profile_revision+1 or not exists(select 1 from private.world_resident_personality_ledger l where l.instance_id=old.instance_id and l.profile_revision=new.profile_revision) then raise exception using errcode='55000',message='Profile revision requires an append-only ledger receipt'; end if;
  elsif tg_op='UPDATE' and (new.current_profile<>old.current_profile or new.public_disposition<>old.public_disposition) then raise exception using errcode='55000',message='Profile state requires a new revision receipt'; end if;
  return new;
end $f$;

insert into private.world_resident_personality_ledger(instance_id,profile_revision,receipt_key,delta,evidence_refs)
select p.instance_id,p.profile_revision+1,extensions.gen_random_uuid(),jsonb_build_object('kind','pilot_definition_backfill','definitionVersion',d.definition_version), '[]'::jsonb
from private.world_resident_profiles p join private.world_pilot_resident_definitions d on d.npc_id=p.npc_id and d.version_id=p.version_id
where p.profile_schema_version='resident-profile-compat-v1';
update private.world_resident_profiles p set current_profile=d.initial_profile,pressure=(select jsonb_object_agg(x->>'key',0) from jsonb_array_elements(d.personality_schema->'dimensions') x),profile_schema_version=d.personality_schema->>'version',capability_source_version=d.definition_version,appearance_source_version=d.appearance_source->>'schemaVersion',profile_revision=p.profile_revision+1,updated_at=clock_timestamp()
from private.world_pilot_resident_definitions d where d.npc_id=p.npc_id and d.version_id=p.version_id and p.profile_schema_version='resident-profile-compat-v1';
insert into private.world_resident_evolution_pins(instance_id,save_id,npc_id,definition_version,schema,capability,registry_version)
select p.instance_id,p.save_id,p.npc_id,d.definition_version,d.personality_schema,d.capability_envelope,d.registry_version from private.world_resident_profiles p join private.world_pilot_resident_definitions d on d.npc_id=p.npc_id and d.version_id=p.version_id;

create or replace function private.world_resident_profile_backfill() returns trigger language plpgsql security definer set search_path='' as $f$
declare d private.world_pilot_resident_definitions;
begin
  select * into d from private.world_pilot_resident_definitions where npc_id=new.npc_id and version_id=new.version_id;
  if found then
    insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,pressure,profile_schema_version,capability_source_version,appearance_source_version,public_disposition)
    select new.id,new.save_id,new.npc_id,new.version_id,v.sheet,d.initial_profile,(select jsonb_object_agg(x->>'key',0) from jsonb_array_elements(d.personality_schema->'dimensions') x),d.personality_schema->>'version',d.definition_version,d.appearance_source->>'schemaVersion',jsonb_build_object('name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') from private.npc_versions v where v.id=new.version_id;
    insert into private.world_resident_evolution_pins(instance_id,save_id,npc_id,definition_version,schema,capability,registry_version) values(new.id,new.save_id,new.npc_id,d.definition_version,d.personality_schema,d.capability_envelope,d.registry_version);
  else
    insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,public_disposition)
    select new.id,new.save_id,new.npc_id,new.version_id,v.sheet,jsonb_build_object('identity',v.sheet->'identity','personality',v.sheet->'personality'),jsonb_build_object('name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') from private.npc_versions v where v.id=new.version_id;
  end if;
  return new;
end $f$;
create table private.world_resident_mutation_receipts(job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,proposal_fingerprint text not null check(proposal_fingerprint~'^[a-f0-9]{64}$'),canonical_proposal text not null,public_digest text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),check(jsonb_typeof(result)='object'));
create table private.world_resident_mutation_evidence(job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,save_id uuid not null references public.tavern_saves(id) on delete cascade,instance_id uuid not null references private.world_npc_instances(id) on delete cascade,evidence_key text not null,provenance text not null,source_fingerprint text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(job_id,evidence_key),check(jsonb_typeof(detail)='object'));
create table private.world_resident_pressure_history(id bigint generated always as identity primary key,job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,instance_id uuid not null references private.world_npc_instances(id) on delete cascade,dimension_key text not null,pressure_before integer not null,pressure_added integer not null,pressure_after integer not null,created_at timestamptz not null default clock_timestamp());
create table private.world_social_effect_receipts(job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,ordinal smallint not null,input_fingerprint text not null check(input_fingerprint~'^[a-f0-9]{64}$'),payload jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(job_id,ordinal),check(jsonb_typeof(payload)='object'));
create trigger world_mutation_receipt_append_only before update or delete on private.world_resident_mutation_receipts for each row execute function private.world_history_append_only();
create trigger world_mutation_evidence_append_only before update or delete on private.world_resident_mutation_evidence for each row execute function private.world_history_append_only();
create trigger world_mutation_pressure_append_only before update or delete on private.world_resident_pressure_history for each row execute function private.world_history_append_only();
create trigger world_social_effect_receipt_append_only before update or delete on private.world_social_effect_receipts for each row execute function private.world_history_append_only();

-- Deterministic JSON rendering must match JSON.stringify's sorted-key output.
create function private.world_canonical_json(p_value jsonb)
returns text language plpgsql immutable strict set search_path='' as $function$
declare
  item jsonb;
  key text;
  rendered text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      rendered := '{';
      for key, item in
        select object_item.key, object_item.value
        from jsonb_each(p_value) as object_item
        order by object_item.key collate "C"
      loop
        rendered := rendered || case when rendered = '{' then '' else ',' end
          || to_jsonb(key)::text || ':' || private.world_canonical_json(item);
      end loop;
      return rendered || '}';
    when 'array' then
      rendered := '[';
      for item in select value from jsonb_array_elements(p_value) loop
        rendered := rendered || case when rendered = '[' then '' else ',' end
          || private.world_canonical_json(item);
      end loop;
      return rendered || ']';
    else return p_value::text;
  end case;
end $function$;

create function private.world_json_keys_exact(p_value jsonb, p_keys text[])
returns boolean language sql immutable strict set search_path='' as $function$
  select jsonb_typeof(p_value) = 'object'
    and array(select key from jsonb_object_keys(p_value) key order by key)
      = array(select unnest(p_keys) order by 1)
$function$;

create function private.world_safe_mutation_json(p_value jsonb, p_depth integer default 0)
returns boolean language plpgsql immutable strict set search_path='' as $function$
declare key text; item jsonb; count_keys integer := 0;
begin
  if p_depth > 6 then return false; end if;
  case jsonb_typeof(p_value)
    when 'null', 'boolean', 'number' then return true;
    when 'string' then return char_length(p_value #>> '{}') <= 1000;
    when 'array' then
      if jsonb_array_length(p_value) > 32 then return false; end if;
      for item in select value from jsonb_array_elements(p_value) loop
        if not private.world_safe_mutation_json(item, p_depth + 1) then return false; end if;
      end loop;
      return true;
    when 'object' then
      for key, item in select object_item.key, object_item.value from jsonb_each(p_value) as object_item loop
        count_keys := count_keys + 1;
        if count_keys > 160 or char_length(key) > 80
          or key in ('__proto__', 'constructor', 'prototype')
          or regexp_replace(key, '([a-z0-9])([A-Z])', '\\1_\\2', 'g') ~* '(^|_)(sql|query|route|url|endpoint|code|function|handler|script|executable)($|_)'
          or not private.world_safe_mutation_json(item, p_depth + 1) then return false; end if;
      end loop;
      return true;
    else return false;
  end case;
end $function$;

-- Later settlement assembly derives this binding from the database, never worker input.
create function private.world_frozen_resident_evolution_base(p_instance_id uuid)
returns jsonb language plpgsql stable strict security definer set search_path='' as $function$
declare profile private.world_resident_profiles; pin private.world_resident_evolution_pins;
begin
  select * into profile from private.world_resident_profiles where instance_id = p_instance_id;
  select * into pin from private.world_resident_evolution_pins where instance_id = p_instance_id;
  if not found or profile.profile_schema_version = 'resident-profile-compat-v1' then return null; end if;
  return jsonb_build_object('residentId', profile.instance_id, 'npcId', profile.npc_id,
    'profileRevision', profile.profile_revision, 'profile', profile.current_profile,
    'pressureByDimension', profile.pressure, 'schema', pin.schema, 'capability', pin.capability);
end $function$;
revoke all on function private.world_frozen_resident_evolution_base(uuid) from public, anon, authenticated;
grant execute on function private.world_frozen_resident_evolution_base(uuid) to service_role;

create or replace function public.world_settlement_commit_mutation(
  p_settlement_id uuid, p_job_id uuid, p_fence uuid, p_proposal jsonb,
  p_proposal_fingerprint text, p_public_digest text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  settlement private.world_settlements; job private.world_settlement_jobs;
  profile private.world_resident_profiles; pin private.world_resident_evolution_pins;
  prior private.world_resident_mutation_receipts; checkpoint jsonb; evolution jsonb;
  evidence jsonb; change jsonb; dimension jsonb; operation jsonb; effect jsonb;
  canonical text; resident_id uuid; target_id uuid; belief_id uuid;
  dimension_key text; pressure_before integer; pressure_added integer; pressure_after integer;
  pressure_committed integer; threshold integer; scale integer; chance integer := null; roll integer := null;
  any_crossed boolean := false; core_crossed boolean := false; changed boolean := false;
  profile_changed boolean := false; entries_changed boolean := false;
  next_profile jsonb; next_pressure jsonb; dimensions_receipt jsonb := '[]'::jsonb;
  entry_indexes jsonb := '[]'::jsonb; effect_ordinal integer := 0; operation_index integer := 0;
  entry jsonb; existing_entry jsonb; provenance jsonb; item jsonb; source_id text;
begin
  perform private.world_settlement_assert_service();
  if jsonb_typeof(p_proposal) <> 'object' or octet_length(p_proposal::text) > 15000
    or coalesce(p_proposal_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or char_length(trim(coalesce(p_public_digest, ''))) not between 1 and 500 then
    raise sqlstate 'PT400' using message = 'Invalid mutation request';
  end if;
  canonical := private.world_canonical_json(p_proposal);
  if encode(extensions.digest(canonical, 'sha256'), 'hex') <> p_proposal_fingerprint then
    raise sqlstate 'PT400' using message = 'Mutation proposal fingerprint is invalid';
  end if;
  select * into prior from private.world_resident_mutation_receipts where job_id = p_job_id for update;
  if found then
    if prior.proposal_fingerprint = p_proposal_fingerprint and prior.canonical_proposal = canonical
      and prior.public_digest = trim(p_public_digest) then return prior.result; end if;
    raise sqlstate 'PT409' using message = 'Mutation job already has a different commit';
  end if;
  select * into settlement from private.world_settlements where id = p_settlement_id for update;
  select * into job from private.world_settlement_jobs
    where id = p_job_id and settlement_id = p_settlement_id and job_kind = 'resident' and status = 'processing' for update;
  if not found or settlement.status <> 'processing' or settlement.fence <> p_fence
    or settlement.deadline_at <= clock_timestamp() or settlement.lease_until <= clock_timestamp()
    or not exists (select 1 from private.world_settlement_attempts a where a.job_id = p_job_id
      and a.fence = p_fence and a.status = 'processing' and a.lease_until > clock_timestamp()) then
    raise sqlstate 'PT409' using message = 'Stale settlement fence';
  end if;
  select payload into checkpoint from private.world_settlement_stage_checkpoints
    where job_id = job.id and stage = 'validated' and (payload->>'accepted') in ('true', 'accept')
    order by created_at desc, id desc limit 1;
  if checkpoint is null or checkpoint->'proposal' is distinct from p_proposal then
    raise sqlstate 'PT400' using message = 'Proposal is not an accepted validated checkpoint';
  end if;
  evolution := job.input_snapshot->'evolution';
  if not private.world_json_keys_exact(evolution, array['authorizedEvidence','capability','npcId','pressureByDimension','profile','profileRevision','residentId','schema','worldSnapshot'])
    or jsonb_typeof(evolution->'authorizedEvidence') <> 'array' or jsonb_typeof(evolution->'schema') <> 'object'
    or jsonb_typeof(evolution->'profile') <> 'object' or jsonb_typeof(evolution->'pressureByDimension') <> 'object'
    or jsonb_typeof(evolution->'capability') <> 'object' or jsonb_typeof(evolution->'worldSnapshot') <> 'object' then
    raise sqlstate 'PT400' using message = 'Frozen evolution binding is invalid';
  end if;
  begin resident_id := (evolution->>'residentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400' using message = 'Frozen resident id is invalid'; end;
  select * into profile from private.world_resident_profiles where instance_id = resident_id and save_id = settlement.save_id for update;
  select * into pin from private.world_resident_evolution_pins where instance_id = resident_id and save_id = settlement.save_id for update;
  if not found or profile.npc_id::text <> evolution->>'npcId' or profile.profile_revision <> (evolution->>'profileRevision')::bigint
    or profile.current_profile is distinct from evolution->'profile' or profile.pressure is distinct from evolution->'pressureByDimension'
    or pin.npc_id <> profile.npc_id or pin.schema is distinct from evolution->'schema' or pin.capability is distinct from evolution->'capability' then
    raise sqlstate 'PT409' using message = 'Frozen resident profile or pin is stale';
  end if;
  if not private.world_safe_mutation_json(p_proposal)
    or not private.world_json_keys_exact(p_proposal, array['beliefOperations','causalExplanation','dimensionChanges','entryOperations','evidenceIds','questChanges','rulesVersion','salience','worldEffects'])
    or p_proposal->>'rulesVersion' <> 'evolving-world-v1' or p_proposal->>'salience' not in ('minor','meaningful','major','defining')
    or char_length(trim(coalesce(p_proposal->>'causalExplanation',''))) not between 1 and 1000
    or jsonb_typeof(p_proposal->'evidenceIds') <> 'array' or jsonb_typeof(p_proposal->'dimensionChanges') <> 'array'
    or jsonb_typeof(p_proposal->'entryOperations') <> 'array' or jsonb_typeof(p_proposal->'beliefOperations') <> 'array'
    or jsonb_typeof(p_proposal->'questChanges') <> 'array' or jsonb_typeof(p_proposal->'worldEffects') <> 'array'
    or jsonb_array_length(p_proposal->'evidenceIds') not between 1 and 16
    or jsonb_array_length(p_proposal->'dimensionChanges') > 3 or jsonb_array_length(p_proposal->'entryOperations') > 2
    or jsonb_array_length(p_proposal->'beliefOperations') > 2 or jsonb_array_length(p_proposal->'worldEffects') > 4
    or jsonb_array_length(p_proposal->'questChanges') <> 0 then raise sqlstate 'PT400' using message = 'Proposal violates strict E0 contract'; end if;
  if exists (select 1 from jsonb_array_elements(p_proposal->'evidenceIds') v where jsonb_typeof(v) <> 'string' or char_length(trim(v#>>'{}')) = 0)
    or (select count(*) from jsonb_array_elements_text(p_proposal->'evidenceIds')) <> (select count(distinct value) from jsonb_array_elements_text(p_proposal->'evidenceIds')) then raise sqlstate 'PT400' using message = 'Evidence ids must be unique and nonblank'; end if;
  for evidence in select value from jsonb_array_elements(evolution->'authorizedEvidence') loop
    if not private.world_json_keys_exact(evidence, array['happenedOnDay','id','kind','salience','sequence','sourceFingerprint','summary'])
      or jsonb_typeof(evidence->'id') <> 'string' or jsonb_typeof(evidence->'sourceFingerprint') <> 'string'
      or char_length(trim(evidence->>'id')) = 0 or evidence->>'sourceFingerprint' !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(evidence->'happenedOnDay') <> 'number'
      or (evidence->>'happenedOnDay')::numeric <> trunc((evidence->>'happenedOnDay')::numeric)
      or (evidence->>'happenedOnDay')::integer < 0
      or jsonb_typeof(evidence->'sequence') <> 'number'
      or (evidence->>'sequence')::numeric <> trunc((evidence->>'sequence')::numeric)
      or (evidence->>'sequence')::integer < 0
      or jsonb_typeof(evidence->'summary') <> 'string'
      or char_length(trim(evidence->>'summary')) not between 1 and 1000
      or evidence->>'kind' not in ('dialogue','quest_outcome','world_event','hospitality_reaction','social_encounter','gossip')
      or evidence->>'salience' not in ('minor','meaningful','major','defining') then raise sqlstate 'PT400' using message = 'Frozen evidence is invalid'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(evolution->'authorizedEvidence')) < 1
    or (select count(*) from jsonb_array_elements(evolution->'authorizedEvidence')) > 64
    or (select count(*) from jsonb_array_elements(evolution->'authorizedEvidence')) <>
       (select count(distinct e->>'id') from jsonb_array_elements(evolution->'authorizedEvidence') e) then
    raise sqlstate 'PT400' using message = 'Frozen evidence ids must be unique and bounded';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_proposal->'evidenceIds') q(id) where not exists
    (select 1 from jsonb_array_elements(evolution->'authorizedEvidence') e where e->>'id' = q.id)) then raise sqlstate 'PT400' using message = 'Unauthorized evidence'; end if;
  -- Validate every proposed operation before any durable write.
  for change in select value from jsonb_array_elements(p_proposal->'dimensionChanges') loop
    if not private.world_json_keys_exact(change, array['dimensionKey','direction','intendedDelta'])
      or jsonb_typeof(change->'dimensionKey') <> 'string' or change->>'direction' not in ('-1','1')
      or jsonb_typeof(change->'intendedDelta') <> 'number' or (change->>'intendedDelta')::numeric <> trunc((change->>'intendedDelta')::numeric)
      or abs((change->>'intendedDelta')::integer) not between 1 and 100 or sign((change->>'intendedDelta')::integer) <> (change->>'direction')::integer then raise sqlstate 'PT400' using message = 'Invalid dimension change'; end if;
    if (select count(*) from jsonb_array_elements(p_proposal->'dimensionChanges') x where x->>'dimensionKey' = change->>'dimensionKey') <> 1
      or not exists (select 1 from jsonb_array_elements(pin.schema->'dimensions') d where d->>'key' = change->>'dimensionKey') then raise sqlstate 'PT400' using message = 'Unknown or duplicate dimension'; end if;
  end loop;
  for operation in select value from jsonb_array_elements(p_proposal->'entryOperations') loop
    if jsonb_typeof(operation) <> 'object' or operation->>'operation' not in ('add','revise','retract') then raise sqlstate 'PT400' using message = 'Invalid profile entry operation'; end if;
    if operation->>'operation' = 'add' then
      entry := operation->'entry';
      if not private.world_json_keys_exact(operation, array['entry','operation']) or not private.world_json_keys_exact(entry, array['active','core','id','kind','text'])
        or entry->>'active' <> 'true' or entry->>'id' !~ '^[a-z][a-z0-9_]{1,63}$' or char_length(trim(entry->>'text')) not between 1 and 1000
        or not exists(select 1 from jsonb_array_elements(pin.schema->'collections') c where c->>'kind' = entry->>'kind')
        or exists(select 1 from jsonb_array_elements(profile.current_profile->'entries') z where z->>'id' = entry->>'id') then raise sqlstate 'PT400' using message = 'Invalid profile entry addition'; end if;
    else
      if not private.world_json_keys_exact(operation, case when operation->>'operation'='revise' then array['entryId','operation','text'] else array['entryId','operation'] end)
        or operation->>'entryId' !~ '^[a-z][a-z0-9_]{1,63}$' or (operation->>'operation'='revise' and char_length(trim(operation->>'text')) not between 1 and 1000)
        or not exists(select 1 from jsonb_array_elements(profile.current_profile->'entries') z where z->>'id'=operation->>'entryId' and z->>'active'='true') then raise sqlstate 'PT400' using message = 'Invalid profile entry operation'; end if;
    end if;
  end loop;
  for operation in select value from jsonb_array_elements(p_proposal->'beliefOperations') loop
    if operation->>'operation'='add' then
      if not private.world_json_keys_exact(operation,array['confidence','content','operation','originalClaimFingerprint','provenance','subjectEntityId'])
        or operation->>'originalClaimFingerprint' !~ '^[a-f0-9]{64}$' or char_length(trim(operation->>'content')) not between 1 and 1000
        or operation->>'subjectEntityId' !~ '^(?:[a-z][a-z0-9_-]{1,127}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
        or not (evolution->'worldSnapshot'->'entityKinds' ? (operation->>'subjectEntityId'))
        or jsonb_typeof(operation->'confidence')<>'number' or (operation->>'confidence')::numeric<>trunc((operation->>'confidence')::numeric) or (operation->>'confidence')::integer not between 0 and 100
        or jsonb_typeof(operation->'provenance')<>'array' or jsonb_array_length(operation->'provenance') not between 1 and 4 then raise sqlstate 'PT400' using message='Invalid belief addition'; end if;
      if exists(
        select 1 from jsonb_array_elements(operation->'provenance') p
        where jsonb_typeof(p) <> 'object'
          or not (
            private.world_json_keys_exact(p,array['sourceId','sourceKind'])
            or private.world_json_keys_exact(p,array['sourceId','sourceKind','speakerNpcId'])
          )
          or p->>'sourceKind' not in ('direct_evidence','dialogue_claim','gossip','inference')
          or p->>'sourceId' !~ '^(?:[a-z][a-z0-9_-]{1,127}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
          or (p ? 'speakerNpcId' and p->>'speakerNpcId' !~ '^(?:[a-z][a-z0-9_-]{1,127}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$')
          or not exists(select 1 from jsonb_array_elements(evolution->'authorizedEvidence') e where e->>'id'=p->>'sourceId')
      ) or not exists(
        select 1
        from jsonb_array_elements(operation->'provenance') p
        join jsonb_array_elements(evolution->'authorizedEvidence') e on e->>'id'=p->>'sourceId'
        where e->>'sourceFingerprint'=operation->>'originalClaimFingerprint'
      ) then raise sqlstate 'PT400' using message='Belief attribution is not frozen evidence'; end if;
    elsif operation->>'operation'='retract' then
      if not private.world_json_keys_exact(operation,array['beliefId','operation','reason','sourceFingerprint'])
        or char_length(trim(operation->>'reason')) not between 1 and 500
        or operation->>'sourceFingerprint' !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT400' using message='Invalid belief retraction'; end if;
      begin belief_id := (operation->>'beliefId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400' using message='Invalid belief retraction'; end;
      if not exists(select 1 from private.world_resident_beliefs b where b.id=belief_id and b.instance_id=resident_id and b.active)
        or not exists(select 1 from jsonb_array_elements(evolution->'authorizedEvidence') e where e->>'sourceFingerprint'=operation->>'sourceFingerprint') then raise sqlstate 'PT400' using message='Belief retraction is not frozen evidence'; end if;
    else raise sqlstate 'PT400' using message='Invalid belief operation'; end if;
  end loop;
  for effect in select value from jsonb_array_elements(p_proposal->'worldEffects') loop
    if not private.world_json_keys_exact(effect,array['axis','delta','kind','objectEntityId','subjectNpcId']) or effect->>'kind'<>'adjust_relationship'
      or effect->>'axis' not in ('trust','affection','respect','fear','obligation') or jsonb_typeof(effect->'delta')<>'number'
      or (effect->>'delta')::numeric<>trunc((effect->>'delta')::numeric) or (effect->>'delta')::integer not between -25 and 25 or (effect->>'delta')::integer=0
      or not (pin.capability->'allowedWorldEffects' ? 'adjust_relationship') then raise sqlstate 'PT400' using message='World effect has no safe E1 handler'; end if;
    begin target_id := (effect->>'objectEntityId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400' using message='Invalid social target'; end;
    if effect->>'subjectNpcId'<>resident_id::text or not exists(select 1 from private.world_npc_instances w where w.id=target_id and w.save_id=settlement.save_id)
      or (evolution->'worldSnapshot'->'entityKinds')->>(effect->>'objectEntityId')<>'npc' then raise sqlstate 'PT400' using message='Social effect violates pinned world snapshot'; end if;
  end loop;
  next_profile := profile.current_profile; next_pressure := profile.pressure;
  scale := case p_proposal->>'salience' when 'minor' then 5 when 'meaningful' then 15 when 'major' then 30 else 60 end;
  for change in select value from jsonb_array_elements(p_proposal->'dimensionChanges') loop
    dimension_key := change->>'dimensionKey'; select value into dimension from jsonb_array_elements(pin.schema->'dimensions') where value->>'key'=dimension_key;
    pressure_before := coalesce((profile.pressure->>dimension_key)::integer, 0); pressure_added := round(scale * (dimension->>'volatility')::numeric)::integer * (change->>'direction')::integer;
    pressure_after := pressure_before + pressure_added; threshold := case when coalesce((dimension->>'core')::boolean,false) then coalesce((dimension->>'definingRuptureThreshold')::integer,100) else coalesce((dimension->>'ordinaryChangeThreshold')::integer,25) end;
    any_crossed := any_crossed or abs(pressure_after) >= threshold; core_crossed := core_crossed or (coalesce((dimension->>'core')::boolean,false) and abs(pressure_after) >= threshold);
    next_pressure := jsonb_set(next_pressure,array[dimension_key],to_jsonb(pressure_after),true);
  end loop;
  if any_crossed then chance := case p_proposal->>'salience' when 'minor' then 15 when 'meaningful' then 35 when 'major' then 65 else 90 end; roll := floor(random()*100)::integer; changed := roll < chance; end if;
  for change in select value from jsonb_array_elements(p_proposal->'dimensionChanges') loop
    dimension_key := change->>'dimensionKey'; select value into dimension from jsonb_array_elements(pin.schema->'dimensions') where value->>'key'=dimension_key;
    pressure_before := coalesce((profile.pressure->>dimension_key)::integer,0); pressure_added := round(scale*(dimension->>'volatility')::numeric)::integer*(change->>'direction')::integer; pressure_after := pressure_before+pressure_added;
    threshold := case when coalesce((dimension->>'core')::boolean,false) then coalesce((dimension->>'definingRuptureThreshold')::integer,100) else coalesce((dimension->>'ordinaryChangeThreshold')::integer,25) end;
    pressure_committed := pressure_after;
    if changed and abs(pressure_after)>=threshold then pressure_committed := pressure_after - sign(pressure_after)*threshold; next_pressure:=jsonb_set(next_pressure,array[dimension_key],to_jsonb(pressure_committed),true); end if;
    if changed and ((not coalesce((dimension->>'core')::boolean,false)) or abs(pressure_after)>=threshold) then
      next_profile:=jsonb_set(next_profile,array['dimensions',dimension_key],to_jsonb(greatest(-100,least(100,coalesce((profile.current_profile#>>array['dimensions',dimension_key])::integer,0)+(change->>'intendedDelta')::integer))),true); profile_changed:=true;
    end if;
    dimensions_receipt:=dimensions_receipt || jsonb_build_array(jsonb_build_object('dimensionKey',dimension_key,'pressureBefore',pressure_before,'pressureAdded',pressure_added,'pressureAfterApproval',pressure_after,'threshold',threshold,'crossedThreshold',abs(pressure_after)>=threshold,'pressureAfterCommit',pressure_committed,'intendedDelta',(change->>'intendedDelta')::integer,'appliedDelta',case when changed and ((not coalesce((dimension->>'core')::boolean,false)) or abs(pressure_after)>=threshold) then (change->>'intendedDelta')::integer else 0 end,'valueBefore',coalesce((profile.current_profile#>>array['dimensions',dimension_key])::integer,0),'valueAfter',coalesce((next_profile#>>array['dimensions',dimension_key])::integer,0)));
  end loop;
  if changed then
    operation_index:=0;
    for operation in select value from jsonb_array_elements(p_proposal->'entryOperations') loop
      operation_index:=operation_index+1; entry:=case when operation->>'operation'='add' then operation->'entry' else (select value from jsonb_array_elements(next_profile->'entries') where value->>'id'=operation->>'entryId') end;
      if (not coalesce((entry->>'core')::boolean,false)) or core_crossed then
        if operation->>'operation'='add' then
          if (select count(*) from jsonb_array_elements(next_profile->'entries') z where z->>'kind'=entry->>'kind' and z->>'active'='true') >= (select (c->>'maximumEntries')::integer from jsonb_array_elements(pin.schema->'collections') c where c->>'kind'=entry->>'kind') then raise sqlstate 'PT400' using message='Profile collection cap exceeded'; end if;
          next_profile:=jsonb_set(next_profile,'{entries}',(next_profile->'entries')||jsonb_build_array(entry));
        elsif operation->>'operation'='retract' then next_profile:=jsonb_set(next_profile,'{entries}',(select jsonb_agg(case when z->>'id'=operation->>'entryId' then jsonb_set(z,'{active}','false'::jsonb) else z end) from jsonb_array_elements(next_profile->'entries') z));
        else next_profile:=jsonb_set(next_profile,'{entries}',(select jsonb_agg(case when z->>'id'=operation->>'entryId' then jsonb_set(z,'{text}',operation->'text') else z end) from jsonb_array_elements(next_profile->'entries') z)); end if;
        entry_indexes:=entry_indexes||to_jsonb(operation_index-1); profile_changed:=true; entries_changed:=true;
      end if;
    end loop;
  end if;
  -- Writes happen only after the complete proposal has passed validation.
  for evidence in select value from jsonb_array_elements(evolution->'authorizedEvidence') loop insert into private.world_resident_mutation_evidence(job_id,save_id,instance_id,evidence_key,provenance,source_fingerprint,detail) values(job.id,settlement.save_id,resident_id,evidence->>'id',evidence->>'kind',evidence->>'sourceFingerprint',evidence); end loop;
  for change in select value from jsonb_array_elements(p_proposal->'dimensionChanges') loop insert into private.world_resident_pressure_history(job_id,instance_id,dimension_key,pressure_before,pressure_added,pressure_after) select job.id,resident_id,change->>'dimensionKey',coalesce((profile.pressure->>(change->>'dimensionKey'))::integer,0),round(scale*(d->>'volatility')::numeric)::integer*(change->>'direction')::integer,(next_pressure->>(change->>'dimensionKey'))::integer from jsonb_array_elements(pin.schema->'dimensions') d where d->>'key'=change->>'dimensionKey'; end loop;
  if changed then
    for operation in select value from jsonb_array_elements(p_proposal->'beliefOperations') loop
      if operation->>'operation'='add' then insert into private.world_resident_beliefs(instance_id,fingerprint,statement,confidence,provenance,subject_key,provenance_chain,original_claim_fingerprint) values(resident_id,encode(extensions.digest(private.world_canonical_json(operation),'sha256'),'hex'),operation->>'content',(operation->>'confidence')::integer,'inference',operation->>'subjectEntityId',operation->'provenance',operation->>'originalClaimFingerprint') returning id into belief_id; insert into private.world_resident_belief_history(belief_id,event_kind,detail) values(belief_id,'created',operation); else belief_id:=(operation->>'beliefId')::uuid; insert into private.world_resident_belief_history(belief_id,event_kind,detail) values(belief_id,'retired',operation); update private.world_resident_beliefs set active=false,contradiction_status='retracted',retired_at=clock_timestamp() where id=belief_id; end if;
    end loop;
    effect_ordinal:=0; for effect in select value from jsonb_array_elements(p_proposal->'worldEffects') loop effect_ordinal:=effect_ordinal+1; target_id:=(effect->>'objectEntityId')::uuid; insert into private.world_social_edges(save_id,from_instance_id,to_instance_id,evidence_refs) values(settlement.save_id,resident_id,target_id,p_proposal->'evidenceIds') on conflict do nothing; execute format('update private.world_social_edges set %I=greatest(-100,least(100,%I+$1)), evidence_refs=$2, updated_at=clock_timestamp() where save_id=$3 and from_instance_id=$4 and to_instance_id=$5',effect->>'axis',effect->>'axis') using (effect->>'delta')::integer,p_proposal->'evidenceIds',settlement.save_id,resident_id,target_id; insert into private.world_social_effect_receipts(job_id,ordinal,input_fingerprint,payload) values(job.id,effect_ordinal,encode(extensions.digest(private.world_canonical_json(effect),'sha256'),'hex'),effect); end loop;
  end if;
  if profile_changed then insert into private.world_resident_personality_ledger(instance_id,profile_revision,receipt_key,delta,evidence_refs) values(resident_id,profile.profile_revision+1,job.id,jsonb_build_object('proposalFingerprint',p_proposal_fingerprint,'dimensions',dimensions_receipt,'entryIndexes',entry_indexes),p_proposal->'evidenceIds'); update private.world_resident_profiles set current_profile=next_profile,pressure=next_pressure,profile_revision=profile.profile_revision+1,updated_at=clock_timestamp() where instance_id=resident_id; else update private.world_resident_profiles set pressure=next_pressure,updated_at=clock_timestamp() where instance_id=resident_id; end if;
  canonical := private.world_canonical_json(p_proposal);
  insert into private.world_resident_mutation_receipts(job_id,proposal_fingerprint,canonical_proposal,public_digest,result) values(job.id,p_proposal_fingerprint,canonical,trim(p_public_digest),jsonb_build_object('status','completed','rulesVersion','evolving-world-v1','outcome',case when not any_crossed then 'pressure_only' when changed then 'changed' else 'roll_failed' end,'applied',changed,'chancePercent',chance,'roll',roll,'dimensions',dimensions_receipt,'appliedEntryOperationIndexes',entry_indexes,'publicDigest',trim(p_public_digest))) returning result into checkpoint;
  update private.world_settlements set public_digest=trim(p_public_digest) where id=settlement.id;
  insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(settlement.id,job.id,'mutation:'||job.id::text,checkpoint) on conflict do nothing;
  perform public.world_settlement_complete(settlement.id,job.id,p_fence,checkpoint);
  return checkpoint;
end $function$;

revoke all on function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) to service_role;

commit;
