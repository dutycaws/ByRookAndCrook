-- Durable authored quest trinkets. Reward selection is content; effect strength
-- and arithmetic remain game-owned in this catalog.
begin;

create table private.trinket_effect_catalog (
  catalog_id text primary key check (catalog_id in ('food_revenue','drink_revenue','harvest_quality')),
  effect_kind text not null check (effect_kind in ('food_revenue','drink_revenue','harvest_quality')),
  bonus_basis_points integer not null default 0 check (bonus_basis_points between 0 and 10000),
  bonus_quality smallint not null default 0 check (bonus_quality between 0 and 6),
  check (
    (effect_kind in ('food_revenue','drink_revenue') and bonus_basis_points > 0 and bonus_quality = 0)
    or (effect_kind = 'harvest_quality' and bonus_basis_points = 0 and bonus_quality > 0)
  )
);

insert into private.trinket_effect_catalog(catalog_id,effect_kind,bonus_basis_points,bonus_quality)
values
  ('food_revenue','food_revenue',500,0),
  ('drink_revenue','drink_revenue',500,0),
  ('harvest_quality','harvest_quality',0,1);

create table private.world_owned_trinkets (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  source_instance_id uuid not null references private.world_npc_instances(id) on delete restrict,
  source_npc_id uuid not null references private.npc_identities(id) on delete restrict,
  source_version_id uuid not null references private.npc_versions(id) on delete restrict,
  source_quest_id uuid not null references private.world_quests(id) on delete restrict,
  source_event_id uuid not null references private.world_quest_events(id) on delete restrict,
  source_milestone_key text not null check (length(source_milestone_key) between 1 and 80),
  catalog_id text not null references private.trinket_effect_catalog(catalog_id),
  artwork_id text not null check (artwork_id in ('copper-leaf','brass-seal','seed-glass')),
  name text not null check (length(btrim(name)) between 1 and 80),
  dedication text not null check (length(btrim(dedication)) between 20 and 500),
  active_slot smallint check (active_slot between 0 and 3),
  earned_at timestamptz not null default clock_timestamp(),
  unique(save_id,id),
  unique(save_id,source_instance_id,source_milestone_key),
  unique(source_event_id)
);
create unique index world_owned_trinkets_one_per_active_slot
  on private.world_owned_trinkets(save_id,active_slot) where active_slot is not null;
create index world_owned_trinkets_collection_order
  on private.world_owned_trinkets(save_id,active_slot,earned_at,id);

