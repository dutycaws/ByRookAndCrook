-- Typed authoring-workspace read model and draft-pinned sandbox conversations.
begin;

alter table private.npc_assistance_events
  add column if not exists source_revision bigint not null default 0;

alter table private.npc_sandboxes
  add column if not exists frozen_sheet jsonb,
  add column if not exists lifecycle text not null default 'active'
    check (lifecycle in ('active','invalidated','completed'));

create table if not exists private.npc_sandbox_turns (
  id uuid primary key default extensions.gen_random_uuid(),
  sandbox_id uuid not null references private.npc_sandboxes(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  role text not null check (role in ('keeper','npc')),
  content text not null check (char_length(content) between 1 and 4000),
  status text not null default 'completed' check (status in ('pending','completed','failed')),
  job_id uuid references private.npc_generation_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(sandbox_id, ordinal)
);

create unique index if not exists npc_one_active_sandbox_per_draft_revision
  on private.npc_sandboxes(draft_id,based_on_revision) where invalidated_at is null;
create unique index if not exists npc_one_pending_sandbox_turn
  on private.npc_sandbox_turns(sandbox_id) where status='pending';

alter table private.npc_retirement_requests add column if not exists decision_reason text;

create unique index if not exists npc_one_open_retirement_request
  on private.npc_retirement_requests(npc_id) where status='open';

create or replace function private.npc_author_invalidate_sandboxes(p_draft_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update private.npc_sandboxes
  set invalidated_at=coalesce(invalidated_at,now()), lifecycle='invalidated', updated_at=now()
  where draft_id=p_draft_id and invalidated_at is null;
end $$;

-- Retain the old save contract while making the lifecycle state truthful.
create or replace function public.npc_author_save(p_npc_id uuid,p_expected_revision bigint,p_sheet jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts;
begin
  perform private.assert_npc_author(p_sheet,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may edit this NPC'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found then raise sqlstate 'PT409' using message='Open draft unavailable'; end if;
  if d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.validate_npc_sheet_v2(p_sheet);
  update private.npc_drafts set sheet=p_sheet,revision=revision+1,updated_at=now() where id=d.id;
  perform private.npc_author_invalidate_sandboxes(d.id);
  update private.npc_identities set normalized_name=lower(regexp_replace(trim(p_sheet#>>'{identity,name}'),'\\s+',' ','g')),rating=p_sheet->>'rating',updated_at=now() where id=p_npc_id;
  return jsonb_build_object('kind','saved','npcId',p_npc_id,'draftId',d.id,'revision',p_expected_revision+1,'sandboxInvalidated',true);
end $$;

create or replace function public.npc_author_assistance_disposition(p_event_id uuid,p_expected_revision bigint,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.npc_assistance_events; d private.npc_drafts; proposed jsonb; candidate jsonb;
begin
  select * into e from private.npc_assistance_events where id=p_event_id for update;
  if not found or e.requested_by<>auth.uid() then raise sqlstate 'PT404'; end if;
  d:=private.npc_assert_draft_owner(e.npc_id,p_expected_revision);
  if e.draft_id<>d.id or e.disposition<>'proposed' then raise sqlstate 'PT409' using message='Assistance is no longer actionable'; end if;
  if e.source_revision<>d.revision then raise sqlstate 'PT409' using message='Assistance was created for an older draft revision'; end if;
  if p_accept then
    proposed:=coalesce(e.proposal->'replacement',e.proposal);
    if proposed is null or proposed=(d.sheet#>array[e.section_path]) then raise sqlstate 'PT422' using message='Assistance has no material replacement'; end if;
    candidate:=jsonb_set(d.sheet,array[e.section_path],proposed,true);
    perform private.validate_npc_sheet_v2(candidate);
    update private.npc_drafts set sheet=candidate,revision=revision+1,updated_at=now() where id=d.id;
    perform private.npc_author_invalidate_sandboxes(d.id);
  end if;
  update private.npc_assistance_events set disposition=case when p_accept then 'accepted' else 'rejected' end,decided_at=now() where id=e.id;
  perform private.npc_governance_log(e.npc_id,case when p_accept then 'assistance_accepted' else 'assistance_rejected' end,e.id,jsonb_build_object('sectionPath',e.section_path));
  return jsonb_build_object('kind',case when p_accept then 'assistance_applied' else 'assistance_discarded' end,'eventId',e.id,'accepted',p_accept,'revision',p_expected_revision + case when p_accept then 1 else 0 end,'sandboxInvalidated',p_accept);
end $$;

create or replace function public.npc_author_request_assistance(p_npc_id uuid,p_expected_revision bigint,p_section_path text,p_instruction text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; j jsonb; e uuid;
begin
  if not private.npc_allowed_section(p_section_path) or length(trim(p_instruction)) not between 1 and 2000 then
    raise sqlstate 'PT400' using message='Choose one editable section and a concise instruction';
  end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  j:=public.npc_author_reserve_call(p_npc_id,'assist',jsonb_build_object('sectionPath',p_section_path,'instruction',p_instruction,'draftRevision',d.revision));
  insert into private.npc_assistance_events(npc_id,draft_id,requested_by,section_path,provider,model,prompt_version,content_hash,source_revision)
  values(p_npc_id,d.id,auth.uid(),p_section_path,'openai','authoring-assist','authoring-assist-v1',encode(extensions.digest((d.sheet#>array[p_section_path])::text,'sha256'),'hex'),d.revision) returning id into e;
  update private.npc_generation_jobs set request=request || jsonb_build_object('assistanceEventId',e) where id=(j->>'jobId')::uuid;
  perform private.npc_governance_log(p_npc_id,'assistance_requested',e,jsonb_build_object('sectionPath',p_section_path,'sourceRevision',d.revision));
  return j || jsonb_build_object('kind','assistance_requested','assistanceEventId',e,'sourceRevision',d.revision);
end $$;

-- A session freezes the full sheet. A separate send operation gives the UI a
-- synchronous, unambiguous pending state and keeps one message in flight.
create function public.npc_author_sandbox_start(p_npc_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; s private.npc_sandboxes;
begin
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  select * into s from private.npc_sandboxes where draft_id=d.id and based_on_revision=d.revision and invalidated_at is null for update;
  if not found then
    insert into private.npc_sandboxes(npc_id,draft_id,owner_id,based_on_revision,frozen_sheet,state,lifecycle)
    values(p_npc_id,d.id,auth.uid(),d.revision,d.sheet,'{}'::jsonb,'active') returning * into s;
    perform private.npc_governance_log(p_npc_id,'sandbox_started',s.id,jsonb_build_object('revision',d.revision));
  end if;
  return jsonb_build_object('kind','sandbox_started','sandboxId',s.id,'draftRevision',s.based_on_revision,'state','ready','frozenSheet',s.frozen_sheet);
end $$;

create function public.npc_author_sandbox_send(p_sandbox_id uuid,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.npc_sandboxes; d private.npc_drafts; ord integer; turn_id uuid; job jsonb;
begin
  if length(trim(p_message)) not between 1 and 2000 then raise sqlstate 'PT400' using message='Sandbox message is required'; end if;
  select * into s from private.npc_sandboxes where id=p_sandbox_id for update;
  if not found or s.owner_id<>auth.uid() or not private.npc_is_owner(s.npc_id) then raise sqlstate 'PT404'; end if;
  if s.invalidated_at is not null then raise sqlstate 'PT409' using message='This sandbox belongs to an older draft revision'; end if;
  select * into d from private.npc_drafts where id=s.draft_id and state='open' for update;
  if not found or d.revision<>s.based_on_revision then raise sqlstate 'PT409' using message='This sandbox belongs to an older draft revision'; end if;
  if exists(select 1 from private.npc_sandbox_turns where sandbox_id=s.id and status='pending') then raise sqlstate 'PT409' using message='Wait for the current sandbox reply'; end if;
  select coalesce(max(ordinal),0)+1 into ord from private.npc_sandbox_turns where sandbox_id=s.id;
  insert into private.npc_sandbox_turns(sandbox_id,ordinal,role,content,status) values(s.id,ord,'keeper',p_message,'pending') returning id into turn_id;
  job:=public.npc_author_reserve_call(s.npc_id,'sandbox',jsonb_build_object('sandboxId',s.id,'turnId',turn_id,'message',p_message,'draftRevision',s.based_on_revision));
  update private.npc_sandbox_turns set job_id=(job->>'jobId')::uuid where id=turn_id;
  update private.npc_sandboxes set updated_at=now() where id=s.id;
  return job || jsonb_build_object('kind','sandbox_pending','sandboxId',s.id,'turnId',turn_id,'status','pending');
end $$;

create or replace function public.npc_author_sandbox_complete(p_job_id uuid,p_reply text,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs; s private.npc_sandboxes; keeper private.npc_sandbox_turns; next_ordinal integer;
begin
  perform private.npc_assert_service();
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='sandbox' for update;
  if not found or j.status not in ('queued','running') then raise sqlstate 'PT409'; end if;
  select * into s from private.npc_sandboxes where id=(j.request#>>'{payload,sandboxId}')::uuid for update;
  select * into keeper from private.npc_sandbox_turns where id=(j.request#>>'{payload,turnId}')::uuid and sandbox_id=s.id for update;
  if p_error_code is null and length(trim(coalesce(p_reply,''))) not between 1 and 4000 then raise sqlstate 'PT422'; end if;
  update private.npc_generation_jobs set status=case when p_error_code is null then 'completed' else 'failed' end,result=jsonb_build_object('reply',p_reply),error_code=p_error_code,completed_at=now() where id=p_job_id;
  if keeper.id is not null then
    update private.npc_sandbox_turns set status=case when p_error_code is null then 'completed' else 'failed' end,completed_at=now() where id=keeper.id;
    if p_error_code is null and s.invalidated_at is null then
      select coalesce(max(ordinal),0)+1 into next_ordinal from private.npc_sandbox_turns where sandbox_id=s.id;
      insert into private.npc_sandbox_turns(sandbox_id,ordinal,role,content,status,completed_at) values(s.id,next_ordinal,'npc',p_reply,'completed',now());
    end if;
  end if;
  update private.npc_sandboxes set updated_at=now(),lifecycle=case when invalidated_at is null then lifecycle else 'invalidated' end where id=s.id;
end $$;

create or replace function public.npc_author_sandbox_status(p_sandbox_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.npc_sandboxes;
begin
  select * into s from private.npc_sandboxes where id=p_sandbox_id;
  if not found or s.owner_id<>auth.uid() or not private.npc_is_owner(s.npc_id) then raise sqlstate 'PT404'; end if;
  return jsonb_build_object('sandboxId',s.id,'draftRevision',s.based_on_revision,'frozenSheet',s.frozen_sheet,'invalidatedAt',s.invalidated_at,'state',case when s.invalidated_at is null then 'active' else 'invalidated' end,
    'pending',exists(select 1 from private.npc_sandbox_turns where sandbox_id=s.id and status='pending'),
    'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ordinal',t.ordinal,'role',t.role,'content',t.content,'status',t.status,'createdAt',t.created_at,'completedAt',t.completed_at,'jobId',t.job_id) order by t.ordinal),'[]'::jsonb) from private.npc_sandbox_turns t where t.sandbox_id=s.id));
end $$;

create or replace function public.npc_author_request_retirement(p_npc_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.npc_retirement_requests; created boolean:=false;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403'; end if;
  if length(trim(p_reason)) not between 10 and 2000 then raise sqlstate 'PT400' using message='Retirement rationale must be between 10 and 2000 characters'; end if;
  select * into r from private.npc_retirement_requests where npc_id=p_npc_id and status='open' for update;
  if not found then
    begin
      insert into private.npc_retirement_requests(npc_id,requested_by,reason) values(p_npc_id,auth.uid(),p_reason) returning * into r;
      created:=true;
    exception when unique_violation then
      select * into r from private.npc_retirement_requests where npc_id=p_npc_id and status='open';
    end;
  end if;
  return jsonb_build_object('kind','retirement_requested','requestId',r.id,'status',r.status,'reason',r.reason,'createdAt',r.created_at,'created',created);
end $$;

create or replace function public.npc_reviewer_retirement(p_request uuid,p_approve boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare n uuid; owner uuid;
begin
  select npc_id into n from private.npc_retirement_requests where id=p_request and status='open' for update;
  if n is null then raise sqlstate 'PT404'; end if;
  perform private.assert_npc_reviewer(n);
  if length(trim(p_reason))<3 then raise sqlstate 'PT400' using message='A reviewer decision reason is required'; end if;
  update private.npc_retirement_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now(),decision_reason=p_reason where id=p_request;
  if p_approve then update private.npc_identities set status='retired',retired_at=now() where id=n; end if;
  select creator_id into owner from private.npc_identities where id=n;
  insert into private.npc_notifications(user_id,kind,payload) values(owner,'retirement_decision',jsonb_build_object('npcId',n,'approved',p_approve,'reason',p_reason));
end $$;

create or replace function public.npc_author_workspace_detail(p_npc_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; active_sandbox jsonb; retirement jsonb; usage private.npc_author_usage; editable boolean; submit_reason text;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may use this workspace'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id order by version_number desc limit 1;
  editable:=coalesce(d.state='open',false);
  submit_reason:=case when not editable then 'Draft is already submitted and read-only'
    when d.selected_scene_asset_id is null then 'Choose a scene before submitting'
    else null end;
  select jsonb_build_object('id',s.id,'draftRevision',s.based_on_revision,'frozenSheet',s.frozen_sheet,'state',case when s.invalidated_at is null then 'active' else 'invalidated' end,'invalidatedAt',s.invalidated_at,
      'pending',exists(select 1 from private.npc_sandbox_turns t where t.sandbox_id=s.id and t.status='pending'),
      'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ordinal',t.ordinal,'role',t.role,'content',t.content,'status',t.status,'createdAt',t.created_at,'completedAt',t.completed_at,'jobId',t.job_id) order by t.ordinal),'[]'::jsonb) from private.npc_sandbox_turns t where t.sandbox_id=s.id)) into active_sandbox
    from private.npc_sandboxes s where s.draft_id=d.id and s.invalidated_at is null order by s.created_at desc limit 1;
  select jsonb_build_object('id',r.id,'status',r.status,'reason',r.reason,'createdAt',r.created_at,'decidedAt',r.decided_at,'decisionReason',r.decision_reason) into retirement
    from private.npc_retirement_requests r where r.npc_id=p_npc_id order by r.created_at desc limit 1;
  select * into usage from private.npc_author_usage where user_id=auth.uid() and usage_day=current_date;
  return jsonb_build_object(
    'npcId',p_npc_id,
    'draft',jsonb_build_object('id',d.id,'revision',d.revision,'lifecycle',d.state,'editable',editable,'sheet',d.sheet,
      'fieldPaths',jsonb_build_array('identity.name','identity.title','identity.shortDescription','appearance','personality','lore','skills','campaign')),
    'capabilities',jsonb_build_object('canEdit',editable,'editReason',case when editable then null else 'Draft is read-only after submission' end,
      'canSubmit',editable and d.selected_scene_asset_id is not null,'submitReason',submit_reason,
      'canRequestAssistance',editable,'assistanceReason',case when editable then null else 'Open a changes-requested draft before requesting assistance' end,
      'canUseSandbox',editable,'sandboxReason',case when editable then null else 'Sandbox is available only for an open draft' end,
      'canRequestRetirement',coalesce(retirement->>'status','') not in ('open','approved'),'retirementReason',case when retirement->>'status'='open' then 'A retirement request is already pending review' when retirement->>'status'='approved' then 'This NPC is already retired' else null end),
    'scenes',jsonb_build_object('selectedAssetId',d.selected_scene_asset_id,'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'storageKey',a.storage_key,'altText',a.alt_text,'createdAt',a.created_at) order by a.created_at desc),'[]'::jsonb) from private.npc_assets a where a.npc_id=p_npc_id and a.kind='scene' and a.created_by=auth.uid()),'selected',(select jsonb_build_object('id',a.id,'storageKey',a.storage_key,'altText',a.alt_text) from private.npc_assets a where a.id=d.selected_scene_asset_id)),
    'eligibleNpcs',(select coalesce(jsonb_agg(jsonb_build_object('npcId',i.id,'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') order by lower(v.sheet#>>'{identity,name}')),'[]'::jsonb) from private.npc_identities i join private.npc_versions v on v.id=i.current_published_version_id where i.id<>p_npc_id and i.status in ('published','retired')),
    'assistance',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sectionPath',e.section_path,'sourceRevision',e.source_revision,'proposal',e.proposal,'disposition',e.disposition,'actionable',e.disposition='proposed' and e.source_revision=d.revision and editable,
      'errorCode',(select j.error_code from private.npc_generation_jobs j where j.request->>'assistanceEventId'=e.id::text order by j.created_at desc limit 1),
      'reason',case when e.disposition='failed' then 'The assistant could not produce a usable suggestion' when e.disposition in ('accepted','rejected') then 'Already decided' when e.source_revision<>d.revision then 'Out of date: the draft changed' when not editable then 'Draft is read-only' else null end,'createdAt',e.created_at,'decidedAt',e.decided_at) order by e.created_at desc),'[]'::jsonb) from private.npc_assistance_events e where e.draft_id=d.id),
    'sandbox',jsonb_build_object('active',active_sandbox,'preserved',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'draftRevision',s.based_on_revision,'invalidatedAt',s.invalidated_at,'state','invalidated','pending',false,
      'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ordinal',t.ordinal,'role',t.role,'content',t.content,'status',t.status,'createdAt',t.created_at,'completedAt',t.completed_at) order by t.ordinal),'[]'::jsonb) from private.npc_sandbox_turns t where t.sandbox_id=s.id)) order by s.updated_at desc),'[]'::jsonb) from private.npc_sandboxes s where s.draft_id=d.id and s.invalidated_at is not null)),
    'versions',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'number',v.version_number,'state',v.state,'submittedAt',v.submitted_at,
      'evaluation',coalesce((select jsonb_build_object('status',e.status,'hardBlocks',coalesce(e.result->'hardBlocks','[]'::jsonb),'advisories',coalesce(e.result->'advisories','[]'::jsonb),'completedAt',e.completed_at) from private.npc_evaluations e where e.version_id=v.id),jsonb_build_object('status','not_started','hardBlocks','[]'::jsonb,'advisories','[]'::jsonb)),
      'reviewerDecision',(select jsonb_build_object('decision',x.decision,'notes',x.notes,'createdAt',x.created_at) from private.npc_review_decisions x where x.version_id=v.id order by x.created_at desc limit 1),
      'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'sectionPath',c.section_path,'body',c.body,'resolvedAt',c.resolved_at,'createdAt',c.created_at) order by c.created_at),'[]'::jsonb) from private.npc_section_comments c where c.version_id=v.id)) order by v.version_number desc),'[]'::jsonb) from private.npc_versions v where v.npc_id=p_npc_id),
    'retirement',retirement,
    'quota',jsonb_build_object(
      'assistanceDaily',greatest(0,private.npc_quota(auth.uid(),'assist')-coalesce(usage.assistance_calls,0)),
      'sceneDaily',greatest(0,private.npc_quota(auth.uid(),'scene')-coalesce(usage.scene_calls,0)),
      'sandboxDaily',greatest(0,private.npc_quota(auth.uid(),'sandbox')-coalesce(usage.sandbox_turns,0)))
  );
end $$;

revoke all on function public.npc_author_sandbox_start(uuid,bigint),public.npc_author_sandbox_send(uuid,text),public.npc_author_request_retirement(uuid,text) from public,anon,authenticated;
grant execute on function public.npc_author_sandbox_start(uuid,bigint),public.npc_author_sandbox_send(uuid,text),public.npc_author_request_retirement(uuid,text) to authenticated;

commit;
