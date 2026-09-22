-- Issue #33: source-backed NPC memory is derived evidence.  Gameplay records
-- remain authoritative when this queue, an index, or a provider is unavailable.
begin;

create extension if not exists vector with schema extensions;

alter table private.world_npc_memories
  add column save_id uuid references public.tavern_saves(id) on delete cascade,
  add column record_root_id uuid,
  add column record_version integer not null default 1 check(record_version > 0),
  add column source_kind text not null default 'dialogue_turn' check(source_kind in ('dialogue_turn','quest_event','hospitality','manual')),
  add column source_id uuid,
  add column source_version bigint not null default 1 check(source_version > 0),
  add column source_hash text,
  add column occurred_day integer check(occurred_day > 0),
  add column occurred_sequence bigint check(occurred_sequence >= 0),
  add column learned_at timestamptz not null default clock_timestamp(),
  add column truth_class text not null default 'attributed' check(truth_class in ('canonical','attributed','belief','derived')),
  add column disclosure_class text not null default 'npc_known' check(disclosure_class in ('player_visible','npc_known','npc_private','system')),
  add column commitment_status text check(commitment_status is null or commitment_status in ('unresolved','fulfilled','withdrawn','disputed','superseded')),
  add column correction_memory_id uuid,
  add column related_quest_id uuid references private.world_quests(id) on delete set null;

update private.world_npc_memories memory
set save_id = turn.save_id,
    record_root_id = memory.id,
    source_id = turn.id,
    source_hash = encode(extensions.digest(convert_to(turn.message || E'\n' || coalesce(turn.result->>'reply',''), 'utf8'),'sha256'),'hex'),
    occurred_day = turn.day_number,
    occurred_sequence = turn.input_sequence
from private.world_npc_dialogue_turns turn
where turn.id = memory.turn_id;

alter table private.world_npc_memories
  alter column save_id set not null,
  alter column record_root_id set not null,
  alter column source_id set not null,
  alter column source_hash set not null,
  alter column occurred_day set not null,
  add constraint world_npc_memory_root_version_unique unique(record_root_id, record_version),
  add constraint world_npc_memory_correction_fk foreign key(correction_memory_id) references private.world_npc_memories(id) on delete restrict;

-- Immutable accepted artifacts cover summaries and embeddings.  The source-set
-- key prevents replay from accepting a fresh approximation for the same input.
create table private.world_npc_memory_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  artifact_kind text not null check(artifact_kind in ('episode_summary','quest_summary','embedding')),
  source_kind text not null check(source_kind in ('dialogue_turn','quest_event','memory_set')),
  source_ids uuid[] not null check(cardinality(source_ids) between 1 and 128),
  source_versions bigint[] not null check(cardinality(source_versions) = cardinality(source_ids)),
  source_hash text not null check(char_length(source_hash) = 64),
  processor_version text not null check(char_length(processor_version) between 1 and 120),
  prompt_revision_id uuid references private.prompt_revisions(id) on delete restrict,
  model text, contract_hash text,
  disclosure_class text not null default 'npc_known' check(disclosure_class in ('player_visible','npc_known','npc_private','system')),
  content jsonb not null,
  content_hash text not null check(char_length(content_hash) = 64),
  embedding extensions.vector,
  embedding_dimensions integer check(embedding_dimensions is null or embedding_dimensions between 1 and 4096),
  accepted_at timestamptz not null default clock_timestamp(),
  invalidated_at timestamptz,
  unique(instance_id, artifact_kind, source_hash, processor_version)
);
create index world_npc_memory_artifact_scope on private.world_npc_memory_artifacts(instance_id, artifact_kind, accepted_at desc) where invalidated_at is null;
create index world_npc_memory_artifact_sources on private.world_npc_memory_artifacts using gin(source_ids);

