begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,email,role,aud) values
 ('18100000-0000-4000-8000-000000000001','community-author@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000002','community-reviewer@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000003','community-player@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000004','community-other@example.test','authenticated','authenticated');

insert into private.npc_capabilities(user_id,capability) values
 ('18100000-0000-4000-8000-000000000001','npc_author'),
 ('18100000-0000-4000-8000-000000000002','npc_reviewer');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'browser role cannot use private schema');
select ok(not has_table_privilege('authenticated','private.npc_drafts','SELECT'),'browser role cannot select drafts directly');
select ok(exists(select 1 from private.npc_capability_audit where user_id='18100000-0000-4000-8000-000000000001'),'capability changes are audited');

create function pg_temp.valid_sheet(p_name text default 'Community Warden',p_rating text default 'standard') returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion','npc-sheet-v1','rating',p_rating,
    'identity',jsonb_build_object('name',p_name,'title','Road Warden','shortDescription','A patient community warden who keeps travellers safe.','voice','Practical, kind, and concise with a habit of naming concrete risks.'),
    'appearance',jsonb_build_object('physicalAppearance','A weathered traveller with a calm and watchful stance.','attire','A dark wool cloak, sturdy boots, and a polished lantern.','notableFeatures','A copper compass hangs from a braided leather cord.','mood','Quietly attentive when travellers need help.'),
    'personality',jsonb_build_object('values','["safety"]'::jsonb,'likes','["planning"]'::jsonb,'dislikes','["recklessness"]'::jsonb,'boundaries','["protect civilians"]'::jsonb),
    'lore',jsonb_build_object('entities',jsonb_build_array(jsonb_build_object('id','old-road','namespace','millhaven','name','Old Road','description','The wooded trade road east of Millhaven.')),
      'npcReferences','[]'::jsonb,'relationships',jsonb_build_array(jsonb_build_object('subject',jsonb_build_object('kind','entity','entityId','old-road'),'description','Knows the hidden paths.','trustThreshold',0)),
      'facts',jsonb_build_array(jsonb_build_object('id','first-patrol','category','history','text','The warden learned the road while carrying messages.','trustThreshold',20,'entityRefs','["old-road"]'::jsonb,'npcRefs','[]'::jsonb))),
    'skills',jsonb_build_object('scouting',4,'combat',3,'diplomacy',2,'trade',1),
    'campaign',jsonb_build_object('durableGoal','Protect the roads around Millhaven from real and growing threats.',
      'milestones',jsonb_build_array(
        jsonb_build_object('id','scout','title','Scout the road','outcome','Map the danger before travellers reach the dangerous road.','motivation','Preparation protects people from needless and preventable risk.','constraints','["protect travellers"]'::jsonb,'allowedTargets','["old-road"]'::jsonb,'difficulty',2,'successNews','The old road now has a reliable map of its hazards.','nonSuccessNews','The dangerous stretches of road remain unmapped.','retiredTargets','[]'::jsonb,'permanentLoss','null'::jsonb,'startingPlan','[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb),
        jsonb_build_object('id','secure','title','Secure the road','outcome','Secure the road so ordinary people can travel safely again.','motivation','A safe road gives the community a dependable future.','constraints','["work with locals"]'::jsonb,'allowedTargets','["old-road"]'::jsonb,'difficulty',3,'successNews','A local patrol now keeps watch over the old road.','nonSuccessNews','The proposed road patrol could not be established.','retiredTargets','["old-road"]'::jsonb,'permanentLoss','null'::jsonb,'startingPlan','null'::jsonb))))
$$;

set local role authenticated;
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000001';
select public.npc_update_profile('Author One','Writes guests for the local community.',false,false,true);
select throws_ok($$select public.npc_author_create('{"schemaVersion":"npc-sheet-v1","rating":"standard"}'::jsonb)$$,'PT400',null,'server rejects an incomplete sheet');
create temporary table pg_temp.ids as select (public.npc_author_create(pg_temp.valid_sheet()))->>'npcId' as npc_id;
select throws_ok($$select public.npc_author_save((select npc_id::uuid from pg_temp.ids),1,pg_temp.valid_sheet())$$,'PT409',null,'stale draft save is rejected');
select public.npc_author_save((select npc_id::uuid from pg_temp.ids),0,pg_temp.valid_sheet('Community Warden II'));
select public.npc_author_add_scene((select npc_id::uuid from pg_temp.ids),'npc-scenes/test.webp','The road warden beside a lantern.','{"provider":"fixture"}'::jsonb);
create temporary table pg_temp.submitted as select (public.npc_author_submit((select npc_id::uuid from pg_temp.ids),2)->>'versionId')::uuid as version_id;
select throws_ok($$select public.npc_author_save((select npc_id::uuid from pg_temp.ids),2,pg_temp.valid_sheet())$$,'PT409',null,'submitted draft is closed');
select is(jsonb_array_length(public.npc_reviewer_queue()),0,'an owner cannot review their own work');
reset role;
select is((select revision from private.npc_drafts where npc_id=(select npc_id::uuid from pg_temp.ids) and state='submitted'),2::bigint,'optimistic draft revision includes scene selection');
select throws_ok($$update private.npc_versions set sheet='{}'::jsonb where id=(select version_id from pg_temp.submitted)$$,'P0001',null,'submitted version content is immutable');
update private.npc_evaluations set status='completed',result='{"hardBlocks":[],"prohibited":false}' where version_id=(select version_id from pg_temp.submitted);

