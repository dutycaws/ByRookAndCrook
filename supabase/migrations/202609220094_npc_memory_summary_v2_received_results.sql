-- Issue #33 094A: persist only validated v2 batch receipts for recovery.
begin;
alter table private.world_npc_memory_summary_dispatches add column if not exists model text;
alter table private.world_npc_memory_summary_dispatches drop constraint if exists world_npc_memory_summary_dispatches_check;
alter table private.world_npc_memory_summary_dispatches add constraint world_npc_memory_summary_dispatches_check check(
 (state='prepared' and dispatched_at is null and result_recorded_at is null and result is null and result_hash is null and model is null and provider_request_id is null)
 or (state='dispatched' and dispatched_at is not null and result_recorded_at is null and result is null and result_hash is null and model is null)
 or (state='received' and dispatched_at is not null and result_recorded_at is not null and result is not null and result_hash is not null and model is not null)
 or (state='fallback_required' and result_recorded_at is null and result is null and result_hash is null and model is null));
alter table private.world_npc_memory_summary_dispatches drop constraint if exists world_npc_memory_summary_dispatches_state_check;
alter table private.world_npc_memory_summary_dispatches add constraint world_npc_memory_summary_dispatches_state_check check(state in ('prepared','dispatched','received','fallback_required'));
create or replace function private.world_npc_memory_summary_dispatch_guard() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if tg_op='DELETE' and not exists(select 1 from private.world_npc_memory_outbox where id=old.job_id) then return old; end if;
 if tg_op='UPDATE' and old.job_id=new.job_id and old.batch_ordinal=new.batch_ordinal and old.fence=new.fence and old.idempotency_key=new.idempotency_key and old.identity_hash=new.identity_hash and old.request_hash=new.request_hash
   and ((old.state='prepared' and new.state in ('dispatched','fallback_required')) or (old.state='dispatched' and new.state in ('received','fallback_required')))
   and new.prepared_at=old.prepared_at then return new; end if;
 raise sqlstate 'PT409' using message='Summary dispatch receipts are append-only'; end $f$;

create function private.world_npc_memory_summary_v2_received_valid(p_result jsonb,p_set_id uuid,p_batch integer) returns boolean language plpgsql security definer set search_path='' as $f$
begin
 if p_result is null then return false; end if;
 return coalesce(jsonb_typeof(p_result)='object' and jsonb_typeof(p_result->'citations')='array' and private.world_json_keys_exact(p_result,array['version','mode','summary','citations','protectedRefs','leaves'])
   and jsonb_typeof(p_result->'protectedRefs')='array' and jsonb_typeof(p_result->'leaves')='array' and p_result->>'version'='npc-memory-summary-v2' and p_result->>'mode'='model' and jsonb_typeof(p_result->'summary')='string' and char_length(btrim(p_result->>'summary')) between 1 and 12000
   and jsonb_array_length(p_result->'citations')<=16 and private.world_npc_memory_summary_v2_batch_result_valid(p_result-'summary',p_set_id,p_batch),false);
exception when others then return false;
end $f$;

