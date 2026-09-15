begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

select has_table('private','world_generated_supply_definitions','generated supply definitions are private and durable');
select has_table('private','world_generated_supply_stock','generated supply stock is private and durable');
select has_table('private','world_generated_supply_inventory','generated supply inventory is private and durable');
select has_table('private','world_generated_supply_actions','generated supply actions preserve exact replay');
select has_table('private','world_generated_supply_uses','successor quest supply use is private and bounded');
select has_table('private','world_generated_supply_receipts','complete supply proposals have exact replay receipts');
select has_function('public','world_generated_shop_projection',array['uuid'],'owner-scoped generated shop projection exists');
select has_function('public','purchase_generated_supply',array['uuid','uuid','bigint','text','integer'],'generated supply purchase has an explicit revisioned contract');
select has_function('public','use_generated_supply',array['uuid','uuid','bigint','text','uuid'],'generated supply use has an explicit revisioned contract');
select has_function('public','world_settlement_commit_procedural_world',array['uuid','uuid','uuid','jsonb'],'procedural commit wrapper remains the service entry point');
select ok(not has_function_privilege('authenticated','private.world_generated_supply_install(uuid,uuid,jsonb)','execute'),'players cannot install generated supplies');
select ok(has_function_privilege('authenticated','public.world_generated_shop_projection(uuid)','execute'),'owners can read the bounded generated shop projection');
select ok(not has_table_privilege('authenticated','private.world_generated_supply_definitions','select'),'players cannot read private generated definitions');
select ok(not has_function_privilege('anon','public.advance_tavern_day(uuid,uuid,bigint)','execute'),'anonymous callers cannot advance the generated-stock day boundary');

