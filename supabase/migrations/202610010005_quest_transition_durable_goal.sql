-- Preserve the exact campaign goal from the quest's pinned author version.
-- This changes future terminal snapshots only; existing snapshots and checkpoints stay unchanged.
begin;

create or replace function private.world_quest_transition_context(p_quest private.world_quests,p_terminal_event private.world_quest_events)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_sheet jsonb; v_package jsonb; v_profile jsonb; v_context jsonb; v_targets jsonb; v_history jsonb; v_dialogue jsonb; v_beliefs jsonb; v_edges jsonb; v_actions jsonb; v_approaches jsonb; v_effects jsonb; v_constraints jsonb; v_quest_targets jsonb; v_capabilities jsonb; v_milestone jsonb;
begin
  select version.sheet into v_sheet from private.npc_versions version where version.id=p_quest.version_id;
  select package.capability_envelope into v_package from private.npc_version_resident_packages package where package.id=p_quest.package_id;
  select profile.current_profile into v_profile from private.world_resident_profiles profile where profile.instance_id=p_quest.instance_id;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into v_actions from jsonb_array_elements(coalesce(v_package->'allowedActions','[]'::jsonb)) with ordinality source(value,ordinal) where ordinal<=16 and jsonb_typeof(value)='string' and octet_length(value#>>'{}')<=64;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into v_approaches from jsonb_array_elements(coalesce(v_package->'allowedApproaches','[]'::jsonb)) with ordinality source(value,ordinal) where ordinal<=16 and jsonb_typeof(value)='string' and octet_length(value#>>'{}')<=64;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into v_effects from jsonb_array_elements(coalesce(v_package->'allowedWorldEffects','[]'::jsonb)) with ordinality source(value,ordinal) where ordinal<=16 and jsonb_typeof(value)='string' and octet_length(value#>>'{}')<=64;
  v_capabilities:=private.world_quest_transition_capability_flags(v_package,v_effects)||jsonb_build_object('allowedActions',v_actions,'allowedApproaches',v_approaches,'allowedWorldEffects',v_effects);
  select coalesce(jsonb_agg(to_jsonb(private.world_quest_transition_trim(item,512)) order by ordinal),'[]'::jsonb) into v_constraints from unnest(p_quest.constraints) with ordinality source(item,ordinal) where ordinal<=6;
  select coalesce(jsonb_agg(to_jsonb(item) order by ordinal),'[]'::jsonb) into v_quest_targets from unnest(p_quest.target_refs) with ordinality source(item,ordinal) where ordinal<=24 and octet_length(item)<=120;
  select coalesce(jsonb_agg(jsonb_build_object('id',target.id,'ref',target.ref,'kind',target.kind) order by target.kind,target.ref,target.id),'[]'::jsonb) into v_targets
  from (
    select distinct on (candidate.ref) candidate.id,candidate.ref,candidate.kind from (
      select quest_target as id,quest_target as ref,'quest_target'::text as kind from unnest(p_quest.target_refs) quest_target
      union all
      select entity.id::text,entity.entity_key,entity.entity_kind from private.world_canonical_entities entity join private.npc_version_resident_packages package on package.id=p_quest.package_id
      where entity.save_id=p_quest.save_id and entity.lifecycle='active' and package.capability_envelope->'allowedTargetKinds' ? entity.entity_kind
    ) candidate where octet_length(candidate.id)<=120 and octet_length(candidate.ref)<=120 and octet_length(candidate.kind)<=64 order by candidate.ref,case when candidate.kind='quest_target' then 0 else 1 end,candidate.id limit 24
  ) target;
  select coalesce(jsonb_agg(jsonb_build_object('id',history.id,'day',history.day_number,'step',history.step_index,'action',private.world_quest_transition_trim(history.action,64),'approach',private.world_quest_transition_trim(history.approach,64),'outcome',history.outcome,'text',private.world_quest_transition_trim(history.narration,256),'publicNews',history.public_news) order by history.day_number,history.step_index,history.id),'[]'::jsonb) into v_history
  from (select * from private.world_quest_events where quest_id=p_quest.id order by day_number desc,step_index desc,id desc limit 16) history;
  select coalesce(jsonb_agg(jsonb_build_object('id',turn.id,'day',turn.day_number,'sequence',turn.input_sequence,'result',private.world_quest_transition_trim(turn.result::text,512)) order by turn.day_number,turn.input_sequence,turn.id),'[]'::jsonb) into v_dialogue
  from (select * from private.world_npc_dialogue_turns where instance_id=p_quest.instance_id and status='completed' order by day_number desc,input_sequence desc,id desc limit 4) turn;
  select coalesce(jsonb_agg(jsonb_build_object('fingerprint',belief.fingerprint,'statement',private.world_quest_transition_trim(belief.statement,256),'confidence',belief.confidence,'provenance',private.world_quest_transition_trim(belief.provenance::text,128),'subject',belief.subject_key) order by belief.confidence desc,belief.fingerprint),'[]'::jsonb) into v_beliefs
  from (select * from private.world_resident_beliefs where instance_id=p_quest.instance_id and active and octet_length(fingerprint)<=120 and octet_length(subject_key)<=120 order by confidence desc,fingerprint limit 4) belief;
  select coalesce(jsonb_agg(jsonb_build_object('from',edge.from_instance_id,'to',edge.to_instance_id,'trust',edge.trust,'affection',edge.affection,'respect',edge.respect,'fear',edge.fear,'obligation',edge.obligation) order by edge.from_instance_id,edge.to_instance_id),'[]'::jsonb) into v_edges
  from (select * from private.world_social_edges where save_id=p_quest.save_id and (from_instance_id=p_quest.instance_id or to_instance_id=p_quest.instance_id) order by updated_at desc,from_instance_id,to_instance_id limit 8) edge;
  if p_quest.origin='authored_milestone' then
    v_milestone:=private.world_quest_transition_next_authored_milestone(v_sheet,p_quest.authored_milestone_index);
  else
    v_milestone:='null'::jsonb;
  end if;
  v_context:=jsonb_build_object(
    'quest',jsonb_build_object('id',p_quest.id,'saveId',p_quest.save_id,'instanceId',p_quest.instance_id,'versionId',p_quest.version_id,'packageId',p_quest.package_id,'packageHash',p_quest.package_hash,'origin',p_quest.origin,'title',private.world_quest_transition_trim(p_quest.title,512),'objective',private.world_quest_transition_trim(p_quest.objective,2048),'motivation',private.world_quest_transition_trim(p_quest.motivation,2048),'constraints',v_constraints,'targetRefs',v_quest_targets,'difficulty',p_quest.difficulty,'terminalDay',p_quest.terminal_day),
    'terminalEvent',jsonb_build_object('id',p_terminal_event.id,'day',p_terminal_event.day_number,'step',p_terminal_event.step_index,'action',p_terminal_event.action,'approach',p_terminal_event.approach,'outcome',p_terminal_event.outcome,'text',private.world_quest_transition_trim(p_terminal_event.narration,2048),'publicNews',p_terminal_event.public_news),
    'eventHistory',v_history,
    'versionSheet',jsonb_build_object('durableGoal',v_sheet#>'{campaign,durableGoal}','name',private.world_quest_transition_trim(coalesce(v_sheet->>'name',''),512),'identity',private.world_quest_transition_trim(coalesce((v_sheet->'identity')::text,''),4096),'personality',private.world_quest_transition_trim(coalesce((v_sheet->'personality')::text,''),4096),'lore',private.world_quest_transition_trim(coalesce((v_sheet->'lore')::text,''),4096),'boundaries',private.world_quest_transition_trim(coalesce((v_sheet->'boundaries')::text,''),4096)),
    'capabilityEnvelope',v_capabilities,'registeredActions',v_actions,'registeredApproaches',v_approaches,'validCanonicalTargets',v_targets,
    'currentProfile',jsonb_build_object('summary',private.world_quest_transition_trim(coalesce(v_profile::text,''),8192)),
    'nextAuthoredMilestone',v_milestone,
    'dialogueEvidence',v_dialogue,'beliefs',v_beliefs,'socialEdges',v_edges);
  -- Optional evidence is removed whole, in priority order, until the snapshot fits.
  if octet_length(v_context::text)>65536 then v_context:=jsonb_set(v_context,'{dialogueEvidence}','[]'::jsonb); end if;
  if octet_length(v_context::text)>65536 then v_context:=jsonb_set(v_context,'{beliefs}','[]'::jsonb); end if;
  if octet_length(v_context::text)>65536 then v_context:=jsonb_set(v_context,'{socialEdges}','[]'::jsonb); end if;
  if octet_length(v_context::text)>65536 then v_context:=jsonb_set(v_context,'{currentProfile}',jsonb_build_object('summary','')); end if;
  if octet_length(v_context::text)>65536 then v_context:=jsonb_set(v_context,'{eventHistory}','[]'::jsonb); end if;
  return v_context;
end $function$;

revoke all on function private.world_quest_transition_context(private.world_quests,private.world_quest_events) from public,anon,authenticated;

commit;
