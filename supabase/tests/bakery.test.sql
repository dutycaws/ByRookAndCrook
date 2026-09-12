begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email, role, aud, created_at, updated_at) values
  ('80000000-0000-4000-8000-000000000001', 'bakery-one@example.test', 'authenticated', 'authenticated', now(), now()),
  ('80000000-0000-4000-8000-000000000002', 'bakery-two@example.test', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '80000000-0000-4000-8000-000000000001';

select lives_ok($$select public.create_tavern()$$, 'a keeper can create a tavern');
select lives_ok($$select public.harvest_crop(
  (select id from public.tavern_saves),
  (select id from public.garden_cells where layout_key = 'c1'),
  '78000000-0000-4000-8000-000000000001', 0
)$$, 'a crop is harvested for the bakery');
-- Reserve a second test-only unit so this Bakery file can exercise the
-- following-day active-brew backfill after the bake consumes one unit.
reset role;
update public.ingredient_batches set quantity=2
where source_action_id='78000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.start_bake(
  (select id from public.tavern_saves), (select id from public.ingredient_batches),
  '78000000-0000-4000-8000-000000000002', 1
)$$, 'a daily bake starts');
select is((select daily_craft_kind from public.tavern_saves), 'bake', 'the Bakery reserves the shared daily craft');
select is((public.get_tavern_snapshot() #>> '{bakery,activeSession,status}'), 'folding', 'the active folding stage is visible');
select throws_ok($$select public.advance_tavern_day(
  (select id from public.tavern_saves), '78000000-0000-4000-8000-000000000003', 2
)$$, 'PT422', 'Finish the active bake before closing', 'an active bake blocks closing');
select throws_ok($$select public.start_brew(
  (select id from public.tavern_saves), (select id from public.ingredient_batches),
  '78000000-0000-4000-8000-000000000099', 2
)$$, 'PT422', 'Finish the active bake before starting another craft', 'an active bake blocks a brew');
select throws_ok($$select public.score_bake(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000091', 2, 70
)$$, 'PT422', 'This loaf is not ready to score', 'scoring cannot begin before six folds');
select throws_ok($$select public.begin_bake_oven(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000092', 2
)$$, 'PT422', 'Fold six times and score three times before baking', 'the oven rejects an unprepared loaf');
select throws_ok($$select public.complete_bake(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000093', 2
)$$, 'PT422', 'This loaf is not in the oven', 'completion rejects a loaf outside the oven');
select throws_ok($$select public.fold_bake(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000094', 2, null
)$$, 'PT400', 'Invalid dough fold', 'a null fold is a public validation error');
select throws_ok($$select public.score_bake(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000095', 2, 9
)$$, 'PT400', 'Invalid loaf score', 'a sub-threshold score is a public validation error');

select lives_ok($$
  do $prepare$
  declare v_revision bigint := 2; v_session uuid := (select id from public.bake_sessions);
  begin
    for i in 1..6 loop
      perform public.fold_bake((select id from public.tavern_saves), v_session,
        extensions.gen_random_uuid(), v_revision, 70);
      v_revision := v_revision + 1;
    end loop;
    for i in 1..3 loop
      perform public.score_bake((select id from public.tavern_saves), v_session,
        extensions.gen_random_uuid(), v_revision, 70);
      v_revision := v_revision + 1;
    end loop;
  end $prepare$;
$$, 'six durable folds and three scores complete preparation');
select is((select status from public.bake_sessions), 'ready', 'the prepared loaf is ready for the oven');
select is((select fold_count from public.bake_sessions), 6::smallint, 'six folds are persisted');
select is((select score_count from public.bake_sessions), 3::smallint, 'three scores are persisted');
select is((select revision from public.tavern_saves), 11::bigint, 'every preparation command advances the revision');
select lives_ok($$select public.begin_bake_oven(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000004', 11
)$$, 'the prepared loaf enters the oven');
select is((select status from public.bake_sessions), 'baking', 'the oven stage persists');
select ok((select oven_started_at is not null from public.bake_sessions), 'the server records the oven start');

reset role;
update public.bake_sessions set oven_started_at = clock_timestamp() - interval '30 seconds';
set local role authenticated;

select lives_ok($$select public.complete_bake(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000005', 12
)$$, 'the loaf can be removed in the ideal window');
select is((select timing_band from public.bake_sessions), 'green', 'server elapsed time chooses the green band');
select is((select quality_index from public.bake_sessions), 6::smallint, 'ideal technique and timing yield Resplendent quality');
select is((select status from public.bake_sessions), 'completed', 'the bake completes');
select is((select consumed_quantity from public.ingredient_batches), 1, 'completion consumes one ingredient');
select is((select count(*) from public.foods), 1::bigint, 'completion creates one food item');
select is((select count(*) from public.intent_cards where source_kind = 'bake'), 1::bigint, 'completion creates one bake intent reward');
select ok((select source_food_id = (select id from public.foods) from public.intent_cards where source_kind = 'bake'), 'the intent reward references its food source');
select lives_ok($$select public.complete_bake(
  (select id from public.tavern_saves), (select id from public.bake_sessions),
  '78000000-0000-4000-8000-000000000005', 12
)$$, 'an identical completion retry returns the saved receipt');
select is((select count(*) from public.foods), 1::bigint, 'completion replay creates no duplicate food');
select is((select count(*) from public.intent_cards where source_kind = 'bake'), 1::bigint, 'completion replay creates no duplicate intent');
select throws_ok($$update public.bake_sessions set quality_index = 0$$,
  '42501', null, 'players cannot directly edit bake outcomes');
select lives_ok($$select public.advance_tavern_day(
  (select id from public.tavern_saves), '78000000-0000-4000-8000-000000000006', 13
)$$, 'a completed bake allows the day to close');
select ok((select daily_craft_kind is null from public.tavern_saves), 'the next day resets the shared allocation');

select lives_ok($$select public.start_brew(
  (select id from public.tavern_saves), (select id from public.ingredient_batches),
  '78000000-0000-4000-8000-000000000008', 14
)$$, 'a brew can reserve the following day');
reset role;
update public.tavern_saves set daily_craft_kind = null
where user_id = '80000000-0000-4000-8000-000000000001';
update public.tavern_saves s set daily_craft_kind = 'brew'
where exists (
  select 1 from public.brew_sessions brew
  where brew.save_id = s.id and brew.status = 'active'
);
set local role authenticated;
select is((select daily_craft_kind from public.tavern_saves), 'brew', 'migration backfill restores a current-day brew reservation');
select throws_ok($$select public.start_bake(
  (select id from public.tavern_saves), (select id from public.ingredient_batches),
  '78000000-0000-4000-8000-000000000009', 15
)$$, 'PT422', 'Finish the active brew before starting another craft', 'the backfilled active brew prevents a Bakery craft');

set local request.jwt.claim.sub = '80000000-0000-4000-8000-000000000002';
select lives_ok($$select public.create_tavern()$$, 'a second keeper creates an independent tavern');
select lives_ok($$select public.advance_tavern_day(
  (select id from public.tavern_saves where user_id = auth.uid()),
  '78000000-0000-4000-8000-000000000007', 0
)$$, 'closing without a craft remains valid');
select is((select current_day from public.tavern_saves where user_id = auth.uid()), 2, 'the no-craft tavern advances exactly one day');

select * from finish();
rollback;
