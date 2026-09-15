-- Gate H: server-owned canonical event admission and safe morning news.
begin;

create table private.world_canonical_event_templates (
  template_key text primary key check(template_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  allowed_kinds text[] not null,
  source_version text not null default 'primitive-registry-v1'
);
insert into private.world_canonical_event_templates(template_key,allowed_kinds) values
 ('market-day',array['npc','location','faction','item','world_event']),
 ('storm-front',array['npc','location','faction','item','world_event']),
 ('road-closure',array['npc','location','faction','item','world_event']),
 ('festival-arrival',array['npc','location','faction','item','world_event']);

create table private.world_canon_commit_receipts (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  proposal_fingerprint text not null check(proposal_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete restrict,
  result jsonb not null, created_at timestamptz not null default clock_timestamp(),
  check(jsonb_typeof(result)='object')
);
create table private.world_public_discoveries (
  id uuid primary key default extensions.gen_random_uuid(), settlement_id uuid not null references private.world_settlements(id) on delete cascade,
  job_id uuid not null unique references private.world_settlement_jobs(id) on delete cascade,
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null, title text not null check(char_length(title) between 1 and 120),
  summary text not null check(char_length(summary) between 1 and 500), created_at timestamptz not null default clock_timestamp(),
  unique(settlement_id,canonical_entity_id)
);
create table private.world_canon_news_receipts (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  digest text not null check(char_length(digest) between 1 and 500), result jsonb not null, created_at timestamptz not null default clock_timestamp(),
  check(jsonb_typeof(result)='object')
);
create trigger world_canon_commit_receipt_append_only before update or delete on private.world_canon_commit_receipts for each row execute function private.world_history_append_only();
create trigger world_public_discovery_append_only before update or delete on private.world_public_discoveries for each row execute function private.world_history_append_only();
create trigger world_canon_news_receipt_append_only before update or delete on private.world_canon_news_receipts for each row execute function private.world_history_append_only();
create function private.world_public_discovery_scope_guard() returns trigger language plpgsql set search_path='' as $$
declare j private.world_settlement_jobs; s private.world_settlements; e private.world_canonical_entities;
begin
 select * into j from private.world_settlement_jobs where id=new.job_id;
 select * into s from private.world_settlements where id=new.settlement_id;
 select * into e from private.world_canonical_entities where id=new.canonical_entity_id;
 if j.id is null or s.id is null or e.id is null or j.settlement_id<>new.settlement_id or j.job_kind<>'canon' or s.save_id<>new.save_id or s.day_number<>new.day_number or e.save_id<>new.save_id then
   raise exception using errcode='23514',message='Canonical discovery must match its canon job, settlement, save, and day';
 end if;
 return new;
end $$;
create trigger world_public_discovery_scope before insert or update on private.world_public_discoveries for each row execute function private.world_public_discovery_scope_guard();
revoke all on private.world_canonical_event_templates,private.world_canon_commit_receipts,private.world_public_discoveries,private.world_canon_news_receipts from public,anon,authenticated,service_role;

-- 045 created a small canon-job envelope.  This transaction-only finalization
-- is the sole allowed change before the job is observable by a worker.
create or replace function private.world_settlement_job_frozen_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.settlement_id<>old.settlement_id or new.ordinal<>old.ordinal or new.job_kind<>old.job_kind or new.subject_instance_id is distinct from old.subject_instance_id or new.input_version is distinct from old.input_version then raise exception using errcode='55000',message='Settlement job input is immutable'; end if;
 if new.input_fingerprint is distinct from old.input_fingerprint or new.input_snapshot is distinct from old.input_snapshot then
   if not (old.job_kind='canon' and old.status='queued' and new.status='queued' and not exists(select 1 from private.world_settlement_attempts where job_id=old.id) and new.input_snapshot ? 'worldSnapshot') then raise exception using errcode='55000',message='Settlement job input is immutable'; end if;
 end if;
 return new;
end $$;

alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_canon_event;
alter function public.advance_tavern_day_before_canon_event(uuid,uuid,bigint) set schema private;
create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; settlement private.world_settlements; snapshot jsonb; job_snapshot jsonb;
begin
 result:=private.advance_tavern_day_before_canon_event(p_save_id,p_action_id,p_expected_revision);
 if not (result ? 'worldSettlement') then return result; end if;
 select * into settlement from private.world_settlements where id=(result#>>'{worldSettlement,settlementId}')::uuid;
 if found then
   snapshot:=jsonb_build_object('saveId',settlement.save_id,'dayNumber',settlement.day_number,'sourceRevision',settlement.source_revision,'registeredTemplateKeys',(select coalesce(jsonb_agg(template_key order by template_key),'[]'::jsonb) from private.world_canonical_event_templates),'entityKinds',(select coalesce(jsonb_object_agg(entity_id,entity_kind order by entity_id),'{}'::jsonb) from (select key as entity_id,value as entity_kind from jsonb_each_text(private.world_day_close_snapshot(settlement.save_id,settlement.day_number+1)->'entityKinds') order by key limit 64) x));
   update private.world_settlement_jobs set input_snapshot=input_snapshot||jsonb_build_object('worldSnapshot',snapshot,'canonEventVersion','world-canon-event-v1'),input_fingerprint=encode(extensions.digest((input_snapshot||jsonb_build_object('worldSnapshot',snapshot,'canonEventVersion','world-canon-event-v1'))::text,'sha256'),'hex') where settlement_id=settlement.id and job_kind='canon' and status='queued' and not exists(select 1 from private.world_settlement_attempts a where a.job_id=private.world_settlement_jobs.id);
 end if;
 return result;
end $$;

create function private.world_canon_event_valid(p_event jsonb,p_snapshot jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare ids jsonb; payload jsonb; template text; participant text;
begin
 if jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>4096 or (select count(*) from jsonb_object_keys(p_event)) not between 7 and 8 or not (p_event ?& array['version','kind','templateKey','participantEntityIds','title','summary','payload']) or (p_event-'version'-'kind'-'templateKey'-'participantEntityIds'-'title'-'summary'-'payload'-'reuseKey')<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(p_event->'version')<>'string' or jsonb_typeof(p_event->'kind')<>'string' or jsonb_typeof(p_event->'templateKey')<>'string' or jsonb_typeof(p_event->'title')<>'string' or jsonb_typeof(p_event->'summary')<>'string' or p_event->>'version'<>'world-canon-event-v1' or p_event->>'kind'<>'world_event' or char_length(btrim(coalesce(p_event->>'title',''))) not between 1 and 120 or char_length(btrim(coalesce(p_event->>'summary',''))) not between 1 and 500 then return false; end if;
 template:=p_event->>'templateKey'; if not exists(select 1 from private.world_canonical_event_templates where template_key=template) or not ((p_snapshot->'registeredTemplateKeys') ? template) then return false; end if;
 ids:=p_event->'participantEntityIds'; payload:=p_event->'payload';
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids) not between 1 and 8 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string') or jsonb_typeof(payload)<>'object' or (select count(*) from jsonb_object_keys(payload))<>3 or not (payload ?& array['template','participants','visibility']) or (payload-'template'-'participants'-'visibility')<>'{}'::jsonb or jsonb_typeof(payload->'template')<>'string' or jsonb_typeof(payload->'visibility')<>'string' or payload->>'template'<>template or payload->'participants'<>ids or payload->>'visibility'<>'public' then return false; end if;
 if (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct value) from jsonb_array_elements_text(ids)) then return false; end if;
 for participant in select value from jsonb_array_elements_text(ids) loop if not (p_snapshot->'entityKinds' ? participant) or not exists(select 1 from private.world_canonical_event_templates where template_key=template and (p_snapshot->'entityKinds'->>participant)=any(allowed_kinds)) then return false; end if; end loop;
 if p_event ? 'reuseKey' and (jsonb_typeof(p_event->'reuseKey')<>'string' or p_event->>'reuseKey' !~ '^[a-z][a-z0-9-]{1,63}$') then return false; end if;
 return true;
end $$;

create function public.world_settlement_commit_canon(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare settlement private.world_settlements; job private.world_settlement_jobs; snapshot jsonb; fingerprint text; reuse_key text; generated_key text; entity private.world_canonical_entities; output jsonb; prior private.world_canon_commit_receipts; reused boolean:=false; stored_fingerprint text;
begin
 perform private.world_settlement_assert_service();
 fingerprint:=encode(extensions.digest(private.world_canonical_json(p_event),'sha256'),'hex');
 select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id;
 if not found then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
 select * into prior from private.world_canon_commit_receipts where job_id=p_job_id;
 if found then if prior.proposal_fingerprint<>fingerprint then raise sqlstate 'PT409'; end if; return prior.result; end if;
 select * into settlement from private.world_settlements where id=p_settlement_id for update;
 select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id for update;
 if not found or job.job_kind<>'canon' or job.status<>'processing' or settlement.status<>'processing' or settlement.fence<>p_fence or settlement.lease_until<=clock_timestamp() or not exists(select 1 from private.world_settlement_attempts where job_id=job.id and fence=p_fence and status='processing' and lease_until>clock_timestamp()) then raise sqlstate 'PT409'; end if;
 snapshot:=job.input_snapshot->'worldSnapshot';
 if snapshot is null or snapshot->>'saveId'<>settlement.save_id::text or (snapshot->>'dayNumber')::integer<>settlement.day_number or (snapshot->>'sourceRevision')::bigint<>settlement.source_revision or not private.world_canon_event_valid(p_event,snapshot) then raise sqlstate 'PT400'; end if;
 reuse_key:=nullif(p_event->>'reuseKey','');
 if reuse_key is not null and reuse_key !~ '^[a-z][a-z0-9-]{1,63}$' then raise sqlstate 'PT400'; end if;
 generated_key:=coalesce(reuse_key,'event-'||substr(fingerprint,1,24));
 select * into entity from private.world_canonical_entities where save_id=settlement.save_id and entity_kind='world_event' and world_canonical_entities.entity_key=generated_key for update;
 if not found then
   if (select count(*) from private.world_canonical_entities where save_id=settlement.save_id and origin='procedural' and lifecycle='active')>=150 then raise sqlstate 'PT409' using message='Generated entity limit reached'; end if;
   insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
   values(settlement.save_id,'world_event',generated_key,'procedural','world-canon-event-v1',
     jsonb_build_object('proposalFingerprint',fingerprint,'proposal',p_event,'title',btrim(p_event ->> 'title'),'summary',btrim(p_event ->> 'summary')),
     'active',settlement.day_number) returning * into entity;
   insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values(entity.id,'created',jsonb_build_object('fingerprint',fingerprint),'world-canon-event-v1');
 else
   reused:=true;
   stored_fingerprint:=entity.payload ->> 'proposalFingerprint';
   if stored_fingerprint is distinct from fingerprint then raise sqlstate 'PT409' using message='Reuse key conflicts with an immutable event'; end if;
 end if;
 output:=jsonb_build_object('status','completed','rulesVersion','world-canon-event-v1','settlementId',settlement.id,'jobId',job.id,'proposalFingerprint',fingerprint,'canonicalEventId',entity.id,'reused',reused,'version','world-canon-event-v1','kind','world_event','templateKey',p_event ->> 'templateKey','participantEntityIds',p_event -> 'participantEntityIds','title',btrim(p_event ->> 'title'),'summary',btrim(p_event ->> 'summary')) || case when p_event ? 'reuseKey' then jsonb_build_object('reuseKey',p_event ->> 'reuseKey') else '{}'::jsonb end;
 insert into private.world_public_discoveries(settlement_id,job_id,canonical_entity_id,save_id,day_number,title,summary) values(settlement.id,job.id,entity.id,settlement.save_id,settlement.day_number,btrim(p_event ->> 'title'),btrim(p_event ->> 'summary'));
 insert into private.world_canon_commit_receipts(job_id,proposal_fingerprint,canonical_entity_id,result) values(job.id,fingerprint,entity.id,output);
 perform public.world_settlement_complete(settlement.id,job.id,p_fence,jsonb_build_object('kind','canon','canonicalEventId',entity.id));
 return output;
end $$;

create function public.world_settlement_complete_news(p_settlement_id uuid,p_job_id uuid,p_fence uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare settlement private.world_settlements; job private.world_settlement_jobs; digest text; output jsonb;
begin
 perform private.world_settlement_assert_service();
 if not exists(select 1 from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id) then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
 select result into output from private.world_canon_news_receipts where job_id=p_job_id; if output is not null then return output; end if;
 select * into settlement from private.world_settlements where id=p_settlement_id for update; select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id for update;
 if not found or job.job_kind<>'news' or job.status<>'processing' or settlement.status<>'processing' or settlement.fence<>p_fence or settlement.lease_until<=clock_timestamp() or not exists(select 1 from private.world_settlement_attempts a where a.job_id=job.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409'; end if;
 select left(coalesce(string_agg(part,' ' order by sort_key),'The day settled without new world changes.'),500) into digest from (
  select ('News: '||title||'. '||summary) part, 'c'||id::text sort_key from private.world_public_discoveries where settlement_id=settlement.id
  union all select ('Resident: '||coalesce(disposition->>'summary','changed')) part, 'r'||job_id::text from private.resident_evolution_entries where job_id in (select id from private.world_settlement_jobs where settlement_id=settlement.id)
 ) safe;
 output:=jsonb_build_object('status','completed','rulesVersion','world-canon-event-v1','settlementId',settlement.id,'jobId',job.id,'morningNews',digest);
 insert into private.world_canon_news_receipts(job_id,digest,result) values(job.id,digest,output);
 update private.world_settlements set public_digest=digest where id=settlement.id;
 perform public.world_settlement_complete(settlement.id,job.id,p_fence,jsonb_build_object('kind','news','morningNews',digest));
 return output;
end $$;

-- The final safe worker result must preserve curated morning news instead of
-- replacing it with its generic completion message.
create or replace function public.world_settlement_safe_result(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_kind text,p_public_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; r jsonb; terminal jsonb; effective_digest text;
begin
 perform private.world_settlement_assert_service();
 if p_kind not in ('no_changes','rejected','skipped') or char_length(trim(coalesce(p_public_digest,''))) not between 1 and 500 then raise sqlstate 'PT400' using message='Safe result is invalid'; end if;
 if not exists(select 1 from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id) then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
 select result into r from private.world_settlement_worker_receipts where job_id=p_job_id and fence=p_fence and action_kind='safe_result' and action_key=p_kind;
 if r is not null then return r; end if;
 select * into s from private.world_settlements where id=p_settlement_id for update;
 if not found or s.status<>'processing' or s.fence<>p_fence or s.lease_until<=clock_timestamp() or s.deadline_at<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
 select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id and status='processing' for update;
 if not found or not exists(select 1 from private.world_settlement_attempts a where a.job_id=j.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Settlement attempt is not active'; end if;
 select n.digest into effective_digest from private.world_canon_news_receipts n join private.world_settlement_jobs nj on nj.id=n.job_id where nj.settlement_id=s.id order by n.created_at desc limit 1;
 effective_digest:=coalesce(effective_digest,trim(p_public_digest));
 r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'kind',p_kind,'status','completed','publicDigest',effective_digest);
 insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload,usage,model,prompt_version) values(j.id,p_fence,'validated',jsonb_build_object('kind',p_kind,'publicDigest',effective_digest),'{}','safe-result','worker-contract-v1') on conflict do nothing;
 insert into private.world_settlement_worker_receipts(job_id,fence,action_kind,action_key,result) values(j.id,p_fence,'safe_result',p_kind,r);
 update private.world_settlements set public_digest=effective_digest where id=s.id;
 insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,j.id,'safe:'||j.id::text,jsonb_build_object('kind',p_kind,'digest',effective_digest)) on conflict do nothing;
 perform public.world_settlement_complete(s.id,j.id,p_fence,jsonb_build_object('kind',p_kind));
 if not exists(select 1 from private.world_settlement_jobs x where x.settlement_id=s.id and x.status in ('queued','processing')) then
   terminal:=jsonb_build_object('settlementId',s.id,'status','completed','publicDigest',effective_digest,'publicSummary',effective_digest);
   update private.world_settlements set status='completed',fence=null,lease_until=null,completed_at=clock_timestamp(),terminal_receipt=terminal,public_digest=effective_digest where id=s.id;
   update public.tavern_saves set world_phase='open' where id=s.save_id;
   insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,null,'settlement-completed',terminal) on conflict do nothing;
 end if;
 return r;
end $$;

create or replace function public.world_settlement_status(p_save_id uuid,p_settlement_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'dayNumber',s.day_number,'status',s.status,'deadlineAt',s.deadline_at,'failureCode',s.failure_code,'skipReason',s.skip_reason,'publicDigest',s.public_digest,'publicSummary',s.terminal_receipt->>'publicSummary','morningNews',(select n.digest from private.world_canon_news_receipts n join private.world_settlement_jobs j on j.id=n.job_id where j.settlement_id=s.id),'progress',jsonb_build_object('completed',(select count(*) from private.world_settlement_jobs j where j.settlement_id=s.id and j.status in ('completed','skipped')),'total',(select count(*) from private.world_settlement_jobs j where j.settlement_id=s.id))) from private.world_settlements s join public.tavern_saves t on t.id=s.save_id where s.save_id=p_save_id and t.user_id=auth.uid() and (p_settlement_id is null or s.id=p_settlement_id) order by s.created_at desc limit 1
$$;

revoke all on function private.world_canon_event_valid(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.world_settlement_commit_canon(uuid,uuid,uuid,jsonb),public.world_settlement_complete_news(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_canon(uuid,uuid,uuid,jsonb),public.world_settlement_complete_news(uuid,uuid,uuid) to service_role;
revoke all on function public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
commit;
