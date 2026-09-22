-- Issue #30 final prototype cutover.
--
-- Earlier migrations introduced a patron-key dialogue stack and a pilot
-- evolution-pin stack.  The V2 resident package is now the only authority.
-- This repository deliberately has no production database, so remove those
-- obsolete stores rather than preserving a compatibility path.
begin;

-- The active world hospitality contract owns consumption exclusively.  It
-- no longer checks patron-key receipts that have been deleted below.
create or replace function private.world_npc_hospitality(p_save uuid,p_npc uuid,p_day integer) returns integer
language sql stable security definer set search_path='' as $fn$
  select greatest(-3,least(3,coalesce(sum(event.quality_index-3),0)))::integer
  from private.world_npc_hospitality_events event
  join private.world_npc_instances resident on resident.id=event.instance_id
  where event.save_id=p_save and resident.npc_id=p_npc and event.day_number=p_day
$fn$;

create or replace function private.world_npc_apply_hospitality(
  p_actor uuid,p_save uuid,p_instance uuid,p_kind text,p_item uuid,p_action uuid,p_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare save_row public.tavern_saves; resident private.world_npc_instances; beverage public.beverages; food public.foods;
  prior private.world_npc_hospitality_events; item_name text; item_quality integer; relationship_delta integer; gold_earned integer; result jsonb;
begin
  if p_actor is null or p_save is null or p_instance is null or p_kind not in ('beverage','food') or p_item is null or p_action is null or p_revision is null then
    raise sqlstate 'PT400' using message='Invalid hospitality request';
  end if;
  select * into save_row from public.tavern_saves where id=p_save and user_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or offering not found'; end if;
  select * into prior from private.world_npc_hospitality_events where save_id=p_save and action_id=p_action;
  if found then
    if prior.instance_id=p_instance and prior.item_kind=p_kind and coalesce(prior.beverage_id,prior.food_id)=p_item and prior.input_expected_revision=p_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for different input';
  end if;
  if save_row.revision<>p_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before serving'; end if;
  select * into resident from private.world_npc_instances where id=p_instance and save_id=p_save for update;
  if not found or resident.status in ('dead','departed','dismissed','removed','quarantined') then raise sqlstate 'PT422' using message='This guest is unavailable'; end if;
  if p_kind='beverage' then
    select * into beverage from public.beverages where save_id=p_save and id=p_item;
    if not found or exists(select 1 from private.world_npc_hospitality_events where save_id=p_save and beverage_id=p_item) then raise sqlstate 'PT409' using message='Drink is unavailable'; end if;
    item_name:=beverage.name; item_quality:=beverage.quality_index;
  else
    select * into food from public.foods where save_id=p_save and id=p_item;
    if not found or exists(select 1 from private.world_npc_hospitality_events where save_id=p_save and food_id=p_item) then raise sqlstate 'PT409' using message='Food is unavailable'; end if;
    item_name:=food.name; item_quality:=food.quality_index;
  end if;
  relationship_delta:=case when item_quality>=4 then 2 when item_quality>=2 then 1 when item_quality=1 then -1 else -2 end;
  gold_earned:=(array[1,3,6,10,16,25,40])[item_quality+1];
  result:=jsonb_build_object('actionId',p_action,'instanceId',p_instance,'itemKind',p_kind,'itemId',p_item,'itemName',item_name,
    'qualityIndex',item_quality,'goldEarned',gold_earned,'goldBalance',save_row.gold+gold_earned,'relationshipChange',relationship_delta,
    'relationship',greatest(0,least(100,resident.relationship+relationship_delta)),'dayNumber',save_row.current_day,'committedRevision',save_row.revision+1,'rulesVersion','world-hospitality-v1');
  update private.world_npc_instances set relationship=greatest(0,least(100,relationship+relationship_delta)) where id=p_instance;
  update public.tavern_saves set gold=gold+gold_earned,revision=revision+1,updated_at=now() where id=p_save;
  insert into private.world_npc_hospitality_events(save_id,action_id,actor_id,instance_id,item_kind,beverage_id,food_id,input_expected_revision,day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision)
  values(p_save,p_action,p_actor,p_instance,p_kind,case when p_kind='beverage' then p_item end,case when p_kind='food' then p_item end,p_revision,save_row.current_day,item_name,item_quality,gold_earned,relationship_delta,result,save_row.revision+1);
  return result;
end
$fn$;

create or replace function public.npc_dialogue_begin(
  p_actor uuid,p_turn_id uuid,p_npc_id uuid,p_message text,p_expected_sequence bigint,
  p_intent_card_id uuid default null,p_offering_kind text default null,p_offering_item_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare save_row public.tavern_saves; resident private.world_npc_instances; turn_row private.world_npc_dialogue_turns; card public.intent_cards;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403' using message='Dialogue orchestration is server-only'; end if;
  if p_turn_id is null or p_npc_id is null or p_expected_sequence is null or p_expected_sequence<0 or p_message is null or char_length(btrim(p_message)) not between 1 and 2000
     or (p_offering_kind is null)<>(p_offering_item_id is null) or p_offering_kind not in ('beverage','food') and p_offering_kind is not null then raise sqlstate 'PT400' using message='Invalid dialogue input'; end if;
  select * into save_row from public.tavern_saves where user_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Start a tavern before talking'; end if;
  update private.world_npc_dialogue_attempts attempt set status='expired',finished_at=now(),error_code='LEASE_EXPIRED'
    from private.world_npc_dialogue_turns expired where attempt.turn_id=expired.id and expired.save_id=save_row.id and expired.status='processing' and expired.lease_until<=now() and attempt.status='processing';
  update private.world_npc_dialogue_turns set status='failed',error_code='LEASE_EXPIRED' where save_id=save_row.id and status='processing' and lease_until<=now();
  select * into turn_row from private.world_npc_dialogue_turns where id=p_turn_id for update;
  if found then
    if turn_row.actor_id<>p_actor or turn_row.npc_id<>p_npc_id or turn_row.message<>p_message or turn_row.input_sequence<>p_expected_sequence or turn_row.intent_card_id is distinct from p_intent_card_id or turn_row.offering_kind is distinct from p_offering_kind or turn_row.offering_item_id is distinct from p_offering_item_id then raise sqlstate 'PT409' using message='Turn identifier already used for different input'; end if;
    if turn_row.status='completed' then return to_jsonb(turn_row); end if;
    if turn_row.status in ('cancelled','stale') then raise sqlstate 'PT409' using message='Turn is closed'; end if;
    if turn_row.status='processing' and turn_row.lease_until>now() then return to_jsonb(turn_row)||'{"busy":true}'::jsonb; end if;
    if turn_row.source_revision<>save_row.revision or turn_row.day_number<>save_row.current_day then update private.world_npc_dialogue_turns set status='stale',error_code='STATE_CHANGED' where id=turn_row.id; return jsonb_build_object('status','stale'); end if;
    update private.world_npc_dialogue_turns set status='processing',fence=extensions.gen_random_uuid(),lease_until=now()+interval '120 seconds',error_code=null where id=turn_row.id returning * into turn_row;
  else
    if exists(select 1 from private.world_npc_dialogue_turns where save_id=save_row.id and status='processing' and lease_until>now()) then raise sqlstate 'PT409' using message='Another conversation is processing'; end if;
    select * into resident from private.world_npc_instances where save_id=save_row.id and npc_id=p_npc_id for update;
    if not found or resident.status in ('dead','departed','dismissed','removed','quarantined') then raise sqlstate 'PT422' using message='This guest is unavailable'; end if;
    if resident.conversation_sequence<>p_expected_sequence then raise sqlstate 'PT409' using message='Conversation changed; refresh before replying'; end if;
    if p_intent_card_id is not null then
      select * into card from public.intent_cards where id=p_intent_card_id and save_id=save_row.id;
      if not found or exists(select 1 from private.world_npc_intent_card_plays where save_id=save_row.id and card_id=p_intent_card_id) then raise sqlstate 'PT409' using message='Intent card is unavailable'; end if;
    end if;
    insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,intent_card_id,offering_kind,offering_item_id,source_revision,day_number,status,lease_until)
      values(p_turn_id,save_row.id,resident.id,resident.npc_id,resident.version_id,p_actor,p_message,p_expected_sequence,p_intent_card_id,p_offering_kind,p_offering_item_id,save_row.revision,save_row.current_day,'processing',now()+interval '120 seconds') returning * into turn_row;
  end if;
  update private.world_npc_dialogue_attempts set status='expired',finished_at=now() where turn_id=turn_row.id and status='processing';
  insert into private.world_npc_dialogue_attempts(turn_id,fence) values(turn_row.id,turn_row.fence);
  return to_jsonb(turn_row);
end
$fn$;

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
    from private.world_npc_instances resident join owned save_row on save_row.id=resident.save_id join private.npc_identities identity on identity.id=resident.npc_id join private.npc_versions version on version.id=resident.version_id left join private.npc_assets asset on asset.id=version.selected_scene_asset_id left join public.player_profiles profile on profile.user_id=identity.creator_id),
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

-- Earlier migrations are rewritten rather than hidden by late destructive
-- drops. Keep a narrow reset assertion here so a future edit cannot restore a
-- second resident-definition source or the removed patron-key stack.
do $assert_no_legacy_relations$
declare relation_name text;
begin
  foreach relation_name in array array[
    'private.world_resident_procedural_capability_sources',
    'private.world_pilot_resident_procedural_definitions',
    'private.world_promoted_npc_definitions',
    'private.world_promoted_supporting_templates',
    'private.world_pilot_resident_definitions',
    'private.world_resident_evolution_pins',
    'private.world_resident_runtime_package_context',
    'public.hospitality_events',
    'public.intent_card_plays',
    'public.dialogue_turns',
    'public.serving_events',
    'public.patron_states',
    'public.patron_catalog',
    'private.npc_content',
    'private.npc_content_versions'
  ] loop
    if to_regclass(relation_name) is not null then
      raise exception using errcode='55000', message='Legacy NPC relation survived lineage consolidation: ' || relation_name;
    end if;
  end loop;
end
$assert_no_legacy_relations$;

commit;
