-- Issue #33: authoritative sources are registered once before derived work.
-- The ledger is deliberately database-owned: model/provider output never
-- chooses a source, its scope, disclosure, hash, or stream coordinate.
begin;

create table if not exists private.world_npc_memory_source_cursors (
  instance_id uuid primary key references private.world_npc_instances(id) on delete cascade,
  next_ledger_sequence bigint not null default 0 check(next_ledger_sequence >= 0)
);

create table if not exists private.world_npc_memory_sources (
  source_kind text not null check(source_kind in ('dialogue_turn','quest_event','hospitality','resident_evolution')),
  source_id uuid not null,
  source_version bigint not null check(source_version > 0),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  ledger_sequence bigint not null check(ledger_sequence >= 0),
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  disclosure_class text not null check(disclosure_class in ('player_visible','npc_known','npc_private','system')),
  occurred_day integer check(occurred_day >= 0),
  occurred_sequence bigint check(occurred_sequence >= 0),
  learned_day integer check(learned_day >= 0),
  learned_sequence bigint check(learned_sequence >= 0),
  envelope jsonb not null check(jsonb_typeof(envelope)='object'),
  registered_at timestamptz not null default clock_timestamp(),
  primary key(source_kind,source_id,source_version),
  unique(instance_id,ledger_sequence),
  check(coalesce(envelope->>'ledgerSequence','') ~ '^[0-9]+$' and ledger_sequence = (envelope->>'ledgerSequence')::bigint)
);
create index if not exists world_npc_memory_sources_scope on private.world_npc_memory_sources(instance_id,ledger_sequence);
-- The ledger key deliberately has one UUID source identity.  Hospitality used
-- a composite physical key historically, so make its action receipt globally
-- unique before it can participate in source-backed work.
alter table private.world_npc_hospitality_events drop constraint if exists world_npc_hospitality_events_action_id_unique;
alter table private.world_npc_hospitality_events add constraint world_npc_hospitality_events_action_id_unique unique(action_id);
alter table private.world_npc_memory_sources drop constraint if exists world_npc_memory_sources_occurred_day_check;
alter table private.world_npc_memory_sources add constraint world_npc_memory_sources_occurred_day_check check(occurred_day >= 0);
alter table private.world_npc_memory_sources drop constraint if exists world_npc_memory_sources_learned_day_check;
alter table private.world_npc_memory_sources add constraint world_npc_memory_sources_learned_day_check check(learned_day >= 0);
alter table private.world_npc_memory_sources drop constraint if exists world_npc_memory_sources_envelope_check;
alter table private.world_npc_memory_sources add constraint world_npc_memory_sources_envelope_check check(coalesce(envelope->>'ledgerSequence','') ~ '^[0-9]+$' and ledger_sequence=(envelope->>'ledgerSequence')::bigint);

alter table private.world_npc_memory_outbox drop constraint world_npc_memory_outbox_source_kind_check;
alter table private.world_npc_memory_outbox add constraint world_npc_memory_outbox_source_kind_check
  check(source_kind in ('dialogue_turn','quest_event','hospitality','resident_evolution'));
alter table private.world_npc_memories drop constraint world_npc_memories_source_kind_check;
alter table private.world_npc_memories add constraint world_npc_memories_source_kind_check
  check(source_kind in ('dialogue_turn','quest_event','hospitality','resident_evolution','manual'));
alter table private.world_npc_memories drop constraint world_npc_memories_kind_check;
alter table private.world_npc_memories add constraint world_npc_memories_kind_check
  check(kind in ('keeper_claim','npc_statement','promise','interaction','source_evidence'));
alter table private.world_npc_memories drop constraint world_npc_memories_speaker_check;
alter table private.world_npc_memories add constraint world_npc_memories_speaker_check
  check(speaker in ('keeper','npc','system'));
alter table private.world_npc_memories drop constraint if exists world_npc_memories_source_turn_consistency;
alter table private.world_npc_memories alter column turn_id drop not null;
alter table private.world_npc_memories add constraint world_npc_memories_source_turn_consistency
  check((source_kind='dialogue_turn') = (turn_id is not null));
