begin;

-- The Bar only needs a compact resident card while browsing.  Keep the
-- transcript behind a separate, owner-scoped call so a large tavern does not
-- turn opening the Bar into N journal queries or one unbounded response.
create or replace function public.npc_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  with owned as (select id from public.tavern_saves where user_id=auth.uid() limit 1),
  page as (
    select w.* from private.world_npc_instances w join owned s on s.id=w.save_id
    join private.npc_versions v on v.id=w.version_id
    where w.status <> 'dismissed' and (p_cursor is null or w.id>p_cursor)
      and (coalesce(nullif(trim(p_query),''),'')='' or lower(v.sheet#>>'{identity,name}') like '%'||lower(trim(p_query))||'%')
    order by w.id limit greatest(1,least(coalesce(p_limit,20),20))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
    'name',case when w.status in ('removed','quarantined') then 'Unavailable guest' else v.sheet#>>'{identity,name}' end,
    'title',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,title}' end,
    'description',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,shortDescription}' end,
    'relationship',w.relationship,'rating',i.rating,'origin',i.origin,'sceneStorageKey',a.storage_key,
    'creator',case when i.origin='community' then jsonb_build_object('displayName',p.display_name,'profile',p.normalized_display_name) else null end,
    'sequence',w.conversation_sequence
  ) order by w.id),'[]'::jsonb)
  from page w join private.npc_versions v on v.id=w.version_id join private.npc_identities i on i.id=w.npc_id
  left join private.npc_assets a on a.id=v.selected_scene_asset_id
  left join public.player_profiles p on p.user_id=i.creator_id
$$;

-- `npc_resident` must preserve direct selection even if it falls outside a
-- paginated cursor.  It intentionally repeats the narrow card projection.
create or replace function public.npc_resident(p_instance uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
    'name',case when w.status in ('removed','quarantined') then 'Unavailable guest' else v.sheet#>>'{identity,name}' end,
    'title',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,title}' end,
    'description',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,shortDescription}' end,
    'relationship',w.relationship,'rating',i.rating,'origin',i.origin,'sceneStorageKey',a.storage_key,
    'creator',case when i.origin='community' then jsonb_build_object('displayName',p.display_name,'profile',p.normalized_display_name) else null end,
    'sequence',w.conversation_sequence
  ) from private.world_npc_instances w join public.tavern_saves s on s.id=w.save_id join private.npc_versions v on v.id=w.version_id
  join private.npc_identities i on i.id=w.npc_id left join private.npc_assets a on a.id=v.selected_scene_asset_id
  left join public.player_profiles p on p.user_id=i.creator_id
  where w.id=p_instance and s.user_id=auth.uid() and w.status <> 'dismissed'
$$;

-- Archived journals have a separate lookup so a normal deep link cannot put a
-- dismissed resident back into the playable Bar surface.
create function public.npc_archived_resident(p_instance uuid) returns jsonb
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
  where w.id=p_instance and s.user_id=auth.uid() and w.status='dismissed'
$$;

create function public.npc_archived_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  with owned as (select id from public.tavern_saves where user_id=auth.uid() limit 1), page as (
    select w.* from private.world_npc_instances w join owned s on s.id=w.save_id join private.npc_versions v on v.id=w.version_id
    where w.status='dismissed' and (p_cursor is null or w.id>p_cursor)
      and (coalesce(nullif(trim(p_query),''),'')='' or lower(v.sheet#>>'{identity,name}') like '%'||lower(trim(p_query))||'%')
    order by w.id limit greatest(1,least(coalesce(p_limit,20),20))
  ) select coalesce(jsonb_agg(jsonb_build_object('instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
    'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}','description',v.sheet#>>'{identity,shortDescription}',
    'relationship',w.relationship,'rating',i.rating,'origin',i.origin,'sceneStorageKey',a.storage_key,
    'creator',case when i.origin='community' then jsonb_build_object('displayName',p.display_name,'profile',p.normalized_display_name) else null end,'sequence',w.conversation_sequence) order by w.id),'[]'::jsonb)
  from page w join private.npc_versions v on v.id=w.version_id join private.npc_identities i on i.id=w.npc_id
  left join private.npc_assets a on a.id=v.selected_scene_asset_id left join public.player_profiles p on p.user_id=i.creator_id
$$;

-- A bounded Bar opener: offerings and recent news are already capped by their
-- source queries and roster/journal data stays behind dedicated endpoints.
create function public.npc_bar_summary() returns jsonb language sql stable security definer set search_path='' as $$
  with owned as (select * from public.tavern_saves where user_id=auth.uid() limit 1), offerings as (
    select jsonb_build_object('beverages',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'kind','beverage','name',b.name,'qualityIndex',b.quality_index) order by b.created_at desc,b.id) from public.beverages b join owned s on s.id=b.save_id where not exists(select 1 from private.world_npc_hospitality_events h where h.save_id=b.save_id and h.beverage_id=b.id)),'[]'::jsonb),'foods',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'kind','food','name',f.name,'qualityIndex',f.quality_index) order by f.created_at desc,f.id) from public.foods f join owned s on s.id=f.save_id where not exists(select 1 from private.world_npc_hospitality_events h where h.save_id=f.save_id and h.food_id=f.id)),'[]'::jsonb),'intentCards',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'cardKey',c.card_key,'displayName',cc.display_name,'description',cc.description,'tier',c.tier) order by c.created_at,c.id) from public.intent_cards c join owned s on s.id=c.save_id join public.intent_card_catalog cc on cc.card_key=c.card_key and cc.version=c.catalog_version where not exists(select 1 from private.world_npc_intent_card_plays p where p.save_id=c.save_id and p.card_id=c.id)),'[]'::jsonb)) value
  ), recent as (select jsonb_build_object('hospitality',coalesce((select jsonb_agg(h.result order by h.happened_at desc) from (select event.result,event.created_at as happened_at from private.world_npc_hospitality_events event join owned s on s.id=event.save_id order by event.created_at desc limit 20) h),'[]'::jsonb),'news',coalesce((select jsonb_agg(jsonb_build_object('instanceId',e.instance_id,'day',e.day,'outcome',e.outcome,'text',e.narration) order by e.created_at desc) from (select e.* from private.world_npc_quest_events e join private.world_npc_instances w on w.id=e.instance_id join owned s on s.id=w.save_id where e.public_news order by e.created_at desc limit 12) e),'[]'::jsonb),'latestArrival',(select result from private.world_npc_arrival_receipts a join owned s on s.id=a.save_id order by a.day desc limit 1)) value)
  select case when exists(select 1 from owned) then jsonb_build_object('save',(select jsonb_build_object('id',id,'revision',revision,'gold',gold,'currentDay',current_day,'communityNpcLevel',community_npc_level,'communityNpcCapacity',greatest(2,community_npc_level+1)) from owned),'roster','[]'::jsonb,'offerings',(select value from offerings),'recent',(select value from recent)) end
$$;

revoke all on function public.npc_roster(integer,uuid,text),public.npc_archived_roster(integer,uuid,text),public.npc_resident(uuid),public.npc_archived_resident(uuid),public.npc_bar_summary() from public,anon;
grant execute on function public.npc_roster(integer,uuid,text),public.npc_archived_roster(integer,uuid,text),public.npc_resident(uuid),public.npc_archived_resident(uuid),public.npc_bar_summary() to authenticated;
commit;
