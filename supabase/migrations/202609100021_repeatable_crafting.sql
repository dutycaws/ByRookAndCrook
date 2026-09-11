-- Allow sequential crafts within one tavern day while retaining one active
-- craft, authoritative inventory consumption, and command idempotency.
begin;

alter table public.brew_sessions
  drop constraint if exists brew_sessions_save_id_day_number_key;
alter table public.bake_sessions
  drop constraint if exists bake_sessions_save_id_day_number_key;

create unique index if not exists brew_sessions_one_active_per_save
  on public.brew_sessions(save_id) where status = 'active';
create unique index if not exists bake_sessions_one_active_per_save
  on public.bake_sessions(save_id) where status <> 'completed';

update public.tavern_saves s
set daily_craft_kind = case
  when exists (
    select 1 from public.brew_sessions brew
    where brew.save_id = s.id and brew.status = 'active'
  ) then 'brew'
  when exists (
    select 1 from public.bake_sessions bake
    where bake.save_id = s.id and bake.status <> 'completed'
  ) then 'bake'
  else null
end;

-- This is the original Brewery start implementation after Bakery moved it to
-- the private schema. Remove only the completed-day and per-day restrictions.
create or replace function private.start_brew_before_bakery(
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
    select 1 from public.brew_sessions brew
    where brew.save_id = p_save_id and brew.status = 'active'
  ) then raise sqlstate 'PT409' using message = 'Finish the active brew before starting another craft'; end if;

  select b.* into v_batch from public.ingredient_batches b
  where b.save_id = p_save_id and b.id = p_ingredient_batch_id and b.quantity > b.consumed_quantity
  for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;

  v_receipt := jsonb_build_object(
    'actionId', p_action_id,
    'sessionId', v_session_id,
    'ingredientBatchId', p_ingredient_batch_id,
    'startedAt', v_started_at,
    'durationSeconds', 30,
    'committedRevision', v_save.revision + 1,
    'dayNumber', v_save.current_day
  );

  insert into public.brew_sessions
    (id, save_id, day_number, ingredient_batch_id, ingredient_quality_index,
     ingredient_brew_bonus, rules_version, started_at)
  values
    (v_session_id, p_save_id, v_save.current_day, p_ingredient_batch_id,
     v_batch.quality_index, v_batch.brew_bonus, v_save.rules_version, v_started_at);

  update public.tavern_saves set revision = revision + 1, updated_at = now()
  where id = p_save_id;

  insert into public.craft_actions
    (save_id, action_id, actor_id, command_kind, subject_id, input_expected_revision, result, committed_revision)
  values
    (p_save_id, p_action_id, v_actor, 'start_brew', p_ingredient_batch_id,
     p_expected_revision, v_receipt, v_save.revision + 1);

  return v_receipt;
end;
$$;

create or replace function public.start_brew(
  p_save_id uuid, p_ingredient_batch_id uuid, p_action_id uuid, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_result jsonb;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  select * into v_save from public.tavern_saves
  where id = p_save_id and user_id = auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or ingredient not found'; end if;
  select a.* into v_prior from public.craft_actions a
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    return private.start_brew_before_bakery(
      p_save_id, p_ingredient_batch_id, p_action_id, p_expected_revision
    );
  end if;
  if exists (
    select 1 from public.bake_sessions bake
    where bake.save_id = p_save_id and bake.status <> 'completed'
  ) then raise sqlstate 'PT422' using message = 'Finish the active bake before starting another craft'; end if;
  if exists (
    select 1 from public.brew_sessions brew
    where brew.save_id = p_save_id and brew.status = 'active'
  ) then raise sqlstate 'PT409' using message = 'Finish the active brew before starting another craft'; end if;
  v_result := private.start_brew_before_bakery(
    p_save_id, p_ingredient_batch_id, p_action_id, p_expected_revision
  );
  update public.tavern_saves set daily_craft_kind = 'brew' where id = p_save_id;
  return v_result;
end;
$$;

create or replace function public.start_bake(
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
  if exists (
    select 1 from public.bake_sessions bake
    where bake.save_id = p_save_id and bake.status <> 'completed'
  ) then raise sqlstate 'PT409' using message = 'Finish the active bake before starting another craft'; end if;
  if exists (
    select 1 from public.brew_sessions brew
    where brew.save_id = p_save_id and brew.status = 'active'
  ) then raise sqlstate 'PT422' using message = 'Finish the active brew before starting another craft'; end if;

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

-- Existing completion logic remains the authority for output, cards, quality,
-- consumption, and exact retries. Temporarily clear the completed-day marker
-- only while it evaluates a new Brewery completion, then release the craft slot.
create or replace function public.complete_brew(
  p_save_id uuid, p_session_id uuid, p_action_id uuid, p_expected_revision bigint,
  p_perfect_ticks integer, p_good_ticks integer, p_total_ticks integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_save public.tavern_saves; v_prior public.craft_actions; v_result jsonb;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
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
  if not found then raise sqlstate 'PT404' using message = 'Tavern or brew not found'; end if;
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
end;
$$;

alter function public.complete_bake(uuid, uuid, uuid, bigint)
  rename to complete_bake_before_repeatable_crafting;
alter function public.complete_bake_before_repeatable_crafting(uuid, uuid, uuid, bigint)
  set schema private;
create function public.complete_bake(
  p_save_id uuid, p_session_id uuid, p_action_id uuid, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prior public.bake_actions; v_result jsonb;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  select a.* into v_prior from public.bake_actions a
  join public.tavern_saves s on s.id = a.save_id and s.user_id = auth.uid()
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    return private.complete_bake_before_repeatable_crafting(
      p_save_id, p_session_id, p_action_id, p_expected_revision
    );
  end if;
  v_result := private.complete_bake_before_repeatable_crafting(
    p_save_id, p_session_id, p_action_id, p_expected_revision
  );
  update public.tavern_saves
  set day_minigame_completed = true, daily_craft_kind = null
  where id = p_save_id and user_id = auth.uid();
  return v_result;
end;
$$;

create or replace function public.score_bake(
  p_save_id uuid, p_session_id uuid, p_action_id uuid,
  p_expected_revision bigint, p_length integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_length is null or p_length < 10 or p_length > 100 then
    raise sqlstate 'PT400' using message = 'Invalid loaf score';
  end if;
  return private.score_bake_before_null_validation(
    p_save_id, p_session_id, p_action_id, p_expected_revision, p_length
  );
end;
$$;

revoke all on function private.start_brew_before_bakery(uuid, uuid, uuid, bigint),
  private.complete_brew_before_daily_craft(uuid, uuid, uuid, bigint, integer, integer, integer),
  private.complete_bake_before_repeatable_crafting(uuid, uuid, uuid, bigint),
  private.score_bake_before_null_validation(uuid, uuid, uuid, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.start_brew(uuid, uuid, uuid, bigint),
  public.start_bake(uuid, uuid, uuid, bigint),
  public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer),
  public.complete_bake(uuid, uuid, uuid, bigint),
  public.score_bake(uuid, uuid, uuid, bigint, integer)
  from public, anon;
grant execute on function public.start_brew(uuid, uuid, uuid, bigint),
  public.start_bake(uuid, uuid, uuid, bigint),
  public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer),
  public.complete_bake(uuid, uuid, uuid, bigint),
  public.score_bake(uuid, uuid, uuid, bigint, integer)
  to authenticated;

commit;
