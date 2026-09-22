-- Gate D1: frozen settlement-worker input and fenced, append-only stages.
begin;

alter table private.world_settlements
  add column action_id uuid,
  add column input_snapshot jsonb,
  add column input_version text,
  add column public_digest text;
alter table private.world_settlement_jobs
  add column input_snapshot jsonb,
  add column input_version text;
create unique index world_settlement_action_receipt on private.world_settlements(save_id,action_id) where action_id is not null;
alter table private.world_settlements add constraint world_settlement_frozen_input_shape check(
  input_snapshot is null or (jsonb_typeof(input_snapshot)='object' and octet_length(input_snapshot::text)<=32768 and char_length(input_version) between 1 and 80)
);
alter table private.world_settlement_jobs add constraint world_settlement_job_frozen_input_shape check(
  input_snapshot is null or (jsonb_typeof(input_snapshot)='object' and octet_length(input_snapshot::text)<=16384 and char_length(input_version) between 1 and 80)
);

create table private.world_settlement_stage_checkpoints (
  id bigint generated always as identity primary key,
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,
  fence uuid not null, stage text not null check(stage in ('proposer','critic','repair','final_critic','digest','validated')),
  payload jsonb not null, usage jsonb not null default '{}'::jsonb, model text not null default '', prompt_version text not null default '',
  created_at timestamptz not null default now(), unique(job_id,fence,stage),
  check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=16384),
  check(jsonb_typeof(usage)='object' and octet_length(usage::text)<=4096),
  check(char_length(model)<=160 and char_length(prompt_version)<=160)
);
create trigger world_settlement_checkpoint_append_only before update or delete on private.world_settlement_stage_checkpoints for each row execute function private.world_history_append_only();
create table private.world_settlement_worker_receipts (
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade, fence uuid not null,
  action_kind text not null check(action_kind in ('checkpoint','safe_result')), action_key text not null,
  result jsonb not null, created_at timestamptz not null default now(), primary key(job_id,fence,action_kind,action_key), check(jsonb_typeof(result)='object')
);
create trigger world_settlement_worker_receipt_append_only before update or delete on private.world_settlement_worker_receipts for each row execute function private.world_history_append_only();

create function private.world_settlement_frozen_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.save_id<>old.save_id or new.day_number<>old.day_number or new.source_revision<>old.source_revision or new.input_fingerprint<>old.input_fingerprint or new.input_snapshot is distinct from old.input_snapshot or new.input_version is distinct from old.input_version or new.action_id is distinct from old.action_id then
    raise exception using errcode='55000',message='Settlement input is immutable';
  end if; return new;
end $$;
create function private.world_settlement_job_frozen_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.settlement_id<>old.settlement_id or new.ordinal<>old.ordinal or new.job_kind<>old.job_kind or new.input_fingerprint<>old.input_fingerprint or new.input_snapshot is distinct from old.input_snapshot or new.input_version is distinct from old.input_version then
    raise exception using errcode='55000',message='Settlement job input is immutable';
  end if; return new;
end $$;
create trigger world_settlement_frozen_guard before update on private.world_settlements for each row execute function private.world_settlement_frozen_guard();
create trigger world_settlement_job_frozen_guard before update on private.world_settlement_jobs for each row execute function private.world_settlement_job_frozen_guard();

alter function public.world_settlement_claim(uuid) rename to world_settlement_claim_v1;
alter function public.world_settlement_claim_v1(uuid) set schema private;

