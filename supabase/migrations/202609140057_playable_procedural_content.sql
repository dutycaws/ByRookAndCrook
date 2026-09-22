-- Issue #17: one finite generated shop-item family.  Canonical proposals can
-- only unlock settlement supplies; players never execute proposal JSON.
begin;

create table private.world_generated_supply_definitions (
  canonical_entity_id uuid primary key references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  price integer not null check (price between 1 and 100),
  daily_stock integer not null check (daily_stock between 1 and 10),
  use_family text not null default 'successor_provisions' check (use_family='successor_provisions'),
  created_at timestamptz not null default clock_timestamp()
);
create table private.world_generated_supply_stock (
  canonical_entity_id uuid primary key references private.world_generated_supply_definitions(canonical_entity_id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  remaining_quantity integer not null check (remaining_quantity between 0 and 10),
  updated_at timestamptz not null default clock_timestamp()
);
create table private.world_generated_supply_inventory (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  canonical_entity_id uuid not null references private.world_generated_supply_definitions(canonical_entity_id) on delete cascade,
  quantity integer not null check (quantity >= 0 and quantity <= 999),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(save_id,canonical_entity_id)
);
create table private.world_generated_supply_actions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action_kind text not null check(action_kind in ('purchase','use')),
  input_payload jsonb not null check(jsonb_typeof(input_payload)='object'),
  expected_revision bigint not null check(expected_revision >= 0),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(save_id,action_id)
);
create table private.world_generated_supply_uses (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  quest_id uuid not null references private.world_procedural_quests(id) on delete cascade,
  canonical_entity_id uuid not null references private.world_generated_supply_definitions(canonical_entity_id) on delete restrict,
  quantity integer not null check(quantity >= 1 and quantity <= 999),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(save_id,quest_id,canonical_entity_id)
);
create table private.world_generated_supply_receipts (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  proposal_fingerprint text not null check(proposal_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_proposal text not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp()
);
create trigger world_generated_supply_receipts_append_only before update or delete on private.world_generated_supply_receipts for each row execute function private.world_history_append_only();

create function private.world_generated_supply_install(p_save_id uuid,p_entity_id uuid,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entity private.world_canonical_entities; existing private.world_generated_supply_definitions; reused boolean:=false;
begin
  select * into entity from private.world_canonical_entities where id=p_entity_id and save_id=p_save_id and origin='procedural' and lifecycle='active' and entity_kind='item' for update;
  if not found then raise sqlstate 'PT400' using message='Supply unlock must target its active generated item entity'; end if;
  if not private.world_procedural_exact_keys(p_definition,array['displayName','price','dailyStock'])
    or not private.world_procedural_text(p_definition->'displayName',120)
    or jsonb_typeof(p_definition->'price')<>'number'
    or jsonb_typeof(p_definition->'dailyStock')<>'number' then
    raise sqlstate 'PT400' using message='Generated settlement supply definition is invalid';
  end if;
  if (p_definition->>'price')::numeric<>trunc((p_definition->>'price')::numeric)
    or (p_definition->>'dailyStock')::numeric<>trunc((p_definition->>'dailyStock')::numeric)
    or (p_definition->>'price')::numeric not between 1 and 100
    or (p_definition->>'dailyStock')::numeric not between 1 and 10 then
    raise sqlstate 'PT400' using message='Generated settlement supply definition is invalid';
  end if;
  select * into existing from private.world_generated_supply_definitions where canonical_entity_id=p_entity_id;
  if found and (existing.save_id<>p_save_id or existing.display_name<>btrim(p_definition->>'displayName') or existing.price<>(p_definition->>'price')::integer or existing.daily_stock<>(p_definition->>'dailyStock')::integer) then
    raise sqlstate 'PT409' using message='Generated settlement supply conflicts with immutable canonical entity';
  end if;
  if not found then
  insert into private.world_generated_supply_definitions(canonical_entity_id,save_id,display_name,price,daily_stock,use_family)
    values(p_entity_id,p_save_id,btrim(p_definition->>'displayName'),(p_definition->>'price')::integer,(p_definition->>'dailyStock')::integer,'successor_provisions');
  end if;
  reused:=exists(select 1 from private.world_generated_supply_stock where canonical_entity_id=p_entity_id);
  insert into private.world_generated_supply_stock(canonical_entity_id,save_id,remaining_quantity)
  values(p_entity_id,p_save_id,(p_definition->>'dailyStock')::integer) on conflict(canonical_entity_id) do nothing;
  return jsonb_build_object('operation','gameplay_unlock','family','successor_provisions','entityId',p_entity_id,'reused',reused);
end $$;

create function public.world_generated_shop_projection(p_save_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare quest jsonb;
begin
  if not exists(select 1 from public.tavern_saves where id=p_save_id and user_id=auth.uid()) then raise sqlstate 'PT404' using message='Generated shop content not found'; end if;
  select jsonb_build_object('questId',q.id,'state',q.state,'suppliesUsed',coalesce((select sum(u.quantity) from private.world_generated_supply_uses u where u.save_id=p_save_id and u.quest_id=q.id),0),'summary','Supplies can be prepared for this successor quest.')
  into quest from private.world_procedural_quests q where q.save_id=p_save_id and q.state='active' and q.primitive_key='successor-quest' order by q.started_day,q.id limit 1;
  return jsonb_build_object('version','generated-shop-v1',
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('entityId',d.canonical_entity_id,'itemKey',e.entity_key,'name',d.display_name,'price',d.price,'dailyStock',d.daily_stock,'remainingStock',s.remaining_quantity) order by d.display_name,d.canonical_entity_id)
      from private.world_generated_supply_definitions d join private.world_generated_supply_stock s on s.canonical_entity_id=d.canonical_entity_id join private.world_canonical_entities e on e.id=d.canonical_entity_id
      where d.save_id=p_save_id and e.lifecycle='active'),'[]'::jsonb),
    'inventory',coalesce((select jsonb_agg(jsonb_build_object('entityId',i.canonical_entity_id,'itemKey',e.entity_key,'name',d.display_name,'quantity',i.quantity) order by d.display_name,i.canonical_entity_id)
      from private.world_generated_supply_inventory i join private.world_generated_supply_definitions d on d.canonical_entity_id=i.canonical_entity_id join private.world_canonical_entities e on e.id=i.canonical_entity_id
      where i.save_id=p_save_id and i.quantity>0 and e.lifecycle='active'),'[]'::jsonb),
    'successorQuest',quest);
