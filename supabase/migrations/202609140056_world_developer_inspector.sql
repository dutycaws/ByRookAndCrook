-- Issue #17: a deliberately local-only developer inspector contract.
-- The database functions are service-role-only; the Svelte route adds the
-- second, environment-level development guard before it ever creates a service client.
begin;

create table private.world_developer_overrides (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  target_kind text not null check(target_kind in ('settlement_job','runtime_art_job','runtime_art_appearance')),
  target_id uuid not null,
  operation text not null check(operation in ('requeue_settlement_job','requeue_runtime_art_job','set_runtime_art_appearance')),
  before_hash text not null check(before_hash ~ '^[0-9a-f]{64}$'),
  after_hash text not null check(after_hash ~ '^[0-9a-f]{64}$'),
  summary text not null check(char_length(summary) between 1 and 240),
  reason text not null check(char_length(reason) between 3 and 240),
  created_at timestamptz not null default clock_timestamp(),
  check((target_kind='settlement_job' and operation='requeue_settlement_job')
    or (target_kind='runtime_art_job' and operation='requeue_runtime_art_job')
    or (target_kind='runtime_art_appearance' and operation='set_runtime_art_appearance'))
);
create index world_developer_overrides_save_created on private.world_developer_overrides(save_id,created_at desc);
create trigger world_developer_overrides_append_only before update or delete
  on private.world_developer_overrides for each row execute function private.world_history_append_only();

create function private.world_developer_inspector_assert_service() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise sqlstate 'PT403' using message='Developer inspector requires the local service role';
  end if;
end $$;

create function private.world_developer_inspector_assert_actor(p_save_id uuid,p_actor_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.tavern_saves s where s.id=p_save_id and s.user_id=p_actor_id) then
    raise sqlstate 'PT403' using message='Developer override actor does not own this tavern';
  end if;
end $$;

-- This is an operational metadata projection. It intentionally does not select
-- canonical payload, settlement input/output/checkpoint payload, beliefs, prompts,
-- runtime keys, or storage-facing render data.
create function public.world_developer_inspector(p_save_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.world_developer_inspector_assert_service();
  if not exists(select 1 from public.tavern_saves where id=p_save_id) then raise sqlstate 'PT404'; end if;
  select jsonb_build_object(
    'version','world-developer-inspector-v1',
    'entities',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'kind',e.entity_kind,'key',e.entity_key,'origin',e.origin,'sourceVersion',e.source_version,
      'lifecycle',e.lifecycle,'discoveredDay',e.discovered_day,'retiredDay',e.retired_day,'createdAt',e.created_at,
      'relevance',case when e.origin='procedural' then private.world_generated_entity_relevance(e.id) else 0 end,
      'history',coalesce((select jsonb_agg(jsonb_build_object('eventKind',h.event_kind,'sourceVersion',h.source_version,'createdAt',h.created_at) order by h.id)
        from private.world_canonical_entity_history h where h.entity_id=e.id),'[]'::jsonb)
    ) order by e.created_at desc,e.id) from (select * from private.world_canonical_entities where save_id=p_save_id order by created_at desc,id limit 150) e),'[]'::jsonb),
    'settlements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'dayNumber',s.day_number,'status',s.status,'deadlineAt',s.deadline_at,'failureCode',s.failure_code,'createdAt',s.created_at,'completedAt',s.completed_at,
      'jobs',coalesce((select jsonb_agg(jsonb_build_object(
        'id',j.id,'ordinal',j.ordinal,'kind',j.job_kind,'status',j.status,'failureCode',j.failure_code,'createdAt',j.created_at,'completedAt',j.completed_at,
        'attempts',coalesce((select jsonb_agg(jsonb_build_object('attempt',a.attempt_number,'status',a.status,'leaseUntil',a.lease_until,'failureCode',a.failure_code,'startedAt',a.started_at,'finishedAt',a.finished_at) order by a.attempt_number) from private.world_settlement_attempts a where a.job_id=j.id),'[]'::jsonb),
        'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('stage',c.stage,'model',c.model,'promptVersion',c.prompt_version,'createdAt',c.created_at) order by c.created_at,c.id) from private.world_settlement_stage_checkpoints c where c.job_id=j.id),'[]'::jsonb)
      ) order by j.ordinal) from private.world_settlement_jobs j where j.settlement_id=s.id),'[]'::jsonb)
    ) order by s.created_at desc,s.id) from (select * from private.world_settlements where save_id=p_save_id order by created_at desc,id limit 20) s),'[]'::jsonb),
    'artJobs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',j.id,'entityId',j.canonical_entity_id,'status',j.status,'attempt',j.attempt,'appearanceVersion',j.appearance_version,'failureCode',j.failure_code,'createdAt',j.created_at,'completedAt',j.completed_at,
      'renderId',(select c.render_id from private.world_runtime_art_current c where c.save_id=j.save_id and c.canonical_entity_id=j.canonical_entity_id)
    ) order by j.created_at desc,j.id) from (select * from private.world_runtime_art_jobs where save_id=p_save_id order by created_at desc,id limit 150) j),'[]'::jsonb),
    'overrides',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'saveId',o.save_id,'targetKind',o.target_kind,'targetId',o.target_id,'operation',o.operation,'beforeHash',o.before_hash,'outcome',o.summary,'actorId',o.actor_id,'createdAt',o.created_at) order by o.created_at desc,o.id) from (select * from private.world_developer_overrides where save_id=p_save_id order by created_at desc,id limit 100) o),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create function private.world_developer_hash(p_value jsonb) returns text language sql immutable strict set search_path='' as $$
  select encode(extensions.digest(convert_to(p_value::text,'utf8'),'sha256'),'hex'
  )
