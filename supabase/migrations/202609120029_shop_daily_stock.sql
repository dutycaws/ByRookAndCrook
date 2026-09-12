-- Per-save daily Shop stock.  The catalog remains versioned; this table is the
-- mutable ledger that prevents one tavern's purchases from affecting another.
begin;

create table public.garden_shop_stock (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  rules_version text not null,
  item_key text not null,
  daily_cap integer not null check (daily_cap between 1 and 20),
  remaining_quantity integer not null check (remaining_quantity between 0 and daily_cap),
  restock_day integer not null check (restock_day > 0),
  updated_at timestamptz not null default now(),
  primary key (save_id,item_key),
  foreign key (rules_version,item_key)
    references public.garden_item_catalog(rules_version,item_key)
);

create index garden_shop_stock_save_idx on public.garden_shop_stock(save_id);
alter table public.garden_shop_stock enable row level security;
create policy garden_shop_stock_read_own on public.garden_shop_stock for select to authenticated using (
  exists (select 1 from public.tavern_saves s where s.id=garden_shop_stock.save_id and s.user_id=(select auth.uid()))
);
revoke all on public.garden_shop_stock from public,anon,authenticated;
grant select on public.garden_shop_stock to authenticated;
grant all on public.garden_shop_stock to service_role;

create function private.garden_shop_daily_cap(p_item_key text)
returns integer language sql immutable set search_path='' as $$
  select case
    when p_item_key like 'seed_%' then 10
    when p_item_key in ('amendment_n','amendment_p','amendment_k','soil_builder') then 5
    when p_item_key='bee_feed' then 10
    when p_item_key like 'treatment_%' then 3
    when p_item_key in ('hive_equipment','replacement_colony') then 1
    else null
  end
$$;

