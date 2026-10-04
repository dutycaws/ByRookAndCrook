-- Issue #33 checkpoint 4: one server-only, source-backed evidence boundary.
-- Candidate scoring is deliberately exact and deterministic: reciprocal-rank
-- fusion uses a fixed constant of 60; no approximate vector index is used.
begin;

create index if not exists world_npc_memory_current_root
  on private.world_npc_memories(instance_id,record_root_id,record_version desc,id);
create index if not exists world_npc_memory_entity_refs
  on private.world_npc_memories using gin(entity_refs);
create index if not exists world_npc_memory_source_ledger_current
  on private.world_npc_memory_sources(instance_id,ledger_sequence,source_kind,source_id,source_version);

create or replace function private.world_npc_memory_evidence_retrieve(
  p_actor uuid,p_instance_id uuid,p_view text,p_cutoff_ledger_sequence bigint,
  p_query text,p_known_refs text[],p_limit integer,p_candidate_limit integer,p_fallback_limit integer,
  p_profile_id uuid default null,p_processor_version text default null,p_model text default null,
  p_dimensions integer default null,p_query_embedding extensions.vector default null
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare
  v_cutoff bigint; v_query text; v_disclosures text[]; v_profile private.world_npc_memory_embedding_profiles;
  v_semantic boolean:=false; v_refs text[]; v_has_semantic boolean;
begin
  -- Validate every externally supplied scalar before reading tenant data.
  if p_actor is null or p_instance_id is null or p_view not in ('speech','review','deliberation','transition')
     or p_limit is null or p_limit not between 1 and 32 or p_candidate_limit is null or p_candidate_limit not between p_limit and 128 or p_fallback_limit is null or p_fallback_limit not between 0 and 16
     or p_cutoff_ledger_sequence is not null and p_cutoff_ledger_sequence<0
     or p_query is null or p_query<>left(regexp_replace(trim(p_query),'\s+',' ','g'),400) then
    raise sqlstate 'PT400' using message='Evidence retrieval arguments are invalid';
  end if;
  if p_known_refs is null or cardinality(p_known_refs)>32
     or exists(select 1 from unnest(p_known_refs) ref where ref is null or ref<>left(regexp_replace(trim(ref),'\s+',' ','g'),120) or ref='') then
    raise sqlstate 'PT400' using message='Evidence references are invalid';
  end if;
  v_has_semantic := p_profile_id is not null or p_processor_version is not null or p_model is not null or p_dimensions is not null or p_query_embedding is not null;
  if v_has_semantic and (p_profile_id is null or p_processor_version is null or p_model is null or p_dimensions is null or p_query_embedding is null) then
    raise sqlstate 'PT400' using message='Evidence embedding identity is incomplete';
  end if;
  if not exists(
    select 1 from private.world_npc_instances i join public.tavern_saves s on s.id=i.save_id
    where i.id=p_instance_id and s.user_id=p_actor
  ) then raise sqlstate 'PT404' using message='Resident memory was not found'; end if;
  select coalesce(least(coalesce(p_cutoff_ledger_sequence,9223372036854775807),coalesce(max(ledger_sequence),-1)),-1)
    into v_cutoff from private.world_npc_memory_sources where instance_id=p_instance_id;
  v_query:=p_query;
  v_refs:=coalesce(p_known_refs,'{}');
  v_disclosures:=case when p_view in ('speech','review') then array['player_visible','npc_known'] else array['player_visible','npc_known','npc_private'] end;
  if v_has_semantic then
    select * into v_profile from private.world_npc_memory_embedding_profiles
      where id=p_profile_id and active and invalidated_at is null;
    if not found or v_profile.processor_version<>p_processor_version or v_profile.model<>p_model or v_profile.dimensions<>p_dimensions
       or extensions.vector_dims(p_query_embedding)<>p_dimensions or extensions.vector_norm(p_query_embedding)<=0 then
      raise sqlstate 'PT400' using message='Evidence embedding identity is invalid';
    end if;
    v_semantic:=true;
  end if;
  return (
    with q as (select case when v_query='' then null else websearch_to_tsquery('english',v_query) end query),
    eligible as (
      select m.*,s.ledger_sequence,s.envelope,q.query,
        (q.query is not null and m.search @@ q.query) lexical_match,
        case when q.query is null then 0::real else ts_rank(m.search,q.query) end lexical_score,
        (m.commitment_status='unresolved') unresolved,
        (m.related_quest_id is not null and (m.related_quest_id::text=v_query or exists(select 1 from unnest(v_refs) r where lower(r)=lower(m.related_quest_id::text)))) quest_match,
        (exists(select 1 from unnest(m.entity_refs) r where lower(r)=lower(v_query)) or exists(select 1 from unnest(m.entity_refs) r join unnest(v_refs) k on lower(k)=lower(r))) ref_match
      from private.world_npc_memories m
      join private.world_npc_memory_sources s on s.source_kind=m.source_kind and s.source_id=m.source_id and s.source_version=m.source_version and s.source_hash=m.source_hash
      cross join q
      where m.instance_id=p_instance_id and m.save_id=(select save_id from private.world_npc_instances where id=p_instance_id)
        and s.instance_id=p_instance_id and s.ledger_sequence<=v_cutoff and m.disclosure_class=any(v_disclosures) and s.disclosure_class=any(v_disclosures)
        and not exists(
          select 1 from private.world_npc_memories newer join private.world_npc_memory_sources ns on ns.source_kind=newer.source_kind and ns.source_id=newer.source_id and ns.source_version=newer.source_version and ns.source_hash=newer.source_hash
          where newer.instance_id=m.instance_id and newer.record_root_id=m.record_root_id and newer.record_version>m.record_version and ns.ledger_sequence<=v_cutoff
        )
    ), relational_ranked_raw as (
      select id,row_number() over(order by unresolved desc,(quest_match or ref_match) desc,importance desc,occurred_sequence desc,id) relational_rank,
        case when unresolved then 'unresolved_commitment' else 'important_recent' end relational_reason
      from eligible where unresolved or quest_match or ref_match or importance>=3
    ), relational_ranked as (
      select * from relational_ranked_raw where relational_rank<=p_candidate_limit
    ), lexical_ranked_raw as (
      select id,row_number() over(order by lexical_score desc,importance desc,occurred_sequence desc,id) lexical_rank
      from eligible where lexical_match
    ), lexical_ranked as (
      select * from lexical_ranked_raw where lexical_rank<=p_candidate_limit
    ), semantic_ranked_raw as (
      select e.id,row_number() over(order by (a.embedding OPERATOR(extensions.<=>) p_query_embedding),a.id,e.id) semantic_rank
      from eligible e join private.world_npc_memory_artifacts a on a.instance_id=e.instance_id and a.source_kind=e.source_kind
        and a.source_ids[1]=e.source_id and a.source_versions[1]=e.source_version and a.source_hash=e.source_hash
      where v_semantic and a.artifact_kind='embedding' and a.invalidated_at is null and a.embedding_profile_id=v_profile.id
        and a.processor_version=v_profile.processor_version and a.model=v_profile.model and a.embedding_dimensions=v_profile.dimensions
    ), semantic_ranked as (
      select * from semantic_ranked_raw where semantic_rank<=p_candidate_limit
    ), recent_ranked as (
      select id,row_number() over(order by importance desc,occurred_sequence desc,id) recent_rank
      from eligible order by importance desc,occurred_sequence desc,id limit p_candidate_limit
    ), candidates as (
      select e.*,r.relational_rank,r.relational_reason,l.lexical_rank,se.semantic_rank,re.recent_rank,
        coalesce(1.0/(60+r.relational_rank),0)+coalesce(1.0/(60+l.lexical_rank),0)+coalesce(1.0/(60+se.semantic_rank),0) fused_score,
        case when e.unresolved then 0 when e.quest_match or e.ref_match then 1 when r.id is not null or l.id is not null or se.id is not null then 2 else 3 end required_tier
      from eligible e left join relational_ranked r on r.id=e.id left join lexical_ranked l on l.id=e.id left join semantic_ranked se on se.id=e.id left join recent_ranked re on re.id=e.id
      where r.id is not null or l.id is not null or se.id is not null or re.id is not null
    ), selected as (
      select * from candidates order by required_tier,fused_score desc,case when required_tier=3 then recent_rank end,id limit p_limit
    ), bundle_eligible as (
      select m.*,s.ledger_sequence,s.envelope
      from private.world_npc_memories m join private.world_npc_memory_sources s on s.source_kind=m.source_kind and s.source_id=m.source_id and s.source_version=m.source_version and s.source_hash=m.source_hash
      where m.instance_id=p_instance_id and m.save_id=(select save_id from private.world_npc_instances where id=p_instance_id) and s.instance_id=p_instance_id and s.save_id=m.save_id and s.ledger_sequence<=v_cutoff and m.disclosure_class=any(v_disclosures) and s.disclosure_class=any(v_disclosures)
    ), bundle_candidates as (
      select s.id selected_id,e.*,0 priority,true required from selected s join bundle_eligible e on e.id=s.id
      union all select s.id,e.*,1,true from selected s join bundle_eligible e on e.record_root_id=s.record_root_id
      union all select s.id,e.*,2,true from selected s join bundle_eligible e on e.correction_memory_id=s.id or s.correction_memory_id=e.id
      union all select s.id,e.*,3,false from selected s join bundle_eligible e on e.source_kind=s.source_kind and e.source_id=s.source_id
      union all select s.id,e.*,4,false from selected s join bundle_eligible e on s.related_quest_id is not null and e.related_quest_id=s.related_quest_id
    ), bundle_dedup as (
      select distinct on (selected_id,id) selected_id,id,record_root_id,record_version,kind,text,quote,speaker,truth_class,disclosure_class,commitment_status,related_quest_id,correction_memory_id,entity_refs,importance,occurred_day,occurred_sequence,learned_day,learned_sequence,source_kind,source_id,source_version,source_hash,ledger_sequence,priority,required
      from bundle_candidates order by selected_id,id,priority,record_version desc
    ), bundle_ranked as (
      select b.*,row_number() over(partition by selected_id order by priority,record_root_id,record_version,id) rn from bundle_dedup b
    ), required_missing as (
      select s.id selected_id,jsonb_agg(s.correction_memory_id order by s.correction_memory_id) ids
      from selected s where s.correction_memory_id is not null and not exists(select 1 from bundle_eligible e where e.id=s.correction_memory_id)
      group by s.id
    ), bundles as (
      select selected_id,jsonb_agg(jsonb_build_object('id',id,'recordRootId',record_root_id,'recordVersion',record_version,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'truthClass',truth_class,'disclosureClass',disclosure_class,'status',commitment_status,'relatedQuestId',related_quest_id,'correctionMemoryId',correction_memory_id,'entityRefs',entity_refs,'importance',importance,'occurredDay',occurred_day,'occurredSequence',occurred_sequence,'learnedDay',learned_day,'learnedSequence',learned_sequence,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence) order by priority,record_root_id,record_version,id) filter(where rn<=12) members,
        count(*) filter(where required)+coalesce((select jsonb_array_length(ids) from required_missing rm where rm.selected_id=bundle_ranked.selected_id),0) required_total,count(*) filter(where required and rn<=12) required_included,
        coalesce(jsonb_agg(id order by id) filter(where required and rn>12),'[]'::jsonb) || coalesce((select ids from required_missing rm where rm.selected_id=bundle_ranked.selected_id),'[]'::jsonb) missing_required_ids,
        count(*) filter(where not required and rn>12)>0 optional_truncated
      from bundle_ranked group by selected_id
    ), fallback_candidates as (
      select s.* from private.world_npc_memory_sources s
      where s.instance_id=p_instance_id and s.ledger_sequence<=v_cutoff and s.disclosure_class=any(v_disclosures)
        and (not exists(select 1 from private.world_npc_memories m where m.source_kind=s.source_kind and m.source_id=s.source_id and m.source_version=s.source_version and m.source_hash=s.source_hash)
          or exists(select 1 from private.world_npc_memory_outbox o where o.instance_id=s.instance_id and o.source_kind=s.source_kind and o.source_id=s.source_id and o.source_version=s.source_version and o.processor_kind='extract' and o.status in ('pending','processing','failed'))
          or exists(select 1 from private.world_npc_memory_watermarks w where w.instance_id=s.instance_id and w.processor_kind='extract' and w.gap_sequence is not null and w.gap_sequence<=s.ledger_sequence))
    ), fallback as (
      select *,row_number() over(order by ledger_sequence,source_kind,source_id,source_version) rn,count(*) over() total from fallback_candidates
    ), manifests as (
      select source_kind,source_id,source_version,source_hash,ledger_sequence from selected
      union select b.source_kind,b.source_id,b.source_version,b.source_hash,b.ledger_sequence from bundle_ranked b where b.rn<=12
      union select source_kind,source_id,source_version,source_hash,ledger_sequence from fallback where rn<=p_fallback_limit
    ), watermarks as (
      select coalesce(jsonb_agg(jsonb_build_object('processorKind',processor_kind,'processorVersion',processor_version,'contiguousSequence',contiguous_sequence,'examinedThroughSequence',examined_through_sequence,'gapSequence',gap_sequence) order by processor_kind,processor_version),'[]'::jsonb) value
      from private.world_npc_memory_watermarks where instance_id=p_instance_id
    )
    select jsonb_build_object(
      'retrievalVersion','npc-memory-evidence-v4','cutoffLedgerSequence',v_cutoff,
      'semantic',case when v_semantic then jsonb_build_object('available',true,'availability',case when exists(select 1 from semantic_ranked) then 'ready' else 'no_candidates' end,'profile',jsonb_build_object('id',v_profile.id,'processorVersion',v_profile.processor_version,'model',v_profile.model,'dimensions',v_profile.dimensions)) else jsonb_build_object('available',false,'availability','disabled','profile',null) end,
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'recordRootId',record_root_id,'recordVersion',record_version,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'truthClass',truth_class,'disclosureClass',disclosure_class,'status',commitment_status,'relatedQuestId',related_quest_id,'correctionMemoryId',correction_memory_id,'entityRefs',entity_refs,'importance',importance,'occurredDay',occurred_day,'occurredSequence',occurred_sequence,'learnedDay',learned_day,'learnedSequence',learned_sequence,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence,'channelRanks',jsonb_strip_nulls(jsonb_build_object('relational',relational_rank,'lexical',lexical_rank,'semantic',semantic_rank,'recent',recent_rank)),'fusedScore',fused_score,'selectionReasons',(select array_agg(distinct reason order by reason) from unnest(array[coalesce(relational_reason,case when recent_rank is not null then 'important_recent' end),case when quest_match or ref_match then 'exact_reference' end,case when lexical_rank is not null then 'lexical' end,case when semantic_rank is not null then 'semantic_exact' end]) reason where reason is not null)) order by required_tier,fused_score desc,case when required_tier=3 then recent_rank end,id) from selected),'[]'::jsonb),
      'bundles',coalesce((select jsonb_agg(jsonb_build_object('selectedId',s.id,'members',coalesce(b.members,'[]'::jsonb),'coverage',jsonb_build_object('requiredTotal',coalesce(b.required_total,0),'requiredIncluded',coalesce(b.required_included,0),'missingRequiredIds',coalesce(b.missing_required_ids,'[]'::jsonb),'optionalTruncated',coalesce(b.optional_truncated,false),'complete',jsonb_array_length(coalesce(b.missing_required_ids,'[]'::jsonb))=0)) order by s.required_tier,s.fused_score desc,case when s.required_tier=3 then s.recent_rank end,s.id) from selected s left join bundles b on b.selected_id=s.id),'[]'::jsonb),
      'sourceFallback',coalesce((select jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence,'envelope',envelope) order by ledger_sequence,source_kind,source_id,source_version) filter(where rn<=p_fallback_limit) from fallback),'[]'::jsonb),
      'sourceManifest',coalesce((select jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence) order by source_kind,source_id,source_version,source_hash) from manifests),'[]'::jsonb),
      'coverage',jsonb_build_object('complete',coalesce((select bool_and(jsonb_array_length(missing_required_ids)=0) from bundles),true) and coalesce((select max(total) from fallback),0)<=p_fallback_limit,'sourceFallback',jsonb_build_object('total',coalesce((select max(total) from fallback),0),'included',least(coalesce((select max(total) from fallback),0),p_fallback_limit),'truncated',coalesce((select max(total) from fallback),0)>p_fallback_limit,'complete',coalesce((select max(total) from fallback),0)<=p_fallback_limit),'watermarks',(select value from watermarks))
    )
  );
