-- Issue #33 checkpoint 3: profile-bound, exact semantic retrieval.
-- Embeddings are optional derived evidence.  This migration intentionally does
-- not select an ANN index: profiles have independently chosen dimensions.
begin;

create table private.world_npc_memory_embedding_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  processor_version text not null check(char_length(processor_version) between 1 and 120),
  model text not null check(char_length(btrim(model)) between 1 and 120),
  dimensions integer not null check(dimensions between 1 and 4096),
  active boolean not null default false,
  invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(processor_version)
);
create unique index world_npc_memory_embedding_one_active
  on private.world_npc_memory_embedding_profiles ((true))
  where active and invalidated_at is null;
alter table private.world_npc_memory_artifacts
  add column embedding_profile_id uuid references private.world_npc_memory_embedding_profiles(id) on delete restrict;
create index world_npc_memory_embedding_exact_scope
  on private.world_npc_memory_artifacts(instance_id,embedding_profile_id)
  where artifact_kind='embedding' and invalidated_at is null;
alter table private.world_npc_memory_artifacts
  add constraint world_npc_memory_artifact_hashes_hex
  check(source_hash ~ '^[0-9a-f]{64}$' and content_hash ~ '^[0-9a-f]{64}$') not valid;

create or replace function private.world_npc_memory_embedding_profile_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if tg_op='DELETE' then raise sqlstate 'PT409' using message='Embedding profiles are immutable'; end if;
  if old.processor_version is distinct from new.processor_version
     or old.model is distinct from new.model
     or old.dimensions is distinct from new.dimensions
     or old.created_at is distinct from new.created_at
     or old.invalidated_at is distinct from new.invalidated_at then
    raise sqlstate 'PT409' using message='Embedding profile identity is immutable';
  end if;
  if old.active is distinct from new.active
     and current_setting('private.embedding_profile_activation',true) is distinct from 'on' then
    raise sqlstate 'PT403' using message='Embedding profile activation is service-only';
  end if;
  return new;
end $f$;
create trigger world_npc_memory_embedding_profile_guard
  before update or delete on private.world_npc_memory_embedding_profiles
  for each row execute function private.world_npc_memory_embedding_profile_guard();

create or replace function public.world_npc_memory_embedding_profile_activate(p_profile_id uuid)
returns void language plpgsql security definer set search_path='' as $f$
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='Embedding profile activation requires service role'; end if;
  if p_profile_id is null or not exists(select 1 from private.world_npc_memory_embedding_profiles where id=p_profile_id and invalidated_at is null) then
    raise sqlstate 'PT400' using message='Embedding profile is unavailable';
  end if;
  perform set_config('private.embedding_profile_activation','on',true);
  -- The partial unique index is non-deferrable.  Deactivate first so a profile
  -- swap cannot depend on PostgreSQL's physical update order.
  update private.world_npc_memory_embedding_profiles set active=false where active;
  update private.world_npc_memory_embedding_profiles set active=true where id=p_profile_id;
end $f$;

create or replace function private.world_npc_memory_embedding_artifact_validate()
returns trigger language plpgsql security definer set search_path='' as $f$
declare p private.world_npc_memory_embedding_profiles; s private.world_npc_memory_sources;
begin
  if new.artifact_kind<>'embedding' then
    if new.embedding_profile_id is not null then raise sqlstate 'PT400' using message='Only embedding artifacts may reference an embedding profile'; end if;
    return new;
  end if;
  if new.embedding_profile_id is null then
    raise sqlstate 'PT400' using message='Embedding artifact must reference a profile';
  end if;
  if new.embedding is null
     or cardinality(new.source_ids)<>1 or cardinality(new.source_versions)<>1
     or new.source_hash !~ '^[0-9a-f]{64}$' or new.content_hash !~ '^[0-9a-f]{64}$'
     or new.model is null or char_length(btrim(new.model))=0
     or new.embedding_dimensions is null or extensions.vector_dims(new.embedding)<>new.embedding_dimensions
     or extensions.vector_norm(new.embedding)<=0
     or new.content_hash<>encode(extensions.digest(private.world_canonical_json(new.content),'sha256'),'hex') then
    raise sqlstate 'PT400' using message='Embedding artifact identity is invalid';
  end if;
  select * into p from private.world_npc_memory_embedding_profiles where id=new.embedding_profile_id;
  if not found or p.invalidated_at is not null or new.processor_version<>p.processor_version
     or new.model<>p.model or new.embedding_dimensions<>p.dimensions then
    raise sqlstate 'PT400' using message='Embedding artifact does not match its immutable profile';
  end if;
  select * into s from private.world_npc_memory_sources
   where source_kind=new.source_kind and source_id=new.source_ids[1] and source_version=new.source_versions[1];
  if not found or s.save_id<>new.save_id or s.instance_id<>new.instance_id
     or s.source_hash<>new.source_hash or s.disclosure_class<>new.disclosure_class then
    raise sqlstate 'PT409' using message='Embedding artifact source is stale or out of scope';
  end if;
  return new;
end $f$;
create trigger world_npc_memory_embedding_artifact_validate
  before insert on private.world_npc_memory_artifacts
  for each row execute function private.world_npc_memory_embedding_artifact_validate();

