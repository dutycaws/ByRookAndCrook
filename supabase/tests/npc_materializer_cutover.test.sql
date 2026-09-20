begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_function('private','seed_world_npcs',array['uuid'],'new saves use the catalog-backed roster seeder');
select has_function('private','maybe_arrive_world_npc',array['uuid','integer','uuid'],'community arrivals use the package-backed selection path');
select has_function('private','world_promote_canonical_npc',array['uuid','uuid'],'promotion retains its public UUID contract');
select has_table('private','world_promoted_npc_package_receipts','promoted residents have package-backed replay receipts');

insert into auth.users(id,email,role,aud) values
  ('66000000-0000-4000-8000-000000000001','materializer-cutover@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id) values
  ('66000000-0000-4000-8000-000000000011','66000000-0000-4000-8000-000000000001');

create temporary table pg_temp.fixture(sheet jsonb);
insert into pg_temp.fixture values ($sheet$
{"schemaVersion":"npc-sheet-v2","rating":"standard","identity":{"name":"Cutover Warden","title":"Warden","shortDescription":"A careful warden who keeps a safe route open for every tavern guest.","voice":"Measured, practical, and candid about uncertainty."},"appearance":{"physicalAppearance":"A road-worn warden with alert eyes and a weatherproof cloak.","silhouette":"A green cloak, compass, and sturdy trail boots make a clear outline.","palette":["forest-green","copper"],"attire":"A green cloak, leather gloves, and a brass trail compass.","notableFeatures":"A copper charm marked with the old road.","mood":"Calm and observant while planning a safe route."},"personality":{"dimensions":[{"key":"duty","label":"Duty","negativeAnchor":"self-serving","positiveAnchor":"protective","initialValue":42,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100}],"collections":[{"kind":"value","maximumEntries":3},{"kind":"boundary","maximumEntries":3},{"kind":"preference","maximumEntries":3},{"kind":"aversion","maximumEntries":3},{"kind":"voice_trait","maximumEntries":3}],"initialEntries":[{"id":"value_paths","kind":"value","text":"Keep the paths safe.","core":true,"active":true},{"id":"boundary_civilians","kind":"boundary","text":"Never abandon civilians.","core":true,"active":true},{"id":"preference_maps","kind":"preference","text":"Prefers careful maps.","core":false,"active":true},{"id":"aversion_reckless","kind":"aversion","text":"Rejects reckless shortcuts.","core":true,"active":true},{"id":"voice_steady","kind":"voice_trait","text":"Speaks in calm practical sentences.","core":true,"active":true}]},"lore":{"entities":[],"npcReferences":[],"relationships":[],"facts":[]},"skills":{"scouting":2,"combat":1,"diplomacy":1,"trade":1},"campaign":{"durableGoal":"Keep the road safe for tavern visitors through careful preparation.","milestones":[{"id":"survey","title":"Survey","outcome":"Map a safe route for travelers.","motivation":"Preparation protects visitors.","constraints":["Avoid civilians"],"allowedTargets":["old-road"],"difficulty":1,"successNews":"The road is mapped for travelers.","nonSuccessNews":"The road remains uncertain.","retiredTargets":[],"permanentLoss":null,"startingPlan":[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]}]}}
$sheet$::jsonb);

select lives_ok($$select private.npc_install_first_party_release('66000000-0000-4000-8000-000000000021','cutover-warden',10,'66000000-0000-4000-8000-000000000022','v1',1,true,(select sheet from pg_temp.fixture),array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal'])$$,'catalog installer creates the package used by the materializer');
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.first_materialization as
  select * from private.world_materialize_resident_from_version('66000000-0000-4000-8000-000000000011','66000000-0000-4000-8000-000000000021','66000000-0000-4000-8000-000000000022',1);
select is((select count(*) from pg_temp.first_materialization),1::bigint,'first-party package materializes exactly one resident');
select is((select count(*) from private.world_resident_package_pins where instance_id=(select instance_id from pg_temp.first_materialization)),1::bigint,'materialization records exactly one immutable package pin');
create temporary table pg_temp.replayed_materialization as
  select * from private.world_materialize_resident_from_version('66000000-0000-4000-8000-000000000011','66000000-0000-4000-8000-000000000021','66000000-0000-4000-8000-000000000022',1);
select is((select instance_id from pg_temp.replayed_materialization),(select instance_id from pg_temp.first_materialization),'materializer replay returns the original pinned instance');

insert into private.npc_identities(id,origin,creator_id,normalized_name,status,rating) values
  ('66000000-0000-4000-8000-000000000031','community','66000000-0000-4000-8000-000000000001','unpackaged-community','published','standard');
insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,published_at)
select '66000000-0000-4000-8000-000000000032','66000000-0000-4000-8000-000000000031',1,'npc-sheet-v2',sheet,encode(extensions.digest(private.world_canonical_json(sheet),'sha256'),'hex'),'published',clock_timestamp() from pg_temp.fixture;
update private.npc_identities set current_published_version_id='66000000-0000-4000-8000-000000000032' where id='66000000-0000-4000-8000-000000000031';
select is((select count(*) from private.world_materialize_resident_from_version('66000000-0000-4000-8000-000000000011','66000000-0000-4000-8000-000000000031','66000000-0000-4000-8000-000000000032',1)),0::bigint,'identity current pointer cannot materialize a community resident without a package');
select is((select count(*) from private.world_npc_instances where save_id='66000000-0000-4000-8000-000000000011' and npc_id='66000000-0000-4000-8000-000000000031'),0::bigint,'missing package produces no fallback instance write');

select lives_ok($$select private.npc_install_first_party_release('66000000-0000-4000-8000-000000000021','cutover-warden',10,'66000000-0000-4000-8000-000000000023','v2',2,true,jsonb_set((select sheet from pg_temp.fixture),'{personality,dimensions,0,initialValue}','77'::jsonb),array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal'])$$,'new catalog release creates a successor package');
select is((private.world_frozen_resident_evolution_base((select instance_id from pg_temp.first_materialization))->'schema'->'dimensions'->0->>'initialValue'),'42','runtime context remains pinned to the resident package, not the catalog current release');
reset role;

select * from finish();
rollback;