create function public.world_settlement_claim(p_settlement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; s private.world_settlements; j private.world_settlement_jobs;
begin
  r:=private.world_settlement_claim_v1(p_settlement_id);
  if r ? 'jobId' then
    select * into s from private.world_settlements where id=p_settlement_id;
    select * into j from private.world_settlement_jobs where id=(r->>'jobId')::uuid;
    return r || jsonb_build_object('inputVersion',s.input_version,'inputSnapshot',s.input_snapshot,
      'jobInputVersion',j.input_version,'jobInputSnapshot',j.input_snapshot,
      'checkpoints',(select coalesce(jsonb_agg(jsonb_build_object('stage',q.stage,'payload',q.payload,'usage',q.usage,'model',q.model,'promptVersion',q.prompt_version,'createdAt',q.created_at,'sourceFence',q.fence,'sourceAttempt',q.attempt_number) order by q.stage),'[]'::jsonb)
        from (select distinct on (c.stage) c.stage,c.payload,c.usage,c.model,c.prompt_version,c.created_at,c.fence,a.attempt_number
          from private.world_settlement_stage_checkpoints c left join private.world_settlement_attempts a on a.job_id=c.job_id and a.fence=c.fence
          where c.job_id=j.id order by c.stage,c.created_at desc,c.id desc) q));
  end if;
  return r;
end $$;

create function public.world_settlement_enqueue(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_input_snapshot jsonb,p_input_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; snapshot jsonb; fingerprint text; settlement_id uuid; existing private.world_settlements; kind text; ordinal smallint:=0;
begin
  perform private.world_settlement_assert_service();
  if p_action_id is null or jsonb_typeof(p_input_snapshot)<>'object' or octet_length(p_input_snapshot::text)>24576 or char_length(coalesce(p_input_version,'')) not between 1 and 80 then raise sqlstate 'PT400' using message='Settlement input is invalid'; end if;
  select * into s from public.tavern_saves where id=p_save_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  select * into existing from private.world_settlements where save_id=p_save_id and action_id=p_action_id;
  if found then return jsonb_build_object('settlementId',existing.id,'status',existing.status,'replayed',true,'inputFingerprint',existing.input_fingerprint); end if;
  if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Save revision changed'; end if;
  if s.world_phase<>'open' then raise sqlstate 'PT409' using message='Save is already settling'; end if;
  snapshot:=p_input_snapshot || jsonb_build_object('saveId',p_save_id,'dayNumber',s.current_day,'sourceRevision',s.revision,'inputVersion',p_input_version);
  fingerprint:=encode(extensions.digest(snapshot::text,'sha256'),'hex');
  insert into private.world_settlements(save_id,day_number,source_revision,input_fingerprint,action_id,input_snapshot,input_version,status,deadline_at)
    values(p_save_id,s.current_day,s.revision,fingerprint,p_action_id,snapshot,p_input_version,'queued',clock_timestamp()+interval '120 seconds') returning id into settlement_id;
  foreach kind in array array['snapshot','canon','resident','quest','effects','news','finalize'] loop
    ordinal:=ordinal+1;
    insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint,input_snapshot,input_version)
      values(settlement_id,ordinal,kind,fingerprint, snapshot || jsonb_build_object('jobKind',kind,'ordinal',ordinal),p_input_version);
  end loop;
  update public.tavern_saves set world_phase='settling' where id=p_save_id;
  return jsonb_build_object('settlementId',settlement_id,'status','queued','replayed',false,'inputFingerprint',fingerprint,'dayNumber',s.current_day,'sourceRevision',s.revision);
end $$;

-- This core is deliberately private: later authenticated day advancement can call it
-- inside its own transaction, while the public entry point remains service-only.
create function private.world_settlement_enqueue_core(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_input_snapshot jsonb,p_input_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; snapshot jsonb; job_snapshot jsonb; fingerprint text; settlement_id uuid; existing private.world_settlements; kind text; ordinal smallint:=0;
begin
  if p_action_id is null or jsonb_typeof(p_input_snapshot)<>'object' or octet_length(p_input_snapshot::text)>12000 or char_length(coalesce(p_input_version,'')) not between 1 and 80 then raise sqlstate 'PT400' using message='Settlement input is invalid'; end if;
  select * into s from public.tavern_saves where id=p_save_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  select * into existing from private.world_settlements where save_id=p_save_id and action_id=p_action_id;
  if found then return jsonb_build_object('settlementId',existing.id,'status',existing.status,'replayed',true,'inputFingerprint',existing.input_fingerprint); end if;
  if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Save revision changed'; end if;
  if s.world_phase<>'open' then raise sqlstate 'PT409' using message='Save is already settling'; end if;
  snapshot:=p_input_snapshot || jsonb_build_object('saveId',p_save_id,'dayNumber',s.current_day,'sourceRevision',s.revision,'inputVersion',p_input_version);
  if octet_length(snapshot::text)>16384 then raise sqlstate 'PT400' using message='Settlement input is too large after server pinning'; end if;
  fingerprint:=encode(extensions.digest(snapshot::text,'sha256'),'hex');
  insert into private.world_settlements(save_id,day_number,source_revision,input_fingerprint,action_id,input_snapshot,input_version,status,deadline_at)
    values(p_save_id,s.current_day,s.revision,fingerprint,p_action_id,snapshot,p_input_version,'queued',clock_timestamp()+interval '120 seconds') returning id into settlement_id;
  foreach kind in array array['snapshot','canon','resident','quest','effects','news','finalize'] loop
    ordinal:=ordinal+1; job_snapshot:=snapshot || jsonb_build_object('jobKind',kind,'ordinal',ordinal);
    if octet_length(job_snapshot::text)>16384 then raise sqlstate 'PT400' using message='Settlement job input is too large after derivation'; end if;
    insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint,input_snapshot,input_version)
      values(settlement_id,ordinal,kind,fingerprint,job_snapshot,p_input_version);
  end loop;
  update public.tavern_saves set world_phase='settling' where id=p_save_id;
  return jsonb_build_object('settlementId',settlement_id,'status','queued','replayed',false,'inputFingerprint',fingerprint,'dayNumber',s.current_day,'sourceRevision',s.revision);
end $$;

create or replace function public.world_settlement_enqueue(p_save_id uuid,p_action_id uuid,p_expected_revision bigint,p_input_snapshot jsonb,p_input_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.world_settlement_assert_service();
  return private.world_settlement_enqueue_core(p_save_id,p_action_id,p_expected_revision,p_input_snapshot,p_input_version);
end $$;

create function public.world_settlement_checkpoint(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_stage text,p_payload jsonb,p_usage jsonb default '{}'::jsonb,p_model text default '',p_prompt_version text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; r jsonb;
begin
  perform private.world_settlement_assert_service();
  if p_stage not in ('proposer','critic','repair','final_critic','digest','validated') or jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_usage)<>'object' or octet_length(p_payload::text)>16384 or octet_length(p_usage::text)>4096 then raise sqlstate 'PT400' using message='Checkpoint is invalid'; end if;
  select result into r from private.world_settlement_worker_receipts where job_id=p_job_id and fence=p_fence and action_kind='checkpoint' and action_key=p_stage;
  if r is not null then return r; end if;
  select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found or s.status<>'processing' or s.fence<>p_fence or s.lease_until<=clock_timestamp() or s.deadline_at<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id and status='processing' for update;
  if not found or not exists(select 1 from private.world_settlement_attempts a where a.job_id=j.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Settlement attempt is not active'; end if;
  r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'fence',p_fence,'stage',p_stage,'status','recorded');
  insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload,usage,model,prompt_version) values(j.id,p_fence,p_stage,p_payload,p_usage,coalesce(p_model,''),coalesce(p_prompt_version,''));
  insert into private.world_settlement_worker_receipts(job_id,fence,action_kind,action_key,result) values(j.id,p_fence,'checkpoint',p_stage,r);
  return r;
end $$;

create function public.world_settlement_safe_result(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_kind text,p_public_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; r jsonb;
begin
  perform private.world_settlement_assert_service();
  if p_kind not in ('no_changes','rejected','skipped') or char_length(trim(coalesce(p_public_digest,''))) not between 1 and 500 then raise sqlstate 'PT400' using message='Safe result is invalid'; end if;
  select result into r from private.world_settlement_worker_receipts where job_id=p_job_id and fence=p_fence and action_kind='safe_result' and action_key=p_kind;
  if r is not null then return r; end if;
  select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found or s.status<>'processing' or s.fence<>p_fence or s.lease_until<=clock_timestamp() or s.deadline_at<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id and status='processing' for update;
  if not found then raise sqlstate 'PT409'; end if;
  r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'kind',p_kind,'status','completed','publicDigest',trim(p_public_digest));
  insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload,usage,model,prompt_version) values(j.id,p_fence,'validated',jsonb_build_object('kind',p_kind,'publicDigest',trim(p_public_digest)),'{}','safe-result','worker-contract-v1') on conflict do nothing;
  insert into private.world_settlement_worker_receipts(job_id,fence,action_kind,action_key,result) values(j.id,p_fence,'safe_result',p_kind,r);
  update private.world_settlements set public_digest=trim(p_public_digest) where id=s.id;
  insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,j.id,'safe:'||j.id::text,jsonb_build_object('kind',p_kind,'digest',trim(p_public_digest))) on conflict do nothing;
  perform public.world_settlement_complete(s.id,j.id,p_fence,jsonb_build_object('kind',p_kind));
  return r;
