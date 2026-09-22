-- Issue #33 3B.1: an immutable, disclosure-scoped summary work contract.
begin;

alter table private.world_npc_memory_outbox add column if not exists prompt_release_id uuid references private.prompt_releases(id) on delete restrict;
alter table private.world_npc_memory_artifacts add column if not exists prompt_release_id uuid references private.prompt_releases(id) on delete restrict;
alter table private.world_npc_memory_artifacts add column if not exists prompt_key text references private.prompt_registry_manifest(prompt_key) on delete restrict;
alter table private.world_npc_memory_artifacts add column if not exists contract_id text;
alter table private.world_npc_memory_artifacts add column if not exists fallback text;
alter table private.world_npc_memory_artifacts drop constraint if exists world_npc_memory_summary_artifact_shape;
alter table private.world_npc_memory_artifacts add constraint world_npc_memory_summary_artifact_shape check(
 source_kind<>'memory_set' or (
   cardinality(source_ids)=1 and cardinality(source_versions)=1
   and prompt_release_id is not null and prompt_key='npc_memory.summary' and prompt_revision_id is not null
   and contract_id='npc-memory-summary-v1'
   and contract_hash='2a28c283d9fada5bc5e8b501356b6fc423305fb7cd6e5b1c1e686b038e45745e'
   and embedding is null and embedding_dimensions is null
   and ((model is not null and fallback is null) or (model is null and fallback='extractive-v1'))
 )
);
update private.world_npc_memory_outbox set prompt_release_id=(select release_id from private.prompt_registry_active_release where singleton) where source_kind='memory_set' and prompt_release_id is null;
alter table private.world_npc_memory_outbox drop constraint if exists world_npc_memory_summary_prompt_pin;
alter table private.world_npc_memory_outbox add constraint world_npc_memory_summary_prompt_pin check(source_kind<>'memory_set' or prompt_release_id is not null);
create or replace function private.world_npc_memory_summary_job_pin() returns trigger language plpgsql security definer set search_path='' as $f$
begin if new.source_kind='memory_set' and new.prompt_release_id is null then select release_id into new.prompt_release_id from private.prompt_registry_active_release where singleton; if new.prompt_release_id is null then raise sqlstate 'PT503' using message='No active prompt release for summary work'; end if; end if; return new; end $f$;
drop trigger if exists world_npc_memory_summary_job_pin on private.world_npc_memory_outbox;
create trigger world_npc_memory_summary_job_pin before insert on private.world_npc_memory_outbox for each row execute function private.world_npc_memory_summary_job_pin();

create or replace function public.prompt_registry_service_work_release(p_work_kind text,p_work_id uuid) returns uuid language plpgsql security definer set search_path='' as $f$
declare r uuid; begin perform private.prompt_registry_assert_service(); if p_work_kind='npc_memory_summary' then select prompt_release_id into r from private.world_npc_memory_outbox where id=p_work_id and source_kind='memory_set' and processor_kind='summary'; elsif p_work_kind='npc_memory_summary_set' then select j.prompt_release_id into r from private.world_npc_memory_outbox j where j.source_id=p_work_id and j.source_kind='memory_set' and j.processor_kind='summary'; elsif p_work_kind='dialogue' then select prompt_release_id into r from private.world_npc_dialogue_turns where id=p_work_id; elsif p_work_kind='settlement' then select prompt_release_id into r from private.world_settlements where id=p_work_id; elsif p_work_kind='quest_transition' then select prompt_release_id into r from private.world_quest_transitions where id=p_work_id; elsif p_work_kind='authoring' then select prompt_release_id into r from private.npc_generation_jobs where id=p_work_id; elsif p_work_kind='portrait' then select prompt_release_id into r from private.npc_portrait_generation_attempts where id=p_work_id; elsif p_work_kind='runtime_art' then select prompt_release_id into r from private.world_runtime_art_jobs where id=p_work_id; else raise sqlstate 'PT400' using message='Unknown prompt work kind'; end if; if r is null then raise sqlstate 'PT503' using message='Prompt release was not pinned for this work'; end if; return r; end $f$;

