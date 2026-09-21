begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

select has_function('public','world_quest_transition_claim',array['uuid'],'service transition claim exists');
select has_function('public','world_quest_transition_claim_next',array[]::text[],'service transition queue claim exists');
select has_function('public','world_quest_transition_heartbeat',array['uuid','uuid'],'service transition heartbeat exists');
select has_function('public','world_quest_transition_checkpoint',array['uuid','uuid','text','jsonb'],'idempotent checkpoint exists');
select has_function('public','world_quest_transition_fail',array['uuid','uuid','text'],'recoverable failure exists');
select has_function('public','world_quest_transition_commit',array['uuid','uuid','jsonb'],'fenced commit exists');
select ok(private.world_quest_transition_plan_is_valid('[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'),'strict direct plan accepts a final terminal step');
select ok(not private.world_quest_transition_plan_is_valid('[{"action":"attempt","approach":"scouting"},{"action":"wait","approach":"scouting"}]'),'strict plan rejects a non-final terminal step');
select ok(not private.world_quest_transition_plan_is_valid('[{"action":"attempt","approach":"scouting","extra":true}]'),'strict plan rejects unknown keys');

insert into auth.users(id,email,role,aud) values('72000000-0000-4000-8000-000000000001','quest-transition@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values('72000000-0000-4000-8000-000000000011','72000000-0000-4000-8000-000000000001',4,0);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.resident as select * from private.world_materialize_resident_from_version('72000000-0000-4000-8000-000000000011','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.prepared as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='72000000-0000-4000-8000-000000000011'),4,0);
create temporary table pg_temp.terminal as select * from private.world_resolve_quest_step((select quest_id from pg_temp.prepared),5,0);
update public.tavern_saves set current_day=6,world_phase='settling' where id='72000000-0000-4000-8000-000000000011';
create temporary table pg_temp.claimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select ok((select result ? 'fence' and result ? 'frozenContext' from pg_temp.claimed),'claim returns a fenced immutable context');
select is((select (result->>'attempt')::integer from pg_temp.claimed),1,'claim exposes its fenced attempt number');
select throws_ok($$select public.world_quest_transition_heartbeat((select (result->>'transitionId')::uuid from pg_temp.claimed),'00000000-0000-4000-8000-000000000001')$$,'PT409',null,'stale fence cannot heartbeat');
create temporary table pg_temp.checkpoint as select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer','{"draft":1}'::jsonb) result;
select is((select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer','{"draft":1}'::jsonb)),(select result from pg_temp.checkpoint),'checkpoint replay returns its exact receipt');
select throws_ok($$select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer','{"draft":2}'::jsonb)$$,'PT409',null,'different checkpoint replay is rejected');
update private.world_quest_transitions set lease_until=clock_timestamp()-interval '1 second' where id=(select (result->>'transitionId')::uuid from pg_temp.claimed);
create temporary table pg_temp.expired_reclaim as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select isnt((select result->>'fence' from pg_temp.expired_reclaim),(select result->>'fence' from pg_temp.claimed),'an expired lease is reclaimed under a fresh fence');
select throws_ok($$select public.world_quest_transition_heartbeat((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed))$$,'PT409',null,'the expired fence cannot heartbeat after reclaim');
select is((select (public.world_quest_transition_fail((select (result->>'transitionId')::uuid from pg_temp.expired_reclaim),(select (result->>'fence')::uuid from pg_temp.expired_reclaim),'MODEL_TIMEOUT')->>'status')),'awaiting','failure releases the transition for retry');
select is((select next_eligible_day from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.terminal)),7,'handled failure defers to the later opening');
select throws_ok($$select public.world_quest_transition_claim((select id from pg_temp.terminal))$$,'PT409',null,'a deferred transition is not reclaimable during the same opening');
update public.tavern_saves set current_day=7,world_phase='settling' where id='72000000-0000-4000-8000-000000000011';
create temporary table pg_temp.reclaimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select is((select result->'checkpoints'->0->>'stage' from pg_temp.reclaimed),'proposer','retry resumes the latest safe checkpoint from the immutable terminal event');
select is((select (public.world_quest_transition_fail((select (result->>'transitionId')::uuid from pg_temp.reclaimed),(select (result->>'fence')::uuid from pg_temp.reclaimed),'validation_rejected')->>'status')),'awaiting','validation rejection releases the transition for a fresh model attempt');
select is((select next_eligible_day from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.terminal)),8,'each handled failure moves eligibility forward by one opening');
update public.tavern_saves set current_day=8,world_phase='settling' where id='72000000-0000-4000-8000-000000000011';
create temporary table pg_temp.clean_reclaimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select is((select result->'checkpoints' from pg_temp.clean_reclaimed),'[]'::jsonb,'validation rejection does not replay an invalid model checkpoint');
create temporary table pg_temp.committed as select public.world_quest_transition_commit((select (result->>'transitionId')::uuid from pg_temp.clean_reclaimed),(select (result->>'fence')::uuid from pg_temp.clean_reclaimed),jsonb_build_object('version','quest-transition-v1','kind','next_authored_milestone','terminalEventId',(select id::text from pg_temp.terminal),'milestoneId','secure-road','plan','[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb)) result;
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),'active','a successor committed while settling is active for that opening');
select is((select scheduled_for_day from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),8,'a deferred successor starts on its later eligible opening');
select ok(private.world_quest_transition_public_digest('72000000-0000-4000-8000-000000000011',5) like '%Secure the road%','next authored milestone is available to the overnight public digest');
select is((select public.world_quest_transition_commit((select (result->>'transitionId')::uuid from pg_temp.clean_reclaimed),'00000000-0000-4000-8000-000000000001','{}'::jsonb)),(select result from pg_temp.committed),'completed transition returns its committed receipt on retry');
select is((select activated_day from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),8,'on-time activation is recorded at the opening boundary');
update public.tavern_saves set current_day=9 where id='72000000-0000-4000-8000-000000000011';
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),'active','opening-day activation stays active until a later close resolves it');
select is((select current_step from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),0,'opening-day activation does not resolve a quest step early');

