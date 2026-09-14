begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users(id,email,role,aud) values
  ('18100000-0000-4000-8000-000000000011','runtime-one@example.test','authenticated','authenticated'),
  ('18100000-0000-4000-8000-000000000012','runtime-two@example.test','authenticated','authenticated');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000011';
select public.create_tavern();
create temporary table pg_temp.runtime_state as
select
  (snapshot#>>'{save,id}')::uuid save_id,
  (snapshot#>>'{roster,0,instanceId}')::uuid instance_id,
  (snapshot#>>'{roster,0,npcId}')::uuid npc_id,
  (snapshot#>>'{roster,0,versionId}')::uuid version_id
from (select public.npc_bar_snapshot() snapshot) source;
select is(jsonb_array_length(public.npc_bar_snapshot()->'roster'),2,'new tavern Bar snapshot exposes both UUID residents');
select throws_ok(
  $$select public.npc_dialogue_begin('18100000-0000-4000-8000-000000000011','18100000-1000-4000-8000-000000000001','18181818-1818-4181-8181-181818181818','Hello',0)$$,
  '42501',null,'authenticated clients cannot begin server-orchestrated dialogue');
reset role;

set local request.jwt.claim.role='service_role';
create temporary table pg_temp.cancelled_begin as
  select public.npc_dialogue_begin(
    '18100000-0000-4000-8000-000000000011',
    '18100000-1000-4000-8000-000000000002',
    (select npc_id from pg_temp.runtime_state),'I may return to this thought.',0
  ) value;
select is((select value->>'status' from pg_temp.cancelled_begin),'processing','service orchestrator begins a UUID resident turn');
reset request.jwt.claim.role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000011';
select is(public.npc_dialogue_status('18100000-1000-4000-8000-000000000002',true)->>'status','cancelled','player can cancel an unfinished turn');
reset role;

set local request.jwt.claim.role='service_role';
create temporary table pg_temp.active_begin as
  select public.npc_dialogue_begin(
    '18100000-0000-4000-8000-000000000011',
    '18100000-1000-4000-8000-000000000003',
    (select npc_id from pg_temp.runtime_state),'How is the road?',0
  ) value;
select is((select value->>'input_sequence' from pg_temp.active_begin),'0','a cancelled sequence can be superseded safely');
select public.npc_dialogue_checkpoint(
  '18100000-0000-4000-8000-000000000011','18100000-1000-4000-8000-000000000003',
  (select (value->>'fence')::uuid from pg_temp.active_begin),'decision',
  '{"value":{"stance":"respond","reaction":0,"subject":"quest","evidence":"","intention":null},"validated":true}'::jsonb
);
select public.npc_dialogue_checkpoint(
  '18100000-0000-4000-8000-000000000011','18100000-1000-4000-8000-000000000003',
  (select (value->>'fence')::uuid from pg_temp.active_begin),'speak',
  '{"value":{"text":"The old road is quiet today, though I am still watching it closely."},"model":"fixture"}'::jsonb
);
create temporary table pg_temp.completed as
  select public.npc_dialogue_complete(
    '18100000-0000-4000-8000-000000000011','18100000-1000-4000-8000-000000000003',
    (select (value->>'fence')::uuid from pg_temp.active_begin)
  ) value;
select is((select value->>'reply' from pg_temp.completed),'The old road is quiet today, though I am still watching it closely.','validated UUID dialogue commits its approved speech');
select is((select conversation_sequence from private.world_npc_instances where id=(select instance_id from pg_temp.runtime_state)),1::bigint,'dialogue advances only the selected resident sequence');
select is((public.npc_dialogue_complete(
  '18100000-0000-4000-8000-000000000011','18100000-1000-4000-8000-000000000003',
  (select (value->>'fence')::uuid from pg_temp.active_begin)
)->>'turnId'),'18100000-1000-4000-8000-000000000003','completion retry returns the saved result');

create temporary table pg_temp.expired_begin as
  select public.npc_dialogue_begin(
    '18100000-0000-4000-8000-000000000011',
    '18100000-1000-4000-8000-000000000004',
    (select npc_id from pg_temp.runtime_state),'An expired message',1
  ) value;
update private.world_npc_dialogue_turns set lease_until=now()-interval '1 second'
where id='18100000-1000-4000-8000-000000000004';
create temporary table pg_temp.recovered_begin as
  select public.npc_dialogue_begin(
    '18100000-0000-4000-8000-000000000011',
    '18100000-1000-4000-8000-000000000005',
    (select npc_id from pg_temp.runtime_state),'A fresh message',1
  ) value;
select is((select status from private.world_npc_dialogue_turns where id='18100000-1000-4000-8000-000000000004'),'failed','an expired lease is fenced off before a fresh turn');
select is((select value->>'status' from pg_temp.recovered_begin),'processing','expired work does not block the next turn');
reset request.jwt.claim.role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000011';
select public.npc_dialogue_status('18100000-1000-4000-8000-000000000005',true);
select is((public.npc_journals(array[(select instance_id from pg_temp.runtime_state)])#>>(array[(select instance_id::text from pg_temp.runtime_state),'sequence']))::integer,1,'batched journal exposes the resident conversation sequence');
select is(jsonb_array_length(public.npc_journals(array[(select instance_id from pg_temp.runtime_state)])#>array[(select instance_id::text from pg_temp.runtime_state),'turns']),1,'batched journal includes the completed visible transcript');
reset role;

create temporary table pg_temp.food_id(id uuid);
with inserted as (
  insert into public.foods(save_id,name,quality_index,source_action_id,day_number,recipe_key,rules_version)
  values((select save_id from pg_temp.runtime_state),'Golden hearth loaf',5,'18100000-2000-4000-8000-000000000001',1,'hearth-loaf','runtime-test-v1')
  returning id
)
insert into pg_temp.food_id select id from inserted;
grant select on pg_temp.food_id to authenticated;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000011';
create temporary table pg_temp.served as
select public.npc_serve_hospitality(
  (select save_id from pg_temp.runtime_state),(select instance_id from pg_temp.runtime_state),'food',(select id from pg_temp.food_id),
  '18100000-2000-4000-8000-000000000002',0
) value;
select is((select (value->>'goldEarned')::integer from pg_temp.served),25,'generic hospitality uses the conservative quality price curve');
select is((public.npc_serve_hospitality(
  (select save_id from pg_temp.runtime_state),(select instance_id from pg_temp.runtime_state),'food',(select id from pg_temp.food_id),
  '18100000-2000-4000-8000-000000000002',0
)->>'actionId'),'18100000-2000-4000-8000-000000000002','hospitality retry returns the exact receipt');
select is(jsonb_array_length(public.npc_bar_snapshot()#>'{offerings,foods}'),0,'served food is removed from the UUID Bar inventory');
select is(jsonb_array_length(public.npc_bar_snapshot()#>'{recent,hospitality}'),1,'UUID hospitality appears in recent Bar history');
select throws_ok(format(
  'select public.npc_serve_hospitality(%L::uuid,%L::uuid,%L,%L::uuid,%L::uuid,%s)',
  (select save_id from pg_temp.runtime_state),(select instance_id from pg_temp.runtime_state),'food',(select id from pg_temp.food_id),
  '18100000-2000-4000-8000-000000000003',0
),'PT409',null,'stale hospitality revision is rejected');
select is(jsonb_array_length(public.npc_share_preview((select instance_id from pg_temp.runtime_state))->'transcript'),1,'share preview includes the complete visible dialogue transcript');
select lives_ok(format('select public.npc_report(%L::uuid,%L,%L)',(select version_id from pg_temp.runtime_state),'content','The visible reply needs review.'),'reports freeze the encountered UUID version and transcript');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000012';
select public.create_tavern();
select throws_ok(format('select public.npc_dialogue_status(%L::uuid,false)','18100000-1000-4000-8000-000000000003'),'PT404',null,'another player cannot read a turn status');
select throws_ok(format(
  'select public.npc_serve_hospitality(%L::uuid,%L::uuid,%L,%L::uuid,%L::uuid,%s)',
  (select save_id from pg_temp.runtime_state),(select instance_id from pg_temp.runtime_state),'food',(select id from pg_temp.food_id),
  '18100000-2000-4000-8000-000000000004',1
),'PT404',null,'another player cannot serve into a different world');
reset role;

select * from finish();
rollback;
