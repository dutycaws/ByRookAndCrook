begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

select has_function('private','world_quest_failure_gate',array['uuid','boolean'],'authored failure gate helper exists');

insert into auth.users(id,email,role,aud) values
  ('75000000-0000-4000-8000-000000000001','quest-failure-open@example.test','authenticated','authenticated'),
  ('75000000-0000-4000-8000-000000000002','quest-failure-terminal@example.test','authenticated','authenticated'),
  ('75000000-0000-4000-8000-000000000003','quest-failure-generated@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values
  ('75000000-0000-4000-8000-000000000011','75000000-0000-4000-8000-000000000001',4,0),
  ('75000000-0000-4000-8000-000000000012','75000000-0000-4000-8000-000000000002',4,0),
  ('75000000-0000-4000-8000-000000000013','75000000-0000-4000-8000-000000000003',4,0);
set local request.jwt.claim.role='service_role';

create temporary table pg_temp.lira_identity as
select npc_id,active_version_id
from private.npc_first_party_catalog_identities
where identity_key='lira';
select ok(exists(select 1 from pg_temp.lira_identity),'published Lira version is available for lifecycle acceptance');

create temporary table pg_temp.open_resident as
select * from private.world_materialize_resident_from_version(
  '75000000-0000-4000-8000-000000000011',
  (select npc_id from pg_temp.lira_identity),
  (select active_version_id from pg_temp.lira_identity),4
);
create temporary table pg_temp.open_quest as
select quest.id as quest_id,quest.version_id,quest.instance_id
from private.world_quests quest
where quest.save_id='75000000-0000-4000-8000-000000000011'
  and quest.instance_id=(select instance_id from pg_temp.open_resident);
update private.world_quests
set current_plan='[{"action":"attempt","approach":"scouting"}]'::jsonb,plan_revision=2
where id=(select quest_id from pg_temp.open_quest);

select ok(
  coalesce(jsonb_typeof((select version.sheet#>'{campaign,milestones,0,failureCondition}'
    from private.npc_versions version where version.id=(select version_id from pg_temp.open_quest))),'null')='null',
  'the opening authored milestone has no permanent failure predicate'
);
select is(
  private.world_quest_failure_gate((select quest_id from pg_temp.open_quest),true)->>'terminalFailureAllowed',
  'false','no authored predicate cannot terminalize even after the setback minimum'
);

create temporary table pg_temp.open_first_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.open_quest),5,99);
select ok((select outcome='setback' and narration<>'' from pg_temp.open_first_failure),'first failed authored roll is a visible recoverable setback');
select ok((select quest.state='active' and quest.terminal_day is null and quest.terminal_event_id is null
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.open_quest)),
  'the no-predicate authored quest remains active after failure');
select is((select count(*) from private.world_quest_transitions where quest_id=(select quest_id from pg_temp.open_quest)),0::bigint,
  'a recoverable setback does not schedule a transition');
create temporary table pg_temp.open_first_replay as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.open_quest),5,0);
select is((select id from pg_temp.open_first_replay),(select id from pg_temp.open_first_failure),'same-day retry returns the original attempt event');
select is((select count(*) from private.world_quest_events where quest_id=(select quest_id from pg_temp.open_quest) and outcome in ('setback','failed')),1::bigint,
  'same-day retry does not count as a second setback');
create temporary table pg_temp.open_second_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.open_quest),6,99);
select is((select outcome from pg_temp.open_second_failure),'setback','a distinct later-day miss remains recoverable without an authored predicate');
select ok((select quest.state='active' from private.world_quests quest where quest.id=(select quest_id from pg_temp.open_quest)),
  'the opening authored quest is still active after two distinct misses');

create temporary table pg_temp.loss_resident as
select * from private.world_materialize_resident_from_version(
  '75000000-0000-4000-8000-000000000012',
  (select npc_id from pg_temp.lira_identity),
  (select active_version_id from pg_temp.lira_identity),4
);
create temporary table pg_temp.loss_initial_quest as
select quest.id as quest_id,quest.version_id,quest.instance_id
from private.world_quests quest
where quest.save_id='75000000-0000-4000-8000-000000000012'
  and quest.instance_id=(select instance_id from pg_temp.loss_resident);