-- A worker that crosses the publication boundary may still commit its fenced
-- decision, but it must schedule the next opening rather than revive today.
insert into auth.users(id,email,role,aud) values('72000000-0000-4000-8000-000000000003','quest-late-successor@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values('72000000-0000-4000-8000-000000000013','72000000-0000-4000-8000-000000000003',4,0);
create temporary table pg_temp.late_resident as select * from private.world_materialize_resident_from_version('72000000-0000-4000-8000-000000000013','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.late_prepared as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='72000000-0000-4000-8000-000000000013'),4,0);
create temporary table pg_temp.late_terminal as select * from private.world_resolve_quest_step((select quest_id from pg_temp.late_prepared),5,0);
update public.tavern_saves set current_day=6,world_phase='settling' where id='72000000-0000-4000-8000-000000000013';
create temporary table pg_temp.late_claim as select public.world_quest_transition_claim((select id from pg_temp.late_terminal)) result;
update public.tavern_saves set world_phase='open' where id='72000000-0000-4000-8000-000000000013';
create temporary table pg_temp.late_commit as select public.world_quest_transition_commit(
  (select (result->>'transitionId')::uuid from pg_temp.late_claim),(select (result->>'fence')::uuid from pg_temp.late_claim),
  jsonb_build_object('version','quest-transition-v1','kind','next_authored_milestone','terminalEventId',(select id::text from pg_temp.late_terminal),'milestoneId','secure-road','plan','[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb)
) result;
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.late_commit)::uuid)),'scheduled','a late successor never activates mid-day');
select is((select scheduled_for_day from private.world_quests where id=((select result->>'questId' from pg_temp.late_commit)::uuid)),7,'a late successor waits for the next opening');
update public.tavern_saves set current_day=7,world_phase='settling' where id='72000000-0000-4000-8000-000000000013';
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.late_commit)::uuid)),'active','the late successor activates at its next opening');