create function public.world_npc_memory_summary_load(p_job_id uuid,p_fence uuid,p_batch_ordinal integer) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox;s private.world_npc_memory_summary_sets;b private.world_npc_memory_summary_batches;v uuid;
begin perform private.world_settlement_assert_service();select * into j from private.world_npc_memory_outbox where id=p_job_id for update;if not found or j.source_kind<>'memory_set' or j.processor_kind<>'summary' or j.status<>'processing' or j.fence<>p_fence or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Summary work fence is stale';end if;select * into s from private.world_npc_memory_summary_sets where id=j.source_id for update;if not found or s.closure_status='invalidated' or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.set_version<>j.source_version or s.set_hash<>j.source_hash or s.cutoff_ledger_sequence<>j.source_sequence then raise sqlstate 'PT409' using message='Summary set changed or is unavailable';end if;select * into b from private.world_npc_memory_summary_batches where set_id=s.id and batch_ordinal=p_batch_ordinal;if not found then raise sqlstate 'PT404' using message='Summary batch was not found';end if;select revision_id into v from private.prompt_release_entries where release_id=j.prompt_release_id and prompt_key='npc_memory.summary';if v is null then raise sqlstate 'PT503' using message='Summary prompt release is incomplete';end if;perform private.world_npc_memory_summary_validate(s.id);return jsonb_build_object('jobId',j.id,'fence',j.fence,'promptReleaseId',j.prompt_release_id,'promptKey','npc_memory.summary','promptRevisionId',v,'set',jsonb_build_object('id',s.id,'summaryKind',s.summary_kind,'setVersion',s.set_version,'setHash',s.set_hash,'cutoffLedgerSequence',s.cutoff_ledger_sequence,'disclosureClass',s.disclosure_class),'batch',jsonb_build_object('ordinal',b.batch_ordinal,'firstLeafOrdinal',b.first_leaf_ordinal,'lastLeafOrdinal',b.last_leaf_ordinal,'leafCount',b.leaf_count),'leaves',coalesce((select jsonb_agg(jsonb_build_object('ordinal',l.ordinal,'sourceKind',l.source_kind,'sourceId',l.source_id,'sourceVersion',l.source_version,'sourceHash',l.source_hash,'ledgerSequence',l.ledger_sequence,'envelope',x.envelope,'records',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'recordRootId',m.record_root_id,'recordVersion',m.record_version,'kind',m.kind,'text',m.text,'quote',m.quote,'speaker',m.speaker,'truthClass',m.truth_class,'commitmentStatus',m.commitment_status,'correctionMemoryId',m.correction_memory_id,'relatedQuestId',m.related_quest_id,'occurredDay',m.occurred_day,'occurredSequence',m.occurred_sequence,'sourceKind',m.source_kind,'sourceId',m.source_id,'sourceVersion',m.source_version,'sourceHash',m.source_hash,'disclosureClass',m.disclosure_class) order by m.record_root_id,m.record_version,m.id) from private.world_npc_memories m where m.instance_id=s.instance_id and m.disclosure_class=s.disclosure_class and m.source_kind=l.source_kind and m.source_id=l.source_id and m.source_version=l.source_version and m.source_hash=l.source_hash),'[]'::jsonb)) order by l.ordinal) from private.world_npc_memory_summary_leaves l join private.world_npc_memory_sources x on x.source_kind=l.source_kind and x.source_id=l.source_id and x.source_version=l.source_version and x.source_hash=l.source_hash and x.disclosure_class=s.disclosure_class where l.set_id=s.id and l.ordinal between b.first_leaf_ordinal and b.last_leaf_ordinal),'[]'::jsonb));end $f$;
revoke all on function public.world_npc_memory_summary_load(uuid,uuid,integer) from public,anon,authenticated; grant execute on function public.world_npc_memory_summary_load(uuid,uuid,integer) to service_role;

