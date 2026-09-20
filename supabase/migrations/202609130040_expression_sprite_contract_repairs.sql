-- Compatibility repair for databases that applied an early 039 while this
-- prototype branch was under active review. Fresh installs receive the same
-- canonical definitions from 039; this file only replaces mutable contracts.
begin;

alter table private.npc_portrait_candidates add column if not exists neutral_anchor_asset_id uuid references private.npc_assets(id);
update private.npc_portrait_candidates c set neutral_anchor_asset_id=coalesce((j.request#>>'{payload,neutralAnchorAssetId}')::uuid,(d.selected_portrait_slots#>>'{neutral,assetId}')::uuid)
  from private.npc_generation_jobs j, private.npc_drafts d
  where c.job_id=j.id and d.id=c.draft_id and c.expression_slot<>'neutral' and c.neutral_anchor_asset_id is null;
update private.npc_portrait_candidates c set state='stale',failure_code=coalesce(c.failure_code,'NEUTRAL_ANCHOR_UNAVAILABLE')
  where c.expression_slot<>'neutral' and c.neutral_anchor_asset_id is null;
alter table private.npc_portrait_candidates drop constraint if exists npc_portrait_candidate_anchor_check;
alter table private.npc_portrait_candidates add constraint npc_portrait_candidate_anchor_check check ((expression_slot='neutral' and neutral_anchor_hash is null and neutral_anchor_asset_id is null) or (expression_slot<>'neutral' and (neutral_anchor_hash ~ '^[0-9a-f]{64}$' and neutral_anchor_asset_id is not null or state='stale')));

create or replace function public.npc_portrait_claim_generation_attempt() returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt_row private.npc_portrait_generation_attempts; token uuid:=extensions.gen_random_uuid();
begin
  perform private.npc_assert_service();
  update private.npc_portrait_generation_attempts set status='ambiguous',error_code='PROVIDER_DISPATCH_AMBIGUOUS',completed_at=now(),lease_expires_at=null where status='dispatched' and lease_expires_at<now();
  update private.npc_portrait_candidates c set state='failed',failure_code='PROVIDER_DISPATCH_AMBIGUOUS',completed_at=now() from private.npc_portrait_generation_attempts att where att.candidate_id=c.id and att.status='ambiguous' and c.state='generating';
  update private.npc_portrait_generation_attempts set status='failed',error_code='INFRASTRUCTURE_RETRY_EXHAUSTED',completed_at=now(),lease_expires_at=null where status='claimed' and lease_expires_at<now() and infrastructure_attempts>=3;
  update private.npc_portrait_candidates c set state='failed',failure_code='INFRASTRUCTURE_RETRY_EXHAUSTED',completed_at=now() from private.npc_portrait_generation_attempts att where att.candidate_id=c.id and att.status='failed' and att.error_code='INFRASTRUCTURE_RETRY_EXHAUSTED' and c.state='generating';
  perform private.npc_finalize_portrait_generation_jobs();
  select * into attempt_row from private.npc_portrait_generation_attempts where status='queued' or (status='claimed' and lease_expires_at<now() and infrastructure_attempts<3) order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update private.npc_portrait_generation_attempts set status='claimed',lease_token=token,lease_expires_at=now()+interval '5 minutes',last_heartbeat_at=now(),infrastructure_attempts=infrastructure_attempts+1 where id=attempt_row.id;
  update private.npc_generation_jobs set status='running' where id=attempt_row.job_id and status='queued';
  return jsonb_build_object('attemptId',attempt_row.id,'leaseToken',token,'jobId',attempt_row.job_id,'candidateId',attempt_row.candidate_id,'ordinal',attempt_row.ordinal,
    'request',(select jsonb_build_object('npcId',j.npc_id,'sheet',d.sheet,'controls',j.request#>'{payload,controls}','visualInputHash',j.request#>>'{payload,visualInputHash}','slot',j.request#>>'{payload,slot}','neutralAnchorHash',j.request#>>'{payload,neutralAnchorHash}','neutralAnchorAssetId',j.request#>>'{payload,neutralAnchorAssetId}','styleVersion',j.request#>>'{payload,styleVersion}','referenceSetVersion',j.request#>>'{payload,referenceSetVersion}') from private.npc_generation_jobs j join private.npc_drafts d on d.id=(j.request#>>'{draftId}')::uuid where j.id=attempt_row.job_id),
    'neutralAnchorAsset',(select jsonb_build_object('assetId',a.id,'runtimeStorageKey',a.storage_key,'masterStorageKey',a.generation->>'masterStorageKey','runtimeSha256',a.sha256,'masterSha256',a.generation->>'masterSha256') from private.npc_assets a join private.npc_generation_jobs j on j.id=attempt_row.job_id where a.id=(j.request#>>'{payload,neutralAnchorAssetId}')::uuid and a.sha256=j.request#>>'{payload,neutralAnchorHash}' and a.media_state not in ('quarantined','purged')));
end $$;

create or replace function private.npc_version_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.state in ('submitted','published','retired','rejected') then raise exception 'NPC version is immutable once submitted'; end if;
  if tg_op='UPDATE' and old.state in ('submitted','published','retired','rejected') and (to_jsonb(new)-'state'-'published_at') is distinct from (to_jsonb(old)-'state'-'published_at') then raise exception 'NPC version content is immutable once submitted'; end if;
  return new;
end $$;

create or replace function private.npc_resolved_portrait_slots(p_slots jsonb) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_object_agg(slot,case when p_slots ? slot then p_slots->slot else (p_slots->'neutral') || jsonb_build_object('fallbackFrom','neutral') end) from unnest(array['neutral','happy','sad','angry','engaged','leaving']) slot
$$;

create or replace function public.npc_author_request_portrait(p_npc_id uuid,p_expected_revision bigint,p_controls jsonb,p_alternatives integer,p_slot text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; base jsonb; anchor text; anchor_asset uuid; job uuid;
begin
  if p_slot not in ('neutral','happy','sad','angry','engaged','leaving') then raise sqlstate 'PT400' using message='Expression slot is invalid'; end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  if p_slot<>'neutral' then anchor:=d.selected_portrait_slots#>>'{neutral,assetHash}'; anchor_asset:=(d.selected_portrait_slots#>>'{neutral,assetId}')::uuid; if anchor is null or anchor_asset is null then raise sqlstate 'PT422' using message='Select Neutral before requesting an expression'; end if; end if;
  base:=public.npc_author_request_portrait(p_npc_id,p_expected_revision,p_controls,p_alternatives); job:=(base->>'jobId')::uuid;
  update private.npc_generation_jobs set request=jsonb_set(request,'{payload}',(request->'payload') || jsonb_build_object('slot',p_slot,'neutralAnchorHash',anchor,'neutralAnchorAssetId',anchor_asset),true) where id=job;
  update private.npc_portrait_candidates set expression_slot=p_slot,neutral_anchor_hash=anchor,neutral_anchor_asset_id=anchor_asset where job_id=job;
  insert into private.npc_portrait_generation_attempts(job_id,candidate_id,ordinal) select job,id,ordinal from private.npc_portrait_candidates where job_id=job on conflict(job_id,ordinal) do nothing;
  return base || jsonb_build_object('slot',p_slot,'neutralAnchorHash',anchor,'neutralAnchorAssetId',anchor_asset);
end $$;

create or replace function public.npc_author_portrait_event_status(p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs;
begin
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='portrait';
  if not found or j.requested_by<>auth.uid() or not private.npc_is_owner(j.npc_id) then raise sqlstate 'PT404'; end if;
  return jsonb_build_object('jobId',j.id,'npcId',j.npc_id,'slot',j.request#>>'{payload,slot}','status',j.status,'errorCode',j.error_code,'alternatives',(select coalesce(jsonb_agg(jsonb_build_object('ordinal',a.ordinal,'stage',case when a.status in ('claimed','dispatched') then 'generating' when a.status='ready' then 'completed' else a.status end,'status',a.status,'candidateId',a.candidate_id,'errorCode',a.error_code) order by a.ordinal),'[]'::jsonb) from private.npc_portrait_generation_attempts a where a.job_id=j.id));
end $$;

create or replace function public.npc_author_register_uploaded_portrait(p_npc_id uuid,p_expected_revision bigint,p_slot text,p_metadata jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; asset uuid; candidate uuid; anchor text; vhash text;
begin
  perform private.npc_assert_service();
  if p_slot not in ('neutral','happy','sad','angry','engaged','leaving') or jsonb_typeof(p_metadata)<>'object' then raise sqlstate 'PT400' using message='Upload metadata is invalid'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found or d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  if p_slot<>'neutral' and d.selected_portrait_slots#>>'{neutral,assetHash}' is null then raise sqlstate 'PT422' using message='Select Neutral before uploading an expression'; end if;
  if p_metadata->>'runtimeStorageKey' is null or p_metadata->>'masterStorageKey' is null or p_metadata->>'runtimeSha256' !~ '^[0-9a-f]{64}$' or p_metadata->>'masterSha256' !~ '^[0-9a-f]{64}$' or p_metadata->>'originalSha256' !~ '^[0-9a-f]{64}$' or p_metadata->>'mimeType'<>'image/webp' or p_metadata->>'masterMimeType'<>'image/png' or p_metadata->>'originalWidth' !~ '^[0-9]+$' or p_metadata->>'originalHeight' !~ '^[0-9]+$' or p_metadata->>'originalByteSize' !~ '^[0-9]+$' or (p_metadata->>'width')::integer<>1024 or (p_metadata->>'height')::integer<>1536 or (p_metadata->>'byteSize')::integer not between 1 and 500000 or (p_metadata->>'originalWidth')::integer not between 256 and 4096 or (p_metadata->>'originalHeight')::integer not between 256 and 4096 or (p_metadata->>'originalByteSize')::integer not between 1 and 10485760 then raise sqlstate 'PT422' using message='Upload derivative metadata is invalid'; end if;
  vhash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls); anchor:=case when p_slot='neutral' then null else d.selected_portrait_slots#>>'{neutral,assetHash}' end;
  insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by,media_state,mime_type,width,height,byte_size,sha256,alpha_valid,visual_input_hash,style_version,reference_set_version) values(p_npc_id,'portrait',p_metadata->>'runtimeStorageKey',coalesce(p_metadata->>'altText','Uploaded expression sprite'),jsonb_build_object('masterStorageKey',p_metadata->>'masterStorageKey','masterSha256',p_metadata->>'masterSha256','originalWidth',(p_metadata->>'originalWidth')::integer,'originalHeight',(p_metadata->>'originalHeight')::integer,'originalSha256',p_metadata->>'originalSha256','originalByteSize',(p_metadata->>'originalByteSize')::integer,'slot',p_slot,'source','author_upload'),d.owner_id,'ready','image/webp',1024,1536,(p_metadata->>'byteSize')::integer,p_metadata->>'runtimeSha256',true,vhash,'community-npc-portrait-sprite-v1','brac-character-look-v1') returning id into asset;
  insert into private.npc_portrait_candidates(job_id,npc_id,draft_id,owner_id,asset_id,ordinal,state,visual_input_hash,source_revision,expression_slot,source_provenance,neutral_anchor_hash,neutral_anchor_asset_id,completed_at) values(null,p_npc_id,d.id,d.owner_id,asset,1,'ready',vhash,d.revision,p_slot,'author_upload',anchor,case when p_slot='neutral' then null else (d.selected_portrait_slots#>>'{neutral,assetId}')::uuid end,now()) returning id into candidate;
  perform private.npc_governance_log(p_npc_id,'portrait_uploaded',asset,jsonb_build_object('slot',p_slot,'candidateId',candidate));
  return jsonb_build_object('candidateId',candidate,'assetId',asset,'slot',p_slot,'revision',d.revision);
end $$;

revoke all on function public.npc_author_portrait_event_status(uuid) from public,anon,authenticated;
grant execute on function public.npc_author_portrait_event_status(uuid) to authenticated;
grant execute on function public.npc_author_register_uploaded_portrait(uuid,bigint,text,jsonb) to service_role;
commit;

-- Bring early 039 databases to the same owner-scoped DTO, selection, completion,
-- workspace, and submission contracts as a fresh installation.
begin;
create or replace function public.npc_author_save(p_npc_id uuid,p_expected_revision bigint,p_sheet jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; old_hash text; new_hash text;
begin
  perform private.assert_npc_author(p_sheet,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may edit this NPC'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found or d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.validate_npc_sheet_v2(p_sheet);
  old_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls); new_hash:=private.npc_visual_input_hash(p_sheet,d.portrait_controls);
  update private.npc_drafts set sheet=p_sheet,revision=revision+1,updated_at=now(),
    selected_portrait_asset_id=case when old_hash<>new_hash then null else selected_portrait_asset_id end,
    selected_portrait_slots=case when old_hash<>new_hash then '{}'::jsonb else selected_portrait_slots end where id=d.id;
  if old_hash<>new_hash then perform private.npc_mark_portraits_stale(d.id,new_hash); end if;
  perform private.npc_author_invalidate_sandboxes(d.id);
  update private.npc_identities set normalized_name=lower(regexp_replace(trim(p_sheet#>>'{identity,name}'),'\\s+',' ','g')),rating=p_sheet->>'rating',updated_at=now() where id=p_npc_id;
  return jsonb_build_object('npcId',p_npc_id,'draftId',d.id,'revision',p_expected_revision+1,'visualInputHash',new_hash,'portraitInvalidated',old_hash<>new_hash);
end $$;

create or replace function private.npc_portrait_candidate_dto(p_candidate private.npc_portrait_candidates)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('id',p_candidate.id,'candidateId',p_candidate.id,'assetId',p_candidate.asset_id,
    'slot',p_candidate.expression_slot,'source',p_candidate.source_provenance,'ordinal',p_candidate.ordinal,'state',p_candidate.state,
    'previewToken',case when p_candidate.asset_id is null or p_candidate.state in ('quarantined','purged') then null else private.npc_issue_portrait_preview_token(p_candidate.asset_id)::text end,
    'altText',coalesce(a.alt_text,''),'dimensions',case when a.id is null then null else jsonb_build_object('width',a.width,'height',a.height) end,
    'alphaValid',coalesce(a.alpha_valid,false),'styleVersion',a.style_version,'visualInputHash',p_candidate.visual_input_hash,
    'neutralAnchorHash',p_candidate.neutral_anchor_hash,'neutralAnchorAssetId',p_candidate.neutral_anchor_asset_id,
    'staleNeutralAnchor',p_candidate.expression_slot<>'neutral' and p_candidate.neutral_anchor_hash is distinct from d.selected_portrait_slots#>>'{neutral,assetHash}',
    'failureCode',p_candidate.failure_code,'createdAt',p_candidate.created_at,'completedAt',p_candidate.completed_at)
  from private.npc_assets a join private.npc_drafts d on d.id=p_candidate.draft_id
  where a.id=p_candidate.asset_id
  union all
  select jsonb_build_object('id',p_candidate.id,'candidateId',p_candidate.id,'assetId',null,'slot',p_candidate.expression_slot,
    'source',p_candidate.source_provenance,'ordinal',p_candidate.ordinal,'state',p_candidate.state,'previewToken',null,
    'altText','','dimensions',null,'alphaValid',false,'styleVersion',null,'visualInputHash',p_candidate.visual_input_hash,
    'neutralAnchorHash',p_candidate.neutral_anchor_hash,'neutralAnchorAssetId',p_candidate.neutral_anchor_asset_id,'staleNeutralAnchor',false,'failureCode',p_candidate.failure_code,
    'createdAt',p_candidate.created_at,'completedAt',p_candidate.completed_at)
  where p_candidate.asset_id is null
  limit 1
$$;

-- New slot-aware request wrapper.  The v1 four-argument function remains a
create or replace function public.npc_author_select_portrait(p_npc_id uuid,p_expected_revision bigint,p_slot text,p_candidate_id uuid,p_confirm_stale boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; c private.npc_portrait_candidates; a private.npc_assets; slots jsonb; anchor text; visual_hash text;
begin
  if p_slot not in ('neutral','happy','sad','angry','engaged','leaving') then raise sqlstate 'PT400' using message='Expression slot is invalid'; end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  visual_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls);
  select * into c from private.npc_portrait_candidates where id=p_candidate_id and npc_id=p_npc_id and owner_id=auth.uid() for update;
  select * into a from private.npc_assets where id=c.asset_id;
  if not found or c.draft_id<>d.id or c.expression_slot<>p_slot or c.state not in ('ready','selected','stale')
    or c.visual_input_hash<>visual_hash or a.media_state in ('quarantined','purged') or not a.alpha_valid or a.visual_input_hash<>visual_hash then
    raise sqlstate 'PT422' using message='Sprite candidate is unavailable'; end if;
  slots:=d.selected_portrait_slots;
  if p_slot='neutral' then
    slots:=jsonb_build_object('neutral',jsonb_build_object('candidateId',c.id,'assetId',a.id,'assetHash',a.sha256,'source',c.source_provenance));
    update private.npc_portrait_candidates set state=case
      when id=c.id then 'selected'
      when expression_slot='neutral' and state='selected' then 'superseded'
      when expression_slot<>'neutral' and state='selected' then 'stale'
      else state end,
      selected_at=case when id=c.id then now() else selected_at end where draft_id=d.id;
    update private.npc_assets set media_state=case
      when id=a.id then 'selected'
      when id in (select asset_id from private.npc_portrait_candidates where draft_id=d.id and expression_slot='neutral' and state='superseded') then 'superseded'
      when id in (select asset_id from private.npc_portrait_candidates where draft_id=d.id and expression_slot<>'neutral' and state='stale') then 'stale'
      else media_state end
      where id in (select asset_id from private.npc_portrait_candidates where draft_id=d.id and asset_id is not null);
    update private.npc_drafts set selected_portrait_slots=slots,selected_portrait_asset_id=a.id,revision=revision+1,updated_at=now() where id=d.id;
    perform private.npc_governance_log(p_npc_id,'portrait_neutral_selected',a.id,jsonb_build_object('candidateId',c.id,'optionalSelectionsCleared',true));
  else
    anchor:=slots#>>'{neutral,assetHash}';
    if anchor is null then raise sqlstate 'PT422' using message='Select Neutral before selecting an expression'; end if;
    if c.neutral_anchor_hash is distinct from anchor and not p_confirm_stale then raise sqlstate 'PT409' using message='Expression needs confirmation against the current Neutral'; end if;
    slots:=slots || jsonb_build_object(p_slot,jsonb_build_object('candidateId',c.id,'assetId',a.id,'assetHash',a.sha256,'source',c.source_provenance,'neutralAnchorHash',anchor,'neutralAnchorAssetId',slots#>>'{neutral,assetId}'));
    update private.npc_portrait_candidates set state=case when id=c.id then 'selected' when expression_slot=p_slot and state='selected' then 'superseded' else state end, selected_at=case when id=c.id then now() else selected_at end where draft_id=d.id;
    update private.npc_assets set media_state=case when id=a.id then 'selected' when media_state='selected' then 'superseded' else media_state end
      where id in (select asset_id from private.npc_portrait_candidates where draft_id=d.id and expression_slot=p_slot and asset_id is not null);
    update private.npc_drafts set selected_portrait_slots=slots,revision=revision+1,updated_at=now() where id=d.id;
    perform private.npc_governance_log(p_npc_id,case when c.neutral_anchor_hash is distinct from anchor then 'portrait_expression_stale_confirmed' else 'portrait_expression_selected' end,a.id,jsonb_build_object('slot',p_slot,'candidateId',c.id,'neutralAnchorHash',anchor));
  end if;
  return jsonb_build_object('slot',p_slot,'candidateId',c.id,'assetId',a.id,'revision',d.revision+1,'selectedBySlot',(select selected_portrait_slots from private.npc_drafts where id=d.id));
end $$;

-- The historical signature selects Neutral.  It intentionally preserves the
-- original external API for the retained single-portrait editor.
create or replace function public.npc_author_select_portrait(p_npc_id uuid,p_expected_revision bigint,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
  select id into c from private.npc_portrait_candidates where npc_id=p_npc_id and owner_id=auth.uid() and asset_id=p_asset_id;
  if c is null then raise sqlstate 'PT422' using message='Portrait candidate is unavailable'; end if;
  return public.npc_author_select_portrait(p_npc_id,p_expected_revision,'neutral',c,false);
end $$;
create or replace function private.npc_portrait_generation_status_dto(p_job_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('jobId',j.id,'npcId',j.npc_id,'slot',j.request#>>'{payload,slot}','status',j.status,'errorCode',j.error_code,'visualInputHash',j.request#>>'{payload,visualInputHash}',
    'alternatives',(select coalesce(jsonb_agg(jsonb_build_object('ordinal',a.ordinal,'stage',case when a.status in ('claimed','dispatched') then 'generating' when a.status='ready' then 'completed' else a.status end,'status',a.status,'candidateId',a.candidate_id,'errorCode',a.error_code) order by a.ordinal),'[]'::jsonb) from private.npc_portrait_generation_attempts a where a.job_id=j.id),
    'candidates',(select coalesce(jsonb_agg(private.npc_portrait_candidate_dto(c) order by c.ordinal),'[]'::jsonb) from private.npc_portrait_candidates c where c.job_id=j.id),'createdAt',j.created_at,'completedAt',j.completed_at)
  from private.npc_generation_jobs j where j.id=p_job_id
$$;

create or replace function public.npc_portrait_complete_generation_attempt(p_attempt_id uuid,p_lease_token uuid,p_result jsonb,p_error_code text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.npc_portrait_generation_attempts; terminal_count integer; ready_count integer; item jsonb; asset uuid; job private.npc_generation_jobs;
begin
  perform private.npc_assert_service(); select * into a from private.npc_portrait_generation_attempts where id=p_attempt_id for update;
  if not found or a.lease_token<>p_lease_token or a.status not in ('claimed','dispatched') or a.lease_expires_at<now() then raise sqlstate 'PT409' using message='Generation lease is unavailable'; end if;
  select * into job from private.npc_generation_jobs where id=a.job_id;
  item:=coalesce(p_result->'candidate','{}'::jsonb);
  if p_error_code is null and (item->>'storageKey' is null or item->>'masterStorageKey' is null or item->>'masterSha256' !~ '^[0-9a-f]{64}$'
    or item->>'sha256' !~ '^[0-9a-f]{64}$' or item->>'mimeType'<>'image/webp' or item->>'width'<>'1024' or item->>'height'<>'1536'
    or item->>'byteSize' !~ '^[0-9]+$' or (item->>'byteSize')::integer not between 1 and 524288 or coalesce((item->>'alphaValid')::boolean,false) is not true) then
    p_error_code:='INVALID_ALPHA_OR_OUTPUT';
  end if;
  if p_error_code is null then
    insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by,media_state,mime_type,width,height,byte_size,sha256,alpha_valid,visual_input_hash,provider,model,style_version,reference_set_version,prompt_hash)
    values(job.npc_id,'portrait',item->>'storageKey',coalesce(item->>'altText','Generated expression sprite'),jsonb_build_object('masterStorageKey',item->>'masterStorageKey','masterSha256',item->>'masterSha256','providerRequestId',item->>'requestId'),job.requested_by,'ready','image/webp',1024,1536,(item->>'byteSize')::integer,item->>'sha256',true,job.request#>>'{payload,visualInputHash}',item->>'provider',item->>'model','community-npc-portrait-sprite-v1','brac-character-look-v1',item->>'promptHash') returning id into asset;
    update private.npc_portrait_candidates set asset_id=asset,state='ready',failure_code=null,completed_at=now() where id=a.candidate_id;
  elsif a.status='claimed' and p_result->>'stage'='pre_dispatch_failed' and a.infrastructure_attempts<3 then
    -- No provider call was made. Preserve the diagnostic for the worker but
    -- make the attempt eligible for the bounded infrastructure retry.
    update private.npc_portrait_candidates set state='generating',failure_code=p_error_code where id=a.candidate_id;
  else
    update private.npc_portrait_candidates set state='failed',failure_code=p_error_code,completed_at=now() where id=a.candidate_id;
  end if;
  update private.npc_portrait_generation_attempts set status=case
      when p_error_code is null then 'ready'
      when a.status='claimed' and p_result->>'stage'='pre_dispatch_failed' and a.infrastructure_attempts<3 then 'queued'
      when a.status='dispatched' and p_result->>'stage'='ambiguous_after_dispatch' then 'ambiguous'
      else 'failed' end,
    error_code=p_error_code,result=coalesce(p_result,'{}'::jsonb),completed_at=case when p_error_code is null or a.status='dispatched' or a.infrastructure_attempts>=3 then now() else null end,
    lease_expires_at=null,lease_token=null where id=a.id;
  select count(*),count(*) filter(where status='ready') into terminal_count,ready_count from private.npc_portrait_generation_attempts where job_id=a.job_id and status in ('ready','failed','ambiguous','cancelled');
  if terminal_count=(select count(*) from private.npc_portrait_generation_attempts where job_id=a.job_id) then
    update private.npc_generation_jobs set status=case when ready_count>0 then 'completed' else 'failed' end,completed_at=now(),result=jsonb_build_object('candidateCount',ready_count,'failedCount',terminal_count-ready_count) where id=a.job_id;
  end if;
  return private.npc_portrait_generation_status_dto(a.job_id);
end $$;

create or replace function public.npc_author_portrait_status(p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs;
begin
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='portrait';
  if not found or j.requested_by<>auth.uid() or not private.npc_is_owner(j.npc_id) then raise sqlstate 'PT404'; end if;
  return private.npc_portrait_generation_status_dto(j.id);
end $$;

-- The SSE/poll path intentionally avoids candidate DTOs, which mint preview
create or replace function public.npc_author_expression_sprite_workspace(p_npc_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; provider private.npc_portrait_provider_status; usage private.npc_author_usage; active_job uuid;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT404' using message='Expression sprite workspace is unavailable'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id order by version_number desc limit 1;
  if not found then raise sqlstate 'PT404' using message='Expression sprite workspace is unavailable'; end if;
  select * into provider from private.npc_portrait_provider_status where singleton;
  select * into usage from private.npc_author_usage where user_id=auth.uid() and usage_day=current_date;
  select j.id into active_job from private.npc_generation_jobs j
    where j.npc_id=p_npc_id and j.requested_by=auth.uid() and j.request->>'kind'='portrait' and j.status in ('queued','running') order by j.created_at desc limit 1;
  return jsonb_build_object(
    'npcId',p_npc_id,'draftId',d.id,'revision',d.revision,'editable',d.state='open',
    'selectedBySlot',d.selected_portrait_slots,
    'resolvedBySlot',case when d.selected_portrait_slots ? 'neutral' then private.npc_resolved_portrait_slots(d.selected_portrait_slots) else '{}'::jsonb end,
    'neutralAnchor',d.selected_portrait_slots->'neutral',
    'candidates',(select coalesce(jsonb_agg(private.npc_portrait_candidate_dto(c) order by c.expression_slot,c.created_at desc,c.ordinal),'[]'::jsonb) from private.npc_portrait_candidates c where c.draft_id=d.id and c.owner_id=auth.uid() and c.state<>'discarded'),
    'activeJob',case when active_job is null then null else private.npc_portrait_generation_status_dto(active_job) end,
    'provider',jsonb_build_object('available',coalesce(provider.available and provider.expires_at>now() and provider.provider='openai',false),'reason',provider.failure_code,'styleVersion','community-npc-portrait-sprite-v1'),
    'remainingCredits',greatest(0,private.npc_quota(auth.uid(),'portrait')-coalesce(usage.portrait_credits,0))
  );
end $$;

-- Submitted versions receive an immutable resolved map.  Optional fallbacks
-- point at Neutral by asset ID rather than duplicate media.
create or replace function private.npc_resolved_portrait_slots(p_slots jsonb) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_object_agg(slot,case when p_slots ? slot then p_slots->slot else (p_slots->'neutral') || jsonb_build_object('fallbackFrom','neutral') end)
  from unnest(array['neutral','happy','sad','angry','engaged','leaving']) slot
$$;

-- New submission wrapper contains the full map. Existing submitted v1 rows
-- stay valid through the backfill above.
create or replace function public.npc_author_submit(p_npc_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; v uuid; slots jsonb; selected jsonb; slot text; c private.npc_portrait_candidates; a private.npc_assets; visual_hash text;
begin
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found or d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.assert_npc_author(d.sheet,true); perform private.validate_npc_sheet_v2(d.sheet);
  if d.selected_scene_asset_id is null or not exists(
    select 1 from private.npc_assets a0 join private.npc_setting_library s on s.id=a0.setting_library_id
    where a0.id=d.selected_scene_asset_id and s.state='active' and s.verified_at is not null
  ) then raise sqlstate 'PT422' using message='Choose a curated setting before submission'; end if;
  if d.selected_portrait_slots#>>'{neutral,assetId}' is null then raise sqlstate 'PT422' using message='Select a current Neutral sprite before submission'; end if;
  visual_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls);
  for slot,selected in select key,value from jsonb_each(d.selected_portrait_slots) loop
    if slot not in ('neutral','happy','sad','angry','engaged','leaving') then raise sqlstate 'PT422' using message='Sprite slot is invalid'; end if;
    select * into c from private.npc_portrait_candidates where id=(selected->>'candidateId')::uuid for update;
    select * into a from private.npc_assets where id=(selected->>'assetId')::uuid;
    if not found or c.npc_id<>p_npc_id or c.draft_id<>d.id or c.owner_id<>auth.uid() or c.expression_slot<>slot or c.state<>'selected'
      or c.asset_id<>a.id or c.visual_input_hash<>visual_hash or a.media_state<>'selected' or not a.alpha_valid or a.visual_input_hash<>visual_hash
      or (slot<>'neutral' and (selected->>'neutralAnchorHash' is distinct from d.selected_portrait_slots#>>'{neutral,assetHash}'
        or selected->>'neutralAnchorAssetId' is distinct from d.selected_portrait_slots#>>'{neutral,assetId}')) then
      raise sqlstate 'PT422' using message='Select current valid sprites before submission';
    end if;
  end loop;
  slots:=private.npc_resolved_portrait_slots(d.selected_portrait_slots);
  insert into private.npc_versions(npc_id,version_number,schema_version,sheet,sheet_hash,state,submitted_at,created_by,selected_scene_asset_id,selected_portrait_asset_id,portrait_slots)
  values(p_npc_id,d.version_number,'npc-sheet-v2',d.sheet,encode(extensions.digest(d.sheet::text,'sha256'),'hex'),'submitted',now(),auth.uid(),d.selected_scene_asset_id,(d.selected_portrait_slots#>>'{neutral,assetId}')::uuid,slots) returning id into v;
  update private.npc_assets set version_id=v where id in (select (value->>'assetId')::uuid from jsonb_each(slots));
  update private.npc_drafts set submitted_version_id=v,state='submitted' where id=d.id;
  update private.npc_identities set status='submitted' where id=p_npc_id;
  insert into private.npc_evaluations(npc_id,version_id,evaluator_version) values(p_npc_id,v,'community-eval-v1');
  insert into private.npc_notifications(user_id,kind,payload) values(auth.uid(),'submission_received',jsonb_build_object('npcId',p_npc_id,'versionId',v));
  return jsonb_build_object('npcId',p_npc_id,'versionId',v,'state','submitted','resolvedSprites',slots);
end $$;

revoke all on function public.npc_author_select_portrait(uuid,bigint,text,uuid,boolean),public.npc_author_expression_sprite_workspace(uuid),public.npc_author_portrait_status(uuid),public.npc_portrait_complete_generation_attempt(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.npc_author_select_portrait(uuid,bigint,text,uuid,boolean),public.npc_author_expression_sprite_workspace(uuid),public.npc_author_portrait_status(uuid) to authenticated;
grant execute on function public.npc_portrait_complete_generation_attempt(uuid,uuid,jsonb,text) to service_role;
commit;
