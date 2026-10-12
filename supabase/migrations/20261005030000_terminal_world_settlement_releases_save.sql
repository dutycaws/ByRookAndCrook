begin;

-- Terminal settlement failures can leave due quest transitions awaiting. Move
-- those transitions to the next opening before asking the shared opening gate
-- to publish the save, just as deadline expiry does. Live transition leases and
-- any other queued/processing settlement remain authoritative and keep the save
-- frozen.
create function private.world_settlement_release_terminal_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status not in ('completed', 'failed', 'skipped', 'expired') then
    return new;
  end if;

  if new.status in ('failed', 'skipped', 'expired')
    and not exists (
      select 1
      from private.world_settlements settlement
      where settlement.save_id = new.save_id
        and settlement.status in ('queued', 'processing')
    ) then
    update private.world_quest_transitions transition
    set status = 'awaiting',
        processing_started_at = null,
        lease_until = null,
        fence = null,
        next_eligible_day = greatest(
          transition.next_eligible_day,
          (select save.current_day + 1 from public.tavern_saves save where save.id = new.save_id)
        )
    where transition.save_id = new.save_id
      and transition.next_eligible_day <= (
        select save.current_day from public.tavern_saves save where save.id = new.save_id
      )
      and (
        transition.status = 'awaiting'
        or (transition.status = 'processing' and transition.lease_until <= clock_timestamp())
      );
  end if;

  perform private.world_quest_transition_maybe_open(new.save_id);
  return new;
end;
$function$;

revoke all on function private.world_settlement_release_terminal_save()
  from public, anon, authenticated, service_role;

create trigger world_settlement_release_terminal_save
  after update of status on private.world_settlements
  for each row execute function private.world_settlement_release_terminal_save();

-- Repair saves already stranded by a terminal status before this trigger was
-- installed. Replaying the same status is safe: the phase gate remains the
-- authority for all other active settlement and quest-transition work.
update private.world_settlements settlement
set status = settlement.status
where settlement.status in ('completed', 'failed', 'skipped', 'expired')
  and exists (
    select 1
    from public.tavern_saves save
    where save.id = settlement.save_id
      and save.world_phase = 'settling'
  );

commit;
