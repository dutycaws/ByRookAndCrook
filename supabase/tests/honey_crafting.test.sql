begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values('16900000-0000-4000-8000-000000000001','honey-crafting@example.test',
  'authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16900000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'honey crafting tavern provisions');

reset role;
update public.apiary_colonies set floral_honey=10,health=90,varroa_pressure=4,
  chalkbrood_pressure=2,nosema_pressure=2;
create temporary table honey_ids(key text primary key,value uuid not null);
grant select,insert on honey_ids to authenticated;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16900000-0000-4000-8000-000000000001';
select lives_ok($$ select public.apiary_command(
  (select id from public.tavern_saves),'16900000-0000-4000-8000-000000000010',0,'extract_honey',
  jsonb_build_object('colonyId',(select id from public.apiary_colonies),'quantity',2)) $$,
  'two units of safe surplus honey are extracted');
insert into honey_ids values('batch',(select id from public.ingredient_batches where source_kind='honey'));
select is((select jsonb_build_object('plant',plant_key,'quantity',quantity,'brew',brew_bonus,'bake',bake_bonus)
  from public.ingredient_batches where id=(select value from honey_ids where key='batch')),
  jsonb_build_object('plant','honey','quantity',2,'brew',4,'bake',4),
  'honey uses the existing bounded ingredient quality bonuses');

select lives_ok($$ select public.start_brew(
  (select id from public.tavern_saves),(select value from honey_ids where key='batch'),
  '16900000-0000-4000-8000-000000000011',1) $$,
  'honey is selectable through the normal optional brewing input');
insert into honey_ids values('brew',(select id from public.brew_sessions));
select is(public.get_tavern_snapshot()#>>'{brewery,activeSession,plantKey}','honey',
  'the active Brewery contract exposes honey');
reset role;
update public.brew_sessions set started_at=clock_timestamp()-interval '18 seconds';
set local role authenticated;
select lives_ok($$ select public.complete_brew(
  (select id from public.tavern_saves),(select value from honey_ids where key='brew'),
  '16900000-0000-4000-8000-000000000012',2,60,0,60) $$,
  'the honey brew completes through guided stirring');
select is((select ingredient_batch_id from public.beverages),(select value from honey_ids where key='batch'),
  'the beverage keeps honey ingredient provenance');
select is((select consumed_quantity from public.ingredient_batches where id=(select value from honey_ids where key='batch')),
  1,'brewing consumes exactly one honey unit');

select lives_ok($$ select public.start_bake(
  (select id from public.tavern_saves),(select value from honey_ids where key='batch'),
  '16900000-0000-4000-8000-000000000013',3) $$,
  'remaining honey is selectable through the normal optional baking input on the same day');
insert into honey_ids values('bake',(select id from public.bake_sessions));
select is(public.get_tavern_snapshot()#>>'{bakery,activeSession,plantKey}','honey',
  'the active Bakery contract exposes honey');
select lives_ok($$
  do $prepare$
  declare v_revision bigint:=4; v_session uuid:=(select value from honey_ids where key='bake');
  begin
    for i in 1..6 loop
      perform public.fold_bake((select id from public.tavern_saves),v_session,
        extensions.gen_random_uuid(),v_revision,70);
      v_revision:=v_revision+1;
    end loop;
    for i in 1..3 loop
      perform public.score_bake((select id from public.tavern_saves),v_session,
        extensions.gen_random_uuid(),v_revision,70);
      v_revision:=v_revision+1;
    end loop;
  end $prepare$;
$$,'honey loaf preparation uses the unchanged Bakery commands');
select lives_ok($$ select public.begin_bake_oven(
  (select id from public.tavern_saves),(select value from honey_ids where key='bake'),
  '16900000-0000-4000-8000-000000000014',13) $$,
  'prepared honey loaf enters the oven');
reset role;
update public.bake_sessions set oven_started_at=clock_timestamp()-interval '30 seconds';
set local role authenticated;
select lives_ok($$ select public.complete_bake(
  (select id from public.tavern_saves),(select value from honey_ids where key='bake'),
  '16900000-0000-4000-8000-000000000015',14) $$,
  'the honey loaf completes in the normal timing window');
select is((select consumed_quantity from public.ingredient_batches where id=(select value from honey_ids where key='batch')),
  2,'baking consumes the remaining honey unit');
select is((select ingredient_batch_id from public.foods),(select value from honey_ids where key='batch'),
  'the food keeps honey ingredient provenance');
select is((select current_day from public.tavern_saves),1,'brew and bake both complete on one tavern day');
select is((select day_minigame_completed from public.tavern_saves),true,
  'mixed repeatable crafting still marks the day eligible to close');
select ok((select daily_craft_kind is null from public.tavern_saves),
  'completed mixed crafting releases the single active-craft slot');
select is((select revision from public.tavern_saves),15::bigint,
  'the honey craft sequence preserves one revision per committed action');

select * from finish();
rollback;
