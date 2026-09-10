-- Version and persist the corrected dialogue interaction contract.
begin;

alter table public.dialogue_turns
  add column interaction_version text not null default 'dialogue-v1',
  add column intent_card_id uuid,
  add column offering_kind text,
  add column offering_beverage_id uuid,
  add column offering_food_id uuid;

alter table public.dialogue_turns
  add foreign key (save_id, intent_card_id)
    references public.intent_cards(save_id, id),
  add foreign key (save_id, offering_beverage_id)
    references public.beverages(save_id, id),
  add foreign key (save_id, offering_food_id)
    references public.foods(save_id, id),
  add constraint dialogue_interaction_version_check check (
    (interaction_version = 'dialogue-v1'
      and intent_card_id is null and offering_kind is null
      and offering_beverage_id is null and offering_food_id is null)
    or
    (interaction_version = 'dialogue-v2'
      and beverage_id is null and card_id is null
      and (
        (offering_kind is null and offering_beverage_id is null and offering_food_id is null)
        or (offering_kind = 'beverage' and offering_beverage_id is not null and offering_food_id is null)
        or (offering_kind = 'food' and offering_food_id is not null and offering_beverage_id is null)
      ))
  );

-- In-flight v1 provider work cannot be reinterpreted as v2. It spends nothing
-- and is fenced before any v2 request can reuse the conversation sequence.
update private.npc_attempts a set status = 'stale', finished_at = now(), error_code = 'INTERACTION_UPGRADED'
from public.dialogue_turns t
where a.turn_id = t.id and t.interaction_version = 'dialogue-v1'
  and t.status in ('processing', 'failed') and a.status in ('processing', 'failed');
update public.dialogue_turns set status = 'stale', fence = extensions.gen_random_uuid(),
  error_code = 'INTERACTION_UPGRADED'
where interaction_version = 'dialogue-v1' and status in ('processing', 'failed');
alter table public.dialogue_turns alter column interaction_version set default 'dialogue-v2';

