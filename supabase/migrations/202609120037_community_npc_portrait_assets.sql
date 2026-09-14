-- Community NPC portrait sprites and curated setting library.  Provider and
-- storage work happen in server code; this migration owns the immutable,
-- authorization-safe contract and never accepts creator supplied object keys.
begin;

alter table private.npc_author_usage
  add column if not exists portrait_credits integer not null default 0;
alter table private.npc_author_usage
  add constraint npc_author_usage_portrait_credits_nonnegative check (portrait_credits >= 0);
alter table private.npc_quota_overrides
  add column if not exists max_portrait_daily integer check (max_portrait_daily between 1 and 100);

alter table private.npc_drafts
  add column if not exists selected_portrait_asset_id uuid references private.npc_assets(id),
  add column if not exists portrait_controls jsonb not null default '{"pose":"automatic","expression":"from_sheet","clothingCondition":"from_sheet","optionalItem":null,"compositionNote":null}'::jsonb;
alter table private.npc_versions
  add column if not exists selected_portrait_asset_id uuid references private.npc_assets(id);

alter table private.npc_assets
  add column if not exists setting_library_id uuid,
  add column if not exists media_state text not null default 'ready',
  add column if not exists mime_type text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists byte_size integer,
  add column if not exists sha256 text,
  add column if not exists alpha_valid boolean,
  add column if not exists visual_input_hash text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists style_version text,
  add column if not exists reference_set_version text,
  add column if not exists prompt_hash text,
  add column if not exists purged_at timestamptz;

alter table private.npc_assets
  add constraint npc_assets_media_state_check check (media_state in ('ready','stale','selected','superseded','quarantined','purged')),
  add constraint npc_assets_portrait_metadata_check check (
    kind <> 'portrait' or (
      mime_type = 'image/webp' and width = 1024 and height = 1536
      and byte_size between 1 and 524288 and sha256 ~ '^[0-9a-f]{64}$'
      and alpha_valid is true and visual_input_hash ~ '^[0-9a-f]{64}$'
      and style_version = 'community-npc-portrait-sprite-v1'
      and reference_set_version = 'brac-character-look-v1'
    )
  );

