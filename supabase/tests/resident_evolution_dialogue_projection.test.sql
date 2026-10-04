begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,role,aud) values
 ('17600000-0000-4000-8000-000000000001','projection-owner@example.test','authenticated','authenticated'),
 ('17600000-0000-4000-8000-000000000002','projection-other@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='17600000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.owner_world as
 select (snapshot#>>'{save,id}')::uuid save_id,
        (snapshot->'roster'->0->>'instanceId')::uuid instance_id,
        (snapshot->'roster'->0->>'npcId')::uuid npc_id,
        (snapshot->'roster'->0->>'versionId')::uuid version_id,
        (snapshot#>>'{save,revision}')::bigint revision
 from (select public.npc_bar_snapshot() snapshot) q;
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='17600000-0000-4000-8000-000000000002';
select public.create_tavern();
create temporary table pg_temp.other_world as select (snapshot#>>'{save,id}')::uuid save_id from (select public.npc_bar_snapshot() snapshot) q;
reset role;

-- Cognition is save-bound and beliefs remain separate from canonical/base facts.
insert into private.world_resident_beliefs(instance_id,fingerprint,statement,confidence,provenance,subject_key,provenance_chain)
select instance_id,'projection-belief','The bridge may be unsafe.',70,'dialogue','bridge','[{"sourceKind":"dialogue","sourceId":"fixture"}]'::jsonb from pg_temp.owner_world;
insert into private.world_social_edges(save_id,from_instance_id,to_instance_id,trust)
select owner.save_id,owner.instance_id,peer.id,12 from pg_temp.owner_world owner
join private.world_npc_instances peer on peer.save_id=owner.save_id and peer.id<>owner.instance_id limit 1;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until,result)
select '17600000-0000-4000-8000-000000000010',save_id,instance_id,npc_id,version_id,'17600000-0000-4000-8000-000000000001','What do you know?',0,revision,1,'completed',clock_timestamp()-interval '1 second','{"reply":"I am not certain."}'::jsonb from pg_temp.owner_world;

set local role service_role;
set local request.jwt.claim.role='service_role';
select ok((public.npc_dialogue_context('17600000-0000-4000-8000-000000000001','17600000-0000-4000-8000-000000000010','base') ? 'profileRevision') and not (public.npc_dialogue_context('17600000-0000-4000-8000-000000000001','17600000-0000-4000-8000-000000000010','base') ? 'beliefs'),'base context has a profile revision and never mixes beliefs into canon');
select is((public.npc_dialogue_context('17600000-0000-4000-8000-000000000001','17600000-0000-4000-8000-000000000010','beliefs')->0->>'statement'),'The bridge may be unsafe.','beliefs are bounded and attributed separately');
select throws_ok($$select public.npc_dialogue_context('17600000-0000-4000-8000-000000000002','17600000-0000-4000-8000-000000000010','base')$$,'PT404',null,'context refuses a different actor');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='17600000-0000-4000-8000-000000000001';
select ok((public.npc_journals(array[(select instance_id from pg_temp.owner_world)]) ? (select instance_id::text from pg_temp.owner_world)),'owner journal projects the resident');
set local request.jwt.claim.sub='17600000-0000-4000-8000-000000000002';
select is(public.npc_journals(array[(select instance_id from pg_temp.owner_world)]),'{}'::jsonb,'other save receives no owner journal');
reset role;

-- An active unexpired dialogue blocks fresh closing; an expired one does not.
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until)
select '17600000-0000-4000-8000-000000000011',save_id,instance_id,npc_id,version_id,'17600000-0000-4000-8000-000000000001','Still speaking.',1,revision,1,'processing',clock_timestamp()+interval '5 minutes' from pg_temp.owner_world;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='17600000-0000-4000-8000-000000000001';
select throws_ok(format('select public.advance_tavern_day(%L,%L,%s)',(select save_id from pg_temp.owner_world),'17600000-0000-4000-8000-000000000020',(select revision from pg_temp.owner_world)),'PT409',null,'active unexpired dialogue blocks day close');
reset role;
update private.world_npc_dialogue_turns set lease_until=clock_timestamp()-interval '1 second' where id='17600000-0000-4000-8000-000000000011';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='17600000-0000-4000-8000-000000000001';
select lives_ok(format('select public.advance_tavern_day(%L,%L,%s)',(select save_id from pg_temp.owner_world),'17600000-0000-4000-8000-000000000021',(select revision from pg_temp.owner_world)),'expired dialogue does not block day close');
reset role;

select * from finish();
rollback;