$$;

create function public.world_developer_requeue_settlement_job(p_save_id uuid,p_job_id uuid,p_actor_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.world_settlement_jobs; settlement private.world_settlements; before_state jsonb; after_state jsonb; attempts integer;
begin
  perform private.world_developer_inspector_assert_service();
  perform private.world_developer_inspector_assert_actor(p_save_id,p_actor_id);
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 240 then raise sqlstate 'PT400'; end if;
  select s.* into settlement
    from private.world_settlements s
    join private.world_settlement_jobs j on j.settlement_id=s.id
   where j.id=p_job_id and s.save_id=p_save_id
   for update of s;
  if not found then raise sqlstate 'PT409' using message='Only a terminal failed settlement job is eligible for requeue'; end if;
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=settlement.id for update;
  if not found or job.status<>'failed' or settlement.status not in ('failed','expired') then raise sqlstate 'PT409' using message='Only a terminal failed settlement job is eligible for requeue'; end if;
  select count(*) into attempts from private.world_settlement_attempts where job_id=job.id;
  if attempts>=3 then raise sqlstate 'PT409' using message='A job with exhausted attempts must remain historical'; end if;
  before_state:=jsonb_build_object('jobStatus',job.status,'settlementStatus',settlement.status,'attempts',attempts);
  update private.world_settlement_jobs set status='queued',failure_code=null,completed_at=null where id=job.id;
  update private.world_settlements set status='queued',failure_code=null,completed_at=null,terminal_receipt=null,fence=null,lease_until=null where id=settlement.id;
  update public.tavern_saves set world_phase='settling' where id=p_save_id;
  after_state:=jsonb_build_object('jobStatus','queued','settlementStatus','queued','attempts',attempts);
  insert into private.world_developer_overrides(save_id,actor_id,target_kind,target_id,operation,before_hash,after_hash,summary,reason)
  values(p_save_id,p_actor_id,'settlement_job',job.id,'requeue_settlement_job',private.world_developer_hash(before_state),private.world_developer_hash(after_state),'Requeued an eligible failed settlement job.',btrim(p_reason));
  return jsonb_build_object('status','requeued','jobId',job.id);
end $$;

create function public.world_developer_requeue_runtime_art_job(p_save_id uuid,p_job_id uuid,p_actor_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.world_runtime_art_jobs; before_state jsonb; after_state jsonb;
begin
  perform private.world_developer_inspector_assert_service();
  perform private.world_developer_inspector_assert_actor(p_save_id,p_actor_id);
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 240 then raise sqlstate 'PT400'; end if;
  select * into job from private.world_runtime_art_jobs where id=p_job_id and save_id=p_save_id for update;
  if not found or job.status not in ('failed_moderated','failed_provider','failed_storage') then raise sqlstate 'PT409' using message='Only a failed runtime-art job is eligible for requeue'; end if;
  before_state:=jsonb_build_object('status',job.status,'attempt',job.attempt,'appearanceVersion',job.appearance_version);
  update private.world_runtime_art_jobs set status='queued',fence=null,lease_until=null,failure_code=null,completed_at=null where id=job.id;
  after_state:=jsonb_build_object('status','queued','attempt',job.attempt,'appearanceVersion',job.appearance_version);
  insert into private.world_developer_overrides(save_id,actor_id,target_kind,target_id,operation,before_hash,after_hash,summary,reason)
  values(p_save_id,p_actor_id,'runtime_art_job',job.id,'requeue_runtime_art_job',private.world_developer_hash(before_state),private.world_developer_hash(after_state),'Requeued a failed runtime-art job.',btrim(p_reason));
  return jsonb_build_object('status','requeued','jobId',job.id);
end $$;

create function public.world_developer_set_runtime_art_appearance(p_save_id uuid,p_entity_id uuid,p_actor_id uuid,p_appearance_version text,p_public_appearance text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare appearance private.world_runtime_art_appearances; before_state jsonb; after_state jsonb; version_text text; appearance_text text;
begin
  perform private.world_developer_inspector_assert_service();
  perform private.world_developer_inspector_assert_actor(p_save_id,p_actor_id);
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 240 then raise sqlstate 'PT400'; end if;
  version_text:=btrim(coalesce(p_appearance_version,'')); appearance_text:=regexp_replace(btrim(coalesce(p_public_appearance,'')),'\s+',' ','g');
  if char_length(version_text) not between 1 and 128 or char_length(appearance_text) not between 1 and 1000 then raise sqlstate 'PT400'; end if;
  select * into appearance from private.world_runtime_art_appearances where save_id=p_save_id and canonical_entity_id=p_entity_id for update;
  if not found then raise sqlstate 'PT404'; end if;
  if appearance.appearance_version=version_text then raise sqlstate 'PT409' using message='A developer art override requires a new appearance version'; end if;
  before_state:=jsonb_build_object('appearanceVersion',appearance.appearance_version,'publicAppearance',appearance.public_appearance);
  perform public.world_runtime_art_set_appearance(p_save_id,p_entity_id,version_text,appearance_text);
  after_state:=jsonb_build_object('appearanceVersion',version_text,'publicAppearance',appearance_text);
  insert into private.world_developer_overrides(save_id,actor_id,target_kind,target_id,operation,before_hash,after_hash,summary,reason)
  values(p_save_id,p_actor_id,'runtime_art_appearance',p_entity_id,'set_runtime_art_appearance',private.world_developer_hash(before_state),private.world_developer_hash(after_state),'Queued a new public runtime-art appearance version.',btrim(p_reason));
  return jsonb_build_object('status','queued','entityId',p_entity_id,'appearanceVersion',version_text);
end $$;

revoke all on private.world_developer_overrides from public,anon,authenticated;
revoke all on function public.world_developer_inspector(uuid),public.world_developer_requeue_settlement_job(uuid,uuid,uuid,text),public.world_developer_requeue_runtime_art_job(uuid,uuid,uuid,text),public.world_developer_set_runtime_art_appearance(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.world_developer_inspector(uuid),public.world_developer_requeue_settlement_job(uuid,uuid,uuid,text),public.world_developer_requeue_runtime_art_job(uuid,uuid,uuid,text),public.world_developer_set_runtime_art_appearance(uuid,uuid,uuid,text,text,text) to service_role;
commit;