create table private.npc_setting_library (
  id uuid primary key,
  setting_key text not null unique check (setting_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null check (char_length(trim(label)) between 2 and 80),
  description text not null check (char_length(trim(description)) between 10 and 500),
  alt_text text not null check (char_length(trim(alt_text)) between 10 and 500),
  storage_key text not null unique check (char_length(storage_key) between 3 and 500),
  mime_type text not null default 'image/webp' check (mime_type='image/webp'),
  width integer not null default 1600 check (width > 0),
  height integer not null default 900 check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'active' check (state in ('active','quarantined','purged')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table private.npc_assets
  add constraint npc_assets_setting_library_fk foreign key(setting_library_id) references private.npc_setting_library(id);
create unique index npc_one_setting_reference_per_npc on private.npc_assets(npc_id,setting_library_id) where setting_library_id is not null;

create table private.npc_portrait_provider_status (
  singleton boolean primary key default true check (singleton),
  provider text not null default 'openai', model text not null default 'gpt-image-2',
  available boolean not null default false, failure_code text,
  checked_at timestamptz not null default now(), expires_at timestamptz not null default now()
);
insert into private.npc_portrait_provider_status(singleton) values(true) on conflict do nothing;

create table private.npc_portrait_preview_grants (
  token uuid primary key default extensions.gen_random_uuid(),
  asset_id uuid not null references private.npc_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '10 minutes',
  created_at timestamptz not null default now()
);
create index npc_portrait_preview_grants_active on private.npc_portrait_preview_grants(user_id,expires_at desc);
create table private.npc_portrait_deletion_targets (
  asset_id uuid primary key references private.npc_assets(id) on delete cascade,
  derivative_storage_key text not null,
  master_storage_key text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  completed_at timestamptz
);

-- These identify library entries without including any source-media content.
-- The fixture/media pipeline uploads ignored local derivatives under these keys.
insert into private.npc_setting_library(id,setting_key,label,description,alt_text,storage_key,sha256) values
  ('c0370000-0000-4000-8000-000000000001','lantern-lit-tavern-table','Lantern-lit tavern table','A warm, intimate tavern table with a lantern and timber shelves behind it.','A lantern-lit tavern table with empty chairs and no characters.','community-settings/lantern-lit-tavern-table.webp','0000000000000000000000000000000000000000000000000000000000000001'),
  ('c0370000-0000-4000-8000-000000000002','hearth-side-booth','Hearth-side booth','A quiet booth near the hearth with amber light across dark timber.','A hearth-side tavern booth with no characters.','community-settings/hearth-side-booth.webp','0000000000000000000000000000000000000000000000000000000000000002'),
  ('c0370000-0000-4000-8000-000000000003','quiet-window-table','Quiet window table','A secluded table beside a rain-softened tavern window.','A quiet tavern window table with no characters.','community-settings/quiet-window-table.webp','0000000000000000000000000000000000000000000000000000000000000003')
on conflict (id) do nothing;

create or replace function public.npc_author_set_portrait_provider_status(p_available boolean,p_provider text,p_model text,p_failure_code text default null,p_expires_in_seconds integer default 60)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.npc_assert_service();
  if p_provider not in ('openai','local') or char_length(trim(p_model)) not between 1 and 100 or p_expires_in_seconds not between 1 and 600 then
    raise sqlstate 'PT400' using message='Portrait provider status is invalid';
  end if;
  update private.npc_portrait_provider_status set available=p_available,provider=p_provider,model=p_model,failure_code=case when p_available then null else nullif(trim(p_failure_code),'') end,checked_at=now(),expires_at=now()+make_interval(secs=>p_expires_in_seconds) where singleton;
end $$;

create or replace function public.npc_author_register_setting_asset(p_setting_id uuid,p_storage_key text,p_mime_type text,p_width integer,p_height integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare setting private.npc_setting_library;
begin
  perform private.npc_assert_service();
  select * into setting from private.npc_setting_library where id=p_setting_id for update;
  if not found or setting.state <> 'active' then raise sqlstate 'PT404' using message='Setting library entry unavailable'; end if;
  if p_mime_type<>'image/webp' or p_width<>1600 or p_height<>900 or p_sha256 !~ '^[0-9a-f]{64}$' or length(trim(p_storage_key)) not between 3 and 500 then
    raise sqlstate 'PT422' using message='Setting derivative metadata is invalid';
  end if;
  update private.npc_setting_library set storage_key=p_storage_key,mime_type=p_mime_type,width=p_width,height=p_height,sha256=p_sha256,verified_at=now() where id=setting.id;
  return jsonb_build_object('settingId',setting.id,'verifiedAt',now());
end $$;

create table private.npc_portrait_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references private.npc_generation_jobs(id) on delete cascade,
  npc_id uuid not null references private.npc_identities(id) on delete cascade,
  draft_id uuid not null references private.npc_drafts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid references private.npc_assets(id) on delete set null,
  ordinal integer not null check (ordinal between 1 and 4),
  state text not null default 'generating' check (state in ('generating','ready','failed','stale','selected','superseded','quarantined','purged')),
  visual_input_hash text not null check (visual_input_hash ~ '^[0-9a-f]{64}$'),
  source_revision bigint not null check (source_revision >= 0),
  failure_code text,
  expires_at timestamptz,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(job_id,ordinal), unique(asset_id)
);
create index npc_portrait_candidates_owner_current on private.npc_portrait_candidates(owner_id,npc_id,visual_input_hash,created_at desc);

create or replace function private.npc_quota(p_user uuid,p_kind text) returns integer language sql stable security definer set search_path='' as $$
  select case p_kind
    when 'open' then coalesce((select max_open_drafts from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),5)
    when 'published' then coalesce((select max_published from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),10)
    when 'assist' then coalesce((select max_assist_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),30)
    when 'scene' then coalesce((select max_scene_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),10)
    when 'sandbox' then coalesce((select max_sandbox_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),20)
    when 'portrait' then coalesce((select max_portrait_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),10)
  end
$$;

create or replace function private.npc_normalize_portrait_controls(p_controls jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_item text; v_note text; v jsonb;
begin
  if jsonb_typeof(p_controls) <> 'object' then raise sqlstate 'PT400' using message='Portrait controls are invalid'; end if;
  v := jsonb_build_object(
    'pose',coalesce(p_controls->>'pose','automatic'),
    'expression',coalesce(p_controls->>'expression','from_sheet'),
    'clothingCondition',coalesce(p_controls->>'clothingCondition','from_sheet'),
    'optionalItem',nullif(trim(coalesce(p_controls->>'optionalItem','')),''),
    'compositionNote',nullif(regexp_replace(trim(coalesce(p_controls->>'compositionNote','')),'\\s+',' ','g'),'')
  );
  if v->>'pose' not in ('automatic','relaxed','confident','guarded','working')
    or v->>'expression' not in ('from_sheet','warm','wary','determined','thoughtful','stern')
    or v->>'clothingCondition' not in ('from_sheet','well_kept','patched','road_worn') then
    raise sqlstate 'PT400' using message='Portrait controls are invalid';
  end if;
  v_item:=v->>'optionalItem'; v_note:=v->>'compositionNote';
  if v_item is not null and char_length(v_item) not between 1 and 120 then raise sqlstate 'PT400' using message='Portrait item is invalid'; end if;
  if v_note is not null and char_length(v_note) not between 1 and 240 then raise sqlstate 'PT400' using message='Portrait composition note is invalid'; end if;
  return v;
end $$;

create or replace function private.npc_visual_input_hash(p_sheet jsonb,p_controls jsonb)
returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(jsonb_build_object(
    'identity',jsonb_build_object('name',p_sheet#>>'{identity,name}','title',p_sheet#>>'{identity,title}','shortDescription',p_sheet#>>'{identity,shortDescription}'),
    'appearance',jsonb_build_object('physicalAppearance',p_sheet#>>'{appearance,physicalAppearance}','attire',p_sheet#>>'{appearance,attire}','notableFeatures',p_sheet#>>'{appearance,notableFeatures}','mood',p_sheet#>>'{appearance,mood}'),
    'personality',jsonb_build_object('values',p_sheet#>'{personality,values}','likes',p_sheet#>'{personality,likes}','dislikes',p_sheet#>'{personality,dislikes}','boundaries',p_sheet#>'{personality,boundaries}'),
    'rating',p_sheet->>'rating','controls',private.npc_normalize_portrait_controls(p_controls),
    'styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1'
  )::text,'sha256'),'hex')
$$;

create or replace function private.npc_mark_portraits_stale(p_draft_id uuid,p_visual_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update private.npc_portrait_candidates set state='stale',expires_at=coalesce(expires_at,now()+interval '30 days')
    where draft_id=p_draft_id and state in ('generating','ready','selected') and visual_input_hash<>p_visual_hash;
  update private.npc_assets set media_state='stale' where id in (select asset_id from private.npc_portrait_candidates where draft_id=p_draft_id and visual_input_hash<>p_visual_hash and asset_id is not null)
    and media_state not in ('quarantined','purged');
end $$;

create or replace function private.npc_version_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.state in ('submitted','published','retired','rejected') then raise exception 'NPC version is immutable once submitted'; end if;
  if tg_op='UPDATE' and old.state in ('submitted','published','retired','rejected')
    and (new.npc_id<>old.npc_id or new.version_number<>old.version_number or new.schema_version<>old.schema_version
      or new.sheet<>old.sheet or new.sheet_hash<>old.sheet_hash or new.created_by is distinct from old.created_by
      or new.selected_scene_asset_id is distinct from old.selected_scene_asset_id
      or new.selected_portrait_asset_id is distinct from old.selected_portrait_asset_id)
    then raise exception 'NPC version content is immutable once submitted'; end if;
  return new;
end $$;

create or replace function public.npc_author_save(p_npc_id uuid,p_expected_revision bigint,p_sheet jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; old_hash text; new_hash text;
begin
  perform private.assert_npc_author(p_sheet,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may edit this NPC'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found or d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.assert_npc_sheet(p_sheet);
  old_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls);
  new_hash:=private.npc_visual_input_hash(p_sheet,d.portrait_controls);
  update private.npc_drafts set sheet=p_sheet,revision=revision+1,updated_at=now(),selected_portrait_asset_id=case when old_hash<>new_hash then null else selected_portrait_asset_id end where id=d.id;
  if old_hash<>new_hash then perform private.npc_mark_portraits_stale(d.id,new_hash); end if;
  perform private.npc_author_invalidate_sandboxes(d.id);
  update private.npc_identities set normalized_name=lower(regexp_replace(trim(p_sheet#>>'{identity,name}'),'\\s+',' ','g')),rating=p_sheet->>'rating',updated_at=now() where id=p_npc_id;
  return jsonb_build_object('npcId',p_npc_id,'draftId',d.id,'revision',p_expected_revision+1,'visualInputHash',new_hash,'portraitInvalidated',old_hash<>new_hash);
end $$;

create or replace function public.npc_author_list_settings() returns jsonb language sql stable security definer set search_path='' as $$
  select case when private.has_npc_capability('npc_author') then coalesce(jsonb_agg(jsonb_build_object('id',id,'key',setting_key,'label',label,'description',description,'altText',alt_text,'dimensions',jsonb_build_object('width',width,'height',height)) order by setting_key),'[]'::jsonb) else '[]'::jsonb end
  from private.npc_setting_library where state='active' and verified_at is not null
$$;

create or replace function public.npc_author_select_setting(p_npc_id uuid,p_expected_revision bigint,p_setting_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; setting private.npc_setting_library; asset uuid;
begin
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  select * into setting from private.npc_setting_library where id=p_setting_id and state='active' and verified_at is not null;
  if not found then raise sqlstate 'PT422' using message='This curated setting is unavailable'; end if;
  select id into asset from private.npc_assets where npc_id=p_npc_id and setting_library_id=setting.id;
  if asset is null then
    insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by,setting_library_id,mime_type,width,height,sha256,media_state)
    values(p_npc_id,'scene',setting.storage_key,setting.alt_text,jsonb_build_object('settingKey',setting.setting_key,'library',true),auth.uid(),setting.id,setting.mime_type,setting.width,setting.height,setting.sha256,'ready') returning id into asset;
  end if;
  update private.npc_drafts set selected_scene_asset_id=asset,revision=revision+1,updated_at=now() where id=d.id;
  perform private.npc_governance_log(p_npc_id,'setting_selected',asset,jsonb_build_object('settingKey',setting.setting_key));
  return jsonb_build_object('assetId',asset,'settingId',setting.id,'revision',d.revision+1);
end $$;

create or replace function public.npc_author_request_portrait(p_npc_id uuid,p_expected_revision bigint,p_controls jsonb,p_alternatives integer default 2)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; controls jsonb; visual_hash text; usage private.npc_author_usage; lim integer; job uuid; source_revision bigint;
begin
  if p_alternatives not between 1 and 4 then raise sqlstate 'PT400' using message='Choose one to four portrait alternatives'; end if;
  if not exists(select 1 from private.npc_portrait_provider_status where singleton and available and expires_at>now() and provider='openai') then
    raise sqlstate 'PT503' using message='Portrait image provider is unavailable';
  end if;
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  controls:=private.npc_normalize_portrait_controls(p_controls);
  if controls->>'optionalItem' is not null and position(lower(controls->>'optionalItem') in lower(concat_ws(' ',d.sheet#>>'{appearance,attire}',d.sheet#>>'{appearance,notableFeatures}')))=0 then
    raise sqlstate 'PT400' using message='Portrait item must be drawn from attire or notable features';
  end if;
  visual_hash:=private.npc_visual_input_hash(d.sheet,controls);
  if controls is distinct from d.portrait_controls then
    update private.npc_drafts set portrait_controls=controls,selected_portrait_asset_id=null,revision=revision+1,updated_at=now() where id=d.id;
    perform private.npc_mark_portraits_stale(d.id,visual_hash);
    source_revision:=d.revision+1;
  else source_revision:=d.revision; end if;
  insert into private.npc_author_usage(user_id,usage_day) values(auth.uid(),current_date) on conflict do nothing;
  select * into usage from private.npc_author_usage where user_id=auth.uid() and usage_day=current_date for update;
  lim:=private.npc_quota(auth.uid(),'portrait');
  if usage.portrait_credits+p_alternatives>lim then raise sqlstate 'PT429' using message='Not enough portrait image credits remain today'; end if;
  update private.npc_author_usage set portrait_credits=portrait_credits+p_alternatives where user_id=auth.uid() and usage_day=current_date;
  insert into private.npc_generation_jobs(npc_id,requested_by,prompt_version,request,status)
    values(p_npc_id,auth.uid(),'community-npc-portrait-sprite-v1',jsonb_build_object('kind','portrait','draftId',d.id,'draftRevision',source_revision,'payload',jsonb_build_object('controls',controls,'alternatives',p_alternatives,'visualInputHash',visual_hash,'styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1')),'queued') returning id into job;
  insert into private.npc_portrait_candidates(job_id,npc_id,draft_id,owner_id,ordinal,visual_input_hash,source_revision)
    select job,p_npc_id,d.id,auth.uid(),n,visual_hash,source_revision from generate_series(1,p_alternatives) n;
  perform private.npc_governance_log(p_npc_id,'portrait_requested',job,jsonb_build_object('alternatives',p_alternatives,'visualInputHash',visual_hash));
  return jsonb_build_object('jobId',job,'draftId',d.id,'draftRevision',source_revision,'visualInputHash',visual_hash,'requestedAlternatives',p_alternatives,'remainingCredits',lim-usage.portrait_credits-p_alternatives,'status','queued');
end $$;

create or replace function private.npc_issue_portrait_preview_token(p_asset_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_token uuid;
begin
  if p_asset_id is null or not exists(select 1 from private.npc_assets where id=p_asset_id and media_state not in ('quarantined','purged')) then return null; end if;
  insert into private.npc_portrait_preview_grants(asset_id,user_id) values(p_asset_id,auth.uid()) returning token into v_token;
  return v_token;
end $$;

create or replace function private.npc_portrait_candidate_dto(p_candidate private.npc_portrait_candidates)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('id',p_candidate.id,'assetId',p_candidate.asset_id,'ordinal',p_candidate.ordinal,'state',p_candidate.state,
    'previewToken',case when p_candidate.asset_id is null or p_candidate.state in ('quarantined','purged') then null else private.npc_issue_portrait_preview_token(p_candidate.asset_id)::text end,
    'altText',coalesce(a.alt_text,''),'dimensions',case when a.id is null then null else jsonb_build_object('width',a.width,'height',a.height) end,
    'alphaValid',coalesce(a.alpha_valid,false),'styleVersion',a.style_version,'visualInputHash',p_candidate.visual_input_hash,
    'failureCode',p_candidate.failure_code,'createdAt',p_candidate.created_at,'completedAt',p_candidate.completed_at)
  from private.npc_assets a where a.id=p_candidate.asset_id
  union all select jsonb_build_object('id',p_candidate.id,'assetId',null,'ordinal',p_candidate.ordinal,'state',p_candidate.state,'previewToken',null,'altText','','dimensions',null,'alphaValid',false,'styleVersion',null,'visualInputHash',p_candidate.visual_input_hash,'failureCode',p_candidate.failure_code,'createdAt',p_candidate.created_at,'completedAt',p_candidate.completed_at)
    where p_candidate.asset_id is null
  limit 1
$$;

create or replace function public.npc_author_portrait_preview_authorization(p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare grant_row private.npc_portrait_preview_grants;
begin
  select * into grant_row from private.npc_portrait_preview_grants where token=p_token and user_id=auth.uid() and expires_at>now();
  if not found or not exists(select 1 from private.npc_assets where id=grant_row.asset_id and media_state not in ('quarantined','purged')) then raise sqlstate 'PT404' using message='Portrait preview is unavailable'; end if;
  return jsonb_build_object('assetId',grant_row.asset_id,'expiresAt',grant_row.expires_at);
end $$;

create or replace function public.npc_author_portrait_preview_target(p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare asset private.npc_assets;
begin
  perform private.npc_assert_service();
  select * into asset from private.npc_assets where id=p_asset_id and kind='portrait' and media_state not in ('quarantined','purged');
  if not found then raise sqlstate 'PT404' using message='Portrait media is unavailable'; end if;
  return jsonb_build_object('storageKey',asset.storage_key,'mimeType',asset.mime_type,'byteSize',asset.byte_size,'sha256',asset.sha256);
end $$;

create or replace function private.npc_portrait_asset_redaction_state() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.kind='portrait' and (new.media_state='purged' or new.storage_key like 'redacted/%') then
    if old.storage_key not like 'redacted/%' then
      insert into private.npc_portrait_deletion_targets(asset_id,derivative_storage_key,master_storage_key)
      values(old.id,old.storage_key,old.generation->>'masterStorageKey') on conflict(asset_id) do nothing;
    end if;
    new.media_state:='purged'; new.purged_at:=coalesce(new.purged_at,now());
    new.storage_key:='redacted/portrait/'||old.id::text;
    new.generation:=jsonb_build_object('redacted',true);
    new.prompt_hash:=null; new.provider:=null; new.model:=null; new.reference_set_version:=null;
  end if;
  return new;
end $$;
drop trigger if exists npc_portrait_asset_redaction_state on private.npc_assets;
create trigger npc_portrait_asset_redaction_state before update on private.npc_assets for each row execute function private.npc_portrait_asset_redaction_state();

create or replace function public.npc_admin_quarantine_or_purge(p_npc uuid,p_purge boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_npc_reviewer(p_npc); if length(trim(p_reason))<3 then raise sqlstate 'PT400'; end if;
  update private.npc_assets set media_state=case when p_purge then 'purged' else 'quarantined' end,purged_at=case when p_purge then now() else purged_at end where npc_id=p_npc and kind='portrait' and media_state not in ('purged');
  update private.npc_identities set status=case when p_purge then 'banned' else 'paused' end,purged_at=case when p_purge then now() end where id=p_npc;
  insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason) select w.save_id,w.npc_id,w.version_id,case when p_purge then 'banned' else 'quarantined' end from private.world_npc_instances w where w.npc_id=p_npc on conflict do nothing;
  update private.world_npc_instances set status=case when p_purge then 'removed' else 'quarantined' end where npc_id=p_npc;
end $$;

create or replace function public.npc_portrait_next_deletion_target()
returns jsonb language plpgsql security definer set search_path='' as $$
declare target private.npc_portrait_deletion_targets; claim uuid:=extensions.gen_random_uuid();
begin
  perform private.npc_assert_service();
  select * into target from private.npc_portrait_deletion_targets
    where completed_at is null and (claim_token is null or claimed_at < now()-interval '15 minutes')
    order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update private.npc_portrait_deletion_targets set claimed_at=now(),claim_token=claim where asset_id=target.asset_id;
  return jsonb_build_object('assetId',target.asset_id,'claimToken',claim,'derivativeStorageKey',target.derivative_storage_key,'masterStorageKey',target.master_storage_key);
end $$;

create or replace function public.npc_portrait_deletion_complete(p_asset_id uuid,p_claim_token uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.npc_assert_service();
  update private.npc_portrait_deletion_targets set completed_at=now(),derivative_storage_key='redacted',master_storage_key=null
    where asset_id=p_asset_id and completed_at is null and claim_token=p_claim_token and claimed_at >= now()-interval '15 minutes';
  if not found then raise sqlstate 'PT409' using message='Portrait deletion claim is unavailable'; end if;
end $$;

create or replace function public.npc_author_portrait_status(p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs;
begin
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='portrait';
  if not found or j.requested_by<>auth.uid() or not private.npc_is_owner(j.npc_id) then raise sqlstate 'PT404'; end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'errorCode',j.error_code,'visualInputHash',j.request#>>'{payload,visualInputHash}',
    'candidates',(select coalesce(jsonb_agg(private.npc_portrait_candidate_dto(c) order by c.ordinal),'[]'::jsonb) from private.npc_portrait_candidates c where c.job_id=j.id),'createdAt',j.created_at,'completedAt',j.completed_at);
end $$;

create or replace function public.npc_author_select_portrait(p_npc_id uuid,p_expected_revision bigint,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; c private.npc_portrait_candidates; visual_hash text;
begin
  d:=private.npc_assert_draft_owner(p_npc_id,p_expected_revision);
  visual_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls);
  select * into c from private.npc_portrait_candidates where asset_id=p_asset_id and npc_id=p_npc_id and owner_id=auth.uid() for update;
  if not found or c.state not in ('ready','selected') or c.visual_input_hash<>visual_hash then raise sqlstate 'PT422' using message='Portrait does not match the current visual direction'; end if;
  if not exists(select 1 from private.npc_assets a where a.id=p_asset_id and a.media_state not in ('quarantined','purged') and a.alpha_valid and a.visual_input_hash=visual_hash) then raise sqlstate 'PT422' using message='Portrait is not mechanically valid'; end if;
  update private.npc_portrait_candidates set state=case when id=c.id then 'selected' else case when state='selected' then 'superseded' else state end end,selected_at=case when id=c.id then now() else selected_at end
    where draft_id=d.id and visual_input_hash=visual_hash and state in ('ready','selected');
  update private.npc_assets set media_state=case when id=p_asset_id then 'selected' when media_state='selected' then 'superseded' else media_state end
    where id in (select asset_id from private.npc_portrait_candidates where draft_id=d.id and visual_input_hash=visual_hash and asset_id is not null);
  update private.npc_drafts set selected_portrait_asset_id=p_asset_id,revision=revision+1,updated_at=now() where id=d.id;
  perform private.npc_governance_log(p_npc_id,'portrait_selected',p_asset_id,jsonb_build_object('visualInputHash',visual_hash));
  return jsonb_build_object('assetId',p_asset_id,'revision',d.revision+1,'visualInputHash',visual_hash);
end $$;

create or replace function public.npc_author_portrait_complete(p_job_id uuid,p_candidates jsonb,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.npc_generation_jobs; item jsonb; candidate private.npc_portrait_candidates; asset uuid; complete_count integer:=0; failed_count integer:=0; visual_hash text;
begin
  perform private.npc_assert_service();
  select * into j from private.npc_generation_jobs where id=p_job_id and request->>'kind'='portrait' for update;
  if not found or j.status not in ('queued','running') then raise sqlstate 'PT409' using message='Portrait job cannot be completed'; end if;
  visual_hash:=j.request#>>'{payload,visualInputHash}';
  if p_error_code is null and (jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)=0) then raise sqlstate 'PT422' using message='Portrait completion needs candidates'; end if;
  for candidate in select * from private.npc_portrait_candidates where job_id=j.id order by ordinal for update loop
    item:=coalesce((select value from jsonb_array_elements(coalesce(p_candidates,'[]'::jsonb)) where (value->>'ordinal')::integer=candidate.ordinal limit 1),'null'::jsonb);
    if p_error_code is not null or item='null'::jsonb or coalesce(item->>'failureCode','')<>'' then
      update private.npc_portrait_candidates set state='failed',failure_code=coalesce(p_error_code,item->>'failureCode','UNKNOWN_UPSTREAM_FAILURE'),completed_at=now() where id=candidate.id;
      failed_count:=failed_count+1;
    else
      if item->>'storageKey' is null or length(item->>'storageKey') not between 3 and 500 or item->>'masterStorageKey' is null or length(item->>'masterStorageKey') not between 3 and 500
        or item->>'masterSha256' !~ '^[0-9a-f]{64}$' or item->>'referenceSetHash' !~ '^[0-9a-f]{64}$' or length(coalesce(item->>'requestId','')) not between 1 and 200
        or item->>'altText' is null or length(item->>'altText') not between 10 and 500
        or item->>'mimeType'<>'image/webp' or item->>'width'<>'1024' or item->>'height'<>'1536' or item->>'byteSize' !~ '^[0-9]+$' or (item->>'byteSize')::integer not between 1 and 524288
        or item->>'sha256' !~ '^[0-9a-f]{64}$' or coalesce((item->>'alphaValid')::boolean,false) is not true or item->>'visualInputHash'<>visual_hash
        or item->>'styleVersion'<>'community-npc-portrait-sprite-v1' or item->>'referenceSetVersion'<>'brac-character-look-v1' then
        update private.npc_portrait_candidates set state='failed',failure_code='INVALID_ALPHA_OR_OUTPUT',completed_at=now() where id=candidate.id;
        failed_count:=failed_count+1;
      else
        insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by,media_state,mime_type,width,height,byte_size,sha256,alpha_valid,visual_input_hash,provider,model,style_version,reference_set_version,prompt_hash)
        values(j.npc_id,'portrait',item->>'storageKey',item->>'altText',jsonb_build_object('candidateOrdinal',candidate.ordinal,'masterStorageKey',item->>'masterStorageKey','masterSha256',item->>'masterSha256','referenceSetHash',item->>'referenceSetHash','providerRequestId',item->>'requestId'),j.requested_by,'ready','image/webp',1024,1536,(item->>'byteSize')::integer,item->>'sha256',true,visual_hash,item->>'provider',item->>'model','community-npc-portrait-sprite-v1','brac-character-look-v1',item->>'promptHash') returning id into asset;
        update private.npc_portrait_candidates set asset_id=asset,state='ready',completed_at=now(),expires_at=now()+interval '30 days' where id=candidate.id;
        complete_count:=complete_count+1;
      end if;
    end if;
  end loop;
  update private.npc_generation_jobs set status=case when complete_count>0 then 'completed' else 'failed' end,
    result=jsonb_build_object('candidateCount',complete_count,'failedCount',failed_count,'visualInputHash',visual_hash),error_code=case when complete_count>0 then null else coalesce(p_error_code,'INVALID_ALPHA_OR_OUTPUT') end,completed_at=now() where id=j.id;
  -- Completion runs under service_role, which has no author identity and must
  -- never mint creator preview grants.  The author status RPC creates those
  -- opaque, user-scoped grants on the subsequent authenticated read.
  return jsonb_build_object(
    'jobId',j.id,
    'status',case when complete_count>0 then 'completed' else 'failed' end,
    'visualInputHash',visual_hash,
    'candidateCount',complete_count,
    'failedCount',failed_count,
    'errorCode',case when complete_count>0 then null else coalesce(p_error_code,'INVALID_ALPHA_OR_OUTPUT') end,
    'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'assetId',c.asset_id,'ordinal',c.ordinal,'state',c.state,'failureCode',c.failure_code) order by c.ordinal),'[]'::jsonb) from private.npc_portrait_candidates c where c.job_id=j.id)
  );
end $$;

create or replace function public.npc_author_submit(p_npc_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; v uuid; visual_hash text;
begin
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found or d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.assert_npc_author(d.sheet,true); perform private.assert_npc_sheet(d.sheet);
  if d.selected_scene_asset_id is null or not exists(select 1 from private.npc_assets a join private.npc_setting_library s on s.id=a.setting_library_id where a.id=d.selected_scene_asset_id and s.state='active' and s.verified_at is not null) then raise sqlstate 'PT422' using message='Choose a curated setting before submission'; end if;
  visual_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls);
  if d.selected_portrait_asset_id is null or not exists(select 1 from private.npc_portrait_candidates c join private.npc_assets a on a.id=c.asset_id where c.asset_id=d.selected_portrait_asset_id and c.npc_id=p_npc_id and c.owner_id=auth.uid() and c.state='selected' and c.visual_input_hash=visual_hash and a.media_state='selected' and a.alpha_valid and a.visual_input_hash=visual_hash) then raise sqlstate 'PT422' using message='Select a current valid portrait before submission'; end if;
  insert into private.npc_versions(npc_id,version_number,schema_version,sheet,sheet_hash,state,submitted_at,created_by,selected_scene_asset_id,selected_portrait_asset_id)
    values(p_npc_id,d.version_number,'npc-sheet-v1',d.sheet,encode(extensions.digest(d.sheet::text,'sha256'),'hex'),'submitted',now(),auth.uid(),d.selected_scene_asset_id,d.selected_portrait_asset_id) returning id into v;
  update private.npc_assets set version_id=v where id in (d.selected_scene_asset_id,d.selected_portrait_asset_id);
  update private.npc_drafts set submitted_version_id=v,state='submitted' where id=d.id;
  update private.npc_identities set status='submitted' where id=p_npc_id;
  insert into private.npc_evaluations(npc_id,version_id,evaluator_version) values(p_npc_id,v,'community-eval-v1');
  insert into private.npc_notifications(user_id,kind,payload) values(auth.uid(),'submission_received',jsonb_build_object('npcId',p_npc_id,'versionId',v));
  return jsonb_build_object('npcId',p_npc_id,'versionId',v,'state','submitted');
end $$;

-- Preserve the v3 workspace fields while adding only safe art DTOs.
create or replace function public.npc_author_workspace_detail(p_npc_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; active_sandbox jsonb; retirement jsonb; usage private.npc_author_usage; editable boolean; submit_reason text; visual_hash text;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may use this workspace'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id order by version_number desc limit 1;
  editable:=coalesce(d.state='open',false); visual_hash:=private.npc_visual_input_hash(d.sheet,d.portrait_controls);
  submit_reason:=case when not editable then 'Draft is already submitted and read-only'
    when d.selected_scene_asset_id is null then 'Choose a setting before submitting'
    when d.selected_portrait_asset_id is null then 'Create and select a portrait before submitting'
    else null end;
  select jsonb_build_object('id',s.id,'draftRevision',s.based_on_revision,'frozenSheet',s.frozen_sheet,'state',case when s.invalidated_at is null then 'active' else 'invalidated' end,'invalidatedAt',s.invalidated_at,'pending',exists(select 1 from private.npc_sandbox_turns t where t.sandbox_id=s.id and t.status='pending'),'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ordinal',t.ordinal,'role',t.role,'content',t.content,'status',t.status,'createdAt',t.created_at,'completedAt',t.completed_at,'jobId',t.job_id) order by t.ordinal),'[]'::jsonb) from private.npc_sandbox_turns t where t.sandbox_id=s.id)) into active_sandbox from private.npc_sandboxes s where s.draft_id=d.id and s.invalidated_at is null order by s.created_at desc limit 1;
  select jsonb_build_object('id',r.id,'status',r.status,'reason',r.reason,'createdAt',r.created_at,'decidedAt',r.decided_at,'decisionReason',r.decision_reason) into retirement from private.npc_retirement_requests r where r.npc_id=p_npc_id order by r.created_at desc limit 1;
  select * into usage from private.npc_author_usage where user_id=auth.uid() and usage_day=current_date;
  return jsonb_build_object(
    'npcId',p_npc_id,
    'draft',jsonb_build_object('id',d.id,'revision',d.revision,'lifecycle',d.state,'editable',editable,'sheet',d.sheet,'fieldPaths',jsonb_build_array('identity.name','identity.title','identity.shortDescription','appearance','personality','lore','skills','campaign')),
    'capabilities',jsonb_build_object('canEdit',editable,'editReason',case when editable then null else 'Draft is read-only after submission' end,'canSubmit',editable and d.selected_scene_asset_id is not null and d.selected_portrait_asset_id is not null,'submitReason',submit_reason,'canRequestAssistance',editable,'assistanceReason',case when editable then null else 'Open a changes-requested draft before requesting assistance' end,'canUseSandbox',editable,'sandboxReason',case when editable then null else 'Sandbox is available only for an open draft' end,'canRequestRetirement',coalesce(retirement->>'status','') not in ('open','approved'),'retirementReason',case when retirement->>'status'='open' then 'A retirement request is already pending review' when retirement->>'status'='approved' then 'This NPC is already retired' else null end),
    'settings',jsonb_build_object('selectedAssetId',d.selected_scene_asset_id,'available',public.npc_author_list_settings(),'selected',(select jsonb_build_object('id',s.id,'key',s.setting_key,'label',s.label,'description',s.description,'altText',s.alt_text,'dimensions',jsonb_build_object('width',s.width,'height',s.height)) from private.npc_assets a join private.npc_setting_library s on s.id=a.setting_library_id where a.id=d.selected_scene_asset_id),'errorCode',case when exists(select 1 from private.npc_setting_library where state='active' and verified_at is not null) then null else 'SETTING_LIBRARY_UNAVAILABLE' end),
    'portrait',jsonb_build_object('providerAvailable',coalesce((select available and expires_at>now() and provider='openai' from private.npc_portrait_provider_status where singleton),false),'providerReason',(select failure_code from private.npc_portrait_provider_status where singleton),'styleLabel','Community portrait sprite','styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1','visualInputHash',visual_hash,'selectedAssetId',d.selected_portrait_asset_id,'selectedCandidateId',(select c.id from private.npc_portrait_candidates c where c.asset_id=d.selected_portrait_asset_id),'selected',(select private.npc_portrait_candidate_dto(c) from private.npc_portrait_candidates c where c.asset_id=d.selected_portrait_asset_id),'candidates',(select coalesce(jsonb_agg(private.npc_portrait_candidate_dto(c) order by c.created_at desc,c.ordinal),'[]'::jsonb) from private.npc_portrait_candidates c where c.draft_id=d.id),'activeBatch',(select jsonb_build_object('jobId',j.id,'status',case when j.status in ('queued','running') then 'generating' when j.status='completed' and coalesce((j.result->>'failedCount')::integer,0)>0 then 'partial' when j.status='completed' then 'ready' else 'failed' end,'errorCode',j.error_code,'visualInputHash',j.request#>>'{payload,visualInputHash}','requestedAlternatives',(j.request#>>'{payload,alternatives}')::integer,'completedCount',coalesce((j.result->>'candidateCount')::integer,0),'failedCount',coalesce((j.result->>'failedCount')::integer,0),'createdAt',j.created_at,'completedAt',j.completed_at) from private.npc_generation_jobs j where j.npc_id=p_npc_id and j.requested_by=auth.uid() and j.request->>'kind'='portrait' order by j.created_at desc limit 1),'remainingCredits',greatest(0,private.npc_quota(auth.uid(),'portrait')-coalesce(usage.portrait_credits,0))),
    'scenes',jsonb_build_object('selectedAssetId',d.selected_scene_asset_id,'candidates','[]'::jsonb,'selected',null),
    'eligibleNpcs',(select coalesce(jsonb_agg(jsonb_build_object('npcId',i.id,'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') order by lower(v.sheet#>>'{identity,name}')),'[]'::jsonb) from private.npc_identities i join private.npc_versions v on v.id=i.current_published_version_id where i.id<>p_npc_id and i.status in ('published','retired')),
    'assistance',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sectionPath',e.section_path,'sourceRevision',e.source_revision,'proposal',e.proposal,'disposition',e.disposition,'actionable',e.disposition='proposed' and e.source_revision=d.revision and editable,'errorCode',(select j.error_code from private.npc_generation_jobs j where j.request->>'assistanceEventId'=e.id::text order by j.created_at desc limit 1),'reason',case when e.disposition='failed' then 'The assistant could not produce a usable suggestion' when e.disposition in ('accepted','rejected') then 'Already decided' when e.source_revision<>d.revision then 'Out of date: the draft changed' when not editable then 'Draft is read-only' else null end,'createdAt',e.created_at,'decidedAt',e.decided_at) order by e.created_at desc),'[]'::jsonb) from private.npc_assistance_events e where e.draft_id=d.id),
    'sandbox',jsonb_build_object('active',active_sandbox,'preserved',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'draftRevision',s.based_on_revision,'invalidatedAt',s.invalidated_at,'state','invalidated','pending',false,'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ordinal',t.ordinal,'role',t.role,'content',t.content,'status',t.status,'createdAt',t.created_at,'completedAt',t.completed_at) order by t.ordinal),'[]'::jsonb) from private.npc_sandbox_turns t where t.sandbox_id=s.id)) order by s.updated_at desc),'[]'::jsonb) from private.npc_sandboxes s where s.draft_id=d.id and s.invalidated_at is not null)),
    'versions',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'number',v.version_number,'state',v.state,'submittedAt',v.submitted_at,'settingAssetId',v.selected_scene_asset_id,'portraitAssetId',v.selected_portrait_asset_id,'portraitAsset',(select jsonb_build_object('id',a.id,'dimensions',jsonb_build_object('width',a.width,'height',a.height),'alphaValid',a.alpha_valid,'styleVersion',a.style_version,'mediaResolution',case when a.media_state in ('quarantined','purged') then null else jsonb_build_object('assetId',a.id) end) from private.npc_assets a where a.id=v.selected_portrait_asset_id),'evaluation',coalesce((select jsonb_build_object('status',e.status,'hardBlocks',coalesce(e.result->'hardBlocks','[]'::jsonb),'advisories',coalesce(e.result->'advisories','[]'::jsonb),'completedAt',e.completed_at) from private.npc_evaluations e where e.version_id=v.id),jsonb_build_object('status','not_started','hardBlocks','[]'::jsonb,'advisories','[]'::jsonb)),'reviewerDecision',(select jsonb_build_object('decision',x.decision,'notes',x.notes,'createdAt',x.created_at) from private.npc_review_decisions x where x.version_id=v.id order by x.created_at desc limit 1),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'sectionPath',c.section_path,'body',c.body,'resolvedAt',c.resolved_at,'createdAt',c.created_at) order by c.created_at),'[]'::jsonb) from private.npc_section_comments c where c.version_id=v.id)) order by v.version_number desc),'[]'::jsonb) from private.npc_versions v where v.npc_id=p_npc_id),
    'retirement',retirement,'quota',jsonb_build_object('assistanceDaily',greatest(0,private.npc_quota(auth.uid(),'assist')-coalesce(usage.assistance_calls,0)),'sceneDaily',0,'sandboxDaily',greatest(0,private.npc_quota(auth.uid(),'sandbox')-coalesce(usage.sandbox_turns,0)),'portraitCredits',greatest(0,private.npc_quota(auth.uid(),'portrait')-coalesce(usage.portrait_credits,0)))
  );
end $$;

create or replace function public.npc_reviewer_submission(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.npc_versions;
begin
  select * into v from private.npc_versions where id=p_version_id and state='submitted'; if not found then raise sqlstate 'PT404'; end if;
  perform private.assert_npc_reviewer(v.npc_id);
  return jsonb_build_object('npcId',v.npc_id,'versionId',v.id,'sheet',v.sheet,'rating',(select rating from private.npc_identities where id=v.npc_id),'sceneAsset',(select jsonb_build_object('id',id,'altText',alt_text) from private.npc_assets where id=v.selected_scene_asset_id),'portraitAsset',(select jsonb_build_object('id',id,'dimensions',jsonb_build_object('width',width,'height',height),'alphaValid',alpha_valid,'styleVersion',style_version,'previewToken',case when media_state in ('quarantined','purged') then null else id::text end) from private.npc_assets where id=v.selected_portrait_asset_id),'evaluation',(select jsonb_build_object('status',status,'result',result) from private.npc_evaluations where version_id=v.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sectionPath',section_path,'body',body,'resolvedAt',resolved_at,'createdAt',created_at)),'[]'::jsonb) from private.npc_section_comments where version_id=v.id));
end $$;

-- A local prototype exception lets an administrator review their own assigned
-- first-party pilot work.  Community authors, including administrators, stay
-- excluded from reviewing identities they have owned.
create or replace function private.assert_npc_reviewer(p_npc uuid) returns void language plpgsql stable security definer set search_path='' as $$
declare is_local_pilot boolean;
begin
  if not(private.has_npc_capability('npc_reviewer') or private.has_npc_capability('admin')) then raise sqlstate 'PT403' using message='NPC reviewer capability required'; end if;
  select i.origin='first_party' and private.has_npc_capability('admin') and private.npc_is_owner(p_npc)
    into is_local_pilot from private.npc_identities i where i.id=p_npc;
  if private.npc_was_ever_owner(p_npc) and not coalesce(is_local_pilot,false) then raise sqlstate 'PT403' using message='Current and former owners cannot review or moderate this identity'; end if;
end $$;

create or replace function public.npc_reviewer_queue() returns jsonb language sql stable security definer set search_path='' as $$
  select case when private.has_npc_capability('npc_reviewer') or private.has_npc_capability('admin') then coalesce(jsonb_agg(jsonb_build_object(
    'npcId',i.id,'versionId',v.id,'sheet',v.sheet,'rating',i.rating,'sceneAssetId',v.selected_scene_asset_id,'portraitAssetId',v.selected_portrait_asset_id,
    'evaluation',jsonb_build_object('status',e.status,'result',e.result),'submittedAt',v.submitted_at) order by v.submitted_at),'[]'::jsonb) else '[]'::jsonb end
  from private.npc_versions v join private.npc_identities i on i.id=v.npc_id
  left join private.npc_evaluations e on e.version_id=v.id and e.evaluator_version='community-eval-v1'
  where v.state='submitted' and (
    not private.npc_was_ever_owner(i.id)
    or (i.origin='first_party' and private.has_npc_capability('admin') and private.npc_is_owner(i.id))
  )
$$;

-- Local fixtures may temporarily assign editing rights for the two authored
-- pilots.  Ownership moves while first-party creator attribution stays null.
-- It creates successor drafts only and never alters published versions.
create or replace function public.npc_local_assign_first_party_author(p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare npc uuid; published private.npc_versions; created jsonb:='[]'::jsonb; draft_id uuid;
begin
  perform private.npc_assert_service();
  if not exists(select 1 from auth.users where id=p_owner_id) then raise sqlstate 'PT404' using message='Fixture author is unavailable'; end if;
  foreach npc in array array['18181818-1818-4181-8181-181818181818'::uuid,'28282828-2828-4282-8282-282828282828'::uuid] loop
    select v.* into published from private.npc_identities i join private.npc_versions v on v.id=i.current_published_version_id where i.id=npc and i.origin='first_party';
    if not found then raise sqlstate 'PT404' using message='Pilot NPC is unavailable'; end if;
    update private.npc_identity_owners set ended_at=coalesce(ended_at,now()),reason=case when ended_at is null then 'Local fixture reassignment' else reason end where npc_id=npc and ended_at is null and user_id<>p_owner_id;
    insert into private.npc_identity_owners(npc_id,user_id,reason)
      select npc,p_owner_id,'Local fixture authoring assignment' where not exists(select 1 from private.npc_identity_owners where npc_id=npc and user_id=p_owner_id and ended_at is null);
    select id into draft_id from private.npc_drafts where npc_id=npc and state='open' order by updated_at desc limit 1;
    if draft_id is null then
      insert into private.npc_drafts(npc_id,version_number,sheet,owner_id,selected_scene_asset_id,selected_portrait_asset_id)
      values(npc,published.version_number+1,published.sheet,p_owner_id,published.selected_scene_asset_id,published.selected_portrait_asset_id) returning id into draft_id;
    else update private.npc_drafts set owner_id=p_owner_id where id=draft_id; end if;
    created:=created || jsonb_build_array(jsonb_build_object('npcId',npc,'draftId',draft_id));
  end loop;
  return jsonb_build_object('ownerId',p_owner_id,'drafts',created);
end $$;

revoke all on function public.npc_author_list_settings(),public.npc_author_select_setting(uuid,bigint,uuid),public.npc_author_request_portrait(uuid,bigint,jsonb,integer),public.npc_author_portrait_status(uuid),public.npc_author_select_portrait(uuid,bigint,uuid),public.npc_author_portrait_preview_authorization(uuid),public.npc_author_portrait_complete(uuid,jsonb,text),public.npc_author_portrait_preview_target(uuid),public.npc_author_set_portrait_provider_status(boolean,text,text,text,integer),public.npc_author_register_setting_asset(uuid,text,text,integer,integer,text),public.npc_local_assign_first_party_author(uuid),public.npc_portrait_next_deletion_target(),public.npc_portrait_deletion_complete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.npc_author_list_settings(),public.npc_author_select_setting(uuid,bigint,uuid),public.npc_author_request_portrait(uuid,bigint,jsonb,integer),public.npc_author_portrait_status(uuid),public.npc_author_select_portrait(uuid,bigint,uuid),public.npc_author_portrait_preview_authorization(uuid) to authenticated;
grant execute on function public.npc_author_portrait_complete(uuid,jsonb,text),public.npc_author_portrait_preview_target(uuid),public.npc_author_set_portrait_provider_status(boolean,text,text,text,integer),public.npc_author_register_setting_asset(uuid,text,text,integer,integer,text),public.npc_local_assign_first_party_author(uuid),public.npc_portrait_next_deletion_target(),public.npc_portrait_deletion_complete(uuid,uuid) to service_role;

commit;
