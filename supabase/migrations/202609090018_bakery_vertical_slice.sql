-- Add the Bakery as the second consumer of the one-craft-per-day budget.
-- Baking owns production; the existing hospitality ledger owns serving food.
begin;

alter table public.tavern_saves
  add column daily_craft_kind text
  check (daily_craft_kind in ('brew', 'bake'));

-- A migrated current-day brew, active or completed, has already used the shared
-- craft allocation. Historical brews remain history and do not reserve today.
update public.tavern_saves s
set daily_craft_kind = 'brew'
where exists (
  select 1 from public.brew_sessions brew
  where brew.save_id = s.id and brew.day_number = s.current_day
);

create table public.bake_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  ingredient_batch_id uuid not null,
  ingredient_quality_index smallint not null check (ingredient_quality_index between 0 and 6),
  ingredient_bake_bonus smallint not null check (ingredient_bake_bonus >= 0),
  recipe_key text not null check (recipe_key = 'herb-loaf'),
  rules_version text not null check (rules_version = 'bake-v1'),
  status text not null default 'folding'
    check (status in ('folding', 'scoring', 'ready', 'baking', 'completed')),
  fold_count smallint not null default 0 check (fold_count between 0 and 6),
  fold_points smallint not null default 0 check (fold_points between 0 and 12),
  score_count smallint not null default 0 check (score_count between 0 and 3),
  score_points smallint not null default 0 check (score_points between 0 and 6),
  oven_started_at timestamptz,
  completed_at timestamptz,
  oven_elapsed_ms bigint check (oven_elapsed_ms is null or oven_elapsed_ms >= 0),
  timing_band text check (timing_band is null or timing_band in ('red', 'yellow', 'green')),
  technique_score smallint check (technique_score is null or technique_score between 0 and 6),
  quality_index smallint check (quality_index is null or quality_index between 0 and 6),
  created_at timestamptz not null default now(),
  unique (save_id, id),
  unique (save_id, day_number),
  foreign key (save_id, ingredient_batch_id)
    references public.ingredient_batches(save_id, id),
  check (fold_points <= fold_count * 2 and score_points <= score_count * 2),
  check (
    (status = 'folding' and fold_count < 6 and score_count = 0 and oven_started_at is null)
    or (status = 'scoring' and fold_count = 6 and score_count < 3 and oven_started_at is null)
    or (status = 'ready' and fold_count = 6 and score_count = 3 and oven_started_at is null)
    or (status = 'baking' and fold_count = 6 and score_count = 3 and oven_started_at is not null
      and completed_at is null and oven_elapsed_ms is null and timing_band is null
      and technique_score is null and quality_index is null)
    or (status = 'completed' and fold_count = 6 and score_count = 3 and oven_started_at is not null
      and completed_at is not null and oven_elapsed_ms is not null and timing_band is not null
      and technique_score is not null and quality_index is not null)
  )
);

create index bake_sessions_save_id_idx on public.bake_sessions(save_id);

alter table public.foods
  add column bake_session_id uuid,
  add column ingredient_batch_id uuid,
  add column rules_version text not null default 'food-v1',
  add constraint foods_save_id_bake_session_id_fkey foreign key (save_id, bake_session_id)
    references public.bake_sessions(save_id, id),
  add constraint foods_save_id_ingredient_batch_id_fkey foreign key (save_id, ingredient_batch_id)
    references public.ingredient_batches(save_id, id),
  add constraint foods_bake_provenance_check check (
    (bake_session_id is null and ingredient_batch_id is null)
    or (bake_session_id is not null and ingredient_batch_id is not null and rules_version = 'bake-v1')
  );
create unique index foods_bake_session_once
  on public.foods(save_id, bake_session_id) where bake_session_id is not null;

alter table public.intent_cards add column source_food_id uuid;
alter table public.intent_cards
  add constraint intent_cards_save_id_source_food_id_fkey
  foreign key (save_id, source_food_id) references public.foods(save_id, id);
alter table public.intent_cards drop constraint intent_cards_check;
alter table public.intent_cards add constraint intent_cards_source_item_check check (
  ((source_kind = 'brew') = (source_beverage_id is not null))
  and ((source_kind = 'bake') = (source_food_id is not null))
);