drop function public.dialogue_begin(uuid, uuid, text, text, bigint, uuid, uuid);
create function public.dialogue_begin(
  p_actor uuid,
  p_turn uuid,
  p_patron text,
  p_message text,
  p_sequence bigint,
  p_intent_card uuid default null,
  p_offering_kind text default null,
  p_offering_item uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.tavern_saves;
  t public.dialogue_turns;
  life private.npc_lives;
  recent_count integer;
  usage private.npc_usage;
  rules private.npc_rules;
  content text;
begin
  select * into s from public.tavern_saves where user_id = p_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Start a tavern before talking'; end if;
  if p_turn is null or p_sequence is null or p_sequence < 0 or p_message is null
    or char_length(btrim(p_message)) not between 1 and 2000
    or (p_offering_kind is null) <> (p_offering_item is null)
    or p_offering_kind is not null and p_offering_kind not in ('beverage', 'food') then
    raise sqlstate 'PT400' using message = 'Enter a message and choose a valid optional intent and offering';
  end if;

  select * into t from public.dialogue_turns where id = p_turn;
  if found then
    if t.interaction_version <> 'dialogue-v2' or t.actor_id <> p_actor
      or t.patron_key <> p_patron or t.message <> p_message or t.input_sequence <> p_sequence
      or t.intent_card_id is distinct from p_intent_card
      or t.offering_kind is distinct from p_offering_kind
      or coalesce(t.offering_beverage_id, t.offering_food_id) is distinct from p_offering_item then
      raise sqlstate 'PT409' using message = 'Turn identifier already used for different input';
    end if;
    if t.status = 'completed' then return to_jsonb(t); end if;
    if t.status in ('cancelled', 'stale') then
      raise sqlstate 'PT409' using message = 'This turn is closed; send a new message';
    end if;
    if t.status = 'processing' and t.lease_until > now() then
      return to_jsonb(t) || '{"busy":true}'::jsonb;
    end if;
    if t.source_revision <> s.revision or t.day <> s.current_day then
      update public.dialogue_turns set status = 'stale', error_code = 'STATE_CHANGED' where id = t.id;
      update private.npc_attempts set status = 'stale', finished_at = now()
      where turn_id = t.id and status = 'processing';
      return jsonb_build_object('status', 'stale');
    end if;
  end if;

  perform private.ensure_npcs(s.id);
  select * into life from private.npc_lives where save_id = s.id and patron_key = p_patron;
  if not found or life.availability <> 'present' then
    raise sqlstate 'PT422' using message = 'This patron is not available';
  end if;
  if life.sequence <> p_sequence then
    raise sqlstate 'PT409' using message = 'Conversation changed; refresh before replying';
  end if;
  if exists (select 1 from public.brew_sessions where save_id = s.id and status = 'active') then
    raise sqlstate 'PT422' using message = 'Finish your active brew before talking';
  end if;
  if exists (
    select 1 from public.dialogue_turns
    where save_id = s.id and id <> p_turn and status = 'processing' and lease_until > now()
  ) then raise sqlstate 'PT409' using message = 'Another conversation is still being completed'; end if;

  if p_intent_card is not null and not exists (
    select 1 from public.intent_cards card
    where card.save_id = s.id and card.id = p_intent_card and not exists (
      select 1 from public.intent_card_plays play
      where play.save_id = s.id and play.card_id = card.id
    )
  ) then raise sqlstate 'PT409' using message = 'Intent card no longer available'; end if;

  if p_offering_kind = 'beverage' and not exists (
    select 1 from public.beverages item
    where item.save_id = s.id and item.id = p_offering_item and not exists (
      select 1 from public.hospitality_events event
      where event.save_id = s.id and event.beverage_id = item.id
    )
  ) then raise sqlstate 'PT409' using message = 'Drink no longer available'; end if;
  if p_offering_kind = 'food' and not exists (
    select 1 from public.foods item
    where item.save_id = s.id and item.id = p_offering_item and not exists (
      select 1 from public.hospitality_events event
      where event.save_id = s.id and event.food_id = item.id
    )
  ) then raise sqlstate 'PT409' using message = 'Food no longer available'; end if;

  if t.id is null then
    insert into private.npc_usage(actor_id, day)
    values (p_actor, (now() at time zone 'UTC')::date) on conflict do nothing;
    select * into usage from private.npc_usage
    where actor_id = p_actor and day = (now() at time zone 'UTC')::date;
    select count(*) into recent_count from public.dialogue_turns
    where actor_id = p_actor and created_at > now() - interval '1 minute';
    select * into rules from private.npc_rules where version = 'npc-rules-v1';
    if recent_count >= rules.turns_per_minute or usage.turns >= rules.turns_per_day then
      raise sqlstate 'PT429' using message = 'Conversation limit reached; please return later';
    end if;
    update private.npc_usage set turns = turns + 1
    where actor_id = p_actor and day = usage.day;
    select content_version into content from private.npc_quests
    where save_id = s.id and patron_key = p_patron
    order by (status = 'active') desc, created_at desc limit 1;
    insert into public.dialogue_turns (
      id, save_id, actor_id, patron_key, message, input_sequence,
      interaction_version, intent_card_id, offering_kind,
      offering_beverage_id, offering_food_id, source_revision, day,
      status, lease_until, content_version
    ) values (
      p_turn, s.id, p_actor, p_patron, p_message, p_sequence,
      'dialogue-v2', p_intent_card, p_offering_kind,
      case when p_offering_kind = 'beverage' then p_offering_item end,
      case when p_offering_kind = 'food' then p_offering_item end,
      s.revision, s.current_day, 'processing', now() + interval '120 seconds', content
    ) returning * into t;
  else
    select * into usage from private.npc_usage
    where actor_id = p_actor and day = (now() at time zone 'UTC')::date;
    select * into rules from private.npc_rules where version = 'npc-rules-v1';
    if coalesce(usage.turns, 0) >= rules.turns_per_day then
      raise sqlstate 'PT429' using message = 'Conversation attempt limit reached';
    end if;
    insert into private.npc_usage(actor_id, day, turns)
    values (p_actor, (now() at time zone 'UTC')::date, 1)
    on conflict (actor_id, day) do update set turns = private.npc_usage.turns + 1;
    update public.dialogue_turns set status = 'processing', fence = extensions.gen_random_uuid(),
      lease_until = now() + interval '120 seconds', error_code = null
    where id = p_turn returning * into t;
  end if;
  update private.npc_attempts set status = 'expired', finished_at = now()
  where turn_id = t.id and status = 'processing';
  insert into private.npc_attempts(turn_id, fence) values (t.id, t.fence);
  return to_jsonb(t);
end;
$$;
revoke all on function public.dialogue_begin(uuid, uuid, text, text, bigint, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.dialogue_begin(uuid, uuid, text, text, bigint, uuid, text, uuid)
  to service_role;

create or replace function public.dialogue_context(
  p_actor uuid,
  p_turn uuid,
  p_category text default 'base',
  p_query text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.dialogue_turns;
  content jsonb;
  quest private.npc_quests;
  relationship integer;
  beverage public.beverages;
  food public.foods;
  card public.intent_cards;
  catalog public.intent_card_catalog;
  price integer;
  quality integer;
  item_name text;
begin
  select * into t from public.dialogue_turns where id = p_turn and actor_id = p_actor;
  if not found then raise sqlstate 'PT404' using message = 'Turn not found'; end if;
  select sheet into content from private.npc_content_versions
  where patron_key = t.patron_key and version = t.content_version;
  select ps.relationship into relationship from public.patron_states ps
  where ps.save_id = t.save_id and ps.patron_key = t.patron_key;
  select * into quest from private.npc_quests
  where save_id = t.save_id and patron_key = t.patron_key
  order by (status = 'active') desc, created_at desc limit 1;

  if p_category = 'base' then
    if t.intent_card_id is not null then
      select * into card from public.intent_cards c
      where c.save_id = t.save_id and c.id = t.intent_card_id;
      select * into catalog from public.intent_card_catalog cc
      where cc.card_key = card.card_key and cc.version = card.catalog_version;
    end if;
    if t.offering_kind = 'beverage' then
      select * into beverage from public.beverages
      where id = t.offering_beverage_id and save_id = t.save_id;
      quality := beverage.quality_index;
      item_name := beverage.name;
    elsif t.offering_kind = 'food' then
      select * into food from public.foods
      where id = t.offering_food_id and save_id = t.save_id;
      quality := food.quality_index;
      item_name := food.name;
    end if;
    if t.offering_kind is not null then
      select prices[quality + 1] into price from public.patron_catalog
      where patron_key = t.patron_key;
    end if;
    return jsonb_build_object(
      'name', content->'name', 'voice', content->'voice',
      'personality', content->'personality',
      'entities', (select jsonb_agg(distinct entity)
        from jsonb_array_elements_text((content->'quest'->'targets') || jsonb_build_array('lira', 'torvin')) entity),
      'contentVersion', t.content_version,
      'interactionVersion', t.interaction_version,
      'allowedTargets', private.npc_targets(t.save_id, t.patron_key, t.content_version),
      'relationship', relationship, 'questStatus', quest.status,
      'intention', quest.intention, 'day', t.day, 'message', t.message,
      'recent', coalesce((select jsonb_agg(recent.item order by recent.seq) from (
        select input_sequence seq, jsonb_build_object(
          'id', id, 'keeper', message, 'npc', result->'reply'
        ) item from public.dialogue_turns
        where save_id = t.save_id and patron_key = t.patron_key and status = 'completed'
        order by input_sequence desc limit 6
      ) recent), '[]'::jsonb),
      'playerIntent', case when card.id is null then null else jsonb_build_object(
        'id', card.id, 'cardKey', card.card_key, 'displayName', catalog.display_name,
        'description', catalog.description, 'promptInstruction', catalog.prompt_instruction,
        'tier', card.tier
      ) end,
      'hospitality', case when t.offering_kind is null then null else jsonb_build_object(
        'itemKind', t.offering_kind, 'itemName', item_name,
        'quality', quality,
        'qualityLabel', (array['Repugnant', 'Awful', 'Potable', 'Decent', 'Great', 'Legendary', 'Resplendent'])[quality + 1],
        'gold', price,
        'relationshipChange', case when quality >= 4 then 6 when quality >= 2 then 3 when quality = 1 then -2 else -4 end
      ) end
    );
  elsif p_category in ('history', 'relationships') then
    return jsonb_build_object(
      'facts', coalesce((select jsonb_agg(fact) from jsonb_array_elements(content->'facts') fact
        where fact->>'category' = p_category and (fact->>'minTrust')::integer <= relationship), '[]'::jsonb),
      'relationships', case when p_category = 'relationships' then content->'relationships' else '[]'::jsonb end
    );
  elsif p_category in ('quests', 'news') then
    return jsonb_build_object(
      'quest', case when p_category = 'quests' then jsonb_build_object(
        'id', quest.id, 'status', quest.status, 'intention', quest.intention,
        'preparation', quest.preparation, 'nextStep', quest.step
      ) else null end,
      'events', coalesce((select jsonb_agg(events.item) from (
        select jsonb_build_object(
          'id', id, 'patron', patron_key, 'day', day, 'text', text, 'outcome', outcome
        ) item from private.npc_events
        where save_id = t.save_id and (patron_key = t.patron_key or public_news and day < t.day)
          and (p_category <> 'news' or public_news and day < t.day)
        order by day desc limit 12
      ) events), '[]'::jsonb)
    );
  elsif p_category = 'memories' then
    return coalesce((select jsonb_agg(memories.item) from (
      select jsonb_build_object(
        'id', id, 'sourceTurn', turn_id, 'kind', kind, 'text', text,
        'quote', quote, 'speaker', speaker, 'importance', importance, 'entities', entity_refs
      ) item from private.npc_memories
      where save_id = t.save_id and patron_key = t.patron_key
      order by case when btrim(p_query) = '' then 0
        else ts_rank(search, websearch_to_tsquery('english', left(p_query, 200)))
          + case when exists (select 1 from unnest(entity_refs) entity
            where position(replace(entity, '-', ' ') in lower(p_query)) > 0) then 1 else 0 end
        end desc,
        importance desc, created_at desc limit 8
    ) memories), '[]'::jsonb);
  end if;
  raise sqlstate 'PT400' using message = 'Unknown context category';
end;
$$;

create or replace function public.dialogue_complete(p_actor uuid, p_turn uuid, p_fence uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  t public.dialogue_turns;
  s public.tavern_saves;
  life private.npc_lives;
  quest private.npc_quests;
  decision jsonb;
  memory jsonb;
  step jsonb;
  reply text;
  hospitality jsonb;
  intent public.intent_cards;
  catalog public.intent_card_catalog;
  reaction integer;
  delta integer := 0;
  relationship integer;
  before_relationship integer;
  budget integer;
  result jsonb;
  changed boolean := false;
  intention jsonb;
  quote text;
begin
  select * into s from public.tavern_saves where user_id = p_actor for update;
  select * into t from public.dialogue_turns where id = p_turn and actor_id = p_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Turn not found'; end if;
  if t.status = 'completed' then return t.result; end if;
  if t.interaction_version <> 'dialogue-v2' then
    raise sqlstate 'PT409' using message = 'This earlier interaction cannot be resumed';
  end if;
  if t.fence <> p_fence or t.status <> 'processing' or t.lease_until < now() then
    raise sqlstate 'PT409' using message = 'Conversation attempt expired';
  end if;
  select * into life from private.npc_lives
  where save_id = s.id and patron_key = t.patron_key;
  if s.revision <> t.source_revision or s.current_day <> t.day
    or life.sequence <> t.input_sequence or life.availability <> 'present' then
    update public.dialogue_turns set status = 'stale', error_code = 'STATE_CHANGED' where id = t.id;
    update private.npc_attempts set status = 'stale', finished_at = now()
    where turn_id = t.id and status = 'processing';
    return jsonb_build_object('status', 'stale');
  end if;
  if coalesce((coalesce(t.checkpoints->'rereview', t.checkpoints->'review')->'value'->>'ok')::boolean, false) is not true then
    raise sqlstate 'PT422' using message = 'Response has not passed consistency review';
  end if;
  reply := coalesce(t.checkpoints->'rewrite', t.checkpoints->'speak')->'value'->>'text';
  decision := t.checkpoints->'decision'->'value';
  if reply is null or char_length(reply) not between 1 and 4000 or decision is null then
    raise sqlstate 'PT400' using message = 'Invalid reply';
  end if;
  if not coalesce(
    decision->>'stance' in ('agree', 'refuse', 'clarify', 'respond')
    and decision->>'subject' in ('quest', 'personal', 'hospitality')
    and decision->>'reaction' in ('-1', '0', '1'), false
  ) then raise sqlstate 'PT400' using message = 'Invalid decision'; end if;
  reaction := (decision->>'reaction')::integer;
  if reaction <> 0 and (
    coalesce(char_length(decision->>'evidence'), 0) < 3
    or position(decision->>'evidence' in t.message) = 0
  ) then raise sqlstate 'PT400' using message = 'Reaction needs source evidence'; end if;

  select * into quest from private.npc_quests
  where save_id = s.id and patron_key = t.patron_key
  order by (status = 'active') desc, created_at desc limit 1;
  intention := nullif(decision->'intention', 'null'::jsonb);
  if intention is not null then
    if not coalesce(
      jsonb_typeof(intention) = 'object'
      and jsonb_typeof(intention->'goal') = 'string'
      and jsonb_typeof(intention->'motivation') = 'string'
      and jsonb_typeof(intention->'steps') = 'array'
      and jsonb_typeof(intention->'targets') = 'array', false
    ) then raise sqlstate 'PT400' using message = 'Invalid intention shape'; end if;
    if decision->>'stance' <> 'agree'
      or (quest.status <> 'active' and intention->>'goal' = quest.intention->>'goal')
      or char_length(intention->>'goal') not between 1 and 300
      or char_length(intention->>'motivation') not between 1 and 300
      or jsonb_array_length(intention->'steps') not between 1 and 3
      or jsonb_array_length(intention->'targets') not between 1 and 5 then
      raise sqlstate 'PT400' using message = 'Invalid intention';
    end if;
    for step in select value from jsonb_array_elements(intention->'steps') loop
      if not coalesce(
        step->>'action' in ('prepare', 'attempt', 'wait', 'abandon')
        and step->>'approach' in ('scouting', 'combat', 'diplomacy', 'trade'), false
      ) then raise sqlstate 'PT400' using message = 'Unsupported action'; end if;
    end loop;
    if intention->'steps'->-1->>'action' not in ('attempt', 'abandon') then
      raise sqlstate 'PT400' using message = 'A plan needs an attempt or abandonment after preparation or waiting';
    end if;
    if exists (select 1 from jsonb_array_elements_text(intention->'targets') target
      where not private.npc_targets(s.id, t.patron_key, t.content_version) ? target) then
      raise sqlstate 'PT400' using message = 'Unknown quest target';
    end if;
  end if;

  select ps.relationship into before_relationship from public.patron_states ps
  where ps.save_id = s.id and ps.patron_key = t.patron_key;

  if t.intent_card_id is not null then
    select * into intent from public.intent_cards c
    where c.save_id = s.id and c.id = t.intent_card_id
      and not exists (select 1 from public.intent_card_plays play
        where play.save_id = s.id and play.card_id = c.id);
    if not found then raise sqlstate 'PT409' using message = 'Intent card no longer available'; end if;
    select * into catalog from public.intent_card_catalog cc
    where cc.card_key = intent.card_key and cc.version = intent.catalog_version;
  end if;

  if t.offering_kind is not null then
    hospitality := private.apply_hospitality_v2(
      p_actor, s.id, t.patron_key, t.offering_kind,
      coalesce(t.offering_beverage_id, t.offering_food_id),
      null, t.id, s.revision, t.id
    );
  end if;

  if intent.id is not null then
    insert into public.intent_card_plays (
      save_id, turn_id, actor_id, patron_key, card_id, day_number, card_key, tier
    ) values (
      s.id, t.id, p_actor, t.patron_key, intent.id, t.day, intent.card_key, intent.tier
    );
    changed := true;
  end if;

  if reaction <> 0 and not exists (
    select 1 from private.npc_reactions
    where save_id = s.id and patron_key = t.patron_key and day = t.day
      and subject = decision->>'subject'
  ) then
    select coalesce(sum(abs(existing.delta)), 0) into budget
    from private.npc_reactions existing
    where save_id = s.id and patron_key = t.patron_key and day = t.day
      and sign(existing.delta) = reaction;
    if budget < 4 then
      delta := reaction * 2;
      insert into private.npc_reactions
      values (s.id, t.patron_key, t.day, decision->>'subject', delta, t.id);
      update public.patron_states set relationship = greatest(0, least(100, public.patron_states.relationship + delta)),
        updated_at = now()
      where save_id = s.id and patron_key = t.patron_key;
      changed := true;
    end if;
  end if;

  if intention is not null and intention <> quest.intention then
    if intention->>'goal' <> quest.intention->>'goal' then
      if quest.status = 'active' then
        update private.npc_quests set status = 'abandoned' where id = quest.id;
        insert into private.npc_events(
          save_id, patron_key, quest_id, day, outcome, text, content_version
        ) values (
          s.id, t.patron_key, quest.id, t.day, 'changed_goal',
          'The previous objective was abandoned: ' || (quest.intention->>'goal'),
          t.content_version
        ) on conflict do nothing;
      end if;
      insert into private.npc_quests(
        save_id, patron_key, intention, preparation, authored, content_version, created_at
      ) values (
        s.id, t.patron_key, intention,
        case when quest.status = 'active' then quest.preparation else 0 end,
        false, t.content_version, clock_timestamp()
      );
    else
      update private.npc_quests set intention = intention, step = 0 where id = quest.id;
    end if;
    changed := true;
  end if;

  if changed and hospitality is null then
    update public.tavern_saves set revision = revision + 1 where id = s.id;
  end if;
  select ps.relationship into relationship from public.patron_states ps
  where ps.save_id = s.id and ps.patron_key = t.patron_key;
  update private.npc_lives set sequence = sequence + 1
  where save_id = s.id and patron_key = t.patron_key;

  for memory in select value from jsonb_array_elements(
    coalesce(t.checkpoints->'remember'->'value'->'memories', '[]'::jsonb)
  ) limit 3 loop
    quote := memory->>'quote';
    if memory->>'kind' in ('keeper_claim', 'npc_statement', 'promise', 'interaction')
      and char_length(memory->>'text') between 1 and 500
      and (memory->>'text') !~* '\m(player|npc|assistant|system)\M'
      and char_length(quote) >= 3
      and (
        memory->>'speaker' = 'keeper' and position(quote in t.message) > 0
        or memory->>'speaker' = 'npc' and position(quote in reply) > 0
      ) then
      insert into private.npc_memories(
        turn_id, save_id, patron_key, kind, text, quote, speaker, importance, entity_refs
      ) values (
        t.id, s.id, t.patron_key, memory->>'kind', memory->>'text', quote,
        memory->>'speaker',
        case when memory->>'kind' = 'promise' then 3
          when memory->>'kind' = 'keeper_claim' then 1 else 2 end,
        array(select entity from jsonb_array_elements_text(
          coalesce(t.checkpoints->'base'->'value'->'entities', '[]'::jsonb)
        ) entity where position(replace(entity, '-', ' ') in lower((memory->>'text') || ' ' || quote)) > 0)
      ) on conflict do nothing;
    end if;
  end loop;

  result := jsonb_build_object(
    'turnId', t.id, 'reply', reply, 'sequence', life.sequence + 1,
    'relationship', relationship,
    'relationshipChange', relationship - before_relationship,
    'serving', hospitality,
    'intentCard', case when intent.id is null then null else jsonb_build_object(
      'id', intent.id, 'cardKey', intent.card_key,
      'displayName', catalog.display_name, 'tier', intent.tier
    ) end,
    'intention', intention,
    'committedRevision', (select revision from public.tavern_saves where id = s.id)
  );
  update public.dialogue_turns set status = 'completed', result = result, completed_at = now()
  where id = t.id;
  update private.npc_attempts set status = 'completed', finished_at = now()
  where fence = p_fence;
  return result;
end;
$$;

create or replace function public.dialogue_status(p_turn uuid, p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.dialogue_turns;
  state text;
  call_limit integer;
  input jsonb;
begin
  perform 1 from public.tavern_saves where user_id = auth.uid() for update;
  select * into t from public.dialogue_turns where id = p_turn and actor_id = auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message = 'Turn not found'; end if;
  if p_cancel and t.status <> 'completed' then
    update private.npc_attempts set status = 'cancelled', finished_at = now()
    where turn_id = t.id and status = 'processing';
    update public.dialogue_turns set status = 'cancelled', fence = extensions.gen_random_uuid()
    where id = t.id returning * into t;
  end if;
  state := case when t.status = 'processing' and t.lease_until < now() then 'failed' else t.status end;
  select calls_per_turn into call_limit from private.npc_rules where version = t.rule_version;
  input := case when t.interaction_version = 'dialogue-v2' then jsonb_build_object(
    'turnId', t.id, 'patronKey', t.patron_key, 'message', t.message,
    'expectedConversationSequence', t.input_sequence,
    'interactionVersion', t.interaction_version,
    'intentCardId', t.intent_card_id,
    'offering', case when t.offering_kind is null then null else jsonb_build_object(
      'kind', t.offering_kind,
      'itemId', coalesce(t.offering_beverage_id, t.offering_food_id)
    ) end
  ) else jsonb_build_object(
    'turnId', t.id, 'patronKey', t.patron_key, 'message', t.message,
    'expectedConversationSequence', t.input_sequence,
    'beverageId', t.beverage_id, 'cardId', t.card_id
  ) end;
  return jsonb_build_object(
    'status', state, 'result', t.result, 'error', t.error_code,
    'canRetry', state = 'failed'
      and t.interaction_version = 'dialogue-v2'
      and coalesce(t.error_code not in ('CONSISTENCY', 'CONTEXT_BUDGET'), true)
      and (t.calls < call_limit or (
        coalesce((coalesce(t.checkpoints->'rereview', t.checkpoints->'review')->'value'->>'ok')::boolean, false)
        and (t.checkpoints ? 'remember' or not (
          coalesce((t.checkpoints->'investigate0'->'value'->>'remember')::boolean, false)
          or coalesce((t.checkpoints->'investigate1'->'value'->>'remember')::boolean, false)
          or coalesce(t.checkpoints->'decision'->'value'->>'reaction', '0') <> '0'
          or nullif(t.checkpoints->'decision'->'value'->'intention', 'null'::jsonb) is not null
        ))
      )),
    'input', input
  );
end;
$$;

revoke all on function public.dialogue_context(uuid, uuid, text, text),
  public.dialogue_complete(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.dialogue_context(uuid, uuid, text, text),
  public.dialogue_complete(uuid, uuid, uuid) to service_role;
revoke all on function public.dialogue_status(uuid, boolean) from public, anon;
grant execute on function public.dialogue_status(uuid, boolean) to authenticated;

commit;
