-- Release-pinned prompts for the independently fenced quest-transition worker.
begin;

alter table private.prompt_registry_manifest drop constraint if exists prompt_registry_manifest_prompt_key_check;
alter table private.prompt_registry_manifest add constraint prompt_registry_manifest_prompt_key_check check(prompt_key in (
  'dialogue.investigate','dialogue.deliberate','dialogue.speak','dialogue.review','dialogue.remember',
  'authoring.assist','authoring.sandbox','resident.proposer','resident.critic','resident.repair','resident.final_critic','resident.digest',
  'canon.proposer','canon.critic','canon.repair','canon.final_critic','social.proposer','social.critic','social.repair','social.final_critic',
  'procedural.proposer','procedural.critic','procedural.repair','procedural.final_critic',
  'quest_transition.proposer','quest_transition.critic','quest_transition.repair','quest_transition.final_critic',
  'image.community_portrait','image.runtime_art'));

insert into private.prompt_registry_manifest(prompt_key,display_name,purpose,prompt_type,contract_id,contract_hash,model_lane,workflow,template_variables)
values
  ('quest_transition.proposer','Quest transition proposal','Propose one bounded terminal quest transition.','text_system','quest-transition-v1','1db70e13929e8059bb414f5acf8f56f34a6c9933dea64358cfcda12af0a6d34a','world','quest_transition','{}'),
  ('quest_transition.critic','Quest transition critic','Check a terminal quest transition.','text_system','quest-transition-v1','1db70e13929e8059bb414f5acf8f56f34a6c9933dea64358cfcda12af0a6d34a','world','quest_transition','{}'),
  ('quest_transition.repair','Quest transition repair','Repair a terminal quest transition narrowly.','text_system','quest-transition-v1','1db70e13929e8059bb414f5acf8f56f34a6c9933dea64358cfcda12af0a6d34a','world','quest_transition','{}'),
  ('quest_transition.final_critic','Quest transition final critic','Approve or reject a repaired terminal transition.','text_system','quest-transition-v1','1db70e13929e8059bb414f5acf8f56f34a6c9933dea64358cfcda12af0a6d34a','world','quest_transition','{}');

with seeded(prompt_key,body) as (values
  ('quest_transition.proposer'::text,'Create one bounded quest-transition-v1 decision from the supplied frozen transition context. The terminalEventId and any next authored milestone are exact and immutable. If an authored milestone exists, choose only next_authored_milestone with its exact milestoneId; otherwise choose successor or self-departure only when the frozen capability allows it. A plan is one to three action/approach steps; only its final step may be attempt or abandon, and its final step must be attempt or abandon. Use only frozen target refs and allowed actions and approaches. Departure contains only privateRationale, farewellText, and publicNews; it cannot describe death or another resident. Never claim the decision was applied. Put the complete proposal JSON in proposalJson.'),
  ('quest_transition.critic'::text,'Independently review the supplied quest-transition-v1 proposal against the frozen transition context. Check the exact terminal event, frozen milestone branch, capability gates, frozen target refs, bounded difficulty and text, and terminal plan shape. Departure may concern only this resident and must not encode death. Do not reveal or repeat private frozen context beyond the bounded proposal. Return only {decision:"accept"|"reject"|"repair",instructions:[{code,path}]}; accept or reject uses [] and repair uses one to four closed pairs.'),
  ('quest_transition.repair'::text,'Repair the supplied quest-transition-v1 proposal only according to the critic’s closed code/path instructions and the frozen transition context. Preserve the exact terminal event and any frozen authored milestone ID. Use only allowed actions, approaches, and target refs. Keep plans to one to three steps ending in attempt or abandon. Do not introduce residents, targets, death, code, tools, routes, or claims that a transition was applied. Put the complete repaired proposal JSON in proposalJson.'),
  ('quest_transition.final_critic'::text,'Independently accept or reject the repaired quest-transition-v1 proposal against the frozen transition context. Verify exact terminal event and authored-milestone restrictions, frozen targets and capabilities, bounded successor fields, terminal plan shape, and self-only non-death departure. Do not request another repair, reveal private context, or claim the transition was applied. Return only {decision:"accept"|"reject",instructions:[]}. Repair is forbidden.')
)
insert into private.prompt_revisions(prompt_key,revision_number,body,content_hash,contract_id,contract_hash,prompt_type,change_note)
select seeded.prompt_key,1,seeded.body,encode(extensions.digest(seeded.body,'sha256'),'hex'),'quest-transition-v1','1db70e13929e8059bb414f5acf8f56f34a6c9933dea64358cfcda12af0a6d34a','text_system','Quest transition baseline' from seeded;

insert into private.prompt_releases(label,prior_release_id,reason)
select 'Quest transition prompt baseline',active.release_id,'Add complete quest-transition prompt workflow' from private.prompt_registry_active_release active;
insert into private.prompt_release_entries(release_id,prompt_key,revision_id)
select release.id,manifest.prompt_key,revision.id
from private.prompt_releases release
cross join private.prompt_registry_manifest manifest
join lateral (
  select coalesce(
    (select entry.revision_id from private.prompt_release_entries entry where entry.release_id=release.prior_release_id and entry.prompt_key=manifest.prompt_key),
    (select revision.id from private.prompt_revisions revision where revision.prompt_key=manifest.prompt_key and revision.revision_number=1)
  ) as revision_id
) source on true
join private.prompt_revisions revision on revision.id=source.revision_id
where release.label='Quest transition prompt baseline';
update private.prompt_registry_active_release set release_id=(select id from private.prompt_releases where label='Quest transition prompt baseline'),updated_at=clock_timestamp();

alter table private.world_quest_transitions add column if not exists prompt_release_id uuid references private.prompt_releases(id) on delete restrict;
update private.world_quest_transitions set prompt_release_id=(select release_id from private.prompt_registry_active_release where singleton) where prompt_release_id is null and status in ('awaiting','processing');
create trigger prompt_registry_pin_release before insert on private.world_quest_transitions for each row execute function private.prompt_registry_pin_active_release();

create or replace function public.prompt_registry_service_work_release(p_work_kind text,p_work_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare resolved uuid;
begin
  perform private.prompt_registry_assert_service();
  if p_work_kind='dialogue' then select prompt_release_id into resolved from private.world_npc_dialogue_turns where id=p_work_id;
  elsif p_work_kind='settlement' then select prompt_release_id into resolved from private.world_settlements where id=p_work_id;
  elsif p_work_kind='quest_transition' then select prompt_release_id into resolved from private.world_quest_transitions where id=p_work_id;
  elsif p_work_kind='authoring' then select prompt_release_id into resolved from private.npc_generation_jobs where id=p_work_id;
  elsif p_work_kind='portrait' then select prompt_release_id into resolved from private.npc_portrait_generation_attempts where id=p_work_id;
  elsif p_work_kind='runtime_art' then select prompt_release_id into resolved from private.world_runtime_art_jobs where id=p_work_id;
  else raise sqlstate 'PT400' using message='Unknown prompt work kind'; end if;
  if resolved is null then raise sqlstate 'PT503' using message='Prompt release was not pinned for this work'; end if;
  return resolved;
end $$;

commit;
