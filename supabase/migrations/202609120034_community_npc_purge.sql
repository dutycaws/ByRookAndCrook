-- Privacy-first removal for community NPCs.  World tombstones retain only the
-- identity/version reference and removal reason; all player-facing prose and
-- share material is removed with the resident instance.
begin;

create or replace function private.npc_share_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_setting('app.npc_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Conversation shares are immutable';
end $$;

create or replace function private.npc_purge_visible_history(
  p_npc_id uuid,
  p_reason text,
  p_save_id uuid default null
) returns integer language plpgsql security definer set search_path='' as $$
declare
  v_instance_ids uuid[];
  v_count integer := 0;
begin
  if p_reason not in ('mature_purged','quarantined','banned') then
    raise sqlstate 'PT400' using message='Unsupported NPC removal reason';
  end if;

  -- Serialize with removal / day progression for the affected worlds before
  -- collecting the IDs that will be erased.
  perform 1 from public.tavern_saves s
    where (p_save_id is null or s.id=p_save_id)
      and exists (
        select 1 from private.world_npc_instances w
        where w.save_id=s.id and w.npc_id=p_npc_id
      )
    for update;

  select coalesce(array_agg(w.id), '{}'::uuid[]) into v_instance_ids
    from private.world_npc_instances w
    where w.npc_id=p_npc_id and (p_save_id is null or w.save_id=p_save_id);
  v_count := coalesce(array_length(v_instance_ids, 1), 0);

  -- A share is otherwise immutable.  The scoped setting is only observed by
  -- its trigger and exists for this redaction transaction.
  perform set_config('app.npc_purge', 'on', true);
  delete from private.npc_conversation_shares
    where instance_id = any(v_instance_ids);

  -- Reports retain moderation evidence and disposition, but no narrative,
  -- frozen sheet, generated asset metadata, or copied transcript.
  update private.npc_reports r
    set transcript='[]'::jsonb,
        frozen_version=jsonb_build_object(
          'npcId', p_npc_id,
          'versionId', r.version_id,
          'redacted', true
        ),
        generation_metadata='{}'::jsonb
    where r.version_id in (select id from private.npc_versions where npc_id=p_npc_id)
      and (p_save_id is null or r.world_id=p_save_id);

  -- Sandbox/job/asset records are private, but are still author-facing
  -- content.  Retain only enough record shape for governance/audit timelines.
  update private.npc_sandboxes
    set state=jsonb_build_object('redacted',true), updated_at=now(), invalidated_at=coalesce(invalidated_at,now())
    where npc_id=p_npc_id;
  update private.npc_generation_jobs
    set request=jsonb_build_object('redacted',true), result=jsonb_build_object('redacted',true),
        error_code=coalesce(error_code,'CONTENT_REMOVED'), completed_at=coalesce(completed_at,now())
    where npc_id=p_npc_id;
  update private.npc_assistance_events
    set proposal=null, disposition=case when disposition='accepted' then 'accepted' else 'rejected' end
    where npc_id=p_npc_id;
  update private.npc_assets
    set storage_key='redacted/removed-npc/'||id::text, alt_text='Removed NPC content', generation='{}'::jsonb
    where npc_id=p_npc_id;

  insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason)
    select w.save_id,w.npc_id,w.version_id,p_reason
    from private.world_npc_instances w
    where w.id=any(v_instance_ids)
    on conflict(save_id,npc_id,reason) do nothing;

  -- Cascades remove dialogue, memories, reactions, intent plays, quest prose,
  -- and hospitality receipts/projections together.  The tombstone is the only
  -- remaining world-level link to the removed resident.
  delete from private.world_npc_instances where id=any(v_instance_ids);

  update private.npc_engagement_events
    set metadata=jsonb_build_object('redacted',true)
    where npc_id=p_npc_id;

  perform private.npc_governance_log(
    p_npc_id,
    'player_visible_history_purged',
    null,
    jsonb_build_object('reason',p_reason,'saveScoped',p_save_id is not null,'worldsRemoved',v_count)
  );
  return v_count;
end $$;

