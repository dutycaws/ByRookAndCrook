begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id,email,role,aud) values
  ('60000000-0000-4000-8000-000000000001','serving-one@example.test','authenticated','authenticated'),
  ('60000000-0000-4000-8000-000000000002','serving-two@example.test','authenticated','authenticated');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000001';
select is(public.npc_bar_snapshot(),null::jsonb,'bar read before onboarding does not create a tavern');
select public.create_tavern();
select public.harvest_crop((select id from public.tavern_saves),
  (select id from public.garden_cells where save_id=(select id from public.tavern_saves) and layout_key='c1'),
  '60000000-0000-4000-8000-000000000010',0);
reset role;

create temporary table pg_temp.fixture as
select save_row.id as save_id,save_row.user_id,save_row.revision as initial_revision,
  resident.id as instance_id,resident.npc_id,resident.version_id,
  (select id from public.ingredient_batches batch where batch.save_id=save_row.id order by batch.created_at limit 1) as ingredient_id
from public.tavern_saves save_row
join private.world_npc_instances resident on resident.save_id=save_row.id
where save_row.user_id='60000000-0000-4000-8000-000000000001'
order by resident.id limit 1;
grant select on pg_temp.fixture to authenticated;

insert into public.brew_sessions(
  id,save_id,day_number,ingredient_batch_id,ingredient_quality_index,ingredient_brew_bonus,
  rules_version,status,duration_seconds,countdown_seconds,stir_rules_version,completed_at,
  perfect_ticks,good_ticks,total_ticks,stir_score,quality_index
)
select '60000000-0000-4000-8000-000000000020',save_id,1,ingredient_id,5,2,
  'harvest-v1','completed',15,2,'guide-v2',clock_timestamp(),0,0,60,0,5
from pg_temp.fixture;
insert into public.beverages(id,save_id,brew_session_id,ingredient_batch_id,rules_version,name,quality_index)
select '60000000-0000-4000-8000-000000000021',save_id,'60000000-0000-4000-8000-000000000020',ingredient_id,'harvest-v1','Fixture mead',5
from pg_temp.fixture;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(public.npc_bar_snapshot()->'roster'),2,'new tavern materializes the package-backed first-party roster');
select ok(not has_function_privilege('anon','public.npc_serve_hospitality(uuid,uuid,text,uuid,uuid,bigint)','execute'),'anonymous callers cannot serve hospitality');
select throws_ok($$update public.tavern_saves set gold=500$$,'42501',null,'players cannot edit their balance directly');
select throws_ok($$update private.world_npc_instances set relationship=100$$,'42501',null,'players cannot edit resident relationships directly');

select throws_ok($$select public.npc_serve_hospitality((select save_id from pg_temp.fixture),(select instance_id from pg_temp.fixture),'beverage','60000000-0000-4000-8000-000000000021','60000000-0000-4000-8000-000000000022',(select initial_revision from pg_temp.fixture))$$,
 'PT409','Serving requires a drawn daily card and dialogue exchange','legacy direct serving cannot bypass the daily hand');

reset role;
-- Keep this serving fixture deterministic: only its real beverage is eligible.
update public.daily_deck_cards set pile='consumed'
where save_id=(select save_id from pg_temp.fixture) and source_kind='social';
set local role authenticated;
select public.daily_deck_open((select initial_revision from pg_temp.fixture));
reset role;
alter table pg_temp.fixture add column daily_card_id uuid;
update pg_temp.fixture set daily_card_id=(select id from public.daily_deck_cards
 where save_id=fixture.save_id and source_kind='beverage'
 and source_id='60000000-0000-4000-8000-000000000021' and pile='hand');
select ok((select daily_card_id is not null from pg_temp.fixture),'the real beverage is represented by a drawn physical card');

set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claim(result jsonb);
insert into pg_temp.claim select public.npc_dialogue_begin(
 '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000022',
 npc_id,'Please enjoy this fixture mead.',0,null,'beverage',
 '60000000-0000-4000-8000-000000000021',daily_card_id) from pg_temp.fixture;
select public.npc_dialogue_checkpoint('60000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000022',(select (result->>'fence')::uuid from pg_temp.claim),
 'decision','{"value":{"stance":"agree","subject":"hospitality","reaction":0,"evidence":"","intention":null}}'::jsonb);
select public.npc_dialogue_checkpoint('60000000-0000-4000-8000-000000000001',
 '60000000-0000-4000-8000-000000000022',(select (result->>'fence')::uuid from pg_temp.claim),
 'speak','{"value":{"text":"Thank you for the mead."}}'::jsonb);
create temporary table pg_temp.first_result(result jsonb);
grant select on pg_temp.first_result to authenticated;
insert into pg_temp.first_result select public.npc_dialogue_complete(
 '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000022',
 (select (result->>'fence')::uuid from pg_temp.claim))->'serving';
select is((select pile from public.daily_deck_cards where id=(select daily_card_id from pg_temp.fixture)),
 'consumed','completed serving permanently consumes its physical card');
select is((select result->>'itemKind' from pg_temp.first_result),'beverage','server receipt identifies the offered inventory kind');
select is((select result->>'qualityIndex' from pg_temp.first_result),'5','receipt uses the brewed beverage quality');
select is((select result->>'relationshipChange' from pg_temp.first_result),'2','excellent hospitality applies the bounded relationship change');
reset role;
select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),47,'hospitality changes the UUID resident relationship once');
select is((select gold from public.tavern_saves where id=(select save_id from pg_temp.fixture)),25::bigint,'hospitality credits the quality-dependent payment once');
select is((select count(*) from private.world_npc_hospitality_events where save_id=(select save_id from pg_temp.fixture)),1::bigint,'world hospitality receipt is the sole consumption ledger');
select is((select result from pg_temp.first_result),public.npc_dialogue_complete(
 '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000022',
 (select (result->>'fence')::uuid from pg_temp.claim))->'serving','exact action replay returns its original receipt');
select is((select revision from public.tavern_saves where id=(select save_id from pg_temp.fixture)),
 (select initial_revision+2 from pg_temp.fixture),'opening and serving advance revision once each; replay advances neither');
select throws_ok($$select public.npc_dialogue_begin(
 '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000023',
 (select npc_id from pg_temp.fixture),'Another serving.',1,null,'beverage',
 '60000000-0000-4000-8000-000000000021',(select daily_card_id from pg_temp.fixture))$$,
 'PT409',null,'consumed inventory and its physical card cannot be served again');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000001';
select ok((public.npc_bar_snapshot()->'recent'->'hospitality') @> jsonb_build_array((select result from pg_temp.first_result)),'bar snapshot exposes the committed UUID hospitality receipt');

set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000002';
select is(public.npc_bar_snapshot(),null::jsonb,'another player cannot read the first tavern bar state');
reset role;
set local request.jwt.claim.role='service_role';
select throws_ok($$select public.npc_dialogue_begin(
 '60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000024',
 (select npc_id from pg_temp.fixture),'That is not my mead.',0,null,'beverage',
 '60000000-0000-4000-8000-000000000021',(select daily_card_id from pg_temp.fixture))$$,
 'PT404',null,'another player cannot serve the first tavern inventory');

select * from finish();
rollback;
