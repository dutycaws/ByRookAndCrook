begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('private','world_generated_gameplay_definitions','generated gameplay definitions are isolated from canonical payloads');
select has_table('private','world_generated_gameplay_availability','generated gameplay availability is durable');
select has_table('private','world_generated_gameplay_receipts','complete gameplay proposals have an exact replay receipt');
select has_function('public','world_generated_gameplay_availability',array['uuid'],'owner-scoped gameplay availability projection exists');
select has_function('public','start_bake',array['uuid','uuid','text','uuid','bigint'],'generated recipe selection uses an explicit overload');
select has_function('public','world_settlement_commit_procedural_world',array['uuid','uuid','uuid','jsonb'],'procedural commit wrapper remains service entry point');
select ok(not has_function_privilege('authenticated','private.world_generated_gameplay_install(uuid,integer,uuid,text,jsonb)','execute'),'players cannot install arbitrary generated mechanics');
select ok(has_function_privilege('authenticated','public.world_generated_gameplay_availability(uuid)','execute'),'owners can read the bounded availability projection');

insert into auth.users(id,email,role,aud) values
 ('15500000-0000-4000-8000-000000000001','gameplay-owner@example.test','authenticated','authenticated'),
 ('15500000-0000-4000-8000-000000000002','gameplay-other@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15500000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
alter table pg_temp.fixture add column resident_id uuid;
update pg_temp.fixture set resident_id=(select id from private.world_npc_instances where save_id=pg_temp.fixture.save_id order by id limit 1);
-- The first-party package used by this fixture carries the reviewed
-- create-entity option.  Tests must exercise its immutable package-derived
-- authority rather than mutating a legacy capability source.
select ok((private.world_procedural_resident_capability((select save_id from pg_temp.fixture),(select resident_id from pg_temp.fixture))->'allowedWorldEffects' ? 'create_entity'),'fixture resident receives reviewed package capability for generated recipe creation');
create temporary table pg_temp.claim(s uuid,j uuid,f uuid);
insert into pg_temp.claim values('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000011','15500000-0000-4000-8000-000000000012');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version) select s,save_id,2,0,'gameplay', 'processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.claim cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version) select j,s,1,'procedural_world','processing',encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),private.world_procedural_world_context(save_id),'procedural-world-v1' from pg_temp.claim cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.claim;
create function pg_temp.proposal(p_name text default 'Forest loaf') returns jsonb language sql as $$
select jsonb_build_object('version','procedural-world-v1','commands',jsonb_build_array(
  jsonb_build_object('operation','gameplay_unlock','effectKind','unlock_gameplay','sourceResidentId',(select resident_id::text from pg_temp.fixture),'entityRef','forest-loaf','family','herb_loaf_variant','definition',jsonb_build_object('displayName',p_name)),
  jsonb_build_object('operation','entity','effectKind','create_entity','sourceResidentId',(select resident_id::text from pg_temp.fixture),'entityKind','recipe','entityKey','forest-loaf','archetypeKey','crafted-dish','proposedName','Forest loaf','payload',jsonb_build_object('components',jsonb_build_array('herb-loaf')))
)) $$;
create function pg_temp.old_target_proposal() returns jsonb language sql as $proposal$
select jsonb_build_object(
  'version','procedural-world-v1',
  'commands',jsonb_build_array(
    jsonb_build_object(
      'operation','entity',
      'effectKind','create_entity',
      'sourceResidentId',(select resident_id::text from pg_temp.fixture),
      'entityKind','location',
      'entityKey','filler',
      'archetypeKey','landmark',
      'proposedName','Filler',
      'payload','{}'::jsonb
    ),
    jsonb_build_object(
      'operation','gameplay_unlock',
      'effectKind','unlock_gameplay',
      'sourceResidentId',(select resident_id::text from pg_temp.fixture),
      'entityRef','forest-loaf',
      'family','herb_loaf_variant',
      'definition',jsonb_build_object('displayName','Old target')
    )
  )
) $proposal$;
grant select on pg_temp.fixture,pg_temp.claim to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.result as select public.world_settlement_commit_procedural_world(s,j,f,pg_temp.proposal()) result from pg_temp.claim;
select ok((select result->'gameplayUnlocks'->0->>'reused'='false' from pg_temp.result),'claimed fence atomically creates a first generated gameplay definition');
select ok((public.world_settlement_commit_procedural_world((select s from pg_temp.claim),(select j from pg_temp.claim),(select f from pg_temp.claim),pg_temp.proposal())->>'replayed')='true','exact complete proposal replay is stable');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.claim),(select j from pg_temp.claim),(select f from pg_temp.claim),pg_temp.proposal('Changed loaf'))$$,'PT409',null,'changed complete proposal replay is rejected');
reset role;
select is((select count(*) from private.world_generated_gameplay_availability),1::bigint,'same-proposal recipe unlock creates one durable availability row');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15500000-0000-4000-8000-000000000001';
select is((public.world_generated_gameplay_availability((select save_id from pg_temp.fixture))->'recipes'->0->>'recipeKey'),'forest-loaf','owner sees only bounded generated recipe availability');
set local request.jwt.claim.sub='15500000-0000-4000-8000-000000000002';
select throws_ok($$select public.world_generated_gameplay_availability((select save_id from pg_temp.fixture))$$,'PT404',null,'other owner cannot read generated availability');
reset role;
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15500000-0000-4000-8000-000000000001';
select throws_ok($$select public.start_bake((select save_id from pg_temp.fixture),'15500000-0000-4000-8000-000000000099','generated-missing','15500000-0000-4000-8000-000000000098',0)$$,'PT422',null,'unavailable generated key is rejected before bake state changes');
select lives_ok($$select public.harvest_crop(
  (select save_id from pg_temp.fixture),
  (select id from public.garden_cells where save_id=(select save_id from pg_temp.fixture) and layout_key='c1'),
  '15500000-0000-4000-8000-000000000101',0
)$$,'the generated-recipe fixture harvests one existing authored ingredient');
create temporary table pg_temp.bake_result(result jsonb);
grant select,insert on pg_temp.bake_result to authenticated;
insert into pg_temp.bake_result
select public.start_bake(
  (select save_id from pg_temp.fixture),
  (select id from public.ingredient_batches where save_id=(select save_id from pg_temp.fixture) order by created_at limit 1),
  'generated-forest-loaf','15500000-0000-4000-8000-000000000102',1
);
select is((select result->>'recipeKey' from pg_temp.bake_result),'generated-forest-loaf','generated bake receipt preserves the selected recipe key');
select is((select recipe_key from public.bake_sessions where id=(select (result->>'sessionId')::uuid from pg_temp.bake_result)),'generated-forest-loaf','generated bake session stores the exact generated recipe key');
select lives_ok($$
  do $prepare$
  declare v_revision bigint:=2; v_session uuid:=(select (result->>'sessionId')::uuid from pg_temp.bake_result);
  begin
    for i in 1..6 loop
      perform public.fold_bake((select save_id from pg_temp.fixture),v_session,extensions.gen_random_uuid(),v_revision,70);
      v_revision:=v_revision+1;
    end loop;
    for i in 1..3 loop
      perform public.score_bake((select save_id from pg_temp.fixture),v_session,extensions.gen_random_uuid(),v_revision,70);
      v_revision:=v_revision+1;
    end loop;
  end $prepare$;
$$,'generated loaf uses the established fold and score mechanics');
select lives_ok($$select public.begin_bake_oven(
  (select save_id from pg_temp.fixture),(select (result->>'sessionId')::uuid from pg_temp.bake_result),
  '15500000-0000-4000-8000-000000000103',11
)$$,'generated loaf enters the established oven stage');
reset role;
update public.bake_sessions set oven_started_at=clock_timestamp()-interval '30 seconds'
where id=(select (result->>'sessionId')::uuid from pg_temp.bake_result);
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='15500000-0000-4000-8000-000000000001';
create temporary table pg_temp.complete_result(result jsonb);
grant select,insert on pg_temp.complete_result to authenticated;
insert into pg_temp.complete_result
select public.complete_bake(
  (select save_id from pg_temp.fixture),(select (result->>'sessionId')::uuid from pg_temp.bake_result),
  '15500000-0000-4000-8000-000000000104',12
);
select is((select result->>'recipeKey' from pg_temp.complete_result),'generated-forest-loaf','completion receipt preserves the generated recipe identity');
select is((select result->>'foodName' from pg_temp.complete_result),'Forest loaf','completion receipt uses the generated display name');
select ok(exists(select 1 from public.foods where save_id=(select save_id from pg_temp.fixture) and recipe_key='generated-forest-loaf' and name='Forest loaf'),'completed generated loaf is a distinct inventory item with the generated label');
select lives_ok($$select public.complete_bake(
  (select save_id from pg_temp.fixture),(select (result->>'sessionId')::uuid from pg_temp.bake_result),
  '15500000-0000-4000-8000-000000000104',12
)$$,'generated loaf completion replays exactly');
select is((select count(*) from public.foods where save_id=(select save_id from pg_temp.fixture) and recipe_key='generated-forest-loaf'),1::bigint,'generated completion replay creates no duplicate food');
reset role;

create temporary table pg_temp.negative(s uuid,j uuid,f uuid);
insert into pg_temp.negative values('15500000-0000-4000-8000-000000000020','15500000-0000-4000-8000-000000000021','15500000-0000-4000-8000-000000000022');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version) select s,save_id,3,0,'negative','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','procedural-world-v1' from pg_temp.negative cross join pg_temp.fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version) select j,s,1,'procedural_world','processing',encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),private.world_procedural_world_context(save_id),'procedural-world-v1' from pg_temp.negative cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()+interval '5 minutes' from pg_temp.negative;
grant select on pg_temp.negative to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.negative),(select j from pg_temp.negative),'15500000-0000-4000-8000-000000000099',pg_temp.proposal())$$,'PT409',null,'stale fence is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select save_id from pg_temp.fixture),(select j from pg_temp.negative),(select f from pg_temp.negative),pg_temp.proposal())$$,'PT409',null,'cross-settlement commit is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world((select s from pg_temp.negative),(select j from pg_temp.negative),(select f from pg_temp.negative),pg_temp.old_target_proposal())$$,'PT400',null,'older recipe cannot be unlocked by an unrelated nonempty proposal');
reset role;

select * from finish();
rollback;
