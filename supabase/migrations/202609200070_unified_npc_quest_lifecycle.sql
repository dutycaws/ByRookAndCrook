-- Issue #31 Packet 1: the authoritative, package-pinned quest spine.
-- This prototype deliberately starts a clean lifecycle; legacy campaign_state
-- and world_procedural_quests remain readable until Packet 2 retires them.
begin;

create function private.world_quest_plan_is_valid(p_plan jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  step jsonb;
  step_count integer;
  position integer := 0;
  action_name text;
  approach_name text;
begin
  if jsonb_typeof(p_plan) <> 'array' then return false; end if;
  step_count := jsonb_array_length(p_plan);
  if step_count not between 1 and 3 then return false; end if;

  for step in select value from jsonb_array_elements(p_plan) loop
    position := position + 1;
    if jsonb_typeof(step) <> 'object' then return false; end if;
    action_name := step->>'action';
    approach_name := step->>'approach';
    if action_name not in ('prepare','attempt','wait','abandon')
      or approach_name not in ('scouting','combat','diplomacy','trade') then
      return false;
    end if;
    -- Attempts and abandonment settle a quest, so they may only be final.
    if action_name in ('attempt','abandon') and position <> step_count then return false; end if;
    if position = step_count and action_name not in ('attempt','abandon') then return false; end if;
  end loop;
  return true;
end
$function$;

create table private.world_quests (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  package_id uuid not null references private.npc_version_resident_packages(id) on delete restrict,
  package_hash text not null check (length(package_hash) > 0),
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  origin text not null check (origin in ('authored_milestone','generated_successor')),
  authored_milestone_index integer,
  authored_milestone_key text,
  parent_quest_id uuid references private.world_quests(id) on delete restrict,
  title text not null check (length(title) between 1 and 240),
  objective text not null check (length(objective) between 1 and 2000),
  motivation text not null check (length(motivation) between 1 and 2000),
  constraints text[] not null default '{}'::text[],
  target_refs text[] not null default '{}'::text[],
  difficulty integer not null check (difficulty between 0 and 4),
  definition_plan jsonb not null check (private.world_quest_plan_is_valid(definition_plan)),
  current_plan jsonb not null check (private.world_quest_plan_is_valid(current_plan)),
  plan_revision integer not null default 1 check (plan_revision >= 1),
  state text not null check (state in ('scheduled','active','succeeded','failed','abandoned')),
  current_step integer not null default 0 check (current_step >= 0),
  preparation integer not null default 0 check (preparation between 0 and 2),
  scheduled_for_day integer not null check (scheduled_for_day >= 0),
  activated_day integer,
  terminal_day integer,
  terminal_event_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((origin = 'authored_milestone') = (authored_milestone_index is not null and authored_milestone_key is not null)),
  check ((origin = 'generated_successor') = (parent_quest_id is not null)),
  check ((origin = 'authored_milestone') = (parent_quest_id is null)),
  check ((state = 'scheduled') = (activated_day is null)),
  check ((state in ('succeeded','failed','abandoned')) = (terminal_day is not null)),
  check (current_step < jsonb_array_length(current_plan))
);

create unique index world_quests_one_live_per_resident
  on private.world_quests(save_id, instance_id)
  where state in ('scheduled','active');
create unique index world_quests_authored_milestone_identity
  on private.world_quests(save_id, instance_id, authored_milestone_key)
  where origin = 'authored_milestone';
create index world_quests_by_save_instance on private.world_quests(save_id, instance_id, state);

create function private.world_quest_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parent_row private.world_quests;
begin
  if not exists (
    select 1 from private.world_npc_instances instance_row
    join private.world_resident_package_pins pin on pin.instance_id = instance_row.id
    where instance_row.id = new.instance_id
      and instance_row.save_id = new.save_id
      and instance_row.version_id = new.version_id
      and pin.package_id = new.package_id
      and pin.package_hash = new.package_hash
  ) then
    raise exception using errcode = '23514', message = 'Quest must use its resident package pin';
  end if;

  if new.parent_quest_id is not null then
    select * into parent_row from private.world_quests where id = new.parent_quest_id;
    if not found or parent_row.save_id <> new.save_id or parent_row.instance_id <> new.instance_id
      or parent_row.state not in ('succeeded','failed','abandoned') then
      raise exception using errcode = '23514', message = 'Generated quest must follow a terminal quest for the same resident';
    end if;
  end if;
  return new;
end
$function$;
create trigger world_quest_scope_guard
before insert or update on private.world_quests
for each row execute function private.world_quest_scope_guard();

create function private.world_quest_immutable_definition_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.save_id <> old.save_id or new.instance_id <> old.instance_id
    or new.package_id <> old.package_id or new.package_hash <> old.package_hash
    or new.version_id <> old.version_id or new.origin <> old.origin
    or new.authored_milestone_index is distinct from old.authored_milestone_index
    or new.authored_milestone_key is distinct from old.authored_milestone_key
    or new.parent_quest_id is distinct from old.parent_quest_id
    or new.title <> old.title or new.objective <> old.objective or new.motivation <> old.motivation
    or new.constraints <> old.constraints or new.target_refs <> old.target_refs
    or new.difficulty <> old.difficulty or new.definition_plan <> old.definition_plan
    or new.scheduled_for_day <> old.scheduled_for_day then
    raise exception using errcode = '55000', message = 'Quest definition and source are immutable';
  end if;
  if new.activated_day is distinct from old.activated_day
    and not (old.state = 'scheduled' and new.state = 'active' and old.activated_day is null and new.activated_day is not null) then
    raise exception using errcode = '55000', message = 'Quest activation day is immutable outside scheduled activation';
  end if;
  if new.current_plan <> old.current_plan and new.plan_revision <> old.plan_revision + 1 then
    raise exception using errcode = '23514', message = 'Quest plan changes require the next plan revision';
  end if;
  if new.current_plan = old.current_plan and new.plan_revision <> old.plan_revision then
    raise exception using errcode = '23514', message = 'Quest plan revision requires a changed plan';
  end if;
  if old.state in ('succeeded','failed','abandoned') and new is distinct from old then
    raise exception using errcode = '55000', message = 'Terminal quests are immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$function$;
create trigger world_quest_immutable_definition_guard
before update on private.world_quests
for each row execute function private.world_quest_immutable_definition_guard();

create function private.world_current_quest(p_save_id uuid, p_instance_id uuid)
returns private.world_quests
language sql
stable
security definer
set search_path = ''
as $function$
  select quest_row
  from private.world_quests quest_row
  where quest_row.save_id = p_save_id
    and quest_row.instance_id = p_instance_id
    and quest_row.state in ('active','scheduled')
  order by case quest_row.state when 'active' then 0 else 1 end, quest_row.scheduled_for_day, quest_row.created_at
  limit 1
$function$;

create table private.world_quest_events (
  id uuid primary key default extensions.gen_random_uuid(),
  quest_id uuid not null references private.world_quests(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  day_number integer not null check (day_number >= 0),
  step_index integer not null check (step_index >= 0),
  action text not null check (action in ('prepare','attempt','wait','abandon')),
  approach text not null check (approach in ('scouting','combat','diplomacy','trade')),
  skill integer not null check (skill between 0 and 4),
  difficulty integer not null check (difficulty between 0 and 4),
  preparation_before integer not null check (preparation_before between 0 and 2),
  preparation_after integer not null check (preparation_after between 0 and 2),
  hospitality integer not null check (hospitality between -3 and 3),
  readiness integer not null,
  chance integer check (chance between 5 and 95),
  draw integer check (draw between 0 and 99),
  outcome text not null check (outcome in ('prepared','waited','succeeded','failed','abandoned')),
  rules_version text not null default 'quest-lifecycle-v1',
  narration text not null default '',
  public_news boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique(quest_id, day_number),
  check ((action = 'attempt') = (chance is not null and draw is not null)),
  check ((action <> 'attempt') = (chance is null and draw is null))
);

create function private.world_quest_event_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare quest_row private.world_quests;
begin
  select * into quest_row from private.world_quests where id = new.quest_id;
  if not found or quest_row.save_id <> new.save_id or quest_row.instance_id <> new.instance_id then
    raise exception using errcode = '23514', message = 'Quest event must match its quest scope';
  end if;
  return new;
end
$function$;
create trigger world_quest_event_scope_guard before insert on private.world_quest_events
for each row execute function private.world_quest_event_scope_guard();
create trigger world_quest_events_append_only before update or delete on private.world_quest_events
for each row execute function private.world_history_append_only();

alter table private.world_quests
  add constraint world_quests_terminal_event_id_fkey
  foreign key (terminal_event_id) references private.world_quest_events(id) on delete restrict;

create table private.world_quest_plan_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  quest_id uuid not null references private.world_quests(id) on delete cascade,
  expected_prior_revision integer not null check (expected_prior_revision >= 1),
  expected_current_step integer not null check (expected_current_step >= 0),
  dialogue_turn_id uuid references private.world_npc_dialogue_turns(id) on delete restrict,
  prior_plan jsonb not null check (private.world_quest_plan_is_valid(prior_plan)),
  replacement_plan jsonb not null check (private.world_quest_plan_is_valid(replacement_plan)),
  suffix_plan jsonb not null check (private.world_quest_plan_is_valid(suffix_plan)),
  reason text not null check (length(reason) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  unique(quest_id, expected_prior_revision)
);
create trigger world_quest_plan_revisions_append_only before update or delete on private.world_quest_plan_revisions
for each row execute function private.world_history_append_only();

create table private.world_quest_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  quest_id uuid not null references private.world_quests(id) on delete cascade,
  terminal_event_id uuid not null unique references private.world_quest_events(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  status text not null default 'awaiting' check (status in ('awaiting','processing','committed','failed')),
  frozen_context jsonb not null default '{}'::jsonb check (jsonb_typeof(frozen_context) = 'object'),
  context_fingerprint text not null check (length(context_fingerprint) > 0),
  decision jsonb,
  result jsonb,
  receipt jsonb,
  processing_started_at timestamptz,
  committed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'processing') = (processing_started_at is not null)),
  check ((status = 'committed') = (committed_at is not null)),
  check ((status = 'failed') = (failed_at is not null))
);

