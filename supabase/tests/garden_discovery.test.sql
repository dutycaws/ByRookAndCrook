begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values('16900000-0000-4000-8000-000000000001','garden-discovery@example.test',
  'authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16900000-0000-4000-8000-000000000001';

select lives_ok($$ select public.create_tavern() $$,'discovery test provisions a garden');
create temporary table discovery_context as
select id as save_id from public.tavern_saves
where user_id='16900000-0000-4000-8000-000000000001';

reset role;
update public.garden_cells set soil_moisture=95,soil_quality=82,site_light=10,soil_n=100
where save_id=(select save_id from discovery_context) and layout_key='c1';
update public.garden_plants set health=10
where save_id=(select save_id from discovery_context)
  and cell_id=(select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c1');
update public.apiary_colonies set health=20,varroa_pressure=70
where save_id=(select save_id from discovery_context)
  and hive_id=(select id from public.apiary_hives where save_id=(select save_id from discovery_context)
    and cell_id=(select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c2'));
insert into public.garden_inventory(save_id,item_key,quantity)
values((select save_id from discovery_context),'amendment_n',4)
on conflict(save_id,item_key) do update set quantity=excluded.quantity;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16900000-0000-4000-8000-000000000001';

select lives_ok($$ select public.garden_command(
  (select save_id from discovery_context),'16900000-0000-4000-8000-000000000002',0,'plant',
  jsonb_build_object('cellId',(select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c3'),
    'seedItemKey','seed_clover')) $$,'planting is accepted and recorded through the garden command path');
select lives_ok($$ select public.garden_command(
  (select save_id from discovery_context),'16900000-0000-4000-8000-000000000003',1,'water',
  jsonb_build_object('cellIds',jsonb_build_array((select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c3')),
    'dose',7)) $$,'watering is accepted and recorded through the garden command path');
select lives_ok($$ select public.garden_command(
  (select save_id from discovery_context),'16900000-0000-4000-8000-000000000004',2,'amend',
  jsonb_build_object('cellIds',jsonb_build_array((select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c3')),
    'itemKey','amendment_n','dose',1)) $$,'fertilizer is accepted and recorded through the garden command path');
select lives_ok($$ select public.harvest_crop(
  (select save_id from discovery_context),
  (select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c0'),
  '16900000-0000-4000-8000-000000000005',3) $$,'harvest is accepted and recorded through the harvest command path');
select lives_ok($$ select public.garden_command(
  (select save_id from discovery_context),'16900000-0000-4000-8000-000000000006',4,'remove',
  jsonb_build_object('cellId',(select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c3'),
    'compost',false)) $$,'removing a plant records the planting boundary');
select lives_ok($$ select public.advance_tavern_day(
  (select save_id from discovery_context),'16900000-0000-4000-8000-000000000007',5) $$,
  'end-day records that day’s garden observation clues');

reset role;
-- A healthy-looking plant can still show a specific stress sign. Keep the
-- qualitative inspection internally consistent by omitting the generic health
-- reassurance when the projection already reports a symptom for that plant.
update public.garden_cells set soil_moisture=95
where save_id=(select save_id from discovery_context) and layout_key='c8';
update public.garden_plants set health=80,lifecycle='growing',flowering_days_remaining=0
where save_id=(select save_id from discovery_context)
  and cell_id=(select id from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c8');
create temporary table revision_before_inspection as
select revision from public.tavern_saves where id=(select save_id from discovery_context);
create temporary table discovery_projection as
select projection.value,
  projection.value->(select id::text from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c1') as c1,
  projection.value->(select id::text from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c2') as c2,
  projection.value->(select id::text from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c3') as c3,
  projection.value->(select id::text from public.garden_cells where save_id=(select save_id from discovery_context) and layout_key='c8') as c8
from (select private.garden_discovery_projection((select save_id from discovery_context)) as value) projection;

select is((select count(*) from discovery_projection d, jsonb_object_keys(d.value)),
  24::bigint,'projection includes every unlocked and locked garden plot');
select is(jsonb_typeof((select c1->'observations' from discovery_projection)),
  'array','plant inspection returns qualitative clue text');
select ok(jsonb_array_length((select c1->'observations' from discovery_projection)) >= 6,
  'plant inspection includes soil, exposure, and plant clues');
select ok((select c1->'observations' from discovery_projection)::text like '%topsoil is heavy and slick%',
  'wet soil is described as an observation');
select ok((select c1->'observations' from discovery_projection)::text like '%stems lean toward the brighter edge%',
  'low light is described by a visible plant sign');
select ok((select c8->'observations' from discovery_projection)::text like '%soil stays heavy, and lower leaves are turning yellow%',
  'a plant stress sign remains visible alongside otherwise healthy appearance');
select ok((select c8->'observations' from discovery_projection)::text !~ 'leaves hold their color and the stems stand upright',
  'the generic healthy-leaf clue is suppressed when a specific stress clue is present');
select ok((select c1->'observations' from discovery_projection)::text !~ '[0-9%]',
  'plant inspection hides exact living-state numbers');
select ok((select c1->'observations' from discovery_projection)::text !~* '(nitrogen|phosphorus|potassium|preferred range|more water|cure|diagnos)',
  'plant inspection does not expose a diagnosis or prescribed treatment');
select ok((select c2->'observations' from discovery_projection)::text like '%Few workers are coming and going%',
  'colony condition is described through visible activity');
select ok((select c2->'observations' from discovery_projection)::text !~* '(varroa|chalkbrood|nosema|pressure|health|treatment)',
  'colony inspection omits diagnoses and exact pressure labels');
select is(jsonb_typeof((select c1->'careHistory' from discovery_projection)),
  'array','the discovery projection provides a history slot for every plot');
select ok((select c3->'careHistory' from discovery_projection)::text like '%Planted Clover%'
  and (select c3->'careHistory' from discovery_projection)::text like '%Removed Clover%',
  'recent plot history preserves planting and removal boundaries');
select ok(jsonb_path_exists(
  (select c3->'careHistory' from discovery_projection),
  '$[*] ? (@.label == "Watered" && @.quantity == 7 && @.unit == "water")'),
  'care history records the amount of water applied to a plot');
select ok(jsonb_path_exists(
  (select c3->'careHistory' from discovery_projection),
  '$[*] ? (@.label == "Applied Nitrogen amendment" && @.quantity == 1 && @.unit == "dose")'),
  'care history records the applied amendment quantity');
select ok(jsonb_path_exists(
  (select c3->'careHistory' from discovery_projection),
  '$[*] ? (@.kind == "daily_observation")'),
  'end-day persists qualitative clues in per-plot history');
select is((select revision from public.tavern_saves where id=(select save_id from discovery_context)),
  (select revision from revision_before_inspection),'free inspection does not advance or mutate the save');
select ok('Its flowers offer forage for bees.' = any(private.garden_seed_guidance('garden-apiary-v1','clover')),
  'pre-planting seed guidance describes bee forage qualitatively');
select ok(array_to_string(private.garden_seed_guidance('garden-apiary-v1','clover'),' ') !~ '[0-9%]',
  'seed guidance does not reveal numeric care thresholds');
select ok(not has_function_privilege('authenticated','private.garden_discovery_projection(uuid)','EXECUTE'),
  'the internal projection helper is not callable through the authenticated Data API');

select * from finish();
rollback;
