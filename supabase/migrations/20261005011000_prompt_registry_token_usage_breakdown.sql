begin;

-- Preserve cache usage as optional data: older provider responses did not
-- report a breakdown, so NULL must remain distinct from a reported zero.
alter table private.prompt_execution_ledger
  add column cached_input_tokens integer,
  add column cache_write_input_tokens integer,
  add constraint prompt_execution_ledger_cached_input_tokens_check
    check (cached_input_tokens is null or (input_tokens is not null and cached_input_tokens between 0 and input_tokens)),
  add constraint prompt_execution_ledger_cache_write_input_tokens_check
    check (cache_write_input_tokens is null or (input_tokens is not null and cache_write_input_tokens between 0 and input_tokens)),
  add constraint prompt_execution_ledger_input_breakdown_check
    check (cached_input_tokens is null or cache_write_input_tokens is null or cached_input_tokens + cache_write_input_tokens <= input_tokens);

-- Replace the prior arity so PostgREST has one unambiguous RPC signature;
-- the new optional tail arguments remain backwards-compatible for callers.
drop function public.prompt_registry_service_record_run(text,integer,text,text,text,uuid,uuid,text,text,integer,integer,integer,text);

create function public.prompt_registry_service_record_run(
  p_execution_id text,p_attempt integer,p_workflow text,p_node_key text,p_prompt_key text,p_release_id uuid,p_revision_id uuid,p_status text,
  p_model text default null,p_duration_ms integer default null,p_input_tokens integer default null,p_output_tokens integer default null,p_error_code text default null,
  p_cached_input_tokens integer default null,p_cache_write_input_tokens integer default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.prompt_registry_assert_service();
  if p_status not in ('started','completed','failed','reused','skipped') then raise sqlstate 'PT400' using message='Unsupported execution status'; end if;
  if p_error_code is not null and p_error_code not in ('provider_unavailable','provider_timeout','provider_malformed','provider_failed','quota_exceeded','stale','cancelled','lease_expired','storage_failed','moderation_failed','registry_unavailable') then raise sqlstate 'PT400' using message='Unsupported execution error code'; end if;
  if not exists(select 1 from private.prompt_release_entries where release_id=p_release_id and prompt_key=p_prompt_key and revision_id=p_revision_id) then raise sqlstate 'PT400' using message='Prompt provenance does not belong to release'; end if;
  if p_execution_id is null or p_execution_id !~ '^[A-Za-z0-9:_-]{1,160}$' or coalesce(p_attempt,0)<0 then raise sqlstate 'PT400' using message='Invalid execution provenance'; end if;
  if (p_cached_input_tokens is not null and (p_input_tokens is null or p_cached_input_tokens<0 or p_cached_input_tokens>p_input_tokens))
    or (p_cache_write_input_tokens is not null and (p_input_tokens is null or p_cache_write_input_tokens<0 or p_cache_write_input_tokens>p_input_tokens))
    or (p_cached_input_tokens is not null and p_cache_write_input_tokens is not null and p_cached_input_tokens+p_cache_write_input_tokens>p_input_tokens) then
    raise sqlstate 'PT400' using message='Invalid input token breakdown';
  end if;
  insert into private.prompt_execution_ledger(execution_id,attempt,workflow,node_key,prompt_key,release_id,revision_id,status,model,duration_ms,input_tokens,output_tokens,cached_input_tokens,cache_write_input_tokens,error_code)
  values(p_execution_id,p_attempt,p_workflow,p_node_key,p_prompt_key,p_release_id,p_revision_id,p_status,p_model,p_duration_ms,p_input_tokens,p_output_tokens,p_cached_input_tokens,p_cache_write_input_tokens,p_error_code)
  on conflict(execution_id,attempt,node_key,prompt_key,status) do nothing;
  delete from private.prompt_execution_ledger where id in (
    select id from private.prompt_execution_ledger where occurred_at<clock_timestamp()-interval '30 days' order by occurred_at limit 500
  );
end $$;

create or replace function public.prompt_registry_recent_runs(p_workflow text default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.prompt_registry_assert_manager(); return (select coalesce(jsonb_agg(jsonb_build_object('executionId',execution_id,'attempt',attempt,'workflow',workflow,'node',node_key,'promptKey',prompt_key,'releaseId',release_id,'revisionId',revision_id,'status',status,'model',model,'durationMs',duration_ms,'inputTokens',input_tokens,'outputTokens',output_tokens,'cachedInputTokens',cached_input_tokens,'cacheWriteInputTokens',cache_write_input_tokens,'errorCode',error_code,'occurredAt',occurred_at) order by occurred_at desc),'[]'::jsonb) from (select * from private.prompt_execution_ledger where p_workflow is null or workflow=p_workflow order by occurred_at desc limit greatest(1,least(coalesce(p_limit,20),50))) s); end $$;

revoke all on function public.prompt_registry_service_record_run(text,integer,text,text,text,uuid,uuid,text,text,integer,integer,integer,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.prompt_registry_service_record_run(text,integer,text,text,text,uuid,uuid,text,text,integer,integer,integer,text,integer,integer) to service_role;

commit;
