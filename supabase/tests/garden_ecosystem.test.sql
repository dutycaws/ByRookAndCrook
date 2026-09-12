begin;

create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, email, role, aud, created_at, updated_at)
values ('16000000-0000-4000-8000-000000000001', 'garden-ecosystem@example.test',
  'authenticated', 'authenticated', now(), now());

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select lives_ok($$ select public.create_tavern() $$, 'the garden ecosystem provisions with the tavern');
select is((select count(*) from public.tavern_saves), 1::bigint, 'one owned save is visible');
select is((select count(*) from public.garden_cells), 24::bigint, 'all stable expansion cells are provisioned');
select is((select count(*) from public.garden_cells where unlocked), 12::bigint, 'only the original twelve cells begin unlocked');
select is((select count(*) from public.garden_cells where rules_version='garden-apiary-v1'),24::bigint,
  'all legacy and expansion cells use the garden-apiary rule version');
select results_eq(
  $$ select layout_key,col,row from public.garden_cells where layout_key in ('c0','c1','c2','c11') order by layout_key $$,
  $$ values ('c0'::text,0::smallint,0::smallint),('c1',1::smallint,0::smallint),
    ('c11',2::smallint,3::smallint),('c2',2::smallint,0::smallint) $$,
  'original layout keys and coordinates remain unchanged'
);
select is((select count(*) from public.garden_plants), 7::bigint, 'legacy crops are migrated into movable plant state');
select is((select count(*) from public.apiary_hives), 1::bigint, 'legacy hive becomes equipment');
select is((select count(*) from public.apiary_colonies), 1::bigint, 'legacy hive receives one starter colony');
select is((select count(*) from public.garden_weather), 3::bigint, 'three persisted forecast days are created');
select is((select count(*) from public.garden_daily_grants), 1::bigint, 'migration starter grant is recorded once');
select is((select quantity from public.garden_inventory where item_key='seed_hops'), 2, 'starter productive seeds are renewable stock');
select is((select quantity from public.garden_inventory where item_key='seed_clover'), 3, 'starter clover supports recovery');

select lives_ok($$ select public.create_tavern() $$, 'ecosystem provisioning is idempotent');
select is((select count(*) from public.garden_cells), 24::bigint, 'provisioning does not duplicate cells');
select is((select count(*) from public.garden_plants), 7::bigint, 'provisioning does not duplicate plants');
select is((select count(*) from public.garden_daily_grants), 1::bigint, 'provisioning does not duplicate starter grants');

select ok(public.project_garden_day() is not null, 'the current day has a projection');
select ok(length(public.project_garden_day()->>'planFingerprint')=32, 'projection has a garden plan fingerprint');
select is(public.project_garden_day()->>'planFingerprint',public.project_garden_day()->>'planFingerprint',
  'repeated projections are stable');

create temporary table projected_plan as
select public.project_garden_day() plan;
create temporary table advance_receipts (receipt jsonb);

select lives_ok(
  $$ insert into advance_receipts select public.advance_tavern_day(
    (select id from public.tavern_saves),
    '16000000-0000-4000-8000-000000000010',0) $$,
  'an optional-crafting day can advance with the garden resolver'
);
select is((select current_day from public.tavern_saves),2,'day advances once');
select is((select revision from public.tavern_saves),1::bigint,'combined NPC and garden advance changes revision once');
select is((select count(*) from public.garden_day_resolutions),1::bigint,'one garden resolution is committed');
select is(
  (select plan_fingerprint from public.garden_day_resolutions),
  (select plan->>'planFingerprint' from projected_plan),
  'committed garden plan matches the prior projection'
);
select is((select count(*) from public.garden_daily_grants where day_number=2),1::bigint,'next-day basic grant is recorded once');
select is((select quantity from public.garden_inventory where item_key='seed_hops'),3,'daily grant adds one productive seed');
select is((select count(*) from public.garden_weather where day_number between 2 and 4),3::bigint,
  'forecast rolls forward to three persisted days');

select lives_ok(
  $$ insert into advance_receipts select public.advance_tavern_day(
    (select id from public.tavern_saves),
    '16000000-0000-4000-8000-000000000010',0) $$,
  'an identical day action replays its saved receipt'
);
select is(
  (select receipt from advance_receipts offset 0 limit 1),
  (select receipt from advance_receipts offset 1 limit 1),
  'day replay returns the exact saved receipt including garden report and fingerprint'
);
select ok(
  (select receipt ? 'gardenReport' and receipt ? 'gardenPlanFingerprint' from advance_receipts limit 1),
  'the returned day receipt exposes the committed garden report and fingerprint'
);
select is((select revision from public.tavern_saves),1::bigint,'day replay does not change revision');
select is((select count(*) from public.garden_day_resolutions),1::bigint,'day replay does not resolve twice');
select is((select count(*) from public.garden_daily_grants where day_number=2),1::bigint,'day replay does not grant twice');

select throws_ok(
  $$ select public.advance_tavern_day(
    (select id from public.tavern_saves),
    '16000000-0000-4000-8000-000000000011',0) $$,
  'PT409','Tavern state changed; refresh before closing','a stale day transition is rejected'
);
select is((select revision from public.tavern_saves),1::bigint,'stale day transition leaves revision unchanged');
select is((select count(*) from public.garden_day_resolutions),1::bigint,'stale day transition creates no resolution');

select lives_ok(
  $$ select public.harvest_crop(
    (select id from public.tavern_saves),
    (select id from public.garden_cells where layout_key='c0'),
    '16000000-0000-4000-8000-000000000020',1) $$,
  'a retained mature crop harvests through the new plant model'
);
select is((select kind from public.garden_cells where layout_key='c0'),'plant','a regrowing crop retains its cell occupancy');
select is((select lifecycle from public.garden_plants p join public.garden_cells c on c.id=p.cell_id where c.layout_key='c0'),
  'regrowing','harvest begins the authored regrowth cycle');
select is((select quantity from public.ingredient_batches where plant_key='hops'),1,
  'harvest uses accumulated eligibility rather than immediate hive adjacency');
select is((select revision from public.tavern_saves),2::bigint,'harvest advances revision exactly once');

select * from finish();
rollback;
