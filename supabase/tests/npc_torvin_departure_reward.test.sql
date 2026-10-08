begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(id,email,role,aud)
values('76100000-0000-4000-8000-000000000001','torvin-departure@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision)
values('76100000-0000-4000-8000-000000000011','76100000-0000-4000-8000-000000000001',4,0);
set local request.jwt.claim.role='service_role';
set local request.jwt.claim.sub='76100000-0000-4000-8000-000000000001';

create temporary table pg_temp.torvin_identity as
select npc_id,active_version_id
from private.npc_first_party_catalog_identities
where identity_key='torvin';
select ok(exists(select 1 from pg_temp.torvin_identity),'published Torvin version is available');
create temporary table pg_temp.torvin_resident as
select * from private.world_materialize_resident_from_version(
  '76100000-0000-4000-8000-000000000011',
  (select npc_id from pg_temp.torvin_identity),
  (select active_version_id from pg_temp.torvin_identity),4
);
create temporary table pg_temp.initial_quest as
select id as quest_id,version_id,instance_id
from private.world_quests
where save_id='76100000-0000-4000-8000-000000000011'
  and instance_id=(select instance_id from pg_temp.torvin_resident)
  and origin='authored_milestone' and authored_milestone_index=0;
create temporary table pg_temp.torvin_prepare as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.initial_quest),4,null);
create temporary table pg_temp.torvin_success as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.initial_quest),5,0);
select is((select outcome from pg_temp.torvin_success),'succeeded',
  'Torvin completes his authored initial quest through the lifecycle resolver');
select ok(exists(select 1 from private.world_quest_trinket_grant_receipts receipt
  where receipt.source_event_id=(select id from pg_temp.torvin_success)
    and receipt.status='granted' and receipt.result->'trinket'->>'name'='Fair Measure Seal'),
  'the successful initial quest grants Torvin''s authored trinket with a durable receipt');
select ok(exists(select 1 from private.world_owned_trinkets item
  where item.save_id='76100000-0000-4000-8000-000000000011'
    and item.source_event_id=(select id from pg_temp.torvin_success)
    and item.catalog_id='drink_revenue' and item.active_slot=0),
  'Torvin''s drink-revenue trinket is persisted and active before the later loss');

update public.tavern_saves set current_day=6,world_phase='settling'
where id='76100000-0000-4000-8000-000000000011';
create temporary table pg_temp.initial_claim as
select public.world_quest_transition_claim((select id from pg_temp.torvin_success)) as result;
create temporary table pg_temp.initial_commit as
select public.world_quest_transition_commit(
  (select (result->>'transitionId')::uuid from pg_temp.initial_claim),
  (select (result->>'fence')::uuid from pg_temp.initial_claim),
  jsonb_build_object('version','quest-transition-v1','kind','next_authored_milestone',
    'terminalEventId',(select id::text from pg_temp.torvin_success),
    'milestoneId','fair-deal','plan','[{"action":"attempt","approach":"trade"}]'::jsonb)
) as result;
select is((select result->>'kind' from pg_temp.initial_commit),'next_authored_milestone',
  'the successful authored quest opens Torvin''s exact next milestone');
select ok(exists(select 1 from private.world_quests quest
  where quest.id=((select result->>'questId' from pg_temp.initial_commit)::uuid)
    and quest.authored_milestone_key='fair-deal' and quest.state='active'),
  'the next authored milestone is live before its terminal setback sequence');

create temporary table pg_temp.loss_quest as
select quest.id as quest_id,quest.version_id,quest.instance_id
from private.world_quests quest
where quest.id=((select result->>'questId' from pg_temp.initial_commit)::uuid);
select ok((select version.sheet#>>'{campaign,milestones,1,failureCondition,maxAttempts}'='3'
  and jsonb_array_length(version.sheet#>'{campaign,milestones,1,warnings}')=2
  from private.npc_versions version where version.id=(select version_id from pg_temp.loss_quest)),
  'Torvin''s authored later milestone defines a three-attempt gate and two warnings');
create temporary table pg_temp.first_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),6,99);
select ok((select outcome='setback' and narration=(
  select warning->>'text' from private.npc_versions version
  cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones,1,warnings}') warning
  where version.id=(select version_id from pg_temp.loss_quest)
    and (warning->>'afterSetbacks')::integer=1
) from pg_temp.first_failure),'the first miss is recoverable and uses Torvin''s first authored warning');
select ok((select quest.state='active' and quest.terminal_event_id is null
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'the first warning leaves Torvin''s authored quest open');
create temporary table pg_temp.second_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),7,99);
select ok((select outcome='setback' and narration=(
  select warning->>'text' from private.npc_versions version
  cross join lateral jsonb_array_elements(version.sheet#>'{campaign,milestones,1,warnings}') warning
  where version.id=(select version_id from pg_temp.loss_quest)
    and (warning->>'afterSetbacks')::integer=2
) from pg_temp.second_failure),'the second miss is recoverable and uses Torvin''s departure warning');
select ok((select quest.state='active' and not exists(
  select 1 from private.world_quest_transitions transition where transition.quest_id=quest.id
) from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'two distinct warned setbacks cannot yet schedule a permanent departure');
create temporary table pg_temp.terminal_failure as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.loss_quest),8,99);
select is((select outcome from pg_temp.terminal_failure),'failed',
  'the third distinct miss exhausts Torvin''s authored attempt allowance');
