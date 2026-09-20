begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users(id,email,role,aud) values
  ('18100000-0000-4000-8000-000000000061','purge-player@example.test','authenticated','authenticated'),
  ('18100000-0000-4000-8000-000000000062','purge-reviewer@example.test','authenticated','authenticated'),
  ('18100000-0000-4000-8000-000000000063','purge-owner@example.test','authenticated','authenticated');
insert into private.npc_capabilities(user_id,capability) values
  ('18100000-0000-4000-8000-000000000062','npc_reviewer'),
  ('18100000-0000-4000-8000-000000000063','npc_author');

-- The mature opt-out path must remove a fully-populated resident without
-- leaving a transcript, memory, share, report copy, or hospitality receipt.
update private.npc_identities set rating='mature'
  where id='18181818-1818-4181-8181-181818181818';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000061';
select public.npc_update_profile('Purge Player','Exercises local privacy removal.',true,true,false);
select public.create_tavern();
reset role;
create temporary table pg_temp.mature_world as
  select s.id save_id,w.id instance_id,w.version_id
  from public.tavern_saves s join private.world_npc_instances w on w.save_id=s.id
  where s.user_id='18100000-0000-4000-8000-000000000061'
    and w.npc_id='18181818-1818-4181-8181-181818181818';
grant select on pg_temp.mature_world to authenticated;

select throws_ok(
  $$delete from private.world_resident_package_pins where instance_id=(select instance_id from pg_temp.mature_world)$$,
  '55000',null,
  'a resident package pin cannot be deleted directly'
);

insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,
  source_revision,day_number,status,lease_until,result,completed_at
) values (
  '18100000-3000-4000-8000-000000000001',(select save_id from pg_temp.mature_world),
  (select instance_id from pg_temp.mature_world),'18181818-1818-4181-8181-181818181818',
  (select version_id from pg_temp.mature_world),'18100000-0000-4000-8000-000000000061',
  'Please remember the old road.',0,0,1,'completed',now(),'{"reply":"I remember the old road."}'::jsonb,now()
);
insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker)
  values('18100000-3000-4000-8000-000000000001',(select instance_id from pg_temp.mature_world),'npc_statement','Lira remembers the old road.','old road','npc');
insert into private.world_npc_quest_events(instance_id,day,outcome,narration,public_news)
  values((select instance_id from pg_temp.mature_world),1,'prepared','Lira prepared a private route.',true);
insert into public.foods(save_id,name,quality_index,source_action_id,day_number,recipe_key,rules_version)
  values((select save_id from pg_temp.mature_world),'Privacy loaf',4,'18100000-3000-4000-8000-000000000002',1,'hearth-loaf','purge-test-v1');
insert into private.world_npc_hospitality_events(
  save_id,action_id,actor_id,instance_id,item_kind,food_id,input_expected_revision,
  day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision
) values (
  (select save_id from pg_temp.mature_world),'18100000-3000-4000-8000-000000000003',
  '18100000-0000-4000-8000-000000000061',(select instance_id from pg_temp.mature_world),'food',
  (select id from public.foods where save_id=(select save_id from pg_temp.mature_world) and name='Privacy loaf'),0,
  1,'Privacy loaf',4,16,2,'{"itemName":"Privacy loaf"}'::jsonb,1
);
insert into private.npc_conversation_shares(save_id,instance_id,created_by,transcript)
  values((select save_id from pg_temp.mature_world),(select instance_id from pg_temp.mature_world),'18100000-0000-4000-8000-000000000061','[{"npc":"I remember the old road."}]'::jsonb);
create temporary table pg_temp.mature_share as
  select share_token from private.npc_conversation_shares where instance_id=(select instance_id from pg_temp.mature_world);
