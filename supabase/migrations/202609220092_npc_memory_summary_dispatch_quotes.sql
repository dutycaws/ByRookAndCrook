-- Issue #33 3B.2a: durable provider-dispatch receipts.  This is deliberately
-- inert for v1 completion; a later, explicitly released contract may opt in.
begin;

-- Earlier rejected drafts exposed a result-recording RPC.  Receipt storage is
-- intentionally prepare/mark/recover-only until the separately released v2
-- contract owns result interpretation.
drop function if exists public.world_npc_memory_summary_record_dispatch_result(uuid,uuid,integer,jsonb);

create table private.world_npc_memory_summary_dispatches (
  job_id uuid not null references private.world_npc_memory_outbox(id) on delete cascade,
  batch_ordinal integer not null check(batch_ordinal>=0),
  fence uuid not null,
  idempotency_key text not null check(char_length(idempotency_key) between 1 and 200),
  identity_hash text not null check(identity_hash~'^[0-9a-f]{64}$'),
  request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
  state text not null default 'prepared' check(state in ('prepared','dispatched','fallback_required')),
  provider_request_id text check(char_length(provider_request_id)<=200),
  result_hash text check(result_hash is null or result_hash~'^[0-9a-f]{64}$'),
  result jsonb,
  prepared_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz, result_recorded_at timestamptz,
  primary key(job_id,batch_ordinal), unique(idempotency_key),
  check((state='prepared' and dispatched_at is null and result_recorded_at is null and result is null and result_hash is null)
     or (state='dispatched' and dispatched_at is not null and result_recorded_at is null and result is null and result_hash is null)
     or (state='fallback_required' and result_recorded_at is null and result is null and result_hash is null))
);

create function private.world_npc_memory_summary_dispatch_guard() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if tg_op='DELETE' and not exists(select 1 from private.world_npc_memory_outbox where id=old.job_id) then return old; end if;
 if tg_op='UPDATE' and old.state='prepared' and new.state in ('dispatched','fallback_required') and new.job_id=old.job_id and new.batch_ordinal=old.batch_ordinal and new.fence=old.fence and new.idempotency_key=old.idempotency_key and new.identity_hash=old.identity_hash and new.request_hash=old.request_hash then return new; end if;
 if tg_op='UPDATE' and old.state='dispatched' and new.state='fallback_required' and new.job_id=old.job_id and new.batch_ordinal=old.batch_ordinal and new.fence=old.fence and new.idempotency_key=old.idempotency_key and new.identity_hash=old.identity_hash and new.request_hash=old.request_hash then
   return new;
 end if;
 raise sqlstate 'PT409' using message='Summary dispatch receipts are append-only';
end $f$;
create trigger world_npc_memory_summary_dispatch_guard before update or delete on private.world_npc_memory_summary_dispatches for each row execute function private.world_npc_memory_summary_dispatch_guard();

create function private.world_npc_memory_summary_dispatch_assert(p_job_id uuid,p_fence uuid,p_batch_ordinal integer) returns private.world_npc_memory_outbox language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; s private.world_npc_memory_summary_sets;
begin
 select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
 if not found or j.source_kind<>'memory_set' or j.processor_kind<>'summary' or j.status<>'processing' or j.fence<>p_fence or j.lease_until<=clock_timestamp() or exists(select 1 from private.world_npc_memory_invalidations where job_id=p_job_id and fence=p_fence) then raise sqlstate 'PT409' using message='Summary dispatch fence is stale'; end if;
 select * into s from private.world_npc_memory_summary_sets where id=j.source_id for update;
 if not found or s.closure_status='invalidated' or s.set_version<>j.source_version or s.set_hash<>j.source_hash or s.cutoff_ledger_sequence<>j.source_sequence or not exists(select 1 from private.world_npc_memory_summary_batches where set_id=s.id and batch_ordinal=p_batch_ordinal) then raise sqlstate 'PT409' using message='Summary dispatch source changed or batch unavailable'; end if;
 perform private.world_npc_memory_summary_validate(s.id); return j;
end $f$;

