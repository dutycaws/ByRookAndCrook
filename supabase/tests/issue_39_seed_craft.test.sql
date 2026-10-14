begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select results_eq(
  $$ select item_key,display_name,price,effect->>'species'
     from public.garden_item_catalog
    where rules_version='garden-apiary-v1'
      and item_key in ('seed_charm_bloom','seed_insight_iris','seed_rumor_thyme')
    order by item_key $$,
  $$ values
    ('seed_charm_bloom'::text,'Charm Bloom seed'::text,8,'charm_bloom'::text),
    ('seed_insight_iris'::text,'Insight Iris seed'::text,9,'insight_iris'::text),
    ('seed_rumor_thyme'::text,'Rumor Thyme seed'::text,8,'rumor_thyme'::text) $$,
  'the three social seed SKUs have stable catalog identities and prices'
);

select results_eq(
  $$ select species_key,maturity_days,regrows,base_yield
     from public.garden_species_profiles
    where rules_version='garden-apiary-v1'
      and species_key in ('charm_bloom','insight_iris','rumor_thyme')
    order by species_key $$,
  $$ values
    ('charm_bloom'::text,4::smallint,true,1::smallint),
    ('insight_iris'::text,5::smallint,true,1::smallint),
    ('rumor_thyme'::text,4::smallint,true,1::smallint) $$,
  'social crops use real, renewable garden growth profiles'
);

select ok(
  position('insert into public.daily_deck_changes' in pg_get_functiondef('public.harvest_crop(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'harvest persists its deferred social-card change in the daily deck ledger'
);
select ok(
  position('when ''charm_bloom'' then ''charm''' in pg_get_functiondef('public.harvest_crop(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'Charm Bloom maps to Charm'
);
select ok(
  position('when ''insight_iris'' then ''insight''' in pg_get_functiondef('public.harvest_crop(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'Insight Iris maps to Insight'
);
select ok(
  position('when ''rumor_thyme'' then ''rumor''' in pg_get_functiondef('public.harvest_crop(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'Rumor Thyme maps to Rumor'
);
select ok(
  position('v_save.current_day+1' in pg_get_functiondef('public.harvest_crop(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'special harvest changes are effective the following day'
);
select ok(
  position('insert into public.intent_cards' in pg_get_functiondef('public.harvest_crop(uuid,uuid,uuid,bigint)'::regprocedure)) = 0,
  'harvest never inserts an immediately usable social card'
);

select ok(
  position('public.intent_cards' in pg_get_functiondef('public.complete_brew(uuid,uuid,uuid,bigint,integer,integer,integer)'::regprocedure)) = 0,
  'brew completion does not create or mutate a legacy social-card reward'
);
select ok(
  position('issue39_assert_preparation' in pg_get_functiondef('public.complete_brew(uuid,uuid,uuid,bigint,integer,integer,integer)'::regprocedure)) > 0,
  'brew completion is preparation-only for new commands'
);
select ok(
  position('issue39_assert_preparation' in pg_get_functiondef('public.complete_bake(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'bake completion is preparation-only for new commands'
);
select ok(
  position('issue39_assert_preparation' in pg_get_functiondef('public.start_bake(uuid,uuid,uuid,bigint)'::regprocedure)) > 0,
  'bake start is preparation-only for new commands'
);

insert into auth.users(id,email,role,aud,created_at,updated_at)
values ('39900000-0000-4000-8000-000000000001','issue39-seed-craft@example.test','authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='39900000-0000-4000-8000-000000000001';
select lives_ok($$ select public.create_tavern() $$,'brew fixture tavern provisions');
select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),
  (select id from public.garden_cells where layout_key='c1'),
  '39900000-0000-4000-8000-000000000010',0
) $$,'fixture harvest creates a brewable batch');
select lives_ok($$ select public.start_brew(
  (select id from public.tavern_saves),(select id from public.ingredient_batches),
  '39900000-0000-4000-8000-000000000011',1
) $$,'fixture starts a guided brew');
reset role;
update public.brew_sessions set started_at=clock_timestamp()-interval '18 seconds';
set local role authenticated;
select lives_ok($$ select public.complete_brew(
  (select id from public.tavern_saves),(select id from public.brew_sessions),
  '39900000-0000-4000-8000-000000000012',2,60,0,60
) $$,'a real completed brew succeeds without touching immutable intent rows');
select is((select count(*) from public.beverages),1::bigint,'brew completion still creates its serving beverage');
select is((select count(*) from public.intent_cards where source_kind='brew'),0::bigint,'brew completion issues no legacy social card');
select ok(not ((select result from public.craft_actions where action_id='39900000-0000-4000-8000-000000000012') ? 'intentCardId'),
  'brew receipt contains no obsolete social-card reward');

select lives_ok($$ select public.harvest_crop(
  (select id from public.tavern_saves),
  (select id from public.garden_cells where layout_key='c0'),
  '39900000-0000-4000-8000-000000000020',3
) $$,'fixture harvest creates a bakeable batch');
select lives_ok($$ select public.start_bake(
  (select id from public.tavern_saves),(select id from public.ingredient_batches where consumed_quantity=0),
  '39900000-0000-4000-8000-000000000021',4
) $$,'fixture starts a bake');
select lives_ok($$
  do $prepare$
  declare v_revision bigint:=5; v_session uuid:=(select id from public.bake_sessions where status<>'completed');
  begin
    for i in 1..6 loop
      perform public.fold_bake((select id from public.tavern_saves),v_session,extensions.gen_random_uuid(),v_revision,70);
      v_revision:=v_revision+1;
    end loop;
    for i in 1..3 loop
      perform public.score_bake((select id from public.tavern_saves),v_session,extensions.gen_random_uuid(),v_revision,70);
      v_revision:=v_revision+1;
    end loop;
  end $prepare$;
$$,'fixture completes the normal folding and scoring minigame');
select lives_ok($$ select public.begin_bake_oven(
  (select id from public.tavern_saves),(select id from public.bake_sessions where status<>'completed'),
  '39900000-0000-4000-8000-000000000022',14
) $$,'fixture puts the prepared loaf in the oven');
reset role;
update public.bake_sessions set oven_started_at=clock_timestamp()-interval '30 seconds';
set local role authenticated;
select lives_ok($$ select public.complete_bake(
  (select id from public.tavern_saves),(select id from public.bake_sessions where status='baking'),
  '39900000-0000-4000-8000-000000000023',15
) $$,'a real completed bake succeeds without a social-card award');
select is((select count(*) from public.foods),1::bigint,'bake completion still creates its serving food');
select is((select count(*) from public.intent_cards where source_kind='bake'),0::bigint,'bake completion issues no legacy social card');
select ok(not ((select result from public.bake_actions where action_id='39900000-0000-4000-8000-000000000023') ? 'intentCardId'),
  'bake receipt contains no obsolete social-card reward');

reset role;

select * from finish();
rollback;
