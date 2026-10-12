-- Free, save-revision-fenced swaps for the four active trinket slots.
begin;

create table private.world_trinket_swap_receipts (
  action_id uuid primary key,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  trinket_id uuid not null,
  target_slot smallint check (target_slot between 0 and 3),
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  status text not null check (status in ('swapped','unchanged')),
  result jsonb not null check (jsonb_typeof(result)='object'),
  committed_revision bigint not null check (committed_revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (save_id,trinket_id) references private.world_owned_trinkets(save_id,id) on delete restrict
);

create function private.world_trinket_swap_receipt_guard()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='Trinket swap receipts are append-only';
end
$function$;
create trigger world_trinket_swap_receipt_append_only
  before update or delete on private.world_trinket_swap_receipts
  for each row execute function private.world_trinket_swap_receipt_guard();

alter table private.world_trinket_swap_receipts enable row level security;
revoke all on table private.world_trinket_swap_receipts from public,anon,authenticated,service_role;

create function public.npc_swap_trinket(
  p_save_id uuid,
  p_trinket_id uuid,
  p_target_slot smallint,
  p_action_id uuid,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  actor_id uuid:=auth.uid();
  save_row public.tavern_saves;
  selected_item private.world_owned_trinkets;
  displaced_item private.world_owned_trinkets;
  prior private.world_trinket_swap_receipts;
  result_value jsonb;
  new_revision bigint;
  status_value text:='unchanged';
begin
  if actor_id is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_save_id is null or p_trinket_id is null or p_action_id is null
     or p_expected_revision is null or p_expected_revision<0
     or (p_target_slot is not null and p_target_slot not between 0 and 3) then
    raise sqlstate 'PT400' using message='Invalid trinket swap';
  end if;

  select * into save_row from public.tavern_saves
    where id=p_save_id and user_id=actor_id for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;

  -- The save lock serializes same-action requests and prevents a retry from
  -- racing the first receipt into a duplicate key or a second slot mutation.
  select * into prior from private.world_trinket_swap_receipts
    where action_id=p_action_id for update;
  if found then
    if prior.save_id<>p_save_id or prior.actor_id<>actor_id or prior.trinket_id<>p_trinket_id
       or prior.target_slot is distinct from p_target_slot
       or prior.input_expected_revision<>p_expected_revision then
      raise sqlstate 'PT409' using message='Action identifier was already used for different input';
    end if;
    return prior.result;
  end if;

  if save_row.revision<>p_expected_revision then
    raise sqlstate 'PT409' using message='Tavern state changed; refresh before swapping keepsakes';
  end if;
  select * into selected_item from private.world_owned_trinkets
    where save_id=p_save_id and id=p_trinket_id for update;
  if not found then raise sqlstate 'PT404' using message='Keepsake not found'; end if;

  if p_target_slot is distinct from selected_item.active_slot then
    if p_target_slot is not null then
      select * into displaced_item from private.world_owned_trinkets
        where save_id=p_save_id and active_slot=p_target_slot and id<>p_trinket_id for update;
    end if;

    -- Clear first so the partial unique index remains valid throughout an
    -- equipped-to-equipped swap. Inventory items displace into the collection.
    update private.world_owned_trinkets set active_slot=null where id=p_trinket_id;
    if found then status_value:='swapped'; end if;
    if displaced_item.id is not null then
      update private.world_owned_trinkets set active_slot=selected_item.active_slot
        where id=displaced_item.id;
    end if;
    if p_target_slot is not null then
      update private.world_owned_trinkets set active_slot=p_target_slot where id=p_trinket_id;
    end if;
    update public.tavern_saves set revision=revision+1,updated_at=clock_timestamp()
      where id=p_save_id returning revision into new_revision;
  else
    new_revision:=save_row.revision;
  end if;

  result_value:=jsonb_build_object('status',status_value,'trinketId',p_trinket_id,
    'targetSlot',p_target_slot,'committedRevision',new_revision);
  insert into private.world_trinket_swap_receipts(action_id,save_id,actor_id,trinket_id,
    target_slot,input_expected_revision,status,result,committed_revision)
  values(p_action_id,p_save_id,actor_id,p_trinket_id,p_target_slot,p_expected_revision,
    status_value,result_value,new_revision);
  return result_value;
end
$function$;

revoke all on function private.world_trinket_swap_receipt_guard(),
  public.npc_swap_trinket(uuid,uuid,smallint,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.npc_swap_trinket(uuid,uuid,smallint,uuid,bigint) to authenticated;

commit;
