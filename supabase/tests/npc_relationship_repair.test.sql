begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select is(private.world_npc_relationship_stage(-10),'strained','relationship scores below zero clamp to strained');
select is(private.world_npc_relationship_stage(0),'strained','zero is strained');
select is(private.world_npc_relationship_stage(24),'strained','24 is the last strained score');
select is(private.world_npc_relationship_stage(25),'acquaintance','25 begins acquaintance');
select is(private.world_npc_relationship_stage(49),'acquaintance','49 is the last acquaintance score');
select is(private.world_npc_relationship_stage(50),'familiar','50 begins familiar');
select is(private.world_npc_relationship_stage(64),'familiar','64 is the last familiar score');
select is(private.world_npc_relationship_stage(65),'trusted','65 begins trusted');
select is(private.world_npc_relationship_stage(79),'trusted','79 is the last trusted score');
select is(private.world_npc_relationship_stage(80),'close','80 begins close');
select is(private.world_npc_relationship_stage(100),'close','100 is close');
select is(private.world_npc_relationship_stage(101),'close','relationship scores above 100 clamp to close');
select has_function('private','world_npc_apply_relationship_change',array['uuid','integer','integer','text','uuid','text'],'the relationship mutation helper is installed');
select ok(has_function_privilege('service_role','private.world_npc_apply_relationship_change(uuid,integer,integer,text,uuid,text)','execute'),'only the server role can apply relationship changes');
select ok(not has_function_privilege('anon','private.world_npc_apply_relationship_change(uuid,integer,integer,text,uuid,text)','execute'),'anonymous callers cannot apply relationship changes');

insert into auth.users(id,email,role,aud)
values('35000000-0000-4000-8000-000000000001','relationship-owner@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='35000000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;

create temporary table pg_temp.fixture as
select save_row.id save_id,save_row.user_id,save_row.current_day,save_row.revision,
  resident.id instance_id,resident.npc_id,resident.version_id
from public.tavern_saves save_row
join private.world_npc_instances resident on resident.save_id=save_row.id
where save_row.user_id='35000000-0000-4000-8000-000000000001'
order by resident.created_at,resident.id limit 1;
update private.world_npc_instances
set relationship=45
where id=(select instance_id from pg_temp.fixture);

insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,
  status,lease_until,checkpoints
)
select turn.id,fixture.save_id,fixture.instance_id,fixture.npc_id,fixture.version_id,fixture.user_id,
  turn.message,turn.sequence,fixture.revision,turn.day,'completed',clock_timestamp()+interval '5 minutes',
  jsonb_build_object('decision',jsonb_build_object('value',jsonb_build_object(
    'reaction',1,'subject','personal','evidence',turn.evidence
  )))
from pg_temp.fixture fixture
cross join (values
  ('35000000-0000-4000-8000-000000000010'::uuid,'I took the road watch and left your sister behind.',0,1,'road watch'),
  ('35000000-0000-4000-8000-000000000011'::uuid,'I’m really sorry for what I said.',1,2,'sorry'),
  ('35000000-0000-4000-8000-000000000012'::uuid,'You’re truly the best friend I ever had.',2,2,'the best'),
  ('35000000-0000-4000-8000-000000000013'::uuid,'I am truly sorry about yesterday. I set up a north road watch and escorted the injured travelers to safety.',3,2,'north road watch'),
  ('35000000-0000-4000-8000-000000000014'::uuid,'I brought medicine back and checked the east road warning.',4,2,'medicine back'),
  ('35000000-0000-4000-8000-000000000015'::uuid,'I posted the new trail markers and paid the injured travelers bill.',5,3,'trail markers'),
  ('35000000-0000-4000-8000-000000000016'::uuid,'I returned to confirm the watch with the family.',6,3,'confirm the watch'),
  ('35000000-0000-4000-8000-000000000017'::uuid,'I checked the path with the travelers again.',7,3,'checked the path')
) as turn(id,message,sequence,day,evidence);

