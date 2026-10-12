-- Inventory-derived cards reuse crafted rows and the atomic hospitality fence.
begin;
alter table public.intent_card_catalog drop constraint intent_card_catalog_card_key_check;
alter table public.intent_card_catalog add constraint intent_card_catalog_card_key_check check(card_key in ('charm','insight','flirt','rumor','resolve'));
insert into public.intent_card_catalog values ('flirt','intent-v1','Flirt','Offer playful affection while respecting the resident’s boundaries.','The keeper chose playful, affectionate words. Respect the character’s wishes and boundaries; this does not compel attraction or agreement.');
-- Old completed receipts remain immutable history; obsolete inventory is removed only.
update private.world_npc_dialogue_turns set intent_card_id=null where intent_card_id in (select id from public.intent_cards where card_key='resolve');
delete from private.world_npc_intent_card_plays where card_key='resolve';
alter table public.intent_cards disable trigger immutable_issued_intent_card;
delete from public.intent_cards where card_key='resolve';
alter table public.intent_cards enable trigger immutable_issued_intent_card;
alter table public.intent_card_catalog disable trigger immutable_intent_catalog;
delete from public.intent_card_catalog where card_key='resolve';
alter table public.intent_card_catalog enable trigger immutable_intent_catalog;
alter table public.intent_card_catalog drop constraint intent_card_catalog_card_key_check;
alter table public.intent_card_catalog add constraint intent_card_catalog_card_key_check check(card_key in ('charm','insight','flirt','rumor'));
create or replace function public.complete_brew(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_perfect_ticks integer,
  p_good_ticks integer,
  p_total_ticks integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves%rowtype;
  v_session public.brew_sessions%rowtype;
  v_action public.craft_actions%rowtype;
  v_result jsonb;
  v_beverage_id uuid := extensions.gen_random_uuid();
  v_intent_card_id uuid;
  v_stir_score smallint;
  v_quality smallint;
  v_name text;
  v_card_key text;
  v_tier text;
  v_target_ticks integer;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0
    or p_perfect_ticks is null or p_good_ticks is null or p_total_ticks is null
    or p_perfect_ticks < 0 or p_good_ticks < 0 or p_total_ticks < 0
    or p_total_ticks > 160 or p_perfect_ticks + p_good_ticks > p_total_ticks then
    raise sqlstate 'PT400' using message = 'Invalid brew completion';
  end if;

  select s.* into v_save from public.tavern_saves s
  where s.id = p_save_id and s.user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or brew not found'; end if;

  select a.* into v_action from public.craft_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    if v_action.command_kind = 'complete_brew' and v_action.subject_id = p_session_id
      and v_action.input_expected_revision = p_expected_revision
      and v_action.input_perfect_ticks = p_perfect_ticks
      and v_action.input_good_ticks = p_good_ticks
      and v_action.input_total_ticks = p_total_ticks then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before bottling';
  end if;

  select brew.* into v_session from public.brew_sessions brew
  where brew.save_id = p_save_id and brew.id = p_session_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or brew not found'; end if;
  if v_session.status <> 'active' then raise sqlstate 'PT409' using message = 'This brew is already complete'; end if;
  if v_session.day_number <> v_save.current_day then
    raise sqlstate 'PT422' using message = 'This brew cannot be completed on the current tavern day';
  end if;

  v_target_ticks := v_session.duration_seconds * 4;
  if p_total_ticks <> v_target_ticks then
    raise sqlstate 'PT400' using message = 'Guided stirring requires a complete scoring record';
  end if;
  if clock_timestamp() < v_session.started_at
    + make_interval(secs => v_session.countdown_seconds + v_session.duration_seconds) then
    raise sqlstate 'PT422' using message = 'The guided stir is still in progress';
  end if;

  perform 1 from public.ingredient_batches batch
  where batch.save_id = p_save_id and batch.id = v_session.ingredient_batch_id
    and batch.quantity > batch.consumed_quantity for update;
  if not found then raise sqlstate 'PT409' using message = 'The selected ingredient is no longer available'; end if;

  v_stir_score := least(6, greatest(0,
    round(6.0 * (p_perfect_ticks + p_good_ticks * 0.5) / v_target_ticks)
  ))::smallint;
  v_quality := least(6, greatest(0,
    round((v_session.ingredient_quality_index::numeric + v_stir_score::numeric) / 2.0)
      + case when v_session.ingredient_brew_bonus >= 4 then 1 else 0 end
  ))::smallint;
  v_name := private.brew_name(v_quality);

  insert into public.beverages
    (id, save_id, brew_session_id, ingredient_batch_id, rules_version, name, quality_index)
  values
    (v_beverage_id, p_save_id, p_session_id, v_session.ingredient_batch_id,
     v_session.rules_version, v_name, v_quality);

  if v_quality >= 2 then
    v_card_key := case when v_quality >= 5 then 'flirt' when v_quality >= 4 then 'insight' else 'charm' end;
    v_tier := case when v_quality >= 5 then 'exceptional' when v_quality >= 4 then 'superior' else 'fine' end;
    insert into public.intent_cards
      (save_id, card_key, tier, source_kind, source_key, source_beverage_id)
    values
      (p_save_id, v_card_key, v_tier, 'brew', v_beverage_id::text, v_beverage_id)
    returning id into v_intent_card_id;
  end if;

  update public.ingredient_batches set consumed_quantity = consumed_quantity + 1
  where save_id = p_save_id and id = v_session.ingredient_batch_id;

  update public.brew_sessions
  set status = 'completed', completed_at = clock_timestamp(),
      perfect_ticks = p_perfect_ticks, good_ticks = p_good_ticks,
      total_ticks = p_total_ticks, stir_score = v_stir_score, quality_index = v_quality
  where save_id = p_save_id and id = p_session_id;

  update public.tavern_saves
  set revision = revision + 1, day_minigame_completed = true,
      daily_craft_kind = null, updated_at = now()
  where id = p_save_id;

  v_result := jsonb_build_object(
    'actionId', p_action_id,
    'sessionId', p_session_id,
    'beverageId', v_beverage_id,
    'beverageName', v_name,
    'qualityIndex', v_quality,
    'stirScore', v_stir_score,
    'intentCardId', v_intent_card_id,
    'intentCardKey', v_card_key,
    'intentCardTier', v_tier,
    'committedRevision', v_save.revision + 1,
    'dayNumber', v_save.current_day,
    'rulesVersion', 'brew-v2'
  );

  insert into public.craft_actions
    (save_id, action_id, actor_id, command_kind, subject_id,
     input_expected_revision, input_perfect_ticks, input_good_ticks,
     input_total_ticks, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'complete_brew', p_session_id,
     p_expected_revision, p_perfect_ticks, p_good_ticks, p_total_ticks,
     v_result, v_save.revision + 1);

  return v_result;
end;
$$;
create or replace function private.ensure_intent_cards(p_save uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.intent_cards (save_id, card_key, tier, source_kind, source_key)
  values
    (p_save, 'charm', 'fine', 'starter', 'starter-charm'),
    (p_save, 'insight', 'fine', 'starter', 'starter-insight'),
    (p_save, 'flirt', 'fine', 'starter', 'starter-flirt'),
    (p_save, 'rumor', 'fine', 'starter', 'starter-rumor')
  on conflict (save_id, source_kind, source_key) do nothing;
$$;

-- One stable template per recipe; variations are read from existing batch provenance.
create function private.service_item_projection(p_save uuid,p_kind text,p_item uuid) returns jsonb
language sql stable security definer set search_path='' as $f$
 with item as (
  select beverage.id,'beverage'::text kind,beverage.quality_index,beverage.ingredient_batch_id,
    'brewed-drink'::text product_key,beverage.name fallback
  from public.beverages beverage where beverage.save_id=p_save and beverage.id=p_item and p_kind='beverage'
  union all
  select food.id,'food',food.quality_index,food.ingredient_batch_id,food.recipe_key,food.name
  from public.foods food where food.save_id=p_save and food.id=p_item and p_kind='food'
 ), provenance as (
  select item.*,coalesce(batch.plant_key,'unknown') ingredient_type,
    coalesce(catalog.display_name,'Unknown ingredient') ingredient_name
  from item left join public.ingredient_batches batch on batch.id=item.ingredient_batch_id and batch.save_id=p_save
  left join public.plant_catalog catalog on catalog.plant_key=batch.plant_key and catalog.rules_version=batch.rules_version
 )
 select jsonb_build_object('id',id,'kind',kind,'productKey',coalesce(product_key,'legacy-food'),
  'ingredientType',ingredient_type,'ingredientName',ingredient_name,'qualityIndex',quality_index,
  'name',case when ingredient_type='unknown' then fallback when kind='food' then ingredient_name||' Bread'
    when ingredient_type='hops' then 'Hop Beer' when ingredient_type like '%honey%' then 'Honey Mead'
    else ingredient_name||' Mead' end)
 from provenance
$f$;
revoke all on function private.service_item_projection(uuid,text,uuid) from public,anon,authenticated;

alter function public.npc_bar_summary() rename to npc_bar_summary_before_issue37;
alter function public.npc_bar_summary_before_issue37() set schema private;
create function public.npc_bar_summary() returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; v_save uuid; food_items jsonb; drink_items jsonb;
begin
 result:=private.npc_bar_summary_before_issue37(); if result is null then return null; end if;
 v_save:=(result#>>'{save,id}')::uuid;
 select coalesce(jsonb_agg(private.service_item_projection(v_save,'food',food.id) order by food.created_at,food.id),'[]') into food_items
 from public.foods food where food.save_id=v_save and not exists(select 1 from private.world_npc_hospitality_events e where e.save_id=v_save and e.food_id=food.id);
 select coalesce(jsonb_agg(private.service_item_projection(v_save,'beverage',drink.id) order by drink.created_at,drink.id),'[]') into drink_items
 from public.beverages drink where drink.save_id=v_save and not exists(select 1 from private.world_npc_hospitality_events e where e.save_id=v_save and e.beverage_id=drink.id);
 return jsonb_set(jsonb_set(result,'{offerings,foods}',food_items),'{offerings,beverages}',drink_items);
end $f$;
revoke all on function private.npc_bar_summary_before_issue37() from public,anon,authenticated,service_role;
revoke all on function public.npc_bar_summary() from public,anon;
grant execute on function public.npc_bar_summary() to authenticated;

-- Keep the exact existing admission/frozen retry fence; prohibit competing card resources.
alter function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid) rename to npc_dialogue_begin_before_issue37;
alter function public.npc_dialogue_begin_before_issue37(uuid,uuid,uuid,text,bigint,uuid,text,uuid) set schema private;
create function public.npc_dialogue_begin(p_actor uuid,p_turn_id uuid,p_npc_id uuid,p_message text,p_expected_sequence bigint,p_intent_card_id uuid default null,p_offering_kind text default null,p_offering_item_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
begin
 if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
 if p_intent_card_id is not null and (p_offering_kind is not null or p_offering_item_id is not null) then
  raise sqlstate 'PT400' using message='Choose one conversation card or service card';
 end if;
 return private.npc_dialogue_begin_before_issue37(p_actor,p_turn_id,p_npc_id,p_message,p_expected_sequence,p_intent_card_id,p_offering_kind,p_offering_item_id);
end $f$;
revoke all on function private.npc_dialogue_begin_before_issue37(uuid,uuid,uuid,text,bigint,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid) to service_role;

alter function public.npc_dialogue_context(uuid,uuid,text,text) rename to npc_dialogue_context_before_issue37;
alter function public.npc_dialogue_context_before_issue37(uuid,uuid,text,text) set schema private;
create function public.npc_dialogue_context(p_actor uuid,p_turn_id uuid,p_category text default 'base',p_query text default '')
returns jsonb language plpgsql security definer set search_path='' as $f$
declare result jsonb; t private.world_npc_dialogue_turns; item jsonb;
begin
 result:=private.npc_dialogue_context_before_issue37(p_actor,p_turn_id,p_category,p_query);
 if p_category='base' then
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor;
  if t.offering_kind is not null then
   item:=private.service_item_projection(t.save_id,t.offering_kind,t.offering_item_id);
   result:=jsonb_set(result,'{hospitality}',(result->'hospitality')||jsonb_build_object('itemName',item->>'name','productKey',item->>'productKey','ingredientType',item->>'ingredientType','ingredientName',item->>'ingredientName','qualityIndex',item->'qualityIndex'));
  end if;
 end if;
 return result;
end $f$;
revoke all on function private.npc_dialogue_context_before_issue37(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.npc_dialogue_context(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.npc_dialogue_context(uuid,uuid,text,text) to service_role;

-- Wrap the existing final-quality/keepsake payout without duplicating its effects.
alter function private.world_npc_apply_hospitality(uuid,uuid,uuid,text,uuid,uuid,bigint) rename to world_npc_apply_hospitality_before_issue37;
create function private.world_npc_apply_hospitality(p_actor uuid,p_save uuid,p_instance uuid,p_kind text,p_item uuid,p_action uuid,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_result jsonb; item jsonb;
begin
 v_result:=private.world_npc_apply_hospitality_before_issue37(p_actor,p_save,p_instance,p_kind,p_item,p_action,p_revision);
 item:=private.service_item_projection(p_save,p_kind,p_item);
 v_result:=v_result||jsonb_build_object('itemName',item->>'name','productKey',item->>'productKey','ingredientType',item->>'ingredientType','ingredientName',item->>'ingredientName');
 update private.world_npc_hospitality_events set result=v_result,item_name=item->>'name' where save_id=p_save and action_id=p_action;
 return v_result;
end $f$;
revoke all on function private.world_npc_apply_hospitality_before_issue37(uuid,uuid,uuid,text,uuid,uuid,bigint),private.world_npc_apply_hospitality(uuid,uuid,uuid,text,uuid,uuid,bigint) from public,anon,authenticated;
-- Gameplay routes expose service-card Talk only; retain the shared legacy RPC for reward parity.

create table private.codex_report_reads (
 save_id uuid not null references public.tavern_saves(id) on delete cascade,
 report_id text not null, notified_at timestamptz, read_at timestamptz,
 primary key(save_id,report_id)
);
revoke all on table private.codex_report_reads from public,anon,authenticated;

create function private.tavern_reports(p_save uuid) returns jsonb
language sql stable security definer set search_path='' as $f$
 with reports as (
  select 'arrival:'||arrival.save_id||':'||arrival.day id,arrival.day as day_number,
    (version.sheet#>>'{identity,name}')||' has arrived at the tavern.' text,resident.id instance_id,arrival.day::text sort
  from private.world_npc_arrival_receipts arrival
  join private.world_npc_instances resident on resident.save_id=arrival.save_id and resident.npc_id=(arrival.result->>'npcId')::uuid
  join private.npc_versions version on version.id=resident.version_id
  where arrival.save_id=p_save and arrival.result->>'arrived'='true'
  union all
  select 'departure:'||departure.instance_id,departure.farewell_day,coalesce(departure.public_news,departure.farewell_text),departure.instance_id,departure.farewell_day::text
  from private.world_npc_departures departure where departure.save_id=p_save and coalesce(departure.public_news,departure.farewell_text) is not null
  union all
  select 'quest:'||event.id,event.day_number,event.narration,event.instance_id,event.created_at::text
  from private.world_quest_events event where event.save_id=p_save and event.public_news
  union all
  select 'world:'||event.save_id||':'||event.canonical_entity_id||':'||event.template_key||':'||event.day_number,event.day_number,event.title||': '||event.summary,null::uuid,event.created_at::text
  from private.world_procedural_public_events event where event.save_id=p_save
 ), meaningful as (
  select distinct on (id) * from reports where coalesce(btrim(text),'')<>''
   and text !~* '^(The tavern is ready|The tavern opened without a new report)' order by id,day_number desc,sort desc
 ), recent as (select * from meaningful order by day_number desc,sort desc)
 select coalesce(jsonb_agg(jsonb_build_object('id',recent.id,'text',recent.text,'day',recent.day_number,'instanceId',recent.instance_id,
  'unread',receipt.read_at is null,'notified',receipt.notified_at is not null) order by recent.day_number desc,recent.sort desc),'[]')
 from recent left join private.codex_report_reads receipt on receipt.save_id=p_save and receipt.report_id=recent.id
$f$;
revoke all on function private.tavern_reports(uuid) from public,anon,authenticated;
create function public.codex_tavern_reports() returns jsonb language sql stable security definer set search_path='' as $f$
 select coalesce(private.tavern_reports((select id from public.tavern_saves where user_id=auth.uid() limit 1)),'[]')
$f$;
revoke all on function public.codex_tavern_reports() from public,anon;
grant execute on function public.codex_tavern_reports() to authenticated;
create function public.codex_reports_ack(p_report_ids text[],p_read boolean default true) returns void
language plpgsql security definer set search_path='' as $f$
declare v_save uuid;
begin
 if auth.uid() is null then raise sqlstate 'PT401'; end if;
 if p_report_ids is null or cardinality(p_report_ids)>100 then raise sqlstate 'PT400'; end if;
 select id into v_save from public.tavern_saves where user_id=auth.uid();
 if v_save is null then raise sqlstate 'PT404'; end if;
 insert into private.codex_report_reads(save_id,report_id,notified_at,read_at)
 select v_save,report->>'id',now(),case when p_read then now() end
 from jsonb_array_elements(private.tavern_reports(v_save)) report where report->>'id'=any(p_report_ids)
 on conflict(save_id,report_id) do update set notified_at=coalesce(codex_report_reads.notified_at,excluded.notified_at),read_at=coalesce(codex_report_reads.read_at,excluded.read_at);
end $f$;
revoke all on function public.codex_reports_ack(text[],boolean) from public,anon;
grant execute on function public.codex_reports_ack(text[],boolean) to authenticated;

create function public.npc_hospitality_history(p_instance_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $f$
 select coalesce(jsonb_agg(event.result order by event.created_at),'[]')
 from private.world_npc_hospitality_events event join public.tavern_saves save on save.id=event.save_id
 where save.user_id=auth.uid() and event.instance_id=any(p_instance_ids)
$f$;
revoke all on function public.npc_hospitality_history(uuid[]) from public,anon;
grant execute on function public.npc_hospitality_history(uuid[]) to authenticated;
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
      order by input_sequence desc
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
      where instance_id=resident.id order by created_at desc
    ) entry
  ) evolution on true
  where save_row.user_id=auth.uid() and resident.id=any(p_instance_ids)
$function$;

commit;
