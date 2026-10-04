-- Issue #30: V2 community review is a server-owned publication boundary.
-- A submitted sheet contains authored character material only.  Reviewers select
-- capability option IDs from the registry; the database derives and freezes the
-- package that the runtime will later materialize.
begin;

create table private.npc_v2_review_candidates (
  version_id uuid primary key references private.npc_versions(id) on delete restrict,
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  frozen_sheet jsonb not null,
  frozen_sheet_hash text not null check(frozen_sheet_hash ~ '^[a-f0-9]{64}$'),
  definition_hash text not null check(definition_hash ~ '^[a-f0-9]{64}$'),
  personality_schema jsonb not null,
  initial_profile jsonb not null,
  appearance_spec jsonb not null,
  capability_registry_version text not null check(capability_registry_version='community-capability-options-v1'),
  offered_option_ids text[] not null,
  candidate_hash text not null unique check(candidate_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(npc_id,version_id) references private.npc_versions(npc_id,id) on delete restrict,
  check(jsonb_typeof(frozen_sheet)='object' and frozen_sheet->>'schemaVersion'='npc-sheet-v2'),
  check(jsonb_typeof(personality_schema)='object' and jsonb_typeof(initial_profile)='object' and jsonb_typeof(appearance_spec)='object')
);

create table private.npc_v2_review_decisions (
  version_id uuid primary key references private.npc_versions(id) on delete restrict,
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check(decision in ('approve','reject','request_changes')),
  notes text not null default '',
  capability_registry_version text,
  capability_option_ids text[] not null default '{}',
  resolved_options_hash text,
  candidate_hash text not null check(candidate_hash ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz not null default clock_timestamp(),
  foreign key(npc_id,version_id) references private.npc_versions(npc_id,id) on delete restrict,
  check((decision='approve' and capability_registry_version='community-capability-options-v1' and cardinality(capability_option_ids)>0 and resolved_options_hash ~ '^[a-f0-9]{64}$')
    or (decision <> 'approve' and capability_registry_version is null and cardinality(capability_option_ids)=0 and resolved_options_hash is null))
);

create function private.npc_v2_review_candidate_hash(
  p_npc_id uuid,p_version_id uuid,p_sheet_hash text,p_definition_hash text,
  p_schema jsonb,p_profile jsonb,p_appearance jsonb,p_registry_version text,p_option_ids text[]
) returns text language sql immutable strict set search_path='' as $f$
  select encode(extensions.digest(private.world_canonical_json(jsonb_build_object(
    'appearance',p_appearance,
    'definitionHash',p_definition_hash,
    'npcId',p_npc_id,
    'offeredOptionIds',to_jsonb(array(select unnest(coalesce(p_option_ids,'{}'::text[])) order by 1)),
    'personalitySchema',p_schema,
    'profile',p_profile,
    'registryVersion',p_registry_version,
    'sheetHash',p_sheet_hash,
    'versionId',p_version_id
  )),'sha256'),'hex')
$f$;

create function private.npc_v2_review_options() returns jsonb language sql stable security definer set search_path='' as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',option_id,'kind',option_kind,'value',option_value,'targetKinds',to_jsonb(target_kinds)
  ) order by option_id),'[]'::jsonb)
  from private.npc_capability_option_registry
  where registry_version='community-capability-options-v1'
$f$;

