begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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
create temporary table pg_temp.claimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select ok((select result ? 'fence' and result ? 'frozenContext' from pg_temp.claimed),'claim returns a fenced immutable context');
select is((select (result->>'attempt')::integer from pg_temp.claimed),1,'claim exposes its fenced attempt number');
select throws_ok($$select public.world_quest_transition_heartbeat((select (result->>'transitionId')::uuid from pg_temp.claimed),'00000000-0000-4000-8000-000000000001')$$,'PT409',null,'stale fence cannot heartbeat');
create temporary table pg_temp.checkpoint as select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer','{"draft":1}'::jsonb) result;
select is((select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer','{"draft":1}'::jsonb)),(select result from pg_temp.checkpoint),'checkpoint replay returns its exact receipt');
select throws_ok($$select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer','{"draft":2}'::jsonb)$$,'PT409',null,'different checkpoint replay is rejected');
select is((select (public.world_quest_transition_fail((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'MODEL_TIMEOUT')->>'status')),'awaiting','failure releases the transition for retry');
create temporary table pg_temp.reclaimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select is((select result->'checkpoints'->0->>'stage' from pg_temp.reclaimed),'proposer','retry resumes the latest safe checkpoint from the immutable terminal event');
select is((select (public.world_quest_transition_fail((select (result->>'transitionId')::uuid from pg_temp.reclaimed),(select (result->>'fence')::uuid from pg_temp.reclaimed),'validation_rejected')->>'status')),'awaiting','validation rejection releases the transition for a fresh model attempt');
create temporary table pg_temp.clean_reclaimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;
select is((select result->'checkpoints' from pg_temp.clean_reclaimed),'[]'::jsonb,'validation rejection does not replay an invalid model checkpoint');
create temporary table pg_temp.committed as select public.world_quest_transition_commit((select (result->>'transitionId')::uuid from pg_temp.clean_reclaimed),(select (result->>'fence')::uuid from pg_temp.clean_reclaimed),jsonb_build_object('version','quest-transition-v1','kind','next_authored_milestone','terminalEventId',(select id::text from pg_temp.terminal),'milestoneId','secure-road','plan','[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb)) result;
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),'scheduled','next authored quest is scheduled rather than backdated active');
select is((select scheduled_for_day from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),6,'successor starts on the day after its terminal outcome');
select ok(private.world_quest_transition_public_digest('72000000-0000-4000-8000-000000000011',5) like '%Secure the road%','next authored milestone is available to the overnight public digest');
select is((select public.world_quest_transition_commit((select (result->>'transitionId')::uuid from pg_temp.clean_reclaimed),'00000000-0000-4000-8000-000000000001','{}'::jsonb)),(select result from pg_temp.committed),'completed transition returns its committed receipt on retry');
update public.tavern_saves set current_day=5 where id='72000000-0000-4000-8000-000000000011';
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),'scheduled','a next-day quest remains scheduled before its eligible opening day');
update public.tavern_saves set current_day=6 where id='72000000-0000-4000-8000-000000000011';
select is((select state from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),'active','scheduled quest activates on its eligible opening day');
select is((select current_step from private.world_quests where id=((select result->>'questId' from pg_temp.committed)::uuid)),0,'opening-day activation does not resolve a quest step early');

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
create temporary table pg_temp.departure_claim as select public.world_quest_transition_claim((select id from pg_temp.generated_terminal)) result;
create temporary table pg_temp.departure_commit as select public.world_quest_transition_commit(
  (select (result->>'transitionId')::uuid from pg_temp.departure_claim),(select (result->>'fence')::uuid from pg_temp.departure_claim),
  jsonb_build_object('version','quest-transition-v1','kind','departure','terminalEventId',(select id::text from pg_temp.generated_terminal),'privateRationale','My work here is complete.','farewellText','I will share one last evening at the tavern before I take the road.','publicNews','Lira plans to leave Millhaven after one final day at the tavern.')
) result;
select is((select result->>'status' from pg_temp.departure_commit),'completed','departure transition commits one canonical receipt');
select is((select (result->>'farewellDay')::integer from pg_temp.departure_commit),7,'departure schedules the full farewell day after the terminal outcome');
select ok(private.world_quest_transition_public_digest('72000000-0000-4000-8000-000000000012',6) like '%Lira plans to leave Millhaven%','departure start is available to the overnight public digest');
update public.tavern_saves set current_day=7 where id='72000000-0000-4000-8000-000000000012';
select is((select state from private.world_npc_departures where instance_id=(select instance_id from pg_temp.departing_resident)),'farewell','resident remains present throughout the farewell day');
select isnt((select status from private.world_npc_instances where id=(select instance_id from pg_temp.departing_resident)),'departed','resident is not marked departed at the start of farewell day');
update public.tavern_saves set current_day=8 where id='72000000-0000-4000-8000-000000000012';
select is((select state from private.world_npc_departures where instance_id=(select instance_id from pg_temp.departing_resident)),'departed','farewell closes after exactly one full day');
select is((select status from private.world_npc_instances where id=(select instance_id from pg_temp.departing_resident)),'departed','resident becomes unavailable after farewell closes');
select ok(exists(select 1 from private.world_npc_tombstones tombstone join private.world_npc_instances resident on resident.npc_id=tombstone.npc_id and resident.version_id=tombstone.version_id where resident.id=(select instance_id from pg_temp.departing_resident) and tombstone.save_id='72000000-0000-4000-8000-000000000012' and tombstone.reason='departed'),'departure leaves a save-local departed tombstone after farewell closes');
select ok(private.world_quest_transition_public_digest('72000000-0000-4000-8000-000000000012',7) like '%departed Millhaven%','departure completion is available to the next overnight public digest');

select * from finish();
rollback;