update private.world_quests
set current_plan='[{"action":"abandon","approach":"scouting"}]'::jsonb,plan_revision=2
where id=(select quest_id from pg_temp.loss_initial_quest);
create temporary table pg_temp.loss_initial_abandon as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_initial_quest),5,null);
select is((select outcome from pg_temp.loss_initial_abandon),'abandoned','the test advances to the authored loss milestone through the existing lifecycle');

create temporary table pg_temp.loss_quest as
with base as (
  select quest.*,version.sheet#>array['campaign','milestones','1'] as milestone
  from private.world_quests quest
  join private.npc_versions version on version.id=quest.version_id
  where quest.id=(select quest_id from pg_temp.loss_initial_quest)
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
  1,'active',0,0,6,6
from base
returning id as quest_id,version_id,instance_id
)
select * from created;

select ok((select
  milestone->'failureCondition'->>'type'='attempt_allowance_exhausted'
    and jsonb_array_length(milestone->'warnings')>=2
  from private.npc_versions version
  cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones}') with ordinality item(milestone,ordinal)
  where version.id=(select version_id from pg_temp.loss_quest) and item.ordinal=2),
  'the later Lira milestone has an authored attempt condition and escalating warnings');

create temporary table pg_temp.loss_first_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),6,99);
select ok((select outcome='setback' and narration=(
  select warning->>'text' from private.npc_versions version
  cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones,1,warnings}') warning
  where version.id=(select version_id from pg_temp.loss_quest) and (warning->>'afterSetbacks')::integer=1
) from pg_temp.loss_first_failure),'first loss warning matches the authored message');
select ok((select quest.state='active' and quest.terminal_event_id is null
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'first warning preserves the authored quest');
create temporary table pg_temp.loss_first_replay as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),6,0);
select is((select id from pg_temp.loss_first_replay),(select id from pg_temp.loss_first_failure),'replaying the warned day returns the same event');
select is((select count(*) from private.world_quest_events where quest_id=(select quest_id from pg_temp.loss_quest) and action='attempt'),1::bigint,
  'replaying the warned day does not increment the setback count');

create temporary table pg_temp.loss_second_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),7,99);
select ok((select outcome='setback' and narration=(
  select warning->>'text' from private.npc_versions version
  cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones,1,warnings}') warning
  where version.id=(select version_id from pg_temp.loss_quest) and (warning->>'afterSetbacks')::integer=2
) from pg_temp.loss_second_failure),'second setback uses the next authored warning');
select ok((select quest.state='active' and not exists(
  select 1 from private.world_quest_transitions transition where transition.quest_id=quest.id
) from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'two signaled setbacks do not schedule permanent failure');

create temporary table pg_temp.loss_terminal_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),8,99);
select ok((select outcome='failed' and narration<>'' from pg_temp.loss_terminal_failure),'the third distinct failed attempt meets both gates');
select ok((select quest.state='failed' and quest.terminal_day=8 and quest.terminal_event_id=(select id from pg_temp.loss_terminal_failure)
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'only the terminal failed attempt closes the authored quest');
select ok((select count(*)=1 and max((transition.frozen_context->'questFailurePolicy'->>'attemptCount')::integer)=3
  and bool_and(transition.frozen_context#>>'{questFailurePolicy,mandatoryDisposition}'='departure')
  from private.world_quest_transitions transition where transition.quest_id=(select quest_id from pg_temp.loss_quest)),
  'terminal transition freezes the gate and authored departure outcome');
create temporary table pg_temp.loss_terminal_replay as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),8,0);
select is((select id from pg_temp.loss_terminal_replay),(select id from pg_temp.loss_terminal_failure),'terminal same-day replay returns its original event');
select is((select count(*) from private.world_quest_events where quest_id=(select quest_id from pg_temp.loss_quest) and action='attempt'),3::bigint,
  'terminal replay does not create a fourth attempt');