create table public.bake_actions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_kind text not null check (
    command_kind in ('start_bake', 'fold_bake', 'score_bake', 'begin_bake_oven', 'complete_bake')
  ),
  subject_id uuid not null,
  input_expected_revision bigint not null check (input_expected_revision >= 0),
  input_value integer,
  result jsonb not null,
  committed_revision bigint not null check (committed_revision >= 1),
  created_at timestamptz not null default now(),
  primary key (save_id, action_id),
  foreign key (save_id, actor_id)
    references public.tavern_saves(id, user_id) on delete cascade,
  check (
    (command_kind in ('fold_bake', 'score_bake') and input_value between 0 and 100)
    or (command_kind not in ('fold_bake', 'score_bake') and input_value is null)
  )
);
create index bake_actions_actor_id_idx on public.bake_actions(actor_id);

alter table public.bake_sessions enable row level security;
alter table public.bake_actions enable row level security;
create policy bake_sessions_read_own on public.bake_sessions
  for select to authenticated using (exists (
    select 1 from public.tavern_saves s
    where s.id = bake_sessions.save_id and s.user_id = (select auth.uid())
  ));
create policy bake_actions_read_own on public.bake_actions
  for select to authenticated using (actor_id = (select auth.uid()));
revoke all on public.bake_sessions, public.bake_actions from public, anon, authenticated;
grant select on public.bake_sessions, public.bake_actions to authenticated;
grant all on public.bake_sessions, public.bake_actions to service_role;

create function private.bake_gesture_points(p_value integer)
returns smallint language sql immutable strict set search_path = '' as $$
  select case when p_value >= 60 then 2 when p_value >= 30 then 1 else 0 end::smallint;
$$;

create function private.bake_timing_band(p_elapsed_ms bigint)
returns text language sql immutable strict set search_path = '' as $$
  select case
    when p_elapsed_ms between 28000 and 34000 then 'green'
    when p_elapsed_ms between 20000 and 42000 then 'yellow'
    else 'red'
  end;
$$;

create function private.bread_name(p_quality smallint)
returns text language sql immutable strict set search_path = '' as $$
  select case p_quality
    when 0 then 'Charred Herb Brick'
    when 1 then 'Sunken Herb Loaf'
    when 2 then 'Rustic Herb Bread'
    when 3 then 'Hearth Herb Loaf'
    when 4 then 'Golden Herb Loaf'
    when 5 then 'Master Baker''s Herb Loaf'
    when 6 then 'Resplendent Hearth Loaf'
  end;
$$;

create function public.start_bake(
  p_save_id uuid,
  p_ingredient_batch_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_save public.tavern_saves;
  v_batch public.ingredient_batches;
  v_action public.bake_actions;
  v_session uuid := extensions.gen_random_uuid();
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_ingredient_batch_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid bake request';
  end if;

  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  select * into v_action from public.bake_actions
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_action.command_kind = 'start_bake'
      and v_action.subject_id = p_ingredient_batch_id
      and v_action.input_expected_revision = p_expected_revision then
      return v_action.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before baking';
  end if;
  if v_save.daily_craft_kind is not null or v_save.day_minigame_completed then
    raise sqlstate 'PT422' using message = 'Today''s brew or bake is already reserved';
  end if;

  select * into v_batch from public.ingredient_batches
  where save_id = p_save_id and id = p_ingredient_batch_id
    and quantity > consumed_quantity for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  insert into public.bake_sessions (
    id, save_id, day_number, ingredient_batch_id, ingredient_quality_index,
    ingredient_bake_bonus, recipe_key, rules_version
  ) values (
    v_session, p_save_id, v_save.current_day, p_ingredient_batch_id,
    v_batch.quality_index, v_batch.bake_bonus, 'herb-loaf', 'bake-v1'
  );
  update public.tavern_saves
  set daily_craft_kind = 'bake', revision = revision + 1, updated_at = now()
  where id = p_save_id;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'sessionId', v_session,
    'ingredientBatchId', p_ingredient_batch_id, 'status', 'folding',
    'foldsRequired', 6, 'scoresRequired', 3, 'committedRevision', v_save.revision + 1,
    'dayNumber', v_save.current_day, 'rulesVersion', 'bake-v1'
  );
  insert into public.bake_actions (
    save_id, action_id, actor_id, command_kind, subject_id,
    input_expected_revision, result, committed_revision
  ) values (
    p_save_id, p_action_id, v_actor, 'start_bake', p_ingredient_batch_id,
    p_expected_revision, v_receipt, v_save.revision + 1
  );
  return v_receipt;
