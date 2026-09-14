begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email, role, aud) values
  ('17400000-0000-4000-8000-000000000001', 'close-owner@example.test', 'authenticated', 'authenticated'),
  ('17400000-0000-4000-8000-000000000002', 'other-owner@example.test', 'authenticated', 'authenticated'),
  ('17400000-0000-4000-8000-000000000003', 'quiet-owner@example.test', 'authenticated', 'authenticated'),
  ('17400000-0000-4000-8000-000000000004', 'arrival-author@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000001';
select public.create_tavern();
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000002';
select public.create_tavern();
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000003';
select public.create_tavern();
reset role;

create temporary table pg_temp.worlds as
select
  save.user_id,
  save.id as save_id,
  max(instance.id::text) filter (where instance.npc_id = '18181818-1818-4181-8181-181818181818')::uuid as lira,
  max(instance.id::text) filter (where instance.npc_id = '28282828-2828-4282-8282-282828282828')::uuid as torvin
from public.tavern_saves save
join private.world_npc_instances instance on instance.save_id = save.id
where save.user_id in (
  '17400000-0000-4000-8000-000000000001',
  '17400000-0000-4000-8000-000000000002',
  '17400000-0000-4000-8000-000000000003'
)
group by save.user_id, save.id;
grant select on pg_temp.worlds to authenticated, service_role;

-- Give the primary save room for a deterministic community arrival. Its
-- instance is created after settlement inputs are frozen.
update public.tavern_saves
set community_npc_level = 2
where user_id = '17400000-0000-4000-8000-000000000001';
insert into private.npc_identities(
  id, origin, creator_id, normalized_name, status, rating
) values (
  '17400000-1000-4000-8000-000000000001', 'community',
  '17400000-0000-4000-8000-000000000004', 'day close arrival', 'published', 'standard'
);
insert into private.npc_versions(
  id, npc_id, version_number, sheet, sheet_hash, state, created_by, published_at
)
select
  '17400000-2000-4000-8000-000000000001',
  '17400000-1000-4000-8000-000000000001',
  1, sheet, 'day-close-arrival-v1', 'published',
  '17400000-0000-4000-8000-000000000004', now()
from private.npc_versions
where id = '18181818-1818-4181-8181-181818181819';
update private.npc_identities
set current_published_version_id = '17400000-2000-4000-8000-000000000001'
where id = '17400000-1000-4000-8000-000000000001';

-- The current runtime stores conversations by resident instance. Distinct
-- wording makes cross-resident and cross-save leaks observable.
insert into private.world_npc_dialogue_turns(
  id, save_id, instance_id, npc_id, version_id, actor_id, message,
  input_sequence, source_revision, day_number, status, fence, lease_until,
  result, completed_at
)
select
  '17400000-3000-4000-8000-000000000001'::uuid, world.save_id, world.lira,
  instance.npc_id, instance.version_id, world.user_id,
  'Lira, I will guard the moonlit road.', 0, 0, 1, 'completed',
  '17400000-3000-4000-8000-000000000011'::uuid, now(),
  '{"reply":"Then I will trust you with the western watch.","relationshipChange":2,"intention":null,"serving":null}'::jsonb,
  now()
from pg_temp.worlds world
join private.world_npc_instances instance on instance.id = world.lira
where world.user_id = '17400000-0000-4000-8000-000000000001'
union all
select
  '17400000-3000-4000-8000-000000000002'::uuid, world.save_id, world.torvin,
  instance.npc_id, instance.version_id, world.user_id,
  'Torvin, your ledger exposed the false merchant.', 0, 0, 1, 'completed',
  '17400000-3000-4000-8000-000000000012'::uuid, now(),
  '{"reply":"A fair account protects us all.","relationshipChange":-2,"intention":null,"serving":null}'::jsonb,
  now()
from pg_temp.worlds world
join private.world_npc_instances instance on instance.id = world.torvin
where world.user_id = '17400000-0000-4000-8000-000000000001'
union all
select
  '17400000-3000-4000-8000-000000000003'::uuid, world.save_id, world.lira,
  instance.npc_id, instance.version_id, world.user_id,
  'The silver vault is beneath the other tavern.', 0, 0, 1, 'completed',
  '17400000-3000-4000-8000-000000000013'::uuid, now(),
  '{"reply":"That secret stays in this save.","relationshipChange":2,"intention":null,"serving":null}'::jsonb,
  now()
from pg_temp.worlds world
join private.world_npc_instances instance on instance.id = world.lira
where world.user_id = '17400000-0000-4000-8000-000000000002';

insert into private.world_npc_quest_events(
  id, instance_id, day, outcome, draw, chance, narration, public_news
)
select
  '17400000-4000-4000-8000-000000000001', world.lira, 1,
  'prepared', null, null, 'Lira mapped the western road before dusk.', false
from pg_temp.worlds world
where world.user_id = '17400000-0000-4000-8000-000000000001';

-- Build two current-runtime food outputs so one can support authoritative
-- hospitality evidence and the second can exercise the settling guard.
insert into public.foods(
  id, save_id, name, recipe_key, quality_index, day_number, source_action_id
)
select fixture.food_id, world.save_id, fixture.name, fixture.recipe_key,
  fixture.quality, 1, fixture.action_id
from pg_temp.worlds world
cross join (values
  ('17400000-6000-4000-8000-000000000001'::uuid, 'Bright Evidence Loaf', 'evidence-loaf', 5::smallint,
    '17400000-5000-4000-8000-000000000001'::uuid),
  ('17400000-6000-4000-8000-000000000002'::uuid, 'Guard Test Loaf', 'guard-loaf', 3::smallint,
    '17400000-5000-4000-8000-000000000002'::uuid)
) fixture(food_id, name, recipe_key, quality, action_id)
where world.user_id = '17400000-0000-4000-8000-000000000001';
insert into private.world_npc_hospitality_events(
  save_id, action_id, actor_id, instance_id, item_kind, food_id,
  input_expected_revision, day_number, item_name, quality_index,
  gold_earned, relationship_change, result, committed_revision
)
select
  world.save_id, '17400000-7000-4000-8000-000000000001', world.user_id,
  world.torvin, 'food', '17400000-6000-4000-8000-000000000001',
  0, 1, 'Bright Evidence Loaf', 5, 25, 2,
  '{"itemName":"Bright Evidence Loaf","relationshipChange":2}'::jsonb, 1
from pg_temp.worlds world
where world.user_id = '17400000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000001';
create temporary table pg_temp.close as
select public.advance_tavern_day(
  (select save_id from pg_temp.worlds where user_id = '17400000-0000-4000-8000-000000000001'),
  '17400000-8000-4000-8000-000000000001', 0
) result;
grant select on pg_temp.close to authenticated, service_role;

select ok((select result ? 'newDay'
  and result ? 'gardenReport'
  and result ? 'communityNpcEvents'
  and result ? 'communityArrival'
  and result ? 'worldSettlement' from pg_temp.close),
  'close preserves current deterministic projections and adds settlement');
select is((select result#>>'{worldSettlement,status}' from pg_temp.close), 'queued',
  'close returns only a safe queued settlement summary');
select is((select result#>>'{worldSettlement,dayNumber}' from pg_temp.close), '1',
  'settlement summary identifies the closed day');
reset role;

create temporary table pg_temp.settlement as
select settlement.*
from private.world_settlements settlement
join pg_temp.close close_receipt
  on settlement.id = (close_receipt.result#>>'{worldSettlement,settlementId}')::uuid;
grant select on pg_temp.settlement to authenticated, service_role;

select is((select world_phase from public.tavern_saves where id = (select save_id from pg_temp.settlement)),
  'settling', 'successful close enters settling phase');
select is((select day_number from pg_temp.settlement), 1,
  'settlement is pinned to the closed day rather than the new day');
select is((select source_revision from pg_temp.settlement),
  (select revision from public.tavern_saves where id = (select save_id from pg_temp.settlement)),
  'settlement pins the post-close revision');
select is((select action_id from pg_temp.settlement), '17400000-8000-4000-8000-000000000001'::uuid,
  'settlement persists the day-close action replay identity');
select is(
  (select result from public.craft_actions where save_id = (select save_id from pg_temp.settlement)
    and action_id = '17400000-8000-4000-8000-000000000001'),
  (select result from pg_temp.close),
  'the enriched world settlement receipt is stored for exact replay');

select is((
  select array_agg(job_kind order by ordinal)
  from private.world_settlement_jobs
  where settlement_id = (select id from pg_temp.settlement)
), array['snapshot', 'canon', 'resident', 'resident', 'quest', 'effects', 'news', 'finalize', 'social_encounter']::text[],
  'two deterministic resident jobs and one attributable social encounter are queued in order');
select is((
  select count(*) from private.world_settlement_jobs
  where settlement_id = (select id from pg_temp.settlement) and job_kind = 'resident'
), 2::bigint, 'both evidence-bearing pilot residents receive independent jobs');
select ok((
  select bool_and(subject_instance_id::text = input_snapshot#>>'{evolution,residentId}'
    and input_snapshot#>>'{evolution,worldSnapshot,currentDay}' = '2'
    and input_snapshot#>'{evolution,worldSnapshot,entityKinds}' ? subject_instance_id::text
    and jsonb_array_length(input_snapshot#>'{evolution,authorizedEvidence}') between 1 and 8)
  from private.world_settlement_jobs
  where settlement_id = (select id from pg_temp.settlement) and job_kind = 'resident'
), 'every resident job has a full subject-bound, new-day evolution envelope');
select ok((
  select bool_and(evidence->>'id' ~ '^[a-z][a-z0-9_-]{1,127}$'
    and evidence->>'sourceFingerprint' ~ '^[a-f0-9]{64}$')
  from private.world_settlement_jobs job
  cross join lateral jsonb_array_elements(job.input_snapshot#>'{evolution,authorizedEvidence}') evidence
  where job.settlement_id = (select id from pg_temp.settlement) and job.job_kind = 'resident'
), 'frozen evidence has bounded source identities and fingerprints');
select ok((
  select job.input_snapshot#>'{evolution,authorizedEvidence}' @>
    '[{"id":"dialogue-17400000300040008000000000000001"},{"id":"quest-17400000400040008000000000000001"}]'::jsonb
  from private.world_settlement_jobs job
  join pg_temp.worlds world on world.lira = job.subject_instance_id
  where world.user_id = '17400000-0000-4000-8000-000000000001'
    and job.settlement_id = (select id from pg_temp.settlement)
), 'Lira receives only her dialogue and quest outcome evidence');
select ok((
  select job.input_snapshot#>'{evolution,authorizedEvidence}' @>
    '[{"id":"dialogue-17400000300040008000000000000002"},{"id":"hospitality-17400000700040008000000000000001"}]'::jsonb
  from private.world_settlement_jobs job
  join pg_temp.worlds world on world.torvin = job.subject_instance_id
  where world.user_id = '17400000-0000-4000-8000-000000000001'
    and job.settlement_id = (select id from pg_temp.settlement)
), 'Torvin receives only his dialogue and hospitality evidence');
select ok(not exists (
  select 1
  from private.world_settlement_jobs job
  cross join lateral jsonb_array_elements(job.input_snapshot#>'{evolution,authorizedEvidence}') evidence
  where job.settlement_id = (select id from pg_temp.settlement)
    and evidence->>'summary' like '%silver vault%'
), 'another save conversation never enters either resident envelope');

select is((select result#>>'{communityArrival,arrived}' from pg_temp.close), 'true',
  'the deterministic community arrival still occurs');
select ok(not exists (
  select 1
  from private.world_settlement_jobs job
  join private.world_npc_instances instance on instance.id = job.subject_instance_id
  where job.settlement_id = (select id from pg_temp.settlement)
    and instance.npc_id = '17400000-1000-4000-8000-000000000001'
), 'a new-day arrival is excluded from the already-frozen closing-day residents');

select throws_ok(format(
  'insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,subject_instance_id,input_fingerprint,input_snapshot,input_version) values (%L,20,''resident'',%L,repeat(''f'',64),''{}''::jsonb,''test-v1'')',
  (select id from pg_temp.settlement),
  (select lira from pg_temp.worlds where user_id = '17400000-0000-4000-8000-000000000003')
), '23514', null, 'a resident job cannot point at a subject from another save');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select throws_ok(format(
  'select public.npc_dialogue_begin(%L,%L,%L,%L,0,null,null,null)',
  '17400000-0000-4000-8000-000000000001',
  '17400000-9000-4000-8000-000000000001',
  '18181818-1818-4181-8181-181818181818',
  'Can we talk while the world is settling?'
), 'PT409', null, 'a new runtime dialogue cannot start while the world is settling');
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000001';
select throws_ok(format(
  'select public.npc_serve_hospitality(%L,%L,''food'',%L,%L,1)',
  (select save_id from pg_temp.settlement),
  (select lira from pg_temp.worlds where user_id = '17400000-0000-4000-8000-000000000001'),
  '17400000-6000-4000-8000-000000000002',
  '17400000-9000-4000-8000-000000000002'
), 'PT409', null, 'a fresh player mutation rolls back while settlement is active');

select throws_ok(format(
  'select public.harvest_crop(%L,%L,%L,1)',
  (select save_id from pg_temp.settlement),
  (select id from public.garden_cells
    where save_id = (select save_id from pg_temp.settlement) and layout_key = 'c1'),
  '17400000-9000-4000-8000-000000000003'
), 'PT409', null, 'a fresh garden mutation rolls back while settlement is active');
select is((select count(*) from public.game_actions
  where save_id = (select save_id from pg_temp.settlement)
    and action_id = '17400000-9000-4000-8000-000000000003'),
  0::bigint, 'the rejected garden mutation leaves no replay receipt');

create temporary table pg_temp.replay_active as
select public.advance_tavern_day(
  (select save_id from pg_temp.settlement),
  '17400000-8000-4000-8000-000000000001', 0
) result;
select is((select result from pg_temp.replay_active), (select result from pg_temp.close),
  'exact day-close replay returns its stored receipt while settlement is active');
reset role;

-- Drive the real worker terminal path. The service role is the only runtime
-- authority permitted to process jobs and reopen a settled save.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
declare
  settlement_id uuid := (select id from pg_temp.settlement);
  claim jsonb;
  processed integer := 0;
begin
  loop
    claim := public.world_settlement_claim(settlement_id);
    exit when not (claim ? 'jobId');
    perform public.world_settlement_safe_result(
      settlement_id,
      (claim->>'jobId')::uuid,
      (claim->>'fence')::uuid,
      'no_changes',
      'The tavern settles without a public change.'
    );
    processed := processed + 1;
    if processed > 16 then
      raise exception 'worker fixture exceeded its bounded job count';
    end if;
  end loop;
end;
$$;
reset role;
select is((select status from private.world_settlements where id = (select id from pg_temp.settlement)),
  'completed', 'the real worker completion path terminalizes the settlement');
select is((select world_phase from public.tavern_saves where id = (select save_id from pg_temp.settlement)),
  'open', 'the terminal service worker path reopens the save');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000001';
create temporary table pg_temp.replay_reopened as
select public.advance_tavern_day(
  (select save_id from pg_temp.settlement),
  '17400000-8000-4000-8000-000000000001', 0
) result;
select is((select result from pg_temp.replay_reopened), (select result from pg_temp.close),
  'exact replay remains stable after settlement reopens the save');
select throws_ok(format(
  'select public.advance_tavern_day(%L,%L,1)',
  (select save_id from pg_temp.settlement),
  '17400000-8000-4000-8000-000000000001'
), 'PT409', null, 'reusing the action with different input remains a conflict');
reset role;
select is((select count(*) from private.world_settlements where save_id = (select save_id from pg_temp.settlement)),
  1::bigint, 'replays never create a second settlement');

-- A separate save with no meaningful evidence still settles deterministically,
-- but never receives a fabricated resident evolution job.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '17400000-0000-4000-8000-000000000003';
create temporary table pg_temp.quiet_close as
select public.advance_tavern_day(
  (select save_id from pg_temp.worlds where user_id = '17400000-0000-4000-8000-000000000003'),
  '17400000-8000-4000-8000-000000000003', 0
) result;
reset role;
select is((
  select array_agg(job_kind order by ordinal)
  from private.world_settlement_jobs
  where settlement_id = (select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.quiet_close)
), array['snapshot', 'canon', 'quest', 'effects', 'news', 'finalize']::text[],
  'no-evidence close queues static work without inventing resident evidence');

select ok(not has_function_privilege(
  'authenticated', 'public.world_settlement_enqueue(uuid,uuid,bigint,jsonb,text)', 'execute'
), 'players cannot inject a settlement or frozen evolution envelope');

select * from finish();
rollback;
