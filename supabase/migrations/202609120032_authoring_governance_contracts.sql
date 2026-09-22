-- Community NPC authoring/governance contract v2.  Provider work remains
-- outside Postgres: authenticated callers only queue/read jobs and the
-- server-only completion functions persist already-produced results.
begin;

create table private.npc_governance_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  npc_id uuid references private.npc_identities(id) on delete set null,
  event_kind text not null,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index npc_one_appeal_per_user_report on private.npc_report_appeals(report_id,appellant_id);

create function private.npc_governance_log(p_npc uuid, p_kind text, p_subject uuid default null, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path='' as $$
  insert into private.npc_governance_audit(actor_id,npc_id,event_kind,subject_id,details)
  values(auth.uid(),p_npc,p_kind,p_subject,coalesce(p_details,'{}'::jsonb))
$$;

create function private.npc_assert_service() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() <> 'service_role' then raise sqlstate 'PT403' using message='Server completion required'; end if;
end $$;

create function private.npc_assert_draft_owner(p_npc uuid, p_revision bigint default null)
returns private.npc_drafts language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc) then raise sqlstate 'PT403' using message='Only the current owner may use this workspace'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc and state='open' for update;
  if not found then raise sqlstate 'PT409' using message='Open draft unavailable'; end if;
  if p_revision is not null and d.revision <> p_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  return d;
end $$;

-- A comment must always name the same NPC as its immutable submitted version.
create function private.npc_comment_version_matches() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from private.npc_versions where id=new.version_id and npc_id=new.npc_id) then
    raise exception using errcode='23514', message='Comment NPC/version mismatch';
  end if;
  return new;
end $$;
create trigger npc_comment_version_matches before insert or update on private.npc_section_comments
  for each row execute function private.npc_comment_version_matches();

create function private.npc_identity_governance_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status or new.creator_id is distinct from old.creator_id then
    perform private.npc_governance_log(new.id,'identity_changed',new.id,jsonb_build_object('fromStatus',old.status,'toStatus',new.status));
  end if;
  return new;
end $$;
create trigger npc_identity_governance_audit after update on private.npc_identities for each row execute function private.npc_identity_governance_audit();
create function private.npc_owner_governance_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.npc_governance_log(coalesce(new.npc_id,old.npc_id),'ownership_changed',coalesce(new.user_id,old.user_id),jsonb_build_object('ended',coalesce(new.ended_at,old.ended_at)));
  return coalesce(new,old);
end $$;
create trigger npc_owner_governance_audit after insert or update on private.npc_identity_owners for each row execute function private.npc_owner_governance_audit();
create function private.npc_report_governance_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  if new.status is distinct from old.status then select npc_id into n from private.npc_versions where id=new.version_id;
    perform private.npc_governance_log(n,'report_resolved',new.id,jsonb_build_object('fromStatus',old.status,'toStatus',new.status,'action',new.remedial_action));
  end if;
  return new;
end $$;
create trigger npc_report_governance_audit after update on private.npc_reports for each row execute function private.npc_report_governance_audit();

