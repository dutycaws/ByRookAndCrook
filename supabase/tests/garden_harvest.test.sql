begin;

create extension if not exists pgtap with schema extensions;
select plan(60);

insert into auth.users (id, email, role, aud, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'db-one@example.test', 'authenticated', 'authenticated', now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'db-two@example.test', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok($$ select public.create_tavern() $$, 'an authenticated player can create a tavern');
select is((select count(*) from public.tavern_saves), 1::bigint, 'the player sees one save');
select is((select count(*) from public.garden_cells), 12::bigint, 'the save has twelve starter cells');
select lives_ok($$ select public.create_tavern() $$, 'creating again is idempotent');
select is((select count(*) from public.garden_cells), 12::bigint, 'creating again does not reseed cells');

select is((public.get_tavern_snapshot() #>> '{cells,0,preview,quantity}')::integer, 1, 'c0 does not receive the distant hive bonus');
select is((public.get_tavern_snapshot() #>> '{cells,1,preview,quantity}')::integer, 2, 'c1 receives the adjacent hive bonus');
select is((public.get_tavern_snapshot() #>> '{cells,0,preview,qualityIndex}')::integer, 5, 'mature healthy hops are Legendary');
select is((public.get_tavern_snapshot() #>> '{cells,4,harvestable}')::boolean, false, 'stage two pepper is not harvestable');

select lives_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c0'),
      '20000000-0000-4000-8000-000000000001', 0
    )
  $$,
  'a mature crop can be harvested'
);
select is((select kind from public.garden_cells where layout_key = 'c0'), 'empty', 'harvest clears the cell');
select is((select count(*) from public.ingredient_batches), 1::bigint, 'harvest creates one batch');
select is((select quantity from public.ingredient_batches limit 1), 1, 'hops batch has one unit');
select is((select quality_index from public.ingredient_batches limit 1), 5::smallint, 'hops batch keeps quality');
select is((select brew_bonus from public.ingredient_batches limit 1), 4::smallint, 'hops batch keeps brew modifier');
select is((select bake_bonus from public.ingredient_batches limit 1), 0::smallint, 'hops batch keeps bake modifier');
select is((select revision from public.tavern_saves), 1::bigint, 'harvest advances revision once');

select lives_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c0'),
      '20000000-0000-4000-8000-000000000001', 0
    )
  $$,
  'an identical action replay returns its original receipt'
);
select is((select count(*) from public.ingredient_batches), 1::bigint, 'replay does not create another batch');
select is((select revision from public.tavern_saves), 1::bigint, 'replay does not advance revision');
select throws_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c4'),
      '20000000-0000-4000-8000-000000000001', 0
    )
  $$,
  'PT409', 'Action identifier was already used for a different request',
  'an action identifier cannot be reused with changed input'
);
select throws_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c4'),
      '20000000-0000-4000-8000-000000000002', 1
    )
  $$,
  'PT422', 'Only a mature crop can be harvested',
  'an immature crop is rejected'
);
select is((select revision from public.tavern_saves), 1::bigint, 'rejected harvest does not change revision');
select throws_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c0'),
      '20000000-0000-4000-8000-000000000006', 1
    )
  $$,
  'PT422', 'Only a mature crop can be harvested',
  'an empty cell is rejected'
);
select throws_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c2'),
      '20000000-0000-4000-8000-000000000007', 1
    )
  $$,
  'PT422', 'Only a mature crop can be harvested',
  'a hive is rejected'
);
select throws_ok(
  $$
    select public.harvest_crop(
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000008', 1
    )
  $$,
  'PT404', 'Tavern or garden cell not found',
  'a missing save is rejected without leaking data'
);
select lives_ok($$ select public.create_tavern() $$, 'initializing after a harvest remains idempotent');
select is((select kind from public.garden_cells where layout_key = 'c0'), 'empty', 'initializing again does not refill a harvested cell');
select is((select count(*) from public.ingredient_batches), 1::bigint, 'initializing again preserves existing ingredients');

reset role;
update public.garden_cells
set kind = 'beehive', plant_key = null, growth_stage = null, water = null, health = null
where layout_key = 'c3';
set local role authenticated;

select lives_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c1'),
      '20000000-0000-4000-8000-000000000003', 1
    )
  $$,
  'fennel can be harvested with two adjacent hives'
);
select is((select quantity from public.ingredient_batches where plant_key = 'fennel'), 2, 'multiple hives do not stack the yield bonus');
select is((select revision from public.tavern_saves), 2::bigint, 'second harvest advances revision');

reset role;
create function private.fail_test_harvest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'test harvest failure';
end;
$$;
create trigger fail_test_harvest
before insert on public.ingredient_batches
for each row execute function private.fail_test_harvest();
set local role authenticated;

