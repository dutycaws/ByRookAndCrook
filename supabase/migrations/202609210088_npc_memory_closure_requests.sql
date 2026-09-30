-- Issue #33: durable, provider-free closure scheduling.  Producers/backfill
-- deliberately arrive in 089; this migration exposes only private seams.
begin;
create table private.world_npc_memory_closure_requests (
 id uuid primary key default extensions.gen_random_uuid(), save_id uuid not null references public.tavern_saves(id) on delete cascade, instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
 summary_kind text not null check(summary_kind in ('episode_summary','quest_summary')), closure_key text not null, closed_day integer, quest_id uuid, terminal_event_id uuid,
 cutoff_ledger_sequence bigint not null check(cutoff_ledger_sequence>=0), status text not null default 'pending' check(status in ('pending','blocked_gap','registered','invalidated')),
 reason text not null default 'pending' check(char_length(reason)<=120), attempts integer not null default 0 check(attempts>=0), requested_at timestamptz not null default clock_timestamp(), attempted_at timestamptz, registered_at timestamptz, invalidated_at timestamptz, resulting_set_ids uuid[] not null default '{}',
 unique(instance_id,summary_kind,closure_key), check((summary_kind='episode_summary')=(closed_day is not null)), check((summary_kind='quest_summary')=(quest_id is not null and terminal_event_id is not null))
);
create index world_npc_memory_closure_request_pending on private.world_npc_memory_closure_requests(instance_id,status,cutoff_ledger_sequence);
create function private.world_npc_memory_closure_guard() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if tg_op='DELETE' then if pg_trigger_depth()=1 then raise sqlstate 'PT409' using message='Closure requests are append-only'; end if; return old; end if;
 if old.save_id is distinct from new.save_id or old.instance_id is distinct from new.instance_id or old.summary_kind is distinct from new.summary_kind or old.closure_key is distinct from new.closure_key or old.closed_day is distinct from new.closed_day or old.quest_id is distinct from new.quest_id or old.terminal_event_id is distinct from new.terminal_event_id or old.cutoff_ledger_sequence is distinct from new.cutoff_ledger_sequence or old.requested_at is distinct from new.requested_at then raise sqlstate 'PT409' using message='Closure request identity is immutable'; end if;
 if old.status<>new.status and not ((old.status in ('pending','blocked_gap') and new.status in ('pending','blocked_gap','registered','invalidated')) or (old.status='registered' and new.status='invalidated')) then raise sqlstate 'PT409' using message='Closure request status is invalid'; end if; return new;
end $f$;
create trigger world_npc_memory_closure_guard before update or delete on private.world_npc_memory_closure_requests for each row execute function private.world_npc_memory_closure_guard();

create function private.world_npc_memory_request_episode(p_instance_id uuid,p_closed_day integer,p_cutoff bigint) returns private.world_npc_memory_closure_requests language plpgsql security definer set search_path='' as $f$
declare s uuid; r private.world_npc_memory_closure_requests; meaningful boolean; current_day integer; derived_cutoff bigint;
begin
 select i.save_id,t.current_day into s,current_day from private.world_npc_instances i join public.tavern_saves t on t.id=i.save_id where i.id=p_instance_id; if not found then raise sqlstate 'PT404' using message='Resident memory was not found'; end if;
 if current_day<=p_closed_day then raise sqlstate 'PT409' using message='Episode day is not closed'; end if;
 select max(ledger_sequence) into derived_cutoff from private.world_npc_memory_sources where instance_id=p_instance_id and occurred_day<=p_closed_day; if derived_cutoff is null or p_cutoff<>derived_cutoff then raise sqlstate 'PT409' using message='Episode cutoff is not authoritative'; end if;
 select exists(select 1 from private.world_npc_memories m where m.instance_id=p_instance_id and m.occurred_day=p_closed_day and (m.importance>=2 or m.kind='promise' or m.related_quest_id is not null or m.source_kind in ('hospitality','resident_evolution'))) into meaningful;
 insert into private.world_npc_memory_closure_requests(save_id,instance_id,summary_kind,closure_key,closed_day,cutoff_ledger_sequence,status,reason) values(s,p_instance_id,'episode_summary','episode:'||p_closed_day,p_closed_day,p_cutoff,case when meaningful then 'pending' else 'registered' end,case when meaningful then 'pending' else 'no_summary' end) on conflict(instance_id,summary_kind,closure_key) do nothing returning * into r;
 if not found then select * into r from private.world_npc_memory_closure_requests where instance_id=p_instance_id and summary_kind='episode_summary' and closure_key='episode:'||p_closed_day for update; if r.save_id<>s or r.closed_day<>p_closed_day or r.cutoff_ledger_sequence<>p_cutoff then raise sqlstate 'PT409' using message='Episode closure identity changed'; end if; end if; return r;
end $f$;
create function private.world_npc_memory_request_quest(p_terminal_event_id uuid) returns private.world_npc_memory_closure_requests language plpgsql security definer set search_path='' as $f$
declare e private.world_quest_events; cutoff bigint; r private.world_npc_memory_closure_requests;
begin select * into e from private.world_quest_events where id=p_terminal_event_id; if not found or e.outcome not in ('succeeded','failed','abandoned') then raise sqlstate 'PT409' using message='Quest is not terminal'; end if; select ledger_sequence into cutoff from private.world_npc_memory_sources where source_kind='quest_event' and source_id=e.id and source_version=1; if cutoff is null then raise sqlstate 'PT409' using message='Quest terminal source is unavailable'; end if;
 insert into private.world_npc_memory_closure_requests(save_id,instance_id,summary_kind,closure_key,quest_id,terminal_event_id,cutoff_ledger_sequence) values(e.save_id,e.instance_id,'quest_summary','quest:'||e.quest_id||':'||e.id,e.quest_id,e.id,cutoff) on conflict(instance_id,summary_kind,closure_key) do nothing returning * into r; if not found then select * into r from private.world_npc_memory_closure_requests where instance_id=e.instance_id and summary_kind='quest_summary' and closure_key='quest:'||e.quest_id||':'||e.id; end if; return r;