create or replace function public.npc_update_community_settings(
  p_display_name text,
  p_bio text,
  p_mature boolean,
  p_attest_adult boolean,
  p_creator_terms boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_save uuid; v_npc uuid;
begin
  perform public.npc_update_profile(p_display_name,p_bio,p_mature,p_attest_adult,p_creator_terms);
  if not p_mature then
    select id into v_save from public.tavern_saves where user_id=auth.uid() for update;
    if v_save is not null then
      for v_npc in
        select i.id from private.npc_identities i
        join private.world_npc_instances w on w.npc_id=i.id
        where w.save_id=v_save and i.rating='mature'
      loop
        perform private.npc_purge_visible_history(v_npc,'mature_purged',v_save);
      end loop;
    end if;
  end if;
  return public.npc_profile_me();
end $$;

-- Keep the small preference RPC for callers that only expose the toggle, but
-- route it through the full settings mutation so neither UI path can bypass
-- the scoped mature-content purge.
create or replace function public.npc_set_mature_preference(
  p_enabled boolean,
  p_attest boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return public.npc_update_community_settings(
    (public.npc_profile_me()->>'displayName'),
    (public.npc_profile_me()->>'bio'),
    p_enabled,
    p_attest,
    false
  );
end $$;

create or replace function public.npc_reviewer_retirement(
  p_request uuid,
  p_approve boolean,
  p_reason text
) returns void language plpgsql security definer set search_path='' as $$
declare v_npc uuid; v_owner uuid;
begin
  select npc_id into v_npc from private.npc_retirement_requests where id=p_request and status='open' for update;
  if v_npc is null then raise sqlstate 'PT404'; end if;
  perform private.assert_npc_reviewer(v_npc);
  update private.npc_retirement_requests
    set status=case when p_approve then 'approved' else 'rejected' end,
        decided_by=auth.uid(), decided_at=now(), reason=reason||E'\nDecision: '||p_reason
    where id=p_request;
  if p_approve then
    update private.npc_identities
      set status='retired', retired_at=now(), updated_at=now()
      where id=v_npc;
  end if;
  select user_id into v_owner from private.npc_identity_owners where npc_id=v_npc and ended_at is null;
  insert into private.npc_notifications(user_id,kind,payload)
    values(v_owner,'retirement_decision',jsonb_build_object('npcId',v_npc,'approved',p_approve,'reason',p_reason));
end $$;

create or replace function public.npc_reviewer_resolve_report(
  p_report uuid,
  p_uphold boolean,
  p_reviewer_reason text,
  p_creator_reason text,
  p_action text
) returns void language plpgsql security definer set search_path='' as $$
declare v_npc uuid; v_reporter uuid; v_owner uuid; v_reason text;
begin
  select v.npc_id,r.reporter_id into v_npc,v_reporter
    from private.npc_reports r join private.npc_versions v on v.id=r.version_id
    where r.id=p_report and r.status='open' for update;
  if v_npc is null then raise sqlstate 'PT404'; end if;
  perform private.assert_npc_reviewer(v_npc);
  if p_action not in ('none','reinstate','pause','quarantine','ban')
    or length(trim(p_reviewer_reason))<3 or length(trim(p_creator_reason))<3 then
    raise sqlstate 'PT400';
  end if;
  if not p_uphold and p_action <> 'none' then
    raise sqlstate 'PT400' using message='A dismissed report cannot apply a remedial action';
  end if;
  update private.npc_reports
    set status=case when p_uphold then 'upheld' else 'dismissed' end,
        reviewer_reason=p_reviewer_reason, creator_reason=p_creator_reason,
        remedial_action=p_action, decided_by=auth.uid(), decided_at=now()
    where id=p_report;
  if p_action='reinstate' then
    update private.npc_identities set status='published',updated_at=now()
      where id=v_npc and current_published_version_id is not null;
  elsif p_action='pause' then
    update private.npc_identities set status='paused',updated_at=now() where id=v_npc;
  elsif p_action in ('quarantine','ban') then
    v_reason:=case when p_action='ban' then 'banned' else 'quarantined' end;
    perform private.npc_purge_visible_history(v_npc,v_reason);
    update private.npc_identities
      set status=case when p_action='ban' then 'banned' else 'paused' end,
          purged_at=case when p_action='ban' then now() else purged_at end,
          updated_at=now()
      where id=v_npc;
  end if;
  select user_id into v_owner from private.npc_identity_owners where npc_id=v_npc and ended_at is null;
  insert into private.npc_notifications(user_id,kind,payload) values
    (v_reporter,'report_decision',jsonb_build_object('reportId',p_report,'upheld',p_uphold,'reason',p_reviewer_reason,'action',p_action)),
    (v_owner,'content_report_decision',jsonb_build_object('npcId',v_npc,'upheld',p_uphold,'reason',p_creator_reason,'action',p_action));
end $$;

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
  perform private.npc_purge_visible_history(p_npc,v_reason);
  update private.npc_identities
    set status=case when p_purge then 'banned' else 'paused' end,
        purged_at=case when p_purge then now() else purged_at end,
        updated_at=now()
    where id=p_npc;
end $$;

revoke all on function private.npc_purge_visible_history(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.npc_set_mature_preference(boolean,boolean),public.npc_reviewer_retirement(uuid,boolean,text),public.npc_reviewer_resolve_report(uuid,boolean,text,text,text),public.npc_admin_quarantine_or_purge(uuid,boolean,text) to authenticated;
grant execute on function public.npc_update_community_settings(text,text,boolean,boolean,boolean) to authenticated;

commit;