grant select on pg_temp.mature_share to authenticated;
insert into private.npc_reports(reporter_id,world_id,version_id,category,evidence,transcript,frozen_version,generation_metadata)
  values('18100000-0000-4000-8000-000000000061',(select save_id from pg_temp.mature_world),(select version_id from pg_temp.mature_world),'privacy','Remove every visible copied narrative.','[{"text":"Lira prepared a private route."}]'::jsonb,'{"sheet":{"identity":{"name":"Lira"}}}'::jsonb,'{"provider":"fixture"}'::jsonb);

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000061';
select public.npc_update_community_settings('Purge Player','Exercises local privacy removal.',false,false,false);
select is(jsonb_array_length(public.npc_roster(20,null,null)),1,'settings update atomically removes mature residents from the player roster');
select is(public.npc_journals(array[(select instance_id from pg_temp.mature_world)]),'{}'::jsonb,'removed resident has no journal or transcript projection');
select is(public.npc_share_view((select share_token from pg_temp.mature_share))::text,null,'removal invalidates the public conversation share');
select lives_ok($$select public.npc_set_mature_preference(false,false)$$,'mature opt-out can be repeated safely');
reset role;
select is((select count(*) from private.world_npc_instances where id=(select instance_id from pg_temp.mature_world)),0::bigint,'mature removal deletes the world resident');
select is((select count(*) from private.world_resident_package_pins where instance_id=(select instance_id from pg_temp.mature_world)),0::bigint,'mature removal cascades the resident package pin with its resident');
select is((select count(*) from private.world_npc_dialogue_turns where id='18100000-3000-4000-8000-000000000001'),0::bigint,'dialogue and memory cascade away with the removed resident');
select is((select count(*) from private.world_npc_memories where instance_id=(select instance_id from pg_temp.mature_world)),0::bigint,'significant dialogue memories are removed with their source exchange');
select is((select count(*) from private.world_npc_quest_events where instance_id=(select instance_id from pg_temp.mature_world)),0::bigint,'quest prose and public news are removed');
select is((select count(*) from private.world_npc_hospitality_events where instance_id=(select instance_id from pg_temp.mature_world)),0::bigint,'hospitality projections are removed');
select is((select transcript from private.npc_reports where world_id=(select save_id from pg_temp.mature_world)),'[]'::jsonb,'report copy retains its record but not NPC narrative');
select ok(exists(select 1 from private.world_npc_tombstones where save_id=(select save_id from pg_temp.mature_world) and npc_id='18181818-1818-4181-8181-181818181818' and reason='mature_purged'),'mature removal leaves an auditable no-reuse tombstone');

-- A moderator quarantine follows the same routine across worlds.
insert into private.npc_identities(id,origin,creator_id,normalized_name,status,rating)
  values('18100000-4000-4000-8000-000000000001','community','18100000-0000-4000-8000-000000000063','removal witness','published','standard');
insert into private.npc_identity_owners(npc_id,user_id)
  values('18100000-4000-4000-8000-000000000001','18100000-0000-4000-8000-000000000063');
insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,created_by)
  select '18100000-4000-4000-8000-000000000002','18100000-4000-4000-8000-000000000001',1,schema_version,sheet,sheet_hash,'published','18100000-0000-4000-8000-000000000063'
  from private.npc_versions where id='18181818-1818-4181-8181-181818181819';
update private.npc_identities set current_published_version_id='18100000-4000-4000-8000-000000000002'
  where id='18100000-4000-4000-8000-000000000001';
insert into private.npc_version_resident_packages(
  npc_id,version_id,source_kind,frozen_sheet_hash,definition_hash,
  personality_schema,initial_profile,appearance_spec,capability_envelope,
  capability_registry_version,capability_option_ids,resolved_options_hash,
  terminal_outcomes,package_hash
)
select
  '18100000-4000-4000-8000-000000000001','18100000-4000-4000-8000-000000000002','community',
  package.frozen_sheet_hash,package.definition_hash,package.personality_schema,
  package.initial_profile,package.appearance_spec,package.capability_envelope,
  package.capability_registry_version,package.capability_option_ids,
  package.resolved_options_hash,package.terminal_outcomes,
  private.npc_resident_package_hash(
    '18100000-4000-4000-8000-000000000001',
    '18100000-4000-4000-8000-000000000002','community',null,
    package.frozen_sheet_hash,package.definition_hash,package.personality_schema,
    package.initial_profile,package.appearance_spec,package.capability_envelope,
    package.capability_registry_version,package.capability_option_ids,
    package.resolved_options_hash,package.terminal_outcomes
  )
