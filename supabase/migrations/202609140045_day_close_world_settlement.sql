-- Gate F: make the current deterministic day close atomically enqueue the
-- subject-scoped, frozen settlement work that evolves the following day.
begin;

alter table private.world_settlement_jobs
  add column subject_instance_id uuid references private.world_npc_instances(id) on delete cascade;

alter table private.world_settlement_jobs
  drop constraint if exists world_settlement_jobs_settlement_id_job_kind_key;

-- Older, unprocessed D1 fixture jobs did not identify a resident. Preserve
-- those rows, while enforcing the subject shape for every new job.
alter table private.world_settlement_jobs
  add constraint world_settlement_job_subject_shape
  check (
    (job_kind = 'resident' and subject_instance_id is not null)
    or (job_kind <> 'resident' and subject_instance_id is null)
  ) not valid;

create unique index world_settlement_one_nonresident_kind
  on private.world_settlement_jobs(settlement_id, job_kind)
  where job_kind <> 'resident';

create unique index world_settlement_one_resident_subject
  on private.world_settlement_jobs(settlement_id, subject_instance_id)
  where job_kind = 'resident';

create function private.world_settlement_job_subject_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.job_kind = 'resident') <> (new.subject_instance_id is not null) then
    raise exception using errcode = '23514', message = 'Settlement job subject does not match its kind';
  end if;
  if new.subject_instance_id is not null and not exists (
    select 1
    from private.world_settlements settlement
    join private.world_npc_instances resident
      on resident.id = new.subject_instance_id
     and resident.save_id = settlement.save_id
    where settlement.id = new.settlement_id
  ) then
    raise exception using errcode = '23514', message = 'Settlement resident must belong to the same save';
  end if;
  return new;
end;
$$;

create trigger world_settlement_job_subject_scope
  before insert or update of settlement_id, job_kind, subject_instance_id
  on private.world_settlement_jobs
  for each row execute function private.world_settlement_job_subject_scope();

-- Subject identity is part of the frozen job binding.
create or replace function private.world_settlement_job_frozen_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.settlement_id <> old.settlement_id
    or new.ordinal <> old.ordinal
    or new.job_kind <> old.job_kind
    or new.subject_instance_id is distinct from old.subject_instance_id
    or new.input_fingerprint <> old.input_fingerprint
    or new.input_snapshot is distinct from old.input_snapshot
    or new.input_version is distinct from old.input_version then
    raise exception using errcode = '55000', message = 'Settlement job input is immutable';
  end if;
  return new;
end;
$$;

