-- Issue #33 checkpoint 3: retrieval is a security boundary, not a convenience
-- projection.  This supersedes the earlier broad public view without rewriting it.
begin;

-- `world_npc_memory_search` is the existing GIN index on the generated ledger
-- vector; retain it rather than adding a duplicate index under a new name.

create or replace function private.world_npc_memory_retrieve(
  p_actor uuid,p_instance_id uuid,p_query text,p_limit integer default 12,
  p_cutoff_sequence bigint default null,p_view text default 'speech'
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,12),32)); v_cutoff bigint;
  v_query text:=left(regexp_replace(trim(coalesce(p_query,'')),'\s+',' ','g'),400);
  v_disclosures text[];
begin
  if p_view is null or p_view not in ('speech','review','transition') then raise sqlstate 'PT400' using message='Memory view is invalid'; end if;
  if not exists(select 1 from private.world_npc_instances i join public.tavern_saves s on s.id=i.save_id where i.id=p_instance_id and i.save_id=s.id and s.user_id=p_actor) then raise sqlstate 'PT404' using message='Resident memory was not found'; end if;
  select coalesce(p_cutoff_sequence,max(input_sequence),-1) into v_cutoff from private.world_npc_dialogue_turns where instance_id=p_instance_id and status='completed';
  if v_cutoff<0 then v_cutoff:=-1; end if;
  v_disclosures:=case when p_view='speech' then array['player_visible','npc_known'] else array['player_visible','npc_known','npc_private'] end;
  return (
    with q as (select case when v_query='' then null else websearch_to_tsquery('english',v_query) end query),
    eligible as (
      select m.*, q.query, case when q.query is null then false else m.search @@ q.query end lexical,
        case when q.query is null then 0::real else ts_rank(m.search,q.query) end lexical_rank
      from private.world_npc_memories m cross join q
      where m.instance_id=p_instance_id and m.occurred_sequence<=v_cutoff and m.disclosure_class=any(v_disclosures)
        and not exists(select 1 from private.world_npc_memories newer where newer.instance_id=m.instance_id and newer.record_root_id=m.record_root_id and newer.record_version>m.record_version and newer.occurred_sequence<=v_cutoff)
    ),
    obligations as (select distinct on (record_root_id) * from eligible where commitment_status='unresolved' order by record_root_id,record_version desc,id),
    quests as (select * from eligible where v_query<>'' and ((related_quest_id is not null and related_quest_id::text=v_query) or exists(select 1 from unnest(entity_refs) ref where lower(ref)=lower(v_query)))),
    lexical as (select * from eligible where lexical),
    primary_rows as (
      select *,1 tier,'unresolved_commitment' reason from obligations
      union all select e.*,2,'exact_reference' from quests e where not exists(select 1 from obligations o where o.id=e.id)
      union all select e.*,3,'lexical' from lexical e where not exists(select 1 from obligations o where o.id=e.id) and not exists(select 1 from quests x where x.id=e.id)
    ),
    fallback as (
      select e.*,4,'important_recent' reason from eligible e
      where not exists(select 1 from lexical) and not exists(select 1 from primary_rows p where p.id=e.id)
    ), ranked as (
      select * from primary_rows union all select * from fallback
    ), selected as (
      select * from ranked order by tier,lexical_rank desc,importance desc,occurred_sequence desc,id limit v_limit
    ), turns as (
      select t.id,1::bigint version,encode(extensions.digest(convert_to(t.message||E'\n'||coalesce(t.result->>'reply',''),'utf8'),'sha256'),'hex') hash,'dialogue_turn'::text kind,t.input_sequence,t.day_number,t.message,t.result->>'reply' reply
      from private.world_npc_dialogue_turns t where t.instance_id=p_instance_id and t.status='completed' and t.input_sequence<=v_cutoff order by t.input_sequence desc limit 6
    ), manifest as (
      select distinct source_id id,source_version version,source_hash hash,source_kind kind from selected
      union select id,version,hash,kind from turns
    )
    select jsonb_build_object(
      'retrievalVersion','npc-memory-retrieval-v3','cutoffSequence',v_cutoff,
      'selectionReason',coalesce((select reason from selected order by tier,lexical_rank desc,importance desc,occurred_sequence desc,id limit 1),'empty'),
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'record_root_id',record_root_id,'record_version',record_version,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'truth_class',truth_class,'commitment_status',commitment_status,'importance',importance,'related_quest_id',related_quest_id,'source_kind',source_kind,'source_id',source_id,'source_version',source_version,'occurred_sequence',occurred_sequence,'selection_reason',reason,'rank',lexical_rank) order by tier,lexical_rank desc,importance desc,occurred_sequence desc,id) from selected),'[]'::jsonb),
      'sourceFallback',coalesce((select jsonb_agg(jsonb_build_object('turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,'npc',reply) order by input_sequence) from turns),'[]'::jsonb),
      'sourceManifest',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'hash',hash,'kind',kind) order by id,version,hash,kind) from manifest),'[]'::jsonb),
      'sourceManifestCoverage',jsonb_build_object('complete',true,'missingItemIds','[]'::jsonb)
    )
  );
end $f$;

create or replace function public.npc_memory_retrieve(p_instance_id uuid,p_query text default '',p_limit integer default 12,p_cutoff_sequence bigint default null,p_view text default 'speech')
returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
  -- Reject elevation before candidate selection or ownership probing.
  if p_view is distinct from 'speech' then raise sqlstate '42501' using message='Authenticated retrieval is speech-only'; end if;
  return private.world_npc_memory_retrieve(auth.uid(),p_instance_id,p_query,p_limit,p_cutoff_sequence,'speech');
end $f$;

create or replace function public.npc_memory_retrieve_for_actor(p_actor uuid,p_instance_id uuid,p_query text default '',p_limit integer default 12,p_cutoff_sequence bigint default null,p_view text default 'speech')
returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='Server memory retrieval requires service role'; end if;
  if p_actor is null or p_instance_id is null or p_view is null or p_view not in ('speech','review','transition') then raise sqlstate 'PT400' using message='Server retrieval arguments are invalid'; end if;
  return private.world_npc_memory_retrieve(p_actor,p_instance_id,p_query,p_limit,p_cutoff_sequence,p_view);
end $f$;

revoke all on function public.npc_memory_retrieve(uuid,text,integer,bigint,text),public.npc_memory_retrieve_for_actor(uuid,uuid,text,integer,bigint,text) from public,anon;
grant execute on function public.npc_memory_retrieve(uuid,text,integer,bigint,text) to authenticated;
grant execute on function public.npc_memory_retrieve_for_actor(uuid,uuid,text,integer,bigint,text) to service_role;
revoke all on function private.world_npc_memory_retrieve(uuid,uuid,text,integer,bigint,text) from public,anon,authenticated,service_role;
commit;
