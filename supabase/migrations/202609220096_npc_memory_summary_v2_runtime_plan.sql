begin;

-- A non-prose runtime plan is the only supported way for a worker to discover
-- the immutable v2 batch topology.  It deliberately retains the live-lease
-- requirement of dispatch: completed jobs replay through finalization only.
create function public.world_npc_memory_summary_plan_v2(p_job_id uuid,p_fence uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; s private.world_npc_memory_summary_sets; v uuid; n integer; max_summary integer; max_citations integer; planned jsonb; plan jsonb;
begin
 perform private.world_settlement_assert_service();
 select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
 if not found or j.source_kind<>'memory_set' or j.processor_kind<>'summary' or j.processor_version<>'npc-memory-summary-v2' or j.summary_protocol<>'v2' or j.summary_prompt_key<>'npc_memory.summary.v2' or j.status<>'processing' or j.fence<>p_fence or j.lease_until<=clock_timestamp() or exists(select 1 from private.world_npc_memory_invalidations where job_id=j.id and fence=p_fence) then raise sqlstate 'PT409' using message='Summary runtime plan fence is stale'; end if;
 select * into s from private.world_npc_memory_summary_sets where id=j.source_id for update;
 if not found or s.closure_status='invalidated' or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.set_version<>j.source_version or s.set_hash<>j.source_hash or s.cutoff_ledger_sequence<>j.source_sequence then raise sqlstate 'PT409' using message='Summary runtime plan source changed'; end if;
 perform private.world_npc_memory_summary_validate(s.id);
 select count(*) into n from private.world_npc_memory_summary_batches where set_id=s.id;
 if n not between 1 and 128 then raise sqlstate 'PT409' using message='Summary runtime plan batches are invalid'; end if;
 max_summary:=floor((12000-2*(n-1))/n); max_citations:=floor(128/n);
 if max_summary<1 or max_citations<0 then raise sqlstate 'PT409' using message='Summary runtime plan budgets are invalid'; end if;
 select e.revision_id into v from private.prompt_release_entries e join private.prompt_revisions pr on pr.id=e.revision_id where e.release_id=j.prompt_release_id and e.prompt_key='npc_memory.summary.v2' and pr.prompt_key='npc_memory.summary.v2' and pr.contract_id='npc-memory-summary-v2' and pr.contract_hash='f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03';
 if v is null then raise sqlstate 'PT409' using message='Summary runtime plan prompt pin is invalid'; end if;
 select jsonb_agg(jsonb_build_object('ordinal',batch_ordinal,'firstLeafOrdinal',first_leaf_ordinal,'lastLeafOrdinal',last_leaf_ordinal,'leafCount',leaf_count,'maxSummaryChars',max_summary,'maxCitations',max_citations) order by batch_ordinal) into planned from private.world_npc_memory_summary_batches where set_id=s.id;
 if planned is null or jsonb_array_length(planned)<>n then raise sqlstate 'PT409' using message='Summary runtime plan batches are incomplete'; end if;
 plan:=jsonb_build_object('version','npc-memory-summary-v2-runtime-plan-1','jobId',j.id,'fence',j.fence,'set',jsonb_build_object('id',s.id,'setVersion',s.set_version,'setHash',s.set_hash,'summaryKind',s.summary_kind,'cutoffLedgerSequence',s.cutoff_ledger_sequence,'disclosureClass',s.disclosure_class),'prompt',jsonb_build_object('releaseId',j.prompt_release_id,'key','npc_memory.summary.v2','revisionId',v,'contractId','npc-memory-summary-v2','contractHash','f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03'),'batchCount',n,'maxSummaryChars',max_summary,'maxCitations',max_citations,'batches',planned);
 return plan||jsonb_build_object('planHash',encode(extensions.digest(private.world_canonical_json(plan),'sha256'),'hex'));
end $f$;

revoke all on function public.world_npc_memory_summary_plan_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.world_npc_memory_summary_plan_v2(uuid,uuid) to service_role;
commit;
