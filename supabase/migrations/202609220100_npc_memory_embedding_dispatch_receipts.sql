-- Issue #33: never resend an embedding request once a durable dispatch
-- receipt exists.  The receipt is deliberately separate from completion: it
-- records the irreversible pre-provider boundary, while 099 remains the only
-- authority that accepts a vector or terminal provider failure.
begin;

create table private.world_npc_memory_embedding_dispatches (
  job_id uuid primary key references private.world_npc_memory_outbox(id) on delete cascade,
  fence uuid not null,
  profile_id uuid not null references private.world_npc_memory_embedding_profiles(id) on delete restrict,
  source_kind text not null,
  source_id uuid not null,
  source_version bigint not null,
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  input_hash text not null check(input_hash ~ '^[0-9a-f]{64}$'),
  identity_hash text not null check(identity_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique check(char_length(idempotency_key) between 1 and 200),
  state text not null default 'prepared' check(state in ('prepared','dispatched','terminalize_required')),
  prepared_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  check((state='prepared' and dispatched_at is null)
     or (state='dispatched' and dispatched_at is not null)
     or (state='terminalize_required'))
);

create function private.world_npc_memory_embedding_dispatch_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if tg_op='DELETE' and not exists(select 1 from private.world_npc_memory_outbox where id=old.job_id) then
    return old;
  end if;
  if tg_op='UPDATE'
     and old.job_id=new.job_id and old.fence=new.fence and old.profile_id=new.profile_id
     and old.source_kind=new.source_kind and old.source_id=new.source_id
     and old.source_version=new.source_version and old.source_hash=new.source_hash
     and old.input_hash=new.input_hash and old.identity_hash=new.identity_hash
     and old.request_hash=new.request_hash and old.idempotency_key=new.idempotency_key
     and new.prepared_at=old.prepared_at
     and ((old.state='prepared' and new.state='dispatched' and new.dispatched_at is not null)
       or (old.state='prepared' and new.state='terminalize_required' and new.dispatched_at is null)
       or (old.state='dispatched' and new.state='terminalize_required'
           and new.dispatched_at is not distinct from old.dispatched_at)) then
    return new;
  end if;
  raise sqlstate 'PT409' using message='Embedding dispatch receipts are append-only';
end $f$;

create trigger world_npc_memory_embedding_dispatch_guard
before update or delete on private.world_npc_memory_embedding_dispatches
for each row execute function private.world_npc_memory_embedding_dispatch_guard();

create function private.world_npc_memory_embedding_dispatch_assert(p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; s private.world_npc_memory_sources;
  p private.world_npc_memory_embedding_profiles; input jsonb; h text;
begin
  select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or j.processor_kind<>'embedding' or j.status<>'processing'
     or j.fence<>p_fence or j.lease_until<=clock_timestamp()
     or exists(select 1 from private.world_npc_memory_invalidations i where i.job_id=p_job_id and i.fence=p_fence) then
    raise sqlstate 'PT409' using message='Embedding dispatch fence is stale';
  end if;
  select * into p from private.world_npc_memory_embedding_profiles
    where processor_version=j.processor_version and active and invalidated_at is null;
  if not found then raise sqlstate 'PT409' using message='Embedding dispatch profile is stale'; end if;
  select * into s from private.world_npc_memory_sources
    where source_kind=j.source_kind and source_id=j.source_id and source_version=j.source_version;
  if not found or s.save_id<>j.save_id or s.instance_id<>j.instance_id
     or s.source_hash<>j.source_hash or s.ledger_sequence<>j.source_sequence
     or s.disclosure_class='system'
     or private.world_npc_memory_source_hash(j.source_kind,j.source_id)<>j.source_hash then
    raise sqlstate 'PT409' using message='Embedding dispatch source is stale';
  end if;
  input:=private.world_npc_memory_embedding_input(s);
  h:=encode(extensions.digest(private.world_canonical_json(input),'sha256'),'hex');
  if input->'envelope' is null or input->'envelope'='{}'::jsonb then
    raise sqlstate 'PT409' using message='Embedding dispatch input is empty';
  end if;
  return jsonb_build_object(
    'jobId',j.id,'fence',j.fence,'profileId',p.id,'processorVersion',p.processor_version,
    'model',p.model,'dimensions',p.dimensions,'sourceKind',s.source_kind,'sourceId',s.source_id,
    'sourceVersion',s.source_version,'sourceHash',s.source_hash,'input',input,
    'inputText',private.world_canonical_json(input),'inputHash',h
  );
end $f$;

create function private.world_npc_memory_embedding_dispatch_hashes(p_binding jsonb)
returns jsonb language sql stable security definer set search_path='' as $f$
  select jsonb_build_object(
    'identityHash',encode(extensions.digest(private.world_canonical_json(jsonb_build_object(
      'jobId',p_binding->'jobId','fence',p_binding->'fence','profileId',p_binding->'profileId',
      'processorVersion',p_binding->'processorVersion','model',p_binding->'model',
      'dimensions',p_binding->'dimensions','sourceKind',p_binding->'sourceKind',
      'sourceId',p_binding->'sourceId','sourceVersion',p_binding->'sourceVersion',
      'sourceHash',p_binding->'sourceHash','inputHash',p_binding->'inputHash')),'sha256'),'hex'),
    'requestHash',encode(extensions.digest(private.world_canonical_json(jsonb_build_object(
      'model',p_binding->'model','input',p_binding->'inputText',
      'dimensions',p_binding->'dimensions','encoding_format','float')),'sha256'),'hex')
  )
$f$;

create function public.world_npc_memory_embedding_prepare_dispatch(p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare b jsonb; h jsonb; r private.world_npc_memory_embedding_dispatches; created boolean:=false;
begin
  perform private.world_settlement_assert_service();
  b:=private.world_npc_memory_embedding_dispatch_assert(p_job_id,p_fence);
  h:=private.world_npc_memory_embedding_dispatch_hashes(b);
  insert into private.world_npc_memory_embedding_dispatches(
    job_id,fence,profile_id,source_kind,source_id,source_version,source_hash,input_hash,
    identity_hash,request_hash,idempotency_key
  ) values (
    (b->>'jobId')::uuid,(b->>'fence')::uuid,(b->>'profileId')::uuid,b->>'sourceKind',
    (b->>'sourceId')::uuid,(b->>'sourceVersion')::bigint,b->>'sourceHash',b->>'inputHash',
    h->>'identityHash',h->>'requestHash','npc-memory-embedding:'||(b->>'jobId')||':'||(b->>'fence')
  ) on conflict(job_id) do nothing;
  created:=found;
  select * into r from private.world_npc_memory_embedding_dispatches where job_id=(b->>'jobId')::uuid;
  if r.fence<>(b->>'fence')::uuid or r.profile_id<>(b->>'profileId')::uuid
     or r.source_kind<>b->>'sourceKind' or r.source_id<>(b->>'sourceId')::uuid
     or r.source_version<>(b->>'sourceVersion')::bigint or r.source_hash<>b->>'sourceHash'
     or r.input_hash<>b->>'inputHash' or r.identity_hash<>h->>'identityHash'
     or r.request_hash<>h->>'requestHash' then
    raise sqlstate 'PT409' using message='Embedding dispatch receipt is ambiguous';
  end if;
  -- A receipt is the irreversible pre-provider boundary.  Repeating prepare
  -- may prove the same request identity, but it must never hand a restarted
  -- worker a second authorization to send it.
  if not created then
    if r.state in ('prepared','dispatched') then
      update private.world_npc_memory_embedding_dispatches set state='terminalize_required'
        where job_id=r.job_id;
    end if;
    return jsonb_build_object('directive','fail_only','reason','receipt_already_exists');
  end if;
  return jsonb_build_object(
    'directive','dispatch_authorized','idempotencyKey',r.idempotency_key,
    'identityHash',r.identity_hash,'requestHash',r.request_hash,'state',r.state,
    'profileId',b->'profileId','model',b->'model','dimensions',b->'dimensions',
    'inputHash',b->'inputHash','inputText',b->'inputText',
    'encodingFormat','float'
  );
end $f$;

create function public.world_npc_memory_embedding_mark_dispatched(p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare b jsonb; h jsonb; r private.world_npc_memory_embedding_dispatches;
begin
  perform private.world_settlement_assert_service();
  b:=private.world_npc_memory_embedding_dispatch_assert(p_job_id,p_fence);
  h:=private.world_npc_memory_embedding_dispatch_hashes(b);
  select * into r from private.world_npc_memory_embedding_dispatches
    where job_id=(b->>'jobId')::uuid for update;
  if not found or r.fence<>(b->>'fence')::uuid or r.profile_id<>(b->>'profileId')::uuid
     or r.source_kind<>b->>'sourceKind' or r.source_id<>(b->>'sourceId')::uuid
     or r.source_version<>(b->>'sourceVersion')::bigint or r.source_hash<>b->>'sourceHash'
     or r.input_hash<>b->>'inputHash' or r.identity_hash<>h->>'identityHash'
     or r.request_hash<>h->>'requestHash' or r.state='terminalize_required' then
    raise sqlstate 'PT409' using message='Embedding dispatch receipt is unavailable';
  end if;
  if r.state='prepared' then
    update private.world_npc_memory_embedding_dispatches set state='dispatched',dispatched_at=clock_timestamp()
      where job_id=r.job_id;
    return jsonb_build_object('directive','dispatch_once','idempotencyKey',r.idempotency_key);
  end if;
  -- A repeated mark is evidence of restart/crash ambiguity, never authority
  -- to perform another provider call.
  if r.state='dispatched' then
    update private.world_npc_memory_embedding_dispatches set state='terminalize_required'
      where job_id=r.job_id;
  end if;
  return jsonb_build_object('directive','fail_only','reason','receipt_already_dispatched');
end $f$;

-- The worker must send the byte-for-byte canonical input returned here.  Keep
-- this additive override close to the receipt contract so its request hash
-- cannot drift from the externally dispatched body.
create or replace function public.world_npc_memory_embedding_plan(p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare j private.world_npc_memory_outbox; s private.world_npc_memory_sources; p private.world_npc_memory_embedding_profiles; input jsonb; h text;
begin
  perform private.world_settlement_assert_service();
  select * into j from private.world_npc_memory_outbox where id=p_job_id for update;
  if not found or j.processor_kind<>'embedding' or j.status<>'processing' or j.fence<>p_fence or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Embedding work fence is stale'; end if;
  select * into p from private.world_npc_memory_embedding_profiles where processor_version=j.processor_version and active and invalidated_at is null;
  if not found then raise sqlstate 'PT409' using message='Embedding profile is no longer active'; end if;
  select * into s from private.world_npc_memory_sources where source_kind=j.source_kind and source_id=j.source_id and source_version=j.source_version;
  if not found or s.save_id<>j.save_id or s.instance_id<>j.instance_id or s.source_hash<>j.source_hash or s.ledger_sequence<>j.source_sequence or s.disclosure_class='system' or private.world_npc_memory_source_hash(j.source_kind,j.source_id)<>j.source_hash then raise sqlstate 'PT409' using message='Embedding source is stale or unavailable'; end if;
  input:=private.world_npc_memory_embedding_input(s); h:=encode(extensions.digest(private.world_canonical_json(input),'sha256'),'hex');
  if input->'envelope' is null or input->'envelope'='{}'::jsonb then raise sqlstate 'PT409' using message='Embedding input is empty'; end if;
  return jsonb_build_object('jobId',j.id,'fence',j.fence,'profile',jsonb_build_object('id',p.id,'processorVersion',p.processor_version,'model',p.model,'dimensions',p.dimensions),'source',jsonb_build_object('kind',s.source_kind,'id',s.source_id,'version',s.source_version,'hash',s.source_hash,'ledgerSequence',s.ledger_sequence,'disclosureClass',s.disclosure_class),'input',input,'inputText',private.world_canonical_json(input),'inputHash',h);
end $f$;

create function public.world_npc_memory_embedding_recover_dispatch(p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare b jsonb; r private.world_npc_memory_embedding_dispatches;
begin
  perform private.world_settlement_assert_service();
  b:=private.world_npc_memory_embedding_dispatch_assert(p_job_id,p_fence);
  select * into r from private.world_npc_memory_embedding_dispatches
    where job_id=(b->>'jobId')::uuid for update;
  if not found then return jsonb_build_object('directive','prepare_required','reason','no_receipt'); end if;
  if r.state in ('prepared','dispatched') then
    update private.world_npc_memory_embedding_dispatches set state='terminalize_required'
      where job_id=r.job_id;
  end if;
  if r.fence=(b->>'fence')::uuid then
    return jsonb_build_object('directive','fail_only','reason','current_fence_receipt_exists','receiptState','terminalize_required');
  end if;
  return jsonb_build_object('directive','fail_only','reason','prior_fence_receipt_exists',
    'priorFence',r.fence,'receiptState','terminalize_required');
end $f$;

revoke all on table private.world_npc_memory_embedding_dispatches from public,anon,authenticated,service_role;
revoke all on function private.world_npc_memory_embedding_dispatch_guard(),
  private.world_npc_memory_embedding_dispatch_assert(uuid,uuid),
  private.world_npc_memory_embedding_dispatch_hashes(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.world_npc_memory_embedding_prepare_dispatch(uuid,uuid),
  public.world_npc_memory_embedding_mark_dispatched(uuid,uuid),
  public.world_npc_memory_embedding_recover_dispatch(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.world_npc_memory_embedding_prepare_dispatch(uuid,uuid),
  public.world_npc_memory_embedding_mark_dispatched(uuid,uuid),
  public.world_npc_memory_embedding_recover_dispatch(uuid,uuid) to service_role;
commit;
