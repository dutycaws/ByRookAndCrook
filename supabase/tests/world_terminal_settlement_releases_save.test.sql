begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users(id,email,role,aud)
values
  ('74900000-0000-4000-8000-000000000001','terminal-matrix@example.test','authenticated','authenticated'),
  ('74900000-0000-4000-8000-000000000002','terminal-failure@example.test','authenticated','authenticated'),
  ('74900000-0000-4000-8000-000000000003','terminal-skipped@example.test','authenticated','authenticated'),
  ('74900000-0000-4000-8000-000000000004','terminal-expired@example.test','authenticated','authenticated');

-- Every explicit terminal settlement status releases an otherwise idle save.
insert into public.tavern_saves(id,user_id,current_day,revision) values
  ('74900000-0000-4000-8000-000000000011','74900000-0000-4000-8000-000000000001',1,0),
  ('74900000-0000-4000-8000-000000000012','74900000-0000-4000-8000-000000000003',1,0),
  ('74900000-0000-4000-8000-000000000013','74900000-0000-4000-8000-000000000004',1,0);
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status) values
  ('74900000-0000-4000-8000-000000000021','74900000-0000-4000-8000-000000000011',1,0,'terminal-completed','queued'),
  ('74900000-0000-4000-8000-000000000022','74900000-0000-4000-8000-000000000012',1,0,'terminal-skipped','queued'),
  ('74900000-0000-4000-8000-000000000023','74900000-0000-4000-8000-000000000013',1,0,'terminal-expired','queued');
update public.tavern_saves set world_phase='settling'
where id in ('74900000-0000-4000-8000-000000000011','74900000-0000-4000-8000-000000000012','74900000-0000-4000-8000-000000000013');
update private.world_settlements set status='completed' where id='74900000-0000-4000-8000-000000000021';
update private.world_settlements set status='skipped' where id='74900000-0000-4000-8000-000000000022';
update private.world_settlements set status='expired' where id='74900000-0000-4000-8000-000000000023';
select is((select world_phase from public.tavern_saves where id='74900000-0000-4000-8000-000000000011'),'open','completed settlement reopens an idle save');
select is((select world_phase from public.tavern_saves where id='74900000-0000-4000-8000-000000000012'),'open','skipped settlement reopens an idle save');
select is((select world_phase from public.tavern_saves where id='74900000-0000-4000-8000-000000000013'),'open','expired settlement reopens an idle save');

-- Exercise the exhausted malformed-retry path against a real Garden move. The
-- queued settlement rejects the move; its terminal failure defers the due
-- transition, reopens the save, and allows the same mutation afterward.
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='74900000-0000-4000-8000-000000000002';
select lives_ok($$select public.create_tavern()$$,'failure-path fixture creates a playable save');
create temporary table pg_temp.garden_context as
select id as save_id from public.tavern_saves where user_id='74900000-0000-4000-8000-000000000002';
select lives_ok($$select public.garden_command(
  (select save_id from pg_temp.garden_context),'74900000-0000-4000-8000-000000000030',0,'plant',
  jsonb_build_object('cellId',(select id from public.garden_cells where save_id=(select save_id from pg_temp.garden_context) and layout_key='c3'),'seedItemKey','seed_hops'))$$,
  'fixture plant gives the move a valid source');
create temporary table pg_temp.garden_plant_context as
select plant.id
from public.garden_plants plant
join public.garden_cells cell on cell.id=plant.cell_id
where plant.save_id=(select save_id from pg_temp.garden_context)
  and plant.species_key='hops'
  and cell.layout_key='c3';

update public.tavern_saves set current_day=4
where id=(select save_id from pg_temp.garden_context);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.resident as
select * from private.world_materialize_resident_from_version(
  (select save_id from pg_temp.garden_context),
  '18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',4
);
create temporary table pg_temp.prepared as
select * from private.world_resolve_quest_step(
  (select id from private.world_quests
   where save_id=(select save_id from pg_temp.garden_context)
     and instance_id=(select instance_id from pg_temp.resident)),4,0
);
create temporary table pg_temp.terminal_event as
select * from private.world_resolve_quest_step((select quest_id from pg_temp.prepared),5,0);
update public.tavern_saves set current_day=6
where id=(select save_id from pg_temp.garden_context);
create temporary table pg_temp.enqueued as
select public.world_settlement_enqueue(
  (select save_id from pg_temp.garden_context),'74900000-0000-4000-8000-000000000031',
  (select revision from public.tavern_saves where id=(select save_id from pg_temp.garden_context)),
  '{"fixture":"terminal-failure"}'::jsonb,'terminal-failure-v1'
) as value;

set local request.jwt.claim.role='authenticated';
select throws_ok($$select public.garden_command(
  (select save_id from pg_temp.garden_context),'74900000-0000-4000-8000-000000000032',
  (select revision from public.tavern_saves where id=(select save_id from pg_temp.garden_context)),'move',
  jsonb_build_object(
    'sourceCellId',(select id from public.garden_cells where save_id=(select save_id from pg_temp.garden_context) and layout_key='c3'),
    'targetCellId',(select id from public.garden_cells where save_id=(select save_id from pg_temp.garden_context) and layout_key='c5')
  ))$$,'PT409','World settlement is active','queued settlement continues to block player Garden mutations');
select is((select world_phase from public.tavern_saves where id=(select save_id from pg_temp.garden_context)),'settling','queued settlement keeps the save frozen');

set local request.jwt.claim.role='service_role';
do $$
declare
  settlement_id uuid;
  claim jsonb;
  attempt smallint;
begin
  select (value->>'settlementId')::uuid into settlement_id from pg_temp.enqueued;
  for attempt in 1..3 loop
    claim:=public.world_settlement_claim(settlement_id);
    perform public.world_settlement_fail(
      (claim->>'settlementId')::uuid,(claim->>'jobId')::uuid,(claim->>'fence')::uuid,'MALFORMED_TEST'
    );
  end loop;
end;
$$;
select is((select status from private.world_settlements where id=(select (value->>'settlementId')::uuid from pg_temp.enqueued)),'failed','third malformed attempt terminalizes the settlement');
select is((select world_phase from public.tavern_saves where id=(select save_id from pg_temp.garden_context)),'open','terminal failure defers due transition work and reopens the save');
select is((select status from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.terminal_event)),'awaiting','failed settlement preserves the transition for a later opening');
select is((select next_eligible_day from private.world_quest_transitions where terminal_event_id=(select id from pg_temp.terminal_event)),7,'failed settlement advances the transition to the next opening');

set local request.jwt.claim.role='authenticated';
select lives_ok($$select public.garden_command(
  (select save_id from pg_temp.garden_context),'74900000-0000-4000-8000-000000000033',
  (select revision from public.tavern_saves where id=(select save_id from pg_temp.garden_context)),'move',
  jsonb_build_object(
    'sourceCellId',(select id from public.garden_cells where save_id=(select save_id from pg_temp.garden_context) and layout_key='c3'),
    'targetCellId',(select id from public.garden_cells where save_id=(select save_id from pg_temp.garden_context) and layout_key='c5')
  ))$$,'Garden move succeeds after the settlement reaches a terminal failure');
select is((select cell.layout_key from public.garden_plants plant join public.garden_cells cell on cell.id=plant.cell_id
  where plant.id=(select id from pg_temp.garden_plant_context)),'c5','terminal settlement no longer leaves the Garden mutation guard stuck');

select * from finish();
rollback;