end;
$$;

create function public.fold_bake(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_distance integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_save public.tavern_saves;
  v_session public.bake_sessions; v_action public.bake_actions;
  v_points smallint; v_status text; v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 or p_distance not between 0 and 100 then
    raise sqlstate 'PT400' using message = 'Invalid dough fold';
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  select * into v_action from public.bake_actions
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_action.command_kind = 'fold_bake' and v_action.subject_id = p_session_id
      and v_action.input_expected_revision = p_expected_revision and v_action.input_value = p_distance then
      return v_action.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before folding';
  end if;
  select * into v_session from public.bake_sessions
  where save_id = p_save_id and id = p_session_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  if v_save.daily_craft_kind <> 'bake' or v_session.day_number <> v_save.current_day
    or v_session.status <> 'folding' then
    raise sqlstate 'PT422' using message = 'This dough is not ready to fold';
  end if;
  v_points := private.bake_gesture_points(p_distance);
  v_status := case when v_session.fold_count + 1 = 6 then 'scoring' else 'folding' end;
  update public.bake_sessions set
    fold_count = fold_count + 1, fold_points = fold_points + v_points, status = v_status
  where save_id = p_save_id and id = p_session_id;
  update public.tavern_saves set revision = revision + 1, updated_at = now() where id = p_save_id;
  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'sessionId', p_session_id, 'status', v_status,
    'foldCount', v_session.fold_count + 1, 'foldPoints', v_session.fold_points + v_points,
    'committedRevision', v_save.revision + 1
  );
  insert into public.bake_actions values (
    p_save_id, p_action_id, v_actor, 'fold_bake', p_session_id,
    p_expected_revision, p_distance, v_receipt, v_save.revision + 1, now()
  );
  return v_receipt;
end;
$$;

create function public.score_bake(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_length integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_save public.tavern_saves;
  v_session public.bake_sessions; v_action public.bake_actions;
  v_points smallint; v_status text; v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 or p_length not between 0 and 100 then
    raise sqlstate 'PT400' using message = 'Invalid loaf score';
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  select * into v_action from public.bake_actions
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_action.command_kind = 'score_bake' and v_action.subject_id = p_session_id
      and v_action.input_expected_revision = p_expected_revision and v_action.input_value = p_length then
      return v_action.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before scoring';
  end if;
  select * into v_session from public.bake_sessions
  where save_id = p_save_id and id = p_session_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  if v_save.daily_craft_kind <> 'bake' or v_session.day_number <> v_save.current_day
    or v_session.status <> 'scoring' then
    raise sqlstate 'PT422' using message = 'This loaf is not ready to score';
  end if;
  v_points := private.bake_gesture_points(p_length);
  v_status := case when v_session.score_count + 1 = 3 then 'ready' else 'scoring' end;
  update public.bake_sessions set
    score_count = score_count + 1, score_points = score_points + v_points, status = v_status
  where save_id = p_save_id and id = p_session_id;
  update public.tavern_saves set revision = revision + 1, updated_at = now() where id = p_save_id;
  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'sessionId', p_session_id, 'status', v_status,
    'scoreCount', v_session.score_count + 1, 'scorePoints', v_session.score_points + v_points,
    'committedRevision', v_save.revision + 1
  );
  insert into public.bake_actions values (
    p_save_id, p_action_id, v_actor, 'score_bake', p_session_id,
    p_expected_revision, p_length, v_receipt, v_save.revision + 1, now()
  );
  return v_receipt;
end;
$$;

