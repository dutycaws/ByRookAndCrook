-- Community NPC engagement capture is deliberately write-only from runtime
-- tables.  It records bounded counters and a one-way world hash, never prose,
-- player-visible messages, memories, or a player identifier in analytics.
begin;

alter table private.npc_engagement_events
  add column source_key text;
create unique index npc_engagement_event_source_key
  on private.npc_engagement_events(source_key)
  where source_key is not null;

create function private.npc_capture_community_engagement(
  p_instance uuid,
  p_kind text,
  p_source_key text,
  p_event_day date default current_date,
  p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare v_world private.world_npc_instances; v_actor uuid;
begin
  if p_kind not in ('assigned','active','dialogue','day_present','hospitality',
                    'milestone_success','milestone_failure','abandoned',
                    'campaign_complete','dismissed','report')
    or p_source_key !~ '^[a-z_]+:[0-9a-f-]+(?::[0-9]+)?$'
    or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata,'{}'::jsonb)::text) > 1024 then
    raise sqlstate 'PT400' using message='Engagement event is invalid';
  end if;

  select w.* into v_world
    from private.world_npc_instances w
    join private.npc_identities i on i.id=w.npc_id
    where w.id=p_instance and i.origin='community';
  if not found then return; end if;
  select user_id into v_actor from public.tavern_saves where id=v_world.save_id;

  insert into private.npc_engagement_events(
    actor_id,event_day,event_kind,npc_id,version_id,world_hash,metadata,source_key
  ) values (
    v_actor,p_event_day,p_kind,v_world.npc_id,v_world.version_id,
    encode(extensions.digest(v_world.save_id::text,'sha256'),'hex'),
    coalesce(p_metadata,'{}'::jsonb),p_source_key
  ) on conflict (source_key) where source_key is not null do nothing;
end $$;

-- Keep the service entry point useful for a server reconciliation job without
-- allowing an unbounded event stream.  Runtime paths below use durable source
-- identifiers directly, so retries cannot alter counts.
create or replace function public.npc_record_engagement(
  p_actor uuid,p_version uuid,p_kind text,p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare v_instance uuid; v_source text;
begin
  perform private.npc_assert_service();
  if p_actor is null
    or p_kind not in ('assigned','active','dialogue','day_present','hospitality',
                      'milestone_success','milestone_failure','abandoned',
                      'campaign_complete','dismissed','report')
    or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata,'{}'::jsonb)::text) > 1024
    or coalesce(p_metadata->>'sourceKey','') !~ '^[a-z_]+:[0-9a-f-]+(?::[0-9]+)?$'
    then raise sqlstate 'PT400' using message='Engagement event is invalid';
  end if;
  select w.id into v_instance
    from private.world_npc_instances w
    join public.tavern_saves s on s.id=w.save_id
    where s.user_id=p_actor and w.version_id=p_version
    order by w.created_at limit 1;
  if v_instance is null then raise sqlstate 'PT404'; end if;
  v_source:=p_metadata->>'sourceKey';
  perform private.npc_capture_community_engagement(
    v_instance,p_kind,v_source,current_date,p_metadata-'sourceKey'
  );
end $$;

create function private.npc_engagement_after_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.npc_capture_community_engagement(new.id,'assigned','assignment:'||new.id::text);
  perform private.npc_capture_community_engagement(new.id,'active','active:'||new.id::text||':'||new.arrived_day::text);
  return new;
end $$;
create trigger npc_engagement_after_assignment
  after insert on private.world_npc_instances
  for each row execute function private.npc_engagement_after_assignment();

create function private.npc_engagement_after_quest_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.npc_capture_community_engagement(new.instance_id,'day_present','day_present:'||new.instance_id::text||':'||new.day::text);
  perform private.npc_capture_community_engagement(new.instance_id,'active','active:'||new.instance_id::text||':'||new.day::text);
  if new.outcome in ('succeeded','settled') then
    perform private.npc_capture_community_engagement(new.instance_id,'milestone_success','milestone_success:'||new.id::text);
  elsif new.outcome='failed' then
    perform private.npc_capture_community_engagement(new.instance_id,'milestone_failure','milestone_failure:'||new.id::text);
  elsif new.outcome='abandoned' then
    perform private.npc_capture_community_engagement(new.instance_id,'abandoned','abandoned:'||new.id::text);
  end if;
  if new.outcome='settled' then
    perform private.npc_capture_community_engagement(new.instance_id,'campaign_complete','campaign_complete:'||new.id::text);
  end if;
  return new;
end $$;
create trigger npc_engagement_after_quest_event
  after insert on private.world_npc_quest_events
  for each row execute function private.npc_engagement_after_quest_event();

create function private.npc_engagement_after_dialogue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    perform private.npc_capture_community_engagement(new.instance_id,'dialogue','dialogue:'||new.id::text);
  end if;
  return new;
end $$;
create trigger npc_engagement_after_dialogue
  after update of status on private.world_npc_dialogue_turns
  for each row execute function private.npc_engagement_after_dialogue();

create function private.npc_engagement_after_hospitality() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.npc_capture_community_engagement(new.instance_id,'hospitality','hospitality:'||new.action_id::text);
  return new;
end $$;
create trigger npc_engagement_after_hospitality
  after insert on private.world_npc_hospitality_events
  for each row execute function private.npc_engagement_after_hospitality();

create function private.npc_engagement_after_dismissal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='dismissed' and old.status is distinct from 'dismissed' then
    perform private.npc_capture_community_engagement(new.id,'dismissed','dismissed:'||new.id::text);
  end if;
  return new;
end $$;
create trigger npc_engagement_after_dismissal
  after update of status on private.world_npc_instances
  for each row execute function private.npc_engagement_after_dismissal();

create function private.npc_engagement_after_report() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_instance uuid;
begin
  select id into v_instance from private.world_npc_instances
    where save_id=new.world_id and version_id=new.version_id
    order by created_at limit 1;
  if v_instance is not null then
    perform private.npc_capture_community_engagement(v_instance,'report','report:'||new.id::text);
  end if;
  return new;
end $$;
create trigger npc_engagement_after_report
  after insert on private.npc_reports
  for each row execute function private.npc_engagement_after_report();

-- The existing roll-up is deterministic and recomputes a date from raw,
-- bounded events.  Do not expose the raw event table to creators or players.
revoke all on private.npc_engagement_events from public,anon,authenticated;
revoke all on function private.npc_capture_community_engagement(uuid,text,text,date,jsonb) from public,anon,authenticated;
grant execute on function public.npc_record_engagement(uuid,uuid,text,jsonb),public.npc_rollup_analytics(date) to service_role;

commit;