create function public.npc_author_workspace_detail(p_npc_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may use this workspace'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id order by version_number desc limit 1;
  return jsonb_build_object(
    'npcId',p_npc_id,'draftId',d.id,'revision',d.revision,'state',d.state,'sheet',d.sheet,
    'selectedSceneAssetId',d.selected_scene_asset_id,
    'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'storageKey',a.storage_key,'altText',a.alt_text,'generation',a.generation,'createdAt',a.created_at) order by a.created_at desc),'[]'::jsonb) from private.npc_assets a where a.npc_id=p_npc_id and a.created_by=auth.uid()),
    'assistance',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sectionPath',e.section_path,'proposal',e.proposal,'disposition',e.disposition,'createdAt',e.created_at,'decidedAt',e.decided_at) order by e.created_at desc),'[]'::jsonb) from private.npc_assistance_events e where e.draft_id=d.id),
    'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'kind',j.request->>'kind','status',j.status,'result',j.result,'errorCode',j.error_code,'createdAt',j.created_at,'completedAt',j.completed_at) order by j.created_at desc),'[]'::jsonb) from private.npc_generation_jobs j where j.npc_id=p_npc_id and j.requested_by=auth.uid()),
    'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'sectionPath',c.section_path,'body',c.body,'resolvedAt',c.resolved_at,'createdAt',c.created_at) order by c.created_at desc),'[]'::jsonb) from private.npc_section_comments c where c.npc_id=p_npc_id),
    'versions',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'number',v.version_number,'state',v.state,'submittedAt',v.submitted_at,'publishedAt',v.published_at,'evaluation',(select jsonb_build_object('status',e.status,'result',e.result) from private.npc_evaluations e where e.version_id=v.id),'decisions',(select coalesce(jsonb_agg(jsonb_build_object('decision',x.decision,'notes',x.notes,'createdAt',x.created_at)),'[]'::jsonb) from private.npc_review_decisions x where x.version_id=v.id)) order by v.version_number desc),'[]'::jsonb) from private.npc_versions v where v.npc_id=p_npc_id),
    'retirement',(select jsonb_build_object('id',r.id,'status',r.status,'reason',r.reason,'createdAt',r.created_at,'decidedAt',r.decided_at) from private.npc_retirement_requests r where r.npc_id=p_npc_id order by r.created_at desc limit 1),
    'quota',jsonb_build_object('assistanceDaily',private.npc_quota(auth.uid(),'assist'),'sceneDaily',private.npc_quota(auth.uid(),'scene'),'sandboxDaily',private.npc_quota(auth.uid(),'sandbox'))
  );
end $$;

create function private.npc_allowed_section(p_path text) returns boolean language sql immutable as $$
  select p_path in ('identity','appearance','personality','lore','skills','campaign')
$$;