end $f$;

create or replace function public.npc_memory_evidence_retrieve_for_actor(
  p_actor uuid,p_instance_id uuid,p_view text,p_cutoff_ledger_sequence bigint,p_query text,p_known_refs text[],p_limit integer default 12,p_candidate_limit integer default 48,p_fallback_limit integer default 6,
  p_profile_id uuid default null,p_processor_version text default null,p_model text default null,p_dimensions integer default null,p_query_embedding extensions.vector default null
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='Evidence retrieval requires service role'; end if;
  return private.world_npc_memory_evidence_retrieve(p_actor,p_instance_id,p_view,p_cutoff_ledger_sequence,p_query,p_known_refs,p_limit,p_candidate_limit,p_fallback_limit,p_profile_id,p_processor_version,p_model,p_dimensions,p_query_embedding);
end $f$;

revoke all on function private.world_npc_memory_evidence_retrieve(uuid,uuid,text,bigint,text,text[],integer,integer,integer,uuid,text,text,integer,extensions.vector) from public,anon,authenticated,service_role;
revoke all on function public.npc_memory_evidence_retrieve_for_actor(uuid,uuid,text,bigint,text,text[],integer,integer,integer,uuid,text,text,integer,extensions.vector) from public,anon,authenticated;
grant execute on function public.npc_memory_evidence_retrieve_for_actor(uuid,uuid,text,bigint,text,text[],integer,integer,integer,uuid,text,text,integer,extensions.vector) to service_role;
commit;
