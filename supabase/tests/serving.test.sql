begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (id, email, role, aud) values
  ('60000000-0000-4000-8000-000000000001', 'serving-one@example.test', 'authenticated', 'authenticated'),
  ('60000000-0000-4000-8000-000000000002', 'serving-two@example.test', 'authenticated', 'authenticated');
set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000001';
select is(public.get_bar_snapshot(), null::jsonb, 'GET before onboarding does not create a tavern');
select public.create_tavern();
select public.harvest_crop((select id from public.tavern_saves),
  (select id from public.garden_cells where layout_key = 'c1'), '61000000-0000-4000-8000-000000000001', 0);
reset role;

-- Fixtures cover every quality for each patron without changing production rules.
insert into public.brew_sessions (id, save_id, day_number, ingredient_batch_id, ingredient_quality_index, ingredient_brew_bonus, rules_version)
select ('62000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, s.id, n, b.id, 5, 2, 'harvest-v1'
from public.tavern_saves s join public.ingredient_batches b on b.save_id = s.id cross join generate_series(1,16) n
where s.user_id = '60000000-0000-4000-8000-000000000001';
insert into public.beverages (id, save_id, brew_session_id, ingredient_batch_id, rules_version, name, quality_index)
select ('63000000-0000-4000-8000-' || lpad(bs.day_number::text,12,'0'))::uuid,
  bs.save_id, bs.id, bs.ingredient_batch_id, 'harvest-v1', 'Test mead', ((bs.day_number - 1) % 7)::smallint
from public.brew_sessions bs
join public.tavern_saves s on s.id = bs.save_id
where s.user_id = '60000000-0000-4000-8000-000000000001';
insert into public.social_cards (id,save_id,source_beverage_id,card_key,display_name,tier,relationship_gain,gold_multiplier)
select '64000000-0000-4000-8000-000000000001', save_id, id, 'pour-ale', 'Pour Ale', 'exceptional', 10, 2
from public.beverages where id = '63000000-0000-4000-8000-000000000007';

set local role authenticated;
select is(jsonb_array_length(public.get_bar_snapshot()->'patrons'), 2, 'both regulars are available without GET writes');
select is((select count(*) from public.patron_states), 2::bigint, 'onboarding seeds both NPC states; reading does not add more');
select ok(not has_function_privilege('anon','public.serve_beverage(uuid,text,uuid,uuid,uuid,bigint)','EXECUTE'), 'anonymous serving denied');
select ok(not has_function_privilege('anon','public.get_bar_snapshot()','EXECUTE'), 'anonymous bar reads denied');
select throws_ok($$update public.tavern_saves set gold = 500$$, '42501', null, 'players cannot edit gold');
select throws_ok($$update public.patron_states set relationship = 100$$, '42501', null, 'players cannot edit relationships');
select throws_ok($$delete from public.hospitality_events$$, '42501', null, 'players cannot erase consumption');
select throws_ok($$update public.patron_catalog set prices = array[1,1,1,1,1,1,1]$$, '42501', null, 'players cannot edit patron prices');

-- Exercise all price entries and quality-driven relationship/arc deltas.
do $$declare n integer; v_save uuid; v_result jsonb; begin
  select id into v_save from public.tavern_saves;
  for n in 1..14 loop
    v_result := public.serve_beverage(v_save, case when n <= 7 then 'lira' else 'torvin' end,
      ('63000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, null,
      ('65000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, n);
  end loop;
end$$;
select is(array(select gold_earned from public.hospitality_events where patron_key='lira' order by committed_revision),
  array[2,5,8,12,18,28,45], 'all seven Lira prices match the prototype');
select is(array(select gold_earned from public.hospitality_events where patron_key='torvin' order by committed_revision),
  array[1,3,6,10,16,25,40], 'all seven Torvin prices match the prototype');
select is(array(select relationship_change from public.hospitality_events where patron_key='lira' order by committed_revision),
  array[-4,-2,3,3,6,6,6], 'quality determines base relationship effect');
select is(array(select (result->>'arcChange')::integer from public.hospitality_events where patron_key='lira' order by committed_revision),
  array[0,0,0,0,0,0,0], 'new hospitality leaves legacy story progress intact');
select is((select gold from public.tavern_saves), 219::bigint, 'all payments are durably accumulated');
select is(jsonb_array_length(public.get_bar_snapshot()->'beverages'), 2, 'served bottles disappear from available stock');
select is(jsonb_array_length(public.get_bar_snapshot()->'legacyCards'), 1, 'unplayed legacy entitlement remains available');
select lives_ok($$select public.serve_beverage((select id from public.tavern_saves),'lira',
  '63000000-0000-4000-8000-000000000001',null,'65000000-0000-4000-8000-000000000001',1)$$,
  'identical receipt replays before stale revision and consumption checks');
select is((select revision from public.tavern_saves), 15::bigint, 'replay does not advance revision');
select throws_ok($$select public.serve_beverage((select id from public.tavern_saves),'torvin',
  '63000000-0000-4000-8000-000000000001',null,'65000000-0000-4000-8000-000000000001',1)$$,
  'PT409', null, 'changed patron with same ID conflicts');
select throws_ok($$select public.serve_beverage((select id from public.tavern_saves),'lira',
  '63000000-0000-4000-8000-000000000001',null,'65000000-0000-4000-8000-000000000099',15)$$,
  'PT409', 'This beverage has already been served', 'a bottle cannot be served again');

-- Roll back the whole command if the final receipt cannot be stored.
reset role;
create function public.test_reject_serving() returns trigger language plpgsql as $$begin raise exception 'Injected serving failure'; end$$;
create trigger test_reject_serving before insert on public.hospitality_events for each row execute function public.test_reject_serving();
set local role authenticated;
select throws_ok($$select public.serve_beverage((select id from public.tavern_saves),'lira',
  '63000000-0000-4000-8000-000000000015','64000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000015',15)$$, 'P0001', 'Injected serving failure', 'receipt failure rolls back the transaction');
select is((select gold from public.tavern_saves), 219::bigint, 'failure does not pay gold');
select is((select arc_progress from public.patron_states where patron_key='lira'),0,'failure does not change the story');
select is(jsonb_array_length(public.get_bar_snapshot()->'legacyCards'),1,'failure does not consume a legacy entitlement');
select is((select revision from public.tavern_saves),15::bigint,'failure does not advance revision');
reset role;
drop trigger test_reject_serving on public.hospitality_events;
drop function public.test_reject_serving();
set local role authenticated;
select lives_ok($$select public.serve_beverage((select id from public.tavern_saves),'lira',
  '63000000-0000-4000-8000-000000000015','64000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000015',15)$$, 'a card can improve a poor pour after rollback');
select is((select gold_earned from public.hospitality_events where committed_revision=16),4,'legacy entitlement multiplies patron payment');
select is((select relationship_change from public.hospitality_events where committed_revision=16),6,'legacy entitlement adds its stored relationship bonus');
select is((select (result->>'arcChange')::integer from public.hospitality_events where committed_revision=16),0,'legacy entitlements do not change historical story progress');
select is((select arc_progress from public.patron_states where patron_key='lira'),0,'poor drinks affect trust and readiness, preserving historical story progress');
select is(jsonb_array_length(public.get_bar_snapshot()->'legacyCards'),0,'used legacy entitlement is consumed once');
select throws_ok($$select public.serve_beverage((select id from public.tavern_saves),'torvin',
  '63000000-0000-4000-8000-000000000016','64000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000016',16)$$, 'PT409','This legacy Pour Ale card has already been used','a legacy entitlement cannot be used twice');
select throws_ok($$select public.serve_beverage((select id from public.tavern_saves),'unknown',
  '63000000-0000-4000-8000-000000000016',null,'65000000-0000-4000-8000-000000000016',16)$$,
  'PT404',null,'unknown patrons are rejected');

reset role;
update public.patron_states set relationship=99, arc_progress=5 where patron_key='lira';
update public.beverages set quality_index=6 where id='63000000-0000-4000-8000-000000000016';
set local role authenticated;
select lives_ok($$select public.serve_beverage((select id from public.tavern_saves),'lira',
  '63000000-0000-4000-8000-000000000016',null,'65000000-0000-4000-8000-000000000016',16)$$,
  'serving remains possible after story completion');
select is((select relationship from public.patron_states where patron_key='lira'),100,'relationship is capped at 100');
select is((select arc_progress from public.patron_states where patron_key='lira'),5,'completed story is capped at its last chapter');
select is((select relationship_change from public.hospitality_events where committed_revision=17),1,'receipt records actual clamped relationship change');
select is((select (result->>'arcChange')::integer from public.hospitality_events where committed_revision=17),0,'receipt records no extra story progress beyond completion');
select is(jsonb_array_length(public.get_bar_snapshot()->'beverages'),0,'exhausted cellar remains empty');

set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000002';
select is(public.get_bar_snapshot(), null::jsonb,'another player has no first-player snapshot');
select is((select count(*) from public.hospitality_events),0::bigint,'RLS hides hospitality history');
select is((select count(*) from public.patron_states),0::bigint,'RLS hides relationships');
reset role;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000001';
-- Quality affects the next attempt independently from gold, cards and legacy arcs.
update public.hospitality_events set quality_index=6 where save_id=(select id from public.tavern_saves where user_id=auth.uid());
select is(private.npc_hospitality((select id from public.tavern_saves where user_id=auth.uid()),'lira',1),3,'many excellent drinks cap hospitality at +3');
select is(private.npc_chance(q.save_id,'lira',1,q),75,'positive hospitality adds fifteen percentage points') from private.npc_quests q where save_id=(select id from public.tavern_saves where user_id=auth.uid()) and patron_key='lira';
update private.npc_quests set preparation=2 where save_id=(select id from public.tavern_saves where user_id=auth.uid());
select is(private.npc_chance(q.save_id,'lira',1,q),90,'readiness and hospitality cannot exceed the ninety-percent cap') from private.npc_quests q where save_id=(select id from public.tavern_saves where user_id=auth.uid()) and patron_key='lira';
update public.hospitality_events set quality_index=0 where save_id=(select id from public.tavern_saves where user_id=auth.uid());
select is(private.npc_hospitality((select id from public.tavern_saves where user_id=auth.uid()),'lira',1),-3,'many poor drinks cap hospitality at -3');
select is(private.npc_chance(q.save_id,'lira',1,q),65,'preparation remains effective with poor hospitality') from private.npc_quests q where save_id=(select id from public.tavern_saves where user_id=auth.uid()) and patron_key='lira';
select is(private.npc_hospitality((select id from public.tavern_saves where user_id=auth.uid()),'lira',2),0,'hospitality does not leak into later tavern days');
select * from finish();
rollback;
