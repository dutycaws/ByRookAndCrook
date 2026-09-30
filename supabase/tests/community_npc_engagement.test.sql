begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users(id,email,role,aud) values
  ('18500000-0000-4000-8000-000000000001','engagement-player@example.test','authenticated','authenticated'),
  ('18500000-0000-4000-8000-000000000002','engagement-author@example.test','authenticated','authenticated'),
  ('18500000-0000-4000-8000-000000000003','engagement-reviewer@example.test','authenticated','authenticated');

insert into public.tavern_saves(id,user_id,current_day) values
  ('18500000-1000-4000-8000-000000000001','18500000-0000-4000-8000-000000000001',7);
insert into public.player_profiles(user_id,display_name) values
  ('18500000-0000-4000-8000-000000000002','Engagement Author');
insert into private.npc_capabilities(user_id,capability) values
  ('18500000-0000-4000-8000-000000000002','npc_author'),
  ('18500000-0000-4000-8000-000000000003','npc_reviewer');

insert into private.npc_identities(id,origin,creator_id,normalized_name,status,rating) values
  ('18500000-2000-4000-8000-000000000001','community','18500000-0000-4000-8000-000000000002','analytics scout','published','standard'),
  ('18500000-2000-4000-8000-000000000002','first_party',null,'analytics fixture','published','standard');
insert into private.npc_identity_owners(npc_id,user_id) values
  ('18500000-2000-4000-8000-000000000001','18500000-0000-4000-8000-000000000002');
