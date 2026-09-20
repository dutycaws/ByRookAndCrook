begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_table('private','npc_version_resident_packages','immutable version resident packages are durable private records');
select has_function('private','world_materialize_resident_from_version',array['uuid','uuid','uuid','integer'],'shared resident materializer has the stable UUID contract');
select has_function('private','npc_install_first_party_release',array['uuid','text','integer','uuid','text','integer','boolean','jsonb','text[]'],'catalog installer has the narrow generated-release contract');
select has_function('private','world_retire_self',array['uuid'],'terminal command accepts a candidate only, never a caller target');
select ok(not exists(select 1 from private.npc_capability_option_registry where option_value in ('apply_economy_modifier','retire_entity')),'community registry excludes economy modifiers and general entity retirement');
select throws_ok($$select private.npc_resolve_capability_options('community-capability-options-v1',array['effect.apply_economy_modifier'])$$,'PT400',null,'unknown capability options are rejected server side');

insert into auth.users(id,email,role,aud) values
  ('30000000-0000-4000-8000-000000000001','resident-package-one@example.test','authenticated','authenticated'),
  ('30000000-0000-4000-8000-000000000002','resident-package-two@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id) values
  ('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000002');

create temporary table pg_temp.fixture(sheet jsonb);
insert into pg_temp.fixture values ($sheet$
 {"schemaVersion":"npc-sheet-v2","rating":"standard","identity":{"name":"Package Warden","title":"Warden","shortDescription":"A careful warden who keeps the paths around the tavern safe for visitors.","voice":"Measured and practical, always naming the next safe step."},"appearance":{"physicalAppearance":"A road-worn warden with alert eyes and a weatherproof cloak.","attire":"A green cloak, leather gloves, and a brass trail compass.","notableFeatures":"A copper charm marked with the old road.","mood":"Calm and observant.","silhouette":"A green cloak, compass, and sturdy trail boots.","palette":["forest-green","copper"]},"personality":{"dimensions":[{"key":"duty","label":"Duty","negativeAnchor":"self-serving","positiveAnchor":"protective","initialValue":42,"volatility":1,"ordinaryChangeThreshold":25,"definingRuptureThreshold":100}],"collections":[{"kind":"value","maximumEntries":3},{"kind":"boundary","maximumEntries":3},{"kind":"preference","maximumEntries":3},{"kind":"aversion","maximumEntries":3},{"kind":"voice_trait","maximumEntries":3}],"initialEntries":[{"id":"value_paths","kind":"value","text":"Keep the paths safe.","core":true,"active":true},{"id":"boundary_civilians","kind":"boundary","text":"Never abandon civilians.","core":true,"active":true},{"id":"preference_maps","kind":"preference","text":"Prefers careful maps.","core":false,"active":true},{"id":"aversion_reckless","kind":"aversion","text":"Rejects reckless shortcuts.","core":true,"active":true},{"id":"voice_steady","kind":"voice_trait","text":"Speaks in calm practical sentences.","core":true,"active":true}]},"skills":{"scouting":2,"combat":1,"diplomacy":1,"trade":1},"lore":{"entities":[],"npcReferences":[],"relationships":[],"facts":[]},"campaign":{"durableGoal":"Keep the road safe for tavern visitors through careful preparation and clear warnings.","milestones":[{"id":"survey","title":"Survey","outcome":"Map a safe route for travelers.","motivation":"Preparation protects visitors.","constraints":["Avoid civilians"],"allowedTargets":["old-road"],"difficulty":1,"successNews":"The road is mapped for travelers.","nonSuccessNews":"The road remains uncertain.","retiredTargets":[],"permanentLoss":null,"startingPlan":[{"action":"prepare","approach":"scouting"}]},{"id":"hold","title":"Hold","outcome":"Keep the route open.","motivation":"The tavern needs safe roads.","constraints":["Avoid civilians"],"allowedTargets":["old-road"],"difficulty":2,"successNews":"The route stays open.","nonSuccessNews":"The route is lost.","retiredTargets":["old-road"],"permanentLoss":{"kind":"departed","warning":"A reckless stand may drive the warden away.","outcome":"The warden leaves the old road behind."},"startingPlan":null}]}}
$sheet$::jsonb);

select lives_ok($$select private.npc_install_first_party_release('30000000-0000-4000-8000-000000000021','package-warden',1,'30000000-0000-4000-8000-000000000022','release-one',1,true,(select sheet from pg_temp.fixture),array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal'])$$,'first-party installer creates an immutable V2 package');
select is((select personality_schema from private.npc_version_resident_packages where version_id='30000000-0000-4000-8000-000000000022'),'{"collections":[{"kind":"value","maximumEntries":3},{"kind":"boundary","maximumEntries":3},{"kind":"preference","maximumEntries":3},{"kind":"aversion","maximumEntries":3},{"kind":"voice_trait","maximumEntries":3}],"dimensions":[{"definingRuptureThreshold":100,"initialValue":42,"key":"duty","label":"Duty","negativeAnchor":"self-serving","ordinaryChangeThreshold":25,"positiveAnchor":"protective","volatility":1}],"version":"personality-schema-v1"}'::jsonb,'installer derives the canonical personality schema from dimensions and collections');
select is((select initial_profile from private.npc_version_resident_packages where version_id='30000000-0000-4000-8000-000000000022')#>>'{dimensions,duty}','42','installer derives initial profile dimensions from initial values');
select is((select initial_profile->'entries' from private.npc_version_resident_packages where version_id='30000000-0000-4000-8000-000000000022'),(select sheet#>'{personality,initialEntries}' from pg_temp.fixture),'installer freezes initial entries without inventing a second sheet shape');
select is((select terminal_outcomes from private.npc_version_resident_packages where version_id='30000000-0000-4000-8000-000000000022'),array['departed']::text[],'terminal package permission derives only from a campaign permanent-loss template');
select is((select jsonb_build_object('identityKey',identity_key,'rosterOrder',starting_roster_order,'releaseKey',active_release_key,'versionId',active_version_id) from private.npc_first_party_catalog_identities where npc_id='30000000-0000-4000-8000-000000000021'),jsonb_build_object('identityKey','package-warden','rosterOrder',1,'releaseKey','release-one','versionId','30000000-0000-4000-8000-000000000022'::uuid),'catalog identity/release inputs remain durable rather than discarded by installation');
select throws_ok($$update private.npc_version_resident_packages set initial_profile='{}'::jsonb where version_id='30000000-0000-4000-8000-000000000022'$$,'55000',null,'packages are immutable after publication');

insert into private.npc_identities(id,origin,normalized_name,status,rating) values('30000000-0000-4000-8000-000000000031','first_party','package-less','published','standard');
insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state) select '30000000-0000-4000-8000-000000000032','30000000-0000-4000-8000-000000000031',1,'npc-sheet-v2',sheet,encode(extensions.digest(private.world_canonical_json(sheet),'sha256'),'hex'),'published' from pg_temp.fixture;
select is((select count(*) from private.world_npc_instances where save_id='30000000-0000-4000-8000-000000000011'),0::bigint,'fixture save begins without residents');
set local request.jwt.claim.role='service_role';
select is((select count(*) from private.world_materialize_resident_from_version('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000032',1)),0::bigint,'package-less version produces no materialization result');
select is((select count(*) from private.world_npc_instances where save_id='30000000-0000-4000-8000-000000000011'),0::bigint,'missing package causes zero instance/profile writes');
create temporary table pg_temp.materialized as select * from private.world_materialize_resident_from_version('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000022',1);
reset role;
select ok(exists(select 1 from pg_temp.materialized m join private.world_resident_profiles p on p.instance_id=m.instance_id join private.world_resident_package_pins pin on pin.instance_id=m.instance_id and pin.package_id=m.package_id and pin.package_hash=m.package_hash),'materializer atomically creates a package-pinned instance and derived resident profile');
select is((select pressure->>'duty' from private.world_resident_profiles where instance_id=(select instance_id from pg_temp.materialized)),'0','materializer initializes package-derived pressure at zero');

select lives_ok($$select private.npc_install_first_party_release('30000000-0000-4000-8000-000000000021','package-warden',1,'30000000-0000-4000-8000-000000000023','release-two',2,true,(select jsonb_set(sheet,'{personality,dimensions,0,initialValue}','77'::jsonb) from pg_temp.fixture),array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal'])$$,'successor version receives its own immutable package');
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.successor as select * from private.world_materialize_resident_from_version('30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000023',1);
reset role;
select is((select version_id from private.world_resident_package_pins where instance_id=(select instance_id from pg_temp.materialized)),'30000000-0000-4000-8000-000000000022'::uuid,'successor never rewrites an existing resident package pin');
select is((select version_id from private.world_resident_package_pins where instance_id=(select instance_id from pg_temp.successor)),'30000000-0000-4000-8000-000000000023'::uuid,'successor affects a later materialization only');

insert into private.world_resident_terminal_candidates(save_id,proposer_instance_id,package_id,outcome,campaign_template_key,critic_approved,warned_day)
select '30000000-0000-4000-8000-000000000011',m.instance_id,m.package_id,'departed','hold',false,0 from pg_temp.materialized m;
select throws_ok($$insert into private.world_resident_terminal_candidates(save_id,proposer_instance_id,package_id,outcome,campaign_template_key,critic_approved,warned_day) select '30000000-0000-4000-8000-000000000012',m.instance_id,m.package_id,'departed','survey',true,0 from pg_temp.successor m$$,'23514',null,'terminal candidate requires the exact matching campaign permanent-loss milestone');
set local request.jwt.claim.role='service_role';
select throws_ok($$select private.world_retire_self((select id from private.world_resident_terminal_candidates where save_id='30000000-0000-4000-8000-000000000011'))$$,'PT409',null,'self terminal command rejects missing critic approval');
reset role;
update private.world_resident_terminal_candidates set critic_approved=true,warned_day=0 where save_id='30000000-0000-4000-8000-000000000011';
update public.tavern_saves set current_day=1 where id='30000000-0000-4000-8000-000000000011';
set local request.jwt.claim.role='service_role';
select is((private.world_retire_self((select id from private.world_resident_terminal_candidates where save_id='30000000-0000-4000-8000-000000000011'))->>'outcome'),'departed','approved warned terminal candidate retires only itself');
reset role;
select ok(exists(select 1 from private.world_npc_tombstones t where t.save_id='30000000-0000-4000-8000-000000000011' and t.npc_id='30000000-0000-4000-8000-000000000021' and t.reason='departed'),'terminal self outcome creates a save-local tombstone');

select * from finish();
rollback;
