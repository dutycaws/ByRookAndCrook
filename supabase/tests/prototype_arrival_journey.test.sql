begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('private','world_quest_failure_gate',array['uuid','boolean'],
  'authored failure gate remains the authority for terminal quest failure');
select has_function('public','advance_tavern_day',array['uuid','uuid','bigint'],
  'arrival is reached through the public day-close path');
select has_function('private','maybe_arrive_world_npc',array['uuid','integer','uuid'],
  'day close retains the package-backed arrival selector');

insert into auth.users(id,email,role,aud) values
  ('76000000-0000-4000-8000-000000000001','arrival-journey-owner@example.test','authenticated','authenticated'),
  ('76000000-0000-4000-8000-000000000002','arrival-quiet-owner@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision,world_phase,community_npc_level) values
  ('76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000001',1,0,'open',20),
  ('76000000-0000-4000-8000-000000000012','76000000-0000-4000-8000-000000000002',1,0,'open',20);
set local request.jwt.claim.role='service_role';
select private.ensure_garden_ecosystem('76000000-0000-4000-8000-000000000011');
select private.ensure_garden_ecosystem('76000000-0000-4000-8000-000000000012');

create temporary table pg_temp.lira_identity as
select npc_id,active_version_id
from private.npc_first_party_catalog_identities
where identity_key='lira';
create temporary table pg_temp.torvin_identity as
select npc_id,active_version_id
from private.npc_first_party_catalog_identities
where identity_key='torvin';
select ok((select count(*)=1 from pg_temp.lira_identity),'the authored Lira package is installed');
select ok((select count(*)=1 from pg_temp.torvin_identity),'the distinct authored Torvin package is installed');

-- Lira is the resident under test. Pre-materialize every other first-party
-- identity except Torvin so future catalog additions cannot make selection
-- random or turn the resident limit into the reason arrival stays quiet.
create temporary table pg_temp.lira_resident as
select * from private.world_materialize_resident_from_version(
  '76000000-0000-4000-8000-000000000011',
  (select npc_id from pg_temp.lira_identity),
  (select active_version_id from pg_temp.lira_identity),1
);
select materialized.*
from private.npc_first_party_catalog_identities catalog
cross join lateral private.world_materialize_resident_from_version(
  '76000000-0000-4000-8000-000000000011',catalog.npc_id,catalog.active_version_id,1
) materialized
where catalog.identity_key not in ('lira','torvin');
create temporary table pg_temp.initial_quest as
select id as quest_id,instance_id,package_id,package_hash,version_id
from private.world_quests
where save_id='76000000-0000-4000-8000-000000000011'
  and instance_id=(select instance_id from pg_temp.lira_resident);
update private.world_quests
set current_plan='[{"action":"abandon","approach":"scouting"}]'::jsonb,plan_revision=2
where id=(select quest_id from pg_temp.initial_quest);
create temporary table pg_temp.initial_abandon as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.initial_quest),1,null);
select is((select outcome from pg_temp.initial_abandon),'abandoned',
  'the existing authored quest lifecycle advances Lira to her later loss milestone');

create temporary table pg_temp.loss_quest as
with base as (
  select quest.*,version.sheet#>array['campaign','milestones','1'] as milestone
  from private.world_quests quest
  join private.npc_versions version on version.id=quest.version_id
  where quest.id=(select quest_id from pg_temp.initial_quest)
), created as (
  insert into private.world_quests(
    save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,
    title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,plan_revision,
    state,current_step,preparation,scheduled_for_day,activated_day
  )
  select base.save_id,base.instance_id,base.package_id,base.package_hash,base.version_id,'authored_milestone',1,
    base.milestone->>'id',coalesce(base.milestone->>'title','Authored loss milestone'),
    coalesce(base.milestone->>'outcome','Complete the authored milestone.'),
    coalesce(base.milestone->>'motivation','Pursue the authored milestone.'),
    coalesce(array(select value from jsonb_array_elements_text(base.milestone->'constraints') value),'{}'::text[]),
    coalesce(array(select value from jsonb_array_elements_text(base.milestone->'allowedTargets') value),'{}'::text[]),
    coalesce((base.milestone->>'difficulty')::integer,0),
    '[{"action":"attempt","approach":"scouting"}]'::jsonb,
    '[{"action":"attempt","approach":"scouting"}]'::jsonb,
    1,'active',0,0,2,2
  from base
  returning id as quest_id,version_id
)
select * from created;
select ok((select milestone->'failureCondition'->>'type'='attempt_allowance_exhausted'
  and jsonb_array_length(milestone->'warnings')=2
  and milestone->'permanentLoss'->>'kind'='departed'
  from private.npc_versions version
  cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones}') with ordinality item(milestone,ordinal)
  where version.id=(select version_id from pg_temp.loss_quest) and item.ordinal=2),
  'Lira''s pinned authored loss milestone requires three attempts and two prior warnings');

