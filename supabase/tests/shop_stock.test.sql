begin;

create extension if not exists pgtap with schema extensions;
select plan(41);

-- Test-only worker harness: the Shop assertions continue on the next day, so
-- they explicitly settle the asynchronous day-close before another purchase.
create function pg_temp.drain_world_settlement(p_settlement_id uuid) returns void
language plpgsql as $$
declare
  claim jsonb;
  processed integer := 0;
begin
  loop
    claim := public.world_settlement_claim(p_settlement_id);
    exit when not (claim ? 'jobId');
    perform public.world_settlement_safe_result(
      p_settlement_id, (claim->>'jobId')::uuid, (claim->>'fence')::uuid,
      'no_changes', 'Fixture worker completed the settlement.'
    );
    processed := processed + 1;
    if processed > 64 then raise exception 'fixture worker exceeded settlement bound'; end if;
  end loop;
  if claim->>'status' <> 'completed' then
    raise exception 'fixture worker did not terminalize settlement';
  end if;
end;
$$;

insert into auth.users(id,email,role,aud,created_at,updated_at) values
  ('22000000-0000-4000-8000-000000000001','shop-stock-one@example.test','authenticated','authenticated',now(),now()),
  ('22000000-0000-4000-8000-000000000002','shop-stock-two@example.test','authenticated','authenticated',now(),now());
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='22000000-0000-4000-8000-000000000001';

select lives_ok($$ select public.create_tavern() $$,'new tavern initializes the daily Shop ledger');
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),10,'seeds begin with ten units');
select is((select remaining_quantity from public.garden_shop_stock where item_key='amendment_n'),5,'amendments begin with five units');
select is((select remaining_quantity from public.garden_shop_stock where item_key='treatment_varroa'),3,'treatments begin with three units');
select is((select remaining_quantity from public.garden_shop_stock where item_key='hive_equipment'),1,'empty hives begin with one unit');
select results_eq(
  $$ select item_key,daily_cap from public.garden_shop_stock order by item_key $$,
  $$ values
    ('amendment_k'::text,5),('amendment_n'::text,5),('amendment_p'::text,5),('bee_feed'::text,10),
    ('hive_equipment'::text,1),('replacement_colony'::text,1),
    ('seed_chamomile'::text,10),('seed_clover'::text,10),('seed_fennel'::text,10),('seed_hops'::text,10),
    ('seed_lavender'::text,10),('seed_pepper'::text,10),('seed_sage'::text,10),('seed_tomatoes'::text,10),
    ('soil_builder'::text,5),('treatment_chalkbrood'::text,3),('treatment_nosema'::text,3),('treatment_varroa'::text,3) $$,
  'every current purchasable SKU has its configured daily cap');
