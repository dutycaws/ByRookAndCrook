begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users(id,email,role,aud)
values('73000000-0000-4000-8000-000000000001','quest-memory-scope@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision)
values('73000000-0000-4000-8000-000000000011','73000000-0000-4000-8000-000000000001',4,0);
set local request.jwt.claim.role='service_role';

create temporary table pg_temp.resident as
select * from private.world_materialize_resident_from_version(
  '73000000-0000-4000-8000-000000000011',
  '18181818-1818-4181-8181-181818181818',
  '18181818-1818-4181-8181-181818181819',1
);
create temporary table pg_temp.prepared as
select * from private.world_resolve_quest_step(
  (select id from private.world_quests where save_id='73000000-0000-4000-8000-000000000011'),4,0
);
create temporary table pg_temp.terminal as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.prepared),5,0);
update public.tavern_saves set current_day=6,world_phase='settling'
where id='73000000-0000-4000-8000-000000000011';
create temporary table pg_temp.claimed as
select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;

select is(
  (select provolatile from pg_proc where oid='public.world_quest_transition_memory_scope(uuid,uuid)'::regprocedure),
  'v',
  'memory-scope RPC is volatile because its fence check locks the transition'
);
select is(
  (select public.world_quest_transition_memory_scope(
    (result->>'transitionId')::uuid,(result->>'fence')::uuid
  )->>'instanceId' from pg_temp.claimed),
  (select instance_id::text from pg_temp.resident),
  'service-role caller can read memory scope under a valid transition fence'
);

select * from finish();
rollback;
