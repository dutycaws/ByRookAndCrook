begin;

create extension if not exists pgtap with schema extensions;
select plan(64);

-- Test-only worker harness: later player commands require the prior day-close
-- settlement to have reached its terminal, open-save state.
create function pg_temp.drain_world_settlement(p_settlement_id uuid) returns void
language plpgsql as $$
declare
  claim jsonb;
  processed integer := 0;
begin
  loop
    claim := public.world_settlement_claim(p_settlement_id);
    exit when not (claim ? 'jobId');
    perform public.world_settlement_safe_result(
      p_settlement_id, (claim->>'jobId')::uuid, (claim->>'fence')::uuid,
      'no_changes', 'Fixture worker completed the settlement.'
    );
    processed := processed + 1;
    if processed > 64 then raise exception 'fixture worker exceeded settlement bound'; end if;
  end loop;
  if claim->>'status' <> 'completed' then
    raise exception 'fixture worker did not terminalize settlement';
  end if;
end;
$$;

create temporary table test_ids (
  key text primary key,
  value uuid not null
) on commit drop;
grant select, insert, update on test_ids to authenticated;

insert into auth.users (id, email, role, aud, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000000001', 'brew-one@example.test', 'authenticated', 'authenticated', now(), now()),
  ('50000000-0000-4000-8000-000000000002', 'brew-two@example.test', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';

select lives_ok($$ select public.create_tavern() $$, 'a brewer can create a tavern');
insert into test_ids values
  ('save-one', (select id from public.tavern_saves)),
  ('fennel-cell', (select id from public.garden_cells where layout_key = 'c1'));

select lives_ok(
  $$
    select public.harvest_crop(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'fennel-cell'),
      '51000000-0000-4000-8000-000000000001', 0
    )
  $$,
  'a one-unit fennel batch is harvested for brewing'
);
insert into test_ids values ('fennel-batch', (select id from public.ingredient_batches));
select is((select quantity - consumed_quantity from public.ingredient_batches), 1, 'one fennel unit begins available');

select lives_ok(
  $$
    select public.start_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'fennel-batch'),
      '52000000-0000-4000-8000-000000000001', 1
    )
  $$,
  'the first daily brew starts'
);
insert into test_ids values ('session-one', (select id from public.brew_sessions));
select is((select count(*) from public.brew_sessions), 1::bigint, 'starting creates one brew session');
select is((select revision from public.tavern_saves), 2::bigint, 'starting advances the save revision');
select ok((public.get_tavern_snapshot() #>> '{brewery,activeSession,id}') is not null, 'snapshot exposes the active brew');
select is((public.get_tavern_snapshot() #>> '{brewery,activeSession,durationSeconds}')::integer, 15,
  'new brews use a fifteen-second scored challenge');
select is((public.get_tavern_snapshot() #>> '{brewery,activeSession,countdownSeconds}')::integer, 2,
  'new brews expose the two-second countdown');
select is(public.get_tavern_snapshot() #>> '{brewery,activeSession,stirRulesVersion}', 'guide-v2',
  'new brews expose their guided rules version');
select is((public.get_tavern_snapshot() #>> '{save,currentDay}')::integer, 1, 'the first brew occurs on day one');
select is((public.get_tavern_snapshot() #>> '{save,dayMinigameCompleted}')::boolean, false, 'starting does not complete the daily craft');

select lives_ok(
  $$
    select public.start_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'fennel-batch'),
      '52000000-0000-4000-8000-000000000001', 1
    )
  $$,
  'an identical start retry returns its receipt'
);
select is((select count(*) from public.brew_sessions), 1::bigint, 'start retry creates no duplicate session');
select is((select revision from public.tavern_saves), 2::bigint, 'start retry does not advance revision');
select throws_ok(
  $$
    select public.start_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'fennel-batch'),
      '52000000-0000-4000-8000-000000000002', 2
    )
  $$,
  'PT409', 'Finish the active brew before starting another craft',
  'a second brew cannot start while one is active'
);
select throws_ok(
  $$
    select public.complete_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'session-one'),
      '53000000-0000-4000-8000-000000000001', 2, 60, 0, 60
    )
  $$,
  'PT422', 'The guided stir is still in progress',
  'the server rejects bottling before countdown and challenge finish'
);
select is((select count(*) from public.beverages), 0::bigint, 'premature bottling creates no beverage');
select is((select consumed_quantity from public.ingredient_batches), 0, 'premature bottling consumes no ingredient');

reset role;
update public.brew_sessions set started_at = clock_timestamp() - interval '18 seconds';
set local role authenticated;

select lives_ok(
  $$
    select public.complete_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'session-one'),
      '53000000-0000-4000-8000-000000000001', 2, 60, 0, 60
    )
  $$,
  'a complete guided stir can be bottled after seventeen seconds'
);
select is((select status from public.brew_sessions), 'completed', 'the brew session is completed');
select is((select quality_index from public.brew_sessions), 6::smallint, 'Legendary fennel plus perfect stirring reaches Resplendent');
select is((select stir_score from public.brew_sessions), 6::smallint, 'perfect stirring earns the maximum stir score');
select is((select count(*) from public.beverages), 1::bigint, 'completion creates one beverage');
select is((select name from public.beverages), 'Ambrosial Draught', 'Resplendent mead receives its versioned name');
select is((select quality_index from public.beverages), 6::smallint, 'the beverage persists its quality');
select is((select consumed_quantity from public.ingredient_batches), 1, 'completion consumes exactly one unit');
select is(jsonb_array_length(public.get_tavern_snapshot() #> '{ingredients}'), 0,
  'snapshot omits the exhausted fennel batch');
select is((select count(*) from public.social_cards), 0::bigint, 'a new brew creates no legacy Pour Ale entitlement');
select is((select count(*) from public.intent_cards where source_kind='brew'), 1::bigint, 'a qualifying brew creates one intent card');
select is((select tier from public.intent_cards where source_kind='brew'), 'exceptional', 'Resplendent brew earns an exceptional intent card');
select is((select card_key from public.intent_cards where source_kind='brew'), 'resolve', 'a Resplendent brew rewards Resolve');
select is((select revision from public.tavern_saves), 3::bigint, 'completion advances revision once');
select is((select day_minigame_completed from public.tavern_saves), true, 'completion records that a craft finished today');
select ok((public.get_tavern_snapshot() #>> '{brewery,activeSession}') is null, 'completed brew is no longer active');

select lives_ok(
  $$
    select public.complete_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'session-one'),
      '53000000-0000-4000-8000-000000000001', 2, 60, 0, 60
    )
  $$,
  'an identical completion retry returns its receipt'
);
select is((select count(*) from public.beverages), 1::bigint, 'completion retry creates no duplicate beverage');
select is((select revision from public.tavern_saves), 3::bigint, 'completion retry does not advance revision');
select throws_ok(
  $$
    select public.complete_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'session-one'),
      '53000000-0000-4000-8000-000000000001', 2, 59, 1, 60
    )
  $$,
  'PT409', 'Action identifier was already used for a different request',
  'a completion action cannot be reused with changed telemetry'
);
select ok((select daily_craft_kind is null from public.tavern_saves),
  'completion releases the craft slot for another same-day batch');

