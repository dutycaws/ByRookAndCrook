-- The player-safe event history is rendered alongside the active quest. Keep
-- the event's quest identity so that the UI can attribute setbacks correctly.
create or replace function public.npc_journals(p_instance_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $function$
  select coalesce(jsonb_object_agg(resident.id::text,jsonb_strip_nulls(jsonb_build_object(
    'instanceId',resident.id,'npcId',resident.npc_id,'versionId',resident.version_id,'status',resident.status,
    'sequence',resident.conversation_sequence,'relationship',resident.relationship,
    'questLifecycleStatus',private.world_quest_lifecycle_status(resident.save_id,resident.id),
    'currentQuest',case when current_quest.id is null then null else private.world_quest_public_view(current_quest,save_row.current_day) end,
    -- This is the sole player history vocabulary. Do not add replay inputs,
    -- readiness, private transition context, or settlement diagnostics here.
    'questHistory',coalesce(history.items,'[]'::jsonb),'turns',coalesce(turns.items,'[]'::jsonb),
    'pending',pending.item,'farewellText',departure.farewell_text,
    'disposition',coalesce(evolution.latest_disposition,profile.public_disposition),'evolution',coalesce(evolution.items,'[]'::jsonb)
  ))),'{}'::jsonb)
  from private.world_npc_instances resident
  join public.tavern_saves save_row on save_row.id=resident.save_id
  left join private.world_resident_profiles profile on profile.instance_id=resident.id
  left join private.world_npc_departures departure on departure.instance_id=resident.id
  left join lateral (
    select quest.* from private.world_quests quest
    where quest.save_id=resident.save_id and quest.instance_id=resident.id
      and quest.state in ('active','scheduled')
    order by case quest.state when 'active' then 0 else 1 end,quest.scheduled_for_day,quest.created_at
    limit 1
  ) current_quest on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id',event.id,'questId',event.quest_id,'day',event.day_number,'outcome',event.outcome,
      'text',event.narration,'publicNews',event.public_news
    ) order by event.day_number desc,event.created_at desc) items
    from (
      select * from private.world_quest_events
      where instance_id=resident.id
      order by day_number desc,created_at desc
      limit 40
    ) event
  ) history on true
  left join lateral (
    select jsonb_agg(item order by sequence) items
    from (
      select input_sequence sequence,jsonb_build_object(
        'turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,
        'npc',result->>'reply','relationship',result->'relationship'
      ) item
      from private.world_npc_dialogue_turns
      where instance_id=resident.id and status='completed'
      order by input_sequence desc limit 40
    ) recent
  ) turns on true
  left join lateral (
    select jsonb_build_object(
      'turnId',id,'status',case when status='processing' and lease_until<now() then 'failed' else status end,
      'message',message,'error',error_code
    ) item
    from private.world_npc_dialogue_turns
    where instance_id=resident.id and status in ('processing','failed')
    order by created_at desc limit 1
  ) pending on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'day',day_number,'profileRevision',profile_revision,'disposition',disposition,'createdAt',created_at
    ) order by created_at desc) items,
    (array_agg(disposition order by created_at desc))[1] latest_disposition
    from (
      select * from private.resident_evolution_entries
      where instance_id=resident.id order by created_at desc limit 6
    ) entry
  ) evolution on true
  where save_row.user_id=auth.uid() and resident.id=any(p_instance_ids)
$function$;