set local role authenticated;
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000002';
select is(jsonb_array_length(public.npc_reviewer_queue()),1,'an unrelated reviewer receives submitted work');
select public.npc_reviewer_decide((select version_id from pg_temp.submitted),'approve','Meets the reviewed pilot criteria.','standard');
select public.npc_reviewer_publish((select version_id from pg_temp.submitted));
reset role;
select is((select state from private.npc_versions where id=(select version_id from pg_temp.submitted)),'published','approved version is published');
select is((select current_published_version_id from private.npc_identities where id=(select npc_id::uuid from pg_temp.ids)),(select version_id from pg_temp.submitted),'identity pins the immutable published version');

set local role authenticated;
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000003';
select public.create_tavern();
select throws_ok($$select public.npc_set_mature_preference(true,false)$$,'PT422',null,'mature preference requires adult attestation');
reset role;
create temporary table pg_temp.save_id as select id from public.tavern_saves where user_id='18100000-0000-4000-8000-000000000003';
grant select on pg_temp.save_id to authenticated;
create temporary table pg_temp.dismiss_id as
  select id from private.world_npc_instances where save_id=(select id from pg_temp.save_id) order by npc_id limit 1;
grant select on pg_temp.dismiss_id to authenticated;
select is((select count(*) from private.world_npc_instances where save_id=(select id from pg_temp.save_id)),2::bigint,'new tavern gets exactly two first-party residents');
select is((select count(*) from private.world_npc_instances where save_id=(select id from pg_temp.save_id) and npc_id in ('18181818-1818-4181-8181-181818181818','28282828-2828-4282-8282-282828282828')),2::bigint,'first-party UUID identities are deterministic');

set local role authenticated;
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000003';
select throws_ok(format('select public.npc_report(%L::uuid,%L,%L)',(select version_id from pg_temp.submitted),'content','Never encountered.'),'PT404',null,'a player cannot report a version absent from their world');
select public.npc_dismiss((select id from pg_temp.dismiss_id));
reset role;
select is((select count(*) from private.world_npc_tombstones where save_id=(select id from pg_temp.save_id) and reason='dismissed'),1::bigint,'dismissal creates a no-reuse tombstone');

insert into private.world_npc_instances(save_id,npc_id,version_id,arrived_day)
values((select id from pg_temp.save_id),(select npc_id::uuid from pg_temp.ids),(select version_id from pg_temp.submitted),1);
create temporary table pg_temp.community_instance as
  select id from private.world_npc_instances
  where save_id=(select id from pg_temp.save_id) and npc_id=(select npc_id::uuid from pg_temp.ids);
grant select on pg_temp.community_instance to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000003';
create temporary table pg_temp.share_preview as select public.npc_share_preview((select id from pg_temp.community_instance)) value;
grant select on pg_temp.share_preview to authenticated;
select public.npc_share_conversation((select id from pg_temp.community_instance),(select value->>'contentHash' from pg_temp.share_preview),false);
reset role;
select throws_ok($$update private.npc_conversation_shares set transcript='[]'::jsonb$$,'P0001',null,'conversation share is immutable');

insert into public.tavern_saves(id,user_id) values
 ('18181818-5555-4555-8555-555555555555','18100000-0000-4000-8000-000000000001'),
 ('18181818-6666-4666-8666-666666666666','18100000-0000-4000-8000-000000000002');
insert into private.npc_reports(reporter_id,world_id,version_id,category,evidence) values
 ('18100000-0000-4000-8000-000000000001','18181818-5555-4555-8555-555555555555',(select version_id from pg_temp.submitted),'content','One.'),
 ('18100000-0000-4000-8000-000000000002','18181818-6666-4666-8666-666666666666',(select version_id from pg_temp.submitted),'content','Two.'),
 ('18100000-0000-4000-8000-000000000003',(select id from pg_temp.save_id),(select version_id from pg_temp.submitted),'content','Three.');
select is((select status from private.npc_identities where id=(select npc_id::uuid from pg_temp.ids)),'paused','three distinct-world reports pause future sampling');

update private.npc_identity_owners set ended_at=now() where npc_id=(select npc_id::uuid from pg_temp.ids) and user_id='18100000-0000-4000-8000-000000000001';
insert into private.npc_identity_owners(npc_id,user_id) values((select npc_id::uuid from pg_temp.ids),'18100000-0000-4000-8000-000000000004');
insert into private.npc_capabilities(user_id,capability) values('18100000-0000-4000-8000-000000000001','npc_reviewer') on conflict do nothing;
set local role authenticated;
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000001';
select throws_ok(format('select public.npc_reviewer_comment(%L::uuid,%L::uuid,%L,%L)',(select npc_id from pg_temp.ids),(select version_id from pg_temp.submitted),'identity','Former owners cannot moderate.'),'PT403',null,'former owners cannot review or moderate an identity');
reset role;

select * from finish();
rollback;