-- Kept dormant until a release deliberately pins this contract.  The check is
-- byte-exact: quoted text is either the stored quote or a literal substring of
-- stored text; PostgreSQL does no Unicode normalization here.
create function private.world_npc_memory_summary_v2_content_valid(p_content jsonb,p_set_id uuid) returns boolean language plpgsql security definer set search_path='' as $f$
declare c jsonb; l jsonb; prev_leaf integer:=-1; prev_record uuid:=null; last_leaf integer:=-1;
begin
 if jsonb_typeof(p_content)<>'object' or not private.world_json_keys_exact(p_content,array['version','mode','summary','citations','protectedRefs','leaves','batches']) or p_content->>'version'<>'npc-memory-summary-v2' or p_content->>'mode'<>'model' or jsonb_typeof(p_content->'summary')<>'string' or char_length(btrim(p_content->>'summary'))=0 or jsonb_typeof(p_content->'citations')<>'array' or jsonb_array_length(p_content->'citations')>128 then return false; end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence) order by ordinal),'[]'::jsonb) into l from private.world_npc_memory_summary_leaves where set_id=p_set_id;
 if p_content->'leaves'<>l or p_content->'protectedRefs'<>l then return false; end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',batch_ordinal,'firstLeafOrdinal',first_leaf_ordinal,'lastLeafOrdinal',last_leaf_ordinal,'leafCount',leaf_count) order by batch_ordinal),'[]'::jsonb) into l from private.world_npc_memory_summary_batches where set_id=p_set_id;
 if p_content->'batches'<>l or jsonb_typeof(p_content->'protectedRefs')<>'array' then return false; end if;
 for c in select value from jsonb_array_elements(p_content->'citations') loop
   if not private.world_json_keys_exact(c,array['leafOrdinal','recordId','speaker','quote','sourceKind','sourceId','sourceVersion','sourceHash']) or coalesce(c->>'leafOrdinal','') !~ '^(0|[1-9][0-9]*)$' or coalesce(c->>'recordId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(c->>'sourceId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(c->>'sourceVersion','') !~ '^(0|[1-9][0-9]*)$' or coalesce(c->>'sourceHash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(c->'speaker')<>'string' or jsonb_typeof(c->'quote')<>'string' or char_length(btrim(c->>'quote'))=0 or char_length(c->>'quote')>12000 then return false; end if;
   if (c->>'leafOrdinal')::integer<prev_leaf or ((c->>'leafOrdinal')::integer=prev_leaf and prev_record is not null and (c->>'recordId')::uuid<=prev_record) then return false; end if;
   if not exists(select 1 from private.world_npc_memory_summary_leaves sl join private.world_npc_memory_summary_sets s on s.id=sl.set_id join private.world_npc_memories m on m.id=(c->>'recordId')::uuid where sl.set_id=p_set_id and sl.ordinal=(c->>'leafOrdinal')::integer and s.instance_id=m.instance_id and s.save_id=m.save_id and s.disclosure_class=m.disclosure_class and m.source_kind=sl.source_kind and m.source_id=sl.source_id and m.source_version=sl.source_version and m.source_hash=sl.source_hash and m.speaker=c->>'speaker' and c->>'sourceKind'=m.source_kind and (c->>'sourceId')::uuid=m.source_id and (c->>'sourceVersion')::bigint=m.source_version and c->>'sourceHash'=m.source_hash and (c->>'quote'=m.quote or position(c->>'quote' in m.text)>0)) then return false; end if;
   prev_leaf:=(c->>'leafOrdinal')::integer; prev_record:=(c->>'recordId')::uuid;
 end loop; return true;
end $f$;

-- Provider receipts are batch-scoped evidence, never a whole-set artifact.
-- Keep this validator deliberately separate from the final v2 contract.
create function private.world_npc_memory_summary_v2_batch_result_valid(p_result jsonb,p_set_id uuid,p_batch_ordinal integer) returns boolean language plpgsql security definer set search_path='' as $f$
declare c jsonb; expected jsonb; first_ordinal integer; last_ordinal integer; previous_leaf integer:=-1; previous_record uuid:=null;
begin
 if jsonb_typeof(p_result)<>'object' or not private.world_json_keys_exact(p_result,array['version','mode','citations','protectedRefs','leaves']) or p_result->>'version'<>'npc-memory-summary-v2' or p_result->>'mode'<>'model' or jsonb_typeof(p_result->'citations')<>'array' or jsonb_typeof(p_result->'leaves')<>'array' or jsonb_typeof(p_result->'protectedRefs')<>'array' then return false; end if;
 select first_leaf_ordinal,last_leaf_ordinal into first_ordinal,last_ordinal from private.world_npc_memory_summary_batches where set_id=p_set_id and batch_ordinal=p_batch_ordinal;
 if first_ordinal is null then return false; end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version,'sourceHash',source_hash,'ledgerSequence',ledger_sequence) order by ordinal),'[]'::jsonb) into expected from private.world_npc_memory_summary_leaves where set_id=p_set_id and ordinal between first_ordinal and last_ordinal;
 if p_result->'leaves'<>expected or p_result->'protectedRefs'<>expected then return false; end if;
 for c in select value from jsonb_array_elements(p_result->'citations') loop
   if not private.world_json_keys_exact(c,array['leafOrdinal','recordId','speaker','quote','sourceKind','sourceId','sourceVersion','sourceHash']) or coalesce(c->>'leafOrdinal','') !~ '^(0|[1-9][0-9]*)$' or coalesce(c->>'recordId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(c->>'sourceId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(c->>'sourceVersion','') !~ '^(0|[1-9][0-9]*)$' or coalesce(c->>'sourceHash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(c->'quote')<>'string' or jsonb_typeof(c->'speaker')<>'string' then return false; end if;
   if (c->>'leafOrdinal')::integer not between first_ordinal and last_ordinal or (c->>'leafOrdinal')::integer<previous_leaf or ((c->>'leafOrdinal')::integer=previous_leaf and previous_record is not null and (c->>'recordId')::uuid<=previous_record) then return false; end if;
   if not exists(select 1 from private.world_npc_memory_summary_leaves sl join private.world_npc_memory_summary_sets s on s.id=sl.set_id join private.world_npc_memories m on m.id=(c->>'recordId')::uuid where sl.set_id=p_set_id and sl.ordinal=(c->>'leafOrdinal')::integer and s.instance_id=m.instance_id and s.save_id=m.save_id and s.disclosure_class=m.disclosure_class and m.source_kind=sl.source_kind and m.source_id=sl.source_id and m.source_version=sl.source_version and m.source_hash=sl.source_hash and m.speaker=c->>'speaker' and c->>'sourceKind'=m.source_kind and (c->>'sourceId')::uuid=m.source_id and (c->>'sourceVersion')::bigint=m.source_version and c->>'sourceHash'=m.source_hash and (c->>'quote'=m.quote or position(c->>'quote' in m.text)>0)) then return false; end if;
   previous_leaf:=(c->>'leafOrdinal')::integer; previous_record:=(c->>'recordId')::uuid;
 end loop;
 return true;
end $f$;
create function private.world_npc_memory_summary_v2_batch_valid(p_set_id uuid,p_batch_ordinal integer,p_result jsonb) returns boolean language sql stable security definer set search_path='' as $f$
 select private.world_npc_memory_summary_v2_batch_result_valid(p_result,p_set_id,p_batch_ordinal)
$f$;
create function private.world_npc_memory_summary_v2_content_valid(p_set_id uuid,p_content jsonb) returns boolean language sql stable security definer set search_path='' as $f$
 select private.world_npc_memory_summary_v2_content_valid(p_content,p_set_id)
$f$;

create function public.world_npc_memory_summary_prepare_dispatch(p_job_id uuid,p_fence uuid,p_batch_ordinal integer) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; r private.world_npc_memory_summary_dispatches; i text; q text;
begin
 perform private.world_settlement_assert_service(); j:=private.world_npc_memory_summary_dispatch_assert(p_job_id,p_fence,p_batch_ordinal);
 i:=encode(extensions.digest(private.world_canonical_json(jsonb_build_object('jobId',j.id,'fence',j.fence,'batchOrdinal',p_batch_ordinal,'sourceHash',j.source_hash,'sourceVersion',j.source_version,'processorVersion',j.processor_version,'promptReleaseId',j.prompt_release_id)),'sha256'),'hex');
 q:=encode(extensions.digest(private.world_canonical_json(public.world_npc_memory_summary_load(p_job_id,p_fence,p_batch_ordinal)),'sha256'),'hex');
 insert into private.world_npc_memory_summary_dispatches(job_id,batch_ordinal,fence,idempotency_key,identity_hash,request_hash) values(j.id,p_batch_ordinal,j.fence,'npc-memory-summary:'||j.id::text||':'||p_batch_ordinal,i,q) on conflict(job_id,batch_ordinal) do nothing;
 select * into r from private.world_npc_memory_summary_dispatches where job_id=j.id and batch_ordinal=p_batch_ordinal;
 if r.fence<>j.fence or r.identity_hash<>i or r.request_hash<>q or r.state='fallback_required' then raise sqlstate 'PT409' using message='Summary dispatch receipt is ambiguous'; end if;
 return jsonb_build_object('idempotencyKey',r.idempotency_key,'identityHash',r.identity_hash,'requestHash',r.request_hash,'state',r.state);
end $f$;

create function public.world_npc_memory_summary_mark_dispatched(p_job_id uuid,p_fence uuid,p_batch_ordinal integer,p_provider_request_id text default null) returns void language plpgsql security definer set search_path='' as $f$
begin
 perform private.world_settlement_assert_service(); perform private.world_npc_memory_summary_dispatch_assert(p_job_id,p_fence,p_batch_ordinal);
 update private.world_npc_memory_summary_dispatches set state='dispatched',dispatched_at=clock_timestamp(),provider_request_id=p_provider_request_id where job_id=p_job_id and batch_ordinal=p_batch_ordinal and fence=p_fence and state='prepared';
 if not found and not exists(select 1 from private.world_npc_memory_summary_dispatches where job_id=p_job_id and batch_ordinal=p_batch_ordinal and fence=p_fence and state='dispatched') then raise sqlstate 'PT409' using message='Summary dispatch receipt is unavailable'; end if;
end $f$;

create function public.world_npc_memory_summary_recover_dispatch(p_job_id uuid,p_fence uuid,p_batch_ordinal integer) returns jsonb language plpgsql security definer set search_path='' as $f$
declare r private.world_npc_memory_summary_dispatches;
begin
 -- Validate the current claimant first.  Receipt lookup intentionally does
 -- not use its fence: a reclaimed job must make the old provider attempt
 -- terminally fallback-only, never try to send it again.
 perform private.world_settlement_assert_service();
 perform private.world_npc_memory_summary_dispatch_assert(p_job_id,p_fence,p_batch_ordinal);
 select * into r from private.world_npc_memory_summary_dispatches
 where job_id=p_job_id and batch_ordinal=p_batch_ordinal for update;
 if not found then return jsonb_build_object('directive','fallback_only','reason','no_prior_receipt'); end if;
 if r.state in ('prepared','dispatched') then
   update private.world_npc_memory_summary_dispatches set state='fallback_required' where job_id=r.job_id and batch_ordinal=r.batch_ordinal;
 end if;
 if r.fence=p_fence then return jsonb_build_object('directive','fallback_only','reason','current_attempt_requires_fallback'); end if;
 return jsonb_build_object('directive','fallback_only','reason','prior_attempt_reclaimed','priorFence',r.fence,'priorState',r.state);
end $f$;

revoke all on table private.world_npc_memory_summary_dispatches from public,anon,authenticated,service_role;
revoke all on function private.world_npc_memory_summary_dispatch_guard(),private.world_npc_memory_summary_dispatch_assert(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.world_npc_memory_summary_prepare_dispatch(uuid,uuid,integer),public.world_npc_memory_summary_mark_dispatched(uuid,uuid,integer,text),public.world_npc_memory_summary_recover_dispatch(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.world_npc_memory_summary_prepare_dispatch(uuid,uuid,integer),public.world_npc_memory_summary_mark_dispatched(uuid,uuid,integer,text),public.world_npc_memory_summary_recover_dispatch(uuid,uuid,integer) to service_role;
revoke all on function private.world_npc_memory_summary_v2_content_valid(jsonb,uuid),private.world_npc_memory_summary_v2_content_valid(uuid,jsonb),private.world_npc_memory_summary_v2_batch_result_valid(jsonb,uuid,integer),private.world_npc_memory_summary_v2_batch_valid(uuid,integer,jsonb) from public,anon,authenticated,service_role;
commit;