create table private.world_npc_memory_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  source_kind text not null check(source_kind in ('dialogue_turn','quest_event')),
  source_id uuid not null,
  source_version bigint not null check(source_version > 0),
  source_sequence bigint not null check(source_sequence >= 0),
  source_hash text not null check(char_length(source_hash) = 64),
  processor_kind text not null check(processor_kind in ('extract','summary','embedding')),
  processor_version text not null check(char_length(processor_version) between 1 and 120),
  status text not null default 'pending' check(status in ('pending','processing','completed','failed','invalidated')),
  fence uuid not null default extensions.gen_random_uuid(),
  lease_until timestamptz,
  attempts integer not null default 0 check(attempts >= 0),
  examined_at timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(source_kind, source_id, source_version, processor_kind, processor_version)
);
create index world_npc_memory_outbox_claim on private.world_npc_memory_outbox(status, created_at) where status in ('pending','processing');
create index world_npc_memory_outbox_stream on private.world_npc_memory_outbox(instance_id, processor_kind, processor_version, source_sequence);

create table private.world_npc_memory_watermarks (
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  processor_kind text not null check(processor_kind in ('extract','summary','embedding')),
  processor_version text not null,
  contiguous_sequence bigint not null default -1,
  examined_through_sequence bigint not null default -1,
  gap_sequence bigint,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(instance_id, processor_kind, processor_version)
);

create index world_npc_memory_scope_sequence on private.world_npc_memories(instance_id, occurred_sequence desc, id);
create index world_npc_memory_commitments on private.world_npc_memories(instance_id, commitment_status, occurred_sequence desc) where commitment_status = 'unresolved';
create index world_npc_memory_quest on private.world_npc_memories(related_quest_id, instance_id) where related_quest_id is not null;
create index world_npc_memory_source on private.world_npc_memories(source_kind, source_id, source_version);

create function private.world_npc_memory_enqueue(
  p_save_id uuid, p_instance_id uuid, p_source_kind text, p_source_id uuid,
  p_source_version bigint, p_source_sequence bigint, p_source_hash text,
  p_processor_kind text default 'extract', p_processor_version text default 'npc-memory-v1'
) returns void language sql security definer set search_path='' as $function$
  insert into private.world_npc_memory_outbox(save_id,instance_id,source_kind,source_id,source_version,source_sequence,source_hash,processor_kind,processor_version)
  values(p_save_id,p_instance_id,p_source_kind,p_source_id,p_source_version,p_source_sequence,p_source_hash,p_processor_kind,p_processor_version)
  on conflict(source_kind,source_id,source_version,processor_kind,processor_version) do nothing
$function$;

create function private.world_npc_memory_turn_enqueued() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform private.world_npc_memory_enqueue(new.save_id,new.instance_id,'dialogue_turn',new.id,1,new.input_sequence,
      encode(extensions.digest(convert_to(new.message || E'\n' || coalesce(new.result->>'reply',''), 'utf8'),'sha256'),'hex'));
  end if;
  return new;
end $function$;
create trigger world_npc_memory_turn_outbox after update of status on private.world_npc_dialogue_turns
  for each row execute function private.world_npc_memory_turn_enqueued();

insert into private.world_npc_memory_outbox(save_id,instance_id,source_kind,source_id,source_version,source_sequence,source_hash,processor_kind,processor_version,status)
select turn.save_id,turn.instance_id,'dialogue_turn',turn.id,1,turn.input_sequence,
  encode(extensions.digest(convert_to(turn.message || E'\n' || coalesce(turn.result->>'reply',''), 'utf8'),'sha256'),'hex'),
  'extract','npc-memory-v1','pending'
from private.world_npc_dialogue_turns turn where turn.status='completed'
on conflict(source_kind,source_id,source_version,processor_kind,processor_version) do nothing;