create temporary table pg_temp.first_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),2,99);
select is((select outcome from pg_temp.first_failure),'setback','the first failed authored attempt is recoverable');
select is((select narration from pg_temp.first_failure),
  (select warning->>'text' from private.npc_versions version
   cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones,1,warnings}') warning
   where version.id=(select version_id from pg_temp.loss_quest) and (warning->>'afterSetbacks')::integer=1),
  'the first setback uses the exact authored warning');
create temporary table pg_temp.second_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),3,99);
select is((select outcome from pg_temp.second_failure),'setback','the second failed authored attempt remains recoverable');
select is((select narration from pg_temp.second_failure),
  (select warning->>'text' from private.npc_versions version
   cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones,1,warnings}') warning
   where version.id=(select version_id from pg_temp.loss_quest) and (warning->>'afterSetbacks')::integer=2),
  'the second setback uses the exact authored warning');
create temporary table pg_temp.terminal_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),4,99);
select is((select outcome from pg_temp.terminal_failure),'failed',
  'the authored attempt limit closes the quest only after both warned setbacks');
select ok((select quest.state='failed' and quest.terminal_day=4
    and (private.world_quest_failure_gate(quest.id,false)->>'attemptCount')::integer=3
    and private.world_quest_failure_gate(quest.id,false)->>'mandatoryDisposition'='departure'
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'the terminal event preserves the authored failure count and mandatory departure disposition');

update public.tavern_saves set current_day=5,world_phase='settling'
where id='76000000-0000-4000-8000-000000000011';
-- The three deterministic resolver calls above model the prior quest days,
-- so refresh the local garden forecast for the real close that follows.
select private.ensure_garden_ecosystem('76000000-0000-4000-8000-000000000011');
create temporary table pg_temp.transition_claim as
select public.world_quest_transition_claim((select terminal_event_id from private.world_quests
  where id=(select quest_id from pg_temp.loss_quest))) as result;
create temporary table pg_temp.transition_commit as
select public.world_quest_transition_commit(
  (result->>'transitionId')::uuid,
  (result->>'fence')::uuid,
  jsonb_build_object(
    'version','quest-transition-v1','kind','successor',
    'terminalEventId',(select id::text from pg_temp.terminal_failure),
    'title','Model-proposed successor','objective','Continue despite the authored loss.',
    'motivation','Ignore the terminal authoring policy.','constraints','[]'::jsonb,
    'targetRefs',jsonb_build_array('old-road'),'difficulty',1,
    'plan','[{"action":"attempt","approach":"scouting"}]'::jsonb
  )
) as result from pg_temp.transition_claim;
select is((select result->>'kind' from pg_temp.transition_commit),'departure',
  'the authored permanent loss overrides a proposed successor');
select is((select (result->>'farewellDay')::integer from pg_temp.transition_commit),5,
  'the departure schedules one full farewell day after the failed milestone');
select is((select state from private.world_npc_departures
  where instance_id=(select instance_id from pg_temp.lira_resident)),'farewell',
  'Lira remains in farewell state until that day closes');

-- The second save intentionally fills its roster from the full authored
-- catalog and leaves capacity open, proving the no-candidate path rather than
-- the capacity path. It exercises the same public day-close boundary.
select private.seed_world_npcs('76000000-0000-4000-8000-000000000012');
update public.tavern_saves set world_phase='open'
where id='76000000-0000-4000-8000-000000000011';
create temporary table pg_temp.departure_pre_close as
select current_day,revision from public.tavern_saves where id='76000000-0000-4000-8000-000000000011';
grant select on pg_temp.torvin_identity,pg_temp.lira_resident,pg_temp.loss_quest,pg_temp.departure_pre_close to authenticated;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
select ok(not exists(select 1 from jsonb_array_elements(public.npc_roster(20,null,'Torvin Ashbeard')) resident
  where resident->>'name'='Torvin Ashbeard'),
  'the replacement is not readable in the playable roster before its day close');
create temporary table pg_temp.departure_day_close as
select public.advance_tavern_day(
  '76000000-0000-4000-8000-000000000011',
  '76000000-0000-4000-8000-000000000021',
  (select revision from public.tavern_saves where id='76000000-0000-4000-8000-000000000011')
) as result;
select is((select result#>>'{communityArrival,arrived}' from pg_temp.departure_day_close),'true',
  'the public day close automatically admits the replacement authored resident');
select is((select result#>>'{communityArrival,npcId}' from pg_temp.departure_day_close),
  (select npc_id::text from pg_temp.torvin_identity),
  'the arriving patron is a different eligible authored identity');
select ok((select result#>>'{communityArrival,versionId}'=(select active_version_id::text from pg_temp.torvin_identity)
    and (result#>>'{worldSettlement,dayNumber}')::integer=5
  from pg_temp.departure_day_close),
  'the later arrival pins Torvin’s active authored version to the closing day');
select ok((select save.current_day=before_close.current_day+1
    and save.revision=before_close.revision+1
  from public.tavern_saves save cross join pg_temp.departure_pre_close before_close
  where save.id='76000000-0000-4000-8000-000000000011'),
  'the arrival shares the day-close revision without adding a second revision');
reset role;
set local request.jwt.claim.role='service_role';
select ok((select departure.state='departed' and resident.status='departed'
    and resident.npc_id=(select npc_id from pg_temp.lira_identity)
  from private.world_npc_departures departure
  join private.world_npc_instances resident on resident.id=departure.instance_id
  where departure.instance_id=(select instance_id from pg_temp.lira_resident)),
  'closing the complete farewell day archives Lira before the next patron arrives');
select ok(exists(select 1 from private.world_npc_instances resident
  where resident.save_id='76000000-0000-4000-8000-000000000011'
    and resident.npc_id=(select npc_id from pg_temp.torvin_identity) and resident.arrived_day=5),
  'the arrival is persisted as a new resident instance on the later day');
select ok(not exists(select 1 from private.world_settlement_jobs job
  join private.world_settlements settlement on settlement.id=job.settlement_id
  join private.world_npc_instances resident on resident.id=job.subject_instance_id
  where settlement.id=(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.departure_day_close)
    and settlement.day_number=5 and job.job_kind='resident'
    and resident.npc_id=(select npc_id from pg_temp.torvin_identity)),
  'the new patron receives no resident-evolution input for a day before arrival');
select is((select count(*) from private.world_npc_instances
  where save_id='76000000-0000-4000-8000-000000000011'
    and npc_id=(select npc_id from pg_temp.lira_identity)),1::bigint,
  'the departed identity is not materialized again for the same save');
select ok(exists(select 1 from private.world_npc_tombstones tombstone
  where tombstone.save_id='76000000-0000-4000-8000-000000000011'
    and tombstone.npc_id=(select npc_id from pg_temp.lira_identity)
    and tombstone.reason='departed'),
  'the departure tombstone excludes Lira from future arrival candidates');
create temporary table pg_temp.later_arrival_check as
select private.maybe_arrive_world_npc('76000000-0000-4000-8000-000000000011',6,
  '76000000-0000-4000-8000-000000000023') as result;
select is((select result->>'reason' from pg_temp.later_arrival_check),'no_eligible',
  'a later arrival check cannot bring the departed resident back');
select is((select candidate_count from private.world_npc_arrival_receipts
  where save_id='76000000-0000-4000-8000-000000000011' and day=5),1,
  'the selected arrival came from the single eligible authored candidate');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000001';
select ok(exists(select 1 from jsonb_array_elements(public.npc_roster(20,null,'Torvin Ashbeard')) resident
  where resident->>'name'='Torvin Ashbeard'),
  'the arriving author is present in the owner-visible playable roster');
select is((select jsonb_array_length(public.npc_roster(20,null,'Lira Nightwind'))),0,
  'the departed author no longer appears in the playable roster');
select is(public.npc_archived_resident((select instance_id from pg_temp.lira_resident))->>'status','departed',
  'the public archive keeps Lira available as a departed resident');
select ok(exists(select 1 from jsonb_array_elements(public.npc_archived_roster(20,null,'Lira Nightwind')) resident
  where resident->>'instanceId'=(select instance_id::text from pg_temp.lira_resident)
    and resident->>'status'='departed'),
  'the public archived roster retains the departed Lira');
select ok(exists(select 1 from jsonb_array_elements(public.npc_quest_history_archive(
    (select instance_id from pg_temp.lira_resident))->'items') quest
  where quest->>'id'=(select quest_id::text from pg_temp.loss_quest)
    and quest->>'outcome'='failed'
    and quest->'events' @> '[{"outcome":"setback"},{"outcome":"setback"},{"outcome":"failed"}]'::jsonb),
  'the public quest archive preserves both warnings and the terminal failure after departure');

reset role;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='76000000-0000-4000-8000-000000000002';
create temporary table pg_temp.quiet_day_close as
select public.advance_tavern_day(
  '76000000-0000-4000-8000-000000000012',
  '76000000-0000-4000-8000-000000000022',
  (select revision from public.tavern_saves where id='76000000-0000-4000-8000-000000000012')
) as result;
select is((select result#>>'{communityArrival,arrived}' from pg_temp.quiet_day_close),'false',
  'an empty authored candidate pool returns a quiet, successful day close');
select is((select result#>>'{communityArrival,reason}' from pg_temp.quiet_day_close),'no_eligible',
  'the quiet result distinguishes no eligible arrivals from a capacity limit');
reset role;
set local request.jwt.claim.role='service_role';
select is((select candidate_count from private.world_npc_arrival_receipts
  where save_id='76000000-0000-4000-8000-000000000012' and day=1),0,
  'the quiet receipt records an empty eligible pool with spare capacity');

select * from finish();
rollback;
