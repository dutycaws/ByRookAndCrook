-- Community NPC platform v1.  This is intentionally additive while the legacy
-- text-key dialogue runtime is migrated by the application layer.
begin;

create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  normalized_display_name text generated always as (lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g'))) stored,
  bio text not null default '' check (char_length(bio) <= 500),
  adult_attested_at timestamptz,
  mature_content_enabled boolean not null default false,
  creator_terms_accepted_at timestamptz, creator_terms_version text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (normalized_display_name),
  check (char_length(trim(display_name)) between 2 and 40)
);

create table private.npc_capabilities (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('admin','npc_author','npc_reviewer')),
  granted_by uuid references auth.users(id), granted_at timestamptz not null default now(),
  revoked_at timestamptz, reason text not null default '',
  primary key (user_id, capability)
);
create table private.npc_capability_audit (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null,
  capability text not null, action text not null check(action in ('grant','revoke')),
  actor_id uuid, reason text not null default '', created_at timestamptz not null default now()
);
create function private.npc_audit_capability() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.npc_capability_audit(user_id,capability,action,actor_id,reason)
  values(coalesce(new.user_id,old.user_id),coalesce(new.capability,old.capability),
    case when tg_op='DELETE' or (tg_op='UPDATE' and new.revoked_at is not null and old.revoked_at is null) then 'revoke' else 'grant' end,
    auth.uid(),coalesce(new.reason,old.reason,''));
  return coalesce(new,old);
end $$;
create trigger npc_capability_audit after insert or update or delete on private.npc_capabilities
  for each row execute function private.npc_audit_capability();
create function private.has_npc_capability(p_capability text, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.npc_capabilities where user_id=p_user and capability=p_capability and revoked_at is null)
$$;

create table private.npc_identities (
  id uuid primary key default extensions.gen_random_uuid(),
  origin text not null check(origin in ('first_party','community')),
  creator_id uuid references auth.users(id) on delete set null,
  normalized_name text not null, name_reserved boolean not null default true,
  status text not null default 'draft' check(status in ('draft','submitted','changes_requested','published','paused','retired','rejected','banned','purged')),
  rating text not null default 'standard' check(rating in ('standard','mature')),
  current_published_version_id uuid,
  retired_at timestamptz, purged_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((origin='first_party') = (creator_id is null))
);
create unique index npc_identity_reserved_name on private.npc_identities(normalized_name) where name_reserved;
create table private.npc_identity_owners (
  npc_id uuid not null references private.npc_identities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz not null default now(), ended_at timestamptz,
  reason text not null default '', primary key(npc_id,user_id,started_at)
);
create unique index npc_identity_one_open_owner on private.npc_identity_owners(npc_id) where ended_at is null;
create table private.npc_versions (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_number integer not null check(version_number > 0), schema_version text not null default 'npc-sheet-v1',
  sheet jsonb not null, sheet_hash text not null, state text not null check(state in ('draft','submitted','published','rejected','retired')),
  submitted_at timestamptz, published_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique(npc_id,version_number), unique(npc_id,sheet_hash)
);
alter table private.npc_identities add constraint npc_identity_current_version_fk foreign key(current_published_version_id) references private.npc_versions(id) deferrable initially deferred;
create table private.npc_drafts (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  version_number integer not null check(version_number > 0), sheet jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check(revision >= 0), owner_id uuid not null references auth.users(id),
  state text not null default 'open' check(state in ('open','submitted','superseded')),
  updated_at timestamptz not null default now(), submitted_version_id uuid references private.npc_versions(id)
);
create unique index npc_one_open_successor_draft on private.npc_drafts(npc_id) where state='open';
create table private.npc_assets (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  version_id uuid references private.npc_versions(id) on delete cascade, kind text not null check(kind in ('portrait','scene','reference')),
  storage_key text not null, alt_text text not null default '', generation jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(npc_id,storage_key)
);
alter table private.npc_drafts add column selected_scene_asset_id uuid references private.npc_assets(id);
alter table private.npc_versions add column selected_scene_asset_id uuid references private.npc_assets(id);
create table private.npc_generation_jobs (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  requested_by uuid references auth.users(id), prompt_version text not null, request jsonb not null, status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  result jsonb, error_code text, created_at timestamptz not null default now(), completed_at timestamptz
);
create table private.npc_assistance_events (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  draft_id uuid not null references private.npc_drafts(id) on delete cascade, requested_by uuid not null references auth.users(id),
  section_path text not null, provider text not null, model text not null, prompt_version text not null, content_hash text not null,
  proposal jsonb, disposition text not null default 'proposed' check(disposition in ('proposed','accepted','rejected','failed')),
  created_at timestamptz not null default now(), decided_at timestamptz
);
create table private.npc_sandboxes (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  draft_id uuid not null references private.npc_drafts(id) on delete cascade, owner_id uuid not null references auth.users(id),
  based_on_revision bigint not null, state jsonb not null default '{}'::jsonb, invalidated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table private.npc_section_comments (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  version_id uuid references private.npc_versions(id) on delete cascade, section_path text not null, body text not null check(char_length(body) between 1 and 2000),
  author_id uuid not null references auth.users(id), resolved_at timestamptz, created_at timestamptz not null default now()
);
create table private.npc_evaluations (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  version_id uuid references private.npc_versions(id) on delete cascade, evaluator_version text not null,
  status text not null default 'queued' check(status in ('queued','running','completed','failed')), result jsonb not null default '{}'::jsonb,
  rerun_count integer not null default 0 check(rerun_count between 0 and 1), created_at timestamptz not null default now(), completed_at timestamptz,
  unique(version_id,evaluator_version)
);
create table private.npc_review_decisions (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id) on delete cascade,
  version_id uuid not null references private.npc_versions(id) on delete cascade, reviewer_id uuid not null references auth.users(id),
  decision text not null check(decision in ('approve','reject','request_changes')), notes text not null default '', created_at timestamptz not null default now(),
  unique(version_id,reviewer_id)
);
create table private.npc_notifications (
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, payload jsonb not null default '{}'::jsonb, read_at timestamptz, created_at timestamptz not null default now()
);
create table private.npc_quota_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_open_drafts integer check(max_open_drafts between 1 and 50), max_published integer check(max_published between 1 and 100),
  max_assist_daily integer check(max_assist_daily between 1 and 500), max_scene_daily integer check(max_scene_daily between 1 and 100),
  max_sandbox_daily integer check(max_sandbox_daily between 1 and 500),
  expires_at timestamptz, reason text not null default '', granted_by uuid references auth.users(id)
);
create table private.npc_author_usage (
  user_id uuid not null references auth.users(id) on delete cascade, usage_day date not null default current_date,
  assistance_calls integer not null default 0, scene_calls integer not null default 0, sandbox_turns integer not null default 0,
  primary key(user_id,usage_day), check(assistance_calls>=0 and scene_calls>=0 and sandbox_turns>=0)
);
create table private.npc_retirement_requests (
  id uuid primary key default extensions.gen_random_uuid(), npc_id uuid not null references private.npc_identities(id),
  requested_by uuid not null references auth.users(id), reason text not null check(char_length(reason) between 10 and 2000),
  status text not null default 'open' check(status in ('open','approved','rejected')), decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(), decided_at timestamptz
);

create function private.npc_version_immutable() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' and old.state in ('submitted','published','retired','rejected') then raise exception 'NPC version is immutable once submitted'; end if;
  if tg_op='UPDATE' and old.state in ('submitted','published','retired','rejected')
    and (new.npc_id<>old.npc_id or new.version_number<>old.version_number or new.schema_version<>old.schema_version
      or new.sheet<>old.sheet or new.sheet_hash<>old.sheet_hash or new.created_by is distinct from old.created_by
      or new.selected_scene_asset_id is distinct from old.selected_scene_asset_id)
    then raise exception 'NPC version content is immutable once submitted'; end if;
  return new;
end $$;
create trigger npc_version_immutable before update or delete on private.npc_versions for each row execute function private.npc_version_immutable();
create function private.assert_npc_sheet(p_sheet jsonb) returns void language plpgsql immutable set search_path='' as $$
declare
  v_skills jsonb:=p_sheet->'skills'; v_total integer; v_key text; v_item jsonb; v_milestone jsonb; v_step jsonb;
  v_index integer:=0; v_step_index integer; v_entities text[]; v_ids text[];