create or replace function private.world_npc_memory_semantic_search(
  p_actor uuid,p_instance_id uuid,p_profile_id uuid,p_processor_version text,p_model text,
  p_dimensions integer,p_query_embedding extensions.vector,p_limit integer default 12,
  p_cutoff_sequence bigint default null,p_view text default 'speech'
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_profile private.world_npc_memory_embedding_profiles; v_limit integer:=greatest(1,least(coalesce(p_limit,12),32));
  v_cutoff bigint; v_disclosures text[];
begin
  if p_view is null or p_view not in ('speech','review','transition') then raise sqlstate 'PT400' using message='Memory view is invalid'; end if;
  if p_actor is null or p_instance_id is null then raise sqlstate 'PT400' using message='Semantic retrieval scope is invalid'; end if;
  if not exists(select 1 from private.world_npc_instances i join public.tavern_saves s on s.id=i.save_id where i.id=p_instance_id and s.user_id=p_actor) then raise sqlstate 'PT404' using message='Resident memory was not found'; end if;
  if p_profile_id is null then return jsonb_build_object('retrievalVersion','npc-memory-semantic-v3','semanticAvailable',false,'availability','no_active_profile','profile',null,'items','[]'::jsonb); end if;
  select * into v_profile from private.world_npc_memory_embedding_profiles where id=p_profile_id and active and invalidated_at is null;
  if not found then raise sqlstate 'PT400' using message='Embedding profile is not active'; end if;
  if p_processor_version is distinct from v_profile.processor_version or p_model is distinct from v_profile.model or p_dimensions is distinct from v_profile.dimensions then
    raise sqlstate 'PT400' using message='Embedding profile identity does not match';
  end if;
  if p_query_embedding is null or extensions.vector_dims(p_query_embedding)<>v_profile.dimensions or extensions.vector_norm(p_query_embedding)<=0 then raise sqlstate 'PT400' using message='Query embedding does not match profile'; end if;
  select coalesce(least(coalesce(p_cutoff_sequence,9223372036854775807),coalesce(max(input_sequence),-1)),-1) into v_cutoff
    from private.world_npc_dialogue_turns where instance_id=p_instance_id and status='completed';
  v_disclosures:=case when p_view='speech' then array['player_visible','npc_known'] else array['player_visible','npc_known','npc_private'] end;
  return (
    with candidates as (
      select a.id artifact_id,a.source_ids[1] source_id,a.source_versions[1] source_version,a.source_hash,a.source_kind,
        s.ledger_sequence,s.occurred_sequence,s.disclosure_class,(a.embedding OPERATOR(extensions.<=>) p_query_embedding) distance
      from private.world_npc_memory_artifacts a
      join private.world_npc_memory_sources s on s.source_kind=a.source_kind and s.source_id=a.source_ids[1]
        and s.source_version=a.source_versions[1] and s.source_hash=a.source_hash
      where a.instance_id=p_instance_id and a.save_id=(select save_id from private.world_npc_instances where id=p_instance_id)
        and a.artifact_kind='embedding' and a.embedding_profile_id=v_profile.id and a.processor_version=v_profile.processor_version
        and a.model=v_profile.model and a.embedding_dimensions=v_profile.dimensions and a.invalidated_at is null
        and s.instance_id=p_instance_id and s.save_id=a.save_id and s.disclosure_class=any(v_disclosures)
        and coalesce(s.occurred_sequence,s.ledger_sequence)<=v_cutoff
    ), selected as (select * from candidates order by distance,artifact_id limit v_limit)
    select jsonb_build_object('retrievalVersion','npc-memory-semantic-v3','semanticAvailable',true,'availability',
      case when exists(select 1 from selected) then 'ready' else 'no_candidates' end,
      'profile',jsonb_build_object('id',v_profile.id,'processorVersion',v_profile.processor_version,'model',v_profile.model,'dimensions',v_profile.dimensions),
      'cutoffSequence',v_cutoff,
      'items',coalesce((select jsonb_agg(jsonb_build_object('artifactId',artifact_id,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'sourceKind',source_kind,'ledgerSequence',ledger_sequence,'score',1-distance,'selectionReason','semantic_exact') order by distance,artifact_id) from selected),'[]'::jsonb),
      'sourceManifest',coalesce((select jsonb_agg(jsonb_build_object('id',source_id,'version',source_version,'hash',source_hash,'kind',source_kind) order by source_id,source_version,source_hash,source_kind) from selected),'[]'::jsonb)
    )
  );
end $f$;

create or replace function public.npc_memory_semantic_retrieve_for_actor(
  p_actor uuid,p_instance_id uuid,p_profile_id uuid,p_processor_version text,p_model text,
  p_dimensions integer,p_query_embedding extensions.vector,p_limit integer default 12,
  p_cutoff_sequence bigint default null,p_view text default 'speech'
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='Server semantic retrieval requires service role'; end if;
  if p_actor is null or p_instance_id is null or p_view is null or p_view not in ('speech','review','transition') then raise sqlstate 'PT400' using message='Server semantic retrieval arguments are invalid'; end if;
  return private.world_npc_memory_semantic_search(p_actor,p_instance_id,p_profile_id,p_processor_version,p_model,p_dimensions,p_query_embedding,p_limit,p_cutoff_sequence,p_view);
end $f$;

revoke all on table private.world_npc_memory_embedding_profiles from public,anon,authenticated,service_role;
revoke all on function private.world_npc_memory_embedding_profile_guard(),private.world_npc_memory_embedding_artifact_validate(),private.world_npc_memory_semantic_search(uuid,uuid,uuid,text,text,integer,extensions.vector,integer,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.world_npc_memory_embedding_profile_activate(uuid),public.npc_memory_semantic_retrieve_for_actor(uuid,uuid,uuid,text,text,integer,extensions.vector,integer,bigint,text) from public,anon;
grant execute on function public.world_npc_memory_embedding_profile_activate(uuid),public.npc_memory_semantic_retrieve_for_actor(uuid,uuid,uuid,text,text,integer,extensions.vector,integer,bigint,text) to service_role;

commit;