create table private.world_quest_trinket_grant_receipts (
  source_event_id uuid primary key references private.world_quest_events(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  source_instance_id uuid not null references private.world_npc_instances(id) on delete restrict,
  source_quest_id uuid not null references private.world_quests(id) on delete restrict,
  trinket_id uuid references private.world_owned_trinkets(id) on delete restrict,
  status text not null check (status in ('granted','already_granted','not_applicable')),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(),
  check ((status='not_applicable')=(trinket_id is null))
);

alter table private.trinket_effect_catalog enable row level security;
alter table private.world_owned_trinkets enable row level security;
alter table private.world_quest_trinket_grant_receipts enable row level security;
revoke all on table private.trinket_effect_catalog,private.world_owned_trinkets,private.world_quest_trinket_grant_receipts from public,anon,authenticated,service_role;

create function private.world_owned_trinket_json(p_trinket_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'id',item.id,
    'sourceNpcId',item.source_npc_id,
    'sourceMilestoneId',item.source_milestone_key,
    'catalogId',item.catalog_id,
    'artworkId',item.artwork_id,
    'name',item.name,
    'dedication',item.dedication,
    'slot',item.active_slot,
    'earnedAt',item.earned_at
  )
  from private.world_owned_trinkets item
  where item.id=p_trinket_id
$function$;

create function private.trinket_collection(p_save_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare collection jsonb;
begin
  if p_save_id is null or auth.uid() is null then return '[]'::jsonb; end if;
  if not exists(select 1 from public.tavern_saves save_row where save_row.id=p_save_id and save_row.user_id=auth.uid()) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(private.world_owned_trinket_json(item.id)
    order by item.active_slot nulls last,item.earned_at,item.id),'[]'::jsonb)
    into collection
  from private.world_owned_trinkets item
  where item.save_id=p_save_id;
  return collection;
end
$function$;

create function private.trinket_effect_totals(p_save_id uuid)
returns table(food_revenue_basis_points integer,drink_revenue_basis_points integer,harvest_quality smallint)
language sql stable security definer set search_path = '' as $function$
  select
    coalesce(sum(effect.bonus_basis_points) filter (where effect.effect_kind='food_revenue'),0)::integer,
    coalesce(sum(effect.bonus_basis_points) filter (where effect.effect_kind='drink_revenue'),0)::integer,
    coalesce(sum(effect.bonus_quality) filter (where effect.effect_kind='harvest_quality'),0)::smallint
  from private.world_owned_trinkets item
  join private.trinket_effect_catalog effect on effect.catalog_id=item.catalog_id
  where item.save_id=p_save_id and item.active_slot is not null
    and (
      auth.role()='service_role'
      or exists (
        select 1 from public.tavern_saves save_row
        where save_row.id=p_save_id and save_row.user_id=auth.uid()
      )
    )
$function$;

create function private.world_grant_initial_quest_trinket(p_quest_id uuid,p_terminal_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  quest_row private.world_quests;
  event_row private.world_quest_events;
  resident private.world_npc_instances;
  save_row public.tavern_saves;
  version_sheet jsonb;
  reward jsonb;
  milestone_key text;
  effect_row private.trinket_effect_catalog;
  trinket_row private.world_owned_trinkets;
  slot_number smallint;
  receipt private.world_quest_trinket_grant_receipts;
  response jsonb;
  status_value text;
begin
  if p_quest_id is null or p_terminal_event_id is null then
    raise sqlstate 'PT400' using message='Quest and terminal event are required';
  end if;

  select * into quest_row from private.world_quests where id=p_quest_id for update;
  if not found then raise sqlstate 'PT404' using message='Quest not found'; end if;
  select * into save_row from public.tavern_saves where id=quest_row.save_id for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into receipt from private.world_quest_trinket_grant_receipts where source_event_id=p_terminal_event_id;
  if found then
    if receipt.source_quest_id<>p_quest_id then raise sqlstate 'PT409' using message='Terminal event was already used for another quest'; end if;
    return receipt.result;
  end if;

  select * into event_row from private.world_quest_events
    where id=p_terminal_event_id and quest_id=p_quest_id for update;
  if not found or quest_row.terminal_event_id is distinct from p_terminal_event_id
    or quest_row.state<>'succeeded' or event_row.action<>'attempt' or event_row.outcome<>'succeeded' then
    return jsonb_build_object('status','not_applicable','trinket',null);
  end if;
  if quest_row.origin<>'authored_milestone' or quest_row.authored_milestone_index<>0 then
    return jsonb_build_object('status','not_applicable','trinket',null);
  end if;

  select sheet into version_sheet from private.npc_versions where id=quest_row.version_id;
  if not found then raise sqlstate 'PT404' using message='Resident version not found'; end if;
  milestone_key:=version_sheet#>>'{campaign,milestones,0,id}';
  if milestone_key is null or milestone_key<>quest_row.authored_milestone_key then
    return jsonb_build_object('status','not_applicable','trinket',null);
  end if;

  reward:=version_sheet#>'{campaign,initialQuestTrinket}';
  if reward is null or jsonb_typeof(reward)='null' then
    response:=jsonb_build_object('status','not_applicable','trinket',null);
    insert into private.world_quest_trinket_grant_receipts(source_event_id,save_id,source_instance_id,source_quest_id,trinket_id,status,result)
    values(p_terminal_event_id,quest_row.save_id,quest_row.instance_id,quest_row.id,null,'not_applicable',response);
    return response;
  end if;
  if jsonb_typeof(reward)<>'object' or exists(
      select 1 from jsonb_object_keys(reward) as reward_key(key)
      where reward_key.key not in ('catalogId','artworkId','name','dedication'))
    or not (reward ?& array['catalogId','artworkId','name','dedication'])
    or jsonb_typeof(reward->'catalogId') is distinct from 'string'
    or jsonb_typeof(reward->'artworkId') is distinct from 'string'
    or jsonb_typeof(reward->'name') is distinct from 'string'
    or jsonb_typeof(reward->'dedication') is distinct from 'string'
    or length(btrim(coalesce(reward->>'name',''))) not between 1 and 80
    or length(btrim(coalesce(reward->>'dedication',''))) not between 20 and 500 then
    raise sqlstate 'PT422' using message='Authored trinket reward is outside the supported contract';
  end if;
  select * into effect_row from private.trinket_effect_catalog where catalog_id=reward->>'catalogId';
  if not found or reward->>'artworkId' not in ('copper-leaf','brass-seal','seed-glass') then
    raise sqlstate 'PT422' using message='Authored trinket reward selects unsupported content';
  end if;
  select * into resident from private.world_npc_instances
  where id=quest_row.instance_id and save_id=quest_row.save_id for update;
  if not found or resident.version_id<>quest_row.version_id then raise sqlstate 'PT404' using message='Resident not found'; end if;
  select slots.slot::smallint into slot_number from generate_series(0,3) as slots(slot)
  where not exists(select 1 from private.world_owned_trinkets item where item.save_id=quest_row.save_id and item.active_slot=slots.slot)
  order by slots.slot limit 1;

  insert into private.world_owned_trinkets(save_id,source_instance_id,source_npc_id,source_version_id,source_quest_id,source_event_id,
    source_milestone_key,catalog_id,artwork_id,name,dedication,active_slot)
  values(quest_row.save_id,quest_row.instance_id,resident.npc_id,quest_row.version_id,quest_row.id,p_terminal_event_id,
    milestone_key,reward->>'catalogId',reward->>'artworkId',reward->>'name',reward->>'dedication',slot_number)
  on conflict(save_id,source_instance_id,source_milestone_key) do nothing
  returning * into trinket_row;
  if found then
    status_value:='granted';
  else
    select * into trinket_row from private.world_owned_trinkets
    where save_id=quest_row.save_id and source_instance_id=quest_row.instance_id and source_milestone_key=milestone_key;
    status_value:='already_granted';
  end if;
  response:=jsonb_build_object('status',status_value,'trinket',private.world_owned_trinket_json(trinket_row.id));
  insert into private.world_quest_trinket_grant_receipts(source_event_id,save_id,source_instance_id,source_quest_id,trinket_id,status,result)
  values(p_terminal_event_id,quest_row.save_id,quest_row.instance_id,quest_row.id,trinket_row.id,status_value,response)
  on conflict(source_event_id) do nothing;
  select * into receipt from private.world_quest_trinket_grant_receipts where source_event_id=p_terminal_event_id;
  return receipt.result;
end
$function$;

revoke all on function private.world_owned_trinket_json(uuid),private.trinket_collection(uuid),private.trinket_effect_totals(uuid),private.world_grant_initial_quest_trinket(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.trinket_collection(uuid),private.trinket_effect_totals(uuid) to authenticated,service_role;
grant execute on function private.world_grant_initial_quest_trinket(uuid,uuid) to service_role;

commit;
