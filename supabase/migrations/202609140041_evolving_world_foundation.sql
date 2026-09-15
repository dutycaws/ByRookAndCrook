-- Issue #17 P2: durable, save-scoped evolving-world persistence foundation.
-- This migration intentionally does NOT replace public.advance_tavern_day or
-- either private wrapper it already calls. Future close-day work will enqueue
-- and settle these records through that established chain.
begin;

alter table public.tavern_saves add column if not exists world_phase text not null default 'open'
  check (world_phase in ('open','settling'));

create table private.world_canonical_entities (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  entity_kind text not null check(entity_kind in ('npc','location','faction','item','recipe','world_event')),
  entity_key text not null check(entity_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  origin text not null check(origin in ('authored','procedural','player','imported')),
  source_version text not null default 'world-v1', payload jsonb not null default '{}'::jsonb,
  lifecycle text not null default 'active' check(lifecycle in ('undiscovered','discovered','active','retired')),
  discovered_day integer, retired_day integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(save_id,entity_kind,entity_key),
  check(jsonb_typeof(payload)='object'), check((lifecycle='retired') = (retired_day is not null) or lifecycle<>'retired')
);
create index world_canonical_entities_active on private.world_canonical_entities(save_id,entity_kind) where lifecycle='active';
create table private.world_canonical_entity_history (
  id bigint generated always as identity primary key, entity_id uuid not null references private.world_canonical_entities(id) on delete cascade,
  event_kind text not null check(event_kind in ('created','discovered','activated','retired','revised')),
  payload jsonb not null default '{}'::jsonb, source_version text not null, created_at timestamptz not null default now()
);
create function private.world_history_append_only() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op in ('UPDATE','DELETE') then raise exception using errcode='55000',message='World history is append-only'; end if; return new;
end $$;
create trigger world_canonical_history_append_only before update or delete on private.world_canonical_entity_history for each row execute function private.world_history_append_only();

create table private.world_resident_profiles (
  instance_id uuid primary key references private.world_npc_instances(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  profile_revision bigint not null default 1 check(profile_revision>0),
  frozen_sheet jsonb not null, pressure jsonb not null default '{}'::jsonb, evidence_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(save_id,npc_id), check(jsonb_typeof(frozen_sheet)='object'),check(jsonb_typeof(pressure)='object'),check(jsonb_typeof(evidence_refs)='array')
);
alter table private.world_resident_profiles
  add column profile_schema_version text not null default 'resident-profile-compat-v1',
  add column capability_source_version text not null default 'npc-sheet-v1',
  add column appearance_source_version text not null default 'npc-sheet-v1',
  add column current_profile jsonb not null default '{}'::jsonb,
  add column public_disposition jsonb not null default '{}'::jsonb;
alter table private.world_resident_profiles add constraint world_profile_shape check (jsonb_typeof(current_profile)='object' and jsonb_typeof(public_disposition)='object' and octet_length(public_disposition::text)<=2048);
create table private.world_resident_personality_ledger (
  id bigint generated always as identity primary key, instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  profile_revision bigint not null check(profile_revision>0), receipt_key uuid not null, delta jsonb not null, evidence_refs jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(),
  unique(instance_id,receipt_key), check(jsonb_typeof(delta)='object'),check(jsonb_typeof(evidence_refs)='array')
);
create trigger world_personality_ledger_append_only before update or delete on private.world_resident_personality_ledger for each row execute function private.world_history_append_only();
create table private.world_resident_pressure (
  id uuid primary key default extensions.gen_random_uuid(), instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  target_kind text not null check(target_kind in ('npc','location','faction','item','quest')), target_key text not null,
  pressure smallint not null check(pressure between -100 and 100), evidence_refs jsonb not null default '[]'::jsonb,
  updated_day integer not null check(updated_day>=0), signature text not null check(char_length(signature)>=8), created_at timestamptz not null default now(),
  unique(instance_id,target_kind,target_key,updated_day),check(jsonb_typeof(evidence_refs)='array')
);
create table private.world_resident_beliefs (
  id uuid primary key default extensions.gen_random_uuid(), instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  fingerprint text not null check(char_length(fingerprint) between 8 and 128), statement text not null check(char_length(statement) between 1 and 1000),
  confidence smallint not null check(confidence between 0 and 100), provenance text not null check(provenance in ('authored','dialogue','event','inference','player_claim')),
  subject_key text not null default 'world', provenance_chain jsonb not null default '[]'::jsonb, original_claim_fingerprint text not null default 'authored', contradiction_status text not null default 'none' check(contradiction_status in ('none','contested','contradicted','retracted')),
  contradiction_of uuid references private.world_resident_beliefs(id), active boolean not null default true, created_at timestamptz not null default now(), retired_at timestamptz,
  unique(instance_id,fingerprint,active)
);
alter table private.world_resident_beliefs add constraint world_belief_chain_shape check(jsonb_typeof(provenance_chain)='array');
create table private.world_resident_belief_history (
  id bigint generated always as identity primary key, belief_id uuid not null references private.world_resident_beliefs(id) on delete cascade,
  event_kind text not null check(event_kind in ('created','confidence_changed','contradicted','retired')), detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create trigger world_belief_history_append_only before update or delete on private.world_resident_belief_history for each row execute function private.world_history_append_only();
create table private.world_social_edges (
  save_id uuid not null references public.tavern_saves(id) on delete cascade, from_instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  to_instance_id uuid not null references private.world_npc_instances(id) on delete cascade, trust smallint not null default 0 check(trust between -100 and 100),
  affection smallint not null default 0 check(affection between -100 and 100),respect smallint not null default 0 check(respect between -100 and 100),fear smallint not null default 0 check(fear between -100 and 100),obligation smallint not null default 0 check(obligation between -100 and 100),
  evidence_refs jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now(), primary key(save_id,from_instance_id,to_instance_id),check(from_instance_id<>to_instance_id),check(jsonb_typeof(evidence_refs)='array')
);

create table private.world_procedural_quests (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade, state text not null default 'active' check(state in ('active','resolved','failed','abandoned','retired')),
  primitive_key text not null, input_fingerprint text not null, payload jsonb not null default '{}'::jsonb, started_day integer not null, ended_day integer,
  created_at timestamptz not null default now(), check(jsonb_typeof(payload)='object')
);
create unique index world_one_active_procedural_quest on private.world_procedural_quests(instance_id) where state='active';
create table private.world_effect_receipts (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  quest_id uuid references private.world_procedural_quests(id) on delete set null, effect_key text not null, capability text not null check(capability in ('reversible','irreversible')),
  critic_status text not null default 'pending' check(critic_status in ('pending','approved','rejected')), public_full_day boolean not null default false,
  input_fingerprint text not null, payload jsonb not null default '{}'::jsonb, committed_at timestamptz, unique(save_id,input_fingerprint,effect_key),check(jsonb_typeof(payload)='object'),
  check(capability<>'irreversible' or (critic_status='approved' and public_full_day))
);
create table private.world_effect_warnings (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  quest_id uuid references private.world_procedural_quests(id) on delete cascade, warning_key text not null, payload jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz, created_at timestamptz not null default now(), unique(save_id,warning_key),check(jsonb_typeof(payload)='object')
);
create table private.world_irreversible_capabilities (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  target_instance_id uuid not null references private.world_npc_instances(id) on delete cascade, capability_key text not null,
  critic_approved boolean not null default false, immutable_at timestamptz, created_at timestamptz not null default now(), unique(save_id,target_instance_id,capability_key)
);
alter table private.world_effect_warnings add column target_instance_id uuid references private.world_npc_instances(id), add column visible_day integer not null default 0;
alter table private.world_effect_receipts add column target_instance_id uuid references private.world_npc_instances(id), add column capability_id uuid references private.world_irreversible_capabilities(id), add column warning_id uuid references private.world_effect_warnings(id), add column earliest_resolution_day integer;

create table private.world_settlements (
  id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null, source_revision bigint not null, input_fingerprint text not null, status text not null default 'queued' check(status in ('queued','processing','completed','failed','skipped','expired')),
  deadline_at timestamptz not null default (clock_timestamp()+interval '120 seconds'), fence uuid, lease_until timestamptz, terminal_receipt jsonb, usage jsonb not null default '{}'::jsonb, failure_code text, skip_reason text,
  created_at timestamptz not null default now(), completed_at timestamptz, unique(save_id,day_number),check(jsonb_typeof(usage)='object')
);
create table private.world_settlement_jobs (
  id uuid primary key default extensions.gen_random_uuid(), settlement_id uuid not null references private.world_settlements(id) on delete cascade,
  ordinal smallint not null check(ordinal between 1 and 64), job_kind text not null check(job_kind in ('snapshot','canon','resident','quest','effects','news','finalize')),
  status text not null default 'queued' check(status in ('queued','processing','completed','failed','skipped')), input_fingerprint text not null, output jsonb, usage jsonb not null default '{}'::jsonb,
  failure_code text, created_at timestamptz not null default now(), completed_at timestamptz, unique(settlement_id,ordinal),unique(settlement_id,job_kind),check(jsonb_typeof(usage)='object')
);
create table private.world_settlement_attempts (
  id uuid primary key default extensions.gen_random_uuid(), job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,
  attempt_number smallint not null check(attempt_number between 1 and 3), fence uuid not null, lease_until timestamptz not null, status text not null default 'processing' check(status in ('processing','completed','failed','expired')),
  usage jsonb not null default '{}'::jsonb, failure_code text, started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  unique(job_id,attempt_number), unique(fence),check(jsonb_typeof(usage)='object')
);
create table private.world_settlement_outbox (
  id uuid primary key default extensions.gen_random_uuid(), settlement_id uuid not null references private.world_settlements(id) on delete cascade,
  job_id uuid references private.world_settlement_jobs(id) on delete cascade, event_key text not null, payload jsonb not null default '{}'::jsonb,
  delivered_at timestamptz, created_at timestamptz not null default now(), unique(settlement_id,event_key),check(jsonb_typeof(payload)='object')
);
create table private.world_settlement_action_receipts (
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade, fence uuid not null, action_kind text not null check(action_kind in ('complete','fail')),
  result jsonb not null, created_at timestamptz not null default now(), primary key(job_id,fence,action_kind),check(jsonb_typeof(result)='object')
);

create function private.world_profile_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if tg_op='INSERT' then
    if not exists(select 1 from private.world_npc_instances w where w.id=new.instance_id and w.save_id=new.save_id and w.npc_id=new.npc_id and w.version_id=new.version_id) then raise exception using errcode='23514',message='Resident profile must match its save-pinned NPC instance'; end if;
  else
    if new.instance_id<>old.instance_id or new.save_id<>old.save_id or new.npc_id<>old.npc_id or new.version_id<>old.version_id or new.frozen_sheet<>old.frozen_sheet or new.profile_schema_version<>old.profile_schema_version or new.capability_source_version<>old.capability_source_version or new.appearance_source_version<>old.appearance_source_version then raise exception using errcode='55000',message='Resident source pins are immutable'; end if;
    if new.profile_revision<>old.profile_revision then
      if new.profile_revision<>old.profile_revision+1 or not exists(select 1 from private.world_resident_personality_ledger l where l.instance_id=old.instance_id and l.profile_revision=new.profile_revision) then raise exception using errcode='55000',message='Profile revision requires an append-only ledger receipt'; end if;
    elsif new.current_profile<>old.current_profile or new.public_disposition<>old.public_disposition then raise exception using errcode='55000',message='Profile state requires a new revision receipt'; end if;
  end if; return new; end $$;
create trigger world_profile_guard before insert or update on private.world_resident_profiles for each row execute function private.world_profile_guard();
create function private.world_canonical_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.save_id<>old.save_id or new.entity_kind<>old.entity_kind or new.entity_key<>old.entity_key or new.origin<>old.origin or new.source_version<>old.source_version or new.payload<>old.payload then raise exception using errcode='55000',message='Canonical identity and payload require an append-only revision path'; end if;
  if new.lifecycle<>old.lifecycle and not exists(select 1 from private.world_canonical_entity_history h where h.entity_id=old.id and h.event_kind=case new.lifecycle when 'retired' then 'retired' when 'active' then 'activated' else 'discovered' end) then raise exception using errcode='55000',message='Canonical lifecycle requires history evidence'; end if; return new; end $$;
create trigger world_canonical_guard before update on private.world_canonical_entities for each row execute function private.world_canonical_guard();
create function private.world_canonical_no_delete() returns trigger language plpgsql set search_path='' as $$ begin raise exception using errcode='55000',message='Canonical entities are retained with their append-only history'; end $$;
create trigger world_canonical_no_delete before delete on private.world_canonical_entities for each row execute function private.world_canonical_no_delete();
alter table private.world_canonical_entity_history drop constraint if exists world_canonical_entity_history_entity_id_fkey;
alter table private.world_canonical_entity_history add constraint world_canonical_entity_history_entity_id_fkey foreign key(entity_id) references private.world_canonical_entities(id) on delete restrict;
create function private.world_belief_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.instance_id<>old.instance_id or new.fingerprint<>old.fingerprint or new.statement<>old.statement or new.confidence<>old.confidence or new.provenance<>old.provenance or new.subject_key<>old.subject_key or new.provenance_chain<>old.provenance_chain or new.original_claim_fingerprint<>old.original_claim_fingerprint or new.contradiction_of is distinct from old.contradiction_of then raise exception using errcode='55000',message='Belief identity requires an append-only revision'; end if;
    if not(old.active and not new.active and new.contradiction_status='retracted' and new.retired_at is not null and exists(select 1 from private.world_resident_belief_history h where h.belief_id=old.id and h.event_kind='retired')) then raise exception using errcode='55000',message='Belief retraction requires append-only history'; end if;
  end if;
  if tg_op='DELETE' then raise exception using errcode='55000',message='Beliefs are append-only'; end if;
  if new.contradiction_of is not null and not exists(select 1 from private.world_resident_beliefs b where b.id=new.contradiction_of and b.instance_id=new.instance_id) then raise exception using errcode='23514',message='Belief contradiction must target the same resident'; end if;
  return new; end $$;
create trigger world_belief_guard before insert or update or delete on private.world_resident_beliefs for each row execute function private.world_belief_guard();
alter table private.world_resident_beliefs drop constraint if exists world_resident_beliefs_instance_id_fingerprint_active_key;
create unique index world_one_active_belief_fingerprint on private.world_resident_beliefs(instance_id,fingerprint) where active;
create function private.world_save_scope_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if tg_table_name='world_social_edges' then
    if not exists(select 1 from private.world_npc_instances w where w.id=new.from_instance_id and w.save_id=new.save_id) or not exists(select 1 from private.world_npc_instances w where w.id=new.to_instance_id and w.save_id=new.save_id) then raise exception using errcode='23514',message='Social edges cannot cross saves'; end if;
  elsif tg_table_name='world_procedural_quests' then if not exists(select 1 from private.world_npc_instances w where w.id=new.instance_id and w.save_id=new.save_id) then raise exception using errcode='23514',message='Quest cannot cross saves'; end if;
  elsif tg_table_name='world_effect_warnings' then if new.target_instance_id is not null and not exists(select 1 from private.world_npc_instances w where w.id=new.target_instance_id and w.save_id=new.save_id) then raise exception using errcode='23514',message='Warning cannot cross saves'; end if; if new.quest_id is not null and not exists(select 1 from private.world_procedural_quests q where q.id=new.quest_id and q.save_id=new.save_id) then raise exception using errcode='23514',message='Warning quest cannot cross saves'; end if;
  elsif tg_table_name='world_effect_receipts' then
    if new.target_instance_id is not null and not exists(select 1 from private.world_npc_instances w where w.id=new.target_instance_id and w.save_id=new.save_id) then raise exception using errcode='23514',message='Effect cannot cross saves'; end if;
    if new.quest_id is not null and not exists(select 1 from private.world_procedural_quests q where q.id=new.quest_id and q.save_id=new.save_id) then raise exception using errcode='23514',message='Effect quest cannot cross saves'; end if;
  end if; return new; end $$;
create trigger world_social_scope_guard before insert or update on private.world_social_edges for each row execute function private.world_save_scope_guard();
create trigger world_quest_scope_guard before insert or update on private.world_procedural_quests for each row execute function private.world_save_scope_guard();
create trigger world_warning_scope_guard before insert or update on private.world_effect_warnings for each row execute function private.world_save_scope_guard();
create function private.world_capability_scope_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if tg_op='UPDATE' and old.immutable_at is not null then raise exception using errcode='55000',message='Immutable capability cannot be rewritten'; end if;
  if not exists(select 1 from private.world_npc_instances w where w.id=new.target_instance_id and w.save_id=new.save_id) then raise exception using errcode='23514',message='Capability cannot cross saves'; end if; return new; end $$;
create trigger world_capability_scope_guard before insert or update on private.world_irreversible_capabilities for each row execute function private.world_capability_scope_guard();
create function private.world_irreversible_effect_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare cap private.world_irreversible_capabilities; warning private.world_effect_warnings; v_current_day integer;
begin
  if new.capability='irreversible' and new.committed_at is not null then
    select * into cap from private.world_irreversible_capabilities where id=new.capability_id and save_id=new.save_id and target_instance_id=new.target_instance_id and critic_approved and immutable_at is not null;
    select * into warning from private.world_effect_warnings where id=new.warning_id and save_id=new.save_id and target_instance_id=new.target_instance_id;
    select t.current_day into v_current_day from public.tavern_saves t where t.id=new.save_id;
    if not found or cap.id is null or v_current_day<warning.visible_day+1 then raise exception using errcode='23514',message='Irreversible effect requires approved immutable capability and a full visible warning day'; end if;
  end if; return new; end $$;
create trigger world_effect_scope_guard before insert or update on private.world_effect_receipts for each row execute function private.world_save_scope_guard();
create trigger world_irreversible_effect_guard before insert or update on private.world_effect_receipts for each row execute function private.world_irreversible_effect_guard();

-- Existing resident rows gain a save-scoped pinned profile without changing
-- their legacy relationship scalar or the established day-advance wrappers.
insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,public_disposition)
select w.id,w.save_id,w.npc_id,w.version_id,v.sheet,jsonb_build_object('identity',v.sheet->'identity','personality',v.sheet->'personality'),jsonb_build_object('name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') from private.world_npc_instances w join private.npc_versions v on v.id=w.version_id
on conflict(instance_id) do nothing;
create function private.world_resident_profile_backfill() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.world_resident_profiles(instance_id,save_id,npc_id,version_id,frozen_sheet,current_profile,public_disposition)
  select new.id,new.save_id,new.npc_id,new.version_id,v.sheet,jsonb_build_object('identity',v.sheet->'identity','personality',v.sheet->'personality'),jsonb_build_object('name',v.sheet#>>'{identity,name}','title',v.sheet#>>'{identity,title}') from private.npc_versions v where v.id=new.version_id
  on conflict(instance_id) do nothing;
  return new;
end $$;
create trigger world_resident_profile_backfill after insert on private.world_npc_instances
  for each row execute function private.world_resident_profile_backfill();

create function private.world_settlement_assert_service() returns void language plpgsql stable security definer set search_path='' as $$ begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403' using message='World settlement workers are server-only'; end if;
end $$;
create function private.world_settlement_finalize_deadline(p_settlement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; receipt jsonb;
begin
  select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  if s.status in ('completed','failed','skipped','expired') then return s.terminal_receipt; end if;
  if s.deadline_at>clock_timestamp() then return null; end if;
  update private.world_settlement_attempts set status='expired',failure_code='DEADLINE_EXPIRED',finished_at=clock_timestamp() where job_id in (select id from private.world_settlement_jobs where settlement_id=s.id) and status='processing';
  update private.world_settlement_jobs set status='skipped',failure_code='DEADLINE_NOOP',completed_at=clock_timestamp() where settlement_id=s.id and status not in ('completed','skipped');
  receipt:=jsonb_build_object('settlementId',s.id,'status','expired','publicSummary','The day settled without new world changes.');
  update private.world_settlements set status='expired',fence=null,lease_until=null,failure_code='DEADLINE_EXPIRED',skip_reason='deadline_noop',terminal_receipt=receipt,completed_at=clock_timestamp() where id=s.id;
  insert into private.world_settlement_outbox(settlement_id,event_key,payload) values(s.id,'deadline_noop',jsonb_build_object('summary','The day settled without new world changes.')) on conflict do nothing;
  update public.tavern_saves set world_phase='open' where id=s.save_id;
  return receipt;
end $$;
create function public.world_settlement_status(p_save_id uuid,p_settlement_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'dayNumber',s.day_number,'status',s.status,'deadlineAt',s.deadline_at,'failureCode',s.failure_code,'skipReason',s.skip_reason,'publicSummary',s.terminal_receipt->>'publicSummary',
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'ordinal',j.ordinal,'kind',j.job_kind,'status',j.status,'failureCode',j.failure_code) order by j.ordinal) from private.world_settlement_jobs j where j.settlement_id=s.id),'[]'::jsonb))
  from private.world_settlements s join public.tavern_saves t on t.id=s.save_id where s.save_id=p_save_id and t.user_id=auth.uid() and (p_settlement_id is null or s.id=p_settlement_id) order by s.created_at desc limit 1
