-- The opening boundary owns quest-transition eligibility.  A transition is
-- attempted during the settling window for a specific opening, never during a
-- playable day or on a wall-clock retry timer.
begin;

alter table private.world_quest_transitions
  add column if not exists target_opening_day integer,
  add column if not exists next_eligible_day integer;

update private.world_quest_transitions transition
set target_opening_day=quest.terminal_day+1,
    next_eligible_day=quest.terminal_day+1
from private.world_quests quest
where quest.id=transition.quest_id
  and (transition.target_opening_day is null or transition.next_eligible_day is null);

alter table private.world_quest_transitions
  alter column target_opening_day set not null,
  alter column next_eligible_day set not null,
  add constraint world_quest_transitions_opening_days_check
    check (target_opening_day >= 0 and next_eligible_day >= target_opening_day);

create function private.world_quest_transition_set_opening_days()
returns trigger language plpgsql security definer set search_path='' as $function$
declare terminal_day integer;
begin
  if tg_op='INSERT' then
    select day_number into terminal_day from private.world_quest_events where id=new.terminal_event_id;
    if terminal_day is null then
      raise exception using errcode='23514', message='Quest transition requires a terminal opening day';
    end if;
    new.target_opening_day:=coalesce(new.target_opening_day,terminal_day+1);
    new.next_eligible_day:=coalesce(new.next_eligible_day,new.target_opening_day);
  end if;
  return new;
end $function$;

drop trigger if exists world_quest_transition_set_opening_days on private.world_quest_transitions;
create trigger world_quest_transition_set_opening_days
before insert on private.world_quest_transitions
for each row execute function private.world_quest_transition_set_opening_days();

