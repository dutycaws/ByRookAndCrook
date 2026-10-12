begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users(id,email,role,aud)
values('36000000-0000-4000-8000-000000000001','relationship-context@example.test','authenticated','authenticated');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='36000000-0000-4000-8000-000000000001';
select public.create_tavern();
set local request.jwt.claim.role='service_role';

create temporary table pg_temp.fixture as
with residents as (
  select save_row.id save_id,save_row.user_id,save_row.current_day,save_row.revision,
    resident.id instance_id,resident.npc_id,resident.version_id,
    row_number() over(order by resident.created_at,resident.id) resident_number
  from public.tavern_saves save_row
  join private.world_npc_instances resident on resident.save_id=save_row.id
  where save_row.user_id='36000000-0000-4000-8000-000000000001'
)
select selected.save_id,selected.user_id,selected.current_day,selected.revision,
  selected.instance_id selected_instance_id,selected.npc_id selected_npc_id,selected.version_id selected_version_id,
  other.instance_id other_instance_id,other.npc_id other_npc_id,other.version_id other_version_id
from residents selected
join residents other on other.save_id=selected.save_id and other.resident_number=2
where selected.resident_number=1;

select is((select count(*)::integer from pg_temp.fixture),1,'fixture has two independently addressable residents');
update private.world_npc_instances set relationship=45 where id=(select selected_instance_id from pg_temp.fixture);

insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,
  status,lease_until,checkpoints
)
select '36000000-0000-4000-8000-000000000010',save_id,selected_instance_id,selected_npc_id,selected_version_id,user_id,
  'I took the road watch and left your sister behind.',0,revision,1,'completed',clock_timestamp()+interval '5 minutes',
  '{"decision":{"value":{"reaction":-1,"subject":"personal","evidence":"road watch"}}}'::jsonb
from pg_temp.fixture;
select is(private.world_npc_apply_relationship_change(
  (select selected_instance_id from pg_temp.fixture),1,-2,'dialogue','36000000-0000-4000-8000-000000000010','personal'
),-2,'offense creates repair debt on the selected resident');

update public.tavern_saves set current_day=2 where id=(select save_id from pg_temp.fixture);
insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,
  status,lease_until,checkpoints
)
select '36000000-0000-4000-8000-000000000011',save_id,selected_instance_id,selected_npc_id,selected_version_id,user_id,
  'I brought medicine back and checked the east road warning.',1,revision,2,'completed',clock_timestamp()+interval '5 minutes',
  '{"decision":{"value":{"reaction":1,"subject":"personal","evidence":"brought medicine"}}}'::jsonb
from pg_temp.fixture;
insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,
  status,lease_until
)
select '36000000-0000-4000-8000-000000000012',save_id,other_instance_id,other_npc_id,other_version_id,user_id,
  'How are things today?',0,revision,2,'completed',clock_timestamp()+interval '5 minutes'
from pg_temp.fixture;
select is(private.world_npc_apply_relationship_change(
  (select selected_instance_id from pg_temp.fixture),2,2,'dialogue','36000000-0000-4000-8000-000000000011','personal'
),0,'one later follow-through day records debt without restoring the relationship yet');

create temporary table pg_temp.selected_context as
  select public.npc_dialogue_context((select user_id from pg_temp.fixture),'36000000-0000-4000-8000-000000000011','base','') result;
select is((select result->>'instanceId' from pg_temp.selected_context),(select selected_instance_id::text from pg_temp.fixture),'base context is scoped to the selected resident');
select is((select result->'relationshipRepair' from pg_temp.selected_context),
  '{"offenseDay":1,"distinctFollowThroughDays":1,"requiredDays":2,"eligibility":{"qualifyingInteraction":"Positive source-evidenced follow-through tied to the keeper’s exact message.","requiredDistinctDaysAfterOffense":2,"nonQualifyingAlone":["apology","greeting","generic praise"]}}'::jsonb,
  'base context carries the selected resident’s current debt and explicit eligibility conditions');
select is((public.npc_dialogue_context((select user_id from pg_temp.fixture),'36000000-0000-4000-8000-000000000011','relationships','')->'relationshipRepair'),
  (select result->'relationshipRepair' from pg_temp.selected_context),'optional relationships context uses the same repair projection');
select is(public.npc_dialogue_context((select user_id from pg_temp.fixture),'36000000-0000-4000-8000-000000000012','base','')->'relationshipRepair',null,
  'another selected resident receives no repair debt from the offended resident');

update public.tavern_saves set current_day=3 where id=(select save_id from pg_temp.fixture);
insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,
  status,lease_until,checkpoints
)
select '36000000-0000-4000-8000-000000000013',save_id,selected_instance_id,selected_npc_id,selected_version_id,user_id,
  'I checked the road with the injured travelers again.',2,revision,3,'completed',clock_timestamp()+interval '5 minutes',
  '{"decision":{"value":{"reaction":1,"subject":"personal","evidence":"checked the road"}}}'::jsonb
from pg_temp.fixture;
select is(private.world_npc_apply_relationship_change(
  (select selected_instance_id from pg_temp.fixture),3,2,'dialogue','36000000-0000-4000-8000-000000000013','personal'
),2,'second distinct post-offense follow-through resolves the repair debt');
select is(public.npc_dialogue_context((select user_id from pg_temp.fixture),'36000000-0000-4000-8000-000000000013','base','')->'relationshipRepair',null,
  'base context removes repair debt immediately after the second qualifying day');
select is(public.npc_dialogue_context((select user_id from pg_temp.fixture),'36000000-0000-4000-8000-000000000013','relationships','')->'relationshipRepair','null'::jsonb,
  'optional relationships context reports no debt after repair is complete');
select ok(not has_function_privilege('anon','public.npc_dialogue_context(uuid,uuid,text,text)','execute'),'anonymous callers still cannot read frozen dialogue context');
select * from finish();
rollback;