select throws_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves limit 1),
      (select id from public.garden_cells where layout_key = 'c7'),
      '20000000-0000-4000-8000-000000000004', 2
    )
  $$,
  'P0001', 'test harvest failure',
  'a mid-transaction failure is surfaced'
);
select is((select kind from public.garden_cells where layout_key = 'c7'), 'plant', 'failed harvest restores the crop');
select is((select count(*) from public.ingredient_batches), 2::bigint, 'failed harvest creates no batch');
select is((select count(*) from public.game_actions), 2::bigint, 'failed harvest creates no receipt');
select is((select revision from public.tavern_saves), 2::bigint, 'failed harvest does not advance revision');

reset role;
drop trigger fail_test_harvest on public.ingredient_batches;
drop function private.fail_test_harvest();
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

select lives_ok($$ select public.create_tavern() $$, 'a second player can create a tavern');
select is((select count(*) from public.tavern_saves), 1::bigint, 'RLS exposes only the second player save');
select is((select count(*) from public.garden_cells), 12::bigint, 'RLS exposes only the second player garden');
select is((public.get_tavern_snapshot() #>> '{save,revision}')::integer, 0, 'second player gets independent state');
select throws_ok(
  $$
    select public.harvest_crop(
      (select id from public.tavern_saves where user_id = '10000000-0000-4000-8000-000000000002'),
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000005', 0
    )
  $$,
  'PT404', 'Tavern or garden cell not found',
  'foreign and missing cells share a safe not-found response'
);

select throws_ok(
  $$ update public.garden_cells set kind = 'empty' where true $$,
  '42501', null,
  'authenticated players cannot update game tables directly'
);
select ok(not has_function_privilege('anon', 'public.get_tavern_snapshot()', 'EXECUTE'), 'anonymous clients cannot call snapshot');
select ok(not has_function_privilege('anon', 'public.create_tavern()', 'EXECUTE'), 'anonymous clients cannot call create');
select ok(not has_function_privilege('anon', 'public.harvest_crop(uuid,uuid,uuid,bigint)', 'EXECUTE'), 'anonymous clients cannot call harvest');

reset role;
select is((select count(*) from public.plant_catalog), 7::bigint, 'all seven prototype plants are versioned content');
select results_eq(
  $$
    select plant_key, base_brew_bonus, base_bake_bonus
    from public.plant_catalog
    where rules_version = 'harvest-v1'
    order by plant_key
  $$,
  $$
    values
      ('chamomile'::text, 2::smallint, 1::smallint),
      ('fennel'::text, 1::smallint, 2::smallint),
      ('hops'::text, 2::smallint, 0::smallint),
      ('lavender'::text, 2::smallint, 1::smallint),
      ('pepper'::text, 0::smallint, 2::smallint),
      ('sage'::text, 0::smallint, 2::smallint),
      ('tomatoes'::text, 0::smallint, 1::smallint)
  $$,
  'the complete harvest-v1 modifier table matches the prototype adaptation'
);
select is(private.quality_index(3::smallint, 49::smallint), 3::smallint, 'health 49 adds no quality');
select is(private.quality_index(3::smallint, 50::smallint), 4::smallint, 'health 50 adds one quality');
select is(private.quality_index(3::smallint, 79::smallint), 4::smallint, 'health 79 adds one quality');
select is(private.quality_index(3::smallint, 80::smallint), 5::smallint, 'health 80 adds two quality');
select is(private.hex_distance(0::smallint, 0::smallint, 2::smallint, 0::smallint), 2, 'c0 is two hexes from c2');
select is(private.hex_distance(1::smallint, 0::smallint, 2::smallint, 0::smallint), 1, 'c1 is adjacent to c2');
select is(private.hex_distance(1::smallint, 1::smallint, 2::smallint, 0::smallint), 1, 'odd-row coordinates preserve diagonal adjacency');
select is(private.hex_distance(0::smallint, 3::smallint, 2::smallint, 0::smallint), 3, 'boundary cells remain outside the hive radius');
select throws_ok(
  $$ update public.garden_cells set growth_stage = 4 where layout_key = 'c4' $$,
  '23514', null,
  'growth stage cannot exceed three'
);
select throws_ok(
  $$ update public.garden_cells set health = -1 where layout_key = 'c4' $$,
  '23514', null,
  'health cannot fall below zero'
);
select throws_ok(
  $$ update public.garden_cells set water = 101 where layout_key = 'c4' $$,
  '23514', null,
  'water cannot exceed one hundred'
);
select throws_ok(
  $$ update public.ingredient_batches set quantity = 0 where true $$,
  '23514', null,
  'ingredient quantity must stay positive'
);

select * from finish();
rollback;