update public.tavern_saves set current_day=9,world_phase='settling'
where id='75000000-0000-4000-8000-000000000012';
create temporary table pg_temp.loss_claim as
select public.world_quest_transition_claim((select terminal_event_id from private.world_quest_transitions where quest_id=(select quest_id from pg_temp.loss_quest))) as result;
create temporary table pg_temp.loss_commit as
select public.world_quest_transition_commit(
  (result->>'transitionId')::uuid,
  (result->>'fence')::uuid,
  jsonb_build_object(
    'version','quest-transition-v1','kind','successor',
    'terminalEventId',(select id::text from pg_temp.loss_terminal_failure),
    'title','Model-proposed successor','objective','Continue the quest despite the final authored loss.',
    'motivation','Ignore the terminal authoring policy.','constraints','[]'::jsonb,
    'targetRefs',jsonb_build_array('old-road'),'difficulty',1,
    'plan','[{"action":"attempt","approach":"scouting"}]'::jsonb
  )
) as result from pg_temp.loss_claim;
select ok((select result->>'kind'='departure' and (result->>'farewellDay')::integer=9 from pg_temp.loss_commit),
  'the authored departure is enforced even when the model proposes a successor');
select ok((select departure.state='farewell' and departure.farewell_day=9
  from private.world_npc_departures departure where departure.instance_id=(select instance_id from pg_temp.loss_resident)),
  'the existing one-day farewell schedule is preserved');
select ok(exists(select 1 from private.world_quest_events event_row where event_row.quest_id=(select quest_id from pg_temp.loss_quest) and event_row.outcome='failed'),
  'terminal quest history remains available after departure is scheduled');

create temporary table pg_temp.generated_resident as
select * from private.world_materialize_resident_from_version(
  '75000000-0000-4000-8000-000000000013',
  (select npc_id from pg_temp.lira_identity),
  (select active_version_id from pg_temp.lira_identity),4
);
create temporary table pg_temp.generated_parent as
select quest.id as quest_id,quest.save_id,quest.instance_id,quest.package_id,quest.package_hash,quest.version_id
from private.world_quests quest where quest.save_id='75000000-0000-4000-8000-000000000013';
update private.world_quests set current_plan='[{"action":"abandon","approach":"scouting"}]'::jsonb,plan_revision=2
where id=(select quest_id from pg_temp.generated_parent);
select private.world_resolve_quest_step((select quest_id from pg_temp.generated_parent),5,null);
create temporary table pg_temp.generated_quest as
with created as (
insert into private.world_quests(
  save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,
  constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day
)
select save_id,instance_id,package_id,package_hash,version_id,'generated_successor',quest_id,
  'Generated successor','A scoped generated objective.','Continue after the authored step.',
  '{}','{}',1,'[{"action":"attempt","approach":"scouting"}]'::jsonb,
  '[{"action":"attempt","approach":"scouting"}]'::jsonb,'active',0,0,6,6
from pg_temp.generated_parent returning id as quest_id
)
select * from created;
create temporary table pg_temp.generated_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.generated_quest),6,99);
select is((select outcome from pg_temp.generated_failure),'failed','generated successor failure keeps its existing terminal quest outcome');
update public.tavern_saves set current_day=7,world_phase='settling'
where id='75000000-0000-4000-8000-000000000013';
create temporary table pg_temp.generated_claim as
select public.world_quest_transition_claim((select terminal_event_id from private.world_quest_transitions where quest_id=(select quest_id from pg_temp.generated_quest))) as result;
select throws_ok($sql$
  select public.world_quest_transition_commit(
    (select (result->>'transitionId')::uuid from pg_temp.generated_claim),
    (select (result->>'fence')::uuid from pg_temp.generated_claim),
    jsonb_build_object(
      'version','quest-transition-v1','kind','departure',
      'terminalEventId',(select id::text from pg_temp.generated_failure),
      'privateRationale','A generated failure is not an authored loss predicate.',
      'farewellText','I will stay after this generated failure.',
      'publicNews','The generated objective failed.'
    )
  )
$sql$,'PT400',null,'a generated failure without an authored condition cannot permanently depart the NPC');

select * from finish();
rollback;