end $f$;
create function private.world_npc_memory_schedule_closures(p_instance_id uuid default null) returns integer language plpgsql security definer set search_path='' as $f$
declare r private.world_npc_memory_closure_requests; d text; leaves jsonb; batches jsonb; set_row private.world_npc_memory_summary_sets; made integer:=0; maxseq bigint;
begin
 for r in select * from private.world_npc_memory_closure_requests where status in ('pending','blocked_gap') and (p_instance_id is null or instance_id=p_instance_id) order by requested_at for update loop
   select contiguous_sequence into maxseq from private.world_npc_memory_watermarks where instance_id=r.instance_id and processor_kind='extract' and processor_version='npc-memory-v1';
   if coalesce(maxseq,-1)<r.cutoff_ledger_sequence then update private.world_npc_memory_closure_requests set status='blocked_gap',reason='extract_gap',attempts=attempts+1,attempted_at=clock_timestamp() where id=r.id; continue; end if;
   for d in select unnest(array['player_visible','npc_known','npc_private']) loop
     with chosen as (select x.source_kind,x.source_id,x.source_version,row_number() over(order by x.ledger_sequence,x.source_kind,x.source_id)-1 ordinal from private.world_npc_memory_sources x where x.instance_id=r.instance_id and x.disclosure_class=d and x.ledger_sequence<=r.cutoff_ledger_sequence and ((r.summary_kind='episode_summary' and x.occurred_day=r.closed_day and exists(select 1 from private.world_npc_memories m where m.instance_id=r.instance_id and m.source_kind=x.source_kind and m.source_id=x.source_id and m.source_version=x.source_version and (m.importance>=2 or m.kind='promise' or m.related_quest_id is not null or m.source_kind in ('hospitality','resident_evolution')))) or (r.summary_kind='quest_summary' and ((x.source_kind='quest_event' and x.envelope->>'questId'=r.quest_id::text) or (x.source_kind<>'quest_event' and exists(select 1 from private.world_npc_memories m where m.instance_id=r.instance_id and m.related_quest_id=r.quest_id and m.source_kind=x.source_kind and m.source_id=x.source_id and m.source_version=x.source_version)))))) select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'sourceKind',source_kind,'sourceId',source_id,'sourceVersion',source_version) order by ordinal),'[]'::jsonb) into leaves from chosen;
     if jsonb_array_length(leaves)=0 then continue; end if;
     select jsonb_agg(jsonb_build_object('batchOrdinal',g,'firstLeafOrdinal',g*64,'lastLeafOrdinal',least(g*64+63,jsonb_array_length(leaves)-1),'leafCount',least(64,jsonb_array_length(leaves)-g*64)) order by g) into batches from generate_series(0,(jsonb_array_length(leaves)-1)/64) g;
     set_row:=private.world_npc_memory_register_summary_set(r.summary_kind,r.closure_key||':'||d,r.cutoff_ledger_sequence,d,leaves,batches); update private.world_npc_memory_closure_requests set resulting_set_ids=array_append(resulting_set_ids,set_row.id) where id=r.id and not (set_row.id=any(resulting_set_ids));
   end loop;
   update private.world_npc_memory_closure_requests set status='registered',reason='registered',registered_at=clock_timestamp(),attempted_at=clock_timestamp(),attempts=attempts+1 where id=r.id; made:=made+1;
 end loop; return made;
end $f$;
-- Keep 087's fence/source/artifact implementation byte-for-byte as the
-- delegate.  Scheduling happens only after that delegate returns normally.
alter function private.world_npc_memory_complete(uuid,uuid,jsonb,text) rename to world_npc_memory_complete_087;
create function private.world_npc_memory_complete(p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null) returns void language plpgsql security definer set search_path='' as $f$
declare v_instance uuid;
begin
 select instance_id into v_instance from private.world_npc_memory_outbox where id=p_job_id;
 perform private.world_npc_memory_complete_087(p_job_id,p_fence,p_artifacts,p_error_code);
 if v_instance is not null then perform private.world_npc_memory_schedule_closures(v_instance); end if;
end $f$;
create or replace function public.world_npc_memory_complete(p_job_id uuid,p_fence uuid,p_artifacts jsonb default '[]'::jsonb,p_error_code text default null) returns void language plpgsql security definer set search_path='' as $f$
begin perform private.world_settlement_assert_service(); perform private.world_npc_memory_complete(p_job_id,p_fence,p_artifacts,p_error_code); end $f$;
revoke all on table private.world_npc_memory_closure_requests from public,anon,authenticated,service_role;
revoke all on function private.world_npc_memory_closure_guard(),private.world_npc_memory_request_episode(uuid,integer,bigint),private.world_npc_memory_request_quest(uuid),private.world_npc_memory_schedule_closures(uuid),private.world_npc_memory_complete_087(uuid,uuid,jsonb,text),private.world_npc_memory_complete(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.world_npc_memory_complete(uuid,uuid,jsonb,text) to service_role;
commit;