-- D1's generic service-only harness has no authoritative resident identity.
-- Keep it useful for queue/lease testing, but do not create an unbound resident
-- job. Real resident work is created only by the day-close path below.
create or replace function private.world_settlement_enqueue_core(
  p_save_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_input_snapshot jsonb,
  p_input_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  save_row public.tavern_saves;
  snapshot jsonb;
  job_snapshot jsonb;
  fingerprint text;
  settlement_id uuid;
  existing private.world_settlements;
  kind text;
  ordinal smallint := 0;
begin
  if p_action_id is null
    or jsonb_typeof(p_input_snapshot) <> 'object'
    or octet_length(p_input_snapshot::text) > 12000
    or char_length(coalesce(p_input_version, '')) not between 1 and 80 then
    raise sqlstate 'PT400' using message = 'Settlement input is invalid';
  end if;
  select * into save_row from public.tavern_saves where id = p_save_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  select * into existing
  from private.world_settlements
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    return jsonb_build_object(
      'settlementId', existing.id,
      'status', existing.status,
      'replayed', true,
      'inputFingerprint', existing.input_fingerprint
    );
  end if;
  if save_row.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Save revision changed';
  end if;
  if save_row.world_phase <> 'open' then
    raise sqlstate 'PT409' using message = 'Save is already settling';
  end if;

  snapshot := p_input_snapshot || jsonb_build_object(
    'saveId', p_save_id,
    'dayNumber', save_row.current_day,
    'sourceRevision', save_row.revision,
    'inputVersion', p_input_version
  );
  if octet_length(snapshot::text) > 16384 then
    raise sqlstate 'PT400' using message = 'Settlement input is too large after server pinning';
  end if;
  fingerprint := encode(extensions.digest(snapshot::text, 'sha256'), 'hex');
  insert into private.world_settlements(
    save_id, day_number, source_revision, input_fingerprint, action_id,
    input_snapshot, input_version, status, deadline_at
  ) values (
    p_save_id, save_row.current_day, save_row.revision, fingerprint, p_action_id,
    snapshot, p_input_version, 'queued', clock_timestamp() + interval '120 seconds'
  ) returning id into settlement_id;

  foreach kind in array array['snapshot', 'canon', 'quest', 'effects', 'news', 'finalize'] loop
    ordinal := ordinal + 1;
    job_snapshot := snapshot || jsonb_build_object('jobKind', kind, 'ordinal', ordinal);
    if octet_length(job_snapshot::text) > 16384 then
      raise sqlstate 'PT400' using message = 'Settlement job input is too large after derivation';
    end if;
    insert into private.world_settlement_jobs(
      settlement_id, ordinal, job_kind, input_fingerprint, input_snapshot, input_version
    ) values (
      settlement_id, ordinal, kind,
      encode(extensions.digest(job_snapshot::text, 'sha256'), 'hex'),
      job_snapshot, p_input_version
    );
  end loop;
  update public.tavern_saves set world_phase = 'settling' where id = p_save_id;
  return jsonb_build_object(
    'settlementId', settlement_id,
    'status', 'queued',
    'replayed', false,
    'inputFingerprint', fingerprint,
    'dayNumber', save_row.current_day,
    'sourceRevision', save_row.revision
  );
end;
$$;

create function private.world_day_close_evidence(
  p_save_id uuid,
  p_instance_id uuid,
  p_closing_day integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select
      'dialogue-' || replace(turn.id::text, '-', '') as id,
      'dialogue'::text as kind,
      turn.day_number as happened_on_day,
      turn.input_sequence::integer as sequence,
      encode(extensions.digest(jsonb_build_object(
        'turnId', turn.id,
        'message', turn.message,
        'reply', turn.result->>'reply',
        'relationshipChange', turn.result->'relationshipChange',
        'intention', turn.result->'intention',
        'serving', turn.result->'serving'
      )::text, 'sha256'), 'hex') as source_fingerprint,
      case
        when abs(coalesce((turn.result->>'relationshipChange')::integer, 0)) >= 2
          or turn.result->'intention' <> 'null'::jsonb
          or coalesce((select max(memory.importance) from private.world_npc_memories memory where memory.turn_id = turn.id), 0) >= 3
          then 'major'
        else 'meaningful'
      end as salience,
      left('Keeper: ' || btrim(turn.message) || ' NPC: ' || btrim(coalesce(turn.result->>'reply', '')), 500) as summary
    from private.world_npc_dialogue_turns turn
    where turn.save_id = p_save_id
      and turn.instance_id = p_instance_id
      and turn.status = 'completed'
      and turn.day_number = p_closing_day
      and (
        abs(coalesce((turn.result->>'relationshipChange')::integer, 0)) > 0
        or turn.result->'intention' <> 'null'::jsonb
        or turn.result->'serving' <> 'null'::jsonb
        or exists (
          select 1 from private.world_npc_memories memory
          where memory.turn_id = turn.id and memory.importance >= 2
        )
      )
    union all
    select
      'quest-' || replace(event.id::text, '-', ''),
      'quest_outcome',
      event.day,
      0,
      encode(extensions.digest(jsonb_build_object(
        'eventId', event.id,
        'outcome', event.outcome,
        'draw', event.draw,
        'chance', event.chance,
        'narration', event.narration,
        'publicNews', event.public_news
      )::text, 'sha256'), 'hex'),
      case when event.outcome in ('succeeded', 'failed', 'abandoned', 'settled') then 'major' else 'meaningful' end,
      left(btrim(event.narration), 500)
    from private.world_npc_quest_events event
    where event.instance_id = p_instance_id and event.day = p_closing_day
    union all
    select
      'hospitality-' || replace(hospitality.action_id::text, '-', ''),
      'hospitality_reaction',
      hospitality.day_number,
      0,
      encode(extensions.digest(jsonb_build_object(
        'actionId', hospitality.action_id,
        'itemKind', hospitality.item_kind,
        'itemName', hospitality.item_name,
        'qualityIndex', hospitality.quality_index,
        'relationshipChange', hospitality.relationship_change
      )::text, 'sha256'), 'hex'),
      case when abs(hospitality.relationship_change) >= 2 then 'meaningful' else 'minor' end,
      left(
        'The keeper served ' || hospitality.item_name || '; relationship changed by '
          || hospitality.relationship_change::text || '.',
        500
      )
    from private.world_npc_hospitality_events hospitality
    where hospitality.save_id = p_save_id
      and hospitality.instance_id = p_instance_id
      and hospitality.day_number = p_closing_day
  ), ranked as (
    select *, case salience when 'defining' then 4 when 'major' then 3 when 'meaningful' then 2 else 1 end as salience_rank
    from candidates
    where char_length(btrim(summary)) > 0
    order by salience_rank desc, happened_on_day desc, sequence desc, id
    limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'kind', kind,
    'happenedOnDay', happened_on_day,
    'sequence', sequence,
    'sourceFingerprint', source_fingerprint,
    'salience', salience,
    'summary', summary
  ) order by salience_rank desc, happened_on_day desc, sequence desc, id), '[]'::jsonb)
  from ranked