select ok((public.get_tavern_snapshot()#>'{garden,shop}') @> jsonb_build_array(jsonb_build_object('itemKey','seed_hops','dailyCap',10,'remainingStock',10,'restockDay',1)),
  'snapshot includes stock fields for purchasable SKUs');
select is(jsonb_array_length(public.get_tavern_snapshot()#>'{garden,shop}'),18,'snapshot includes every current purchasable SKU');
select is((public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":1}'::jsonb)->>'status'),'insufficient_gold',
  'preview distinguishes insufficient gold');
select is((public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":11}'::jsonb)->'blockingReasons'),
  '["insufficient_gold","quantity_exceeds_stock"]'::jsonb,'preview reports every simultaneous blocking reason');
select is((public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":11}'::jsonb)->>'maxQuantity')::integer,10,
  'preview supplies the authoritative maximum quantity');
select is((public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":11}'::jsonb)->>'goldDeficit')::integer,22,
  'preview supplies the precise gold deficit');

create temporary table receipts(receipt jsonb);
reset role;
update public.tavern_saves set gold=100 where user_id='22000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='22000000-0000-4000-8000-000000000001';
select is((public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":11}'::jsonb)->>'status'),'exceeds_stock',
  'preview distinguishes a request above available stock when funds are sufficient');
select ok(not (public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":11}'::jsonb)->>'canCommit')::boolean,
  'over-stock preview cannot be committed');
insert into receipts select public.garden_command((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000011',0,'purchase','{"itemKey":"seed_hops","quantity":10}'::jsonb);
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),0,'buying the cap sells out only that SKU');
select is((select gold from public.tavern_saves),80::bigint,'purchase charges the authoritative catalog price once');
select is((select receipt#>>'{result,previousGold}' from receipts), '100','receipt records actual gold before the purchase');
select is((select receipt#>>'{result,goldBalance}' from receipts), '80','receipt records actual gold after the purchase');
select is((select receipt#>>'{result,previousStock}' from receipts), '10','receipt records stock before the purchase');
select is((select receipt#>>'{result,remainingStock}' from receipts), '0','receipt records stock after the purchase');
select is((select receipt#>>'{result,restockDay}' from receipts), '2','receipt records the next restock day');
select is((public.preview_garden_command('purchase','{"itemKey":"seed_hops","quantity":1}'::jsonb)->>'status'),'sold_out',
  'preview gives a structured sold-out state');
select ok((public.get_tavern_snapshot()#>'{garden,shop}') @> jsonb_build_array(jsonb_build_object('itemKey','seed_hops','remainingStock',0)),
  'sold-out SKUs remain visible in the snapshot');
select throws_ok($$ select public.garden_command((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000012',1,'purchase','{"itemKey":"seed_hops","quantity":1}'::jsonb) $$,
  'PT422','That item is out of stock','sold-out command cannot oversell');
select is((select count(*) from public.garden_actions where command_kind='purchase'),1::bigint,'failed purchase has no action receipt');
select is((select receipt from receipts), public.garden_command((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000011',0,'purchase','{"quantity":10,"itemKey":"seed_hops"}'::jsonb),
  'canonical retry returns the exact original receipt');

create temporary table day_receipts(receipt jsonb);
insert into day_receipts select public.advance_tavern_day((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000013',1);
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),10,
  'a successful day advance resets sold-out stock to its cap');
select set_config('app.fixture_settlement_id', public.world_settlement_status((select id from public.tavern_saves where user_id = '22000000-0000-4000-8000-000000000001'))->>'id', true);
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
select pg_temp.drain_world_settlement(current_setting('app.fixture_settlement_id')::uuid);
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '22000000-0000-4000-8000-000000000001';
select is(public.world_settlement_status((select id from public.tavern_saves))->>'status', 'completed', 'the fixture worker terminalizes the day settlement');
select is((select world_phase from public.tavern_saves where user_id = '22000000-0000-4000-8000-000000000001'), 'open', 'the fixture worker reopens the tavern');
select lives_ok($$ select public.garden_command((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000014',2,'purchase','{"itemKey":"seed_hops","quantity":1}'::jsonb) $$,
  'post-restock purchase succeeds at the new revision');
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),9,
  'post-restock purchase consumes one new-day unit');
select is((select receipt from day_receipts),public.advance_tavern_day((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000013',1),'day retry returns its original receipt');
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),9,
  'replaying a prior day advance cannot restock later purchases');
select throws_ok($$ select public.advance_tavern_day((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000015',1) $$,'PT409','Tavern state changed; refresh before closing',
  'stale day advance is rejected before stock replenishment');
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),9,
  'rejected day advance leaves stock unchanged');

reset role;
insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until
)
select
  '22000000-0000-4000-8000-000000000016',save_row.id,resident.id,resident.npc_id,resident.version_id,
  save_row.user_id,'A pending conversation.',resident.conversation_sequence,save_row.revision,save_row.current_day,
  'processing',now()+interval '5 minutes'
from public.tavern_saves save_row
join private.world_npc_instances resident on resident.save_id=save_row.id
where save_row.user_id='22000000-0000-4000-8000-000000000001'
order by resident.id limit 1;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='22000000-0000-4000-8000-000000000001';
select throws_ok($$ select public.advance_tavern_day((select id from public.tavern_saves),
  '22000000-0000-4000-8000-000000000017',3) $$,'PT409','Finish or cancel the active resident dialogue before closing',
  'a blocked day advance cannot reach stock replenishment');
select is((select remaining_quantity from public.garden_shop_stock where item_key='seed_hops'),9,
  'a blocked day advance leaves stock unchanged');

set local request.jwt.claim.sub='22000000-0000-4000-8000-000000000002';
select lives_ok($$ select public.create_tavern() $$,'a second tavern initializes an independent Shop ledger');
select is((select remaining_quantity from public.garden_shop_stock s join public.tavern_saves t on t.id=s.save_id
  where t.user_id='22000000-0000-4000-8000-000000000002' and s.item_key='seed_hops'),10,'one tavern cannot deplete another tavern stock');
select is((select count(*) from public.garden_shop_stock s join public.tavern_saves t on t.id=s.save_id
  where t.user_id='22000000-0000-4000-8000-000000000001'),0::bigint,'authenticated players cannot read another tavern stock ledger');
select ok(not has_table_privilege('anon','public.garden_shop_stock','select'),'anonymous clients have no stock-table access');

select * from finish();
rollback;
