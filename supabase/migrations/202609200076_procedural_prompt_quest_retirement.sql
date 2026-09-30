-- Align the immutable procedural prompt release with the canonical quest
-- authority introduced by issue #31. Existing pinned work keeps its original
-- release; newly-created work cannot ask the general procedural lane to create
-- or update quests.
begin;

create temporary table issue31_procedural_prompts(
  prompt_key text primary key,
  body text not null
) on commit drop;

insert into issue31_procedural_prompts(prompt_key,body) values
  ('procedural.proposer','Create one bounded procedural-world-v1 proposal from the exact frozen five-field context. entityKinds is frozen public canon; capabilities are the only authority for effects, owners, and targets. Use only entity, public-event, and gameplay-unlock commands backed by registered primitives, template keys, archetype keys, capabilities, and frozen entity or resident IDs. Quest creation and quest updates belong exclusively to the canonical quest-transition workflow and are forbidden here. Do not invent IDs, primitives, code, routes, tools, executable payload keys, or unsupported operations. Never claim effects were applied. Put the complete command proposal JSON in proposalJson.'),
  ('procedural.critic','Independently review the supplied procedural-world proposal against its exact frozen context. Keep public canon and capability envelopes separate and authoritative. Permit only finite entity, public-event, and gameplay-unlock commands that validate against frozen IDs, registries, capabilities, and the generated-entity budget. Reject every quest command because canonical quest transitions are the sole quest authority. Do not authorize invented primitives, IDs, code, routes, tools, or effects. Return only {decision:"accept"|"reject"|"repair",instructions:[{code,path}]}; accept/reject uses [] and repair uses one to four closed pairs.'),
  ('procedural.repair','Repair the supplied procedural-world proposal only according to its closed critic instructions and the exact frozen context. Do not add quests, command families, owners, targets, entity IDs, primitives, template keys, archetypes, capabilities, or effects not already authorized by the frozen context. Do not emit code, routes, tools, executable payload keys, or claims that effects were applied. Put the complete repaired command proposal JSON in proposalJson.'),
  ('procedural.final_critic','Independently accept or reject the repaired procedural-world proposal against the exact frozen context. Verify every finite entity, public-event, or gameplay-unlock command, capability, registered primitive/template/archetype, frozen ID, and generated-entity budget. Reject all quest commands, invented IDs, primitives, code, routes, tools, and claims of applied effects. Return only {decision:"accept"|"reject",instructions:[]}. Repair is forbidden.');

insert into private.prompt_revisions(
  prompt_key,revision_number,body,content_hash,contract_id,contract_hash,
  prompt_type,parent_revision_id,change_note
)
select
  seed.prompt_key,
  (select coalesce(max(existing.revision_number),0)+1 from private.prompt_revisions existing where existing.prompt_key=seed.prompt_key),
  seed.body,
  encode(extensions.digest(convert_to(seed.body,'utf8'),'sha256'),'hex'),
  manifest.contract_id,
  manifest.contract_hash,
  manifest.prompt_type,
  active_entry.revision_id,
  'Retire general procedural quest authority in favor of canonical quest transitions'
from issue31_procedural_prompts seed
join private.prompt_registry_manifest manifest on manifest.prompt_key=seed.prompt_key
join private.prompt_registry_active_release active on active.singleton
join private.prompt_release_entries active_entry
  on active_entry.release_id=active.release_id and active_entry.prompt_key=seed.prompt_key;

insert into private.prompt_releases(label,prior_release_id,reason)
select
  'Issue 31 canonical quest authority',
  active.release_id,
  'Prevent the general procedural workflow from creating or updating quests'
from private.prompt_registry_active_release active
where active.singleton;

insert into private.prompt_release_entries(release_id,prompt_key,revision_id)
select
  release.id,
  manifest.prompt_key,
  coalesce(latest_revision.id,prior_entry.revision_id)
from private.prompt_releases release
join private.prompt_registry_manifest manifest on true
join private.prompt_release_entries prior_entry
  on prior_entry.release_id=release.prior_release_id and prior_entry.prompt_key=manifest.prompt_key
left join lateral (
  select revision.id
  from private.prompt_revisions revision
  where revision.prompt_key=manifest.prompt_key
    and exists(select 1 from issue31_procedural_prompts seed where seed.prompt_key=revision.prompt_key)
  order by revision.revision_number desc
  limit 1
) latest_revision on true
where release.label='Issue 31 canonical quest authority';

update private.prompt_registry_active_release
set release_id=(select id from private.prompt_releases where label='Issue 31 canonical quest authority'),
    updated_at=clock_timestamp()
where singleton;

insert into private.prompt_governance_audit(
  event_kind,release_id,prior_release_id,reason,warning_codes
)
select
  'release_activated',release.id,release.prior_release_id,
  'Retire general procedural quest authority in favor of canonical quest transitions',
  '{}'::text[]
from private.prompt_releases release
where release.label='Issue 31 canonical quest authority';

commit;