select lives_ok(
  $$ select public.advance_tavern_day(
    (select value from test_ids where key = 'save-one'),
    '54000000-0000-4000-8000-000000000001', 3
  ) $$,
  'a completed day can advance'
);
select is((select current_day from public.tavern_saves), 2, 'the next day is persisted');
select is((select day_minigame_completed from public.tavern_saves), false, 'the new day reopens the daily craft');
select is((select revision from public.tavern_saves), 4::bigint, 'day advance increments revision');
select set_config('app.fixture_settlement_id', public.world_settlement_status((select value from test_ids where key = 'save-one'))->>'id', true);

reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
select pg_temp.drain_world_settlement(current_setting('app.fixture_settlement_id')::uuid);
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';
select is(public.world_settlement_status((select value from test_ids where key = 'save-one'))->>'status', 'completed', 'the fixture worker terminalizes the day settlement');
select is((select world_phase from public.tavern_saves where id = (select value from test_ids where key = 'save-one')), 'open', 'the fixture worker reopens the tavern');

select lives_ok(
  $$ select public.advance_tavern_day(
    (select value from test_ids where key = 'save-one'),
    '54000000-0000-4000-8000-000000000001', 3
  ) $$,
  'an identical day advance retry returns its receipt'
);
select is((select current_day from public.tavern_saves), 2, 'day advance retry does not skip a day');