from private.npc_version_resident_packages package
where package.version_id='18181818-1818-4181-8181-181818181819';
select * from private.world_materialize_resident_from_version(
  (select save_id from pg_temp.mature_world),
  '18100000-4000-4000-8000-000000000001',
  '18100000-4000-4000-8000-000000000002',1
);
create temporary table pg_temp.quarantine_world as
  select id instance_id from private.world_npc_instances where npc_id='18100000-4000-4000-8000-000000000001';

insert into private.npc_reports(id,reporter_id,world_id,version_id,category,evidence)
  values('18100000-4000-4000-8000-000000000004','18100000-0000-4000-8000-000000000061',(select save_id from pg_temp.mature_world),'18100000-4000-4000-8000-000000000002','coherence','This report exercises dismissal coherence.');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000062';
select throws_ok($$select public.npc_reviewer_resolve_report('18100000-4000-4000-8000-000000000004',false,'The report is dismissed.','No remedy is warranted.','quarantine')$$,'PT400',null,'a dismissed report cannot trigger a quarantine');
reset role;

-- Approved retirement stops future sampling while leaving already-arrived
-- residents and their saved history playable in their existing worlds.
insert into private.npc_retirement_requests(id,npc_id,requested_by,reason)
  values('18100000-4000-4000-8000-000000000003','18100000-4000-4000-8000-000000000001','18100000-0000-4000-8000-000000000063','The prototype needs this author-owned NPC removed.');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000062';
select public.npc_reviewer_retirement('18100000-4000-4000-8000-000000000003',true,'Approved removal for this test.');
reset role;
select is((select status from private.npc_identities where id='18100000-4000-4000-8000-000000000001'),'retired','approved retirement stops future sampling at the identity');
select is((select count(*) from private.world_npc_instances where npc_id='18100000-4000-4000-8000-000000000001'),1::bigint,'retirement leaves already-arrived residents playable and pinned');

-- Quarantine removes that package-backed resident without permitting a direct
-- pin edit, and a later ban records the emergency removal variant.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000062';
select public.npc_admin_quarantine_or_purge('18100000-4000-4000-8000-000000000001',false,'Immediate quarantine test.');
reset role;
select is((select count(*) from private.world_npc_instances where id=(select instance_id from pg_temp.quarantine_world)),0::bigint,'quarantine removes the resident from every visible world projection');
select ok(exists(select 1 from private.world_npc_tombstones where npc_id='18100000-4000-4000-8000-000000000001' and reason='quarantined'),'quarantine preserves the removal reason in a tombstone');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000062';
select public.npc_admin_quarantine_or_purge('18100000-4000-4000-8000-000000000001',true,'Emergency ban removal test.');
reset role;
select is((select status from private.npc_identities where id='18100000-4000-4000-8000-000000000001'),'banned','emergency purge records a banned identity after redaction');
select ok(exists(select 1 from private.world_npc_tombstones where npc_id='18100000-4000-4000-8000-000000000001' and reason='quarantined'),'emergency purge preserves the earlier no-reuse tombstone after promoting the identity to banned');
update private.npc_identity_owners set ended_at=now()
  where npc_id='18100000-4000-4000-8000-000000000001' and user_id='18100000-0000-4000-8000-000000000063';
insert into private.npc_capabilities(user_id,capability)
  values('18100000-0000-4000-8000-000000000063','npc_reviewer');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000063';
select throws_ok($$select public.npc_admin_quarantine_or_purge('18100000-4000-4000-8000-000000000001',true,'A former owner must not remove this NPC.')$$,'PT403',null,'a former owner cannot use the removal RPC even with reviewer capability');
reset role;

select * from finish();
rollback;
