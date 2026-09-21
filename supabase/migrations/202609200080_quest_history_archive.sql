-- Issue #31 Packet 4: a paged, owner-only record of completed resident quests.
-- The archive is deliberately a player vocabulary, not a replay/worker export.
begin;

create function public.npc_quest_history_archive(
  p_instance_id uuid,
  p_limit integer default 20,
  p_cursor uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 40));
  v_cursor_day integer;
  v_cursor_id uuid;
  v_items jsonb;
  v_next_cursor uuid;
begin
  -- Resolve the resident through the save owner first.  The same check covers
  -- active, dismissed, and departed residents without making a past resident
  -- playable through the normal roster projection.
  if not exists (
    select 1
    from private.world_npc_instances resident
    join public.tavern_saves save_row on save_row.id = resident.save_id
    where resident.id = p_instance_id and save_row.user_id = auth.uid()
  ) then
    raise sqlstate 'PT404' using message = 'Quest archive was not found';
  end if;

  if p_cursor is not null then
    select quest.terminal_day, quest.id into v_cursor_day, v_cursor_id
    from private.world_quests quest
    where quest.id = p_cursor
      and quest.instance_id = p_instance_id
      and quest.state in ('succeeded', 'failed', 'abandoned');
    if not found then
      raise sqlstate 'PT400' using message = 'Quest archive cursor is invalid';
    end if;
  end if;

  with page as (
    select quest.id, quest.origin, quest.title, quest.objective, quest.state, quest.activated_day, quest.scheduled_for_day, quest.terminal_day,
      row_number() over (order by quest.terminal_day desc, quest.id desc) as ordinal
    from private.world_quests quest
    where quest.instance_id = p_instance_id
      and quest.state in ('succeeded', 'failed', 'abandoned')
      and (p_cursor is null or (quest.terminal_day, quest.id) < (v_cursor_day, v_cursor_id))
    order by quest.terminal_day desc, quest.id desc
    limit v_limit + 1
  ), visible as (
    select * from page where ordinal <= v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', quest.id,
    'origin', quest.origin,
    'title', quest.title,
    'objective', quest.objective,
    'outcome', quest.state,
    'activationDay', coalesce(quest.activated_day, quest.scheduled_for_day),
    'terminalDay', quest.terminal_day,
    'events', coalesce(events.items, '[]'::jsonb)
  ) order by quest.terminal_day desc, quest.id desc), '[]'::jsonb),
  case when exists (select 1 from page where ordinal = v_limit + 1)
    then (select id from visible order by terminal_day asc, id asc limit 1)
    else null
  end
  into v_items, v_next_cursor
  from visible quest
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', event.id,
      'day', event.day_number,
      'outcome', event.outcome,
      'text', event.narration,
      'publicNews', event.public_news
    ) order by event.day_number, event.id) as items
    from private.world_quest_events event
    where event.quest_id = quest.id
  ) events on true;

  return jsonb_build_object('items', v_items, 'nextCursor', v_next_cursor);
end
$function$;

-- Dismissed and departed residents are archive-only.  They are intentionally
-- excluded from npc_roster and therefore never enter the playable scene.
create or replace function public.npc_archived_resident(p_instance uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
    'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}',
    'description',v.sheet#>>'{identity,shortDescription}','relationship',w.relationship,
    'rating',i.rating,'origin',i.origin,'sceneStorageKey',a.storage_key,
    'creator',case when i.origin='community' then jsonb_build_object('displayName',p.display_name,'profile',p.normalized_display_name) else null end,
    'sequence',w.conversation_sequence
  ) from private.world_npc_instances w
  join public.tavern_saves s on s.id=w.save_id
  join private.npc_versions v on v.id=w.version_id
  join private.npc_identities i on i.id=w.npc_id
  left join private.npc_assets a on a.id=v.selected_scene_asset_id
  left join public.player_profiles p on p.user_id=i.creator_id
  where w.id=p_instance and s.user_id=auth.uid() and w.status in ('dismissed','departed')
$$;

create or replace function public.npc_archived_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  with owned as (select id from public.tavern_saves where user_id=auth.uid() limit 1), page as (
    select w.* from private.world_npc_instances w join owned s on s.id=w.save_id join private.npc_versions v on v.id=w.version_id
    where w.status in ('dismissed','departed') and (p_cursor is null or w.id>p_cursor)
      and (coalesce(nullif(trim(p_query),''),'')='' or lower(v.sheet#>>'{identity,name}') like '%'||lower(trim(p_query))||'%')
    order by w.id limit greatest(1,least(coalesce(p_limit,20),20))
  ) select coalesce(jsonb_agg(jsonb_build_object('instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
    'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}','description',v.sheet#>>'{identity,shortDescription}',
    'relationship',w.relationship,'rating',i.rating,'origin',i.origin,'sceneStorageKey',a.storage_key,
    'creator',case when i.origin='community' then jsonb_build_object('displayName',p.display_name,'profile',p.normalized_display_name) else null end,'sequence',w.conversation_sequence) order by w.id),'[]'::jsonb)
  from page w join private.npc_versions v on v.id=w.version_id join private.npc_identities i on i.id=w.npc_id
  left join private.npc_assets a on a.id=v.selected_scene_asset_id left join public.player_profiles p on p.user_id=i.creator_id
$$;

revoke all on function public.npc_quest_history_archive(uuid,integer,uuid) from public, anon;
grant execute on function public.npc_quest_history_archive(uuid,integer,uuid) to authenticated;
revoke all on function public.npc_archived_roster(integer,uuid,text), public.npc_archived_resident(uuid) from public, anon;
grant execute on function public.npc_archived_roster(integer,uuid,text), public.npc_archived_resident(uuid) to authenticated;

commit;