revoke all on function public.world_npc_memory_schedule_closures(integer) from public,anon,authenticated;grant execute on function public.world_npc_memory_schedule_closures(integer) to service_role;

-- Delegate preserves every pre-summary branch exactly as 089 left it.
alter function private.world_npc_memory_complete(uuid,uuid,jsonb,text) rename to world_npc_memory_complete_089;
create or replace function private.world_npc_memory_summary_content_valid(p_content jsonb,p_set_id uuid)
returns boolean language plpgsql security definer set search_path='' as $f$
declare expected_leaves jsonb; expected_batches jsonb; item jsonb; previous integer:=-1; max_leaf integer;
begin
 if jsonb_typeof(p_content)<>'object' or octet_length(private.world_canonical_json(p_content))>32768
    or not private.world_json_keys_exact(p_content,array['batches','citations','leaves','mode','protectedRefs','summary','version'])
    or p_content->>'version'<>'npc-memory-summary-v1' or p_content->>'mode' not in ('model','extractive-v1')
    or jsonb_typeof(p_content->'summary')<>'string' or char_length(btrim(p_content->>'summary')) not between 1 and 12000
    or jsonb_typeof(p_content->'batches')<>'array' or jsonb_typeof(p_content->'leaves')<>'array'
    or jsonb_typeof(p_content->'citations')<>'array' or jsonb_typeof(p_content->'protectedRefs')<>'array'
    or jsonb_array_length(p_content->'citations')>128 or jsonb_array_length(p_content->'protectedRefs')>128 then return false; end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',l.ordinal,'sourceKind',l.source_kind,'sourceId',l.source_id,'sourceVersion',l.source_version,'sourceHash',l.source_hash,'ledgerSequence',l.ledger_sequence) order by l.ordinal),'[]'::jsonb),max(l.ordinal) into expected_leaves,max_leaf from private.world_npc_memory_summary_leaves l where l.set_id=p_set_id;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',b.batch_ordinal,'firstLeafOrdinal',b.first_leaf_ordinal,'lastLeafOrdinal',b.last_leaf_ordinal,'leafCount',b.leaf_count) order by b.batch_ordinal),'[]'::jsonb) into expected_batches from private.world_npc_memory_summary_batches b where b.set_id=p_set_id;
 if p_content->'leaves'<>expected_leaves or p_content->'batches'<>expected_batches then return false; end if;
 for item in select value from jsonb_array_elements(p_content->'citations') loop
   if not private.world_json_keys_exact(item,array['leafOrdinal']) or jsonb_typeof(item->'leafOrdinal')<>'number' or (item->>'leafOrdinal') !~ '^[0-9]+$' or (item->>'leafOrdinal')::integer<previous or (item->>'leafOrdinal')::integer>max_leaf then return false; end if; previous:=(item->>'leafOrdinal')::integer;
 end loop;
 previous:=-1;
 for item in select value from jsonb_array_elements(p_content->'protectedRefs') loop
   if not private.world_json_keys_exact(item,array['ledgerSequence','ordinal','sourceHash','sourceId','sourceKind','sourceVersion']) or not exists(select 1 from jsonb_array_elements(expected_leaves) l where l=item) or (item->>'ordinal') !~ '^[0-9]+$' or (item->>'ordinal')::integer<=previous then return false; end if; previous:=(item->>'ordinal')::integer;
 end loop;
 return true;
