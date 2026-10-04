-- Issue #31 consolidation: canonical quest transitions own resident quest state.
-- General procedural-world history remains readable, but can no longer create or
-- mutate legacy procedural quests or enqueue a competing quest worker.
begin;

alter function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb)
  rename to world_settlement_commit_procedural_world_before_quest_retirement;
alter function public.world_settlement_commit_procedural_world_before_quest_retirement(uuid,uuid,uuid,jsonb)
  set schema private;

create function public.world_settlement_commit_procedural_world(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  perform private.world_settlement_assert_service();
  if jsonb_typeof(p_proposal)='object' and jsonb_typeof(p_proposal->'commands')='array'
    and exists(select 1 from jsonb_array_elements(p_proposal->'commands') command where command->>'operation'='quest') then
    raise sqlstate 'PT400' using message='Legacy procedural quest commands are retired; use the canonical quest transition service';
  end if;
  return private.world_settlement_commit_procedural_world_before_quest_retirement(p_settlement_id,p_job_id,p_fence,p_proposal);
end $function$;

-- Do not make close-day fail while legacy wrapper layers are retired. Mark a
-- would-be quest job inert at insertion, and clean up any local queued lease.
create function private.world_retire_legacy_quest_job()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.job_kind='quest' then
    new.status:='skipped';
    new.failure_code:='QUEST_AUTHORITY_RETIRED';
    new.completed_at:=clock_timestamp();
  end if;
  return new;
end $function$;
drop trigger if exists world_retire_legacy_quest_job on private.world_settlement_jobs;
create trigger world_retire_legacy_quest_job before insert on private.world_settlement_jobs
for each row execute function private.world_retire_legacy_quest_job();

update private.world_settlement_attempts attempt
set status='failed',failure_code='QUEST_AUTHORITY_RETIRED',finished_at=clock_timestamp()
from private.world_settlement_jobs job
where job.id=attempt.job_id and job.job_kind='quest' and attempt.status='processing';
update private.world_settlement_jobs
set status='skipped',failure_code='QUEST_AUTHORITY_RETIRED',completed_at=clock_timestamp()
where job_kind='quest' and status in ('queued','processing');

-- Keep the five-field procedural snapshot stable for existing workers while
-- making its legacy quest slot permanently empty. Canonical `world_quests`
-- are available only to the dedicated quest resolver and transition worker.
create or replace function private.world_procedural_world_context(p_save_id uuid)
returns jsonb language sql stable security definer set search_path='' as $function$
  with entity_candidates as (
    select i.id::text as reference,'npc'::text as entity_kind
    from private.world_npc_instances i
    where i.save_id=p_save_id and i.status='active'
    union all
    select e.id::text,e.entity_kind
    from private.world_canonical_entities e
    where e.save_id=p_save_id and e.lifecycle in ('discovered','active')
  ), resident_capabilities as (
    select i.id::text as resident_id,private.world_procedural_resident_capability(i.save_id,i.id) as capability
    from private.world_npc_instances i
    where i.save_id=p_save_id and i.status='active'
  )
  select jsonb_build_object(
    'version','procedural-world-v1',
    'entityKinds',coalesce((select jsonb_object_agg(reference,entity_kind order by reference) from entity_candidates),'{}'::jsonb),
    'activeGeneratedEntityCount',(select count(*) from private.world_canonical_entities e where e.save_id=p_save_id and e.origin='procedural' and e.lifecycle='active'),
    'activeQuestByResident','{}'::jsonb,
    'capabilities',coalesce((select jsonb_object_agg(resident_id,capability order by resident_id) from resident_capabilities),'{}'::jsonb)
  )
$function$;

create function private.world_quest_public_news_digest(p_settlement_id uuid)
returns text language sql stable security definer set search_path='' as $function$
  select left(coalesce(string_agg('Quest: ' || coalesce(nullif(btrim(event.narration),''), event.outcome), ' ' order by event.created_at,event.id),''),500)
  from private.world_quest_events event
  join private.world_settlements settlement on settlement.id=p_settlement_id
  where event.save_id=settlement.save_id and event.day_number=settlement.day_number and event.public_news
$function$;

create function private.world_quest_transition_public_digest(p_save_id uuid,p_closing_day integer)
returns text language sql stable security definer set search_path='' as $function$
  with messages as (
    select
      case transition.result->>'kind'
        when 'next_authored_milestone' then coalesce(version.sheet#>>'{identity,name}','A resident') || ' will continue with "' || successor.title || '".'
        when 'successor' then coalesce(version.sheet#>>'{identity,name}','A resident') || ' will begin "' || successor.title || '".'
      end as message,
      transition.committed_at as happened_at,
      transition.id
    from private.world_quest_transitions transition
    join private.world_quests completed on completed.id=transition.quest_id
    join private.world_quests successor on successor.id=(transition.result->>'questId')::uuid
    join private.npc_versions version on version.id=successor.version_id
    where transition.save_id=p_save_id and transition.status='committed'
      and completed.terminal_day=p_closing_day
      and transition.result->>'kind' in ('next_authored_milestone','successor')
    union all
    select departure.public_news,departure.created_at,departure.transition_id
    from private.world_npc_departures departure
    join private.world_quest_events event on event.id=departure.terminal_event_id
    where departure.save_id=p_save_id and event.day_number=p_closing_day
    union all
    select coalesce(version.sheet#>>'{identity,name}','A resident') || ' departed Millhaven.',departure.departed_at,departure.transition_id
    from private.world_npc_departures departure
    join private.world_npc_instances resident on resident.id=departure.instance_id
    join private.npc_versions version on version.id=resident.version_id
    where departure.save_id=p_save_id and departure.state='departed' and departure.farewell_day=p_closing_day
  )
  select left(coalesce(string_agg(message,' ' order by happened_at,id),''),500)
  from messages where message is not null and btrim(message)<>''
$function$;

-- The existing safe morning-news receipt remains the public projection. Add
-- canonical terminal quest events to it without reopening the retired jobs.
create or replace function public.world_settlement_complete_news(p_settlement_id uuid,p_job_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare settlement private.world_settlements; job private.world_settlement_jobs; digest text; output jsonb; quest_news text;
begin
  perform private.world_settlement_assert_service();
  if not exists(select 1 from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id) then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
  select result into output from private.world_canon_news_receipts where job_id=p_job_id;
  if output is not null then return output; end if;
  select * into settlement from private.world_settlements where id=p_settlement_id for update;
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id for update;
  if not found or job.job_kind<>'news' or job.status<>'processing' or settlement.status<>'processing' or settlement.fence<>p_fence or settlement.lease_until<=clock_timestamp() or not exists(select 1 from private.world_settlement_attempts a where a.job_id=job.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409'; end if;
  select private.world_quest_public_news_digest(settlement.id) into quest_news;
  select left(coalesce(string_agg(part,' ' order by sort_key),'The day settled without new world changes.'),500) into digest from (
    select ('News: '||title||'. '||summary) part, 'c'||id::text sort_key from private.world_public_discoveries where settlement_id=settlement.id
    union all select ('Resident: '||coalesce(disposition->>'summary','changed')) part, 'r'||job_id::text from private.resident_evolution_entries where job_id in (select id from private.world_settlement_jobs where settlement_id=settlement.id)
    union all select quest_news part, 'q' where quest_news is not null and quest_news<>''
  ) safe;
  output:=jsonb_build_object('status','completed','rulesVersion','world-canon-event-v1','settlementId',settlement.id,'jobId',job.id,'morningNews',digest);
  insert into private.world_canon_news_receipts(job_id,digest,result) values(job.id,digest,output);
  update private.world_settlements set public_digest=digest where id=settlement.id;
  perform public.world_settlement_complete(settlement.id,job.id,p_fence,jsonb_build_object('kind','news','morningNews',digest));
  return output;
end $function$;

-- Transition work may finish after the normal settlement news job. Compute
-- its safe public addition when the owner reads status so a late model result
-- still appears in the same overnight digest without mutating append-only
-- news receipts.
create or replace function public.world_settlement_status(p_save_id uuid,p_settlement_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object(
    'id',settlement.id,'dayNumber',settlement.day_number,'status',settlement.status,
    'deadlineAt',settlement.deadline_at,'failureCode',settlement.failure_code,'skipReason',settlement.skip_reason,
    'publicDigest',safe.digest,'publicSummary',safe.digest,'morningNews',safe.digest,
    'progress',jsonb_build_object(
      'completed',(select count(*) from private.world_settlement_jobs job where job.settlement_id=settlement.id and job.status in ('completed','skipped')),
      'total',(select count(*) from private.world_settlement_jobs job where job.settlement_id=settlement.id)
    )
  )
  from private.world_settlements settlement
  join public.tavern_saves save_row on save_row.id=settlement.save_id
  left join lateral (
    select receipt.digest
    from private.world_canon_news_receipts receipt
    join private.world_settlement_jobs job on job.id=receipt.job_id
    where job.settlement_id=settlement.id
    order by receipt.created_at desc limit 1
  ) news on true
  cross join lateral (
    select left(concat_ws(' ',
      coalesce(nullif(news.digest,''),nullif(settlement.public_digest,''),'The day settled without new world changes.'),
      nullif(private.world_quest_transition_public_digest(settlement.save_id,settlement.day_number),'')
    ),500) digest
  ) safe
  where settlement.save_id=p_save_id and save_row.user_id=auth.uid()
    and (p_settlement_id is null or settlement.id=p_settlement_id)
  order by settlement.created_at desc limit 1
$function$;

revoke all on function private.world_retire_legacy_quest_job(),private.world_quest_public_news_digest(uuid),private.world_quest_transition_public_digest(uuid,integer),private.world_procedural_world_context(uuid),private.world_settlement_commit_procedural_world_before_quest_retirement(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb),public.world_settlement_complete_news(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb),public.world_settlement_complete_news(uuid,uuid,uuid) to service_role;
revoke all on function public.world_settlement_status(uuid,uuid) from public,anon;
grant execute on function public.world_settlement_status(uuid,uuid) to authenticated;
commit;
