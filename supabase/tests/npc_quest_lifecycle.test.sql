begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select has_table('private','world_quests','canonical quest table exists');
select has_table('private','world_quest_events','quest event ledger exists');
select has_table('private','world_quest_plan_revisions','plan revision ledger exists');
select has_table('private','world_quest_transitions','transition receipt table exists');
select has_function('private','world_current_quest',array['uuid','uuid'],'current quest accessor exists');
select has_function('private','world_quest_plan_is_valid',array['jsonb'],'plan validator exists');
select has_function('private','world_materialize_resident_from_version',array['uuid','uuid','uuid','integer'],'materializer keeps its public signature');

select ok(private.world_quest_plan_is_valid('[{"action":"attempt","approach":"scouting"}]'::jsonb),'one-step terminal plan is valid');
select ok(private.world_quest_plan_is_valid('[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"combat"}]'::jsonb),'prepare followed by attempt is valid');
select ok(not private.world_quest_plan_is_valid('[{"action":"attempt","approach":"scouting"},{"action":"wait","approach":"scouting"}]'::jsonb),'terminal action cannot precede another step');
select ok(not private.world_quest_plan_is_valid('[{"action":"prepare","approach":"scouting"}]'::jsonb),'plan must end terminally');
select ok(not private.world_quest_plan_is_valid('[{"action":"attempt","approach":"magic"}]'::jsonb),'unknown approach is rejected');

select col_is_pk('private','world_quests','id','quest has immutable identity');
select has_index('private','world_quests','world_quests_one_live_per_resident','one active or scheduled quest index exists');
select has_index('private','world_quests','world_quests_authored_milestone_identity','authored milestone identity index exists');
select has_trigger('private','world_quests','world_quest_immutable_definition_guard','quest definition guard exists');

insert into auth.users(id,email,role,aud) values ('70000000-0000-4000-8000-000000000001','quest-lifecycle@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day) values ('70000000-0000-4000-8000-000000000011','70000000-0000-4000-8000-000000000001',4);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.materialized as select * from private.world_materialize_resident_from_version('70000000-0000-4000-8000-000000000011','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
select is((select count(*) from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'),1::bigint,'first materialization creates one authored quest');
select ok((select title='Scout the camp' and objective='Map the bandit camp and identify a safe approach for travelers.' and definition_plan='[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb and scheduled_for_day=4 from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'),'first quest pins authored milestone fields and starting plan');
select is((select count(*) from private.world_materialize_resident_from_version('70000000-0000-4000-8000-000000000011','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1)),1::bigint,'materializer replay returns its resident');
select is((select count(*) from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'),1::bigint,'materializer replay creates no duplicate authored quest');
select is((select id from private.world_current_quest('70000000-0000-4000-8000-000000000011',(select instance_id from pg_temp.materialized))),(select id from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'),'current quest accessor returns the live authored quest');
select throws_ok($$update private.world_quests set title='rewritten' where save_id='70000000-0000-4000-8000-000000000011'$$,'55000',null,'quest definition is immutable');
insert into private.world_quest_events(quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,preparation_before,preparation_after,hospitality,readiness,outcome) select id,save_id,instance_id,4,0,'prepare','scouting',1,2,0,1,0,0,'prepared' from private.world_quests where save_id='70000000-0000-4000-8000-000000000011';
select throws_ok($$update private.world_quest_events set narration='rewritten' where save_id='70000000-0000-4000-8000-000000000011'$$,'55000',null,'quest events are append-only');
select throws_ok($$delete from private.world_quest_events where save_id='70000000-0000-4000-8000-000000000011'$$,'55000',null,'quest events cannot be deleted');
select throws_ok($$insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day) select save_id,instance_id,package_id,package_hash,version_id,'authored_milestone',1,'other-active','Other active','A distinct authored key','Fixture',constraints,target_refs,difficulty,definition_plan,current_plan,'active',0,0,4,4 from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'$$,'23505',null,'partial unique index rejects a second active quest for one resident');
select throws_ok($$insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day) select save_id,instance_id,package_id,package_hash,version_id,'authored_milestone',2,'other-scheduled','Other scheduled','A distinct authored key','Fixture',constraints,target_refs,difficulty,definition_plan,current_plan,'scheduled',0,0,5 from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'$$,'23505',null,'partial unique index rejects a scheduled quest while one is active');
update private.world_quests set state='succeeded',terminal_day=4 where save_id='70000000-0000-4000-8000-000000000011';
select throws_ok($$insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day) select save_id,instance_id,package_id,package_hash,version_id,'authored_milestone',0,authored_milestone_key,'Duplicate authored','Duplicate','Fixture',constraints,target_refs,difficulty,definition_plan,current_plan,'active',0,0,5,5 from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'$$,'23505',null,'authored milestone identity remains unique after terminal history');
select lives_ok($$insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day) select save_id,instance_id,package_id,package_hash,version_id,'generated_successor',id,'Generated successor','A valid successor','Fixture',constraints,target_refs,difficulty,definition_plan,current_plan,'scheduled',0,0,5 from private.world_quests where save_id='70000000-0000-4000-8000-000000000011'$$,'terminal authored quest admits a valid generated successor');

select * from finish();
rollback;