end $f$;
create or replace function private.world_npc_memory_complete(p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null) returns void language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox;s private.world_npc_memory_summary_sets;a jsonb;v uuid;h text; existing private.world_npc_memory_artifacts;
begin
 select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
 if not found or j.source_kind<>'memory_set' then perform private.world_npc_memory_complete_089(p_job_id,p_fence,p_artifacts,p_error_code); return; end if;
 if exists(select 1 from private.world_npc_memory_invalidations where job_id=p_job_id and fence=p_fence) or j.fence<>p_fence then raise sqlstate 'PT409' using message='Memory work fence is stale'; end if;
 select * into s from private.world_npc_memory_summary_sets where id=j.source_id for update;
 if not found or s.closure_status='invalidated' or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.set_version<>j.source_version or s.set_hash<>j.source_hash or s.cutoff_ledger_sequence<>j.source_sequence then raise sqlstate 'PT409' using message='Summary set changed or is unavailable'; end if;
 perform private.world_npc_memory_summary_validate(s.id);
 if p_error_code is not null then
   if j.status<>'processing' or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Memory work fence is stale'; end if;
   update private.world_npc_memory_outbox set status='failed',examined_at=clock_timestamp(),error_code=left(p_error_code,120),lease_until=null where id=j.id;
   perform private.world_npc_memory_refresh_watermark(j.instance_id,j.processor_kind,j.processor_version); return;
 end if;
 if jsonb_typeof(coalesce(p_artifacts,'[]'))<>'array' or jsonb_array_length(p_artifacts)<>1 or jsonb_typeof(p_artifacts->0)<>'object' then raise sqlstate 'PT400' using message='Summary completion requires exactly one artifact'; end if;
 a:=p_artifacts->0; select e.revision_id into v from private.prompt_release_entries e join private.prompt_revisions r on r.id=e.revision_id where e.release_id=j.prompt_release_id and e.prompt_key='npc_memory.summary' and r.prompt_key='npc_memory.summary' and r.contract_id='npc-memory-summary-v1' and r.contract_hash='2a28c283d9fada5bc5e8b501356b6fc423305fb7cd6e5b1c1e686b038e45745e';
 h:=encode(extensions.digest(private.world_canonical_json(a->'content'),'sha256'),'hex');
 if v is null or not (a ?& array['artifactKind','sourceKind','sourceIds','sourceVersions','sourceHash','processorVersion','disclosureClass','content','contentHash','promptReleaseId','promptRevisionId','promptKey','contractId','contractHash']) or a->>'artifactKind'<>s.summary_kind or a->>'sourceKind'<>'memory_set' or a->>'disclosureClass'<>s.disclosure_class or a->'sourceIds'<>jsonb_build_array(s.id) or a->'sourceVersions'<>jsonb_build_array(s.set_version) or a->>'sourceHash'<>s.set_hash or a->>'processorVersion'<>j.processor_version or a->>'contentHash'<>h or a->>'promptReleaseId'<>j.prompt_release_id::text or a->>'promptRevisionId'<>v::text or a->>'promptKey'<>'npc_memory.summary' or a->>'contractId'<>'npc-memory-summary-v1' or a->>'contractHash'<>'2a28c283d9fada5bc5e8b501356b6fc423305fb7cd6e5b1c1e686b038e45745e' or a ? 'embedding' or a ? 'embeddingDimensions' or not private.world_npc_memory_summary_content_valid(a->'content',s.id) or (a->'content'->>'mode'='model' and (jsonb_typeof(a->'model')<>'string' or char_length(btrim(a->>'model')) not between 1 and 120 or a ? 'fallback')) or (a->'content'->>'mode'='extractive-v1' and (a ? 'model' or a->>'fallback'<>'extractive-v1')) then raise sqlstate 'PT400' using message='Summary artifact does not match its immutable contract'; end if;
 if j.status='completed' then
   select * into existing from private.world_npc_memory_artifacts where instance_id=j.instance_id and artifact_kind=s.summary_kind and source_hash=s.set_hash and processor_version=j.processor_version;
   if not found or existing.save_id<>j.save_id or existing.source_kind<>'memory_set' or existing.source_ids<>array[s.id] or existing.source_versions<>array[s.set_version] or existing.prompt_release_id<>j.prompt_release_id or existing.prompt_key<>'npc_memory.summary' or existing.prompt_revision_id<>v or existing.contract_id<>'npc-memory-summary-v1' or existing.contract_hash<>a->>'contractHash' or existing.disclosure_class<>s.disclosure_class or existing.content<>a->'content' or existing.content_hash<>h or existing.model is distinct from nullif(a->>'model','') or existing.fallback is distinct from nullif(a->>'fallback','') or existing.embedding is not null or existing.embedding_dimensions is not null then raise sqlstate 'PT409' using message='Summary artifact replay conflicts with completed work'; end if; return;
 end if;
 if j.status<>'processing' or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Memory work fence is stale'; end if;
 perform private.world_npc_memory_summary_validate(s.id);
 insert into private.world_npc_memory_artifacts(save_id,instance_id,artifact_kind,source_kind,source_ids,source_versions,source_hash,processor_version,prompt_release_id,prompt_key,prompt_revision_id,model,contract_id,contract_hash,fallback,disclosure_class,content,content_hash,embedding,embedding_dimensions) values(j.save_id,j.instance_id,s.summary_kind,'memory_set',array[s.id],array[s.set_version],s.set_hash,j.processor_version,j.prompt_release_id,'npc_memory.summary',v,nullif(a->>'model',''),'npc-memory-summary-v1',a->>'contractHash',nullif(a->>'fallback',''),s.disclosure_class,a->'content',h,null,null) on conflict(instance_id,artifact_kind,source_hash,processor_version) do nothing;
 select * into existing from private.world_npc_memory_artifacts where instance_id=j.instance_id and artifact_kind=s.summary_kind and source_hash=s.set_hash and processor_version=j.processor_version;
 if not found or existing.save_id<>j.save_id or existing.source_kind<>'memory_set' or existing.source_ids<>array[s.id] or existing.source_versions<>array[s.set_version] or existing.prompt_release_id<>j.prompt_release_id or existing.prompt_key<>'npc_memory.summary' or existing.prompt_revision_id<>v or existing.contract_id<>'npc-memory-summary-v1' or existing.contract_hash<>a->>'contractHash' or existing.disclosure_class<>s.disclosure_class or existing.content<>a->'content' or existing.content_hash<>h or existing.model is distinct from nullif(a->>'model','') or existing.fallback is distinct from nullif(a->>'fallback','') or existing.embedding is not null or existing.embedding_dimensions is not null then raise sqlstate 'PT409' using message='Summary artifact conflict is divergent'; end if;
 update private.world_npc_memory_outbox set status='completed',examined_at=clock_timestamp(),completed_at=clock_timestamp(),lease_until=null where id=j.id; perform private.world_npc_memory_refresh_watermark(j.instance_id,j.processor_kind,j.processor_version);
