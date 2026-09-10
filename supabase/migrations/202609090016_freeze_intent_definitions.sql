-- Published intent definitions are append-only, and each turn/play records the
-- exact definition used even after a newer catalog version is published.
begin;

alter table public.intent_card_catalog
  drop constraint intent_card_catalog_version_check;
alter table public.intent_card_catalog
  add constraint intent_card_catalog_version_check
  check (version ~ '^intent-v[1-9][0-9]*$');

create function private.immutable_intent_catalog()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Published intent catalog entries are immutable';
end;
$$;
create trigger immutable_intent_catalog
  before update or delete on public.intent_card_catalog
  for each row execute function private.immutable_intent_catalog();

create function private.immutable_issued_intent_card()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Issued intent cards are immutable';
end;
$$;
create trigger immutable_issued_intent_card
  before update on public.intent_cards
  for each row execute function private.immutable_issued_intent_card();

alter table public.dialogue_turns add column intent_snapshot jsonb;

update public.dialogue_turns turn
set intent_snapshot = jsonb_build_object(
  'id', card.id,
  'cardKey', card.card_key,
  'catalogVersion', card.catalog_version,
  'displayName', catalog.display_name,
  'description', catalog.description,
  'promptInstruction', catalog.prompt_instruction,
  'tier', card.tier
)
from public.intent_cards card
join public.intent_card_catalog catalog
  on catalog.card_key = card.card_key and catalog.version = card.catalog_version
where turn.save_id = card.save_id and turn.intent_card_id = card.id;

alter table public.dialogue_turns add constraint dialogue_intent_snapshot_check check (
  interaction_version <> 'dialogue-v2'
  or (intent_card_id is null and intent_snapshot is null)
  or (intent_card_id is not null and intent_snapshot is not null
    and intent_snapshot->>'id' = intent_card_id::text)
);

create function private.freeze_dialogue_intent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.interaction_version = 'dialogue-v2' and new.intent_card_id is not null then
    select jsonb_build_object(
      'id', card.id,
      'cardKey', card.card_key,
      'catalogVersion', card.catalog_version,
      'displayName', catalog.display_name,
      'description', catalog.description,
      'promptInstruction', catalog.prompt_instruction,
      'tier', card.tier
    ) into new.intent_snapshot
    from public.intent_cards card
    join public.intent_card_catalog catalog
      on catalog.card_key = card.card_key and catalog.version = card.catalog_version
    where card.save_id = new.save_id and card.id = new.intent_card_id;
    if new.intent_snapshot is null then
      raise sqlstate 'PT409' using message = 'Intent card no longer available';
    end if;
  else
    new.intent_snapshot := null;
  end if;
  return new;
end;
$$;
create trigger freeze_dialogue_intent
  before insert on public.dialogue_turns
  for each row execute function private.freeze_dialogue_intent();

alter table public.intent_card_plays
  add column catalog_version text,
  add column intent_snapshot jsonb;

update public.intent_card_plays play
set catalog_version = card.catalog_version,
  intent_snapshot = jsonb_build_object(
    'id', card.id,
    'cardKey', card.card_key,
    'catalogVersion', card.catalog_version,
    'displayName', catalog.display_name,
    'description', catalog.description,
    'promptInstruction', catalog.prompt_instruction,
    'tier', card.tier
  )
from public.intent_cards card
join public.intent_card_catalog catalog
  on catalog.card_key = card.card_key and catalog.version = card.catalog_version
where play.save_id = card.save_id and play.card_id = card.id;

alter table public.intent_card_plays
  alter column catalog_version set not null,
  alter column intent_snapshot set not null,
  add foreign key (card_key, catalog_version)
    references public.intent_card_catalog(card_key, version),
  add constraint intent_play_snapshot_check check (
    intent_snapshot->>'id' = card_id::text
    and intent_snapshot->>'cardKey' = card_key
    and intent_snapshot->>'catalogVersion' = catalog_version
    and intent_snapshot->>'tier' = tier
  );

create function private.freeze_intent_play()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  frozen jsonb;
begin
  select turn.intent_snapshot into frozen
  from public.dialogue_turns turn
  where turn.id = new.turn_id and turn.save_id = new.save_id;
  if frozen is null
    or frozen->>'id' <> new.card_id::text
    or frozen->>'cardKey' <> new.card_key
    or frozen->>'tier' <> new.tier then
    raise sqlstate 'PT409' using message = 'Intent definition changed before completion';
  end if;
  new.catalog_version := frozen->>'catalogVersion';
  new.intent_snapshot := frozen;
  return new;
end;
$$;
create trigger freeze_intent_play
  before insert on public.intent_card_plays
  for each row execute function private.freeze_intent_play();

alter function public.dialogue_context(uuid, uuid, text, text)
  rename to dialogue_context_before_intent_freeze;
alter function public.dialogue_context_before_intent_freeze(uuid, uuid, text, text)
  set schema private;
revoke all on function private.dialogue_context_before_intent_freeze(uuid, uuid, text, text)
  from public, anon, authenticated;

create function public.dialogue_context(
  p_actor uuid,
  p_turn uuid,
  p_category text default 'base',
  p_query text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  frozen jsonb;
begin
  result := private.dialogue_context_before_intent_freeze(
    p_actor, p_turn, p_category, p_query
  );
  if p_category = 'base' then
    select turn.intent_snapshot into frozen
    from public.dialogue_turns turn
    where turn.id = p_turn and turn.actor_id = p_actor;
    result := jsonb_set(result, '{playerIntent}', coalesce(frozen, 'null'::jsonb), true);
  end if;
  return result;
end;
$$;
revoke all on function public.dialogue_context(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.dialogue_context(uuid, uuid, text, text)
  to service_role;

revoke all on function private.immutable_intent_catalog(),
  private.immutable_issued_intent_card(), private.freeze_dialogue_intent(),
  private.freeze_intent_play() from public, anon, authenticated;

commit;
