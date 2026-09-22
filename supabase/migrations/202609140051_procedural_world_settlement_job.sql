-- Issue #17: a dedicated, frozen procedural-world settlement job.
-- The job deliberately follows existing canonical and social work so this
-- additive gate cannot change their established ordinals or contracts.
begin;

alter table private.world_settlement_jobs drop constraint world_settlement_jobs_job_kind_check;
alter table private.world_settlement_jobs add constraint world_settlement_jobs_job_kind_check
  check(job_kind in ('snapshot','canon','resident','quest','effects','news','finalize','social_encounter','procedural_world'));

create function private.world_procedural_world_context(p_save_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with entity_candidates as (
    select i.id::text as reference, 'npc'::text as entity_kind
    from private.world_npc_instances i
    where i.save_id=p_save_id and i.status='active'
    union all
    select e.id::text, e.entity_kind
    from private.world_canonical_entities e
    where e.save_id=p_save_id and e.lifecycle in ('discovered','active')
    union all
    select e.entity_key, e.entity_kind
    from private.world_canonical_entities e
    where e.save_id=p_save_id and e.lifecycle in ('discovered','active')
  ), entity_kinds as (
    select distinct on (reference) reference, entity_kind
    from entity_candidates order by reference, entity_kind
  ), active_quests as (
    select q.instance_id::text as resident_id,
      jsonb_build_object('id',q.id,'primitiveKey',q.primitive_key) as quest
    from private.world_procedural_quests q
    where q.save_id=p_save_id and q.state='active'
  ), resident_capabilities as (
    select i.id::text as resident_id, package.capability_envelope as capability
    from private.world_npc_instances i
    join private.world_resident_package_pins pin on pin.instance_id=i.id and pin.save_id=i.save_id
    join private.npc_version_resident_packages package on package.id=pin.package_id and package.package_hash=pin.package_hash
    where i.save_id=p_save_id and i.status='active'
  )
  select jsonb_build_object(
    'version','procedural-world-v1',
    'entityKinds',coalesce((select jsonb_object_agg(reference,entity_kind order by reference) from entity_kinds),'{}'::jsonb),
    'activeGeneratedEntityCount',(select count(*) from private.world_canonical_entities e where e.save_id=p_save_id and e.origin='procedural' and e.lifecycle='active'),
    'activeQuestByResident',coalesce((select jsonb_object_agg(resident_id,quest order by resident_id) from active_quests),'{}'::jsonb),
    'capabilities',coalesce((select jsonb_object_agg(resident_id,capability order by resident_id) from resident_capabilities),'{}'::jsonb)
  )
$$;

-- Resident instances are valid frozen NPC references, but unlike canonical
-- entities they do not have a canonical-entity row.  Resolve their immutable
-- instance ID explicitly and only for the NPC target kind.
create or replace function private.world_procedural_resolve_entity(p_save_id uuid,p_reference text,p_kinds text[])
returns uuid language plpgsql stable security definer set search_path='' as $$
declare found_id uuid;
begin
  if 'npc'=any(p_kinds) then
    begin
      select id into found_id from private.world_npc_instances
      where save_id=p_save_id and id=p_reference::uuid and status='active';
    exception when invalid_text_representation then null;
    end;
    if found_id is not null then return found_id; end if;
  end if;
  begin
    select id into found_id from private.world_canonical_entities
    where save_id=p_save_id and id=p_reference::uuid and entity_kind=any(p_kinds);
  exception when invalid_text_representation then null;
  end;
  if found_id is not null then return found_id; end if;
  select id into found_id from private.world_canonical_entities
  where save_id=p_save_id and entity_key=private.world_procedural_key(p_reference) and entity_kind=any(p_kinds);
  return found_id;
end $$;

alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_procedural_world_v1;
alter function public.advance_tavern_day_before_procedural_world_v1(uuid,uuid,bigint) set schema private;

create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; s private.world_settlements; snapshot jsonb; fingerprint text; ordinal smallint;
begin
  r:=private.advance_tavern_day_before_procedural_world_v1(p_save_id,p_action_id,p_expected_revision);
  if not (r ? 'worldSettlement') then return r; end if;
  select * into s from private.world_settlements where id=(r#>>'{worldSettlement,settlementId}')::uuid for update;
  if not found or exists(select 1 from private.world_settlement_jobs where settlement_id=s.id and job_kind='procedural_world')
    or exists(select 1 from private.world_settlement_attempts a join private.world_settlement_jobs j on j.id=a.job_id where j.settlement_id=s.id) then return r; end if;
  select coalesce(max(j.ordinal),0)::smallint+1 into ordinal from private.world_settlement_jobs j where j.settlement_id=s.id;
  if ordinal>64 then return r; end if;
  snapshot:=private.world_procedural_world_context(s.save_id);
  if not (snapshot ?& array['version','entityKinds','activeGeneratedEntityCount','activeQuestByResident','capabilities'])
    or (select count(*) from jsonb_object_keys(snapshot))<>5
    or snapshot->>'version'<>'procedural-world-v1'
    or jsonb_typeof(snapshot->'entityKinds')<>'object'
    or jsonb_typeof(snapshot->'activeGeneratedEntityCount')<>'number'
    or jsonb_typeof(snapshot->'activeQuestByResident')<>'object'
    or jsonb_typeof(snapshot->'capabilities')<>'object'
    or octet_length(snapshot::text)>16384 then raise sqlstate 'PT400' using message='Procedural world snapshot is invalid'; end if;
  fingerprint:=encode(extensions.digest(private.world_canonical_json(snapshot),'sha256'),'hex');
  insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint,input_snapshot,input_version)
    values(s.id,ordinal,'procedural_world',fingerprint,snapshot,'procedural-world-v1')
    on conflict do nothing;
  return r;
end $$;

create or replace function public.world_settlement_commit_procedural_world(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settlement private.world_settlements; job private.world_settlement_jobs; prior private.world_procedural_command_receipts;
  command jsonb; ordinal integer:=0; canonical text; fingerprint text; entity private.world_canonical_entities;
  normalized_kind text; normalized_key text; entity_id uuid; owner_id uuid; active_quest private.world_procedural_quests;
  target_ids jsonb; ref text; template text; reuse_key text; results jsonb:='[]'::jsonb; output jsonb; reused boolean:=false; capability jsonb;
begin
  perform private.world_settlement_assert_service();
  canonical:=private.world_canonical_json(p_proposal); fingerprint:=encode(extensions.digest(canonical,'sha256'),'hex');
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id;
  if not found or job.job_kind<>'procedural_world' then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
  select * into prior from private.world_procedural_command_receipts where job_id=p_job_id;
  if found then
    if prior.proposal_fingerprint=fingerprint and prior.canonical_proposal=canonical then return prior.result || jsonb_build_object('replayed',true); end if;
    raise sqlstate 'PT409' using message='Procedural command job already has a different proposal';
  end if;
  select * into settlement from private.world_settlements where id=p_settlement_id for update;
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id for update;
  if not found or job.job_kind<>'procedural_world' or job.status<>'processing' or job.input_version<>'procedural-world-v1'
    or (select count(*) from jsonb_object_keys(job.input_snapshot))<>5 or job.input_snapshot->>'version'<>'procedural-world-v1'
    or not (job.input_snapshot ?& array['version','entityKinds','activeGeneratedEntityCount','activeQuestByResident','capabilities'])
    or jsonb_typeof(job.input_snapshot->'entityKinds')<>'object' or jsonb_typeof(job.input_snapshot->'activeGeneratedEntityCount')<>'number'
    or jsonb_typeof(job.input_snapshot->'activeQuestByResident')<>'object' or jsonb_typeof(job.input_snapshot->'capabilities')<>'object'
    or job.input_fingerprint<>encode(extensions.digest(private.world_canonical_json(job.input_snapshot),'sha256'),'hex')
    or settlement.status<>'processing' or settlement.fence<>p_fence or settlement.lease_until<=clock_timestamp() or settlement.deadline_at<=clock_timestamp()
    or not exists(select 1 from private.world_settlement_attempts a where a.job_id=job.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  if jsonb_typeof(p_proposal)<>'object' or octet_length(p_proposal::text)>12000 or not private.world_procedural_exact_keys(p_proposal,array['version','commands']) or p_proposal->>'version'<>'procedural-world-v1' or jsonb_typeof(p_proposal->'commands')<>'array' or jsonb_array_length(p_proposal->'commands') not between 1 and 8 then raise sqlstate 'PT400' using message='Procedural proposal violates the exact command envelope'; end if;

  for command in select value from jsonb_array_elements(p_proposal->'commands') loop
    if jsonb_typeof(command)<>'object' or jsonb_typeof(command->'operation')<>'string' or jsonb_typeof(command->'effectKind')<>'string' then raise sqlstate 'PT400' using message='Procedural command is malformed'; end if;
    if command->>'operation'='entity' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','sourceResidentId','entityKind','entityKey','archetypeKey','proposedName','payload']) or command->>'effectKind'<>'create_entity' or not private.world_procedural_text(command->'sourceResidentId',128) or not private.world_procedural_text(command->'entityKind',30) or not private.world_procedural_text(command->'entityKey',120) or not private.world_procedural_text(command->'archetypeKey',80) or not private.world_procedural_text(command->'proposedName',120) or not private.world_procedural_safe_payload(command->'payload') then raise sqlstate 'PT400' using message='Entity command is malformed'; end if;
      normalized_kind:=private.world_procedural_entity_kind(command->>'entityKind'); normalized_key:=private.world_procedural_key(command->>'entityKey');
      begin owner_id:=(command->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
      capability:=job.input_snapshot->'capabilities'->(owner_id::text);
      if normalized_kind not in ('npc','location','faction','item','recipe','world_event') or normalized_key !~ '^[a-z][a-z0-9_-]{1,79}$' or not exists(select 1 from private.world_procedural_effect_registry r where r.effect_kind='create_entity' and normalized_kind=any(r.target_kinds)) or not exists(select 1 from private.world_procedural_entity_archetypes a where a.archetype_key=private.world_procedural_key(command->>'archetypeKey') and a.entity_kind=normalized_kind) or capability is null or not (capability->'allowedWorldEffects' ? 'create_entity') or not (capability->'allowedTargetKinds' ? normalized_kind) then raise sqlstate 'PT400' using message='Entity command lacks frozen initiating capability'; end if;
      select * into entity from private.world_canonical_entities where save_id=settlement.save_id and entity_kind=normalized_kind and entity_key=normalized_key for update;
      if found then
        if entity.origin<>'procedural' or entity.payload is distinct from jsonb_build_object('archetypeKey',private.world_procedural_key(command->>'archetypeKey'),'proposedName',btrim(command->>'proposedName'),'payload',command->'payload') then raise sqlstate 'PT409' using message='Entity reuse conflicts with immutable canonical meaning'; end if;
        results:=results||jsonb_build_array(jsonb_build_object('operation','entity','entityId',entity.id,'entityKind',normalized_kind,'entityKey',normalized_key,'reused',true));
      else
        if (select count(*) from private.world_canonical_entities where save_id=settlement.save_id and origin='procedural' and lifecycle='active') >= 150 then raise sqlstate 'PT409' using message='Generated entity limit reached'; end if;
        insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values(settlement.save_id,normalized_kind,normalized_key,'procedural','procedural-world-v1',jsonb_build_object('archetypeKey',private.world_procedural_key(command->>'archetypeKey'),'proposedName',btrim(command->>'proposedName'),'payload',command->'payload'),'active',settlement.day_number) returning * into entity;
        insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values(entity.id,'created',jsonb_build_object('proposalFingerprint',fingerprint,'commandOrdinal',ordinal),'procedural-world-v1');
        results:=results||jsonb_build_array(jsonb_build_object('operation','entity','entityId',entity.id,'entityKind',normalized_kind,'entityKey',normalized_key,'reused',false));
      end if;
    elsif command->>'operation'='quest' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','ownerResidentId','primitiveKey','action','approach','targetEntityRefs','motivation']) or command->>'effectKind' not in ('create_quest','update_quest') or not private.world_procedural_text(command->'ownerResidentId',128) or not private.world_procedural_text(command->'primitiveKey',80) or not private.world_procedural_text(command->'action',40) or not private.world_procedural_text(command->'approach',40) or not private.world_procedural_text(command->'motivation',500) or jsonb_typeof(command->'targetEntityRefs')<>'array' or jsonb_array_length(command->'targetEntityRefs') not between 1 and 3 then raise sqlstate 'PT400' using message='Quest command is malformed'; end if;
      begin owner_id:=(command->>'ownerResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
      capability:=job.input_snapshot->'capabilities'->(owner_id::text);
      if capability is null or not (capability->'allowedWorldEffects' ? (command->>'effectKind')) or not (capability->'allowedActions' ? (command->>'action')) or not (capability->'allowedApproaches' ? (command->>'approach')) or not exists(select 1 from private.world_procedural_quest_primitives q where q.primitive_key=private.world_procedural_key(command->>'primitiveKey') and (command->>'action')=any(q.allowed_actions) and (command->>'approach')=any(q.allowed_approaches)) then raise sqlstate 'PT400' using message='Quest command lacks frozen resident capability'; end if;
      target_ids:='[]'::jsonb;
      for ref in select value from jsonb_array_elements_text(command->'targetEntityRefs') loop
        entity_id:=private.world_procedural_resolve_entity(settlement.save_id,ref,array['npc','location','faction','item']);
        if entity_id is null or not (job.input_snapshot->'entityKinds' ? (entity_id::text)) or entity_id::text = any(array(select value from jsonb_array_elements_text(target_ids))) or not (capability->'allowedTargetKinds' ? (job.input_snapshot->'entityKinds'->>(entity_id::text))) then raise sqlstate 'PT400' using message='Quest targets must resolve uniquely to frozen registered canonical entities and capability'; end if;
        target_ids:=target_ids||jsonb_build_array(entity_id::text);
      end loop;
      select * into active_quest from private.world_procedural_quests where save_id=settlement.save_id and instance_id=owner_id and state='active' for update;
      if found then
        if command->>'effectKind'<>'update_quest' or active_quest.primitive_key<>private.world_procedural_key(command->>'primitiveKey') or job.input_snapshot#>>array['activeQuestByResident',owner_id::text,'id']<>active_quest.id::text then raise sqlstate 'PT409' using message='Resident already has a different frozen active successor quest'; end if;
        if command->>'action'='abandon' then update private.world_procedural_quests set state='abandoned',ended_day=settlement.day_number,payload=jsonb_build_object('action',command->>'action','approach',command->>'approach','targets',target_ids,'motivation',btrim(command->>'motivation'),'proposalFingerprint',fingerprint) where id=active_quest.id;
        else update private.world_procedural_quests set payload=jsonb_build_object('action',command->>'action','approach',command->>'approach','targets',target_ids,'motivation',btrim(command->>'motivation'),'proposalFingerprint',fingerprint) where id=active_quest.id; end if;
        results:=results||jsonb_build_array(jsonb_build_object('operation','quest','questId',active_quest.id,'reused',true));
      else
        if job.input_snapshot->'activeQuestByResident' ? (owner_id::text) or command->>'effectKind'<>'create_quest' or command->>'action'='abandon' then raise sqlstate 'PT409' using message='Successor quest update requires the frozen active quest'; end if;
        insert into private.world_procedural_quests(save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day) values(settlement.save_id,owner_id,'active',private.world_procedural_key(command->>'primitiveKey'),fingerprint,jsonb_build_object('action',command->>'action','approach',command->>'approach','targets',target_ids,'motivation',btrim(command->>'motivation'),'proposalFingerprint',fingerprint),settlement.day_number) returning * into active_quest;
        results:=results||jsonb_build_array(jsonb_build_object('operation','quest','questId',active_quest.id,'reused',false));
      end if;
    elsif command->>'operation'='public_event' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','sourceResidentId','templateKey','participantEntityRefs','title','summary','reuseKey']) or command->>'effectKind'<>'record_world_event' or not private.world_procedural_text(command->'sourceResidentId',128) or not private.world_procedural_text(command->'templateKey',80) or not private.world_procedural_text(command->'title',120) or not private.world_procedural_text(command->'summary',500) or not private.world_procedural_text(command->'reuseKey',64) or jsonb_typeof(command->'participantEntityRefs')<>'array' or jsonb_array_length(command->'participantEntityRefs') not between 1 and 8 then raise sqlstate 'PT400' using message='Public event command is malformed'; end if;
      template:=private.world_procedural_key(command->>'templateKey'); reuse_key:=private.world_procedural_key(command->>'reuseKey');
      begin owner_id:=(command->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
      capability:=job.input_snapshot->'capabilities'->(owner_id::text);
      if reuse_key !~ '^[a-z][a-z0-9-]{1,63}$' or not exists(select 1 from private.world_canonical_event_templates where template_key=template) or capability is null or not (capability->'allowedWorldEffects' ? 'record_world_event') then raise sqlstate 'PT400' using message='Public event lacks frozen initiating capability'; end if;
      target_ids:='[]'::jsonb;
      for ref in select value from jsonb_array_elements_text(command->'participantEntityRefs') loop
        entity_id:=private.world_procedural_resolve_entity(settlement.save_id,ref,array['npc','location','faction','item','world_event']);
        if entity_id is null or not (job.input_snapshot->'entityKinds' ? (entity_id::text)) or entity_id::text = any(array(select value from jsonb_array_elements_text(target_ids))) or not exists(select 1 from private.world_canonical_event_templates t where t.template_key=template and (job.input_snapshot->'entityKinds'->>(entity_id::text))=any(t.allowed_kinds)) or not (capability->'allowedTargetKinds' ? (job.input_snapshot->'entityKinds'->>(entity_id::text))) then raise sqlstate 'PT400' using message='Public event participants are not frozen registered for this template and capability'; end if;
        target_ids:=target_ids||jsonb_build_array(entity_id::text);
      end loop;
      reused:=false;
      select * into entity from private.world_canonical_entities where save_id=settlement.save_id and entity_kind='world_event' and entity_key=reuse_key for update;
      if found then
        if entity.origin<>'procedural' or entity.payload->>'proposalFingerprint'<>fingerprint then raise sqlstate 'PT409' using message='Public event reuse conflicts with immutable canonical meaning'; end if;
        reused:=true;
      else
        if (select count(*) from private.world_canonical_entities where save_id=settlement.save_id and origin='procedural' and lifecycle='active') >= 150 then raise sqlstate 'PT409' using message='Generated entity limit reached'; end if;
        insert into private.world_canonical_entities(save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day) values(settlement.save_id,'world_event',reuse_key,'procedural','procedural-world-v1',jsonb_build_object('proposalFingerprint',fingerprint,'templateKey',template,'participantEntityIds',target_ids,'title',btrim(command->>'title'),'summary',btrim(command->>'summary')),'active',settlement.day_number) returning * into entity;
        insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values(entity.id,'created',jsonb_build_object('proposalFingerprint',fingerprint,'commandOrdinal',ordinal),'procedural-world-v1');
      end if;
      insert into private.world_procedural_public_events(settlement_id,job_id,command_ordinal,canonical_entity_id,save_id,day_number,template_key,title,summary,reuse_key) values(settlement.id,job.id,ordinal,entity.id,settlement.save_id,settlement.day_number,template,btrim(command->>'title'),btrim(command->>'summary'),reuse_key);
      results:=results||jsonb_build_array(jsonb_build_object('operation','public_event','canonicalEventId',entity.id,'templateKey',template,'reused',reused));
    else raise sqlstate 'PT400' using message='Unsupported procedural operation'; end if;
    ordinal:=ordinal+1;
  end loop;
  output:=jsonb_build_object('status','completed','rulesVersion','procedural-world-v1','settlementId',settlement.id,'jobId',job.id,'proposalFingerprint',fingerprint,'operations',results,'replayed',false);
  insert into private.world_procedural_command_receipts(job_id,proposal_fingerprint,canonical_proposal,result) values(job.id,fingerprint,canonical,output);
  perform public.world_settlement_complete(settlement.id,job.id,p_fence,jsonb_build_object('kind','procedural_world','procedural',true));
  return output;
end $$;

revoke all on function private.world_procedural_world_context(uuid),private.advance_tavern_day_before_procedural_world_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.advance_tavern_day(uuid,uuid,bigint),public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
grant execute on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) to service_role;
commit;