create function public.npc_author_request_assistance(p_npc_id uuid,p_expected_revision bigint,p_section_path text,p_instruction text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; j jsonb; e uuid;
begin
  if not private.npc_allowed_section(p_section_path) or length(trim(p_instruction)) not between 1 and 2000 then
    raise sqlstate 'PT400' using message='Choose one editable section and a concise instruction';
  end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  j:=public.npc_author_reserve_call(p_npc_id,'assist',jsonb_build_object('sectionPath',p_section_path,'instruction',p_instruction,'draftRevision',d.revision));
  insert into private.npc_assistance_events(npc_id,draft_id,requested_by,section_path,provider,model,prompt_version,content_hash)
  values(p_npc_id,d.id,auth.uid(),p_section_path,'openai','authoring-assist','authoring-assist-v1',encode(extensions.digest((d.sheet#>array[p_section_path])::text,'sha256'),'hex')) returning id into e;
  update private.npc_generation_jobs set request=request || jsonb_build_object('assistanceEventId',e) where id=(j->>'jobId')::uuid;
  perform private.npc_governance_log(p_npc_id,'assistance_requested',e,jsonb_build_object('sectionPath',p_section_path));
  return j || jsonb_build_object('assistanceEventId',e);
end $$;

create function public.npc_author_assistance_status(p_event_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.npc_assistance_events;
begin
  select * into e from private.npc_assistance_events where id=p_event_id;
  if not found or e.requested_by<>auth.uid() or not private.npc_is_owner(e.npc_id) then raise sqlstate 'PT404'; end if;
  return jsonb_build_object('id',e.id,'sectionPath',e.section_path,'proposal',e.proposal,'disposition',e.disposition,'createdAt',e.created_at,'decidedAt',e.decided_at);
end $$;

create function public.npc_author_assistance_disposition(p_event_id uuid,p_expected_revision bigint,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.npc_assistance_events; d private.npc_drafts; proposed jsonb; candidate jsonb;
begin
  select * into e from private.npc_assistance_events where id=p_event_id for update;
  if not found or e.requested_by<>auth.uid() then raise sqlstate 'PT404'; end if;
  d:=private.npc_assert_draft_owner(e.npc_id,p_expected_revision);
  if e.draft_id<>d.id or e.disposition<>'proposed' then raise sqlstate 'PT409' using message='Assistance is no longer actionable'; end if;
  if not exists(select 1 from private.npc_generation_jobs j where (j.request->>'assistanceEventId')::uuid=e.id and (j.request#>>'{payload,draftRevision}')::bigint=d.revision and j.status='completed') then
    raise sqlstate 'PT409' using message='Assistance was created for an older draft revision';
  end if;
  if p_accept then
    proposed:=coalesce(e.proposal->'replacement',e.proposal);
    if proposed is null then raise sqlstate 'PT422' using message='Assistance has no replacement'; end if;
    candidate:=jsonb_set(d.sheet,array[e.section_path],proposed,true);
    perform private.validate_npc_sheet_v2(candidate);
    update private.npc_drafts set sheet=candidate,revision=revision+1,updated_at=now() where id=d.id;
    update private.npc_sandboxes set invalidated_at=coalesce(invalidated_at,now()),updated_at=now() where draft_id=d.id and invalidated_at is null;
  end if;
  update private.npc_assistance_events set disposition=case when p_accept then 'accepted' else 'rejected' end,decided_at=now() where id=e.id;
  perform private.npc_governance_log(e.npc_id,case when p_accept then 'assistance_accepted' else 'assistance_rejected' end,e.id,jsonb_build_object('sectionPath',e.section_path));
  return jsonb_build_object('eventId',e.id,'accepted',p_accept,'revision',p_expected_revision + case when p_accept then 1 else 0 end);
end $$;

create function public.npc_author_request_scene(p_npc_id uuid,p_expected_revision bigint,p_prompt text,p_alternative integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; j jsonb;
begin
  if length(trim(p_prompt)) not between 10 and 2000 or p_alternative not between 1 and 4 then raise sqlstate 'PT400' using message='Scene prompt or alternative is invalid'; end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  j:=public.npc_author_reserve_call(p_npc_id,'scene',jsonb_build_object('prompt',p_prompt,'alternative',p_alternative,'draftRevision',d.revision));
  perform private.npc_governance_log(p_npc_id,'scene_requested',(j->>'jobId')::uuid,jsonb_build_object('alternative',p_alternative));
  return j;
end $$;

create function public.npc_author_scene_status(p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs;
begin
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='scene';
  if not found or j.requested_by<>auth.uid() or not private.npc_is_owner(j.npc_id) then raise sqlstate 'PT404'; end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'result',j.result,'errorCode',j.error_code,'createdAt',j.created_at,'completedAt',j.completed_at);
end $$;

create function public.npc_author_select_scene(p_npc_id uuid,p_expected_revision bigint,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts;
begin
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  if not exists(select 1 from private.npc_assets where id=p_asset_id and npc_id=p_npc_id and kind='scene' and created_by=auth.uid()) then raise sqlstate 'PT422' using message='Scene asset does not belong to this draft'; end if;
  if not exists(select 1 from private.npc_generation_jobs j cross join lateral jsonb_array_elements(coalesce(j.result->'candidates','[]'::jsonb)) candidate where j.npc_id=p_npc_id and j.requested_by=auth.uid() and j.request->>'kind'='scene' and j.status='completed' and (j.request#>>'{payload,draftRevision}')::bigint=d.revision and candidate->>'assetId'=p_asset_id::text) then
    raise sqlstate 'PT409' using message='Scene candidate was created for an older draft revision';
  end if;
  update private.npc_drafts set selected_scene_asset_id=p_asset_id,revision=revision+1,updated_at=now() where id=d.id;
  perform private.npc_governance_log(p_npc_id,'scene_selected',p_asset_id);
  return jsonb_build_object('assetId',p_asset_id,'revision',d.revision+1);
end $$;

create function public.npc_author_sandbox_start(p_npc_id uuid,p_expected_revision bigint,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; s uuid; j jsonb;
begin
  if length(trim(p_message)) not between 1 and 2000 then raise sqlstate 'PT400' using message='Sandbox message is required'; end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  insert into private.npc_sandboxes(npc_id,draft_id,owner_id,based_on_revision,state) values(p_npc_id,d.id,auth.uid(),d.revision,jsonb_build_object('turns',jsonb_build_array(jsonb_build_object('keeper',p_message,'at',now())))) returning id into s;
  j:=public.npc_author_reserve_call(p_npc_id,'sandbox',jsonb_build_object('sandboxId',s,'message',p_message,'draftRevision',d.revision));
  perform private.npc_governance_log(p_npc_id,'sandbox_started',s);
  return j || jsonb_build_object('sandboxId',s);
end $$;

create function public.npc_author_sandbox_status(p_sandbox_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.npc_sandboxes; j private.npc_generation_jobs;
begin
  select * into s from private.npc_sandboxes where id=p_sandbox_id;
  if not found or s.owner_id<>auth.uid() or not private.npc_is_owner(s.npc_id) then raise sqlstate 'PT404'; end if;
  select * into j from private.npc_generation_jobs where (request#>>'{payload,sandboxId}')::uuid=s.id order by created_at desc limit 1;
  return jsonb_build_object('sandboxId',s.id,'invalidatedAt',s.invalidated_at,'state',s.state,'job',case when j.id is null then null else jsonb_build_object('id',j.id,'status',j.status,'errorCode',j.error_code,'completedAt',j.completed_at) end);
end $$;

create function public.npc_author_assistance_complete(p_job_id uuid,p_proposal jsonb,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs; e uuid;
begin
  perform private.npc_assert_service();
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='assist' for update;
  if not found or j.status not in ('queued','running') then raise sqlstate 'PT409'; end if;
  e:=(j.request->>'assistanceEventId')::uuid;
  if p_error_code is null and (e is null or not private.npc_allowed_section(j.request#>>'{payload,sectionPath}')) then raise sqlstate 'PT422'; end if;
  update private.npc_generation_jobs set status=case when p_error_code is null then 'completed' else 'failed' end,result=coalesce(p_proposal,'{}'),error_code=p_error_code,completed_at=now() where id=p_job_id;
  update private.npc_assistance_events set proposal=case when p_error_code is null then p_proposal else null end,disposition=case when p_error_code is null then 'proposed' else 'failed' end where id=e;
end $$;

create function public.npc_author_scene_complete(p_job_id uuid,p_candidates jsonb,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs; item jsonb; a jsonb:='[]'::jsonb; asset_id uuid;
begin
  perform private.npc_assert_service(); select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='scene' for update;
  if not found or j.status not in ('queued','running') then raise sqlstate 'PT409'; end if;
  if p_error_code is null then
    if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates) not between 1 and 4 then raise sqlstate 'PT422' using message='Scene completion needs one to four candidates'; end if;
    for item in select value from jsonb_array_elements(p_candidates) loop
      if length(trim(coalesce(item->>'storageKey',''))) not between 3 and 500 or length(trim(coalesce(item->>'altText',''))) not between 10 and 500 then raise sqlstate 'PT422'; end if;
      insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by) values(j.npc_id,'scene',item->>'storageKey',item->>'altText',coalesce(item->'generation','{}'::jsonb),j.requested_by) returning id into asset_id;
      a:=a||jsonb_build_array(jsonb_build_object('assetId',asset_id,'storageKey',item->>'storageKey','altText',item->>'altText'));
    end loop;
  end if;
  update private.npc_generation_jobs set status=case when p_error_code is null then 'completed' else 'failed' end,result=jsonb_build_object('candidates',a),error_code=p_error_code,completed_at=now() where id=p_job_id;
  return jsonb_build_object('jobId',p_job_id,'candidates',a);
end $$;

create function public.npc_author_sandbox_complete(p_job_id uuid,p_reply text,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs; s uuid;
begin
  perform private.npc_assert_service(); select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='sandbox' for update;
  if not found or j.status not in ('queued','running') then raise sqlstate 'PT409'; end if; s:=(j.request#>>'{payload,sandboxId}')::uuid;
  if p_error_code is null and length(trim(coalesce(p_reply,''))) not between 1 and 4000 then raise sqlstate 'PT422'; end if;
  update private.npc_generation_jobs set status=case when p_error_code is null then 'completed' else 'failed' end,result=jsonb_build_object('reply',p_reply),error_code=p_error_code,completed_at=now() where id=p_job_id;
  if p_error_code is null then update private.npc_sandboxes set state=jsonb_set(state,'{turns,0,reply}',to_jsonb(p_reply),true),updated_at=now() where id=s and invalidated_at is null; end if;
end $$;

create function public.npc_reviewer_submission(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.npc_versions;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted'; if not found then raise sqlstate 'PT404'; end if;
  perform private.assert_npc_reviewer(v.npc_id);
  return jsonb_build_object('npcId',v.npc_id,'versionId',v.id,'sheet',v.sheet,'rating',(select rating from private.npc_identities where id=v.npc_id),'sceneAsset',(select jsonb_build_object('id',id,'storageKey',storage_key,'altText',alt_text,'generation',generation) from private.npc_assets where id=v.selected_scene_asset_id),'evaluation',(select jsonb_build_object('status',status,'result',result) from private.npc_evaluations where version_id=v.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sectionPath',section_path,'body',body,'resolvedAt',resolved_at,'createdAt',created_at)),'[]'::jsonb) from private.npc_section_comments where version_id=v.id));
end $$;

create function public.npc_author_resolve_review_comment(p_comment_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c private.npc_section_comments;
begin select * into c from private.npc_section_comments where id=p_comment_id for update;
  if not found or not private.npc_is_owner(c.npc_id) then raise sqlstate 'PT404'; end if;
  update private.npc_section_comments set resolved_at=coalesce(resolved_at,now()) where id=c.id;
  perform private.npc_governance_log(c.npc_id,'review_comment_resolved',c.id);
end $$;

create function public.npc_reviewer_moderation_queue(p_kind text default 'reports',p_limit integer default 50,p_cursor uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not(private.has_npc_capability('npc_reviewer') or private.has_npc_capability('admin')) then raise sqlstate 'PT403'; end if;
  if p_kind='reports' then return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'versionId',r.version_id,'category',r.category,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb) from (select r.* from private.npc_reports r join private.npc_versions v on v.id=r.version_id where r.status='open' and not private.npc_was_ever_owner(v.npc_id) and (p_cursor is null or r.id<p_cursor) order by r.created_at desc limit greatest(1,least(p_limit,100))) r); end if;
  if p_kind='retirements' then return (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'npcId',x.npc_id,'reason',x.reason,'createdAt',x.created_at) order by x.created_at desc),'[]'::jsonb) from (select * from private.npc_retirement_requests x where x.status='open' and not private.npc_was_ever_owner(x.npc_id) and (p_cursor is null or x.id<p_cursor) order by x.created_at desc limit greatest(1,least(p_limit,100))) x); end if;
  raise sqlstate 'PT400' using message='Unknown moderation queue';
end $$;

create function public.npc_reviewer_report_detail(p_report_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.npc_reports; n uuid;
begin select * into r from private.npc_reports where id=p_report_id; if not found then raise sqlstate 'PT404'; end if; select npc_id into n from private.npc_versions where id=r.version_id; perform private.assert_npc_reviewer(n);
  return jsonb_build_object('id',r.id,'npcId',n,'versionId',r.version_id,'category',r.category,'evidence',r.evidence,'transcript',r.transcript,'frozenVersion',r.frozen_version,'generationMetadata',r.generation_metadata,'createdAt',r.created_at,'appeals',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body,'status',status,'createdAt',created_at)),'[]'::jsonb) from private.npc_report_appeals where report_id=r.id));
end $$;

create function public.npc_inbox_mark_read(p_ids uuid[]) returns integer language plpgsql security definer set search_path='' as $$
declare count_updated integer; begin
  update private.npc_notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and id=any(coalesce(p_ids,'{}'::uuid[])); get diagnostics count_updated=row_count; return count_updated;
end $$;

create function public.npc_public_creator_npcs(p_normalized_name text,p_limit integer default 24,p_cursor uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('npcId',i.id,'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}','shortDescription',v.sheet#>>'{identity,shortDescription}','rating',i.rating,'versionId',v.id) order by i.id),'[]'::jsonb)
  from (select i.* from private.npc_identities i join public.player_profiles p on p.user_id=i.creator_id where p.normalized_display_name=lower(trim(p_normalized_name)) and i.status in ('published','retired') and (p_cursor is null or i.id>p_cursor) order by i.id limit greatest(1,least(p_limit,100))) i join private.npc_versions v on v.id=i.current_published_version_id
$$;

create function public.npc_share_view(p_token uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('transcript',s.transcript,'displayName',case when s.include_display_name then s.display_name_snapshot else null end,'createdAt',s.created_at,'immutable',true)
  from private.npc_conversation_shares s where s.share_token=p_token
$$;

create function public.npc_admin_audit(p_kind text default null,p_limit integer default 100,p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_npc_capability('admin') then raise sqlstate 'PT403'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'npcId',npc_id,'eventKind',event_kind,'subjectId',subject_id,'details',details,'createdAt',created_at) order by created_at desc),'[]'::jsonb) into result
  from (select * from private.npc_governance_audit where (p_kind is null or event_kind=p_kind) and (p_cursor is null or id<p_cursor) order by created_at desc limit greatest(1,least(p_limit,200))) q;
  return result;
end $$;

create or replace function public.npc_record_engagement(p_actor uuid,p_version uuid,p_kind text,p_metadata jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
  perform private.npc_assert_service();
  if p_kind not in ('assigned','active','dialogue','day_present','hospitality','milestone_success','milestone_failure','abandoned','campaign_complete','dismissed','report')
    or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' or octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>4096 then raise sqlstate 'PT400' using message='Engagement event is invalid'; end if;
  select id into s from public.tavern_saves where user_id=p_actor;
  insert into private.npc_engagement_events(actor_id,event_kind,npc_id,version_id,world_hash,metadata)
  select p_actor,p_kind,v.npc_id,p_version,encode(extensions.digest(coalesce(s::text,p_actor::text),'sha256'),'hex'),coalesce(p_metadata,'{}') from private.npc_versions v where v.id=p_version;
  if not found then raise sqlstate 'PT404'; end if;
end $$;

-- Tighten earlier broad entry points without changing their public signatures.
create or replace function public.npc_reviewer_comment(p_npc_id uuid,p_version_id uuid,p_section text,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; begin
  perform private.assert_npc_reviewer(p_npc_id);
  if not private.npc_allowed_section(p_section) or not exists(select 1 from private.npc_versions where id=p_version_id and npc_id=p_npc_id and state='submitted') then raise sqlstate 'PT422' using message='Comment must target an editable section of the submitted NPC'; end if;
  insert into private.npc_section_comments(npc_id,version_id,section_path,body,author_id) values(p_npc_id,p_version_id,p_section,p_body,auth.uid()) returning id into r;
  perform private.npc_governance_log(p_npc_id,'review_comment_added',r,jsonb_build_object('sectionPath',p_section)); return r;
end $$;

revoke all on function
  public.npc_author_workspace_detail(uuid),public.npc_author_request_assistance(uuid,bigint,text,text),public.npc_author_assistance_status(uuid),public.npc_author_assistance_disposition(uuid,bigint,boolean),
  public.npc_author_request_scene(uuid,bigint,text,integer),public.npc_author_scene_status(uuid),public.npc_author_select_scene(uuid,bigint,uuid),public.npc_author_sandbox_start(uuid,bigint,text),public.npc_author_sandbox_status(uuid),
  public.npc_author_assistance_complete(uuid,jsonb,text),public.npc_author_scene_complete(uuid,jsonb,text),public.npc_author_sandbox_complete(uuid,text,text),
  public.npc_reviewer_submission(uuid),public.npc_author_resolve_review_comment(uuid),public.npc_reviewer_moderation_queue(text,integer,uuid),public.npc_reviewer_report_detail(uuid),
  public.npc_inbox_mark_read(uuid[]),public.npc_public_creator_npcs(text,integer,uuid),public.npc_share_view(uuid),public.npc_admin_audit(text,integer,uuid)
from public,anon,authenticated;
grant execute on function
  public.npc_author_workspace_detail(uuid),public.npc_author_request_assistance(uuid,bigint,text,text),public.npc_author_assistance_status(uuid),public.npc_author_assistance_disposition(uuid,bigint,boolean),
  public.npc_author_request_scene(uuid,bigint,text,integer),public.npc_author_scene_status(uuid),public.npc_author_select_scene(uuid,bigint,uuid),public.npc_author_sandbox_start(uuid,bigint,text),public.npc_author_sandbox_status(uuid),
  public.npc_reviewer_submission(uuid),public.npc_author_resolve_review_comment(uuid),public.npc_reviewer_moderation_queue(text,integer,uuid),public.npc_reviewer_report_detail(uuid),
  public.npc_inbox_mark_read(uuid[]),public.npc_public_creator_npcs(text,integer,uuid),public.npc_admin_audit(text,integer,uuid)
to authenticated;
grant execute on function public.npc_share_view(uuid) to anon,authenticated;
grant execute on function public.npc_author_assistance_complete(uuid,jsonb,text),public.npc_author_scene_complete(uuid,jsonb,text),public.npc_author_sandbox_complete(uuid,text,text) to service_role;

commit;