insert into auth.users(id,email,role,aud) values('72000000-0000-4000-8000-000000000002','quest-departure@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values('72000000-0000-4000-8000-000000000012','72000000-0000-4000-8000-000000000002',4,0);
create temporary table pg_temp.departing_resident as select * from private.world_materialize_resident_from_version('72000000-0000-4000-8000-000000000012','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',4);
create temporary table pg_temp.departing_prepared as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='72000000-0000-4000-8000-000000000012'),4,0);
create temporary table pg_temp.departing_terminal as select * from private.world_resolve_quest_step((select quest_id from pg_temp.departing_prepared),5,0);
create temporary table pg_temp.generated_departure_quest(id uuid);
with inserted as (
  insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
  select quest.save_id,quest.instance_id,quest.package_id,quest.package_hash,quest.version_id,'generated_successor',quest.id,
    'A final road','Decide whether to remain in Millhaven.','The prior work has reached its natural end.','{}'::text[],array['millhaven']::text[],1,
    '[{"action":"attempt","approach":"scouting"}]'::jsonb,'[{"action":"attempt","approach":"scouting"}]'::jsonb,'active',0,0,6,6
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.departing_terminal)
  returning id
)
insert into pg_temp.generated_departure_quest select id from inserted;
create temporary table pg_temp.generated_terminal as select * from private.world_resolve_quest_step((select id from pg_temp.generated_departure_quest),6,0);
update public.tavern_saves set current_day=7,world_phase='settling' where id='72000000-0000-4000-8000-000000000012';
create temporary table pg_temp.departure_claim as select public.world_quest_transition_claim((select id from pg_temp.generated_terminal)) result;
create temporary table pg_temp.departure_commit as select public.world_quest_transition_commit(
  (select (result->>'transitionId')::uuid from pg_temp.departure_claim),(select (result->>'fence')::uuid from pg_temp.departure_claim),
  jsonb_build_object('version','quest-transition-v1','kind','departure','terminalEventId',(select id::text from pg_temp.generated_terminal),'privateRationale','My work here is complete.','farewellText','I will share one last evening at the tavern before I take the road.','publicNews','Lira plans to leave Millhaven after one final day at the tavern.')
) result;
select is((select result->>'status' from pg_temp.departure_commit),'completed','departure transition commits one canonical receipt');
select is((select (result->>'farewellDay')::integer from pg_temp.departure_commit),7,'departure schedules the full farewell day after the terminal outcome');
select ok(private.world_quest_transition_public_digest('72000000-0000-4000-8000-000000000012',6) like '%Lira plans to leave Millhaven%','departure start is available to the overnight public digest');
select is((select state from private.world_npc_departures where instance_id=(select instance_id from pg_temp.departing_resident)),'farewell','resident remains present throughout the farewell day');
select isnt((select status from private.world_npc_instances where id=(select instance_id from pg_temp.departing_resident)),'departed','resident is not marked departed at the start of farewell day');
update public.tavern_saves set current_day=8 where id='72000000-0000-4000-8000-000000000012';
select is((select state from private.world_npc_departures where instance_id=(select instance_id from pg_temp.departing_resident)),'departed','farewell closes after exactly one full day');
select is((select status from private.world_npc_instances where id=(select instance_id from pg_temp.departing_resident)),'departed','resident becomes unavailable after farewell closes');
select ok(exists(select 1 from private.world_npc_tombstones tombstone join private.world_npc_instances resident on resident.npc_id=tombstone.npc_id and resident.version_id=tombstone.version_id where resident.id=(select instance_id from pg_temp.departing_resident) and tombstone.save_id='72000000-0000-4000-8000-000000000012' and tombstone.reason='departed'),'departure leaves a save-local departed tombstone after farewell closes');
select ok(private.world_quest_transition_public_digest('72000000-0000-4000-8000-000000000012',7) like '%departed Millhaven%','departure completion is available to the next overnight public digest');

-- A decision finishing after publication schedules, rather than beginning, the
-- farewell; the following opening is the resident's complete playable day.
insert into auth.users(id,email,role,aud) values('72000000-0000-4000-8000-000000000004','quest-late-departure@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values('72000000-0000-4000-8000-000000000014','72000000-0000-4000-8000-000000000004',4,0);
create temporary table pg_temp.late_departure_resident as select * from private.world_materialize_resident_from_version('72000000-0000-4000-8000-000000000014','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',4);
create temporary table pg_temp.late_departure_prepared as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='72000000-0000-4000-8000-000000000014'),4,0);
create temporary table pg_temp.late_departure_initial_terminal as select * from private.world_resolve_quest_step((select quest_id from pg_temp.late_departure_prepared),5,0);
create temporary table pg_temp.late_departure_quest(id uuid);
with inserted as (
  insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
  select quest.save_id,quest.instance_id,quest.package_id,quest.package_hash,quest.version_id,'generated_successor',quest.id,
    'The final road','Decide whether to remain in Millhaven.','The prior work has reached its natural end.','{}'::text[],array['millhaven']::text[],1,
    '[{"action":"attempt","approach":"scouting"}]'::jsonb,'[{"action":"attempt","approach":"scouting"}]'::jsonb,'active',0,0,6,6
  from private.world_quests quest where quest.id=(select quest_id from pg_temp.late_departure_initial_terminal)
  returning id
) insert into pg_temp.late_departure_quest select id from inserted;
create temporary table pg_temp.late_departure_terminal as select * from private.world_resolve_quest_step((select id from pg_temp.late_departure_quest),6,0);
update public.tavern_saves set current_day=7,world_phase='settling' where id='72000000-0000-4000-8000-000000000014';
create temporary table pg_temp.late_departure_claim as select public.world_quest_transition_claim((select id from pg_temp.late_departure_terminal)) result;
update public.tavern_saves set world_phase='open' where id='72000000-0000-4000-8000-000000000014';
create temporary table pg_temp.late_departure_commit as select public.world_quest_transition_commit(
  (select (result->>'transitionId')::uuid from pg_temp.late_departure_claim),(select (result->>'fence')::uuid from pg_temp.late_departure_claim),
  jsonb_build_object('version','quest-transition-v1','kind','departure','terminalEventId',(select id::text from pg_temp.late_departure_terminal),'privateRationale','My work here is complete.','farewellText','I will share one last evening at the tavern before I take the road.','publicNews','Lira plans to leave Millhaven after one final day at the tavern.')
) result;
select is((select state from private.world_npc_departures where instance_id=(select instance_id from pg_temp.late_departure_resident)),'scheduled','a late departure does not begin farewell mid-day');
update public.tavern_saves set current_day=8,world_phase='settling' where id='72000000-0000-4000-8000-000000000014';
select is((select state from private.world_npc_departures where instance_id=(select instance_id from pg_temp.late_departure_resident)),'farewell','a late departure starts at the following opening');

select * from finish();
rollback;