insert into auth.users(id,email,role,aud) values
 ('15700000-0000-4000-8000-000000000001','supply-owner@example.test','authenticated','authenticated'),
 ('15700000-0000-4000-8000-000000000002','supply-other@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.fixture as
select (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id;
reset role;
alter table pg_temp.fixture add column resident_id uuid;
update pg_temp.fixture
set resident_id=(select id from private.world_npc_instances where save_id=pg_temp.fixture.save_id order by id limit 1);
update public.tavern_saves set gold=100 where id=(select save_id from pg_temp.fixture);
set local session_replication_role=replica;
update private.world_resident_evolution_pins
set capability=jsonb_build_object(
  'version','capabilities-v1',
  'allowedWorldEffects',jsonb_build_array('create_entity'),
  'allowedActions','[]'::jsonb,
  'allowedApproaches','[]'::jsonb,
  'allowedTargetKinds',jsonb_build_array('item'),
  'socialCapabilities','[]'::jsonb,
  'irreversibleEffects','[]'::jsonb
)
where instance_id=(select resident_id from pg_temp.fixture);
set local session_replication_role=origin;

-- Keep an unrelated, durable-looking supply in this transaction.  Every
-- fixture assertion below must remain scoped, even when developer data (or a
-- neighbouring test) already has generated shop rows.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000002';
select public.create_tavern();
create temporary table pg_temp.unrelated_supply as
select
  (public.npc_bar_snapshot()#>>'{save,id}')::uuid save_id,
  '15700000-0000-4000-8000-000000000040'::uuid canonical_entity_id,
  '15700000-0000-4000-8000-000000000041'::uuid quest_id;
reset role;
alter table pg_temp.unrelated_supply add column resident_id uuid;
update pg_temp.unrelated_supply
set resident_id=(
  select id
  from private.world_npc_instances
  where save_id=pg_temp.unrelated_supply.save_id
  order by id
  limit 1
);
insert into private.world_canonical_entities(
  id,save_id,entity_kind,entity_key,origin,payload,lifecycle
)
select canonical_entity_id,save_id,'item','unrelated-provisions','procedural','{}'::jsonb,'active'
from pg_temp.unrelated_supply;
insert into private.world_generated_supply_definitions(
  canonical_entity_id,save_id,display_name,price,daily_stock,use_family
)
select canonical_entity_id,save_id,'Unrelated provisions',7,2,'successor_provisions'
from pg_temp.unrelated_supply;
insert into private.world_generated_supply_stock(canonical_entity_id,save_id,remaining_quantity)
select canonical_entity_id,save_id,2 from pg_temp.unrelated_supply;
insert into private.world_procedural_quests(
  id,save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day
)
select quest_id,save_id,resident_id,'active','successor-quest','unrelated-generated-supply','{}'::jsonb,1
from pg_temp.unrelated_supply;
insert into private.world_generated_supply_inventory(save_id,canonical_entity_id,quantity)
select save_id,canonical_entity_id,2 from pg_temp.unrelated_supply;
insert into private.world_generated_supply_uses(save_id,quest_id,canonical_entity_id,quantity)
select save_id,quest_id,canonical_entity_id,2 from pg_temp.unrelated_supply;

create temporary table pg_temp.claim(settlement_id uuid,job_id uuid,fence uuid);
insert into pg_temp.claim values(
  '15700000-0000-4000-8000-000000000010',
  '15700000-0000-4000-8000-000000000011',
  '15700000-0000-4000-8000-000000000012'
);
insert into private.world_settlements(
  id,save_id,day_number,source_revision,input_fingerprint,status,fence,
  lease_until,deadline_at,input_snapshot,input_version
)
select settlement_id,save_id,2,0,'generated-supply-positive','processing',fence,
  clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes',
  '{}'::jsonb,'procedural-world-v1'
from pg_temp.claim cross join pg_temp.fixture;
insert into private.world_settlement_jobs(
  id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version
)
select job_id,settlement_id,1,'procedural_world','processing',
  encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),
  private.world_procedural_world_context(save_id),'procedural-world-v1'
from pg_temp.claim cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until)
select job_id,1,fence,clock_timestamp()+interval '5 minutes' from pg_temp.claim;

create function pg_temp.supply_proposal(
  p_name text default 'Road provisions',
  p_family text default 'successor_provisions',
  p_kind text default 'item',
  p_key text default 'road-provisions'
) returns jsonb language sql as $proposal$
select jsonb_build_object(
  'version','procedural-world-v1',
  'commands',jsonb_build_array(
    jsonb_build_object(
      'operation','gameplay_unlock','effectKind','unlock_gameplay',
      'sourceResidentId',(select resident_id::text from pg_temp.fixture),
      'entityRef',p_key,'family',p_family,
      'definition',jsonb_build_object('displayName',p_name,'price',12,'dailyStock',3)
    ),
    jsonb_build_object(
      'operation','entity','effectKind','create_entity',
      'sourceResidentId',(select resident_id::text from pg_temp.fixture),
      'entityKind',p_kind,'entityKey',p_key,
      'archetypeKey',case when p_kind='item' then 'trade-good' else 'crafted-dish' end,
      'proposedName',p_name,'payload','{}'::jsonb
    )
  )
) $proposal$;

grant select on pg_temp.fixture,pg_temp.claim to service_role;
set local role service_role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.commit_result(result jsonb);
grant select,insert on pg_temp.commit_result to service_role;
insert into pg_temp.commit_result
select public.world_settlement_commit_procedural_world(settlement_id,job_id,fence,pg_temp.supply_proposal())
from pg_temp.claim;
select is((select result#>>'{supplyUnlocks,0,reused}' from pg_temp.commit_result),'false','fenced same-proposal item install creates the fixed supply');
select is((public.world_settlement_commit_procedural_world(
  (select settlement_id from pg_temp.claim),(select job_id from pg_temp.claim),(select fence from pg_temp.claim),pg_temp.supply_proposal()
)->>'replayed'),'true','exact supply proposal replay is stable');
select throws_ok($$select public.world_settlement_commit_procedural_world(
  (select settlement_id from pg_temp.claim),(select job_id from pg_temp.claim),(select fence from pg_temp.claim),pg_temp.supply_proposal('Changed provisions')
)$$,'PT409',null,'changed complete proposal replay is rejected');
reset role;
alter table pg_temp.fixture add column supply_entity_id uuid;
update pg_temp.fixture
set supply_entity_id=(
  select definition.canonical_entity_id
  from private.world_generated_supply_definitions definition
  join private.world_canonical_entities entity on entity.id=definition.canonical_entity_id
  where definition.save_id=pg_temp.fixture.save_id
    and entity.entity_key='road-provisions'
);
select is((
  select count(*)
  from private.world_generated_supply_definitions definition
  where definition.save_id=(select save_id from pg_temp.fixture)
    and definition.canonical_entity_id=(select supply_entity_id from pg_temp.fixture)
),1::bigint,'same-proposal supply unlock creates one durable definition');

create temporary table pg_temp.negative(settlement_id uuid,job_id uuid,fence uuid);
insert into pg_temp.negative values(
  '15700000-0000-4000-8000-000000000020',
  '15700000-0000-4000-8000-000000000021',
  '15700000-0000-4000-8000-000000000022'
);
insert into private.world_settlements(
  id,save_id,day_number,source_revision,input_fingerprint,status,fence,
  lease_until,deadline_at,input_snapshot,input_version
)
select settlement_id,save_id,3,0,'generated-supply-negative','processing',fence,
  clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes',
  '{}'::jsonb,'procedural-world-v1'
from pg_temp.negative cross join pg_temp.fixture;
insert into private.world_settlement_jobs(
  id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version
)
select job_id,settlement_id,1,'procedural_world','processing',
  encode(extensions.digest(private.world_canonical_json(private.world_procedural_world_context(save_id)),'sha256'),'hex'),
  private.world_procedural_world_context(save_id),'procedural-world-v1'
from pg_temp.negative cross join pg_temp.fixture;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until)
select job_id,1,fence,clock_timestamp()+interval '5 minutes' from pg_temp.negative;
grant select on pg_temp.negative to service_role;
set local role service_role;
set local request.jwt.claim.role='service_role';
select throws_ok($$select public.world_settlement_commit_procedural_world(
  (select settlement_id from pg_temp.negative),(select job_id from pg_temp.negative),'15700000-0000-4000-8000-000000000099',pg_temp.supply_proposal('Fresh provisions','successor_provisions','item','fresh-provisions')
)$$,'PT409',null,'stale settlement fence is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world(
  (select save_id from pg_temp.fixture),(select job_id from pg_temp.negative),(select fence from pg_temp.negative),pg_temp.supply_proposal('Fresh provisions','successor_provisions','item','fresh-provisions')
)$$,'PT409',null,'cross-settlement commit is rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world(
  (select settlement_id from pg_temp.negative),(select job_id from pg_temp.negative),(select fence from pg_temp.negative),pg_temp.supply_proposal('Fresh provisions','unregistered_family','item','fresh-provisions')
)$$,'PT400',null,'unregistered gameplay families are rejected');
select throws_ok($$select public.world_settlement_commit_procedural_world(
  (select settlement_id from pg_temp.negative),(select job_id from pg_temp.negative),(select fence from pg_temp.negative),pg_temp.supply_proposal('Fresh provisions','successor_provisions','recipe','fresh-provisions')
)$$,'PT400',null,'supply unlocks cannot target another canonical kind');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
select is((public.world_generated_shop_projection((select save_id from pg_temp.fixture))#>>'{catalog,0,itemKey}'),'road-provisions','owner sees the bounded generated supply catalog');
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000002';
select throws_ok($$select public.world_generated_shop_projection((select save_id from pg_temp.fixture))$$,'PT404',null,'another owner cannot read generated supply content');
select throws_ok($$select public.purchase_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000029',0,'road-provisions',1
)$$,'PT404',null,'another owner cannot purchase generated supply content');
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
create temporary table pg_temp.purchase_result(result jsonb);
grant select,insert on pg_temp.purchase_result to authenticated;
insert into pg_temp.purchase_result
select public.purchase_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000030',0,'road-provisions',1
);
select is((select result->>'goldSpent' from pg_temp.purchase_result),'12','purchase debits the fixed generated price');
select is((public.world_generated_shop_projection((select save_id from pg_temp.fixture))#>>'{inventory,0,quantity}'),'1','purchase adds one generated supply to owned inventory');
select is((public.world_generated_shop_projection((select save_id from pg_temp.fixture))#>>'{catalog,0,remainingStock}'),'2','purchase decrements finite daily stock');
select is((select revision from public.tavern_saves where id=(select save_id from pg_temp.fixture)),1::bigint,'purchase advances the save revision once');
select is((public.purchase_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000030',0,'road-provisions',1
)->>'committedRevision'),'1','exact purchase retry returns the saved result');
select throws_ok($$select public.purchase_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000030',0,'road-provisions',2
)$$,'PT409',null,'changed purchase replay is rejected');
reset role;

create temporary table pg_temp.quest(id uuid);
with inserted as (
  insert into private.world_procedural_quests(
    save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day
  )
  select save_id,resident_id,'active','successor-quest','generated-supply-quest','{}'::jsonb,1
  from pg_temp.fixture returning id
)
insert into pg_temp.quest select id from inserted;
grant select on pg_temp.quest to authenticated;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
create temporary table pg_temp.use_result(result jsonb);
grant select,insert on pg_temp.use_result to authenticated;
insert into pg_temp.use_result
select public.use_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000031',1,'road-provisions',(select id from pg_temp.quest)
);
select is((select result->>'quantityUsed' from pg_temp.use_result),'1','successor quest use consumes one supply');
select is(jsonb_array_length(public.world_generated_shop_projection((select save_id from pg_temp.fixture))->'inventory'),0,'used supply leaves the projected inventory');
select is((public.world_generated_shop_projection((select save_id from pg_temp.fixture))#>>'{successorQuest,suppliesUsed}'),'1','successor quest projection reports bounded supply progress');
reset role;
select is((
  select uses.quantity
  from private.world_generated_supply_uses uses
  where uses.save_id=(select save_id from pg_temp.fixture)
    and uses.quest_id=(select id from pg_temp.quest)
    and uses.canonical_entity_id=(select supply_entity_id from pg_temp.fixture)
),1,'supply use records one authoritative progress unit');
select is((
  select count(*)
  from private.world_generated_supply_uses uses
  where uses.save_id=(select save_id from pg_temp.fixture)
    and uses.quest_id=(select id from pg_temp.quest)
    and uses.canonical_entity_id=(select supply_entity_id from pg_temp.fixture)
),1::bigint,'supply use creates one durable progress row');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
select is((select revision from public.tavern_saves where id=(select save_id from pg_temp.fixture)),2::bigint,'supply use advances the save revision once');
select is((public.use_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000031',1,'road-provisions',(select id from pg_temp.quest)
)->>'committedRevision'),'2','exact supply-use retry returns the saved result');
select throws_ok($$select public.use_generated_supply(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000032',2,'road-provisions','15700000-0000-4000-8000-000000000099'
)$$,'PT422',null,'an unknown successor quest cannot receive supply progress');
reset role;

update public.tavern_saves set day_minigame_completed=true where id=(select save_id from pg_temp.fixture);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
create temporary table pg_temp.day_result(result jsonb);
grant select,insert on pg_temp.day_result to authenticated;
insert into pg_temp.day_result
select public.advance_tavern_day(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000033',2
);
select is((select current_day from public.tavern_saves where id=(select save_id from pg_temp.fixture)),2,'day closing succeeds after generated supply use');
select is((public.world_generated_shop_projection((select save_id from pg_temp.fixture))#>>'{catalog,0,remainingStock}'),'3','a committed new day resets generated stock');
reset role;
update private.world_generated_supply_stock
set remaining_quantity=1
where save_id=(select save_id from pg_temp.fixture)
  and canonical_entity_id=(select supply_entity_id from pg_temp.fixture);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='15700000-0000-4000-8000-000000000001';
select is((public.advance_tavern_day(
  (select save_id from pg_temp.fixture),'15700000-0000-4000-8000-000000000033',2
)->>'newDay'),'2','exact day-close retry returns the original result');
select is((public.world_generated_shop_projection((select save_id from pg_temp.fixture))#>>'{catalog,0,remainingStock}'),'1','day-close replay does not reset stock a second time');
reset role;

select * from finish();
rollback;