create function private.world_quest_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare quest_row private.world_quests; event_row private.world_quest_events;
begin
  select * into quest_row from private.world_quests where id = new.quest_id;
  if not found then
    raise exception using errcode = '23514', message = 'Quest transition requires an existing quest';
  end if;
  select * into event_row from private.world_quest_events where id = new.terminal_event_id;
  if not found then
    raise exception using errcode = '23514', message = 'Quest transition requires an existing terminal event';
  end if;
  if quest_row.save_id <> new.save_id or quest_row.instance_id <> new.instance_id
    or event_row.quest_id <> new.quest_id or event_row.outcome not in ('succeeded','failed','abandoned') then
    raise exception using errcode = '23514', message = 'Quest transition requires a terminal event in the same quest scope';
  end if;
  if tg_op = 'UPDATE' and (new.quest_id <> old.quest_id or new.terminal_event_id <> old.terminal_event_id
    or new.save_id <> old.save_id or new.instance_id <> old.instance_id
    or new.frozen_context <> old.frozen_context or new.context_fingerprint <> old.context_fingerprint) then
    raise exception using errcode = '55000', message = 'Quest transition context is immutable';
  end if;
  return new;
end
$function$;
create trigger world_quest_transition_guard before insert or update on private.world_quest_transitions
for each row execute function private.world_quest_transition_guard();

