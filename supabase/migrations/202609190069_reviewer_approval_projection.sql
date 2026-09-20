begin;

-- Project the immutable approval already recorded for a submitted candidate so
-- the Review Desk can distinguish an approvable candidate from one that is
-- ready to publish. Publication still revalidates the decision and hashes.
create or replace function public.npc_reviewer_submission(p_version_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare
  c private.npc_v2_review_candidates;
  v private.npc_versions;
  d private.npc_v2_review_decisions;
  prospective jsonb;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted';
  if not found then raise sqlstate 'PT404' using message='Submitted V2 version not found'; end if;
  perform private.assert_npc_reviewer(v.npc_id);
  c:=private.npc_v2_review_ensure_candidate(p_version_id);
  select * into d from private.npc_v2_review_decisions where version_id=v.id and decision='approve';
  prospective:=case
    when found then private.npc_v2_review_prospective_package(c,d.capability_option_ids) || jsonb_build_object('state','approved')
    else private.npc_v2_review_prospective_package(c,null)
  end;
  return jsonb_build_object(
    'npcId',v.npc_id,'versionId',v.id,'sheet',c.frozen_sheet,'frozenSheetHash',c.frozen_sheet_hash,
    'evolutionPreview',jsonb_build_object('personalitySchema',c.personality_schema,'initialProfile',c.initial_profile,'appearance',c.appearance_spec),
    'optionRegistryVersion',c.capability_registry_version,'optionChoices',private.npc_v2_review_options(),
    'candidateHash',c.candidate_hash,'prospectivePackage',prospective,
    'evaluation',(select jsonb_build_object('status',status,'result',result) from private.npc_evaluations where version_id=v.id),
    'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sectionPath',section_path,'body',body,'resolvedAt',resolved_at,'createdAt',created_at) order by created_at),'[]'::jsonb) from private.npc_section_comments where version_id=v.id)
  );
end $f$;

commit;