create function private.npc_v2_review_campaign_options_covered(
  p_sheet jsonb,p_registry_version text,p_option_ids text[]
) returns boolean language plpgsql stable security definer set search_path='' as $f$
declare required_actions text[]; required_approaches text[]; available jsonb;
begin
  select coalesce(array_agg(distinct step->>'action' order by step->>'action'),'{}'::text[]) into required_actions
  from jsonb_array_elements(coalesce(p_sheet#>'{campaign,milestones}','[]'::jsonb)) milestone
  cross join lateral jsonb_array_elements(coalesce(milestone->'startingPlan','[]'::jsonb)) step;
  select coalesce(array_agg(distinct step->>'approach' order by step->>'approach'),'{}'::text[]) into required_approaches
  from jsonb_array_elements(coalesce(p_sheet#>'{campaign,milestones}','[]'::jsonb)) milestone
  cross join lateral jsonb_array_elements(coalesce(milestone->'startingPlan','[]'::jsonb)) step;
  available:=private.npc_resolve_capability_options(p_registry_version,p_option_ids);
  return required_actions <@ coalesce(array(select jsonb_array_elements_text(available->'allowedActions')),'{}'::text[])
    and required_approaches <@ coalesce(array(select jsonb_array_elements_text(available->'allowedApproaches')),'{}'::text[]);
end $f$;

create function private.npc_v2_review_candidate_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare
  v private.npc_versions;
  d jsonb;
  offered text[];
  expected_hash text;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode='55000',message='V2 review candidates are immutable';
  end if;
  select * into v from private.npc_versions where id=new.version_id and npc_id=new.npc_id;
  if not found or v.state <> 'submitted' or v.schema_version <> 'npc-sheet-v2'
    or v.sheet_hash <> new.frozen_sheet_hash or v.sheet <> new.frozen_sheet then
    raise exception using errcode='23514',message='V2 review candidate must freeze one submitted V2 version';
  end if;
  d:=private.npc_derive_v2_resident_definition(v.sheet);
  if new.personality_schema<>d->'personalitySchema' or new.initial_profile<>d->'initialProfile'
    or new.appearance_spec<>d->'appearance'
    or new.definition_hash<>private.npc_resident_definition_hash(d->'personalitySchema',d->'initialProfile',d->'appearance','{}'::jsonb) then
    -- The definition hash has no capabilities at candidate time.  Its value is
    -- deliberately recomputed at approval with the reviewer-selected envelope.
    raise exception using errcode='23514',message='V2 review candidate definition does not match its frozen sheet';
  end if;
  select coalesce(array_agg(option_id order by option_id),'{}'::text[]) into offered
  from private.npc_capability_option_registry where registry_version='community-capability-options-v1';
  if new.capability_registry_version<>'community-capability-options-v1' or new.offered_option_ids<>offered then
    raise exception using errcode='23514',message='V2 review candidate must use the current server-issued option registry';
  end if;
  expected_hash:=private.npc_v2_review_candidate_hash(new.npc_id,new.version_id,new.frozen_sheet_hash,new.definition_hash,new.personality_schema,new.initial_profile,new.appearance_spec,new.capability_registry_version,new.offered_option_ids);
  if new.candidate_hash<>expected_hash then
    raise exception using errcode='23514',message='V2 review candidate hash does not match frozen content';
  end if;
  return new;
end $f$;
create trigger npc_v2_review_candidates_immutable
  before insert or update or delete on private.npc_v2_review_candidates
  for each row execute function private.npc_v2_review_candidate_guard();

create function private.npc_v2_review_decision_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare c private.npc_v2_review_candidates; resolved jsonb; offered text[];
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode='55000',message='V2 review decisions are immutable';
  end if;
  select * into c from private.npc_v2_review_candidates where version_id=new.version_id and npc_id=new.npc_id;
  if not found or new.candidate_hash<>c.candidate_hash then
    raise exception using errcode='23514',message='V2 review decision must name its frozen candidate';
  end if;
  if private.npc_was_ever_owner(new.npc_id,new.reviewer_id) then
    raise exception using errcode='42501',message='Current and former owners cannot review this identity';
  end if;
  if new.decision='approve' then
    if not(new.capability_option_ids <@ c.offered_option_ids) then
      raise exception using errcode='23514',message='Approval options must come from the server-issued candidate choices';
    end if;
    resolved:=private.npc_resolve_capability_options(new.capability_registry_version,new.capability_option_ids);
    if new.resolved_options_hash<>encode(extensions.digest(private.world_canonical_json(resolved),'sha256'),'hex') then
      raise exception using errcode='23514',message='Approval resolved options hash does not match server resolution';
    end if;
  end if;
  return new;
end $f$;
create trigger npc_v2_review_decisions_immutable
  before insert or update or delete on private.npc_v2_review_decisions
  for each row execute function private.npc_v2_review_decision_guard();

create function private.npc_v2_review_ensure_candidate(p_version_id uuid)
returns private.npc_v2_review_candidates language plpgsql security definer set search_path='' as $f$
declare v private.npc_versions; derived jsonb; offered text[]; candidate_definition_hash text; candidate_hash text; c private.npc_v2_review_candidates;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted' for key share;
  if not found then raise sqlstate 'PT404' using message='Submitted V2 version not found'; end if;
  if v.schema_version<>'npc-sheet-v2' or v.sheet->>'schemaVersion'<>'npc-sheet-v2' then
    raise sqlstate 'PT422' using message='Reviewer publication requires npc-sheet-v2';
  end if;
  derived:=private.npc_derive_v2_resident_definition(v.sheet);
  -- A candidate is intentionally capability-free.  The frozen definition hash
  -- binds only authored material; a package hash later binds reviewer choices.
  candidate_definition_hash:=private.npc_resident_definition_hash(derived->'personalitySchema',derived->'initialProfile',derived->'appearance','{}'::jsonb);
  select coalesce(array_agg(option_id order by option_id),'{}'::text[]) into offered
  from private.npc_capability_option_registry where registry_version='community-capability-options-v1';
  candidate_hash:=private.npc_v2_review_candidate_hash(v.npc_id,v.id,v.sheet_hash,candidate_definition_hash,derived->'personalitySchema',derived->'initialProfile',derived->'appearance','community-capability-options-v1',offered);
  insert into private.npc_v2_review_candidates(version_id,npc_id,frozen_sheet,frozen_sheet_hash,definition_hash,personality_schema,initial_profile,appearance_spec,capability_registry_version,offered_option_ids,candidate_hash)
  values(v.id,v.npc_id,v.sheet,v.sheet_hash,candidate_definition_hash,derived->'personalitySchema',derived->'initialProfile',derived->'appearance','community-capability-options-v1',offered,candidate_hash)
  on conflict(version_id) do nothing;
  select * into c from private.npc_v2_review_candidates where version_id=v.id;
  return c;
end $f$;

create function private.npc_v2_review_prospective_package(p_candidate private.npc_v2_review_candidates,p_option_ids text[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare ids text[]; envelope jsonb; resolved_hash text; definition_hash text; terminal text[]; package_hash text;
begin
  ids:=array(select unnest(coalesce(p_option_ids,'{}'::text[])) order by 1);
  envelope:=case when cardinality(ids)=0 then null else private.npc_resolve_capability_options(p_candidate.capability_registry_version,ids) end;
  if envelope is null then
    return jsonb_build_object('candidateHash',p_candidate.candidate_hash,'state','awaiting_option_selection','sourceKind','community','registryVersion',p_candidate.capability_registry_version);
  end if;
  resolved_hash:=encode(extensions.digest(private.world_canonical_json(envelope),'sha256'),'hex');
  definition_hash:=private.npc_resident_definition_hash(p_candidate.personality_schema,p_candidate.initial_profile,p_candidate.appearance_spec,envelope);
  select coalesce(array_agg(distinct loss->>'kind' order by loss->>'kind'),'{}'::text[]) into terminal
  from jsonb_array_elements(coalesce(p_candidate.frozen_sheet#>'{campaign,milestones}','[]'::jsonb)) milestone
  cross join lateral jsonb_array_elements(case when jsonb_typeof(milestone->'permanentLoss')='object' then jsonb_build_array(milestone->'permanentLoss') else '[]'::jsonb end) loss
  where loss->>'kind' in ('dead','departed');
  package_hash:=private.npc_resident_package_hash(p_candidate.npc_id,p_candidate.version_id,'community',null,p_candidate.frozen_sheet_hash,definition_hash,p_candidate.personality_schema,p_candidate.initial_profile,p_candidate.appearance_spec,envelope,p_candidate.capability_registry_version,ids,resolved_hash,terminal);
  return jsonb_build_object('candidateHash',p_candidate.candidate_hash,'sourceKind','community','registryVersion',p_candidate.capability_registry_version,
    'optionIds',to_jsonb(ids),'capabilityEnvelope',envelope,'resolvedOptionsHash',resolved_hash,'definitionHash',definition_hash,
    'terminalOutcomes',to_jsonb(terminal),'packageHash',package_hash);
end $f$;

drop function if exists public.npc_reviewer_decide(uuid,text,text,text);
create function public.npc_reviewer_decide(
  p_version_id uuid,p_decision text,p_notes text default '',p_rating text default null,p_option_ids text[] default null
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare c private.npc_v2_review_candidates; v private.npc_versions; proposed jsonb; ids text[]; owner uuid;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted' for update;
  if not found then raise sqlstate 'PT404' using message='Submitted V2 version not found'; end if;
  perform private.assert_npc_reviewer(v.npc_id);
  if p_decision not in ('approve','reject','request_changes') or p_rating is not null then
    raise sqlstate 'PT400' using message='V2 review requires an approve, reject, or request-changes decision; ratings are authored content';
  end if;
  c:=private.npc_v2_review_ensure_candidate(p_version_id);
  ids:=array(select unnest(coalesce(p_option_ids,'{}'::text[])) order by 1);
  if p_decision='approve' then
    if cardinality(ids)=0 then raise sqlstate 'PT422' using message='An approval requires reviewer-selected capability option IDs'; end if;
    if not(ids <@ c.offered_option_ids) then raise sqlstate 'PT400' using message='Choose only capability option IDs issued with this review candidate'; end if;
    if not private.npc_v2_review_campaign_options_covered(c.frozen_sheet,c.capability_registry_version,ids) then
      raise sqlstate 'PT422' using message='Approval options must cover every authored campaign action and approach';
    end if;
    proposed:=private.npc_v2_review_prospective_package(c,ids);
    insert into private.npc_v2_review_decisions(version_id,npc_id,reviewer_id,decision,notes,capability_registry_version,capability_option_ids,resolved_options_hash,candidate_hash)
      values(v.id,v.npc_id,auth.uid(),'approve',coalesce(p_notes,''),c.capability_registry_version,ids,proposed->>'resolvedOptionsHash',c.candidate_hash);
  else
    if cardinality(ids)>0 then raise sqlstate 'PT400' using message='Only approvals accept capability option IDs'; end if;
    insert into private.npc_v2_review_decisions(version_id,npc_id,reviewer_id,decision,notes,candidate_hash)
      values(v.id,v.npc_id,auth.uid(),p_decision,coalesce(p_notes,''),c.candidate_hash);
    select user_id into owner from private.npc_identity_owners where npc_id=v.npc_id and ended_at is null;
    update private.npc_versions set state='rejected' where id=v.id;
    update private.npc_identities set status=case when p_decision='request_changes' then 'changes_requested' else 'rejected' end,updated_at=clock_timestamp() where id=v.npc_id;
    if owner is not null then
      insert into private.npc_notifications(user_id,kind,payload) values(owner,'review_decision',jsonb_build_object('npcId',v.npc_id,'versionId',v.id,'decision',p_decision,'notes',coalesce(p_notes,'')));
    end if;
  end if;
  return jsonb_build_object('versionId',v.id,'npcId',v.npc_id,'decision',p_decision,'candidateHash',c.candidate_hash,
    'prospectivePackage',case when p_decision='approve' then proposed else null end);
end $f$;

create or replace function public.npc_reviewer_submission(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare c private.npc_v2_review_candidates; v private.npc_versions;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted';
  if not found then raise sqlstate 'PT404' using message='Submitted V2 version not found'; end if;
  perform private.assert_npc_reviewer(v.npc_id);
  c:=private.npc_v2_review_ensure_candidate(p_version_id);
  return jsonb_build_object(
    'npcId',v.npc_id,'versionId',v.id,'sheet',c.frozen_sheet,'frozenSheetHash',c.frozen_sheet_hash,
    'evolutionPreview',jsonb_build_object('personalitySchema',c.personality_schema,'initialProfile',c.initial_profile,'appearance',c.appearance_spec),
    'optionRegistryVersion',c.capability_registry_version,'optionChoices',private.npc_v2_review_options(),
    'candidateHash',c.candidate_hash,'prospectivePackage',private.npc_v2_review_prospective_package(c,null),
    'evaluation',(select jsonb_build_object('status',status,'result',result) from private.npc_evaluations where version_id=v.id),
    'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sectionPath',section_path,'body',body,'resolvedAt',resolved_at,'createdAt',created_at) order by created_at),'[]'::jsonb) from private.npc_section_comments where version_id=v.id)
  );
end $f$;

create or replace function public.npc_reviewer_publish(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v private.npc_versions; c private.npc_v2_review_candidates; d private.npc_v2_review_decisions; prospective jsonb; package_id uuid; owner uuid;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted' for update;
  if not found then raise sqlstate 'PT404' using message='Submitted V2 version not found'; end if;
  perform private.assert_npc_reviewer(v.npc_id);
  select * into c from private.npc_v2_review_candidates where version_id=v.id;
  select * into d from private.npc_v2_review_decisions where version_id=v.id and decision='approve';
  if not found or c is null then raise sqlstate 'PT422' using message='A V2 review approval with a frozen candidate is required'; end if;
  if d.candidate_hash<>c.candidate_hash or c.frozen_sheet_hash<>v.sheet_hash or c.frozen_sheet<>v.sheet then
    raise sqlstate 'PT409' using message='Review candidate no longer matches the submitted V2 version';
  end if;
  if not private.npc_v2_review_campaign_options_covered(c.frozen_sheet,c.capability_registry_version,d.capability_option_ids) then
    raise sqlstate 'PT422' using message='Approved options no longer cover the authored campaign';
  end if;
  prospective:=private.npc_v2_review_prospective_package(c,d.capability_option_ids);
  if prospective->>'resolvedOptionsHash'<>d.resolved_options_hash then
    raise sqlstate 'PT409' using message='Reviewer option resolution no longer matches its approval';
  end if;
  insert into private.npc_version_resident_packages(
    npc_id,version_id,source_kind,frozen_sheet_hash,definition_hash,personality_schema,initial_profile,appearance_spec,
    capability_envelope,capability_registry_version,capability_option_ids,resolved_options_hash,terminal_outcomes,reviewer_id,published_by,package_hash
  ) values(
    v.npc_id,v.id,'community',c.frozen_sheet_hash,prospective->>'definitionHash',c.personality_schema,c.initial_profile,c.appearance_spec,
    prospective->'capabilityEnvelope',c.capability_registry_version,d.capability_option_ids,d.resolved_options_hash,
    array(select jsonb_array_elements_text(prospective->'terminalOutcomes')),d.reviewer_id,auth.uid(),prospective->>'packageHash'
  ) returning id into package_id;
  update private.npc_versions set state='published',published_at=clock_timestamp() where id=v.id;
  update private.npc_identities set status='published',current_published_version_id=v.id,updated_at=clock_timestamp() where id=v.npc_id;
  select user_id into owner from private.npc_identity_owners where npc_id=v.npc_id and ended_at is null;
  if owner is not null then
    insert into private.npc_notifications(user_id,kind,payload) values(owner,'published',jsonb_build_object('npcId',v.npc_id,'versionId',v.id,'packageId',package_id));
  end if;
  return jsonb_build_object('npcId',v.npc_id,'versionId',v.id,'state','published','packageId',package_id,'packageHash',prospective->>'packageHash');
end $f$;

revoke all on table private.npc_v2_review_candidates,private.npc_v2_review_decisions from public,anon,authenticated,service_role;
revoke all on function private.npc_v2_review_candidate_hash(uuid,uuid,text,text,jsonb,jsonb,jsonb,text,text[]),private.npc_v2_review_options(),private.npc_v2_review_campaign_options_covered(jsonb,text,text[]),private.npc_v2_review_ensure_candidate(uuid),private.npc_v2_review_prospective_package(private.npc_v2_review_candidates,text[]) from public,anon,authenticated,service_role;
revoke all on function public.npc_reviewer_submission(uuid),public.npc_reviewer_decide(uuid,text,text,text,text[]),public.npc_reviewer_publish(uuid) from public,anon;
grant execute on function public.npc_reviewer_submission(uuid),public.npc_reviewer_decide(uuid,text,text,text,text[]),public.npc_reviewer_publish(uuid) to authenticated;

commit;