create function private.world_npc_memory_refresh_watermark(p_instance_id uuid,p_processor_kind text,p_processor_version text)
returns void language plpgsql security definer set search_path='' as $function$
declare v_examined bigint; v_gap bigint;
begin
  select max(source_sequence) filter(where status in ('completed','failed','invalidated')),
         min(source_sequence) filter(where status not in ('completed','failed','invalidated'))
    into v_examined,v_gap
  from private.world_npc_memory_outbox
  where instance_id=p_instance_id and processor_kind=p_processor_kind and processor_version=p_processor_version;
  insert into private.world_npc_memory_watermarks(instance_id,processor_kind,processor_version,contiguous_sequence,examined_through_sequence,gap_sequence)
  values(p_instance_id,p_processor_kind,p_processor_version,coalesce(v_gap-1,v_examined,-1),coalesce(v_examined,-1),v_gap)
  on conflict(instance_id,processor_kind,processor_version) do update
    set contiguous_sequence=excluded.contiguous_sequence,examined_through_sequence=excluded.examined_through_sequence,gap_sequence=excluded.gap_sequence,updated_at=clock_timestamp();
end $function$;

create function private.world_npc_memory_claim(p_processor_kind text,p_processor_version text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare job private.world_npc_memory_outbox;
begin
  select * into job from private.world_npc_memory_outbox
  where processor_kind=p_processor_kind and processor_version=p_processor_version
    and (status='pending' or (status='processing' and lease_until < clock_timestamp()))
  order by source_sequence,created_at for update skip locked limit 1;
  if not found then return null; end if;
  update private.world_npc_memory_outbox set status='processing',fence=extensions.gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,error_code=null where id=job.id returning * into job;
  return jsonb_build_object('id',job.id,'fence',job.fence,'saveId',job.save_id,'instanceId',job.instance_id,'sourceKind',job.source_kind,'sourceId',job.source_id,'sourceVersion',job.source_version,'sourceHash',job.source_hash);
end $function$;

create function private.world_npc_memory_complete(p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $function$
declare job private.world_npc_memory_outbox; artifact jsonb;
begin
  select * into job from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or job.fence<>p_fence or job.status<>'processing' then raise sqlstate 'PT409' using message='Memory work fence is stale'; end if;
  if p_error_code is null then
    for artifact in select value from jsonb_array_elements(coalesce(p_artifacts,'[]'::jsonb)) loop
      insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,model,contract_hash,disclosure_class,content,content_hash,embedding,embedding_dimensions)
      values(job.save_id,job.instance_id,artifact->>'artifactKind',coalesce(artifact->>'sourceKind',job.source_kind),array[job.source_id],array[job.source_version],job.source_hash,job.processor_version,artifact->>'model',artifact->>'contractHash',coalesce(artifact->>'disclosureClass','npc_known'),coalesce(artifact->'content','{}'::jsonb),artifact->>'contentHash',nullif(artifact->>'embedding','')::extensions.vector,nullif(artifact->>'embeddingDimensions','')::integer)
      on conflict(instance_id,artifact_kind,source_hash,processor_version) do nothing;
    end loop;
    update private.world_npc_memory_outbox set status='completed',examined_at=clock_timestamp(),completed_at=clock_timestamp(),lease_until=null where id=job.id;
  else
    update private.world_npc_memory_outbox set status='failed',examined_at=clock_timestamp(),error_code=left(p_error_code,120),lease_until=null where id=job.id;
  end if;
  perform private.world_npc_memory_refresh_watermark(job.instance_id,job.processor_kind,job.processor_version);
end $function$;

-- A deliberately bounded hybrid retrieval: hard relational obligations first,
-- lexical matches next, then recent canonical dialogue when derived work lags.
create function private.world_npc_memory_retrieve(p_actor uuid,p_instance_id uuid,p_query text,p_limit integer default 12,p_cutoff_sequence bigint default null,p_view text default 'speech')
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,12),32)); v_cutoff bigint; v_disclosures text[];
begin
  if p_view not in ('speech','review','transition') then raise sqlstate 'PT400' using message='Memory view is invalid'; end if;
  if not exists(select 1 from private.world_npc_instances instance_row join public.tavern_saves save_row on save_row.id=instance_row.save_id where instance_row.id=p_instance_id and save_row.user_id=p_actor) then raise sqlstate 'PT404' using message='Resident memory was not found'; end if;
  select coalesce(p_cutoff_sequence,max(input_sequence)) into v_cutoff from private.world_npc_dialogue_turns where instance_id=p_instance_id and status='completed';
  v_disclosures:=case when p_view='speech' then array['player_visible','npc_known'] else array['player_visible','npc_known','npc_private'] end;
  return (
    with selected as (
      select memory.id,memory.record_root_id,memory.record_version,memory.kind,memory.text,memory.quote,memory.speaker,memory.truth_class,memory.commitment_status,memory.importance,memory.related_quest_id,memory.source_kind,memory.source_id,memory.source_version,memory.occurred_day,memory.occurred_sequence,
        case when memory.commitment_status='unresolved' then 'unresolved_commitment'
             when memory.related_quest_id is not null then 'quest_link'
             when btrim(coalesce(p_query,''))<>'' and memory.search @@ websearch_to_tsquery('english',left(p_query,400)) then 'lexical'
             else 'important_recent' end as selection_reason,
        case when btrim(coalesce(p_query,''))='' then 0 else ts_rank(memory.search,websearch_to_tsquery('english',left(p_query,400))) end rank
      from private.world_npc_memories memory
      where memory.instance_id=p_instance_id and memory.occurred_sequence<=coalesce(v_cutoff,9223372036854775807)
        and memory.disclosure_class=any(v_disclosures)
      order by (memory.commitment_status='unresolved') desc,(memory.related_quest_id is not null) desc,
        (memory.search @@ websearch_to_tsquery('english',left(coalesce(p_query,''),400))) desc,rank desc,memory.importance desc,memory.occurred_sequence desc,memory.id
      limit v_limit
    ), turns as (
      select turn.id,turn.input_sequence,turn.day_number,turn.message,turn.result->>'reply' reply
      from private.world_npc_dialogue_turns turn where turn.instance_id=p_instance_id and turn.status='completed' and turn.input_sequence<=coalesce(v_cutoff,9223372036854775807)
      order by turn.input_sequence desc limit 6
    ), watermark as (
      select jsonb_agg(jsonb_build_object('processor',processor_kind,'version',processor_version,'contiguousSequence',contiguous_sequence,'examinedThroughSequence',examined_through_sequence,'gapSequence',gap_sequence) order by processor_kind,processor_version) item from private.world_npc_memory_watermarks where instance_id=p_instance_id
    ) select jsonb_build_object('cutoffSequence',v_cutoff,'items',coalesce((select jsonb_agg(to_jsonb(selected) order by occurred_sequence desc,id) from selected),'[]'::jsonb),'sourceFallback',coalesce((select jsonb_agg(jsonb_build_object('turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,'npc',reply) order by input_sequence) from turns),'[]'::jsonb),'watermarks',coalesce((select item from watermark),'[]'::jsonb))
  );
end $function$;

create function public.npc_memory_retrieve(p_instance_id uuid,p_query text default '',p_limit integer default 12,p_cutoff_sequence bigint default null,p_view text default 'speech')
returns jsonb language sql stable security definer set search_path='' as $function$
  select private.world_npc_memory_retrieve(auth.uid(),p_instance_id,p_query,p_limit,p_cutoff_sequence,p_view)
$function$;

revoke all on table private.world_npc_memory_artifacts,private.world_npc_memory_outbox,private.world_npc_memory_watermarks from public,anon,authenticated;
revoke all on function private.world_npc_memory_enqueue(uuid,uuid,text,uuid,bigint,bigint,text,text,text),private.world_npc_memory_turn_enqueued(),private.world_npc_memory_refresh_watermark(uuid,text,text),private.world_npc_memory_claim(text,text),private.world_npc_memory_complete(uuid,uuid,jsonb,text),private.world_npc_memory_retrieve(uuid,uuid,text,integer,bigint,text) from public,anon,authenticated;
revoke all on function public.npc_memory_retrieve(uuid,text,integer,bigint,text) from public,anon;
grant execute on function public.npc_memory_retrieve(uuid,text,integer,bigint,text) to authenticated;

commit;