end $$;

create or replace function public.world_settlement_safe_result(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_kind text,p_public_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; r jsonb; terminal jsonb;
begin
  perform private.world_settlement_assert_service();
  if p_kind not in ('no_changes','rejected','skipped') or char_length(trim(coalesce(p_public_digest,''))) not between 1 and 500 then raise sqlstate 'PT400' using message='Safe result is invalid'; end if;
  select result into r from private.world_settlement_worker_receipts where job_id=p_job_id and fence=p_fence and action_kind='safe_result' and action_key=p_kind;
  if r is not null then return r; end if;
  select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found or s.status<>'processing' or s.fence<>p_fence or s.lease_until<=clock_timestamp() or s.deadline_at<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id and status='processing' for update;
  if not found or not exists(select 1 from private.world_settlement_attempts a where a.job_id=j.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Settlement attempt is not active'; end if;
  r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'kind',p_kind,'status','completed','publicDigest',trim(p_public_digest));
  insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload,usage,model,prompt_version) values(j.id,p_fence,'validated',jsonb_build_object('kind',p_kind,'publicDigest',trim(p_public_digest)),'{}','safe-result','worker-contract-v1') on conflict do nothing;
  insert into private.world_settlement_worker_receipts(job_id,fence,action_kind,action_key,result) values(j.id,p_fence,'safe_result',p_kind,r);
  update private.world_settlements set public_digest=trim(p_public_digest) where id=s.id;
  insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,j.id,'safe:'||j.id::text,jsonb_build_object('kind',p_kind,'digest',trim(p_public_digest))) on conflict do nothing;
  perform public.world_settlement_complete(s.id,j.id,p_fence,jsonb_build_object('kind',p_kind));
  if not exists(select 1 from private.world_settlement_jobs x where x.settlement_id=s.id and x.status in ('queued','processing')) then
    terminal:=jsonb_build_object('settlementId',s.id,'status','completed','publicDigest',trim(p_public_digest),'publicSummary',trim(p_public_digest));
    update private.world_settlements set status='completed',fence=null,lease_until=null,completed_at=clock_timestamp(),terminal_receipt=terminal,public_digest=trim(p_public_digest) where id=s.id;
    update public.tavern_saves set world_phase='open' where id=s.save_id;
    insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,null,'settlement-completed',terminal) on conflict do nothing;
  end if;
  return r;