create function private.ensure_garden_shop_stock(p_save_id uuid,p_restock_day integer,p_reset boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_rules text;
begin
  select garden_rules_version into v_rules from public.tavern_saves where id=p_save_id;
  if v_rules is null then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  insert into public.garden_shop_stock(save_id,rules_version,item_key,daily_cap,remaining_quantity,restock_day)
  select p_save_id,c.rules_version,c.item_key,private.garden_shop_daily_cap(c.item_key),
    private.garden_shop_daily_cap(c.item_key),p_restock_day
  from public.garden_item_catalog c
  where c.rules_version=v_rules and private.garden_shop_daily_cap(c.item_key) is not null
  on conflict(save_id,item_key) do update set
    rules_version=excluded.rules_version,
    daily_cap=excluded.daily_cap,
    remaining_quantity=case when p_reset then excluded.daily_cap else public.garden_shop_stock.remaining_quantity end,
    restock_day=case when p_reset then excluded.restock_day else public.garden_shop_stock.restock_day end,
    updated_at=case when p_reset then now() else public.garden_shop_stock.updated_at end;
end;
$$;

-- Backfill every existing save without altering their current inventory or gold.
do $$ declare v_save record; begin
  for v_save in select id,current_day from public.tavern_saves loop
    perform private.ensure_garden_shop_stock(v_save.id,v_save.current_day,false);
  end loop;
end $$;

alter function public.create_tavern() rename to create_tavern_before_shop_stock;
alter function public.create_tavern_before_shop_stock() set schema private;
create function public.create_tavern() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; begin
  v_result:=private.create_tavern_before_shop_stock();
  perform private.ensure_garden_shop_stock((v_result->>'saveId')::uuid,1,false);
  return v_result;
end;
$$;

alter function public.preview_garden_command(text,jsonb) rename to preview_garden_command_before_shop_stock;
alter function public.preview_garden_command_before_shop_stock(text,jsonb) set schema private;
create function public.preview_garden_command(p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_save public.tavern_saves; v_stock public.garden_shop_stock;
  v_quantity integer; v_cost integer; v_reasons jsonb:='[]'::jsonb;
begin
  v_result:=private.preview_garden_command_before_shop_stock(p_command_kind,p_payload);
  if p_command_kind<>'purchase' or v_result is null then return v_result; end if;
  select * into v_save from public.tavern_saves where user_id=auth.uid();
  v_quantity:=(v_result#>>'{normalizedPayload,quantity}')::integer;
  select * into v_stock from public.garden_shop_stock
    where save_id=v_save.id and item_key=v_result#>>'{normalizedPayload,itemKey}';
  if not found then raise sqlstate 'PT422' using message='That item is not stocked today'; end if;
  v_cost:=(v_result->>'goldCost')::integer;
  if v_save.gold<v_cost then v_reasons:=v_reasons||jsonb_build_array('insufficient_gold'); end if;
  if v_stock.remaining_quantity=0 then v_reasons:=v_reasons||jsonb_build_array('depleted_stock');
  elsif v_quantity>v_stock.remaining_quantity then v_reasons:=v_reasons||jsonb_build_array('quantity_exceeds_stock'); end if;
  return v_result||jsonb_build_object(
    'dailyCap',v_stock.daily_cap,'remainingStock',v_stock.remaining_quantity,
    'restockDay',case when v_stock.remaining_quantity<v_stock.daily_cap then v_save.current_day+1 else v_stock.restock_day end,
    'requestedQuantity',v_quantity,'maxQuantity',least(20,v_stock.remaining_quantity),
    'goldDeficit',greatest(0,v_cost-v_save.gold),'blockingReasons',v_reasons,
    'status',case when jsonb_array_length(v_reasons)=0 then 'ready'
      when v_reasons ? 'insufficient_gold' then 'insufficient_gold'
      when v_reasons ? 'depleted_stock' then 'sold_out' else 'exceeds_stock' end,
    'canCommit',jsonb_array_length(v_reasons)=0);
end;
$$;

alter function public.garden_command(uuid,uuid,bigint,text,jsonb) rename to garden_command_before_shop_stock;
alter function public.garden_command_before_shop_stock(uuid,uuid,bigint,text,jsonb) set schema private;
create function public.garden_command(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_command_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_save public.tavern_saves; v_prior public.garden_actions;
  v_item public.garden_item_catalog; v_stock public.garden_shop_stock; v_payload jsonb;
  v_quantity integer; v_cost integer; v_result jsonb;
begin
  if p_command_kind<>'purchase' then
    return private.garden_command_before_shop_stock(p_save_id,p_action_id,p_expected_revision,p_command_kind,p_payload);
  end if;
  if v_actor is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload)<>'object' then
    raise sqlstate 'PT400' using message='Invalid garden command'; end if;
  v_payload:=private.canonical_garden_payload('purchase',p_payload);
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=v_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into v_prior from public.garden_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_prior.command_kind='purchase' and v_prior.input_payload=v_payload and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for a different request';
  end if;
  if v_save.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Garden state changed; refresh before acting'; end if;
  v_quantity:=(v_payload->>'quantity')::integer;
  if v_quantity<1 or v_quantity>20 then raise sqlstate 'PT400' using message='Purchase quantity must be between 1 and 20'; end if;
  select * into v_item from public.garden_item_catalog where rules_version=v_save.garden_rules_version and item_key=v_payload->>'itemKey';
  if not found then raise sqlstate 'PT422' using message='Garden item not found'; end if;
  select * into v_stock from public.garden_shop_stock where save_id=p_save_id and item_key=v_item.item_key for update;
  if not found then raise sqlstate 'PT422' using message='That item is not stocked today'; end if;
  if v_stock.remaining_quantity=0 then raise sqlstate 'PT422' using message='That item is out of stock'; end if;
  if v_quantity>v_stock.remaining_quantity then raise sqlstate 'PT422' using message='Only '||v_stock.remaining_quantity||' left in stock'; end if;
  v_cost:=v_item.price*v_quantity;
  if v_save.gold<v_cost then raise sqlstate 'PT422' using message='Not enough gold'; end if;
  update public.garden_shop_stock set remaining_quantity=remaining_quantity-v_quantity,updated_at=now()
    where save_id=p_save_id and item_key=v_item.item_key;
  update public.tavern_saves set gold=gold-v_cost where id=p_save_id;
  insert into public.garden_inventory(save_id,item_key,rules_version,quantity) values(p_save_id,v_item.item_key,v_save.garden_rules_version,v_quantity)
    on conflict(save_id,item_key) do update set quantity=public.garden_inventory.quantity+excluded.quantity,updated_at=now();
  v_result:=jsonb_build_object('actionId',p_action_id,'commandKind','purchase','committedRevision',v_save.revision+1,
    'rulesVersion',v_save.garden_rules_version,'normalizedPayload',v_payload,'result',jsonb_build_object(
      'itemKey',v_item.item_key,'quantity',v_quantity,'goldSpent',v_cost,
      'previousGold',v_save.gold,'goldBalance',v_save.gold-v_cost,
      'previousStock',v_stock.remaining_quantity,'remainingStock',v_stock.remaining_quantity-v_quantity,
      'dailyCap',v_stock.daily_cap,'restockDay',v_save.current_day+1));
  insert into public.garden_actions(save_id,action_id,actor_id,command_kind,input_payload,input_expected_revision,rules_version,result,committed_revision)
    values(p_save_id,p_action_id,v_actor,'purchase',v_payload,p_expected_revision,v_save.garden_rules_version,v_result,v_save.revision+1);
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=p_save_id;
  return v_result;
end;
$$;

alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_shop_stock;
alter function public.advance_tavern_day_before_shop_stock(uuid,uuid,bigint) set schema private;
create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_result jsonb; v_new_day integer;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  select * into v_save from public.tavern_saves where id=p_save_id and user_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into v_prior from public.craft_actions where save_id=p_save_id and action_id=p_action_id;
  if found then
    if v_prior.command_kind='advance_day' and v_prior.input_expected_revision=p_expected_revision then return v_prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier already used';
  end if;
  v_result:=private.advance_tavern_day_before_shop_stock(p_save_id,p_action_id,p_expected_revision);
  v_new_day:=(v_result->>'newDay')::integer;
  perform private.ensure_garden_shop_stock(p_save_id,v_new_day,true);
  return v_result;
end;
$$;

alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_shop_stock;
alter function public.get_tavern_snapshot_before_shop_stock() set schema private;
create function public.get_tavern_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_save public.tavern_saves;
begin
  v_result:=private.get_tavern_snapshot_before_shop_stock();
  if v_result is null then return null; end if;
  select * into strict v_save from public.tavern_saves where id=(v_result#>>'{save,id}')::uuid and user_id=auth.uid();
  return jsonb_set(v_result,'{garden,shop}',coalesce((select jsonb_agg(jsonb_build_object(
    'itemKey',c.item_key,'name',c.display_name,'kind',c.item_kind,'price',c.price,'effect',c.effect,
    'dailyCap',s.daily_cap,'remainingStock',s.remaining_quantity,
    'restockDay',case when s.remaining_quantity<s.daily_cap then v_save.current_day+1 else s.restock_day end
  ) order by c.item_kind,c.item_key)
  from public.garden_item_catalog c join public.garden_shop_stock s on s.save_id=v_save.id and s.item_key=c.item_key
  where c.rules_version=v_save.garden_rules_version),'[]'::jsonb),true);
end;
$$;

revoke all on function private.garden_shop_daily_cap(text),private.ensure_garden_shop_stock(uuid,integer,boolean),
  private.create_tavern_before_shop_stock(),private.preview_garden_command_before_shop_stock(text,jsonb),
  private.garden_command_before_shop_stock(uuid,uuid,bigint,text,jsonb),
  private.advance_tavern_day_before_shop_stock(uuid,uuid,bigint),private.get_tavern_snapshot_before_shop_stock() from public,anon,authenticated;
revoke all on function public.create_tavern(),public.preview_garden_command(text,jsonb),public.garden_command(uuid,uuid,bigint,text,jsonb),public.advance_tavern_day(uuid,uuid,bigint),public.get_tavern_snapshot() from public,anon;
grant execute on function public.create_tavern(),public.preview_garden_command(text,jsonb),public.garden_command(uuid,uuid,bigint,text,jsonb),public.advance_tavern_day(uuid,uuid,bigint),public.get_tavern_snapshot() to authenticated;

commit;