$$;
create function public.world_settlement_claim(p_settlement_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; a private.world_settlement_attempts; v_attempt smallint;
begin
  perform private.world_settlement_assert_service(); select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  if s.status in ('completed','failed','skipped','expired') then return coalesce(s.terminal_receipt,jsonb_build_object('settlementId',s.id,'status',s.status)); end if;
  if s.deadline_at<=clock_timestamp() then return private.world_settlement_finalize_deadline(s.id); end if;
  if s.status='processing' and s.lease_until>clock_timestamp() then raise sqlstate 'PT409' using message='Settlement lease is still active'; end if;
  if s.status='processing' then
    update private.world_settlement_attempts set status='expired',failure_code='LEASE_EXPIRED',finished_at=clock_timestamp()
      where fence=s.fence and status='processing';
    update private.world_settlement_jobs set status='queued',failure_code='LEASE_EXPIRED'
      where settlement_id=s.id and status='processing';
    update private.world_settlements set status='queued',fence=null,lease_until=null where id=s.id returning * into s;
  end if;
  select * into j from private.world_settlement_jobs where settlement_id=s.id and status='queued' order by ordinal limit 1 for update;
  if not found then update private.world_settlements set status='completed',completed_at=clock_timestamp(),terminal_receipt=jsonb_build_object('settlementId',s.id,'status','completed') where id=s.id returning * into s; update public.tavern_saves set world_phase='open' where id=s.save_id; return s.terminal_receipt; end if;
  select coalesce(max(attempt_number),0)+1 into v_attempt from private.world_settlement_attempts where job_id=j.id;
  if v_attempt>3 then update private.world_settlement_jobs set status='failed',failure_code='ATTEMPTS_EXHAUSTED',completed_at=clock_timestamp() where id=j.id; update private.world_settlements set status='failed',failure_code='ATTEMPTS_EXHAUSTED',completed_at=clock_timestamp(),terminal_receipt=jsonb_build_object('settlementId',s.id,'status','failed','failureCode','ATTEMPTS_EXHAUSTED') where id=s.id returning * into s; update public.tavern_saves set world_phase='open' where id=s.save_id; return s.terminal_receipt; end if;
  update private.world_settlements set status='processing',fence=extensions.gen_random_uuid(),lease_until=least(deadline_at,clock_timestamp()+interval '120 seconds') where id=s.id returning * into s;
  update private.world_settlement_jobs set status='processing' where id=j.id;
  insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values(j.id,v_attempt,s.fence,s.lease_until) returning * into a;
  return jsonb_build_object('settlementId',s.id,'jobId',j.id,'kind',j.job_kind,'ordinal',j.ordinal,'attempt',a.attempt_number,'fence',a.fence,'leaseUntil',a.lease_until,'inputFingerprint',j.input_fingerprint);
end $$;
create function public.world_settlement_claim_next() returns jsonb language plpgsql security definer set search_path='' as $$
declare settlement_id uuid;
begin
  perform private.world_settlement_assert_service();
  select id into settlement_id from private.world_settlements
    where status not in ('completed','failed','skipped','expired')
      and (deadline_at<=clock_timestamp() or status='queued' or (status='processing' and lease_until<=clock_timestamp()))
    order by deadline_at,id for update skip locked limit 1;
  if settlement_id is null then return jsonb_build_object('status','idle'); end if;
  return public.world_settlement_claim(settlement_id);
end $$;
create function public.world_settlement_heartbeat(p_settlement_id uuid,p_fence uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements;
begin perform private.world_settlement_assert_service(); select * into s from private.world_settlements where id=p_settlement_id for update;
 if not found or s.fence<>p_fence or s.status<>'processing' or s.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
 update private.world_settlements set lease_until=least(deadline_at,clock_timestamp()+interval '120 seconds') where id=s.id returning * into s;
 update private.world_settlement_attempts set lease_until=s.lease_until where fence=p_fence and status='processing'; return jsonb_build_object('settlementId',s.id,'leaseUntil',s.lease_until); end $$;
create function public.world_settlement_complete(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_output jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; r jsonb;
begin perform private.world_settlement_assert_service(); select result into r from private.world_settlement_action_receipts where job_id=p_job_id and fence=p_fence and action_kind='complete'; if r is not null then return r; end if; select * into s from private.world_settlements where id=p_settlement_id for update;
 if not found then raise sqlstate 'PT404'; end if; if s.status in ('completed','failed','skipped','expired') then return s.terminal_receipt; end if;
 if s.fence<>p_fence or s.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
 select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id for update; if not found or j.status<>'processing' then raise sqlstate 'PT409' using message='Settlement job is not active'; end if;
 update private.world_settlement_jobs set status='completed',output=coalesce(p_output,'{}'::jsonb),completed_at=clock_timestamp() where id=j.id;
 update private.world_settlement_attempts set status='completed',finished_at=clock_timestamp() where job_id=j.id and fence=p_fence and status='processing';
 update private.world_settlements set status='queued',fence=null,lease_until=null where id=s.id;
 r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'status','completed'); insert into private.world_settlement_action_receipts(job_id,fence,action_kind,result) values(j.id,p_fence,'complete',r); return r; end $$;
create function public.world_settlement_fail(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_failure_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; tries smallint; r jsonb;
begin perform private.world_settlement_assert_service(); select result into r from private.world_settlement_action_receipts where job_id=p_job_id and fence=p_fence and action_kind='fail'; if r is not null then return r; end if; select * into s from private.world_settlements where id=p_settlement_id for update;
 if not found then raise sqlstate 'PT404'; end if; if s.status in ('completed','failed','skipped','expired') then return s.terminal_receipt; end if;
 if s.fence<>p_fence or s.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
 select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id for update; if not found or j.status<>'processing' then raise sqlstate 'PT409'; end if;
 update private.world_settlement_attempts set status='failed',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80),finished_at=clock_timestamp() where job_id=j.id and fence=p_fence and status='processing'; select count(*) into tries from private.world_settlement_attempts where job_id=j.id;
 if tries>=3 then update private.world_settlement_jobs set status='failed',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80),completed_at=clock_timestamp() where id=j.id; update private.world_settlements set status='failed',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80),completed_at=clock_timestamp(),terminal_receipt=jsonb_build_object('settlementId',s.id,'status','failed','failureCode',left(coalesce(p_failure_code,'WORKER_FAILED'),80)) where id=s.id returning * into s; update public.tavern_saves set world_phase='open' where id=s.save_id; r:=s.terminal_receipt; else update private.world_settlement_jobs set status='queued',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80) where id=j.id; update private.world_settlements set status='queued',fence=null,lease_until=null where id=s.id; r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'status','retrying','attempts',tries); end if; insert into private.world_settlement_action_receipts(job_id,fence,action_kind,result) values(j.id,p_fence,'fail',r); return r; end $$;

revoke all on function public.world_settlement_status(uuid,uuid),public.world_settlement_claim(uuid),public.world_settlement_claim_next(),public.world_settlement_heartbeat(uuid,uuid),public.world_settlement_complete(uuid,uuid,uuid,jsonb),public.world_settlement_fail(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.world_settlement_status(uuid,uuid) to authenticated;
grant execute on function public.world_settlement_claim(uuid),public.world_settlement_claim_next(),public.world_settlement_heartbeat(uuid,uuid),public.world_settlement_complete(uuid,uuid,uuid,jsonb),public.world_settlement_fail(uuid,uuid,uuid,text) to service_role;

commit;