end $$;

create or replace function public.world_settlement_status(p_save_id uuid,p_settlement_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'dayNumber',s.day_number,'status',s.status,'deadlineAt',s.deadline_at,'failureCode',s.failure_code,'skipReason',s.skip_reason,'publicDigest',s.public_digest,'publicSummary',s.terminal_receipt->>'publicSummary',
    'progress',jsonb_build_object('completed',(select count(*) from private.world_settlement_jobs j where j.settlement_id=s.id and j.status in ('completed','skipped')),'total',(select count(*) from private.world_settlement_jobs j where j.settlement_id=s.id)))
  from private.world_settlements s join public.tavern_saves t on t.id=s.save_id where s.save_id=p_save_id and t.user_id=auth.uid() and (p_settlement_id is null or s.id=p_settlement_id) order by s.created_at desc limit 1
$$;

revoke all on function public.world_settlement_claim(uuid),public.world_settlement_claim_next(),public.world_settlement_enqueue(uuid,uuid,bigint,jsonb,text),public.world_settlement_checkpoint(uuid,uuid,uuid,text,jsonb,jsonb,text,text),public.world_settlement_safe_result(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.world_settlement_claim(uuid),public.world_settlement_claim_next(),public.world_settlement_enqueue(uuid,uuid,bigint,jsonb,text),public.world_settlement_checkpoint(uuid,uuid,uuid,text,jsonb,jsonb,text,text),public.world_settlement_safe_result(uuid,uuid,uuid,text,text) to service_role;
revoke all on function private.world_settlement_claim_v1(uuid),private.world_settlement_enqueue_core(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated,service_role;

commit;