select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),45,'fixture begins at the neutral acquaintance score');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),1,-2,'dialogue','35000000-0000-4000-8000-000000000010','personal'
),-2,'a committed offense applies an immediate relationship loss');
select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),43,'the offense changes the score inside the same named stage');
select is(private.world_npc_relationship_projection((select instance_id from pg_temp.fixture))#>>'{recentRelationshipChange,delta}','-2','the projection exposes committed harm feedback');
select is(private.world_npc_relationship_projection((select instance_id from pg_temp.fixture))#>>'{recentRelationshipChange,dayNumber}','1','the harm projection identifies the game day');

update public.tavern_saves set current_day=2 where id=(select save_id from pg_temp.fixture);
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),2,2,'dialogue','35000000-0000-4000-8000-000000000011','personal'
),0,'a curly-apostrophe apology alone cannot repair an offense');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),2,2,'dialogue','35000000-0000-4000-8000-000000000012','personal'
),0,'generic praise alone cannot count as follow-through');
select is((select cardinality(follow_through_days) from private.world_npc_relationship_repair where instance_id=(select instance_id from pg_temp.fixture)),0,'apology and generic praise add no repair days');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),2,2,'dialogue','35000000-0000-4000-8000-000000000013','personal'
),0,'first meaningful later-day follow-through is recorded without restoring trust yet');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),2,2,'dialogue','35000000-0000-4000-8000-000000000014','personal'
),0,'a second same-day interaction cannot count as another repair day');
select is((select follow_through_days from private.world_npc_relationship_repair where instance_id=(select instance_id from pg_temp.fixture)),array[2]::integer[],'same-day follow-through is deduplicated');
select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),43,'one later day of follow-through leaves the offense unrepaired');

update public.tavern_saves set current_day=3 where id=(select save_id from pg_temp.fixture);
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),3,2,'dialogue','35000000-0000-4000-8000-000000000015','personal'
),2,'a second meaningful later day permits repair');
select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),45,'two later days restore trust by one bounded positive interaction');
select ok(not (private.world_npc_relationship_projection((select instance_id from pg_temp.fixture)) ? 'relationshipRepair'),'completed repair no longer projects as pending');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),3,2,'dialogue','35000000-0000-4000-8000-000000000016','personal'
),2,'the daily gain cap still permits the second bounded interaction');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),3,2,'dialogue','35000000-0000-4000-8000-000000000017','personal'
),0,'repeated same-day inputs cannot exceed the daily gain cap');
select is((select sum(delta)::integer from private.world_npc_relationship_changes where instance_id=(select instance_id from pg_temp.fixture) and day_number=3),4,'daily positive changes are capped at four points');
select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),47,'the capped same-day total is reflected in the resident score');

update public.tavern_saves set current_day=4 where id=(select save_id from pg_temp.fixture);
insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id)
select '35000000-0000-4000-8000-000000000030',save_id,'Roadside loaf','test-loaf',5,4,'35000000-0000-4000-8000-000000000031'
from pg_temp.fixture;
select throws_ok($$select private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),4,1,'hospitality','35000000-0000-4000-8000-000000000030',null
)$$,'PT409',null,'hospitality relationship change must match the offered food quality');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),4,2,'hospitality','35000000-0000-4000-8000-000000000030',null
),2,'quality-backed hospitality applies its bounded change through the same helper');
select is(private.world_npc_apply_relationship_change(
  (select instance_id from pg_temp.fixture),4,2,'hospitality','35000000-0000-4000-8000-000000000030',null
),2,'replaying the same hospitality source returns its original change');
select is((select relationship from private.world_npc_instances where id=(select instance_id from pg_temp.fixture)),49,'replayed hospitality does not apply its relationship change twice');
select is((select count(*)::integer from private.world_npc_relationship_changes where source_kind='hospitality' and source_id='35000000-0000-4000-8000-000000000030'),1,'hospitality source has one durable relationship receipt');

select * from finish();
rollback;
