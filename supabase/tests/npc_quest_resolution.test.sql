begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select is(private.world_quest_readiness(0,-9),-30,'readiness clamps at its lower bound');
select is(private.world_quest_readiness(2,9),30,'readiness clamps at its upper bound');
select is(private.world_quest_chance(0,4,-30),5,'chance clamps at its lower bound');
select is(private.world_quest_chance(4,0,30),95,'chance clamps at its upper bound');
select is(private.world_quest_chance(2,2,0),50,'chance has the neutral baseline');
select has_function('private','world_resolve_quest_step',array['uuid','integer','integer'],'step resolver exists');
select has_function('private','world_quest_hospitality',array['uuid','integer'],'hospitality helper exists');
select has_function('private','world_quest_readiness',array['integer','integer'],'readiness helper exists');
select has_function('private','world_quest_chance',array['integer','integer','integer'],'chance helper exists');

insert into auth.users(id,email,role,aud) values
  ('71000000-0000-4000-8000-000000000001','quest-resolution-main@example.test','authenticated','authenticated'),
  ('71000000-0000-4000-8000-000000000002','quest-resolution-failure@example.test','authenticated','authenticated'),
  ('71000000-0000-4000-8000-000000000003','quest-resolution-wait@example.test','authenticated','authenticated'),
  ('71000000-0000-4000-8000-000000000004','quest-resolution-abandon@example.test','authenticated','authenticated'),
  ('71000000-0000-4000-8000-000000000005','quest-resolution-advance@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values
  ('71000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000001',4,0),
  ('71000000-0000-4000-8000-000000000012','71000000-0000-4000-8000-000000000002',4,0),
  ('71000000-0000-4000-8000-000000000013','71000000-0000-4000-8000-000000000003',4,0),
  ('71000000-0000-4000-8000-000000000014','71000000-0000-4000-8000-000000000004',4,0),
  ('71000000-0000-4000-8000-000000000015','71000000-0000-4000-8000-000000000005',4,0);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.main_resident as select * from private.world_materialize_resident_from_version('71000000-0000-4000-8000-000000000011','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.other_resident as select * from private.world_materialize_resident_from_version('71000000-0000-4000-8000-000000000011','28282828-2828-4282-8282-282828282828','28282828-2828-4282-8282-282828282829',1);
create temporary table pg_temp.failure_resident as select * from private.world_materialize_resident_from_version('71000000-0000-4000-8000-000000000012','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.wait_resident as select * from private.world_materialize_resident_from_version('71000000-0000-4000-8000-000000000013','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.abandon_resident as select * from private.world_materialize_resident_from_version('71000000-0000-4000-8000-000000000014','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.advance_resident as select * from private.world_materialize_resident_from_version('71000000-0000-4000-8000-000000000015','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);

insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id) values
  ('71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000011','Fine trail meal','quest-food-main',6,4,'71000000-0000-4000-8000-000000000111'),
  ('71000000-0000-4000-8000-000000000102','71000000-0000-4000-8000-000000000011','Poor trade meal','quest-food-other',0,4,'71000000-0000-4000-8000-000000000112');
insert into private.world_npc_hospitality_events(save_id,action_id,actor_id,instance_id,item_kind,food_id,input_expected_revision,day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision) values
  ('71000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000121','71000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.main_resident),'food','71000000-0000-4000-8000-000000000101',0,4,'Fine trail meal',6,0,0,'{}',1),
  ('71000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000122','71000000-0000-4000-8000-000000000001',(select instance_id from pg_temp.other_resident),'food','71000000-0000-4000-8000-000000000102',0,4,'Poor trade meal',0,0,0,'{}',1);
select is(private.world_quest_hospitality((select id from private.world_quests where save_id='71000000-0000-4000-8000-000000000011' and instance_id=(select instance_id from pg_temp.main_resident)),4),3,'same-NPC hospitality is clamped positively');
select is(private.world_quest_hospitality((select id from private.world_quests where save_id='71000000-0000-4000-8000-000000000011' and instance_id=(select instance_id from pg_temp.other_resident)),4),-3,'other NPC hospitality stays in its own quest scope');

create temporary table pg_temp.main_prepare as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='71000000-0000-4000-8000-000000000011' and instance_id=(select instance_id from pg_temp.main_resident)),4,null);
select ok((select action='prepare' and preparation_before=0 and preparation_after=1 and hospitality=3 and readiness=15 and chance is null and draw is null and rules_version='quest-resolution-v1' from pg_temp.main_prepare),'prepare persists deterministic replay inputs');
select is((select current_step from private.world_quests where id=(select quest_id from pg_temp.main_prepare)),1,'prepare advances exactly one step');
create temporary table pg_temp.main_prepare_replay as select * from private.world_resolve_quest_step((select quest_id from pg_temp.main_prepare),4,99);
select is((select id from pg_temp.main_prepare_replay),(select id from pg_temp.main_prepare),'same-day replay returns the exact event');
create temporary table pg_temp.main_success as select * from private.world_resolve_quest_step((select quest_id from pg_temp.main_prepare),5,0);
select ok((select action='attempt' and outcome='succeeded' and draw=0 and chance=95 from pg_temp.main_success),'attempt success uses the deterministic draw and clamped chance');
select is((select state from private.world_quests where id=(select quest_id from pg_temp.main_success)),'succeeded','successful attempt terminalizes the quest');
select is((select count(*) from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.main_success)),1::bigint,'terminal attempt creates one pending transition');
select ok((
  select exists(
    select 1
    from jsonb_array_elements(transition.frozen_context->'validCanonicalTargets') target
    where target->>'ref'='old-road' and target->>'kind'='quest_target'
  )
  from private.world_quest_transitions transition
  where transition.terminal_event_id=(select id from pg_temp.main_success)
),'transition context retains the completed authored quest targets for a bounded generated successor');
select is((select jsonb_object_length(frozen_context) from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.main_success)),13,'bounded transition snapshot has the forward 13-key contract');
select ok((select not frozen_context ? 'hospitality' and octet_length(frozen_context::text)<=65536 from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.main_success)),'snapshot omits optional hospitality evidence and stays under the byte budget');
select is((select context_fingerprint from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.main_success)),(select encode(extensions.digest(private.world_canonical_json(frozen_context),'sha256'),'hex') from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.main_success)),'snapshot fingerprint is derived from the final bounded projection');
select is((select count(*) from private.world_quest_events where quest_id=(select quest_id from pg_temp.main_success)),2::bigint,'canonical quest history remains complete outside the bounded model snapshot');
select throws_ok($$update private.world_quest_events set narration='rewrite' where id=(select id from pg_temp.main_success)$$,'55000',null,'terminal event remains append-only');

