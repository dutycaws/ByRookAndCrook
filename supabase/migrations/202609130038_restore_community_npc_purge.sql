-- Restore full player-visible history removal after the portrait migration
-- replaced this function with a resident-status-only implementation.
begin;

create or replace function public.npc_admin_quarantine_or_purge(
  p_npc uuid,
  p_purge boolean,
  p_reason text
) returns void language plpgsql security definer set search_path='' as $$
declare v_reason text;
begin
  perform private.assert_npc_reviewer(p_npc);
  if length(trim(p_reason))<3 then raise sqlstate 'PT400'; end if;

  v_reason:=case when p_purge then 'banned' else 'quarantined' end;

  -- Preserve the portrait lifecycle introduced in migration 037 before the
  -- shared purge helper redacts all author-facing asset storage keys.
  update private.npc_assets
    set media_state=case when p_purge then 'purged' else 'quarantined' end,
        purged_at=case when p_purge then now() else purged_at end
    where npc_id=p_npc and kind='portrait' and media_state<>'purged';

  perform private.npc_purge_visible_history(p_npc,v_reason);

  update private.npc_identities
    set status=case when p_purge then 'banned' else 'paused' end,
        purged_at=case when p_purge then now() else purged_at end,
        updated_at=now()
    where id=p_npc;
end $$;

revoke all on function public.npc_admin_quarantine_or_purge(uuid,boolean,text) from public,anon;
grant execute on function public.npc_admin_quarantine_or_purge(uuid,boolean,text) to authenticated;

commit;