create function public.begin_bake_oven(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_save public.tavern_saves;
  v_session public.bake_sessions; v_action public.bake_actions;
  v_started timestamptz := clock_timestamp(); v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid oven request';
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  select * into v_action from public.bake_actions
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_action.command_kind = 'begin_bake_oven' and v_action.subject_id = p_session_id
      and v_action.input_expected_revision = p_expected_revision then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before using the oven';
  end if;
  select * into v_session from public.bake_sessions
  where save_id = p_save_id and id = p_session_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  if v_save.daily_craft_kind <> 'bake' or v_session.day_number <> v_save.current_day
    or v_session.status <> 'ready' then
    raise sqlstate 'PT422' using message = 'Fold six times and score three times before baking';
  end if;
  update public.bake_sessions set status = 'baking', oven_started_at = v_started
  where save_id = p_save_id and id = p_session_id;
  update public.tavern_saves set revision = revision + 1, updated_at = now() where id = p_save_id;
  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'sessionId', p_session_id, 'status', 'baking',
    'ovenStartedAt', v_started, 'idealSeconds', 30,
    'committedRevision', v_save.revision + 1
  );
  insert into public.bake_actions (
    save_id, action_id, actor_id, command_kind, subject_id,
    input_expected_revision, result, committed_revision
  ) values (
    p_save_id, p_action_id, v_actor, 'begin_bake_oven', p_session_id,
    p_expected_revision, v_receipt, v_save.revision + 1
  );
  return v_receipt;
end;
$$;

create function public.complete_bake(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_save public.tavern_saves;
  v_session public.bake_sessions; v_action public.bake_actions;
  v_finished timestamptz := clock_timestamp(); v_elapsed bigint; v_band text;
  v_technique smallint; v_base smallint; v_quality smallint; v_food uuid := extensions.gen_random_uuid();
  v_card uuid; v_card_key text; v_tier text; v_name text; v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_session_id is null or p_action_id is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid bake completion';
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  select * into v_action from public.bake_actions
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_action.command_kind = 'complete_bake' and v_action.subject_id = p_session_id
      and v_action.input_expected_revision = p_expected_revision then return v_action.result; end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; refresh before taking out the loaf';
  end if;
  select * into v_session from public.bake_sessions
  where save_id = p_save_id and id = p_session_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or bake not found'; end if;
  if v_save.daily_craft_kind <> 'bake' or v_session.day_number <> v_save.current_day
    or v_session.status <> 'baking' then
    raise sqlstate 'PT422' using message = 'This loaf is not in the oven';
  end if;
  perform 1 from public.ingredient_batches
  where save_id = p_save_id and id = v_session.ingredient_batch_id
    and quantity > consumed_quantity for update;
  if not found then raise sqlstate 'PT409' using message = 'The selected ingredient is no longer available'; end if;

  v_elapsed := greatest(0, round(extract(epoch from (v_finished - v_session.oven_started_at)) * 1000))::bigint;
  v_band := private.bake_timing_band(v_elapsed);
  v_technique := least(6, greatest(0,
    round(6.0 * (v_session.fold_points + v_session.score_points)::numeric / 18.0)
  ))::smallint;
  v_base := least(4, greatest(0, round((
    v_session.ingredient_quality_index::numeric + v_technique::numeric
    + least(4, v_session.ingredient_bake_bonus)::numeric / 2.0
  ) / 3.0)))::smallint;
  v_quality := least(6, v_base + case v_band when 'green' then 2 when 'yellow' then 1 else 0 end)::smallint;
  v_name := private.bread_name(v_quality);

  insert into public.foods (
    id, save_id, name, recipe_key, quality_index, day_number, source_action_id,
    bake_session_id, ingredient_batch_id, rules_version
  ) values (
    v_food, p_save_id, v_name, 'herb-loaf', v_quality, v_save.current_day, p_action_id,
    p_session_id, v_session.ingredient_batch_id, 'bake-v1'
  );
  if v_quality >= 2 then
    v_card := extensions.gen_random_uuid();
    v_card_key := case when v_quality >= 5 then 'insight' when v_quality = 4 then 'charm' else 'rumor' end;
    v_tier := case when v_quality >= 5 then 'exceptional' when v_quality = 4 then 'superior' else 'fine' end;
    insert into public.intent_cards (
      id, save_id, card_key, tier, source_kind, source_key, source_food_id
    ) values (
      v_card, p_save_id, v_card_key, v_tier, 'bake', v_food::text, v_food
    );
  end if;
  update public.ingredient_batches set consumed_quantity = consumed_quantity + 1
  where save_id = p_save_id and id = v_session.ingredient_batch_id;
  update public.bake_sessions set
    status = 'completed', completed_at = v_finished, oven_elapsed_ms = v_elapsed,
    timing_band = v_band, technique_score = v_technique, quality_index = v_quality
  where save_id = p_save_id and id = p_session_id;
  update public.tavern_saves set
    day_minigame_completed = true, revision = revision + 1, updated_at = now()
  where id = p_save_id;
  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'sessionId', p_session_id, 'foodId', v_food,
    'intentCardId', v_card, 'intentCardKey', v_card_key, 'intentCardTier', v_tier,
    'foodName', v_name, 'qualityIndex', v_quality, 'techniqueScore', v_technique,
    'timingBand', v_band, 'ovenElapsedMs', v_elapsed,
    'committedRevision', v_save.revision + 1, 'dayNumber', v_save.current_day,
    'rulesVersion', 'bake-v1'
  );
  insert into public.bake_actions (
    save_id, action_id, actor_id, command_kind, subject_id,
    input_expected_revision, result, committed_revision
  ) values (
    p_save_id, p_action_id, v_actor, 'complete_bake', p_session_id,
    p_expected_revision, v_receipt, v_save.revision + 1
  );
  return v_receipt;
