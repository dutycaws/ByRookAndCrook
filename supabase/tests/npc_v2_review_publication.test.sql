begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('private','npc_v2_review_candidates','V2 reviewer candidates freeze submitted sheets');
select has_table('private','npc_v2_review_decisions','V2 review decisions persist server-resolved choices');
select has_function('public','npc_reviewer_decide',array['uuid','text','text','text','text[]'],'reviewer decision accepts option IDs only in the V2 contract');

insert into auth.users(id,email,role,aud) values
  ('65000000-0000-4000-8000-000000000001','v2-review-author@example.test','authenticated','authenticated'),
  ('65000000-0000-4000-8000-000000000002','v2-reviewer@example.test','authenticated','authenticated'),
  ('65000000-0000-4000-8000-000000000003','v2-former-owner@example.test','authenticated','authenticated');
insert into private.npc_capabilities(user_id,capability) values
  ('65000000-0000-4000-8000-000000000002','npc_reviewer'),
  ('65000000-0000-4000-8000-000000000003','npc_reviewer');

create temporary table pg_temp.fixture(sheet jsonb);
insert into pg_temp.fixture values ($sheet$
{"schemaVersion":"npc-sheet-v2","rating":"standard","identity":{"name":"Review Warden","title":"Warden","shortDescription":"A careful warden who keeps the paths around the tavern safe for visitors.","voice":"Measured and practical, always naming the next safe step."},"appearance":{"physicalAppearance":"A road-worn warden with alert eyes and a weatherproof cloak.","attire":"A green cloak, leather gloves, and a brass trail compass.","notableFeatures":"A copper charm marked with the old road.","mood":"Calm and observant.","silhouette":"A green cloak, compass, and sturdy trail boots.","palette":["forest-green","copper"]},"personality":{"dimensions":[{"key":"duty","label":"Duty","negativeAnchor":"self-serving","positiveAnchor":"protective","initialValue":42,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100}],"collections":[{"kind":"value","maximumEntries":3},{"kind":"boundary","maximumEntries":3},{"kind":"preference","maximumEntries":3},{"kind":"aversion","maximumEntries":3},{"kind":"voice_trait","maximumEntries":3}],"initialEntries":[{"id":"value_paths","kind":"value","text":"Keep the paths safe.","core":true,"active":true},{"id":"boundary_civilians","kind":"boundary","text":"Never abandon civilians.","core":true,"active":true},{"id":"preference_maps","kind":"preference","text":"Prefers careful maps.","core":false,"active":true},{"id":"aversion_reckless","kind":"aversion","text":"Rejects reckless shortcuts.","core":true,"active":true},{"id":"voice_steady","kind":"voice_trait","text":"Speaks in calm practical sentences.","core":true,"active":true}]},"skills":{"scouting":2,"combat":1,"diplomacy":1,"trade":1},"lore":{"entities":[],"npcReferences":[],"relationships":[],"facts":[]},"campaign":{"durableGoal":"Keep the road safe for tavern visitors through careful preparation and clear warnings.","milestones":[{"id":"survey","title":"Survey","outcome":"Map a safe route for travelers.","motivation":"Preparation protects visitors.","constraints":["Avoid civilians"],"allowedTargets":["old-road"],"difficulty":1,"successNews":"The road is mapped for travelers.","nonSuccessNews":"The road remains uncertain.","retiredTargets":[],"permanentLoss":null,"startingPlan":[{"action":"prepare","approach":"scouting"}]}]}}
$sheet$::jsonb);

insert into private.npc_identities(id,origin,creator_id,normalized_name,status,rating)
values('65000000-0000-4000-8000-000000000011','community','65000000-0000-4000-8000-000000000001','review-warden','submitted','standard');
insert into private.npc_identity_owners(npc_id,user_id,ended_at) values
  ('65000000-0000-4000-8000-000000000011','65000000-0000-4000-8000-000000000001',null),
  ('65000000-0000-4000-8000-000000000011','65000000-0000-4000-8000-000000000003',clock_timestamp());
insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,submitted_at,created_by)
select '65000000-0000-4000-8000-000000000012','65000000-0000-4000-8000-000000000011',1,'npc-sheet-v2',sheet,encode(extensions.digest(private.world_canonical_json(sheet),'sha256'),'hex'),'submitted',clock_timestamp(),'65000000-0000-4000-8000-000000000001' from pg_temp.fixture;
select is((select count(*) from private.npc_version_resident_packages where version_id='65000000-0000-4000-8000-000000000012'),0::bigint,'reviewing alone never publishes a package');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='65000000-0000-4000-8000-000000000002';
create temporary table pg_temp.submission as select public.npc_reviewer_submission('65000000-0000-4000-8000-000000000012') value;
select is((select value#>>'{sheet,schemaVersion}' from pg_temp.submission),'npc-sheet-v2','reviewer sees the frozen V2 sheet');
select is((select value#>>'{evolutionPreview,initialProfile,dimensions,duty}' from pg_temp.submission),'42','reviewer sees a server-derived evolution preview');
select ok((select value->'optionChoices' from pg_temp.submission) @> '[{"id":"quest.action.prepare"}]'::jsonb,'reviewer sees server-issued option choices');
select throws_ok($$select public.npc_reviewer_decide('65000000-0000-4000-8000-000000000012','approve','Needs package options.',null,null)$$,'PT422',null,'approval without option IDs is rejected');
select throws_ok($$select public.npc_reviewer_decide('65000000-0000-4000-8000-000000000012','approve','Bad option.',null,array['effect.apply_economy_modifier'])$$,'PT400',null,'unissued option IDs are rejected');
select throws_ok($$select public.npc_reviewer_decide('65000000-0000-4000-8000-000000000012','approve','Incomplete campaign coverage.',null,array['quest.action.prepare','effect.adjust_relationship'])$$,'PT422',null,'approval rejects options that omit an authored campaign approach');
select is((public.npc_reviewer_decide('65000000-0000-4000-8000-000000000012','approve','Approved with narrow capabilities.',null,array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal'])->>'decision'),'approve','approval records only reviewed option IDs');
select is((public.npc_reviewer_submission('65000000-0000-4000-8000-000000000012')#>>'{prospectivePackage,state}'),'approved','reviewer projection exposes when the immutable package is ready to publish');
reset role;
select is((select reviewer_id from private.npc_v2_review_decisions where version_id='65000000-0000-4000-8000-000000000012'),'65000000-0000-4000-8000-000000000002'::uuid,'decision records the reviewer actor');
select is((select capability_registry_version from private.npc_v2_review_decisions where version_id='65000000-0000-4000-8000-000000000012'),'community-capability-options-v1','decision records the registry version');
select is((select cardinality(capability_option_ids) from private.npc_v2_review_decisions where version_id='65000000-0000-4000-8000-000000000012'),4,'decision records the exact option IDs');
select throws_ok($$update private.npc_v2_review_candidates set candidate_hash=repeat('0',64) where version_id='65000000-0000-4000-8000-000000000012'$$,'55000',null,'candidate hashes are immutable after review begins');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='65000000-0000-4000-8000-000000000003';
select throws_ok($$select public.npc_reviewer_submission('65000000-0000-4000-8000-000000000012')$$,'PT403',null,'former owners cannot inspect or review their former identity');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='65000000-0000-4000-8000-000000000002';
create temporary table pg_temp.published as select public.npc_reviewer_publish('65000000-0000-4000-8000-000000000012') value;
reset role;
select is((select value->>'state' from pg_temp.published),'published','approved V2 version publishes atomically');
select ok(exists(select 1 from private.npc_version_resident_packages where version_id='65000000-0000-4000-8000-000000000012' and source_kind='community'),'publication creates its immutable resident package');
select is((select current_published_version_id from private.npc_identities where id='65000000-0000-4000-8000-000000000011'),'65000000-0000-4000-8000-000000000012'::uuid,'publication advances the identity current-version pointer');
select is((select capability_envelope->'allowedActions' from private.npc_version_resident_packages where version_id='65000000-0000-4000-8000-000000000012'),'["prepare"]'::jsonb,'package envelope is resolved from approved IDs rather than authored capabilities');

select * from finish();
rollback;
