begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id,email,role,aud,created_at,updated_at)
values ('16200000-0000-4000-8000-000000000001','garden-occupancy@example.test',
  'authenticated','authenticated',now(),now());

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='16200000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'occupancy test garden provisions');

reset role;
select is((select count(*) from public.garden_cells c
  where c.kind='plant' and exists(select 1 from public.garden_plants p where p.save_id=c.save_id and p.cell_id=c.id)),
  7::bigint,'each migrated plant cell has one plant row');
select is((select count(*) from public.garden_cells c
  where c.kind='beehive' and exists(select 1 from public.apiary_hives h where h.save_id=c.save_id and h.cell_id=c.id)),
  1::bigint,'the migrated hive cell has one hive row');

select throws_like($$
  set constraints all deferred;
  insert into public.garden_plants(save_id,cell_id,rules_version,species_key,lifecycle,planted_day)
  select save_id,id,'garden-apiary-v1','clover','seedling',1 from public.garden_cells where layout_key='c0';
  set constraints all immediate
$$,'%occupancy does not match kind plant%',
  'two plants cannot occupy one cell');

select throws_like($$
  set constraints all deferred;
  insert into public.apiary_hives(save_id,cell_id,installed_day)
  select save_id,id,1 from public.garden_cells where layout_key='c2';
  set constraints all immediate
$$,'%occupancy does not match kind beehive%',
  'two hives cannot occupy one cell');

select throws_like($$
  set constraints all deferred;
  insert into public.apiary_hives(save_id,cell_id,installed_day)
  select save_id,id,1 from public.garden_cells where layout_key='c0';
  set constraints all immediate
$$,'%occupancy does not match kind plant%',
  'a hive cannot coexist with a plant');

select throws_like($$
  set constraints all deferred;
  insert into public.garden_plants(save_id,cell_id,rules_version,species_key,lifecycle,planted_day)
  select save_id,id,'garden-apiary-v1','clover','seedling',1 from public.garden_cells where layout_key='c2';
  set constraints all immediate
$$,'%occupancy does not match kind beehive%',
  'a plant cannot coexist with a hive');

select throws_like($$
  set constraints all deferred;
  update public.garden_cells set kind='plant',plant_key='hops',growth_stage=1,water=50,health=80
  where layout_key='c11';
  set constraints all immediate
$$,'%occupancy does not match kind plant%',
  'a plant cell must have a matching plant row');

select throws_like($$
  set constraints all deferred;
  update public.garden_cells set kind='empty',plant_key=null,growth_stage=null,water=null,health=null
  where layout_key='c0';
  set constraints all immediate
$$,'%occupancy does not match kind empty%',
  'an empty cell cannot retain a plant row');

select lives_ok($$
  set constraints all deferred;
  update public.garden_cells target set
    kind='plant', plant_key=source.plant_key, growth_stage=source.growth_stage,
    water=source.water, health=source.health
  from public.garden_cells source
  where target.layout_key='c2' and source.layout_key='c0' and target.save_id=source.save_id;
  update public.garden_cells set
    kind='beehive',plant_key=null,growth_stage=null,water=null,health=null
  where layout_key='c0';
  update public.garden_plants p set cell_id=c2.id
  from public.garden_cells c0, public.garden_cells c2
  where p.save_id=c0.save_id and p.cell_id=c0.id and c0.layout_key='c0'
    and c2.save_id=c0.save_id and c2.layout_key='c2';
  update public.apiary_hives h set cell_id=c0.id
  from public.garden_cells c0, public.garden_cells c2
  where h.save_id=c2.save_id and h.cell_id=c2.id and c2.layout_key='c2'
    and c0.save_id=c2.save_id and c0.layout_key='c0';
  set constraints all immediate
$$,'a plant and hive can be swapped atomically with deferred checks');

select is((select count(*) from public.apiary_hives h join public.garden_cells c
  on c.save_id=h.save_id and c.id=h.cell_id where c.layout_key='c0' and c.kind='beehive'),
  1::bigint,'the swapped hive occupies the declared hive cell');
select is((select count(*) from public.garden_plants p join public.garden_cells c
  on c.save_id=p.save_id and c.id=p.cell_id where c.layout_key='c2' and c.kind='plant'),
  1::bigint,'the swapped plant occupies the declared plant cell');

select * from finish();
rollback;