end $f$;
create or replace function private.world_npc_memory_artifact_guard() returns trigger language plpgsql security definer set search_path='' as $f$ begin if tg_op='DELETE' and not exists(select 1 from private.world_npc_instances where id=old.instance_id) then return old; end if; raise sqlstate 'PT409' using message='Memory artifacts are append-only';end $f$;
drop trigger if exists world_npc_memory_artifact_guard on private.world_npc_memory_artifacts;create trigger world_npc_memory_artifact_guard before update or delete on private.world_npc_memory_artifacts for each row execute function private.world_npc_memory_artifact_guard();
revoke all on function private.world_npc_memory_summary_job_pin(),private.world_npc_memory_summary_content_valid(jsonb,uuid),private.world_npc_memory_artifact_guard(),private.world_npc_memory_complete_089(uuid,uuid,jsonb,text),private.world_npc_memory_complete(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

-- The public worker budget is a request budget, not an instance budget.  Keep
-- the original one-argument scheduler for 088/089 callers and use a separate
-- bounded implementation for the service RPC.
create function private.world_npc_memory_schedule_closures_limited(p_limit integer,p_instance_id uuid default null) returns integer language plpgsql security definer set search_path='' as $f$
declare r private.world_npc_memory_closure_requests; d text; leaves jsonb; batches jsonb; set_row private.world_npc_memory_summary_sets; made integer:=0; maxseq bigint;
begin
 -- A known extract gap must be retried, but must never monopolize a bounded
 -- service pass.  New pending requests get first refusal; within each class
 -- use the last attempt (or original request) as a stable fairness clock.
 for r in select * from private.world_npc_memory_closure_requests where status in ('pending','blocked_gap') and (p_instance_id is null or instance_id=p_instance_id) order by case status when 'pending' then 0 else 1 end,coalesce(attempted_at,requested_at),requested_at,id limit p_limit for update loop
   select contiguous_sequence into maxseq from private.world_npc_memory_watermarks where instance_id=r.instance_id and processor_kind='extract' and processor_version='npc-memory-v1';
   if coalesce(maxseq,-1)<r.cutoff_ledger_sequence then update private.world_npc_memory_closure_requests set status='blocked_gap',reason='extract_gap',attempts=attempts+1,attempted_at=clock_timestamp() where id=r.id; continue; end if;
   for d in select unnest(array['player_visible','npc_known','npc_private']) loop
     with chosen as (select x.source_kind,x.source_id,x.source_version,row_number() over(order by x.ledger_sequence,x.source_kind,x.source_id)-1 ordinal from private.world_npc_memory_sources x where x.instance_id=r.instance_id and x.disclosure_class=d and x.ledger_sequence<=r.cutoff_ledger_sequence and ((r.summary_kind='episode_summary' and x.occurred_day=r.closed_day and exists(select 1 from private.world_npc_memories m where m.instance_id=r.instance_id and m.source_kind=x.source_kind and m.source_id=x.source_id and m.source_version=x.source_version and (m.importance>=2 or m.kind='promise' or m.related_quest_id is not null or m.source_kind in ('hospitality','resident_evolution')))) or (r.summary_kind='quest_summary' and ((x.source_kind='quest_event' and x.envelope->>'questId'=r.quest_id::text) or (x.source_kind<>'quest_event' and exists(select 1 from private.world_npc_memories m where m.instance_id=r.instance_id and m.related_quest_id=r.quest_id and m.source_kind=x.source_kind and m.source_id=x.source_id and m.source_version=x.source_version)))))) select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version) order by ordinal),'[]'::jsonb) into leaves from chosen;
     if jsonb_array_length(leaves)=0 then continue; end if;
     select jsonb_agg(jsonb_build_object('batchOrdinal',g,'firstLeafOrdinal',g*64,'lastLeafOrdinal',least(g*64+63,jsonb_array_length(leaves)-1),'leafCount',least(64,jsonb_array_length(leaves)-g*64)) order by g) into batches from generate_series(0,(jsonb_array_length(leaves)-1)/64) g;
     set_row:=private.world_npc_memory_register_summary_set(r.summary_kind,r.closure_key||':'||d,r.cutoff_ledger_sequence,d,leaves,batches); update private.world_npc_memory_closure_requests set resulting_set_ids=array_append(resulting_set_ids,set_row.id) where id=r.id and not (set_row.id=any(resulting_set_ids));
   end loop;
   update private.world_npc_memory_closure_requests set status='registered',reason='registered',registered_at=clock_timestamp(),attempted_at=clock_timestamp(),attempts=attempts+1 where id=r.id; made:=made+1;
 end loop; return made;
end $f$;
create or replace function public.world_npc_memory_schedule_closures(p_limit integer default 8) returns integer language plpgsql security definer set search_path='' as $f$
begin perform private.world_settlement_assert_service(); if p_limit is null or p_limit not between 1 and 8 then raise sqlstate 'PT400' using message='Closure schedule limit is invalid'; end if; return private.world_npc_memory_schedule_closures_limited(p_limit,null); end $f$;
revoke all on function private.world_npc_memory_schedule_closures_limited(integer,uuid) from public,anon,authenticated,service_role;
commit;