-- A save is published only after its ordinary settlement is terminal and every
-- transition still due for this opening has either committed or been deferred.
create function private.world_quest_transition_maybe_open(p_save_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare save_row public.tavern_saves;
begin
  select * into save_row from public.tavern_saves where id=p_save_id for update;
  if not found or save_row.world_phase<>'settling' then return false; end if;
  if exists(
    select 1 from private.world_settlements settlement
    where settlement.save_id=p_save_id
      and settlement.status not in ('completed','failed','skipped','expired')
  ) then return false; end if;
  if exists(
    select 1 from private.world_quest_transitions transition
    where transition.save_id=p_save_id
      and transition.next_eligible_day<=save_row.current_day
      and transition.status in ('awaiting','processing')
  ) then return false; end if;
  update public.tavern_saves set world_phase='open' where id=save_row.id;
  return true;
end $function$;

create or replace function public.world_quest_transition_claim(p_terminal_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions; save_row public.tavern_saves; v_fence uuid:=extensions.gen_random_uuid(); v_checkpoints jsonb; v_reuse_checkpoints boolean;
begin
  perform private.world_settlement_assert_service();
  select * into t from private.world_quest_transitions where terminal_event_id=p_terminal_event_id for update;
  if not found then raise sqlstate 'PT404' using message='Terminal quest transition was not found'; end if;
  if t.status='committed' then return coalesce(t.receipt,'{}'::jsonb); end if;
  select * into save_row from public.tavern_saves where id=t.save_id for update;
  if not found or save_row.world_phase<>'settling' then raise sqlstate 'PT409' using message='Quest transition is not in a settling opening'; end if;
  if t.status='awaiting' and t.next_eligible_day>save_row.current_day then
    raise sqlstate 'PT409' using message='Quest transition is not eligible for this opening';
  end if;
  if t.status='processing' and t.lease_until>clock_timestamp() then raise sqlstate 'PT409' using message='Quest transition is already leased'; end if;
  if t.status not in ('awaiting','processing') then raise sqlstate 'PT409' using message='Quest transition is not claimable'; end if;
  v_reuse_checkpoints := coalesce(t.failure_code,'') <> 'validation_rejected';
  update private.world_quest_transitions
  set status='processing',processing_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes',fence=v_fence,
      attempt_count=attempt_count+1,failure_code=null,failed_at=null
  where id=t.id returning * into t;
  insert into private.world_quest_transition_attempts(transition_id,attempt_number,fence,lease_until)
  values(t.id,t.attempt_count,v_fence,t.lease_until);
  if v_reuse_checkpoints then
    select coalesce(jsonb_agg(jsonb_build_object('stage',latest.stage,'payload',latest.payload) order by latest.stage),'[]'::jsonb)
    into v_checkpoints from (
      select distinct on (checkpoint.stage) checkpoint.stage,checkpoint.payload,checkpoint.created_at
      from private.world_quest_transition_checkpoints checkpoint where checkpoint.transition_id=t.id
      order by checkpoint.stage,checkpoint.created_at desc,checkpoint.id desc
    ) latest;
  else v_checkpoints:='[]'::jsonb;
  end if;
  return jsonb_build_object(
    'transitionId',t.id,'terminalEventId',t.terminal_event_id,'instanceId',t.instance_id,
    'fence',v_fence,'attempt',t.attempt_count,'leaseUntil',t.lease_until,
    'contextFingerprint',t.context_fingerprint,'frozenContext',t.frozen_context,'checkpoints',v_checkpoints
  );
end $function$;

create or replace function public.world_quest_transition_claim_next()
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_terminal_event_id uuid;
begin
  perform private.world_settlement_assert_service();
  select transition.terminal_event_id into v_terminal_event_id
  from private.world_quest_transitions transition
  join public.tavern_saves save_row on save_row.id=transition.save_id
  where save_row.world_phase='settling'
    and transition.next_eligible_day<=save_row.current_day
    and (transition.status='awaiting' or (transition.status='processing' and transition.lease_until<=clock_timestamp()))
  order by transition.target_opening_day,transition.created_at,transition.id
  for update of transition skip locked limit 1;
  if not found then return jsonb_build_object('status','idle'); end if;
  return public.world_quest_transition_claim(v_terminal_event_id);
end $function$;

create or replace function public.world_quest_transition_fail(p_transition_id uuid,p_fence uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions; save_row public.tavern_saves; v_next_day integer; result jsonb;
begin
  perform private.world_settlement_assert_service(); t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  if length(btrim(coalesce(p_failure_code,''))) not between 1 and 160 then raise sqlstate 'PT400' using message='Quest transition failure code is invalid'; end if;
  select * into save_row from public.tavern_saves where id=t.save_id for update;
  if not found then raise sqlstate 'PT409' using message='Quest save no longer exists'; end if;
  v_next_day:=greatest(t.next_eligible_day+1,save_row.current_day+1);
  result:=jsonb_build_object('transitionId',t.id,'status','awaiting','nextEligibleDay',v_next_day);
  insert into private.world_quest_transition_receipts(transition_id,terminal_event_id,kind,fence,failure_code,result)
  values(t.id,t.terminal_event_id,'failed',p_fence,btrim(p_failure_code),result);
  update private.world_quest_transitions
  set status='awaiting',processing_started_at=null,lease_until=null,fence=null,failed_at=clock_timestamp(),
      failure_code=btrim(p_failure_code),next_eligible_day=v_next_day
  where id=t.id;
  perform private.world_quest_transition_maybe_open(t.save_id);
  return result;
end $function$;

-- A commit made while settling belongs to the opening being prepared.  A
-- commit observed after publication cannot retroactively change that day.
alter table private.world_npc_departures
  drop constraint if exists world_npc_departures_state_check,
  add constraint world_npc_departures_state_check check(state in ('scheduled','farewell','departed'));

create or replace function public.world_quest_transition_commit(p_transition_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_quest_transitions; q private.world_quests; m jsonb; kind text; save_row public.tavern_saves; opening_day integer; new_quest uuid; v_receipt jsonb; existing jsonb; departure_state text;
begin
  perform private.world_settlement_assert_service();
  select transition_row.receipt into existing from private.world_quest_transitions transition_row
  where transition_row.id=p_transition_id and transition_row.status='committed';
  if found then return existing; end if;
  t:=private.world_quest_transition_assert_fence(p_transition_id,p_fence);
  select * into save_row from public.tavern_saves where id=t.save_id for update;
  if not found then raise sqlstate 'PT409' using message='Quest save no longer exists'; end if;
  kind:=private.world_quest_transition_validate_proposal(t,p_proposal);
  if kind is null then raise sqlstate 'PT400' using message='Quest transition proposal violates its frozen contract'; end if;
  select * into q from private.world_quests where id=t.quest_id for update;
  if not found or q.terminal_event_id<>t.terminal_event_id or q.state not in ('succeeded','failed','abandoned') then
    raise sqlstate 'PT409' using message='Quest terminal state changed';
  end if;
  if exists(select 1 from private.world_quests live where live.save_id=t.save_id and live.instance_id=t.instance_id and live.state in ('scheduled','active')) then
    raise sqlstate 'PT409' using message='Resident already has a live quest';
  end if;
  opening_day:=case when save_row.world_phase='settling' then save_row.current_day else save_row.current_day+1 end;
  m:=t.frozen_context->'nextAuthoredMilestone';
  if kind='next_authored_milestone' then
    insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,authored_milestone_index,authored_milestone_key,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
    values(t.save_id,t.instance_id,q.package_id,q.package_hash,q.version_id,'authored_milestone',q.authored_milestone_index+1,m->>'id',coalesce(m->>'title',m->>'id'),coalesce(m->>'outcome',m->>'id'),coalesce(m->>'motivation','Pursue the next meaningful step.'),coalesce(array(select jsonb_array_elements_text(m->'constraints')),'{}'),coalesce(array(select jsonb_array_elements_text(m->'allowedTargets')),'{}'),coalesce((m->>'difficulty')::integer,0),p_proposal->'plan',p_proposal->'plan',case when save_row.world_phase='settling' then 'active' else 'scheduled' end,0,0,opening_day,case when save_row.world_phase='settling' then opening_day else null end)
    returning id into new_quest;
  elsif kind='successor' then
    insert into private.world_quests(save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day)
    values(t.save_id,t.instance_id,q.package_id,q.package_hash,q.version_id,'generated_successor',q.id,btrim(p_proposal->>'title'),btrim(p_proposal->>'objective'),btrim(p_proposal->>'motivation'),array(select btrim(value) from jsonb_array_elements_text(p_proposal->'constraints') value),array(select value from jsonb_array_elements_text(p_proposal->'targetRefs') value),(p_proposal->>'difficulty')::integer,p_proposal->'plan',p_proposal->'plan',case when save_row.world_phase='settling' then 'active' else 'scheduled' end,0,0,opening_day,case when save_row.world_phase='settling' then opening_day else null end)
    returning id into new_quest;
  else
    departure_state:=case when save_row.world_phase='settling' then 'farewell' else 'scheduled' end;
    insert into private.world_npc_departures(instance_id,save_id,transition_id,terminal_event_id,farewell_day,state,private_rationale,farewell_text,public_news)
    values(t.instance_id,t.save_id,t.id,t.terminal_event_id,opening_day,departure_state,btrim(p_proposal->>'privateRationale'),btrim(p_proposal->>'farewellText'),btrim(p_proposal->>'publicNews'));
  end if;
  v_receipt:=jsonb_build_object(
    'status','completed','rulesVersion','quest-transition-v1','transitionId',t.id,'terminalEventId',t.terminal_event_id,
    'kind',kind,'questId',new_quest,'scheduledForDay',case when kind<>'departure' then opening_day else null end,
    'activatedDay',case when new_quest is not null and save_row.world_phase='settling' then opening_day else null end,
    'farewellDay',case when kind='departure' then opening_day else null end
  );
  insert into private.world_quest_transition_receipts(transition_id,terminal_event_id,kind,fence,decision,result)
  values(t.id,t.terminal_event_id,'committed',p_fence,p_proposal,v_receipt);
  update private.world_quest_transitions
  set status='committed',decision=p_proposal,result=v_receipt,receipt=v_receipt,committed_at=clock_timestamp(),
      processing_started_at=null,lease_until=null,fence=null,farewell_day=case when kind='departure' then opening_day else null end
  where id=t.id;
  perform private.world_quest_transition_maybe_open(t.save_id);
  return v_receipt;
end $function$;

-- This trigger runs on the D -> D+1 boundary while the save is still
-- settling.  Farewell is available for all of D, then closes exactly once at
-- the next boundary; late departures enter scheduled state until their day.
create or replace function private.world_quest_departure_close_after_day()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.current_day<=old.current_day then return new; end if;
  update private.world_quests quest set state='active',activated_day=new.current_day
  where quest.save_id=new.id and quest.state='scheduled' and quest.scheduled_for_day<=new.current_day;
  update private.world_npc_departures departure
  set state='departed',departed_at=clock_timestamp()
  where departure.save_id=new.id and departure.state='farewell' and departure.farewell_day=old.current_day;
  update private.world_npc_instances resident set status='departed',settled_day=old.current_day
  from private.world_npc_departures departure
  where departure.save_id=new.id and departure.instance_id=resident.id and departure.state='departed'
    and resident.status<>'departed';
  insert into private.world_npc_tombstones(save_id,npc_id,version_id,reason)
  select resident.save_id,resident.npc_id,resident.version_id,'departed'
  from private.world_npc_instances resident
  join private.world_npc_departures departure on departure.instance_id=resident.id
  where departure.save_id=new.id and departure.state='departed'
  on conflict do nothing;
  update private.world_npc_departures departure set state='farewell'
  where departure.save_id=new.id and departure.state='scheduled' and departure.farewell_day<=new.current_day;
  return new;
end $function$;

-- Normal settlement terminal paths delegate publication to the same gate.  The
-- public claim wrapper from migration 042 continues to enrich this core claim.
create or replace function private.world_settlement_finalize_deadline(p_settlement_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare s private.world_settlements; receipt jsonb;
begin
  select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  if s.status in ('completed','failed','skipped','expired') then return s.terminal_receipt; end if;
  if s.deadline_at>clock_timestamp() then return null; end if;
  update private.world_settlement_attempts set status='expired',failure_code='DEADLINE_EXPIRED',finished_at=clock_timestamp()
  where job_id in (select id from private.world_settlement_jobs where settlement_id=s.id) and status='processing';
  update private.world_settlement_jobs set status='skipped',failure_code='DEADLINE_NOOP',completed_at=clock_timestamp()
  where settlement_id=s.id and status not in ('completed','skipped');
  receipt:=jsonb_build_object('settlementId',s.id,'status','expired','publicSummary','The day settled without new world changes.');
  update private.world_settlements
  set status='expired',fence=null,lease_until=null,failure_code='DEADLINE_EXPIRED',skip_reason='deadline_noop',terminal_receipt=receipt,completed_at=clock_timestamp()
  where id=s.id;
  insert into private.world_settlement_outbox(settlement_id,event_key,payload)
  values(s.id,'deadline_noop',jsonb_build_object('summary','The day settled without new world changes.')) on conflict do nothing;
  perform private.world_quest_transition_maybe_open(s.save_id);
  return receipt;
end $function$;

create or replace function private.world_settlement_claim_v1(p_settlement_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare s private.world_settlements; j private.world_settlement_jobs; a private.world_settlement_attempts; v_attempt smallint;
begin
  perform private.world_settlement_assert_service();
  select * into s from private.world_settlements where id=p_settlement_id for update;
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
  if not found then
    update private.world_settlements set status='completed',completed_at=clock_timestamp(),terminal_receipt=jsonb_build_object('settlementId',s.id,'status','completed')
    where id=s.id returning * into s;
    perform private.world_quest_transition_maybe_open(s.save_id);
    return s.terminal_receipt;
  end if;
  select coalesce(max(attempt_number),0)+1 into v_attempt from private.world_settlement_attempts where job_id=j.id;
  if v_attempt>3 then
    update private.world_settlement_jobs set status='failed',failure_code='ATTEMPTS_EXHAUSTED',completed_at=clock_timestamp() where id=j.id;
    update private.world_settlements set status='failed',failure_code='ATTEMPTS_EXHAUSTED',completed_at=clock_timestamp(),terminal_receipt=jsonb_build_object('settlementId',s.id,'status','failed','failureCode','ATTEMPTS_EXHAUSTED')
    where id=s.id returning * into s;
    perform private.world_quest_transition_maybe_open(s.save_id);
    return s.terminal_receipt;
  end if;
  update private.world_settlements set status='processing',fence=extensions.gen_random_uuid(),lease_until=least(deadline_at,clock_timestamp()+interval '120 seconds')
  where id=s.id returning * into s;
  update private.world_settlement_jobs set status='processing' where id=j.id;
  insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until)
  values(j.id,v_attempt,s.fence,s.lease_until) returning * into a;
  return jsonb_build_object('settlementId',s.id,'jobId',j.id,'kind',j.job_kind,'ordinal',j.ordinal,'attempt',a.attempt_number,'fence',a.fence,'leaseUntil',a.lease_until,'inputFingerprint',j.input_fingerprint);
end $function$;

create or replace function public.world_settlement_fail(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare s private.world_settlements; j private.world_settlement_jobs; tries smallint; r jsonb;
begin
  perform private.world_settlement_assert_service();
  select result into r from private.world_settlement_action_receipts where job_id=p_job_id and fence=p_fence and action_kind='fail';
  if r is not null then return r; end if;
  select * into s from private.world_settlements where id=p_settlement_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  if s.status in ('completed','failed','skipped','expired') then return s.terminal_receipt; end if;
  if s.fence<>p_fence or s.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=s.id for update;
  if not found or j.status<>'processing' then raise sqlstate 'PT409'; end if;
  update private.world_settlement_attempts set status='failed',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80),finished_at=clock_timestamp()
  where job_id=j.id and fence=p_fence and status='processing';
  select count(*) into tries from private.world_settlement_attempts where job_id=j.id;
  if tries>=3 then
    update private.world_settlement_jobs set status='failed',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80),completed_at=clock_timestamp() where id=j.id;
    update private.world_settlements set status='failed',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80),completed_at=clock_timestamp(),terminal_receipt=jsonb_build_object('settlementId',s.id,'status','failed','failureCode',left(coalesce(p_failure_code,'WORKER_FAILED'),80))
    where id=s.id returning * into s;
    perform private.world_quest_transition_maybe_open(s.save_id);
    r:=s.terminal_receipt;
  else
    update private.world_settlement_jobs set status='queued',failure_code=left(coalesce(p_failure_code,'WORKER_FAILED'),80) where id=j.id;
    update private.world_settlements set status='queued',fence=null,lease_until=null where id=s.id;
    r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'status','retrying','attempts',tries);
  end if;
  insert into private.world_settlement_action_receipts(job_id,fence,action_kind,result) values(j.id,p_fence,'fail',r);
  return r;
end $function$;

create or replace function public.world_settlement_safe_result(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_kind text,p_public_digest text)
returns jsonb language plpgsql security definer set search_path='' as $function$
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
  if not found or not exists(select 1 from private.world_settlement_attempts attempt where attempt.job_id=j.id and attempt.fence=p_fence and attempt.status='processing' and attempt.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Settlement attempt is not active'; end if;
  select news.digest into effective_digest from private.world_canon_news_receipts news join private.world_settlement_jobs news_job on news_job.id=news.job_id where news_job.settlement_id=s.id order by news.created_at desc limit 1;
  effective_digest:=coalesce(effective_digest,trim(p_public_digest));
  r:=jsonb_build_object('settlementId',s.id,'jobId',j.id,'kind',p_kind,'status','completed','publicDigest',effective_digest);
  insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload,usage,model,prompt_version)
  values(j.id,p_fence,'validated',jsonb_build_object('kind',p_kind,'publicDigest',effective_digest),'{}','safe-result','worker-contract-v1') on conflict do nothing;
  insert into private.world_settlement_worker_receipts(job_id,fence,action_kind,action_key,result) values(j.id,p_fence,'safe_result',p_kind,r);
  update private.world_settlements set public_digest=effective_digest where id=s.id;
  insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,j.id,'safe:'||j.id::text,jsonb_build_object('kind',p_kind,'digest',effective_digest)) on conflict do nothing;
  perform public.world_settlement_complete(s.id,j.id,p_fence,jsonb_build_object('kind',p_kind));
  if not exists(select 1 from private.world_settlement_jobs pending where pending.settlement_id=s.id and pending.status in ('queued','processing')) then
    terminal:=jsonb_build_object('settlementId',s.id,'status','completed','publicDigest',effective_digest,'publicSummary',effective_digest);
    update private.world_settlements set status='completed',fence=null,lease_until=null,completed_at=clock_timestamp(),terminal_receipt=terminal,public_digest=effective_digest where id=s.id;
    insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(s.id,null,'settlement-completed',terminal) on conflict do nothing;
    perform private.world_quest_transition_maybe_open(s.save_id);
  end if;
  return r;
end $function$;

revoke all on function private.world_quest_transition_set_opening_days(),private.world_quest_transition_maybe_open(uuid),private.world_settlement_finalize_deadline(uuid),private.world_settlement_claim_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.world_quest_transition_claim(uuid),public.world_quest_transition_claim_next(),public.world_quest_transition_fail(uuid,uuid,text),public.world_quest_transition_commit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.world_quest_transition_claim(uuid),public.world_quest_transition_claim_next(),public.world_quest_transition_fail(uuid,uuid,text),public.world_quest_transition_commit(uuid,uuid,jsonb) to service_role;

commit;
