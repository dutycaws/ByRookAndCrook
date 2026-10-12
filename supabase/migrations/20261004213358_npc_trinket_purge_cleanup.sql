-- Explicit NPC content removal must also remove that author's quest keepsake
-- copy and the idempotency receipts that contain or refer to it. Ordinary
-- departure only updates resident status and never enters this delete path.
begin;

create or replace function private.world_trinket_swap_receipt_guard()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='DELETE' and current_setting('app.npc_purge',true)='on' then
    return old;
  end if;
  raise exception using errcode='55000',message='Trinket swap receipts are append-only';
end
$function$;

create function private.world_quest_trinket_grant_receipt_guard()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='DELETE' and current_setting('app.npc_purge',true)='on' then
    return old;
  end if;
  raise exception using errcode='55000',message='Quest trinket grant receipts are append-only';
end
$function$;

create trigger world_quest_trinket_grant_receipt_append_only
  before update or delete on private.world_quest_trinket_grant_receipts
  for each row execute function private.world_quest_trinket_grant_receipt_guard();

-- Mature-content and moderator purges delete residents directly through the
-- existing transaction-local app.npc_purge boundary. Other paths remain
-- subject to the repository's existing durable-history deletion protections.
create function private.world_npc_purge_trinkets_before_delete()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if current_setting('app.npc_purge',true) is distinct from 'on' then
    return old;
  end if;

  delete from private.world_quest_trinket_grant_receipts
    where source_instance_id=old.id;
  delete from private.world_trinket_swap_receipts receipt
    using private.world_owned_trinkets item
    where item.source_instance_id=old.id
      and receipt.save_id=item.save_id
      and receipt.trinket_id=item.id;
  delete from private.world_owned_trinkets
    where source_instance_id=old.id;
  return old;
end
$function$;

create trigger world_npc_purge_trinkets_before_delete
  before delete on private.world_npc_instances
  for each row execute function private.world_npc_purge_trinkets_before_delete();

revoke all on function private.world_quest_trinket_grant_receipt_guard(),
  private.world_npc_purge_trinkets_before_delete()
  from public,anon,authenticated,service_role;

commit;