end $$;

create function public.purchase_generated_supply(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_item_key text,p_quantity integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); save_row public.tavern_saves; definition private.world_generated_supply_definitions; stock private.world_generated_supply_stock; prior private.world_generated_supply_actions; payload jsonb; cost integer; result jsonb;
begin
  if actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0 or p_item_key !~ '^[a-z][a-z0-9-]{1,79}$' or p_quantity not between 1 and 10 then raise sqlstate 'PT400' using message='Generated supply purchase is invalid'; end if;
  payload:=jsonb_build_object('itemKey',p_item_key,'quantity',p_quantity);
  select * into save_row from public.tavern_saves where id=p_save_id and user_id=actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into prior from private.world_generated_supply_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if prior.action_kind='purchase' and prior.input_payload=payload and prior.expected_revision=p_expected_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if save_row.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before acting'; end if;
  select d.* into definition from private.world_generated_supply_definitions d join private.world_canonical_entities e on e.id=d.canonical_entity_id where d.save_id=p_save_id and e.entity_key=p_item_key and e.lifecycle='active' for update;
  if not found then raise sqlstate 'PT422' using message='That generated supply is unavailable'; end if;
  select * into stock from private.world_generated_supply_stock where canonical_entity_id=definition.canonical_entity_id and save_id=p_save_id for update;
  if not found or stock.remaining_quantity<p_quantity then raise sqlstate 'PT422' using message='That generated supply is out of stock'; end if;
  cost:=definition.price*p_quantity;
  if save_row.gold<cost then raise sqlstate 'PT422' using message='Not enough gold'; end if;
  update private.world_generated_supply_stock set remaining_quantity=remaining_quantity-p_quantity,updated_at=clock_timestamp() where canonical_entity_id=definition.canonical_entity_id;
  update public.tavern_saves set gold=gold-cost,revision=revision+1,updated_at=clock_timestamp() where id=p_save_id;
  insert into private.world_generated_supply_inventory(save_id,canonical_entity_id,quantity) values(p_save_id,definition.canonical_entity_id,p_quantity) on conflict(save_id,canonical_entity_id) do update set quantity=private.world_generated_supply_inventory.quantity+excluded.quantity,updated_at=clock_timestamp();
  result:=jsonb_build_object('actionId',p_action_id,'itemKey',p_item_key,'quantity',p_quantity,'goldSpent',cost,'goldBalance',save_row.gold-cost,'committedRevision',save_row.revision+1);
  insert into private.world_generated_supply_actions(save_id,action_id,actor_id,action_kind,input_payload,expected_revision,result) values(p_save_id,p_action_id,actor,'purchase',payload,p_expected_revision,result);
  return result;
end $$;