alter table private.world_npc_memory_artifacts drop constraint world_npc_memory_artifacts_source_kind_check;
alter table private.world_npc_memory_artifacts add constraint world_npc_memory_artifacts_source_kind_check
  check(source_kind in ('dialogue_turn','quest_event','hospitality','resident_evolution','memory_set'));

create or replace function private.world_npc_memory_source_envelope(p_source_kind text,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v jsonb; e private.world_quest_events; h private.world_npc_hospitality_events; x private.resident_evolution_entries; t private.world_npc_dialogue_turns;
begin
  if p_source_kind='dialogue_turn' then
    select * into t from private.world_npc_dialogue_turns where id=p_source_id and status='completed';
    if not found then raise sqlstate 'PT409' using message='Memory source is not completed'; end if;
    return jsonb_build_object('kind','dialogue_turn','id',t.id,'version',1,'saveId',t.save_id,'instanceId',t.instance_id,
      'occurredDay',t.day_number,'occurredSequence',t.input_sequence,'learnedDay',t.day_number,'learnedSequence',t.input_sequence,'conversationSequence',(select conversation_sequence from private.world_npc_instances where id=t.instance_id),
      'disclosureClass','npc_known','keeper',t.message,'npc',coalesce(t.result->>'reply',''));
  elsif p_source_kind='quest_event' then
    select * into e from private.world_quest_events where id=p_source_id;
    if not found then raise sqlstate 'PT409' using message='Memory source is unavailable'; end if;
    return jsonb_build_object('kind','quest_event','id',e.id,'version',1,'saveId',e.save_id,'instanceId',e.instance_id,
      'occurredDay',e.day_number,'learnedDay',e.day_number,'disclosureClass',case when e.public_news then 'player_visible' else 'npc_known' end,
      'questId',e.quest_id,'outcome',e.outcome,'action',e.action,'narration',e.narration,'conversationSequence',coalesce((select max(input_sequence) from private.world_npc_dialogue_turns turn_row where turn_row.instance_id=e.instance_id and turn_row.status='completed' and turn_row.completed_at<=e.created_at),0));
  elsif p_source_kind='hospitality' then
    select * into h from private.world_npc_hospitality_events where action_id=p_source_id;
    if not found then raise sqlstate 'PT409' using message='Memory source is unavailable'; end if;
    return jsonb_build_object('kind','hospitality','id',h.action_id,'version',1,'saveId',h.save_id,'instanceId',h.instance_id,
      'occurredDay',h.day_number,'learnedDay',h.day_number,
      'disclosureClass',case when coalesce((h.result->>'publicNews')::boolean,false) then 'player_visible' else 'npc_known' end,
      'actorId',h.actor_id,'itemKind',h.item_kind,'itemName',h.item_name,'qualityIndex',h.quality_index,'relationshipChange',h.relationship_change,'result',h.result,'conversationSequence',coalesce((select max(input_sequence) from private.world_npc_dialogue_turns turn_row where turn_row.instance_id=h.instance_id and turn_row.status='completed' and turn_row.completed_at<=h.created_at),0));
  elsif p_source_kind='resident_evolution' then
    select * into x from private.resident_evolution_entries where job_id=p_source_id;
    if not found then raise sqlstate 'PT409' using message='Memory source is unavailable'; end if;
    return jsonb_build_object('kind','resident_evolution','id',x.job_id,'version',1,'saveId',x.save_id,'instanceId',x.instance_id,
      'occurredDay',x.day_number,'learnedDay',x.day_number,'disclosureClass','npc_private','profileRevision',x.profile_revision,'disposition',x.disposition,'conversationSequence',coalesce((select max(input_sequence) from private.world_npc_dialogue_turns turn_row where turn_row.instance_id=x.instance_id and turn_row.status='completed' and turn_row.completed_at<=x.created_at),0));
  end if;
  raise sqlstate 'PT400' using message='Memory source kind is invalid';
end $function$;

-- Dialogue exchange hashing predates the ledger and is the exact source hash
-- persisted by completion. Other append-only source types hash their canonical
-- envelope. Both registration and completion use this one seam.
create or replace function private.world_npc_memory_source_hash(p_source_kind text,p_source_id uuid)
returns text language plpgsql stable security definer set search_path='' as $function$
declare turn_row private.world_npc_dialogue_turns;
begin
  if p_source_kind='dialogue_turn' then
    select * into turn_row from private.world_npc_dialogue_turns where id=p_source_id;
    if not found then raise sqlstate 'PT409' using message='Memory source is unavailable'; end if;
    return encode(extensions.digest(convert_to(turn_row.message || E'\n' || coalesce(turn_row.result->>'reply',''),'utf8'),'sha256'),'hex');
  end if;
  -- Conversation position is captured at registration for dialogue-cutoff
  -- semantics, but it is deliberately not source content.  A later exchange
  -- must not make an immutable quest/hospitality/evolution source look stale.
  return encode(extensions.digest(convert_to((private.world_npc_memory_source_envelope(p_source_kind,p_source_id)-'conversationSequence'-'ledgerSequence')::text,'utf8'),'sha256'),'hex');
end $function$;

create or replace function private.world_npc_memory_register_source(p_source_kind text,p_source_id uuid)
returns private.world_npc_memory_sources language plpgsql security definer set search_path='' as $function$
declare raw jsonb; scoped private.world_npc_memory_sources; seq bigint; digest text;
begin
  raw:=private.world_npc_memory_source_envelope(p_source_kind,p_source_id);
  digest:=private.world_npc_memory_source_hash(p_source_kind,p_source_id);
  select * into scoped from private.world_npc_memory_sources where source_kind=p_source_kind and source_id=p_source_id and source_version=1;
  if found then
    if scoped.save_id<>(raw->>'saveId')::uuid or scoped.instance_id<>(raw->>'instanceId')::uuid or scoped.source_hash<>digest then
      raise sqlstate 'PT409' using message='Memory source identity changed';
    end if;
    return scoped;
  end if;
  insert into private.world_npc_memory_source_cursors(instance_id) values((raw->>'instanceId')::uuid) on conflict do nothing;
  perform 1 from private.world_npc_memory_source_cursors where instance_id=(raw->>'instanceId')::uuid for update;
  -- A concurrent registrar may have won while this invocation waited.  Recheck
  -- under the cursor lock so duplicates never consume an unobserved sequence.
  select * into scoped from private.world_npc_memory_sources where source_kind=p_source_kind and source_id=p_source_id and source_version=1;
  if found then
    if scoped.save_id<>(raw->>'saveId')::uuid or scoped.instance_id<>(raw->>'instanceId')::uuid or scoped.source_hash<>digest then
      raise sqlstate 'PT409' using message='Memory source identity changed';
    end if;
    return scoped;
  end if;
  update private.world_npc_memory_source_cursors set next_ledger_sequence=next_ledger_sequence+1
    where instance_id=(raw->>'instanceId')::uuid returning next_ledger_sequence-1 into seq;
  raw:=raw || jsonb_build_object('ledgerSequence',seq);
  insert into private.world_npc_memory_sources(source_kind,source_id,source_version,save_id,instance_id,ledger_sequence,source_hash,disclosure_class,occurred_day,occurred_sequence,learned_day,learned_sequence,envelope)
  values(p_source_kind,p_source_id,1,(raw->>'saveId')::uuid,(raw->>'instanceId')::uuid,seq,digest,raw->>'disclosureClass',
    nullif(raw->>'occurredDay','')::integer,coalesce(nullif(raw->>'occurredSequence','')::bigint,nullif(raw->>'conversationSequence','')::bigint),nullif(raw->>'learnedDay','')::integer,coalesce(nullif(raw->>'learnedSequence','')::bigint,nullif(raw->>'conversationSequence','')::bigint),raw)
  returning * into scoped;
  return scoped;
end $function$;

create or replace function private.world_npc_memory_enqueue_source(p_source_kind text,p_source_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare source_row private.world_npc_memory_sources;
begin
  source_row:=private.world_npc_memory_register_source(p_source_kind,p_source_id);
  perform private.world_npc_memory_enqueue(source_row.save_id,source_row.instance_id,source_row.source_kind,source_row.source_id,source_row.source_version,source_row.ledger_sequence,source_row.source_hash);
end $function$;

-- The one ordinary path for both a live source trigger and the historical
-- migration backfill.  It does no provider work: authoritative source commit
-- remains available when extraction/indexing is unavailable.
create or replace function private.world_npc_memory_project_source(p_source_kind text,p_source_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare source_row private.world_npc_memory_sources; q private.world_quests; latest private.world_npc_memories;
begin
  source_row:=private.world_npc_memory_register_source(p_source_kind,p_source_id);
  -- Fulfillment/correction versions may legitimately cite this same terminal
  -- source.  They are not the canonical base evidence and must never suppress
  -- it on a trigger retry or historical backfill.
  if p_source_kind<>'dialogue_turn' and not exists(select 1 from private.world_npc_memories m where m.source_kind=source_row.source_kind and m.source_id=source_row.source_id and m.source_version=source_row.source_version and m.kind='source_evidence' and m.correction_memory_id is null) then
    if p_source_kind='quest_event' then select * into q from private.world_quests where id=(source_row.envelope->>'questId')::uuid and instance_id=source_row.instance_id and save_id=source_row.save_id; end if;
    insert into private.world_npc_memories(instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,participant_actor_id,observer_instance_id,related_quest_id)
    values(source_row.instance_id,'source_evidence',
      left(coalesce(nullif(case p_source_kind when 'quest_event' then source_row.envelope->>'narration' when 'hospitality' then format('%s: %s',source_row.envelope->>'itemName',source_row.envelope->'result') else (source_row.envelope->'disposition')::text end,''),'authoritative source evidence'),500),
      left(coalesce(nullif(case p_source_kind when 'quest_event' then source_row.envelope->>'narration' when 'hospitality' then source_row.envelope->>'itemName' else ('profile revision ' || (source_row.envelope->>'profileRevision')) end,''),'source evidence'),500),
      'system',2,coalesce(q.target_refs,'{}'),source_row.save_id,extensions.gen_random_uuid(),1,source_row.source_kind,source_row.source_id,1,source_row.source_hash,
      source_row.occurred_day,coalesce((source_row.envelope->>'conversationSequence')::bigint,0),source_row.learned_day,coalesce((source_row.envelope->>'conversationSequence')::bigint,0),'canonical',source_row.disclosure_class,
      case when p_source_kind='hospitality' then (source_row.envelope->>'actorId')::uuid else null end,source_row.instance_id,case when p_source_kind='quest_event' then q.id else null end);
  end if;
  if p_source_kind='quest_event' and source_row.envelope->>'outcome'='succeeded' then
    -- Lock every currently-live root before deriving its immutable fulfilled
    -- version.  Replays see the newer version and therefore cannot duplicate.
    for latest in select * from private.world_npc_memories m where m.instance_id=source_row.instance_id and m.save_id=source_row.save_id and m.related_quest_id=(source_row.envelope->>'questId')::uuid and m.commitment_status='unresolved'
      -- A historical terminal receipt can never rewrite a promise made after
      -- that receipt was already authoritative.
      and m.occurred_sequence<=coalesce((source_row.envelope->>'conversationSequence')::bigint,0)
      and not exists(select 1 from private.world_npc_memories newer where newer.record_root_id=m.record_root_id and newer.record_version>m.record_version)
      for update
    loop
    if not exists(select 1 from private.world_npc_memories m where m.correction_memory_id=latest.id and m.commitment_status='fulfilled') then
      insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,correction_memory_id,participant_actor_id,observer_instance_id,related_quest_id)
      values(null,latest.instance_id,'source_evidence',left(coalesce(nullif(source_row.envelope->>'narration',''),'authoritative quest succeeded'),500),left(coalesce(nullif(source_row.envelope->>'narration',''),'quest succeeded'),500),'system',latest.importance,latest.entity_refs,latest.save_id,latest.record_root_id,latest.record_version+1,source_row.source_kind,source_row.source_id,1,source_row.source_hash,source_row.occurred_day,coalesce((source_row.envelope->>'conversationSequence')::bigint,0),source_row.learned_day,coalesce((source_row.envelope->>'conversationSequence')::bigint,0),'canonical',source_row.disclosure_class,'fulfilled',latest.id,latest.participant_actor_id,latest.observer_instance_id,latest.related_quest_id);
    end if;
    end loop;
  end if;
  perform private.world_npc_memory_enqueue(source_row.save_id,source_row.instance_id,source_row.source_kind,source_row.source_id,1,source_row.ledger_sequence,source_row.source_hash);
end $function$;

create or replace function private.world_npc_memory_source_record() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  -- NEW has the concrete row type of its table; reference only fields that
  -- exist on this trigger's relation (a CASE expression is type-checked as a
  -- whole by PL/pgSQL and is therefore not safe here).
  if tg_argv[0] in ('dialogue_turn','quest_event') then
    perform private.world_npc_memory_project_source(tg_argv[0],new.id);
  elsif tg_argv[0]='hospitality' then
    perform private.world_npc_memory_project_source(tg_argv[0],new.action_id);
  elsif tg_argv[0]='resident_evolution' then
    perform private.world_npc_memory_project_source(tg_argv[0],new.job_id);
  else
    raise sqlstate 'PT400' using message='Memory source kind is invalid';
  end if;
  return new;
end $function$;

drop trigger if exists world_npc_memory_turn_outbox on private.world_npc_dialogue_turns;
create or replace function private.world_npc_memory_completed_turn() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    -- Dialogue remember rows are written by npc_dialogue_complete; this trigger
    -- only registers the immutable source and its extract work.
    perform private.world_npc_memory_project_source('dialogue_turn',new.id);
  end if;
  return new;
end $function$;
create trigger world_npc_memory_turn_outbox after update of status on private.world_npc_dialogue_turns for each row execute function private.world_npc_memory_completed_turn();
drop trigger if exists world_npc_memory_quest_source on private.world_quest_events;
drop trigger if exists world_npc_memory_hospitality_source on private.world_npc_hospitality_events;
drop trigger if exists world_npc_memory_evolution_source on private.resident_evolution_entries;
create trigger world_npc_memory_quest_source after insert on private.world_quest_events for each row execute function private.world_npc_memory_source_record('quest_event');
create trigger world_npc_memory_hospitality_source after insert on private.world_npc_hospitality_events for each row execute function private.world_npc_memory_source_record('hospitality');
create trigger world_npc_memory_evolution_source after insert on private.resident_evolution_entries for each row execute function private.world_npc_memory_source_record('resident_evolution');

-- Legacy chronology was never a shared stream.  This deterministic backfill is
-- only a stable migration order: occurred timestamp, kind rank, then source id.
do $backfill$
declare item record;
begin
  for item in
    select * from (
      select 'dialogue_turn'::text kind,id source_id,instance_id,completed_at occurred_at,0 rank from private.world_npc_dialogue_turns where status='completed'
      union all select 'quest_event',id,instance_id,created_at,1 from private.world_quest_events
      union all select 'hospitality',action_id,instance_id,created_at,2 from private.world_npc_hospitality_events
      union all select 'resident_evolution',job_id,instance_id,created_at,3 from private.resident_evolution_entries
    ) ordered order by instance_id,occurred_at nulls last,rank,source_id
  loop
    perform private.world_npc_memory_project_source(item.kind,item.source_id);
  end loop;
end $backfill$;

-- Existing jobs retain their attempt/fence history, but their stream coordinate
-- must be the registered ledger coordinate before generic completion can accept
-- them.  No completed work or artifact is deleted by this reconciliation.
update private.world_npc_memory_outbox job
set source_sequence=source_row.ledger_sequence,source_hash=source_row.source_hash
from private.world_npc_memory_sources source_row
where source_row.source_kind=job.source_kind and source_row.source_id=job.source_id and source_row.source_version=job.source_version
  and (job.source_sequence<>source_row.ledger_sequence or job.source_hash<>source_row.source_hash);
do $watermarks$
declare watermark record;
begin
  for watermark in select distinct instance_id,processor_kind,processor_version from private.world_npc_memory_outbox loop
    perform private.world_npc_memory_refresh_watermark(watermark.instance_id,watermark.processor_kind,watermark.processor_version);
  end loop;
end $watermarks$;

create or replace function private.world_npc_memory_complete(p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $function$
declare job private.world_npc_memory_outbox; source_row private.world_npc_memory_sources; artifact jsonb; live_hash text;
begin
  if exists(select 1 from private.world_npc_memory_invalidations i where i.job_id=p_job_id and i.fence=p_fence) then raise sqlstate 'PT409' using message='Memory work fence is stale'; end if;
  select * into job from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or job.fence<>p_fence or job.status<>'processing' or job.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Memory work fence is stale'; end if;
  select * into source_row from private.world_npc_memory_sources where source_kind=job.source_kind and source_id=job.source_id and source_version=job.source_version;
  -- Pre-ledger dialogue jobs are reconciled only from the authoritative
  -- completed source, never from caller-supplied sequence/hash fields.
  if not found and job.source_kind='dialogue_turn' then
    source_row:=private.world_npc_memory_register_source(job.source_kind,job.source_id);
    update private.world_npc_memory_outbox set source_sequence=source_row.ledger_sequence,source_hash=source_row.source_hash where id=job.id;
    select * into job from private.world_npc_memory_outbox where id=job.id;
  end if;
  if not found or source_row.save_id<>job.save_id or source_row.instance_id<>job.instance_id or source_row.source_hash<>job.source_hash or source_row.ledger_sequence<>job.source_sequence then raise sqlstate 'PT409' using message='Memory source changed or is unavailable'; end if;
  live_hash:=private.world_npc_memory_source_hash(job.source_kind,job.source_id);
  if live_hash<>source_row.source_hash then raise sqlstate 'PT409' using message='Memory source changed or is unavailable'; end if;
  if p_error_code is not null then update private.world_npc_memory_outbox set status='failed',examined_at=clock_timestamp(),error_code=left(p_error_code,120),lease_until=null where id=job.id; perform private.world_npc_memory_refresh_watermark(job.instance_id,job.processor_kind,job.processor_version); return; end if;
  if jsonb_typeof(coalesce(p_artifacts,'[]'::jsonb))<>'array' then raise sqlstate 'PT400' using message='Memory artifacts are invalid'; end if;
  for artifact in select value from jsonb_array_elements(coalesce(p_artifacts,'[]'::jsonb)) loop
    if artifact->>'artifactKind' not in ('episode_summary','quest_summary','embedding') or coalesce(artifact->>'sourceKind',job.source_kind)<>job.source_kind or coalesce(artifact->>'contentHash','') !~ '^[0-9a-f]{64}$' or coalesce(artifact->>'disclosureClass',source_row.disclosure_class)<>source_row.disclosure_class then raise sqlstate 'PT400' using message='Memory artifact does not match its source contract'; end if;
    insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,contract_hash,disclosure_class,content,content_hash,embedding,embedding_dimensions)
    values(job.save_id,job.instance_id,artifact->>'artifactKind',job.source_kind,array[job.source_id],array[job.source_version],job.source_hash,job.processor_version,artifact->>'model',artifact->>'contractHash',source_row.disclosure_class,coalesce(artifact->'content','{}'::jsonb),artifact->>'contentHash',nullif(artifact->>'embedding','')::extensions.vector,nullif(artifact->>'embeddingDimensions','')::integer) on conflict(instance_id,artifact_kind,source_hash,processor_version) do nothing;
  end loop;
  update private.world_npc_memory_outbox set status='completed',examined_at=clock_timestamp(),completed_at=clock_timestamp(),lease_until=null where id=job.id;
  perform private.world_npc_memory_refresh_watermark(job.instance_id,job.processor_kind,job.processor_version);
end $function$;

revoke all on table private.world_npc_memory_sources,private.world_npc_memory_source_cursors from public,anon,authenticated,service_role;
revoke all on function private.world_npc_memory_source_envelope(text,uuid),private.world_npc_memory_source_hash(text,uuid),private.world_npc_memory_register_source(text,uuid),private.world_npc_memory_enqueue_source(text,uuid),private.world_npc_memory_project_source(text,uuid),private.world_npc_memory_source_record(),private.world_npc_memory_completed_turn() from public,anon,authenticated,service_role;
commit;