create temporary table pg_temp.failure_prepare as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='71000000-0000-4000-8000-000000000012'),4,null);
create temporary table pg_temp.failure_attempt as select * from private.world_resolve_quest_step((select quest_id from pg_temp.failure_prepare),5,99);
select ok((select outcome='failed' and draw=99 from pg_temp.failure_attempt),'high deterministic draw produces failure');
select is((select state from private.world_quests where id=(select quest_id from pg_temp.failure_attempt)),'failed','failed attempt terminalizes the quest');

update private.world_quests set current_plan='[{"action":"wait","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb,plan_revision=2 where save_id='71000000-0000-4000-8000-000000000013';
create temporary table pg_temp.wait_event as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='71000000-0000-4000-8000-000000000013'),4,null);
select ok((select action='wait' and outcome='waited' and preparation_after=0 from pg_temp.wait_event),'wait records a non-terminal step');

update private.world_quests set current_plan='[{"action":"abandon","approach":"scouting"}]'::jsonb,plan_revision=2 where save_id='71000000-0000-4000-8000-000000000014';
create temporary table pg_temp.abandon_event as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='71000000-0000-4000-8000-000000000014'),4,null);
select ok((select action='abandon' and outcome='abandoned' and chance is null and draw is null from pg_temp.abandon_event),'abandon terminalizes without chance or draw');
select is((select count(*) from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.abandon_event)),1::bigint,'abandon creates one pending transition');
select throws_ok($$delete from private.world_quest_events where id=(select id from pg_temp.abandon_event)$$,'55000',null,'terminal event deletion remains forbidden');

set local request.jwt.claim.sub='71000000-0000-4000-8000-000000000005';
insert into public.garden_weather(save_id,day_number,rules_version,weather_key)
values('71000000-0000-4000-8000-000000000015',4,'garden-apiary-v1',private.garden_weather_key(4));
create temporary table pg_temp.advance_receipt as select public.advance_tavern_day('71000000-0000-4000-8000-000000000015','71000000-0000-4000-8000-000000000151',0) as result;
select ok((select result ? 'questLifecycle' and jsonb_array_length(result->'questLifecycle')=1 from pg_temp.advance_receipt),'public day close emits one player-safe quest lifecycle summary');
select is((select public.advance_tavern_day('71000000-0000-4000-8000-000000000015','71000000-0000-4000-8000-000000000151',0)),(select result from pg_temp.advance_receipt),'exact day-close action replay keeps the quest receipt byte-equivalent');

select * from finish();
rollback;
