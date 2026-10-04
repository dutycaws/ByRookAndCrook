-- Private notifications invalidate the existing player-safe HTTP projection;
-- worker fences, output, and failure details never enter a broadcast payload.
create function private.world_settlement_notify(p_settlement_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select save.user_id into owner_id
  from private.world_settlements settlement
  join public.tavern_saves save on save.id=settlement.save_id
  where settlement.id=p_settlement_id;
  if owner_id is null then return; end if;
  perform realtime.send(
    jsonb_build_object('settlementId',p_settlement_id),
    'settlement_changed', 'settlements:' || owner_id::text, true
  );
end $$;

create function private.world_settlement_notify_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.world_settlement_notify(new.id);
  return null;
end $$;

create function private.world_settlement_job_notify_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    perform private.world_settlement_notify(old.settlement_id);
  else
    perform private.world_settlement_notify(new.settlement_id);
  end if;
  return null;
end $$;

create trigger world_settlement_notify_insert
after insert on private.world_settlements
for each row execute function private.world_settlement_notify_change();
create trigger world_settlement_notify_update
after update on private.world_settlements
for each row when (old.status is distinct from new.status or old.public_digest is distinct from new.public_digest)
execute function private.world_settlement_notify_change();
create trigger world_settlement_job_notify_insert_delete
after insert or delete on private.world_settlement_jobs
for each row execute function private.world_settlement_job_notify_change();
create trigger world_settlement_job_notify_update
after update on private.world_settlement_jobs
for each row when (old.status is distinct from new.status)
execute function private.world_settlement_job_notify_change();

revoke all on function private.world_settlement_notify(uuid),
  private.world_settlement_notify_change(),private.world_settlement_job_notify_change()
from public,anon,authenticated;

create policy settlement_owner_receives_notifications
on realtime.messages for select to authenticated
using (extension='broadcast' and topic=realtime.topic()
  and realtime.topic()='settlements:' || (select auth.uid())::text);