create temporary table pg_temp.fixture_sheets(community_sheet jsonb,first_party_sheet jsonb);
insert into pg_temp.fixture_sheets
select
  jsonb_set(jsonb_set(sheet,'{campaign,milestones}',jsonb_build_array(sheet#>'{campaign,milestones,0}')),'{identity,name}','"Analytics Scout"'::jsonb),
  jsonb_set(jsonb_set(sheet,'{campaign,milestones}',jsonb_build_array(sheet#>'{campaign,milestones,0}')),'{identity,name}','"Analytics Fixture"'::jsonb)
from private.npc_versions where id='18181818-1818-4181-8181-181818181819';

insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,submitted_at,created_by)
select '18500000-3000-4000-8000-000000000001','18500000-2000-4000-8000-000000000001',1,'npc-sheet-v2',community_sheet,
  encode(extensions.digest(private.npc_canonical_json(community_sheet),'sha256'),'hex'),'submitted',clock_timestamp(),'18500000-0000-4000-8000-000000000002'
from pg_temp.fixture_sheets;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18500000-0000-4000-8000-000000000003';
select public.npc_reviewer_decide('18500000-3000-4000-8000-000000000001','approve','Analytics fixture package.',null,
  array['quest.action.prepare','quest.action.attempt','quest.approach.scouting','effect.adjust_relationship','social.conceal']);
select public.npc_reviewer_publish('18500000-3000-4000-8000-000000000001');
reset role;

grant usage on schema private to service_role;
grant execute on function private.npc_install_first_party_release(uuid,text,integer,uuid,text,integer,boolean,jsonb,text[]) to service_role;
grant execute on function private.world_materialize_resident_from_version(uuid,uuid,uuid,integer) to service_role;
grant select on pg_temp.fixture_sheets to service_role;
set local role service_role;
select private.npc_install_first_party_release(
  '18500000-2000-4000-8000-000000000002','analytics-fixture',99,'18500000-3000-4000-8000-000000000002','v1',1,true,
  (select first_party_sheet from pg_temp.fixture_sheets),array['quest.action.prepare','quest.approach.scouting','effect.adjust_relationship','social.conceal']
);
create temporary table pg_temp.instances as
  select * from private.world_materialize_resident_from_version(
    '18500000-1000-4000-8000-000000000001','18500000-2000-4000-8000-000000000001','18500000-3000-4000-8000-000000000001',7
  );
insert into pg_temp.instances
  select * from private.world_materialize_resident_from_version(
    '18500000-1000-4000-8000-000000000001','18500000-2000-4000-8000-000000000002','18500000-3000-4000-8000-000000000002',7
  );
reset role;
select is((select count(*) from private.npc_engagement_events where version_id='18500000-3000-4000-8000-000000000001'),2::bigint,'community assignment records one assigned and one active event');
select is((select count(*) from private.npc_engagement_events where version_id='18500000-3000-4000-8000-000000000002'),0::bigint,'first-party residents are excluded from community analytics');
select ok(not exists(select 1 from private.npc_engagement_events where actor_id is null or world_hash is null),'runtime capture has a world hash and bounded attribution');

insert into private.world_npc_quest_events(id,instance_id,day,outcome,narration) values
  ('18500000-5000-4000-8000-000000000001',(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001'),7,'succeeded','A bounded success.'),
  ('18500000-5000-4000-8000-000000000002',(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001'),8,'failed','A bounded failure.'),
  ('18500000-5000-4000-8000-000000000003',(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001'),9,'abandoned','A bounded abandonment.'),
  ('18500000-5000-4000-8000-000000000004',(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001'),10,'settled','A bounded completion.');
select is((select count(*) from private.npc_engagement_events where event_kind='day_present'),4::bigint,'each quest day records presence once');
select is((select count(*) from private.npc_engagement_events where event_kind='milestone_success'),2::bigint,'success and final settlement record milestone success');
select is((select count(*) from private.npc_engagement_events where event_kind='milestone_failure'),1::bigint,'failure is captured once');
select is((select count(*) from private.npc_engagement_events where event_kind='abandoned'),1::bigint,'abandonment is captured once');
select is((select count(*) from private.npc_engagement_events where event_kind='campaign_complete'),1::bigint,'settlement records campaign completion');

insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until)
  values('18500000-6000-4000-8000-000000000001','18500000-1000-4000-8000-000000000001',(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001'),'18500000-2000-4000-8000-000000000001','18500000-3000-4000-8000-000000000001','18500000-0000-4000-8000-000000000001','No raw dialogue in analytics.',0,0,7,'processing',now());
update private.world_npc_dialogue_turns set status='completed',result='{"reply":"No raw reply in analytics."}'::jsonb where id='18500000-6000-4000-8000-000000000001';
update private.world_npc_dialogue_turns set status='completed' where id='18500000-6000-4000-8000-000000000001';
select is((select count(*) from private.npc_engagement_events where event_kind='dialogue'),1::bigint,'dialogue completion retry cannot double count');
select ok(not exists(select 1 from private.npc_engagement_events where metadata::text like '%raw dialogue%' or metadata::text like '%raw reply%'),'engagement metadata never copies dialogue prose');

insert into public.foods(id,save_id,name,recipe_key,quality_index,day_number,source_action_id)
  values('18500000-7100-4000-8000-000000000001','18500000-1000-4000-8000-000000000001','Fixture loaf','fixture-loaf',3,7,'18500000-7200-4000-8000-000000000001');
insert into private.world_npc_hospitality_events(save_id,action_id,actor_id,instance_id,item_kind,food_id,input_expected_revision,day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision)
  values('18500000-1000-4000-8000-000000000001','18500000-7000-4000-8000-000000000001','18500000-0000-4000-8000-000000000001',(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001'),'food','18500000-7100-4000-8000-000000000001',0,7,'Fixture loaf',3,6,1,'{}',1);
select is((select count(*) from private.npc_engagement_events where event_kind='hospitality'),1::bigint,'hospitality receipt is captured once');

update private.world_npc_instances set status='dismissed',dismissed_day=7 where id=(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001');
update private.world_npc_instances set status='dismissed' where id=(select instance_id from pg_temp.instances where version_id='18500000-3000-4000-8000-000000000001');
select is((select count(*) from private.npc_engagement_events where event_kind='dismissed'),1::bigint,'dismissal transition is idempotent');

-- A report normally requires an extant resident; insert directly here to
-- exercise the durable after-insert hook after a dismissal.
insert into private.npc_reports(id,reporter_id,world_id,version_id,category,evidence) values
  ('18500000-8000-4000-8000-000000000001','18500000-0000-4000-8000-000000000001','18500000-1000-4000-8000-000000000001','18500000-3000-4000-8000-000000000001','content','A concise report for analytics.');
select is((select count(*) from private.npc_engagement_events where event_kind='report'),1::bigint,'report insertion is captured once');

set local role service_role;
set local request.jwt.claim.role='service_role';
select public.npc_rollup_analytics(current_date);
reset role;
select is((select assignments from public.npc_daily_analytics where event_day=current_date and version_id='18500000-3000-4000-8000-000000000001'),1,'daily rollup derives assignments from captured events');
select is((select dialogue_turns from public.npc_daily_analytics where event_day=current_date and version_id='18500000-3000-4000-8000-000000000001'),1,'daily rollup derives dialogue count without source prose');
select is((select report_band from public.npc_daily_analytics where event_day=current_date and version_id='18500000-3000-4000-8000-000000000001'),'some','daily rollup reports a privacy-safe report band');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18500000-0000-4000-8000-000000000002';
select ok(not has_schema_privilege('authenticated','private','usage'),'authors cannot reach the raw engagement schema');
select ok((public.npc_author_analytics()::text not like '%No raw dialogue%'),'creator analytics cannot disclose dialogue or memories');
reset role;

select * from finish();
rollback;