create function public.world_npc_memory_summary_record_dispatch_result(p_job_id uuid,p_fence uuid,p_batch_ordinal integer,p_result jsonb,p_model text,p_provider_request_id text default null) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; r private.world_npc_memory_summary_dispatches; h text;
begin
 perform private.world_settlement_assert_service(); j:=private.world_npc_memory_summary_dispatch_assert(p_job_id,p_fence,p_batch_ordinal);
 if j.summary_protocol<>'v2' or p_result is null or jsonb_typeof(p_result)<>'object' or char_length(btrim(coalesce(p_model,''))) not between 1 and 120 or (p_provider_request_id is not null and char_length(p_provider_request_id)>200) or not private.world_npc_memory_summary_v2_received_valid(p_result,j.source_id,p_batch_ordinal) then raise sqlstate 'PT400' using message='Summary v2 received result is invalid'; end if;
 h:=encode(extensions.digest(private.world_canonical_json(p_result),'sha256'),'hex');
 select * into r from private.world_npc_memory_summary_dispatches where job_id=p_job_id and batch_ordinal=p_batch_ordinal for update;
 if not found or r.fence<>p_fence then raise sqlstate 'PT409' using message='Summary dispatch receipt is stale'; end if;
 if r.state='received' then if r.result_hash=h and r.result=p_result and r.model=p_model and r.provider_request_id is not distinct from p_provider_request_id then return jsonb_build_object('status','reused','resultHash',h); end if; raise sqlstate 'PT409' using message='Summary received replay conflicts'; end if;
 if r.state<>'dispatched' then raise sqlstate 'PT409' using message='Summary dispatch receipt is unavailable'; end if;
 if r.provider_request_id is not null and r.provider_request_id is distinct from p_provider_request_id then raise sqlstate 'PT409' using message='Summary provider request provenance conflicts'; end if;
 update private.world_npc_memory_summary_dispatches set state='received',result=p_result,result_hash=h,model=p_model,provider_request_id=p_provider_request_id,result_recorded_at=clock_timestamp() where job_id=p_job_id and batch_ordinal=p_batch_ordinal;
 return jsonb_build_object('status','received','resultHash',h);
end $f$;

create or replace function public.world_npc_memory_summary_recover_dispatch(p_job_id uuid,p_fence uuid,p_batch_ordinal integer) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; r private.world_npc_memory_summary_dispatches; identity jsonb; request_payload jsonb;
begin
 perform private.world_settlement_assert_service(); j:=private.world_npc_memory_summary_dispatch_assert(p_job_id,p_fence,p_batch_ordinal);
 select * into r from private.world_npc_memory_summary_dispatches where job_id=p_job_id and batch_ordinal=p_batch_ordinal for update;
 if not found then return jsonb_build_object('directive','fallback_only','reason','no_prior_receipt'); end if;
 if j.summary_protocol='v2' and r.state='received' then
   identity:=jsonb_build_object('jobId',j.id,'fence',r.fence,'batchOrdinal',p_batch_ordinal,'sourceHash',j.source_hash,'sourceVersion',j.source_version,'processorVersion',j.processor_version,'promptReleaseId',j.prompt_release_id,'summaryProtocol',j.summary_protocol,'summaryPromptKey',j.summary_prompt_key);
   request_payload:=jsonb_set(public.world_npc_memory_summary_load(p_job_id,p_fence,p_batch_ordinal),'{fence}',to_jsonb(r.fence));
   if r.identity_hash=encode(extensions.digest(private.world_canonical_json(identity),'sha256'),'hex') and r.request_hash=encode(extensions.digest(private.world_canonical_json(request_payload),'sha256'),'hex') and private.world_npc_memory_summary_v2_received_valid(r.result,j.source_id,p_batch_ordinal) and r.result_hash=encode(extensions.digest(private.world_canonical_json(r.result),'sha256'),'hex') then return jsonb_build_object('directive','reuse_result','resultHash',r.result_hash,'result',r.result,'model',r.model,'providerRequestId',r.provider_request_id); end if;
   raise sqlstate 'PT409' using message='Summary received receipt is no longer bound to its immutable request';
 end if;
 if r.state in ('prepared','dispatched') then update private.world_npc_memory_summary_dispatches set state='fallback_required' where job_id=r.job_id and batch_ordinal=r.batch_ordinal; end if;
 return jsonb_build_object('directive','fallback_only','reason','prior_attempt_reclaimed');
end $f$;
revoke all on function private.world_npc_memory_summary_v2_received_valid(jsonb,uuid,integer),public.world_npc_memory_summary_record_dispatch_result(uuid,uuid,integer,jsonb,text,text) from public,anon,authenticated; grant execute on function public.world_npc_memory_summary_record_dispatch_result(uuid,uuid,integer,jsonb,text,text) to service_role;
commit;
