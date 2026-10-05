begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users(id,email,role,aud,created_at,updated_at) values
('35000000-0000-4000-8000-000000000001','prototype-projections@example.test','authenticated','authenticated',now(),now()),
('35000000-0000-4000-8000-000000000002','prototype-outsider@example.test','authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='35000000-0000-4000-8000-000000000001';
select lives_ok($$select public.create_tavern()$$,'new save provisions with all prototype projections');
create temporary table initial_projection as select public.get_tavern_snapshot() garden, public.npc_bar_snapshot() bar;
select is((select garden#>'{trinkets,collection}' from initial_projection),'[]'::jsonb,'new save has an empty earned collection');
select is((select bar->'trinkets' from initial_projection),(select garden->'trinkets' from initial_projection),'bar and garden share the authoritative collection');
select ok((select bool_and(jsonb_array_length(item->'guidance')>0)
  from initial_projection,jsonb_array_elements(garden#>'{garden,inventory}') item
  where item->>'kind'='seed'),'owned seeds carry guidance before planting');
select ok((select bool_and(cell ? 'observations' and jsonb_typeof(cell->'observations')='array'
  and cell ? 'careHistory' and jsonb_typeof(cell->'careHistory')='array')
  from initial_projection,jsonb_array_elements(garden->'cells') cell),'every plot includes qualitative observation and history projections');
select ok((select bool_and(resident->>'relationshipStage'='acquaintance')
  from initial_projection,jsonb_array_elements(bar->'roster') resident),'initial residents are acquaintances');
select is((select jsonb_agg(resident->>'relationshipStage' order by resident->>'instanceId')
  from jsonb_array_elements(public.npc_roster()) resident),
  (select jsonb_agg(resident->>'relationshipStage' order by resident->>'instanceId')
  from initial_projection,jsonb_array_elements(bar->'roster') resident),'paged roster and bar stages agree');
select is((public.get_tavern_snapshot()#>>'{save,revision}')::bigint,
  (select (garden#>>'{save,revision}')::bigint from initial_projection),'free inspection does not spend a revision');
select is((public.get_tavern_snapshot()#>>'{save,currentDay}')::integer,
  (select (garden#>>'{save,currentDay}')::integer from initial_projection),'free inspection does not advance the day');

set local request.jwt.claim.sub='35000000-0000-4000-8000-000000000002';
select is(public.get_tavern_snapshot(),null::jsonb,'outsider cannot read another save garden or trinkets');
select is(public.npc_bar_snapshot(),null::jsonb,'outsider cannot read another save bar or trinkets');
select is(public.npc_roster(),'[]'::jsonb,'outsider cannot read another save relationships');
select is(public.npc_resident((select (bar#>>'{roster,0,instanceId}')::uuid from initial_projection)),
  null::jsonb,'selected resident projection retains owner checks');
select * from finish();
rollback;
