-- Departed guests remain in the archive rather than the playable roster.
-- Filter before pagination, retaining owner scoping and existing RPC permissions.
begin;

create or replace function public.npc_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  with owned as (select id from public.tavern_saves where user_id=auth.uid() limit 1),
  page as (
    select w.* from private.world_npc_instances w join owned s on s.id=w.save_id
    join private.npc_versions v on v.id=w.version_id
    where w.status not in ('dismissed','departed') and (p_cursor is null or w.id>p_cursor)
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

create or replace function public.npc_bar_snapshot() returns jsonb
language sql stable security definer set search_path='' as $fn$
  with owned as (select * from public.tavern_saves where user_id=auth.uid() limit 1),
  roster as (
    select coalesce(jsonb_agg(jsonb_build_object('instanceId',resident.id,'npcId',resident.npc_id,'versionId',resident.version_id,'status',resident.status,
      'name',case when resident.status in ('removed','quarantined') then 'Unavailable guest' else version.sheet#>>'{identity,name}' end,
      'title',case when resident.status in ('removed','quarantined') then null else version.sheet#>>'{identity,title}' end,
      'description',case when resident.status in ('removed','quarantined') then null else version.sheet#>>'{identity,shortDescription}' end,
      'relationship',resident.relationship,'rating',identity.rating,'origin',identity.origin,'sceneStorageKey',asset.storage_key,
      'creator',case when identity.origin='community' then jsonb_build_object('displayName',profile.display_name,'profile',profile.normalized_display_name) else null end,'sequence',resident.conversation_sequence) order by resident.npc_id),'[]'::jsonb) value
    from private.world_npc_instances resident join owned save_row on save_row.id=resident.save_id join private.npc_identities identity on identity.id=resident.npc_id join private.npc_versions version on version.id=resident.version_id left join private.npc_assets asset on asset.id=version.selected_scene_asset_id left join public.player_profiles profile on profile.user_id=identity.creator_id
    where resident.status not in ('dismissed','departed')),
  offerings as (
    select jsonb_build_object(
      'beverages',coalesce((select jsonb_agg(jsonb_build_object('id',beverage.id,'kind','beverage','name',beverage.name,'qualityIndex',beverage.quality_index) order by beverage.created_at desc,beverage.id) from public.beverages beverage join owned save_row on save_row.id=beverage.save_id where not exists(select 1 from private.world_npc_hospitality_events event where event.save_id=beverage.save_id and event.beverage_id=beverage.id)),'[]'::jsonb),
      'foods',coalesce((select jsonb_agg(jsonb_build_object('id',food.id,'kind','food','name',food.name,'qualityIndex',food.quality_index) order by food.created_at desc,food.id) from public.foods food join owned save_row on save_row.id=food.save_id where not exists(select 1 from private.world_npc_hospitality_events event where event.save_id=food.save_id and event.food_id=food.id)),'[]'::jsonb),
      'intentCards',coalesce((select jsonb_agg(jsonb_build_object('id',card.id,'cardKey',card.card_key,'displayName',catalog.display_name,'description',catalog.description,'tier',card.tier) order by card.created_at,card.id) from public.intent_cards card join owned save_row on save_row.id=card.save_id join public.intent_card_catalog catalog on catalog.card_key=card.card_key and catalog.version=card.catalog_version where not exists(select 1 from private.world_npc_intent_card_plays play where play.save_id=card.save_id and play.card_id=card.id)),'[]'::jsonb)) value),
  recent as (
    select jsonb_build_object('hospitality',coalesce((select jsonb_agg(item.result order by item.created_at desc) from (select event.result,event.created_at from private.world_npc_hospitality_events event join owned save_row on save_row.id=event.save_id order by event.created_at desc limit 20) item),'[]'::jsonb),
      'news',coalesce((select jsonb_agg(jsonb_build_object('instanceId',event.instance_id,'day',event.day,'outcome',event.outcome,'text',event.narration) order by event.created_at desc) from (select event.* from private.world_npc_quest_events event join private.world_npc_instances resident on resident.id=event.instance_id join owned save_row on save_row.id=resident.save_id where event.public_news order by event.created_at desc limit 12) event),'[]'::jsonb),
      'latestArrival',(select receipt.result from private.world_npc_arrival_receipts receipt join owned save_row on save_row.id=receipt.save_id order by receipt.day desc limit 1)) value)
  select case when exists(select 1 from owned) then jsonb_build_object('save',(select jsonb_build_object('id',id,'revision',revision,'gold',gold,'currentDay',current_day,'communityNpcLevel',community_npc_level,'communityNpcCapacity',greatest(2,community_npc_level+1)) from owned),'roster',(select value from roster),'offerings',(select value from offerings),'recent',(select value from recent)) end
$fn$;

commit;