create function public.use_generated_supply(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_item_key text,p_quest_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); save_row public.tavern_saves; definition private.world_generated_supply_definitions; inventory private.world_generated_supply_inventory; prior private.world_generated_supply_actions; payload jsonb; result jsonb;
begin
  if actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0 or p_item_key !~ '^[a-z][a-z0-9-]{1,79}$' or p_quest_id is null then raise sqlstate 'PT400' using message='Generated supply use is invalid'; end if;
  payload:=jsonb_build_object('itemKey',p_item_key,'questId',p_quest_id);
  select * into save_row from public.tavern_saves where id=p_save_id and user_id=actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into prior from private.world_generated_supply_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if prior.action_kind='use' and prior.input_payload=payload and prior.expected_revision=p_expected_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if save_row.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before acting'; end if;
  if not exists(select 1 from private.world_procedural_quests where id=p_quest_id and save_id=p_save_id and state='active' and primitive_key='successor-quest') then raise sqlstate 'PT422' using message='That successor quest is no longer active'; end if;
  select d.* into definition from private.world_generated_supply_definitions d join private.world_canonical_entities e on e.id=d.canonical_entity_id where d.save_id=p_save_id and e.entity_key=p_item_key and e.lifecycle='active';
  if not found then raise sqlstate 'PT422' using message='That generated supply is unavailable'; end if;
  select * into inventory from private.world_generated_supply_inventory where save_id=p_save_id and canonical_entity_id=definition.canonical_entity_id for update;
  if not found or inventory.quantity<1 then raise sqlstate 'PT422' using message='That generated supply is not in your inventory'; end if;
  update private.world_generated_supply_inventory set quantity=quantity-1,updated_at=clock_timestamp() where save_id=p_save_id and canonical_entity_id=definition.canonical_entity_id;
  insert into private.world_generated_supply_uses(save_id,quest_id,canonical_entity_id,quantity) values(p_save_id,p_quest_id,definition.canonical_entity_id,1) on conflict(save_id,quest_id,canonical_entity_id) do update set quantity=private.world_generated_supply_uses.quantity+1,updated_at=clock_timestamp();
  update public.tavern_saves set revision=revision+1,updated_at=clock_timestamp() where id=p_save_id;
  result:=jsonb_build_object('actionId',p_action_id,'itemKey',p_item_key,'questId',p_quest_id,'quantityUsed',1,'committedRevision',save_row.revision+1);
  insert into private.world_generated_supply_actions(save_id,action_id,actor_id,action_kind,input_payload,expected_revision,result) values(p_save_id,p_action_id,actor,'use',payload,p_expected_revision,result);
  return result;
end $$;

-- Settlement supplies are deliberately the only generated stock that follows
-- the established day boundary. Their finite cap resets after a successful
-- existing day advance, inside that same transaction.
alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_generated_supplies;
alter function public.advance_tavern_day_before_generated_supplies(uuid,uuid,bigint) set schema private;
create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; exact_replay boolean:=false;
begin
  select exists(
    select 1 from public.craft_actions
    where save_id=p_save_id and action_id=p_action_id
      and command_kind='advance_day' and input_expected_revision=p_expected_revision
  ) into exact_replay;
  result:=private.advance_tavern_day_before_generated_supplies(p_save_id,p_action_id,p_expected_revision);
  if not exact_replay then
    update private.world_generated_supply_stock stock set remaining_quantity=definition.daily_stock,updated_at=clock_timestamp()
    from private.world_generated_supply_definitions definition join private.world_canonical_entities entity on entity.id=definition.canonical_entity_id
    where stock.canonical_entity_id=definition.canonical_entity_id and stock.save_id=p_save_id and definition.save_id=p_save_id and entity.lifecycle='active';
  end if;
  return result;
end $$;