begin
  if jsonb_typeof(p_sheet)<>'object' or p_sheet->>'schemaVersion'<>'npc-sheet-v1' then raise sqlstate 'PT400' using message='NPC sheet must use npc-sheet-v1'; end if;
  if p_sheet->>'rating' not in ('standard','mature') then raise sqlstate 'PT400' using message='NPC rating is required'; end if;
  if coalesce(length(trim(p_sheet#>>'{identity,name}')),0) not between 1 and 80
    or coalesce(length(trim(p_sheet#>>'{identity,title}')),0) not between 1 and 80
    or coalesce(length(trim(p_sheet#>>'{identity,shortDescription}')),0) not between 20 and 300
    or coalesce(length(trim(p_sheet#>>'{identity,voice}')),0) not between 20 and 1000 then raise sqlstate 'PT400' using message='NPC identity and voice are incomplete'; end if;
  foreach v_key in array array['physicalAppearance','attire','notableFeatures','mood'] loop
    if coalesce(length(trim(p_sheet#>>array['appearance',v_key])),0) not between 20 and 1000 then raise sqlstate 'PT400' using message='NPC appearance is incomplete'; end if;
  end loop;
  foreach v_key in array array['values','likes','dislikes','boundaries'] loop
    if jsonb_typeof(p_sheet#>array['personality',v_key])<>'array' or jsonb_array_length(p_sheet#>array['personality',v_key]) not between 1 and 10
      or exists(select 1 from jsonb_array_elements_text(p_sheet#>array['personality',v_key]) entry where length(trim(entry)) not between 1 and 200)
      then raise sqlstate 'PT400' using message='NPC personality entries must be 1-200 characters'; end if;
  end loop;
  if jsonb_typeof(p_sheet->'lore')<>'object'
    or jsonb_typeof(p_sheet#>'{lore,entities}')<>'array' or jsonb_array_length(p_sheet#>'{lore,entities}')>20
    or jsonb_typeof(p_sheet#>'{lore,npcReferences}')<>'array' or jsonb_array_length(p_sheet#>'{lore,npcReferences}')>20
    or jsonb_typeof(p_sheet#>'{lore,relationships}')<>'array' or jsonb_array_length(p_sheet#>'{lore,relationships}')>20
    or jsonb_typeof(p_sheet#>'{lore,facts}')<>'array' or jsonb_array_length(p_sheet#>'{lore,facts}')>20
    then raise sqlstate 'PT400' using message='NPC lore collections are invalid'; end if;
  select coalesce(array_agg(value->>'id'),'{}') into v_entities from jsonb_array_elements(p_sheet#>'{lore,entities}');
  if cardinality(v_entities)<>cardinality(array(select distinct unnest(v_entities))) then raise sqlstate 'PT400' using message='Supporting entity IDs must be unique'; end if;
  for v_item in select value from jsonb_array_elements(p_sheet#>'{lore,entities}') loop
    if coalesce(v_item->>'id','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or coalesce(v_item->>'namespace','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(trim(coalesce(v_item->>'name',''))) not between 1 and 80 or length(trim(coalesce(v_item->>'description',''))) not between 1 and 300
      then raise sqlstate 'PT400' using message='Supporting entity is invalid'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(p_sheet#>'{lore,npcReferences}') ref where ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise sqlstate 'PT400' using message='NPC reference is invalid'; end if;
  for v_item in select value from jsonb_array_elements(p_sheet#>'{lore,relationships}') loop
    if length(trim(coalesce(v_item->>'description',''))) not between 1 and 200 or coalesce(v_item->>'trustThreshold','') !~ '^[0-9]{1,3}$' or (v_item->>'trustThreshold')::integer not between 0 and 100
      or not ((v_item#>>'{subject,kind}'='entity' and (v_item#>>'{subject,entityId}')=any(v_entities))
        or (v_item#>>'{subject,kind}'='npc' and (v_item#>>'{subject,npcId}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
      then raise sqlstate 'PT400' using message='NPC relationship is invalid'; end if;
  end loop;
  select coalesce(array_agg(value->>'id'),'{}') into v_ids from jsonb_array_elements(p_sheet#>'{lore,facts}');
  if cardinality(v_ids)<>cardinality(array(select distinct unnest(v_ids))) then raise sqlstate 'PT400' using message='Fact IDs must be unique'; end if;
  for v_item in select value from jsonb_array_elements(p_sheet#>'{lore,facts}') loop
    if coalesce(v_item->>'id','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or v_item->>'category' not in ('history','relationship','goal','secret')
      or length(trim(coalesce(v_item->>'text',''))) not between 1 and 1000 or coalesce(v_item->>'trustThreshold','') !~ '^[0-9]{1,3}$' or (v_item->>'trustThreshold')::integer not between 0 and 100
      or jsonb_typeof(v_item->'entityRefs')<>'array' or jsonb_array_length(v_item->'entityRefs')>20
      or exists(select 1 from jsonb_array_elements_text(v_item->'entityRefs') ref where not ref=any(v_entities))
      or jsonb_typeof(v_item->'npcRefs')<>'array' or jsonb_array_length(v_item->'npcRefs')>20
      or exists(select 1 from jsonb_array_elements_text(v_item->'npcRefs') ref where ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      then raise sqlstate 'PT400' using message='NPC fact is invalid'; end if;
  end loop;
  if jsonb_typeof(v_skills)<>'object' or (select count(*) from jsonb_each(v_skills))<>4 then raise sqlstate 'PT400' using message='NPC skills are required'; end if;
  select coalesce(sum(value::integer),-1) into v_total from jsonb_each_text(v_skills) where key in ('scouting','combat','diplomacy','trade') and value ~ '^[0-4]$';
  if v_total<>10 or (select count(*) from jsonb_each_text(v_skills) where value='4')<1 or (select count(*) from jsonb_each_text(v_skills) where value in ('0','1'))<1 then raise sqlstate 'PT400' using message='NPC skills must total 10 with a 4 and a weakness'; end if;
  if coalesce(length(trim(p_sheet#>>'{campaign,durableGoal}')),0) not between 20 and 300 or jsonb_typeof(p_sheet#>'{campaign,milestones}')<>'array' or jsonb_array_length(p_sheet#>'{campaign,milestones}') not between 2 and 10 then raise sqlstate 'PT400' using message='NPC campaign requires two to ten milestones'; end if;
  select array_agg(value->>'id') into v_ids from jsonb_array_elements(p_sheet#>'{campaign,milestones}');
  if cardinality(v_ids)<>cardinality(array(select distinct unnest(v_ids))) then raise sqlstate 'PT400' using message='Milestone IDs must be unique'; end if;
  for v_milestone in select value from jsonb_array_elements(p_sheet#>'{campaign,milestones}') loop
    if coalesce(v_milestone->>'id','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(trim(coalesce(v_milestone->>'title',''))) not between 1 and 80
      or length(trim(coalesce(v_milestone->>'outcome',''))) not between 20 and 500 or length(trim(coalesce(v_milestone->>'motivation',''))) not between 20 and 500
      or jsonb_typeof(v_milestone->'constraints')<>'array' or jsonb_array_length(v_milestone->'constraints') not between 1 and 10
      or jsonb_typeof(v_milestone->'allowedTargets')<>'array' or jsonb_array_length(v_milestone->'allowedTargets') not between 1 and 20
      or coalesce(v_milestone->>'difficulty','') !~ '^[0-4]$'
      or length(trim(coalesce(v_milestone->>'successNews',''))) not between 20 and 500 or length(trim(coalesce(v_milestone->>'nonSuccessNews',''))) not between 20 and 500
      or jsonb_typeof(v_milestone->'retiredTargets')<>'array' or jsonb_array_length(v_milestone->'retiredTargets')>20
      or exists(select 1 from jsonb_array_elements_text(v_milestone->'retiredTargets') retired where not (v_milestone->'allowedTargets') ? retired)
      then raise sqlstate 'PT400' using message='NPC milestone is incomplete'; end if;
    if v_milestone->'permanentLoss'<>'null'::jsonb and (v_milestone#>>'{permanentLoss,kind}' not in ('dead','departed')
      or length(trim(coalesce(v_milestone#>>'{permanentLoss,warning}',''))) not between 20 and 500 or length(trim(coalesce(v_milestone#>>'{permanentLoss,outcome}',''))) not between 20 and 500)
      then raise sqlstate 'PT400' using message='Permanent loss definition is invalid'; end if;
    if v_milestone->'startingPlan'='null'::jsonb then
      if v_index=0 then raise sqlstate 'PT400' using message='The first milestone requires a starting plan'; end if;
    elsif jsonb_typeof(v_milestone->'startingPlan')<>'array' or jsonb_array_length(v_milestone->'startingPlan') not between 1 and 3 then raise sqlstate 'PT400' using message='Milestone plan is invalid';
    else
      v_step_index:=0;
      for v_step in select value from jsonb_array_elements(v_milestone->'startingPlan') loop
        if v_step->>'action' not in ('prepare','wait','attempt','abandon') or v_step->>'approach' not in ('scouting','combat','diplomacy','trade')
          or (v_step_index<jsonb_array_length(v_milestone->'startingPlan')-1 and v_step->>'action' not in ('prepare','wait'))
          or (v_step_index=jsonb_array_length(v_milestone->'startingPlan')-1 and v_step->>'action' not in ('attempt','abandon'))
          then raise sqlstate 'PT400' using message='Milestone plan order is invalid'; end if;
        v_step_index:=v_step_index+1;
      end loop;
    end if;
    v_index:=v_index+1;
  end loop;
end $$;
create function private.npc_is_owner(p_npc uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.npc_identity_owners where npc_id=p_npc and user_id=p_user and ended_at is null)
$$;
create function private.npc_was_ever_owner(p_npc uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.npc_identity_owners where npc_id=p_npc and user_id=p_user)
$$;
create function private.npc_quota(p_user uuid,p_kind text) returns integer language sql stable security definer set search_path='' as $$
  select case p_kind
    when 'open' then coalesce((select max_open_drafts from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),5)
    when 'published' then coalesce((select max_published from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),10)
    when 'assist' then coalesce((select max_assist_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),30)
    when 'scene' then coalesce((select max_scene_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),10)
    when 'sandbox' then coalesce((select max_sandbox_daily from private.npc_quota_overrides where user_id=p_user and (expires_at is null or expires_at>now())),20)
  end
$$;
create function private.assert_npc_author(p_sheet jsonb default null,p_require_terms boolean default false) returns void language plpgsql stable security definer set search_path='' as $$
declare p public.player_profiles;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Sign in required'; end if;
  if not private.has_npc_capability('npc_author') then raise sqlstate 'PT403' using message='NPC author capability required'; end if;
  select * into p from public.player_profiles where user_id=auth.uid();
  if p_require_terms and p.creator_terms_accepted_at is null then raise sqlstate 'PT422' using message='Accept the current creator terms before submission'; end if;
  if p_sheet->>'rating'='mature' and p.adult_attested_at is null then raise sqlstate 'PT422' using message='Adult attestation is required for mature authoring'; end if;
end $$;
create function private.assert_npc_reviewer(p_npc uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not(private.has_npc_capability('npc_reviewer') or private.has_npc_capability('admin')) then raise sqlstate 'PT403' using message='NPC reviewer capability required'; end if;
  if private.npc_was_ever_owner(p_npc) then raise sqlstate 'PT403' using message='Current and former owners cannot review or moderate this identity'; end if;
end $$;

create table private.world_npc_instances (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid not null references private.npc_identities(id) on delete restrict, version_id uuid not null references private.npc_versions(id) on delete restrict,
  status text not null default 'active' check(status in ('active','between','settled','failed','abandoned','dead','departed','dismissed','removed','quarantined')),
  relationship integer not null default 45 check(relationship between 0 and 100), campaign_state jsonb not null default '{"milestone":0,"preparation":0,"step":0}'::jsonb,
  arrived_day integer not null, settled_day integer, dismissed_day integer, created_at timestamptz not null default now(),
  unique(save_id,npc_id), unique(save_id,id)
);
alter table public.tavern_saves add column community_npc_level integer not null default 1 check(community_npc_level >= 1);
create table private.world_npc_quest_events (
  id uuid primary key default extensions.gen_random_uuid(), instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  day integer not null, outcome text not null check(outcome in ('prepared','waited','succeeded','failed','abandoned','settled')),
  draw integer, chance integer, narration text not null, public_news boolean not null default false, created_at timestamptz not null default now(),
  unique(instance_id,day)
);
create table private.world_npc_tombstones (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid, version_id uuid, reason text not null check(reason in ('dismissed','mature_purged','quarantined','banned','retired')),
  scrubbed_label text not null default 'Unavailable guest', created_at timestamptz not null default now(), unique(save_id,npc_id,reason)
);
create table private.world_npc_arrival_receipts (
  save_id uuid not null references public.tavern_saves(id) on delete cascade, day integer not null, action_id uuid not null,
  candidate_count integer not null, draw integer, selected_npc_id uuid, selected_version_id uuid, result jsonb not null, created_at timestamptz not null default now(),
  primary key(save_id,day), unique(save_id,action_id)
);
create table private.npc_reports (
  id uuid primary key default extensions.gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  world_id uuid not null references public.tavern_saves(id) on delete cascade, version_id uuid not null references private.npc_versions(id) on delete cascade,
  category text not null, evidence text not null check(char_length(evidence) between 1 and 4000), transcript jsonb not null default '[]'::jsonb,
  frozen_version jsonb not null default '{}'::jsonb, generation_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'open' check(status in ('open','upheld','dismissed')), reviewer_reason text, creator_reason text, remedial_action text,
  decided_by uuid references auth.users(id), decided_at timestamptz,
  created_at timestamptz not null default now(), unique(reporter_id,world_id,version_id)
);
create function private.npc_report_pause_threshold() returns trigger language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  if (select count(distinct world_id) from private.npc_reports where version_id=new.version_id and status='open')>=3 then
    select npc_id into n from private.npc_versions where id=new.version_id;
    update private.npc_identities set status='paused',updated_at=now() where id=n and status='published';
  end if;
  return new;
end $$;
create trigger npc_report_pause_threshold after insert on private.npc_reports for each row execute function private.npc_report_pause_threshold();
create table private.npc_report_appeals (
  id uuid primary key default extensions.gen_random_uuid(), report_id uuid not null references private.npc_reports(id) on delete cascade,
  appellant_id uuid not null references auth.users(id), body text not null check(char_length(body) between 1 and 4000), status text not null default 'open', created_at timestamptz not null default now()
);
create table private.npc_conversation_shares (
  id uuid primary key default extensions.gen_random_uuid(), share_token uuid not null default extensions.gen_random_uuid() unique,
  save_id uuid not null references public.tavern_saves(id) on delete cascade, instance_id uuid references private.world_npc_instances(id) on delete set null,
  created_by uuid not null references auth.users(id), transcript jsonb not null, include_display_name boolean not null default false,
  display_name_snapshot text, created_at timestamptz not null default now()
);
create function private.npc_share_immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Conversation shares are immutable'; end $$;
create trigger npc_share_immutable before update or delete on private.npc_conversation_shares for each row execute function private.npc_share_immutable();
create table private.npc_engagement_events (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
  event_day date not null default current_date, event_kind text not null, npc_id uuid, version_id uuid,
  world_hash text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.npc_daily_analytics (
  event_day date not null, version_id uuid not null, assignments integer not null default 0, active_worlds integer not null default 0,
  dialogue_turns integer not null default 0, days_present integer not null default 0, hospitality_interactions integer not null default 0,
  milestone_successes integer not null default 0, milestone_failures integer not null default 0, abandonments integer not null default 0,
  campaign_completions integer not null default 0, dismissals integer not null default 0, report_band text not null default 'none',
  primary key(event_day,version_id), check(assignments>=0 and active_worlds>=0 and dialogue_turns>=0 and days_present>=0 and hospitality_interactions>=0
    and milestone_successes>=0 and milestone_failures>=0 and abandonments>=0 and campaign_completions>=0 and dismissals>=0)
);

create function private.seed_world_npcs(p_save uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_day integer;
begin
  select current_day into v_day from public.tavern_saves where id=p_save;
  insert into private.world_npc_instances(save_id,npc_id,version_id,arrived_day)
  select p_save,i.id,i.current_published_version_id,v_day from private.npc_identities i
  where i.id in ('18181818-1818-4181-8181-181818181818'::uuid,'28282828-2828-4282-8282-282828282828'::uuid)
  on conflict(save_id,npc_id) do nothing;
end $$;

-- Fixed canonical first-party identities. Their version IDs are stable so a save
-- can pin the exact authored content without exposing private sheets to clients.
insert into private.npc_identities(id,origin,normalized_name,status,rating)
values ('18181818-1818-4181-8181-181818181818','first_party','lira nightwind','published','standard'),
       ('28282828-2828-4282-8282-282828282828','first_party','torvin ashbeard','published','standard');
insert into private.npc_versions(id,npc_id,version_number,schema_version,sheet,sheet_hash,state,published_at)
values
 ('18181818-1818-4181-8181-181818181819','18181818-1818-4181-8181-181818181818',1,'npc-sheet-v1',
  '{"schemaVersion":"npc-sheet-v1","rating":"standard","identity":{"name":"Lira Nightwind","title":"Elven Ranger","shortDescription":"A watchful ranger protecting Millhaven and the old road.","voice":"Measured, observant, dryly humorous. Short concrete sentences and careful evidence."},"appearance":{"physicalAppearance":"An alert elf with weathered hands and a practical ranger posture.","attire":"A moss-green cloak, worn boots, and a well-kept bow.","notableFeatures":"A braided copper charm and a narrow scar at her left brow.","mood":"Watchful but kind when people speak plainly."},"personality":{"values":["protect Millhaven","keep promises"],"likes":["careful preparation"],"dislikes":["recklessness"],"boundaries":["Will not harm civilians"]},"lore":{"entities":[{"id":"old-road","namespace":"place","name":"Old Road","description":"The trade road outside Millhaven."}],"npcReferences":[],"relationships":[],"facts":[{"id":"road-watch","category":"history","text":"Lira has guarded the old road for several seasons.","trustThreshold":0,"entityRefs":["old-road"],"npcRefs":[]}]},"skills":{"scouting":4,"combat":3,"diplomacy":2,"trade":1},"campaign":{"durableGoal":"Keep the old road safe for Millhaven travellers and merchants.","milestones":[{"id":"scout-camp","title":"Scout the camp","outcome":"Map the bandit camp and identify a safe approach for travellers.","motivation":"A careful map keeps innocent people from walking into danger.","constraints":["avoid civilians"],"allowedTargets":["old-road"],"difficulty":2,"successNews":"The ranger mapped the dangerous route.","nonSuccessNews":"The camp remained concealed.","retiredTargets":[],"permanentLoss":null,"startingPlan":[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]},{"id":"secure-road","title":"Secure the road","outcome":"Break the bandit hold over the old road without risking travellers.","motivation":"Millhaven needs a safe road more than a heroic tale.","constraints":["protect travellers"],"allowedTargets":["old-road"],"difficulty":3,"successNews":"The old road is safer today.","nonSuccessNews":"The threat remains on the road.","retiredTargets":["old-road"],"permanentLoss":{"kind":"dead","warning":"An unprepared assault could cost Lira her life.","outcome":"Lira fell protecting the road."},"startingPlan":null}]}}','lira-npc-sheet-v1','published',now()),
 ('28282828-2828-4282-8282-282828282829','28282828-2828-4282-8282-282828282828',1,'npc-sheet-v1',
  '{"schemaVersion":"npc-sheet-v1","rating":"standard","identity":{"name":"Torvin Ashbeard","title":"Dwarven Merchant","shortDescription":"A shrewd merchant seeking a fair future for a miners heartstone.","voice":"Warm and practical with the occasional merchant comparison; pride conceals worry."},"appearance":{"physicalAppearance":"A broad dwarf with soot-dark braids and appraising eyes.","attire":"A layered merchant coat, brass scales, and a travel-stained satchel.","notableFeatures":"A heavy silver ring engraved with a miners mark.","mood":"Friendly when bargaining is fair and careful."},"personality":{"values":["fair bargains","community"],"likes":["craftsmanship"],"dislikes":["empty guarantees"],"boundaries":["Will not knowingly sell a counterfeit"]},"lore":{"entities":[{"id":"heartstone","namespace":"item","name":"Heartstone","description":"A rare stone from the eastern mines."}],"npcReferences":[],"relationships":[],"facts":[{"id":"miners","category":"history","text":"Torvin wants a fair return for the eastern miners work.","trustThreshold":0,"entityRefs":["heartstone"],"npcRefs":[]}]},"skills":{"scouting":1,"combat":1,"diplomacy":4,"trade":4},"campaign":{"durableGoal":"Secure a fair future for the heartstone and the miners who found it.","milestones":[{"id":"verify-stone","title":"Verify provenance","outcome":"Document the heartstone provenance for an honest negotiation.","motivation":"A clear record protects the miners and the buyer.","constraints":["no forgery"],"allowedTargets":["heartstone"],"difficulty":2,"successNews":"The heartstone provenance is secure.","nonSuccessNews":"The provenance remains disputed.","retiredTargets":[],"permanentLoss":null,"startingPlan":[{"action":"prepare","approach":"trade"},{"action":"attempt","approach":"trade"}]},{"id":"fair-deal","title":"Reach a fair deal","outcome":"Complete a fair deal that honours the eastern miners work.","motivation":"The miners deserve a return without compromising Torvin reputation.","constraints":["fair price"],"allowedTargets":["heartstone"],"difficulty":3,"successNews":"A fair heartstone deal was reached.","nonSuccessNews":"The buyer withdrew from the deal.","retiredTargets":["heartstone"],"permanentLoss":{"kind":"departed","warning":"An unprepared confrontation could drive Torvin away.","outcome":"Torvin left Millhaven after the failed confrontation."},"startingPlan":null}]}}','torvin-npc-sheet-v1','published',now());
do $$ declare v jsonb; begin for v in select sheet from private.npc_versions loop perform private.assert_npc_sheet(v); end loop; end $$;
update private.npc_identities set current_published_version_id=case id
  when '18181818-1818-4181-8181-181818181818'::uuid then '18181818-1818-4181-8181-181818181819'::uuid
  when '28282828-2828-4282-8282-282828282828'::uuid then '28282828-2828-4282-8282-282828282829'::uuid end;

-- All existing saves receive first-party residents. A new tavern gets them too;
-- this intentionally does not select any community identity during creation.
do $$ declare r record; begin for r in select id from public.tavern_saves loop perform private.seed_world_npcs(r.id); end loop; end $$;
alter function public.create_tavern() rename to create_tavern_before_community_npcs;
alter function public.create_tavern_before_community_npcs() set schema private;
create function public.create_tavern() returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; begin r:=private.create_tavern_before_community_npcs(); perform private.seed_world_npcs((r->>'saveId')::uuid); return r; end $$;

create function private.world_capacity(p_save uuid) returns integer language sql stable security definer set search_path='' as $$
  select greatest(2,t.community_npc_level+1) from public.tavern_saves t where t.id=p_save
$$;
create function private.world_npc_hospitality(p_save uuid,p_npc uuid,p_day integer) returns integer language sql stable security definer set search_path='' as $$
  select greatest(-3,least(3,coalesce(sum(quality_index-3),0)))::integer from public.hospitality_events
  where save_id=p_save and patron_key=p_npc::text and day_number=p_day
$$;
create function private.resolve_world_npcs(p_save uuid,p_day integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare i record; v_events jsonb:='[]'::jsonb; v_draw integer; v_success boolean; v_state jsonb; v_milestone jsonb; v_plan jsonb; v_step jsonb;
  v_milestone_index integer; v_step_index integer; v_preparation integer; v_action text; v_approach text; v_chance integer; v_terminal boolean; v_loss text;
begin
  for i in select w.*,v.sheet from private.world_npc_instances w join private.npc_versions v on v.id=w.version_id
    where w.save_id=p_save and w.status='active' order by w.npc_id loop
    if exists(select 1 from private.world_npc_quest_events where instance_id=i.id and day=p_day) then
      v_events:=v_events || jsonb_build_array((select jsonb_build_object('instanceId',i.id,'outcome',outcome) from private.world_npc_quest_events where instance_id=i.id and day=p_day));
      continue;
    end if;
    v_state:=i.campaign_state; v_milestone_index:=coalesce((v_state->>'milestone')::integer,0); v_step_index:=coalesce((v_state->>'step')::integer,0); v_preparation:=coalesce((v_state->>'preparation')::integer,0);
    v_milestone:=i.sheet#>array['campaign','milestones',v_milestone_index::text];
    v_plan:=coalesce(v_state->'activePlan',v_milestone->'startingPlan');
    if v_plan is null or v_plan='null'::jsonb then
      update private.world_npc_instances set status='between' where id=i.id;
      continue;
    end if;
    v_step:=v_plan->v_step_index;
    v_action:=v_step->>'action'; v_approach:=v_step->>'approach'; v_terminal:=v_step_index+1>=jsonb_array_length(v_plan);
    if v_action='prepare' then
      update private.world_npc_instances set campaign_state=jsonb_build_object('milestone',v_milestone_index,'step',case when v_terminal then v_step_index else v_step_index+1 end,'preparation',least(2,v_preparation+1),'activePlan',v_plan) where id=i.id;
      insert into private.world_npc_quest_events(instance_id,day,outcome,narration) values(i.id,p_day,'prepared','A guest prepared for the current milestone.');
      v_events:=v_events||jsonb_build_array(jsonb_build_object('instanceId',i.id,'outcome','prepared')); continue;
    elsif v_action='wait' then
      update private.world_npc_instances set campaign_state=jsonb_build_object('milestone',v_milestone_index,'step',case when v_terminal then v_step_index else v_step_index+1 end,'preparation',v_preparation,'activePlan',v_plan) where id=i.id;
      insert into private.world_npc_quest_events(instance_id,day,outcome,narration) values(i.id,p_day,'waited','A guest waited while considering the current milestone.');
      v_events:=v_events||jsonb_build_array(jsonb_build_object('instanceId',i.id,'outcome','waited')); continue;
    elsif v_action='abandon' then
      update private.world_npc_instances set status='abandoned' where id=i.id;
      insert into private.world_npc_quest_events(instance_id,day,outcome,narration) values(i.id,p_day,'abandoned','A guest abandoned the current campaign.');
      v_events:=v_events||jsonb_build_array(jsonb_build_object('instanceId',i.id,'outcome','abandoned')); continue;
    end if;
    v_chance:=least(90,greatest(10,50 + 10*(coalesce((i.sheet#>>array['skills',v_approach])::integer,0)-coalesce((v_milestone->>'difficulty')::integer,0)) + 10*v_preparation
      + 5*private.world_npc_hospitality(p_save,i.npc_id,p_day)));
    v_draw:=floor(random()*100)::integer; v_success:=v_draw<v_chance;
    if v_success then
      if v_milestone_index+1>=jsonb_array_length(i.sheet#>'{campaign,milestones}') then
        update private.world_npc_instances set status='settled',settled_day=p_day,campaign_state=jsonb_build_object('milestone',v_milestone_index,'step',v_step_index,'preparation',v_preparation,'settled',true) where id=i.id;
        v_loss:='settled';
      else
        update private.world_npc_instances set status='between',campaign_state=jsonb_build_object('milestone',v_milestone_index+1,'step',0,'preparation',0) where id=i.id;
        v_loss:='succeeded';
      end if;
      update public.tavern_saves set community_npc_level=community_npc_level+1 where id=p_save;
      insert into private.world_npc_quest_events(instance_id,day,outcome,draw,chance,narration,public_news) values(i.id,p_day,v_loss,v_draw,v_chance,coalesce(v_milestone->>'successNews','A guest succeeded at a milestone.'),true);
      v_events:=v_events||jsonb_build_array(jsonb_build_object('instanceId',i.id,'outcome',v_loss)); continue;
    end if;
    v_loss:=case when v_preparation=0 and v_draw>=95 and v_milestone->'permanentLoss'<>'null'::jsonb then v_milestone#>>'{permanentLoss,kind}' else 'failed' end;
    update private.world_npc_instances set status=v_loss,campaign_state=jsonb_build_object('milestone',v_milestone_index,'step',v_step_index,'preparation',v_preparation,'lastDraw',v_draw) where id=i.id;
    insert into private.world_npc_quest_events(instance_id,day,outcome,draw,chance,narration,public_news)
      values(i.id,p_day,'failed',v_draw,v_chance,coalesce(v_milestone->>'nonSuccessNews','A guest failed the current milestone.'),true);
    v_events:=v_events || jsonb_build_array(jsonb_build_object('instanceId',i.id,'outcome',v_loss));
  end loop;
  return v_events;
end $$;
create function private.maybe_arrive_world_npc(p_save uuid,p_day integer,p_action uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_count integer; v_draw integer; v_selected_npc uuid; v_selected_version uuid; v_rating boolean; v_capacity integer; v_result jsonb;
begin
  if exists(select 1 from private.world_npc_arrival_receipts where save_id=p_save and day=p_day) then
    return (select result from private.world_npc_arrival_receipts where save_id=p_save and day=p_day);
  end if;
  select count(*) into v_capacity from private.world_npc_instances where save_id=p_save and status in ('active','between','settled','failed','abandoned');
  if v_capacity >= private.world_capacity(p_save) then
    v_result:=jsonb_build_object('arrived',false,'reason','capacity');
    insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,result) values(p_save,p_day,p_action,0,v_result); return v_result;
  end if;
  select mature_content_enabled and adult_attested_at is not null into v_rating from public.player_profiles p join public.tavern_saves s on s.user_id=p.user_id where s.id=p_save;
  with eligible as (select i.id,i.current_published_version_id from private.npc_identities i
    where i.origin='community' and i.status='published' and i.current_published_version_id is not null
      and (i.rating='standard' or coalesce(v_rating,false))
      and not exists(select 1 from private.world_npc_instances w where w.save_id=p_save and w.npc_id=i.id)
      and not exists(select 1 from private.world_npc_tombstones t where t.save_id=p_save and t.npc_id=i.id))
  select count(*) into v_count from eligible;
  if v_count>0 then
    v_draw:=floor(random()*v_count)::integer;
    with eligible as (select i.id,i.current_published_version_id,row_number() over(order by i.id)-1 rn from private.npc_identities i
      where i.origin='community' and i.status='published' and i.current_published_version_id is not null
        and (i.rating='standard' or coalesce(v_rating,false)) and not exists(select 1 from private.world_npc_instances w where w.save_id=p_save and w.npc_id=i.id)
        and not exists(select 1 from private.world_npc_tombstones t where t.save_id=p_save and t.npc_id=i.id))
    select id,current_published_version_id into strict v_selected_npc,v_selected_version from eligible where rn=v_draw;
    insert into private.world_npc_instances(save_id,npc_id,version_id,arrived_day) values(p_save,v_selected_npc,v_selected_version,p_day);
    v_result:=jsonb_build_object('arrived',true,'npcId',v_selected_npc,'versionId',v_selected_version);
  else v_result:=jsonb_build_object('arrived',false,'reason','no_eligible'); end if;
  insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,draw,selected_npc_id,selected_version_id,result)
    values(p_save,p_day,p_action,v_count,v_draw,v_selected_npc,v_selected_version,v_result);
  return v_result;
end $$;
alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_community_npcs;
alter function public.advance_tavern_day_before_community_npcs(uuid,uuid,bigint) set schema private;
create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; v_day integer; v_world jsonb; v_arrival jsonb;
begin
  -- The previous wrapper retains craft, garden, stock, action receipt, and
  -- revision behavior. Community resolution happens only after that receipt.
  r:=private.advance_tavern_day_before_community_npcs(p_save_id,p_action_id,p_expected_revision);
  v_day:=(r->>'newDay')::integer-1; v_world:=private.resolve_world_npcs(p_save_id,v_day); v_arrival:=private.maybe_arrive_world_npc(p_save_id,v_day,p_action_id);
  return r || jsonb_build_object('communityNpcEvents',v_world,'communityArrival',v_arrival);
end $$;

create function public.npc_profile_me() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise sqlstate 'PT401'; end if;
  insert into public.player_profiles(user_id,display_name) values(auth.uid(),'Keeper-'||left(auth.uid()::text,8)) on conflict(user_id) do nothing;
  return (select jsonb_build_object('userId',user_id,'displayName',display_name,'bio',bio,'adultAttested',adult_attested_at is not null,'matureEnabled',mature_content_enabled,'creatorTermsAccepted',creator_terms_accepted_at is not null,'creatorTermsVersion',creator_terms_version) from public.player_profiles where user_id=auth.uid());
end $$;
create function public.npc_update_profile(p_display_name text,p_bio text,p_mature boolean,p_attest_adult boolean,p_creator_terms boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise sqlstate 'PT401'; end if;
  if p_mature and not p_attest_adult and not exists(select 1 from public.player_profiles where user_id=auth.uid() and adult_attested_at is not null) then
    raise sqlstate 'PT422' using message='Adult attestation is required for mature content';
  end if;
  insert into public.player_profiles(user_id,display_name,bio,adult_attested_at,mature_content_enabled,creator_terms_accepted_at,creator_terms_version)
  values(auth.uid(),p_display_name,coalesce(p_bio,''),case when p_attest_adult then now() end,p_mature,case when p_creator_terms then now() end,case when p_creator_terms then 'community-creator-v1' end)
  on conflict(user_id) do update set display_name=excluded.display_name,bio=excluded.bio,mature_content_enabled=excluded.mature_content_enabled,
    adult_attested_at=case when p_attest_adult then coalesce(player_profiles.adult_attested_at,now()) else player_profiles.adult_attested_at end,
    creator_terms_accepted_at=case when p_creator_terms then coalesce(player_profiles.creator_terms_accepted_at,now()) else player_profiles.creator_terms_accepted_at end,
    creator_terms_version=case when p_creator_terms then 'community-creator-v1' else player_profiles.creator_terms_version end,updated_at=now();
  return public.npc_profile_me();
end $$;
create function public.npc_my_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(capability order by capability),'[]'::jsonb) from private.npc_capabilities where user_id=auth.uid() and revoked_at is null
$$;
create function public.npc_author_workspace() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('npcId',i.id,'status',i.status,'rating',i.rating,'draftId',d.id,'draftRevision',d.revision,
    'draftState',d.state,'selectedSceneAssetId',d.selected_scene_asset_id,'sheet',d.sheet,'updatedAt',d.updated_at) order by d.updated_at desc),'[]'::jsonb)
  from private.npc_identities i join private.npc_drafts d on d.npc_id=i.id
  where private.npc_is_owner(i.id) and i.status not in ('purged','banned') and d.state in ('open','submitted')
$$;
create function public.npc_author_create(p_sheet jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n uuid:=extensions.gen_random_uuid(); d uuid; v_name text;
begin
  perform private.assert_npc_author(p_sheet,false);
  if (select count(*) from private.npc_drafts where owner_id=auth.uid() and state='open')>=private.npc_quota(auth.uid(),'open') then raise sqlstate 'PT429' using message='Open NPC draft quota reached'; end if;
  perform private.assert_npc_sheet(p_sheet); v_name:=lower(regexp_replace(trim(p_sheet#>>'{identity,name}'),'\\s+',' ','g'));
  insert into private.npc_identities(id,origin,creator_id,normalized_name,status,rating) values(n,'community',auth.uid(),v_name,'draft',p_sheet->>'rating');
  insert into private.npc_identity_owners(npc_id,user_id) values(n,auth.uid());
  insert into private.npc_drafts(npc_id,version_number,sheet,owner_id) values(n,1,p_sheet,auth.uid()) returning id into d;
  return jsonb_build_object('npcId',n,'draftId',d,'revision',0);
end $$;
create function public.npc_author_save(p_npc_id uuid,p_expected_revision bigint,p_sheet jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts;
begin
  perform private.assert_npc_author(p_sheet,false);
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403' using message='Only the current owner may edit this NPC'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found then raise sqlstate 'PT409' using message='Open draft unavailable'; end if;
  if d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.assert_npc_sheet(p_sheet);
  update private.npc_drafts set sheet=p_sheet,revision=revision+1,updated_at=now() where id=d.id;
  update private.npc_sandboxes set invalidated_at=coalesce(invalidated_at,now()),updated_at=now() where draft_id=d.id and invalidated_at is null;
  update private.npc_identities set normalized_name=lower(regexp_replace(trim(p_sheet#>>'{identity,name}'),'\\s+',' ','g')),rating=p_sheet->>'rating',updated_at=now() where id=p_npc_id;
  return jsonb_build_object('npcId',p_npc_id,'draftId',d.id,'revision',p_expected_revision+1);
end $$;
create function public.npc_author_add_scene(p_npc_id uuid,p_storage_key text,p_alt_text text,p_generation jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; a uuid;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) or length(trim(p_storage_key)) not between 3 and 500 or length(trim(p_alt_text)) not between 10 and 500 then raise sqlstate 'PT400' using message='Invalid scene candidate'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found then raise sqlstate 'PT409' using message='Open draft unavailable'; end if;
  insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by) values(p_npc_id,'scene',p_storage_key,p_alt_text,coalesce(p_generation,'{}'),auth.uid()) returning id into a;
  update private.npc_drafts set selected_scene_asset_id=a,revision=revision+1,updated_at=now() where id=d.id;
  return jsonb_build_object('assetId',a,'revision',d.revision+1);
end $$;
create function public.npc_author_submit(p_npc_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.npc_drafts; v uuid;
begin
  if not private.npc_is_owner(p_npc_id) then raise sqlstate 'PT403'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open' for update;
  if not found or d.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Draft changed; refresh'; end if;
  perform private.assert_npc_author(d.sheet,true); perform private.assert_npc_sheet(d.sheet);
  if d.selected_scene_asset_id is null then raise sqlstate 'PT422' using message='Select a generated scene before submission'; end if;
  insert into private.npc_versions(npc_id,version_number,schema_version,sheet,sheet_hash,state,submitted_at,created_by,selected_scene_asset_id)
    values(p_npc_id,d.version_number,'npc-sheet-v1',d.sheet,encode(extensions.digest(d.sheet::text,'sha256'),'hex'),'submitted',now(),auth.uid(),d.selected_scene_asset_id) returning id into v;
  update private.npc_assets set version_id=v where id=d.selected_scene_asset_id;
  update private.npc_drafts set submitted_version_id=v,state='submitted' where id=d.id;
  update private.npc_identities set status='submitted' where id=p_npc_id;
  insert into private.npc_evaluations(npc_id,version_id,evaluator_version) values(p_npc_id,v,'community-eval-v1');
  insert into private.npc_notifications(user_id,kind,payload) values(auth.uid(),'submission_received',jsonb_build_object('npcId',p_npc_id,'versionId',v));
  return jsonb_build_object('npcId',p_npc_id,'versionId',v,'state','submitted');
end $$;
create function public.npc_author_reserve_call(p_npc_id uuid,p_kind text,p_request jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u private.npc_author_usage; limit_value integer; job uuid; d private.npc_drafts;
begin
  perform private.assert_npc_author(null,false);
  if not private.npc_is_owner(p_npc_id) or p_kind not in ('assist','scene','sandbox') then raise sqlstate 'PT403'; end if;
  select * into d from private.npc_drafts where npc_id=p_npc_id and state='open'; if not found then raise sqlstate 'PT409' using message='Open draft unavailable'; end if;
  insert into private.npc_author_usage(user_id,usage_day) values(auth.uid(),current_date) on conflict do nothing;
  select * into u from private.npc_author_usage where user_id=auth.uid() and usage_day=current_date for update;
  limit_value:=private.npc_quota(auth.uid(),p_kind);
  if (case p_kind when 'assist' then u.assistance_calls when 'scene' then u.scene_calls else u.sandbox_turns end)>=limit_value then raise sqlstate 'PT429' using message='Daily authoring quota reached'; end if;
  update private.npc_author_usage set assistance_calls=assistance_calls+(p_kind='assist')::integer,
    scene_calls=scene_calls+(p_kind='scene')::integer,sandbox_turns=sandbox_turns+(p_kind='sandbox')::integer
    where user_id=auth.uid() and usage_day=current_date;
  insert into private.npc_generation_jobs(npc_id,requested_by,prompt_version,request,status)
    values(p_npc_id,auth.uid(),'community-'||p_kind||'-v1',jsonb_build_object('kind',p_kind,'draftId',d.id,'draftRevision',d.revision,'payload',coalesce(p_request,'{}')),'queued') returning id into job;
  return jsonb_build_object('jobId',job,'draftId',d.id,'draftRevision',d.revision,'remaining',limit_value-(case p_kind when 'assist' then u.assistance_calls when 'scene' then u.scene_calls else u.sandbox_turns end)-1);
end $$;
create function public.npc_generation_complete(p_job uuid,p_result jsonb,p_error_code text default null) returns void language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
update private.npc_generation_jobs set status=case when p_error_code is null then 'completed' else 'failed' end,result=p_result,error_code=p_error_code,completed_at=now()
where id=p_job and status in ('queued','running'); if not found then raise sqlstate 'PT409'; end if; end $$;
create function public.npc_evaluation_complete(p_version uuid,p_result jsonb,p_error_code text default null) returns void language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
update private.npc_evaluations set status=case when p_error_code is null then 'completed' else 'failed' end,result=coalesce(p_result,'{}'),completed_at=now()
where version_id=p_version and status in ('queued','running'); if not found then raise sqlstate 'PT409'; end if; end $$;
create function public.npc_reviewer_queue() returns jsonb language sql stable security definer set search_path='' as $$
  select case when private.has_npc_capability('npc_reviewer') or private.has_npc_capability('admin') then coalesce(jsonb_agg(jsonb_build_object(
    'npcId',i.id,'versionId',v.id,'sheet',v.sheet,'rating',i.rating,'sceneAssetId',v.selected_scene_asset_id,
    'evaluation',jsonb_build_object('status',e.status,'result',e.result),'submittedAt',v.submitted_at) order by v.submitted_at),'[]'::jsonb) else '[]'::jsonb end
  from private.npc_versions v join private.npc_identities i on i.id=v.npc_id
  left join private.npc_evaluations e on e.version_id=v.id and e.evaluator_version='community-eval-v1'
  where v.state='submitted' and not private.npc_was_ever_owner(i.id)
$$;
create function public.npc_reviewer_comment(p_npc_id uuid,p_version_id uuid,p_section text,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; begin perform private.assert_npc_reviewer(p_npc_id);
insert into private.npc_section_comments(npc_id,version_id,section_path,body,author_id) values(p_npc_id,p_version_id,p_section,p_body,auth.uid()) returning id into r; return r; end $$;
create function public.npc_reviewer_decide(p_version_id uuid,p_decision text,p_notes text default '',p_rating text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare n uuid; v private.npc_versions; d uuid; owner uuid;
begin
select * into v from private.npc_versions where id=p_version_id and state='submitted' for update; n:=v.npc_id;
if n is null then raise sqlstate 'PT404' using message='Submitted version not found'; end if;
perform private.assert_npc_reviewer(n);
if p_decision not in ('approve','reject','request_changes') or (p_rating is not null and p_rating not in ('standard','mature')) then raise sqlstate 'PT400' using message='Invalid review decision'; end if;
insert into private.npc_review_decisions(npc_id,version_id,reviewer_id,decision,notes) values(n,p_version_id,auth.uid(),p_decision,p_notes) on conflict(version_id,reviewer_id) do update set decision=excluded.decision,notes=excluded.notes;
if p_rating is not null then update private.npc_identities set rating=p_rating where id=n; end if;
select user_id into owner from private.npc_identity_owners where npc_id=n and ended_at is null;
if p_decision='request_changes' then
  update private.npc_versions set state='rejected' where id=p_version_id;
  insert into private.npc_drafts(npc_id,version_number,sheet,owner_id,selected_scene_asset_id)
    values(n,v.version_number+1,v.sheet,owner,v.selected_scene_asset_id) returning id into d;
  update private.npc_identities set status='changes_requested',updated_at=now() where id=n;
elsif p_decision='reject' then
  update private.npc_versions set state='rejected' where id=p_version_id;
  update private.npc_identities set status='rejected',updated_at=now() where id=n;
end if;
insert into private.npc_notifications(user_id,kind,payload) values(owner,'review_decision',jsonb_build_object('npcId',n,'versionId',p_version_id,'decision',p_decision,'notes',p_notes,'draftId',d));
return jsonb_build_object('versionId',p_version_id,'decision',p_decision,'draftId',d); end $$;
create function public.npc_reviewer_publish(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n uuid; owner uuid; begin select npc_id into n from private.npc_versions where id=p_version_id and state='submitted' for update; if n is null then raise sqlstate 'PT404'; end if;
perform private.assert_npc_reviewer(n);
if not exists(select 1 from private.npc_review_decisions where version_id=p_version_id and decision='approve') then raise sqlstate 'PT422' using message='An approval is required'; end if;
if not exists(select 1 from private.npc_evaluations where version_id=p_version_id and status='completed' and coalesce(result->'hardBlocks','[]'::jsonb)='[]'::jsonb and coalesce((result->>'prohibited')::boolean,false)=false) then raise sqlstate 'PT422' using message='A completed evaluation without hard blocks is required'; end if;
select user_id into owner from private.npc_identity_owners where npc_id=n and ended_at is null;
if (select count(distinct npc_id) from private.npc_versions where created_by=owner and state='published')>=private.npc_quota(owner,'published') then raise sqlstate 'PT429' using message='Published NPC quota reached'; end if;
update private.npc_versions set state='published',published_at=now() where id=p_version_id; update private.npc_identities set status='published',current_published_version_id=p_version_id,updated_at=now() where id=n;
insert into private.npc_notifications(user_id,kind,payload) values(owner,'published',jsonb_build_object('npcId',n,'versionId',p_version_id));
return jsonb_build_object('npcId',n,'versionId',p_version_id,'state','published'); end $$;
create function public.npc_admin_set_capability(p_user uuid,p_capability text,p_enabled boolean,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_npc_capability('admin') then raise sqlstate 'PT403'; end if;
if p_capability not in ('admin','npc_author','npc_reviewer') or length(trim(p_reason))<3 then raise sqlstate 'PT400' using message='Capability and reason are required'; end if;
insert into private.npc_capabilities(user_id,capability,granted_by,revoked_at,reason) values(p_user,p_capability,auth.uid(),case when p_enabled then null else now() end,p_reason)
on conflict(user_id,capability) do update set granted_by=auth.uid(),granted_at=case when p_enabled then now() else npc_capabilities.granted_at end,revoked_at=case when p_enabled then null else now() end,reason=p_reason;
if p_capability='npc_author' and not p_enabled then
  update private.npc_identities set status='retired',retired_at=now(),updated_at=now()
  where creator_id=p_user and origin='community' and status in ('draft','submitted','changes_requested','published','paused');
  insert into private.npc_notifications(user_id,kind,payload) values(p_user,'author_access_revoked',jsonb_build_object('reason',p_reason));
end if;
end $$;
create function public.npc_admin_users(p_query text default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path='' as $$
  select case when private.has_npc_capability('admin') then coalesce(jsonb_agg(jsonb_build_object('userId',u.id,'email',u.email,'displayName',p.display_name,
    'capabilities',coalesce(c.items,'[]'::jsonb)) order by coalesce(p.display_name,u.email)),'[]'::jsonb) else '[]'::jsonb end
  from (select * from auth.users where p_query is null or lower(coalesce(email,'')) like '%'||lower(p_query)||'%' order by created_at desc limit greatest(1,least(p_limit,100))) u
  left join public.player_profiles p on p.user_id=u.id
  left join lateral (select jsonb_agg(capability order by capability) items from private.npc_capabilities where user_id=u.id and revoked_at is null) c on true
$$;
create function public.npc_admin_transfer(p_npc uuid,p_new_owner uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_npc_capability('admin') or length(trim(p_reason))<3 then raise sqlstate 'PT403'; end if;
  update private.npc_identity_owners set ended_at=now(),reason=p_reason where npc_id=p_npc and ended_at is null;
  if not found then raise sqlstate 'PT404'; end if;
  insert into private.npc_identity_owners(npc_id,user_id,reason) values(p_npc,p_new_owner,p_reason);
  update private.npc_identities set creator_id=p_new_owner,updated_at=now() where id=p_npc;
  update private.npc_drafts set owner_id=p_new_owner where npc_id=p_npc and state='open';
end $$;
create function public.npc_admin_release_name(p_npc uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_npc_capability('npc_reviewer') and not private.has_npc_capability('admin') then raise sqlstate 'PT403'; end if;
perform private.assert_npc_reviewer(p_npc); if length(trim(p_reason))<3 then raise sqlstate 'PT400'; end if;
update private.npc_identities set name_reserved=false,updated_at=now() where id=p_npc and status='retired'; if not found then raise sqlstate 'PT422' using message='Only retired names may be released'; end if; end $$;
create function public.npc_bootstrap_admin(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
insert into private.npc_capabilities(user_id,capability,granted_by,reason) values(p_user,'admin',p_user,'Local service bootstrap')
on conflict(user_id,capability) do update set revoked_at=null,granted_at=now(),reason='Local service bootstrap'; end $$;
create function public.npc_inbox(p_limit integer default 50) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'payload',payload,'createdAt',created_at,'readAt',read_at) order by created_at desc),'[]'::jsonb) from (select * from private.npc_notifications where user_id=auth.uid() order by created_at desc limit greatest(1,least(p_limit,100))) q
$$;
create function public.npc_author_analytics() returns jsonb language sql stable security definer set search_path='' as $$
  select case when private.has_npc_capability('npc_author') then coalesce(jsonb_agg(jsonb_build_object('day',a.event_day,'versionId',a.version_id,
    'assignments',a.assignments,'activeWorlds',a.active_worlds,'dialogueTurns',a.dialogue_turns,'daysPresent',a.days_present,
    'hospitalityInteractions',a.hospitality_interactions,'milestoneSuccesses',a.milestone_successes,'milestoneFailures',a.milestone_failures,
    'abandonments',a.abandonments,'campaignCompletions',a.campaign_completions,'dismissals',a.dismissals,'reportBand',a.report_band)
    order by a.event_day desc),'[]'::jsonb) else '[]'::jsonb end
  from public.npc_daily_analytics a join private.npc_versions v on v.id=a.version_id join private.npc_identities i on i.id=v.npc_id where private.npc_is_owner(i.id)
$$;
create function public.npc_record_engagement(p_actor uuid,p_version uuid,p_kind text,p_metadata jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s uuid; begin if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
select id into s from public.tavern_saves where user_id=p_actor;
insert into private.npc_engagement_events(actor_id,event_kind,npc_id,version_id,world_hash,metadata)
select p_actor,p_kind,v.npc_id,p_version,encode(extensions.digest(coalesce(s::text,p_actor::text),'sha256'),'hex'),coalesce(p_metadata,'{}') from private.npc_versions v where v.id=p_version; end $$;
create function public.npc_rollup_analytics(p_day date) returns void language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
insert into public.npc_daily_analytics(event_day,version_id,assignments,active_worlds,dialogue_turns,days_present,hospitality_interactions,milestone_successes,milestone_failures,abandonments,campaign_completions,dismissals,report_band)
select p_day,v.id,
  count(*) filter(where e.event_kind='assigned'),count(distinct e.world_hash) filter(where e.event_kind='active'),count(*) filter(where e.event_kind='dialogue'),
  count(*) filter(where e.event_kind='day_present'),count(*) filter(where e.event_kind='hospitality'),count(*) filter(where e.event_kind='milestone_success'),
  count(*) filter(where e.event_kind='milestone_failure'),count(*) filter(where e.event_kind='abandoned'),count(*) filter(where e.event_kind='campaign_complete'),
  count(*) filter(where e.event_kind='dismissed'),case when count(*) filter(where e.event_kind='report')=0 then 'none' when count(*) filter(where e.event_kind='report')<3 then 'some' else 'threshold' end
from private.npc_versions v left join private.npc_engagement_events e on e.version_id=v.id and e.event_day=p_day group by v.id
on conflict(event_day,version_id) do update set assignments=excluded.assignments,active_worlds=excluded.active_worlds,dialogue_turns=excluded.dialogue_turns,
days_present=excluded.days_present,hospitality_interactions=excluded.hospitality_interactions,milestone_successes=excluded.milestone_successes,
milestone_failures=excluded.milestone_failures,abandonments=excluded.abandonments,campaign_completions=excluded.campaign_completions,dismissals=excluded.dismissals,report_band=excluded.report_band;
end $$;
create function public.npc_public_creator(p_normalized_name text) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('displayName',p.display_name,'bio',p.bio,'joinedAt',p.created_at,'npcs',coalesce(n.items,'[]'::jsonb))
  from public.player_profiles p left join lateral (
    select jsonb_agg(jsonb_build_object('npcId',i.id,'name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}','status',i.status) order by v.sheet#>>'{identity,name}') items
    from private.npc_identities i join private.npc_versions v on v.id=i.current_published_version_id
    where i.creator_id=p.user_id and i.status in ('published','retired')
  ) n on true where p.normalized_display_name=lower(trim(p_normalized_name))
$$;
create function public.npc_set_mature_preference(p_enabled boolean,p_attest boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
perform public.npc_update_profile((public.npc_profile_me()->>'displayName'),(public.npc_profile_me()->>'bio'),p_enabled,p_attest,false);
if not p_enabled then
  select id into s from public.tavern_saves where user_id=auth.uid() for update;
  if s is not null then
    insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason)
      select w.save_id,w.npc_id,w.version_id,'mature_purged' from private.world_npc_instances w join private.npc_identities i on i.id=w.npc_id
      where w.save_id=s and i.rating='mature' and w.status not in ('removed','quarantined') on conflict do nothing;
    update private.world_npc_instances w set status='removed' from private.npc_identities i where i.id=w.npc_id and w.save_id=s and i.rating='mature';
  end if;
end if;
return public.npc_profile_me(); end $$;
create function public.npc_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'name',case when w.status in ('removed','quarantined') then 'Unavailable guest' else v.sheet#>>'{identity,name}' end,'title',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,title}' end,'status',w.status,'relationship',w.relationship,'rating',i.rating,'origin',i.origin,'creatorId',case when i.origin='community' then i.creator_id else null end) order by w.npc_id),'[]'::jsonb)
  from (select w.* from private.world_npc_instances w join public.tavern_saves s on s.id=w.save_id where s.user_id=auth.uid() and (p_cursor is null or w.id>p_cursor) order by w.id limit greatest(1,least(p_limit,100))) w join private.npc_versions v on v.id=w.version_id join private.npc_identities i on i.id=w.npc_id
  where p_query is null or lower(v.sheet#>>'{identity,name}') like '%'||lower(p_query)||'%'
$$;
create function public.npc_journals(p_instance_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(w.id::text,jsonb_build_object('status',w.status,'campaign',w.campaign_state,'events',coalesce(e.events,'[]'::jsonb))),'{}'::jsonb)
  from private.world_npc_instances w join public.tavern_saves s on s.id=w.save_id left join lateral (select jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',narration) order by day desc) events from (select * from private.world_npc_quest_events where instance_id=w.id order by day desc limit 6) x) e on true
  where s.user_id=auth.uid() and w.id=any(p_instance_ids)
$$;
create function public.npc_world_accept_plan(p_actor uuid,p_instance uuid,p_steps jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_world private.world_npc_instances; v_step jsonb; v_index integer:=0;
begin
if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
select world_row.* into v_world from private.world_npc_instances world_row join public.tavern_saves save_row on save_row.id=world_row.save_id
  where world_row.id=p_instance and save_row.user_id=p_actor and world_row.status in ('between','failed') for update;
if not found or jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 3 then raise sqlstate 'PT422' using message='A bounded milestone plan is required'; end if;
for v_step in select value from jsonb_array_elements(p_steps) loop
  if v_step->>'action' not in ('prepare','wait','attempt','abandon') or v_step->>'approach' not in ('scouting','combat','diplomacy','trade')
    or (v_index<jsonb_array_length(p_steps)-1 and v_step->>'action' not in ('prepare','wait'))
    or (v_index=jsonb_array_length(p_steps)-1 and v_step->>'action' not in ('attempt','abandon')) then raise sqlstate 'PT422' using message='Unsupported plan'; end if;
  v_index:=v_index+1;
end loop;
update private.world_npc_instances set status='active',campaign_state=jsonb_set(jsonb_set(jsonb_set(campaign_state,'{step}','0'::jsonb),'{preparation}','0'::jsonb),'{activePlan}',p_steps)
  where id=p_instance;
return jsonb_build_object('instanceId',p_instance,'status','active','steps',p_steps); end $$;
create function public.npc_dismiss(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_world private.world_npc_instances; begin select world_row.* into v_world from private.world_npc_instances world_row join public.tavern_saves save_row on save_row.id=world_row.save_id where world_row.id=p_instance and save_row.user_id=auth.uid() for update; if not found then raise sqlstate 'PT404'; end if;
update private.world_npc_instances set status='dismissed',dismissed_day=(select current_day from public.tavern_saves where id=v_world.save_id) where id=v_world.id; insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason) values(v_world.save_id,v_world.npc_id,v_world.version_id,'dismissed') on conflict do nothing; end $$;
create function public.npc_report(p_version uuid,p_category text,p_evidence text) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid; r uuid; v private.npc_versions; v_transcript jsonb; v_generation jsonb;
begin
select id into s from public.tavern_saves where user_id=auth.uid();
if s is null or not exists(select 1 from private.world_npc_instances where save_id=s and version_id=p_version and status not in ('removed','quarantined')) then raise sqlstate 'PT404' using message='That NPC version is not present in this world'; end if;
select * into v from private.npc_versions where id=p_version;
select coalesce(jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',narration) order by day,id),'[]'::jsonb)
  into v_transcript from private.world_npc_quest_events where instance_id=(select id from private.world_npc_instances where save_id=s and version_id=p_version limit 1);
select coalesce(generation,'{}') into v_generation from private.npc_assets where id=v.selected_scene_asset_id;
insert into private.npc_reports(reporter_id,world_id,version_id,category,evidence,transcript,frozen_version,generation_metadata)
  values(auth.uid(),s,p_version,p_category,p_evidence,v_transcript,jsonb_build_object('versionId',v.id,'npcId',v.npc_id,'sheetHash',v.sheet_hash,'sheet',v.sheet),coalesce(v_generation,'{}')) returning id into r;
return r; end $$;
create function public.npc_share_preview(p_instance uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_transcript jsonb; begin
if not exists(select 1 from private.world_npc_instances w join public.tavern_saves s on s.id=w.save_id where w.id=p_instance and s.user_id=auth.uid()) then raise sqlstate 'PT404'; end if;
select coalesce(jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',narration) order by day,id),'[]'::jsonb) into v_transcript from private.world_npc_quest_events where instance_id=p_instance;
return jsonb_build_object('instanceId',p_instance,'transcript',v_transcript,'contentHash',encode(extensions.digest(v_transcript::text,'sha256'),'hex'),'irreversible',true); end $$;
create function public.npc_share_conversation(p_instance uuid,p_expected_hash text,p_include_display_name boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; preview jsonb; profile_name text; begin
preview:=public.npc_share_preview(p_instance);
if preview->>'contentHash'<>p_expected_hash then raise sqlstate 'PT409' using message='Conversation preview changed'; end if;
if p_include_display_name then select display_name into profile_name from public.player_profiles where user_id=auth.uid(); end if;
insert into private.npc_conversation_shares(save_id,instance_id,created_by,transcript,include_display_name,display_name_snapshot)
select s.id,p_instance,auth.uid(),preview->'transcript',p_include_display_name,profile_name from public.tavern_saves s where s.user_id=auth.uid() returning share_token into r; return r; end $$;
create function public.npc_request_retirement(p_npc uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; begin if not private.npc_is_owner(p_npc) then raise sqlstate 'PT403'; end if;
insert into private.npc_retirement_requests(npc_id,requested_by,reason) values(p_npc,auth.uid(),p_reason) returning id into r; return r; end $$;
create function public.npc_reviewer_retirement(p_request uuid,p_approve boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare n uuid; owner uuid; begin select npc_id into n from private.npc_retirement_requests where id=p_request and status='open' for update;
if n is null then raise sqlstate 'PT404'; end if; perform private.assert_npc_reviewer(n);
update private.npc_retirement_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now(),reason=reason||E'\nDecision: '||p_reason where id=p_request;
if p_approve then update private.npc_identities set status='retired',retired_at=now(),updated_at=now() where id=n; end if;
select user_id into owner from private.npc_identity_owners where npc_id=n and ended_at is null;
insert into private.npc_notifications(user_id,kind,payload) values(owner,'retirement_decision',jsonb_build_object('npcId',n,'approved',p_approve,'reason',p_reason)); end $$;
create function public.npc_appeal_report(p_report uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; n uuid; begin select v.npc_id into n from private.npc_reports p join private.npc_versions v on v.id=p.version_id where p.id=p_report;
if n is null or not private.npc_is_owner(n) then raise sqlstate 'PT403'; end if;
insert into private.npc_report_appeals(report_id,appellant_id,body) values(p_report,auth.uid(),p_body) returning id into r; return r; end $$;
create function public.npc_reviewer_resolve_report(p_report uuid,p_uphold boolean,p_reviewer_reason text,p_creator_reason text,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare n uuid; reporter uuid; owner uuid; begin select v.npc_id,p.reporter_id into n,reporter from private.npc_reports p join private.npc_versions v on v.id=p.version_id where p.id=p_report and p.status='open' for update;
if n is null then raise sqlstate 'PT404'; end if; perform private.assert_npc_reviewer(n);
if p_action not in ('none','reinstate','pause','quarantine','ban') or length(trim(p_reviewer_reason))<3 or length(trim(p_creator_reason))<3 then raise sqlstate 'PT400'; end if;
update private.npc_reports set status=case when p_uphold then 'upheld' else 'dismissed' end,reviewer_reason=p_reviewer_reason,creator_reason=p_creator_reason,remedial_action=p_action,decided_by=auth.uid(),decided_at=now() where id=p_report;
if p_action='reinstate' then update private.npc_identities set status='published',updated_at=now() where id=n and current_published_version_id is not null;
elsif p_action='pause' then update private.npc_identities set status='paused',updated_at=now() where id=n;
elsif p_action in ('quarantine','ban') then
  insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason)
    select save_id,npc_id,version_id,case when p_action='ban' then 'banned' else 'quarantined' end from private.world_npc_instances where npc_id=n on conflict do nothing;
  update private.world_npc_instances set status=case when p_action='ban' then 'removed' else 'quarantined' end where npc_id=n;
  update private.npc_identities set status=case when p_action='ban' then 'banned' else 'paused' end,updated_at=now() where id=n;
end if;
select user_id into owner from private.npc_identity_owners where npc_id=n and ended_at is null;
insert into private.npc_notifications(user_id,kind,payload) values
  (reporter,'report_decision',jsonb_build_object('reportId',p_report,'upheld',p_uphold,'reason',p_reviewer_reason,'action',p_action)),
  (owner,'content_report_decision',jsonb_build_object('npcId',n,'upheld',p_uphold,'reason',p_creator_reason,'action',p_action));
end $$;
create function public.npc_admin_quarantine_or_purge(p_npc uuid,p_purge boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.assert_npc_reviewer(p_npc); if length(trim(p_reason))<3 then raise sqlstate 'PT400'; end if;
update private.npc_identities set status=case when p_purge then 'banned' else 'paused' end,purged_at=case when p_purge then now() end where id=p_npc;
insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason) select w.save_id,w.npc_id,w.version_id,case when p_purge then 'banned' else 'quarantined' end from private.world_npc_instances w where w.npc_id=p_npc on conflict do nothing;
update private.world_npc_instances set status=case when p_purge then 'removed' else 'quarantined' end where npc_id=p_npc;
end $$;

alter table public.player_profiles enable row level security;
revoke all on public.player_profiles, public.npc_daily_analytics from public,anon,authenticated;
grant all on public.player_profiles, public.npc_daily_analytics to service_role;
revoke all on all tables in schema private from public,anon,authenticated;
revoke usage on schema private from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
revoke all on function private.create_tavern_before_community_npcs(),private.advance_tavern_day_before_community_npcs(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.create_tavern(),public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.create_tavern(),public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
revoke all on function
  public.npc_profile_me(),public.npc_update_profile(text,text,boolean,boolean,boolean),public.npc_my_capabilities(),
  public.npc_author_workspace(),public.npc_author_create(jsonb),public.npc_author_save(uuid,bigint,jsonb),public.npc_author_add_scene(uuid,text,text,jsonb),
  public.npc_author_submit(uuid,bigint),public.npc_author_reserve_call(uuid,text,jsonb),public.npc_generation_complete(uuid,jsonb,text),public.npc_evaluation_complete(uuid,jsonb,text),
  public.npc_reviewer_queue(),public.npc_reviewer_comment(uuid,uuid,text,text),public.npc_reviewer_decide(uuid,text,text,text),public.npc_reviewer_publish(uuid),
  public.npc_admin_set_capability(uuid,text,boolean,text),public.npc_admin_users(text,integer),public.npc_admin_transfer(uuid,uuid,text),public.npc_admin_release_name(uuid,text),public.npc_bootstrap_admin(uuid),
  public.npc_inbox(integer),public.npc_author_analytics(),public.npc_record_engagement(uuid,uuid,text,jsonb),public.npc_rollup_analytics(date),public.npc_public_creator(text),
  public.npc_set_mature_preference(boolean,boolean),public.npc_roster(integer,uuid,text),public.npc_journals(uuid[]),public.npc_world_accept_plan(uuid,uuid,jsonb),public.npc_dismiss(uuid),
  public.npc_report(uuid,text,text),public.npc_share_preview(uuid),public.npc_share_conversation(uuid,text,boolean),public.npc_request_retirement(uuid,text),
  public.npc_reviewer_retirement(uuid,boolean,text),public.npc_appeal_report(uuid,text),public.npc_reviewer_resolve_report(uuid,boolean,text,text,text),
  public.npc_admin_quarantine_or_purge(uuid,boolean,text)
from public,anon,authenticated;
grant execute on function
  public.npc_profile_me(),public.npc_update_profile(text,text,boolean,boolean,boolean),public.npc_my_capabilities(),
  public.npc_author_workspace(),public.npc_author_create(jsonb),public.npc_author_save(uuid,bigint,jsonb),public.npc_author_add_scene(uuid,text,text,jsonb),
  public.npc_author_submit(uuid,bigint),public.npc_author_reserve_call(uuid,text,jsonb),public.npc_reviewer_queue(),public.npc_reviewer_comment(uuid,uuid,text,text),
  public.npc_reviewer_decide(uuid,text,text,text),public.npc_reviewer_publish(uuid),public.npc_admin_set_capability(uuid,text,boolean,text),public.npc_admin_users(text,integer),
  public.npc_admin_transfer(uuid,uuid,text),public.npc_admin_release_name(uuid,text),public.npc_inbox(integer),public.npc_author_analytics(),public.npc_public_creator(text),
  public.npc_set_mature_preference(boolean,boolean),public.npc_roster(integer,uuid,text),public.npc_journals(uuid[]),public.npc_dismiss(uuid),public.npc_report(uuid,text,text),
  public.npc_share_preview(uuid),public.npc_share_conversation(uuid,text,boolean),public.npc_request_retirement(uuid,text),public.npc_reviewer_retirement(uuid,boolean,text),
  public.npc_appeal_report(uuid,text),public.npc_reviewer_resolve_report(uuid,boolean,text,text,text),public.npc_admin_quarantine_or_purge(uuid,boolean,text)
to authenticated;
grant execute on function public.npc_bootstrap_admin(uuid),public.npc_generation_complete(uuid,jsonb,text),public.npc_evaluation_complete(uuid,jsonb,text),
  public.npc_record_engagement(uuid,uuid,text,jsonb),public.npc_rollup_analytics(date),public.npc_world_accept_plan(uuid,uuid,jsonb) to service_role;
grant execute on function public.npc_public_creator(text) to anon;

commit;