-- Seed one explicit second-day ingredient without changing modern one-unit
-- harvest provenance.
reset role;
insert into public.game_actions(save_id,action_id,actor_id,command_kind,input_cell_id,
  input_expected_revision,rules_version,result,committed_revision)
values ((select value from test_ids where key='save-one'),
  '51000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001',
  'harvest_crop',(select value from test_ids where key='fennel-cell'),4,
  'garden-apiary-v1','{}'::jsonb,4);
insert into public.ingredient_batches(id,save_id,rules_version,plant_key,quality_index,quantity,
  brew_bonus,bake_bonus,source_cell_id,source_action_id)
values ('51000000-0000-4000-8000-000000000003',
  (select value from test_ids where key='save-one'),'garden-apiary-v1','fennel',6,1,6,4,
  (select value from test_ids where key='fennel-cell'),'51000000-0000-4000-8000-000000000002');
insert into test_ids values ('legacy-fennel-batch','51000000-0000-4000-8000-000000000003');
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    select public.start_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'legacy-fennel-batch'),
      '52000000-0000-4000-8000-000000000004', 4
    )
  $$,
  'the second-day ingredient can start another guided brew'
);
select is((select count(*) from public.brew_sessions), 2::bigint, 'completed history is retained across tavern days');
select is((select revision from public.tavern_saves), 5::bigint, 'the next brew start advances revision');
select throws_ok(
  $$ update public.brew_sessions set status = 'completed' where true $$,
  '42501', null,
  'players cannot update brew sessions directly'
);

set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000002';
select lives_ok($$ select public.create_tavern() $$, 'a second brewer gets an independent tavern');
select throws_ok(
  $$
    select public.start_brew(
      (select value from test_ids where key = 'save-one'),
      (select value from test_ids where key = 'fennel-batch'),
      '52000000-0000-4000-8000-000000000005', 5
    )
  $$,
  'PT404', 'Tavern or ingredient not found',
  'another player cannot start a brew against the first save'
);
select is((select count(*) from public.brew_sessions), 0::bigint, 'RLS hides the first player brew sessions');

select ok(not has_function_privilege('anon', 'public.start_brew(uuid,uuid,uuid,bigint)', 'EXECUTE'), 'anonymous clients cannot start brews');
select ok(not has_function_privilege('anon', 'public.complete_brew(uuid,uuid,uuid,bigint,integer,integer,integer)', 'EXECUTE'), 'anonymous clients cannot complete brews');
select ok(not has_function_privilege('anon', 'public.advance_tavern_day(uuid,uuid,bigint)', 'EXECUTE'), 'anonymous clients cannot advance tavern days');

reset role;
select is(private.brew_name(0::smallint), 'Spoiled Wort', 'the lowest brew name is versioned in SQL');
select is(private.brew_name(6::smallint), 'Ambrosial Draught', 'the highest brew name is versioned in SQL');

set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$
    select public.complete_brew(
      (select value from test_ids where key = 'save-one'),
      (select id from public.brew_sessions where day_number = 2),
      '53000000-0000-4000-8000-000000000002', 5, 2, 2, 3
    )
  $$,
  'PT400', 'Invalid brew completion',
  'invalid telemetry totals are rejected'
);
select throws_ok(
  $$
    select public.complete_brew(
      (select value from test_ids where key = 'save-one'),
      (select id from public.brew_sessions where day_number = 2),
      '53000000-0000-4000-8000-000000000003', 5, 59, 0, 59
    )
  $$,
  'PT400', 'Guided stirring requires a complete scoring record',
  'guide-v2 rejects a partial scoring record'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated', 'public.beverages', 'INSERT'), 'players cannot insert beverages directly');
select is((select quantity from public.ingredient_batches
  where id=(select value from test_ids where key='fennel-batch')), 1,
  'the original harvested batch retains its one-unit provenance');

select * from finish();
rollback;