-- Package materialization remains the single resident-creation path.  The
-- wrapper adds the first authored milestone after the predecessor has pinned
-- the resident and therefore makes retries deterministic.
alter function private.world_materialize_resident_from_version(uuid, uuid, uuid, integer)
  rename to world_materialize_resident_from_version_before_unified_quest;

create function private.world_materialize_resident_from_version(p_save_id uuid, p_npc_id uuid, p_version_id uuid, p_arrived_day integer)
returns table(instance_id uuid, version_id uuid, package_id uuid, package_hash text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  materialized record;
  current_day integer;
  sheet jsonb;
  milestone jsonb;
  milestone_key text;
begin
  select * into materialized
  from private.world_materialize_resident_from_version_before_unified_quest(p_save_id, p_npc_id, p_version_id, p_arrived_day);
  if not found then return; end if;

  select save_row.current_day into current_day from public.tavern_saves save_row where save_row.id = p_save_id for update;
  select version_row.sheet into sheet from private.npc_versions version_row where version_row.id = materialized.version_id;
  milestone := sheet #> '{campaign,milestones,0}';
  milestone_key := milestone->>'id';
  if jsonb_typeof(milestone) <> 'object' or milestone_key is null
    or not private.world_quest_plan_is_valid(milestone->'startingPlan') then
    raise exception using errcode = 'PT409', message = 'Pinned resident package needs a valid first authored milestone';
  end if;

  insert into private.world_quests(
    save_id, instance_id, package_id, package_hash, version_id, origin,
    authored_milestone_index, authored_milestone_key, title, objective, motivation,
    constraints, target_refs, difficulty, definition_plan, current_plan, state,
    current_step, preparation, scheduled_for_day, activated_day
  ) values (
    p_save_id, materialized.instance_id, materialized.package_id, materialized.package_hash, materialized.version_id,
    'authored_milestone', 0, milestone_key, coalesce(milestone->>'title', milestone_key),
    coalesce(milestone->>'outcome', milestone_key), coalesce(milestone->>'motivation', 'Pursue the next meaningful step.'),
    coalesce(array(select jsonb_array_elements_text(milestone->'constraints')), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(milestone->'allowedTargets')), '{}'::text[]),
    coalesce((milestone->>'difficulty')::integer, 0), milestone->'startingPlan', milestone->'startingPlan',
    'active', 0, 0, current_day, current_day
  ) on conflict do nothing;

  instance_id := materialized.instance_id;
  version_id := materialized.version_id;
  package_id := materialized.package_id;
  package_hash := materialized.package_hash;
  return next;
end
$function$;

revoke all on table private.world_quests, private.world_quest_events, private.world_quest_plan_revisions, private.world_quest_transitions from public, anon, authenticated, service_role;
revoke all on function private.world_quest_plan_is_valid(jsonb), private.world_current_quest(uuid,uuid), private.world_quest_scope_guard(), private.world_quest_immutable_definition_guard(), private.world_quest_event_scope_guard(), private.world_quest_transition_guard() from public, anon, authenticated;
revoke all on function private.world_materialize_resident_from_version(uuid,uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function private.world_materialize_resident_from_version(uuid,uuid,uuid,integer) to service_role;

commit;
