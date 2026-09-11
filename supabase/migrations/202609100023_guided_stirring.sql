-- Replace client-estimated RPM with a versioned, guided stirring challenge while
-- retaining historical Brewery sessions and exact command replay.
begin;

alter table public.brew_sessions
  add column countdown_seconds integer not null default 0,
  add column stir_rules_version text not null default 'rpm-v1';

alter table public.brew_sessions
  add constraint brew_sessions_countdown_seconds_check check (countdown_seconds >= 0),
  add constraint brew_sessions_stir_rules_version_check
    check (stir_rules_version in ('rpm-v1', 'guide-v2'));

alter table public.brew_sessions
  drop constraint if exists brew_sessions_duration_seconds_check;
alter table public.brew_sessions
  add constraint brew_sessions_stir_timing_check check (
    (stir_rules_version = 'rpm-v1' and duration_seconds = 30 and countdown_seconds = 0)
    or
    (stir_rules_version = 'guide-v2' and duration_seconds = 15 and countdown_seconds = 2)
  );

create or replace function public.start_brew(
  p_save_id uuid,
  p_ingredient_batch_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves%rowtype;
  v_batch public.ingredient_batches%rowtype;
  v_action public.craft_actions%rowtype;
  v_session_id uuid := extensions.gen_random_uuid();
  v_started_at timestamptz := clock_timestamp();
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_ingredient_batch_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid brew request';
  end if;

  select s.* into v_save from public.tavern_saves s
  where s.id = p_save_id and s.user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  select a.* into v_action from public.craft_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    if v_action.command_kind = 'start_brew' and v_action.subject_id = p_ingredient_batch_id
      and v_action.input_expected_revision = p_expected_revision then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before brewing';
  end if;
  if exists (
    select 1 from public.bake_sessions bake
    where bake.save_id = p_save_id and bake.status <> 'completed'
  ) then raise sqlstate 'PT422' using message = 'Finish the active bake before starting another craft'; end if;
  if exists (
    select 1 from public.brew_sessions brew
    where brew.save_id = p_save_id and brew.status = 'active'
  ) then raise sqlstate 'PT409' using message = 'Finish the active brew before starting another craft'; end if;

  select b.* into v_batch from public.ingredient_batches b
  where b.save_id = p_save_id and b.id = p_ingredient_batch_id
    and b.quantity > b.consumed_quantity for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'sessionId', v_session_id,
    'ingredientBatchId', p_ingredient_batch_id,
    'startedAt', v_started_at,
    'durationSeconds', 15,
    'countdownSeconds', 2,
    'stirRulesVersion', 'guide-v2',
    'committedRevision', v_save.revision + 1,
    'dayNumber', v_save.current_day
  );

  insert into public.brew_sessions
    (id, save_id, day_number, ingredient_batch_id, ingredient_quality_index,
     ingredient_brew_bonus, rules_version, started_at, duration_seconds,
     countdown_seconds, stir_rules_version)
  values
    (v_session_id, p_save_id, v_save.current_day, p_ingredient_batch_id,
     v_batch.quality_index, v_batch.brew_bonus, v_save.rules_version, v_started_at,
     15, 2, 'guide-v2');

  update public.tavern_saves
  set daily_craft_kind = 'brew', revision = revision + 1, updated_at = now()
  where id = p_save_id;

  insert into public.craft_actions
    (save_id, action_id, actor_id, command_kind, subject_id,
     input_expected_revision, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'start_brew', p_ingredient_batch_id,
     p_expected_revision, v_receipt, v_save.revision + 1);

  return v_receipt;
end;
$$;

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

  -- Historical sessions retain the original calculator and reward wrapper.
  if v_session.stir_rules_version = 'rpm-v1' then
    update public.tavern_saves
    set day_minigame_completed = false, daily_craft_kind = 'brew'
    where id = p_save_id;
    v_result := private.complete_brew_before_daily_craft(
      p_save_id, p_session_id, p_action_id, p_expected_revision,
      p_perfect_ticks, p_good_ticks, p_total_ticks
    );
    update public.tavern_saves
    set day_minigame_completed = true, daily_craft_kind = null
    where id = p_save_id;
    return v_result;
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
    v_card_key := case when v_quality >= 5 then 'resolve' when v_quality >= 4 then 'insight' else 'charm' end;
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

alter function public.get_tavern_snapshot()
  rename to get_tavern_snapshot_before_guided_stirring;
alter function public.get_tavern_snapshot_before_guided_stirring()
  set schema private;

create function public.get_tavern_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_session public.brew_sessions%rowtype;
begin
  v_result := private.get_tavern_snapshot_before_guided_stirring();
  if v_result is null then return null; end if;
  if jsonb_typeof(v_result #> '{brewery,activeSession}') = 'object' then
    select brew.* into v_session from public.brew_sessions brew
    where brew.id = (v_result #>> '{brewery,activeSession,id}')::uuid;
    if found then
      v_result := jsonb_set(
        v_result,
        '{brewery,activeSession}',
        (v_result #> '{brewery,activeSession}') || jsonb_build_object(
          'countdownSeconds', v_session.countdown_seconds,
          'stirRulesVersion', v_session.stir_rules_version
        ),
        true
      );
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function private.get_tavern_snapshot_before_guided_stirring()
  from public, anon, authenticated;
revoke all on function public.start_brew(uuid, uuid, uuid, bigint),
  public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer),
  public.get_tavern_snapshot()
  from public, anon;
grant execute on function public.start_brew(uuid, uuid, uuid, bigint),
  public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer),
  public.get_tavern_snapshot()
  to authenticated;

commit;
