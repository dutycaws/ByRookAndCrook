-- Issue #33: the effective purge/quarantine path deletes resident projections.
begin;
create table if not exists private.world_npc_memory_tombstones (
  id uuid primary key default extensions.gen_random_uuid(), instance_id uuid not null,
  source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{64}$'),
  invalidated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists world_npc_memory_tombstones_instance_id_key
  on private.world_npc_memory_tombstones(instance_id);

-- `npc_purge_visible_history` is the sole definer-owned path that sets this
-- transaction-local flag.  Its cascades must be allowed through immutable
-- projection histories; every ordinary update/delete remains rejected.
create or replace function private.world_history_append_only()
returns trigger language plpgsql set search_path='' as $f$
begin
  if tg_op='DELETE' and current_setting('app.npc_purge',true)='on' then return old; end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode='55000',message='World history is append-only';
  end if;
  return new;
end $f$;

-- Quest events are immutable during ordinary play, but they are resident
-- projections and must follow the mature/quarantine deletion cascade.
create or replace function private.world_quest_events_append_only()
returns trigger language plpgsql set search_path='' as $f$
begin
  if tg_op='DELETE' and current_setting('app.npc_purge',true)='on' then return old; end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode='55000',message='World history is append-only';
  end if;
  return new;
end $f$;
drop trigger if exists world_quest_events_append_only on private.world_quest_events;
create trigger world_quest_events_append_only before update or delete
  on private.world_quest_events for each row execute function private.world_quest_events_append_only();
create or replace function private.world_npc_memory_invalidate_instance()
returns trigger language plpgsql security definer set search_path='' as $f$
declare fingerprint text;
begin
  select encode(extensions.digest(convert_to(coalesce(string_agg(source_hash,',' order by ledger_sequence),''),'utf8'),'sha256'),'hex')
    into fingerprint from private.world_npc_memory_sources where instance_id=old.id;
  insert into private.world_npc_memory_tombstones(instance_id,source_fingerprint) values(old.id,fingerprint)
  on conflict(instance_id) do nothing;
  insert into private.world_npc_memory_invalidations(job_id,save_id,instance_id,fence,source_kind,source_id,source_version,reason)
  select job.id,job.save_id,job.instance_id,job.fence,job.source_kind,job.source_id,job.source_version,'resident_removed'
  from private.world_npc_memory_outbox job where job.instance_id=old.id and job.status='processing'
  on conflict(job_id) do nothing;
  return old;
end $f$;
commit;