alter function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) rename to world_settlement_commit_procedural_world_before_supplies;
alter function public.world_settlement_commit_procedural_world_before_supplies(uuid,uuid,uuid,jsonb) set schema private;
create function public.world_settlement_commit_procedural_world(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare canonical text; fingerprint text; prior private.world_generated_supply_receipts; filtered jsonb:='[]'::jsonb; supplies jsonb:='[]'::jsonb; command jsonb; base jsonb; settlement private.world_settlements; target private.world_canonical_entities; owner uuid; capability jsonb; installs jsonb:='[]'::jsonb;
begin
  perform private.world_settlement_assert_service();
  canonical:=private.world_canonical_json(p_proposal); fingerprint:=encode(extensions.digest(canonical,'sha256'),'hex');
  select * into prior from private.world_generated_supply_receipts where job_id=p_job_id;
  if found then
    if prior.proposal_fingerprint=fingerprint and prior.canonical_proposal=canonical then return prior.result || jsonb_build_object('replayed',true); end if;
    raise sqlstate 'PT409' using message='Supply command job already has a different proposal';
  end if;
  if jsonb_typeof(p_proposal)<>'object' or octet_length(p_proposal::text)>12000 or not private.world_procedural_exact_keys(p_proposal,array['version','commands']) or p_proposal->>'version'<>'procedural-world-v1' or jsonb_typeof(p_proposal->'commands')<>'array' or jsonb_array_length(p_proposal->'commands') not between 1 and 8 then raise sqlstate 'PT400' using message='Procedural proposal violates the exact command envelope'; end if;
  for command in select value from jsonb_array_elements(p_proposal->'commands') loop
    if command->>'operation'='gameplay_unlock' and command->>'family'='successor_provisions' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','sourceResidentId','entityRef','family','definition']) or command->>'effectKind'<>'unlock_gameplay' or not private.world_procedural_text(command->'sourceResidentId',128) or not private.world_procedural_text(command->'entityRef',128) then raise sqlstate 'PT400' using message='Settlement supply unlock is malformed'; end if;
      begin owner:=(command->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400' using message='Settlement supply source resident must be a UUID'; end;
      if not exists(select 1 from jsonb_array_elements(p_proposal->'commands') created where created->>'operation'='entity' and created->>'effectKind'='create_entity' and created->>'entityKind'='item' and created->>'sourceResidentId'=command->>'sourceResidentId' and private.world_procedural_key(created->>'entityKey')=private.world_procedural_key(command->>'entityRef')) then raise sqlstate 'PT400' using message='Settlement supply unlock must match its resident-owned item created in this proposal'; end if;
      supplies:=supplies||jsonb_build_array(command);
    else filtered:=filtered||jsonb_build_array(command); end if;
  end loop;
  if jsonb_array_length(supplies)=0 then return private.world_settlement_commit_procedural_world_before_supplies(p_settlement_id,p_job_id,p_fence,p_proposal); end if;
  select * into settlement from private.world_settlements where id=p_settlement_id for update;
  if not found then raise sqlstate 'PT409' using message='Settlement mismatch'; end if;
  base:=private.world_settlement_commit_procedural_world_before_supplies(p_settlement_id,p_job_id,p_fence,jsonb_build_object('version','procedural-world-v1','commands',filtered));
  for command in select value from jsonb_array_elements(supplies) loop
    owner:=(command->>'sourceResidentId')::uuid;
    capability:=(select input_snapshot->'capabilities'->(owner::text) from private.world_settlement_jobs where id=p_job_id);
    select * into target from private.world_canonical_entities where save_id=settlement.save_id and entity_kind='item' and entity_key=private.world_procedural_key(command->>'entityRef') for update;
    if capability is null or not (capability->'allowedWorldEffects' ? 'create_entity') or not (capability->'allowedTargetKinds' ? 'item') or target.id is null or target.lifecycle<>'active' or not exists(select 1 from jsonb_array_elements(base->'operations') operation where operation->>'operation'='entity' and operation->>'entityKey'=target.entity_key and coalesce((operation->>'reused')::boolean,true)=false) then raise sqlstate 'PT400' using message='Settlement supply unlock lacks a newly-created frozen canonical item'; end if;
    installs:=installs||jsonb_build_array(private.world_generated_supply_install(settlement.save_id,target.id,command->'definition'));
  end loop;
  base:=base||jsonb_build_object('supplyUnlocks',installs,'replayed',false);
  insert into private.world_generated_supply_receipts(job_id,proposal_fingerprint,canonical_proposal,result) values(p_job_id,fingerprint,canonical,base);
  return base;
end $$;

revoke all on table private.world_generated_supply_definitions,private.world_generated_supply_stock,private.world_generated_supply_inventory,private.world_generated_supply_actions,private.world_generated_supply_uses,private.world_generated_supply_receipts from public,anon,authenticated,service_role;
revoke all on function private.world_generated_supply_install(uuid,uuid,jsonb),private.world_settlement_commit_procedural_world_before_supplies(uuid,uuid,uuid,jsonb),private.advance_tavern_day_before_generated_supplies(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.purchase_generated_supply(uuid,uuid,bigint,text,integer),public.use_generated_supply(uuid,uuid,bigint,text,uuid),public.world_generated_shop_projection(uuid),public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) from public,anon;
revoke all on function public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.purchase_generated_supply(uuid,uuid,bigint,text,integer),public.use_generated_supply(uuid,uuid,bigint,text,uuid),public.world_generated_shop_projection(uuid),public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
grant execute on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) to service_role;
commit;
