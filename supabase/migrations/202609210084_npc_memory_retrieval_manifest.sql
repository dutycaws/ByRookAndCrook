begin;
-- Return the actual canonical-source identity beside retrieval prose.  Callers
-- must never manufacture hashes or versions for a frozen context manifest.
create or replace function public.npc_memory_retrieve_for_actor(p_actor uuid,p_instance_id uuid,p_query text default '',p_limit integer default 12,p_cutoff_sequence bigint default null,p_view text default 'speech')
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb; manifest jsonb; missing_item_ids jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='Server memory retrieval requires service role'; end if;
  result:=private.world_npc_memory_retrieve(p_actor,p_instance_id,p_query,p_limit,p_cutoff_sequence,p_view);
  -- Selected records are identified by memory row ID.  Read their source
  -- identity directly from the authoritative memory ledger; source kinds are
  -- intentionally open to every kind accepted by that ledger.
  with selected_item_ids as (
    select distinct (item->>'id')::uuid as id
    from jsonb_array_elements(coalesce(result->'items','[]'::jsonb)) item
    where item ? 'id'
  ), selected_sources as (
    select memory.source_id as id,memory.source_version as version,memory.source_hash as hash,memory.source_kind as kind
    from selected_item_ids selected
    join private.world_npc_memories memory on memory.id=selected.id
  ), fallback_sources as (
    select turn.id,1::bigint as version,
      encode(extensions.digest(convert_to(turn.message || E'\n' || coalesce(turn.result->>'reply',''),'utf8'),'sha256'),'hex') as hash,
      'dialogue_turn'::text as kind
    from jsonb_array_elements(coalesce(result->'sourceFallback','[]'::jsonb)) fallback
    join private.world_npc_dialogue_turns turn on turn.id=(fallback->>'turnId')::uuid
    where turn.instance_id=p_instance_id and turn.status='completed'
  ), all_sources as (
    select id,version,hash,kind from selected_sources
    union
    select id,version,hash,kind from fallback_sources
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'hash',hash,'kind',kind) order by id,version,hash,kind),'[]'::jsonb)
  into manifest from all_sources;

  select coalesce(jsonb_agg(missing.id order by missing.id),'[]'::jsonb)
  into missing_item_ids
  from (
    select selected.id
    from (
      select distinct (item->>'id')::uuid as id
      from jsonb_array_elements(coalesce(result->'items','[]'::jsonb)) item
      where item ? 'id'
    ) selected
    left join private.world_npc_memories memory on memory.id=selected.id
    where memory.id is null
       or memory.source_id is null
       or memory.source_version is null
       or memory.source_hash is null
       or memory.source_kind is null
    union
    select fallback.id
    from (
      select distinct (item->>'turnId')::uuid as id
      from jsonb_array_elements(coalesce(result->'sourceFallback','[]'::jsonb)) item
      where item ? 'turnId'
    ) fallback
    left join private.world_npc_dialogue_turns turn on turn.id=fallback.id and turn.instance_id=p_instance_id and turn.status='completed'
    where turn.id is null
  ) missing;

  return result || jsonb_build_object(
    'sourceManifest',manifest,
    'sourceManifestCoverage',jsonb_build_object('missingItemIds',missing_item_ids,'complete',jsonb_array_length(missing_item_ids)=0)
  );
end $function$;
commit;