select ok((select quest.state='failed' and quest.terminal_day=8
    and quest.terminal_event_id=(select id from pg_temp.terminal_failure)
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.loss_quest)),
  'only the third miss terminalizes the authored milestone');
select ok(exists(select 1 from private.world_quest_transitions transition
  where transition.quest_id=(select quest_id from pg_temp.loss_quest)
    and transition.frozen_context#>>'{questFailurePolicy,mandatoryDisposition}'='departure'
    and (transition.frozen_context#>>'{questFailurePolicy,terminalFailureAllowed}')::boolean),
  'the terminal transition freezes the authored mandatory departure policy');

update public.tavern_saves set current_day=9,world_phase='settling'
where id='76100000-0000-4000-8000-000000000011';
create temporary table pg_temp.loss_claim as
select public.world_quest_transition_claim((select id from pg_temp.terminal_failure)) as result;
create temporary table pg_temp.loss_commit as
select public.world_quest_transition_commit(
  (select (result->>'transitionId')::uuid from pg_temp.loss_claim),
  (select (result->>'fence')::uuid from pg_temp.loss_claim),
  jsonb_build_object('version','quest-transition-v1','kind','successor',
    'terminalEventId',(select id::text from pg_temp.terminal_failure),
    'title','Proposed successor','objective','Continue regardless of the authored loss.',
    'motivation','A model suggestion cannot erase the outcome.','constraints','[]'::jsonb,
    'targetRefs','[]'::jsonb,'difficulty',1,
    'plan','[{"action":"attempt","approach":"trade"}]'::jsonb)
) as result;
select is((select result->>'kind' from pg_temp.loss_commit),'departure',
  'the authored terminal failure enforces departure over a proposed successor');
select is((select (result->>'farewellDay')::integer from pg_temp.loss_commit),9,
  'Torvin receives the full authored farewell day after the terminal outcome');
select is((select state from private.world_npc_departures departure
  where departure.instance_id=(select instance_id from pg_temp.torvin_resident)),
  'farewell','Torvin remains present during his complete farewell day');
update public.tavern_saves set current_day=10
where id='76100000-0000-4000-8000-000000000011';
select is((select departure.state from private.world_npc_departures departure
  where departure.instance_id=(select instance_id from pg_temp.torvin_resident)),
  'departed','the next day boundary closes Torvin''s farewell exactly once');
select is((select resident.status from private.world_npc_instances resident
  where resident.id=(select instance_id from pg_temp.torvin_resident)),
  'departed','the persisted resident is no longer available after departure');

select ok(exists(select 1 from private.world_owned_trinkets item
    join private.world_quest_trinket_grant_receipts receipt on receipt.trinket_id=item.id
  where item.save_id='76100000-0000-4000-8000-000000000011'
    and item.source_event_id=(select id from pg_temp.torvin_success)
    and item.catalog_id='drink_revenue' and receipt.status='granted'),
  'the earned drink trinket and grant receipt remain after Torvin departs');
select is((select count(*) from private.world_quest_events event_row
  where event_row.quest_id=(select quest_id from pg_temp.initial_quest)),2::bigint,
  'Torvin''s successful first-quest history remains after departure');
select is((select count(*) from private.world_quest_events event_row
  where event_row.quest_id=(select quest_id from pg_temp.loss_quest)),3::bigint,
  'all three warned setback events remain in the terminal quest history');
select ok(exists(select 1 from private.world_quest_events event_row
  where event_row.quest_id=(select quest_id from pg_temp.loss_quest)
    and event_row.id=(select id from pg_temp.terminal_failure) and event_row.outcome='failed'),
  'the terminal departure keeps its exact authored failure event');
set local request.jwt.claim.role='authenticated';
select is((private.trinket_collection('76100000-0000-4000-8000-000000000011')->0->>'name'),
  'Fair Measure Seal','the departed resident''s earned trinket remains in the player-facing collection');

select * from finish();
rollback;