end;
$$;

-- Serialize Brewery starts against Bakery starts without changing the accepted
-- Brewery command and receipt contracts.
alter function public.start_brew(uuid, uuid, uuid, bigint) rename to start_brew_before_bakery;
alter function public.start_brew_before_bakery(uuid, uuid, uuid, bigint) set schema private;
create function public.start_brew(
  p_save_id uuid, p_ingredient_batch_id uuid, p_action_id uuid, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_result jsonb;
begin
  select a.* into v_prior from public.craft_actions a
  join public.tavern_saves s on s.id = a.save_id and s.user_id = auth.uid()
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    return private.start_brew_before_bakery(
      p_save_id, p_ingredient_batch_id, p_action_id, p_expected_revision
    );
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = auth.uid() for update;
  if found and v_save.daily_craft_kind = 'bake' then
    raise sqlstate 'PT422' using message = 'Today''s craft is already reserved for the bakery';
  end if;
  v_result := private.start_brew_before_bakery(
    p_save_id, p_ingredient_batch_id, p_action_id, p_expected_revision
  );
  update public.tavern_saves set daily_craft_kind = 'brew' where id = p_save_id;
  return v_result;
end;
$$;

alter function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  rename to complete_brew_before_daily_craft;
alter function public.complete_brew_before_daily_craft(uuid, uuid, uuid, bigint, integer, integer, integer)
  set schema private;
create function public.complete_brew(
  p_save_id uuid, p_session_id uuid, p_action_id uuid, p_expected_revision bigint,
  p_perfect_ticks integer, p_good_ticks integer, p_total_ticks integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_result jsonb;
begin
  select a.* into v_prior from public.craft_actions a
  join public.tavern_saves s on s.id = a.save_id and s.user_id = auth.uid()
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    return private.complete_brew_before_daily_craft(
      p_save_id, p_session_id, p_action_id, p_expected_revision,
      p_perfect_ticks, p_good_ticks, p_total_ticks
    );
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = auth.uid() for update;
  if found and v_save.daily_craft_kind = 'bake' then
    raise sqlstate 'PT422' using message = 'Today''s craft belongs to the bakery';
  end if;
  v_result := private.complete_brew_before_daily_craft(
    p_save_id, p_session_id, p_action_id, p_expected_revision,
    p_perfect_ticks, p_good_ticks, p_total_ticks
  );
  update public.tavern_saves set daily_craft_kind = 'brew' where id = p_save_id;
  return v_result;
end;
$$;

alter function public.advance_tavern_day(uuid, uuid, bigint)
  rename to advance_tavern_day_before_bakery;
alter function public.advance_tavern_day_before_bakery(uuid, uuid, bigint) set schema private;
create function public.advance_tavern_day(
  p_save_id uuid, p_action_id uuid, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_result jsonb;
begin
  select a.* into v_prior from public.craft_actions a
  join public.tavern_saves s on s.id = a.save_id and s.user_id = auth.uid()
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    return private.advance_tavern_day_before_bakery(p_save_id, p_action_id, p_expected_revision);
  end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = auth.uid() for update;
  if found and exists (
    select 1 from public.bake_sessions bake
    where bake.save_id = p_save_id and bake.status <> 'completed'
  ) then raise sqlstate 'PT422' using message = 'Finish the active bake before closing'; end if;
  v_result := private.advance_tavern_day_before_bakery(p_save_id, p_action_id, p_expected_revision);
  update public.tavern_saves set daily_craft_kind = null where id = p_save_id;
  return v_result;
end;
$$;

-- A newly-started bake is also an active minigame for dialogue gating. Existing
-- turn retries retain the original dialogue recovery behavior.
alter function public.dialogue_begin(uuid, uuid, text, text, bigint, uuid, text, uuid)
  rename to dialogue_begin_before_bakery;
alter function public.dialogue_begin_before_bakery(uuid, uuid, text, text, bigint, uuid, text, uuid)
  set schema private;
create function public.dialogue_begin(
  p_actor uuid, p_turn uuid, p_patron text, p_message text, p_sequence bigint,
  p_intent_card uuid default null, p_offering_kind text default null,
  p_offering_item uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.dialogue_turns where id = p_turn) then
    return private.dialogue_begin_before_bakery(
      p_actor, p_turn, p_patron, p_message, p_sequence,
      p_intent_card, p_offering_kind, p_offering_item
    );
  end if;
  if exists (
    select 1 from public.tavern_saves s join public.bake_sessions bake on bake.save_id = s.id
    where s.user_id = p_actor and bake.status <> 'completed'
  ) then raise sqlstate 'PT422' using message = 'Finish your active bake before talking'; end if;
  return private.dialogue_begin_before_bakery(
    p_actor, p_turn, p_patron, p_message, p_sequence,
    p_intent_card, p_offering_kind, p_offering_item
  );
end;
$$;

-- Preserve the established Garden/Brewery projection and add Bakery state plus
-- explicit source links for every intent and food item.
alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_bakery;
alter function public.get_tavern_snapshot_before_bakery() set schema private;
create function public.get_tavern_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_save uuid; v_kind text;
begin
  v_result := private.get_tavern_snapshot_before_bakery();
  if v_result is null then return null; end if;
  v_save := (v_result #>> '{save,id}')::uuid;
  select daily_craft_kind into v_kind from public.tavern_saves where id = v_save;
  v_result := jsonb_set(
    v_result, '{save,dailyCraftKind}', coalesce(to_jsonb(v_kind), 'null'::jsonb), true
  );
  v_result := jsonb_set(v_result, '{brewery,intentCards}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'cardKey', c.card_key, 'displayName', catalog.display_name,
      'description', catalog.description, 'tier', c.tier,
      'sourceBeverageId', c.source_beverage_id, 'sourceFoodId', c.source_food_id,
      'createdAt', c.created_at
    ) order by c.created_at, c.id)
    from public.intent_cards c join public.intent_card_catalog catalog
      on catalog.card_key = c.card_key and catalog.version = c.catalog_version
    where c.save_id = v_save and not exists (
      select 1 from public.intent_card_plays play
      where play.save_id = v_save and play.card_id = c.id
    )
  ), '[]'::jsonb), true);
  v_result := v_result || jsonb_build_object('foods', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'recipeKey', f.recipe_key,
      'qualityIndex', f.quality_index, 'dayNumber', f.day_number,
      'bakeSessionId', f.bake_session_id, 'ingredientBatchId', f.ingredient_batch_id,
      'rulesVersion', f.rules_version, 'createdAt', f.created_at
    ) order by f.created_at desc, f.id)
    from public.foods f where f.save_id = v_save
  ), '[]'::jsonb));
  return v_result || jsonb_build_object('bakery', jsonb_build_object(
    'rules', jsonb_build_object(
      'rulesVersion', 'bake-v1', 'foldsRequired', 6, 'scoresRequired', 3,
      'idealSeconds', 30, 'greenStartMs', 28000, 'greenEndMs', 34000,
      'yellowStartMs', 20000, 'yellowEndMs', 42000
    ),
    'activeSession', coalesce((select jsonb_build_object(
      'id', bake.id, 'ingredientBatchId', bake.ingredient_batch_id,
      'plantKey', batch.plant_key, 'plantName', catalog.display_name, 'icon', catalog.icon,
      'ingredientQualityIndex', bake.ingredient_quality_index,
      'ingredientBakeBonus', bake.ingredient_bake_bonus, 'recipeKey', bake.recipe_key,
      'rulesVersion', bake.rules_version, 'status', bake.status,
      'foldCount', bake.fold_count, 'foldPoints', bake.fold_points,
      'scoreCount', bake.score_count, 'scorePoints', bake.score_points,
      'ovenStartedAt', bake.oven_started_at, 'dayNumber', bake.day_number
    ) from public.bake_sessions bake
      join public.ingredient_batches batch on batch.save_id = bake.save_id and batch.id = bake.ingredient_batch_id
      join public.plant_catalog catalog on catalog.rules_version = batch.rules_version and catalog.plant_key = batch.plant_key
      where bake.save_id = v_save and bake.status <> 'completed'
      order by bake.created_at desc limit 1), 'null'::jsonb),
    'foods', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'recipeKey', f.recipe_key,
      'qualityIndex', f.quality_index, 'dayNumber', f.day_number,
      'bakeSessionId', f.bake_session_id, 'ingredientBatchId', f.ingredient_batch_id,
      'rulesVersion', f.rules_version, 'createdAt', f.created_at
    ) order by f.created_at desc, f.id)
      from public.foods f where f.save_id = v_save and f.bake_session_id is not null), '[]'::jsonb),
    'intentCards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'cardKey', c.card_key, 'displayName', catalog.display_name,
      'description', catalog.description, 'tier', c.tier,
      'sourceFoodId', c.source_food_id, 'createdAt', c.created_at
    ) order by c.created_at desc, c.id)
      from public.intent_cards c join public.intent_card_catalog catalog
        on catalog.card_key = c.card_key and catalog.version = c.catalog_version
      where c.save_id = v_save and c.source_kind = 'bake'), '[]'::jsonb)
  ));
