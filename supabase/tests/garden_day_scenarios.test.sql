begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id,email,role,aud,created_at,updated_at)
values ('16300000-0000-4000-8000-000000000001','garden-scenarios@example.test',
  'authenticated','authenticated',now(),now());

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16300000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'scenario garden provisions');

reset role;
update public.garden_cells set soil_n=70,soil_p=70,soil_k=70,soil_moisture=70,
  soil_quality=60,site_light=70 where layout_key='c0';
update public.garden_plants set lifecycle='regrowing',growth_progress=35,health=80,
  care_good_days=0,care_total_days=0,stress_points=0,companion_points=0,
  pollination_points=0 where cell_id=(select id from public.garden_cells where layout_key='c0');

update public.garden_cells set soil_n=0,soil_p=0,soil_k=0,soil_moisture=0,
  soil_quality=20,site_light=20 where layout_key='c1';
update public.garden_plants set companion_points=0
where cell_id=(select id from public.garden_cells where layout_key='c6');

create temporary table baseline_plan as
select private.resolve_garden_day((select id from public.tavern_saves),1) plan;

select is(((select plot#>>'{plant,health}' from baseline_plan,
  lateral jsonb_array_elements(plan->'plots') plot where plot->>'layoutKey'='c0'))::integer,
  84,'healthy soil, moisture, and light improve plant health');
select is(((select plot#>>'{plant,goodDays}' from baseline_plan,
  lateral jsonb_array_elements(plan->'plots') plot where plot->>'layoutKey'='c0'))::integer,
  1,'a healthy day contributes to cycle-quality history');
select ok(((select plot#>>'{plant,health}' from baseline_plan,
  lateral jsonb_array_elements(plan->'plots') plot where plot->>'layoutKey'='c1'))::integer <
  (select health from public.garden_plants where cell_id=(select id from public.garden_cells where layout_key='c1')),
  'combined moisture and NPK errors reduce health');
select ok(exists(select 1 from baseline_plan,
  lateral jsonb_array_elements(plan#>'{report,events}') event
  where event->>'layoutKey'='c1' and event->>'kind'='plant-warning'),
  'care errors produce a visible warning event');
select is(((select plot#>>'{plant,companion}' from baseline_plan,
  lateral jsonb_array_elements(plan->'plots') plot where plot->>'layoutKey'='c6'))::integer,
  4,'adjacent chamomile and tomatoes apply the authored companion effect');
select is(((select plot#>>'{soil,light}' from baseline_plan,
  lateral jsonb_array_elements(plan->'plots') plot where plot->>'layoutKey'='c6'))::integer,
  75,'a taller adjacent tomato casts one bounded shade step');

set constraints all immediate;
set constraints all deferred;
create index garden_plants_physical_order_test_idx on public.garden_plants(species_key desc,id);
create index apiary_colonies_physical_order_test_idx on public.apiary_colonies(health,id desc);
cluster public.garden_plants using garden_plants_physical_order_test_idx;
cluster public.apiary_colonies using apiary_colonies_physical_order_test_idx;
select is((select plan->>'planFingerprint' from baseline_plan),
  private.resolve_garden_day((select id from public.tavern_saves),1)->>'planFingerprint',
  'projection is independent of physical plant and colony row order');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16300000-0000-4000-8000-000000000001';
select lives_ok($$ select public.advance_tavern_day(
  (select id from public.tavern_saves),
  '16300000-0000-4000-8000-000000000010',0) $$,
  'the scenario plan commits through the public day boundary');
reset role;
select ok((select p.lifecycle=(expected.plot#>>'{plant,lifecycle}')
    and p.growth_progress=(expected.plot#>>'{plant,progress}')::integer
    and p.health=(expected.plot#>>'{plant,health}')::integer
    and p.care_good_days=(expected.plot#>>'{plant,goodDays}')::integer
    and p.care_total_days=(expected.plot#>>'{plant,totalDays}')::integer
  from public.garden_plants p
  join public.garden_cells c on c.save_id=p.save_id and c.id=p.cell_id
  cross join lateral (select plot from baseline_plan,
    lateral jsonb_array_elements(plan->'plots') plot where plot->>'layoutKey'='c0') expected
  where c.layout_key='c0'),
  'regrowth projection and committed cycle state are identical');
select is((select plan_fingerprint from public.garden_day_resolutions),
  (select plan->>'planFingerprint' from baseline_plan),
  'the committed scenario retains the exact projected fingerprint');

select * from finish();
rollback;
