begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values('16700000-0000-4000-8000-000000000001','garden-recovery@example.test',
  'authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'recovery garden provisions');

reset role;
delete from public.garden_plants;
update public.garden_cells c set kind=case when exists(select 1 from public.apiary_hives h
    where h.save_id=c.save_id and h.cell_id=c.id) then 'beehive' else 'empty' end,
  plant_key=null,growth_stage=null,water=null,health=null,
  soil_n=0,soil_p=0,soil_k=0,soil_moisture=50,soil_quality=0
where unlocked;
update public.tavern_saves set gold=0,revision=0,day_minigame_completed=false,daily_craft_kind=null;
set constraints all immediate;
set constraints all deferred;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select is((select count(*) from public.garden_plants),0::bigint,'fixture begins after total crop loss');
select is((select gold from public.tavern_saves),0::bigint,'fixture has zero gold');

select lives_ok($recovery$
  do $body$
  declare v_save uuid; v_cell uuid; v_revision bigint; cycle_index integer; day_index integer;
  begin
    select id,revision into v_save,v_revision from public.tavern_saves;
    select id into v_cell from public.garden_cells where layout_key='c0';

    perform public.garden_command(v_save,extensions.gen_random_uuid(),v_revision,'plant',
      jsonb_build_object('cellId',v_cell,'seedItemKey','seed_clover'));
    select revision into v_revision from public.tavern_saves;
    perform public.garden_command(v_save,extensions.gen_random_uuid(),v_revision,'water',
      jsonb_build_object('cellIds',jsonb_build_array(v_cell),'dose',10));
    for day_index in 1..4 loop
      select revision into v_revision from public.tavern_saves;
      perform public.advance_tavern_day(v_save,extensions.gen_random_uuid(),v_revision);
    end loop;
    select revision into v_revision from public.tavern_saves;
    perform public.garden_command(v_save,extensions.gen_random_uuid(),v_revision,'incorporate_clover',
      jsonb_build_object('cellId',v_cell));

    for cycle_index in 1..2 loop
      select revision into v_revision from public.tavern_saves;
      perform public.garden_command(v_save,extensions.gen_random_uuid(),v_revision,'plant',
        jsonb_build_object('cellId',v_cell,'seedItemKey','seed_clover'));
      for day_index in 1..4 loop
        select revision into v_revision from public.tavern_saves;
        perform public.advance_tavern_day(v_save,extensions.gen_random_uuid(),v_revision);
      end loop;
      select revision into v_revision from public.tavern_saves;
      perform public.garden_command(v_save,extensions.gen_random_uuid(),v_revision,'incorporate_clover',
        jsonb_build_object('cellId',v_cell));
    end loop;

    select revision into v_revision from public.tavern_saves;
    perform public.garden_command(v_save,extensions.gen_random_uuid(),v_revision,'plant',
      jsonb_build_object('cellId',v_cell,'seedItemKey','seed_hops'));
    for day_index in 1..10 loop
      exit when exists(select 1 from public.garden_plants where cell_id=v_cell and lifecycle='mature');
      select revision into v_revision from public.tavern_saves;
      perform public.advance_tavern_day(v_save,extensions.gen_random_uuid(),v_revision);
    end loop;
    if not exists(select 1 from public.garden_plants where cell_id=v_cell and lifecycle='mature') then
      raise exception 'Recovery crop did not mature in the bounded route';
    end if;
    select revision into v_revision from public.tavern_saves;
    perform public.harvest_crop(v_save,v_cell,extensions.gen_random_uuid(),v_revision);
  end
  $body$
$recovery$,'free seeds, water, and three green-manure cycles recover a harvest');

select ok((select count(*) from public.ingredient_batches where plant_key='hops'
  and quantity>consumed_quantity+composted_quantity)>0,'recovery produces a useful crafting ingredient');
select ok((select count(*) from public.garden_daily_grants)>=10,'daily renewable grants sustain the finite route');
select ok((select soil_n>=38 and soil_p>=34 and soil_k>=42 from public.garden_cells where layout_key='c0'),
  'slow local restoration returns the recovery hex to useful fertility');

select lives_ok($$ select public.start_brew(
  (select id from public.tavern_saves),(select id from public.ingredient_batches where plant_key='hops' limit 1),
  '16700000-0000-4000-8000-000000000010',(select revision from public.tavern_saves)) $$,
  'recovered ingredient enters the existing Brewery flow');
reset role;
update public.brew_sessions set started_at=clock_timestamp()-interval '30 seconds' where status='active';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16700000-0000-4000-8000-000000000001';
select lives_ok($$ select public.complete_brew(
  (select id from public.tavern_saves),(select id from public.brew_sessions where status='active'),
  '16700000-0000-4000-8000-000000000011',(select revision from public.tavern_saves),60,0,60) $$,
  'recovered ingredient completes a normal guided brew');
select is((select count(*) from public.beverages),1::bigint,'recovery creates one sellable beverage');
select lives_ok($$ select public.serve_beverage(
  (select id from public.tavern_saves),'lira',(select id from public.beverages),null,
  '16700000-0000-4000-8000-000000000012',(select revision from public.tavern_saves)) $$,
  'the recovered beverage completes the existing tavern sale');
select ok((select gold from public.tavern_saves)>0,'the zero-gold recovery route returns to positive tavern income');

select * from finish();
rollback;