$$;

create function private.world_day_close_snapshot(
  p_save_id uuid,
  p_current_day integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entity_candidates as (
    select resident.id::text as id, 'npc'::text as kind, 0 as priority
    from private.world_npc_instances resident
    where resident.save_id = p_save_id
      and resident.status not in ('removed', 'quarantined')
    union all
    select entity.id::text, entity.entity_kind, 1
    from private.world_canonical_entities entity
    where entity.save_id = p_save_id and entity.lifecycle in ('discovered', 'active')
  ), unique_entities as (
    select distinct on (id) id, kind, priority
    from entity_candidates
    order by id, priority
  ), bounded_entities as (
    select id, kind, priority
    from unique_entities
    order by priority, id
    limit 64
  ), active_quests as (
    select quest.id::text as id
    from private.world_procedural_quests quest
    where quest.save_id = p_save_id and quest.state = 'active'
    order by quest.id
    limit 64
  ), irreversible as (
    select distinct on (capability.target_instance_id, capability.capability_key)
      capability.capability_key as effect_key,
      capability.target_instance_id::text as target_entity_id,
      warning.visible_day
    from private.world_irreversible_capabilities capability
    join private.world_effect_warnings warning
      on warning.save_id = capability.save_id
     and warning.target_instance_id = capability.target_instance_id
    where capability.save_id = p_save_id
      and capability.capability_key = 'retire_entity'
      and capability.critic_approved
      and capability.immutable_at is not null
      and warning.visible_day >= 1
      and warning.visible_day < p_current_day
    order by capability.target_instance_id, capability.capability_key, warning.visible_day
    limit 64
  )
  select jsonb_build_object(
    'currentDay', p_current_day,
    'entityKinds', coalesce((select jsonb_object_agg(id, kind order by id) from bounded_entities), '{}'::jsonb),
    'activeQuestIds', coalesce((select jsonb_agg(id order by id) from active_quests), '[]'::jsonb),
    'authorizedIrreversibleEffects', coalesce((select jsonb_agg(jsonb_build_object(
      'effectKey', effect_key,
      'targetEntityId', target_entity_id,
      'criticApproved', true,
      'visibleSinceDay', visible_day
    ) order by target_entity_id, effect_key) from irreversible), '[]'::jsonb)
  )
$$;

create function private.world_day_close_resident_evolution(
  p_save_id uuid,
  p_instance_id uuid,
  p_closing_day integer,
  p_current_day integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  evidence jsonb;
begin
  select private.world_frozen_resident_evolution_base(p_instance_id) into base;
  if base is null or not exists (
    select 1
    from private.world_npc_instances resident
    join private.world_resident_profiles profile on profile.instance_id = resident.id
    join private.world_resident_evolution_pins pin on pin.instance_id = resident.id
    where resident.id = p_instance_id
      and resident.save_id = p_save_id
      and profile.save_id = p_save_id
      and pin.save_id = p_save_id
      and profile.profile_schema_version <> 'resident-profile-compat-v1'
      and resident.status not in ('dead', 'departed', 'dismissed', 'removed', 'quarantined')
  ) then
    return null;
  end if;
  evidence := private.world_day_close_evidence(p_save_id, p_instance_id, p_closing_day);
  if jsonb_array_length(evidence) = 0
    or not exists (
      select 1 from jsonb_array_elements(evidence) item
      where item->>'salience' in ('meaningful', 'major', 'defining')
    ) then
    return null;
  end if;
  return base || jsonb_build_object(
    'worldSnapshot', private.world_day_close_snapshot(p_save_id, p_current_day),
    'authorizedEvidence', evidence
  );
end;
$$;

-- Retire the community wrapper. The new close function calls its lower
-- deterministic predecessor so legacy NPC quests cannot resolve in parallel
-- with the queued evolving-world settlement.
alter function public.advance_tavern_day(uuid, uuid, bigint)
  rename to advance_tavern_day_before_world_settlement;
alter function public.advance_tavern_day_before_world_settlement(uuid, uuid, bigint)
  set schema private;

create or replace function private.advance_tavern_day_before_world_settlement(
  p_save_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.advance_tavern_day_before_community_npcs(
    p_save_id, p_action_id, p_expected_revision
  );
end;
$$;

create function public.advance_tavern_day(
  p_save_id uuid,
  p_action_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  save_before public.tavern_saves;
  save_after public.tavern_saves;
  prior public.craft_actions;
  legacy_result jsonb;
  final_result jsonb;
  arrival jsonb;
  settlement_snapshot jsonb;
  settlement_fingerprint text;
  settlement_id uuid;
  resident record;
  evolution jsonb;
  job_snapshot jsonb;
  job_fingerprint text;
  kind text;
  ordinal smallint := 0;
  closing_day integer;
  input_version constant text := 'world-day-close-v1';
begin
  if auth.uid() is null then
    raise sqlstate 'PT401' using message = 'Authentication required';
  end if;
  if p_save_id is null or p_action_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid day transition';
  end if;

  select * into save_before
  from public.tavern_saves
  where id = p_save_id and user_id = auth.uid()
  for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern not found'; end if;

  select * into prior
  from public.craft_actions
  where save_id = p_save_id and action_id = p_action_id;
  if found then
    if prior.command_kind = 'advance_day'
      and prior.input_expected_revision = p_expected_revision then
      return prior.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier already used';
  end if;

  if save_before.world_phase <> 'open' then
    raise sqlstate 'PT409' using message = 'World settlement is active';
  end if;

  legacy_result := private.advance_tavern_day_before_world_settlement(
    p_save_id, p_action_id, p_expected_revision
  );
  select * into strict save_after from public.tavern_saves where id = p_save_id for update;
  closing_day := save_after.current_day - 1;
  settlement_snapshot := jsonb_build_object(
    'saveId', save_after.id,
    'dayNumber', closing_day,
    'sourceRevision', save_after.revision,
    'inputVersion', input_version
  );
  settlement_fingerprint := encode(extensions.digest(settlement_snapshot::text, 'sha256'), 'hex');

  insert into private.world_settlements(
    save_id, day_number, source_revision, input_fingerprint, action_id,
    input_snapshot, input_version, status, deadline_at
  ) values (
    save_after.id, closing_day, save_after.revision, settlement_fingerprint, p_action_id,
    settlement_snapshot, input_version, 'queued', clock_timestamp() + interval '120 seconds'
  ) returning id into settlement_id;

  foreach kind in array array['snapshot', 'canon'] loop
    ordinal := ordinal + 1;
    job_snapshot := settlement_snapshot || jsonb_build_object('jobKind', kind, 'ordinal', ordinal);
    job_fingerprint := encode(extensions.digest(job_snapshot::text, 'sha256'), 'hex');
    insert into private.world_settlement_jobs(
      settlement_id, ordinal, job_kind, input_fingerprint, input_snapshot, input_version
    ) values (
      settlement_id, ordinal, kind, job_fingerprint, job_snapshot, input_version
    );
  end loop;

  -- This loop runs before arrival, so a guest arriving for the new day cannot
  -- acquire evidence or evolve for the day before they existed in this save.
  for resident in
    select instance.id
    from private.world_npc_instances instance
    join private.world_resident_profiles profile on profile.instance_id = instance.id
    join private.world_resident_evolution_pins pin on pin.instance_id = instance.id
    where instance.save_id = save_after.id
      and profile.save_id = save_after.id
      and pin.save_id = save_after.id
      and profile.profile_schema_version <> 'resident-profile-compat-v1'
      and instance.status not in ('dead', 'departed', 'dismissed', 'removed', 'quarantined')
    order by instance.id
  loop
    evolution := private.world_day_close_resident_evolution(
      save_after.id, resident.id, closing_day, save_after.current_day
    );
    if evolution is not null then
      ordinal := ordinal + 1;
      job_snapshot := jsonb_build_object(
        'jobKind', 'resident',
        'ordinal', ordinal,
        'subjectInstanceId', resident.id,
        'evolution', evolution
      );
      if octet_length(job_snapshot::text) > 16384 then
        raise sqlstate 'PT400' using message = 'Frozen resident settlement input is too large';
      end if;
      job_fingerprint := encode(extensions.digest(job_snapshot::text, 'sha256'), 'hex');
      insert into private.world_settlement_jobs(
        settlement_id, ordinal, job_kind, subject_instance_id,
        input_fingerprint, input_snapshot, input_version
      ) values (
        settlement_id, ordinal, 'resident', resident.id,
        job_fingerprint, job_snapshot, input_version
      );
    end if;
  end loop;

  foreach kind in array array['quest', 'effects', 'news', 'finalize'] loop
    ordinal := ordinal + 1;
    job_snapshot := settlement_snapshot || jsonb_build_object('jobKind', kind, 'ordinal', ordinal);
    job_fingerprint := encode(extensions.digest(job_snapshot::text, 'sha256'), 'hex');
    insert into private.world_settlement_jobs(
      settlement_id, ordinal, job_kind, input_fingerprint, input_snapshot, input_version
    ) values (
      settlement_id, ordinal, kind, job_fingerprint, job_snapshot, input_version
    );
  end loop;

  update public.tavern_saves set world_phase = 'settling' where id = save_after.id;
  arrival := private.maybe_arrive_world_npc(save_after.id, closing_day, p_action_id);
  final_result := legacy_result || jsonb_build_object(
    'communityNpcEvents', '[]'::jsonb,
    'communityArrival', arrival,
    'worldSettlement', jsonb_build_object(
      'settlementId', settlement_id,
      'status', 'queued',
      'dayNumber', closing_day
    )
  );
  update public.craft_actions
  set result = final_result
  where save_id = save_after.id and action_id = p_action_id and command_kind = 'advance_day';
  return final_result;
end;
$$;

-- Include the frozen resident subject in the service worker claim. This is a
-- public function only in the PostgREST sense; grants remain service-role only.
create or replace function public.world_settlement_claim(p_settlement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  settlement private.world_settlements;
  job private.world_settlement_jobs;
begin
  result := private.world_settlement_claim_v1(p_settlement_id);
  if result ? 'jobId' then
    select * into settlement from private.world_settlements where id = p_settlement_id;
    select * into job from private.world_settlement_jobs where id = (result->>'jobId')::uuid;
    return result || jsonb_build_object(
      'subjectInstanceId', job.subject_instance_id,
      'inputVersion', settlement.input_version,
      'inputSnapshot', settlement.input_snapshot,
      'jobInputVersion', job.input_version,
      'jobInputSnapshot', job.input_snapshot,
      'checkpoints', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'stage', checkpoint.stage,
          'payload', checkpoint.payload,
          'usage', checkpoint.usage,
          'model', checkpoint.model,
          'promptVersion', checkpoint.prompt_version,
          'createdAt', checkpoint.created_at,
          'sourceFence', checkpoint.fence,
          'sourceAttempt', checkpoint.attempt_number
        ) order by checkpoint.stage), '[]'::jsonb)
        from (
          select distinct on (record.stage)
            record.stage, record.payload, record.usage, record.model,
            record.prompt_version, record.created_at, record.fence, attempt.attempt_number
          from private.world_settlement_stage_checkpoints record
          left join private.world_settlement_attempts attempt
            on attempt.job_id = record.job_id and attempt.fence = record.fence
          where record.job_id = job.id
          order by record.stage, record.created_at desc, record.id desc
        ) checkpoint
      )
    );
  end if;
  return result;
end;
$$;

-- Every player command which changes the save revision ultimately updates this
-- row. Exact action replays return before this trigger; fresh mutations roll
-- back atomically while the world is settling. Settlement workers use the
-- service role and remain able to commit/reopen the save.
create function private.world_block_player_save_mutation_while_settling()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.world_phase = 'settling'
    and new.world_phase = 'settling'
    and auth.role() <> 'service_role' then
    raise sqlstate 'PT409' using message = 'World settlement is active';
  end if;
  return new;
end;
$$;

create trigger world_block_player_save_mutation_while_settling
  before update on public.tavern_saves
  for each row execute function private.world_block_player_save_mutation_while_settling();

-- Community dialogue uses a service-role orchestrator and does not update the
-- save row when a turn starts, so it needs an explicit processing guard.
create function private.world_block_dialogue_while_settling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'processing' and exists (
    select 1 from public.tavern_saves save
    where save.id = new.save_id and save.world_phase = 'settling'
  ) then
    raise sqlstate 'PT409' using message = 'World settlement is active';
  end if;
  return new;
end;
$$;

create trigger world_block_dialogue_while_settling
  before insert or update of status, fence, lease_until
  on private.world_npc_dialogue_turns
  for each row execute function private.world_block_dialogue_while_settling();

revoke all on function private.world_settlement_job_subject_scope() from public, anon, authenticated, service_role;
revoke all on function private.world_day_close_evidence(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.world_day_close_snapshot(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.world_day_close_resident_evolution(uuid, uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.advance_tavern_day_before_world_settlement(uuid, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function private.world_block_player_save_mutation_while_settling() from public, anon, authenticated, service_role;
revoke all on function private.world_block_dialogue_while_settling() from public, anon, authenticated, service_role;

revoke all on function public.advance_tavern_day(uuid, uuid, bigint) from public, anon;
grant execute on function public.advance_tavern_day(uuid, uuid, bigint) to authenticated;

commit;