end;
$$;

revoke all on function private.bake_gesture_points(integer), private.bake_timing_band(bigint),
  private.bread_name(smallint), private.start_brew_before_bakery(uuid, uuid, uuid, bigint),
  private.complete_brew_before_daily_craft(uuid, uuid, uuid, bigint, integer, integer, integer),
  private.advance_tavern_day_before_bakery(uuid, uuid, bigint),
  private.dialogue_begin_before_bakery(uuid, uuid, text, text, bigint, uuid, text, uuid),
  private.get_tavern_snapshot_before_bakery() from public, anon, authenticated;

revoke all on function public.start_bake(uuid, uuid, uuid, bigint),
  public.fold_bake(uuid, uuid, uuid, bigint, integer),
  public.score_bake(uuid, uuid, uuid, bigint, integer),
  public.begin_bake_oven(uuid, uuid, uuid, bigint),
  public.complete_bake(uuid, uuid, uuid, bigint),
  public.start_brew(uuid, uuid, uuid, bigint),
  public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer),
  public.advance_tavern_day(uuid, uuid, bigint), public.get_tavern_snapshot()
  from public, anon;
grant execute on function public.start_bake(uuid, uuid, uuid, bigint),
  public.fold_bake(uuid, uuid, uuid, bigint, integer),
  public.score_bake(uuid, uuid, uuid, bigint, integer),
  public.begin_bake_oven(uuid, uuid, uuid, bigint),
  public.complete_bake(uuid, uuid, uuid, bigint),
  public.start_brew(uuid, uuid, uuid, bigint),
  public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer),
  public.advance_tavern_day(uuid, uuid, bigint), public.get_tavern_snapshot()
  to authenticated;
revoke all on function public.dialogue_begin(uuid, uuid, text, text, bigint, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.dialogue_begin(uuid, uuid, text, text, bigint, uuid, text, uuid)
  to service_role;

commit;
