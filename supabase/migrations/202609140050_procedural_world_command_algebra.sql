-- Issue #17: finite, registry-backed procedural world command algebra.
-- This deliberately does not enqueue new work or change settlement ordering.  A later
-- worker packet supplies frozen contexts and calls the server-only commit seam below.
begin;

create table private.world_procedural_entity_archetypes (
  archetype_key text primary key check (archetype_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  entity_kind text not null check (entity_kind in ('npc','location','faction','item','recipe','world_event')),
  source_version text not null default 'primitive-registry-v1'
);
insert into private.world_procedural_entity_archetypes(archetype_key,entity_kind) values
 ('deep-npc','npc'),('supporting-actor','npc'),('settlement','location'),('landmark','location'),
 ('guild','faction'),('trade-good','item'),('crafted-dish','recipe'),('public-occurrence','world_event');

create table private.world_procedural_quest_primitives (
  primitive_key text primary key check (primitive_key in ('successor-quest')),
  allowed_actions text[] not null check (allowed_actions = array['prepare','attempt','wait','abandon']),
  allowed_approaches text[] not null check (allowed_approaches = array['scouting','combat','diplomacy','trade']),
  source_version text not null default 'primitive-registry-v1'
);
insert into private.world_procedural_quest_primitives(primitive_key,allowed_actions,allowed_approaches)
values ('successor-quest',array['prepare','attempt','wait','abandon'],array['scouting','combat','diplomacy','trade']);

create table private.world_procedural_effect_registry (
  effect_kind text primary key check (effect_kind in ('create_entity','retire_entity','create_quest','update_quest','record_world_event')),
  target_kinds text[] not null,
  minimum integer not null,
  maximum integer not null,
  irreversible boolean not null,
  source_version text not null default 'primitive-registry-v1',
  check (minimum <= maximum)
);
insert into private.world_procedural_effect_registry(effect_kind,target_kinds,minimum,maximum,irreversible) values
 ('create_entity',array['npc','location','faction','item','recipe','world_event'],1,1,false),
 ('retire_entity',array['npc','location','faction','item','recipe','world_event'],1,1,true),
 ('create_quest',array['npc','location','faction','item'],1,3,false),
 ('update_quest',array['npc','location','faction','item'],1,3,false),
 ('record_world_event',array['npc','location','faction','item','world_event'],1,8,false);

create table private.world_procedural_public_events (
  id uuid primary key default extensions.gen_random_uuid(),
  settlement_id uuid not null references private.world_settlements(id) on delete cascade,
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,
  command_ordinal smallint not null check (command_ordinal between 0 and 7),
  canonical_entity_id uuid not null references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null,
  template_key text not null references private.world_canonical_event_templates(template_key),
  title text not null check (char_length(title) between 1 and 120),
  summary text not null check (char_length(summary) between 1 and 500),
  reuse_key text,
  created_at timestamptz not null default clock_timestamp(),
  unique(job_id,command_ordinal),
  unique(job_id,reuse_key),
  check (reuse_key is null or reuse_key ~ '^[a-z][a-z0-9-]{1,63}$')
);
create table private.world_procedural_command_receipts (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  proposal_fingerprint text not null check (proposal_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_proposal text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(result)='object')
);
create trigger world_procedural_public_events_append_only before update or delete on private.world_procedural_public_events for each row execute function private.world_history_append_only();
create trigger world_procedural_command_receipts_append_only before update or delete on private.world_procedural_command_receipts for each row execute function private.world_history_append_only();

create function private.world_procedural_key(p_value text) returns text language sql immutable strict set search_path='' as $$
  select trim(both '-' from regexp_replace(regexp_replace(lower(btrim(p_value)),'[^a-z0-9]+','-','g'),'-+','-','g'))
$$;
create function private.world_procedural_entity_kind(p_value text) returns text language sql stable strict security definer set search_path='' as $$
  select coalesce((select 'location' where lower(btrim(p_value))='place'),lower(btrim(p_value)))
$$;
create function private.world_procedural_resolve_entity(p_save_id uuid,p_reference text,p_kinds text[]) returns uuid language plpgsql stable security definer set search_path='' as $$
declare found_id uuid;
begin
  begin
    select id into found_id from private.world_canonical_entities where save_id=p_save_id and id=p_reference::uuid and entity_kind=any(p_kinds);
  exception when invalid_text_representation then null;
  end;
  if found_id is not null then return found_id; end if;
  select id into found_id from private.world_canonical_entities where save_id=p_save_id and entity_key=private.world_procedural_key(p_reference) and entity_kind=any(p_kinds);
  return found_id;
end $$;
create function private.world_procedural_exact_keys(p_value jsonb,p_keys text[]) returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_value)='object' and (p_value ?& p_keys) and (p_value - p_keys)='{}'::jsonb
$$;
create function private.world_procedural_text(p_value jsonb,p_limit integer) returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_value)='string' and char_length(btrim(p_value#>>'{}')) between 1 and p_limit
$$;
create function private.world_procedural_safe_value(p_value jsonb,p_depth integer) returns boolean language plpgsql immutable strict set search_path='' as $$
declare key text; child jsonb;
begin
  if p_depth>3 then return false; end if;
  if jsonb_typeof(p_value) in ('null','string','number','boolean') then return true; end if;
  if jsonb_typeof(p_value)='array' then
    if jsonb_array_length(p_value)>16 then return false; end if;
    for child in select value from jsonb_array_elements(p_value) loop if not private.world_procedural_safe_value(child,p_depth+1) then return false; end if; end loop;
    return true;
  end if;
  if jsonb_typeof(p_value)<>'object' or (select count(*) from jsonb_object_keys(p_value))>16 then return false; end if;
  for key,child in select entry.key,entry.value from jsonb_each(p_value) entry loop
    if key ~* '(?:^|_)(?:sql|query|route|url|endpoint|code|function|handler|script|executable)(?:$|_)' or key in ('__proto__','constructor','prototype') or not private.world_procedural_safe_value(child,p_depth+1) then return false; end if;
  end loop;
  return true;
end $$;
create function private.world_procedural_safe_payload(p_value jsonb) returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_value)='object' and octet_length(p_value::text)<=2048 and private.world_procedural_safe_value(p_value,0)
$$;

create function public.world_settlement_commit_procedural_world(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settlement private.world_settlements; job private.world_settlement_jobs; prior private.world_procedural_command_receipts;
  command jsonb; ordinal integer:=0; canonical text; fingerprint text; entity private.world_canonical_entities;
  normalized_kind text; normalized_key text; entity_id uuid; owner_id uuid; active_quest private.world_procedural_quests;
  target_refs jsonb; target_ids jsonb; ref text; template text; reuse_key text; event_id uuid; results jsonb:='[]'::jsonb; output jsonb; reused boolean:=false;
begin
  perform private.world_settlement_assert_service();
  canonical:=private.world_canonical_json(p_proposal); fingerprint:=encode(extensions.digest(canonical,'sha256'),'hex');
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id;
  if not found then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
  select * into prior from private.world_procedural_command_receipts where job_id=p_job_id;
  if found then
    if prior.proposal_fingerprint= fingerprint and prior.canonical_proposal=canonical then return prior.result; end if;
    raise sqlstate 'PT409' using message='Procedural command job already has a different proposal';
  end if;
  select * into settlement from private.world_settlements where id=p_settlement_id for update;
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id for update;
  if not found or job.job_kind not in ('canon','quest') or job.status<>'processing' or settlement.status<>'processing' or settlement.fence<>p_fence or settlement.lease_until<=clock_timestamp() or settlement.deadline_at<=clock_timestamp() or not exists(select 1 from private.world_settlement_attempts a where a.job_id=job.id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  if jsonb_typeof(p_proposal)<>'object' or octet_length(p_proposal::text)>12000 or not private.world_procedural_exact_keys(p_proposal,array['version','commands']) or p_proposal->>'version'<>'procedural-world-v1' or jsonb_typeof(p_proposal->'commands')<>'array' or jsonb_array_length(p_proposal->'commands') not between 1 and 8 then raise sqlstate 'PT400' using message='Procedural proposal violates the exact command envelope'; end if;

  for command in select value from jsonb_array_elements(p_proposal->'commands') loop
    if jsonb_typeof(command)<>'object' or jsonb_typeof(command->'operation')<>'string' or jsonb_typeof(command->'effectKind')<>'string' then raise sqlstate 'PT400' using message='Procedural command is malformed'; end if;
    if command->>'operation'='entity' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','sourceResidentId','entityKind','entityKey','archetypeKey','proposedName','payload']) or command->>'effectKind'<>'create_entity' or not private.world_procedural_text(command->'sourceResidentId',128) or not private.world_procedural_text(command->'entityKind',30) or not private.world_procedural_text(command->'entityKey',120) or not private.world_procedural_text(command->'archetypeKey',80) or not private.world_procedural_text(command->'proposedName',120) or not private.world_procedural_safe_payload(command->'payload') then raise sqlstate 'PT400' using message='Entity command is malformed'; end if;
      normalized_kind:=private.world_procedural_entity_kind(command->>'entityKind'); normalized_key:=private.world_procedural_key(command->>'entityKey');
      begin owner_id:=(command->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
      if normalized_kind not in ('npc','location','faction','item','recipe','world_event') or normalized_key !~ '^[a-z][a-z0-9_-]{1,79}$' or not exists(select 1 from private.world_procedural_effect_registry r where r.effect_kind='create_entity' and normalized_kind=any(r.target_kinds)) or not exists(select 1 from private.world_procedural_entity_archetypes a where a.archetype_key=private.world_procedural_key(command->>'archetypeKey') and a.entity_kind=normalized_kind) or not exists(select 1 from private.world_npc_instances i join private.world_resident_evolution_pins pin on pin.instance_id=i.id and pin.save_id=i.save_id where i.id=owner_id and i.save_id=settlement.save_id and i.status='active' and pin.capability->'allowedWorldEffects' ? 'create_entity' and pin.capability->'allowedTargetKinds' ? normalized_kind) then raise sqlstate 'PT400' using message='Entity command lacks registered initiating capability'; end if;
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
      if not exists(select 1 from private.world_npc_instances i join private.world_resident_evolution_pins pin on pin.instance_id=i.id and pin.save_id=i.save_id where i.id=owner_id and i.save_id=settlement.save_id and i.status='active' and pin.capability->'allowedWorldEffects' ? (command->>'effectKind') and pin.capability->'allowedActions' ? (command->>'action') and pin.capability->'allowedApproaches' ? (command->>'approach')) or not exists(select 1 from private.world_procedural_quest_primitives q where q.primitive_key=private.world_procedural_key(command->>'primitiveKey') and (command->>'action')=any(q.allowed_actions) and (command->>'approach')=any(q.allowed_approaches)) then raise sqlstate 'PT400' using message='Quest command lacks registered resident capability'; end if;
      target_ids:='[]'::jsonb;
      for ref in select value from jsonb_array_elements_text(command->'targetEntityRefs') loop
        entity_id:=private.world_procedural_resolve_entity(settlement.save_id,ref,array['npc','location','faction','item']);
        if entity_id is null or entity_id::text = any(array(select value from jsonb_array_elements_text(target_ids))) or not exists(select 1 from private.world_canonical_entities x join private.world_resident_evolution_pins pin on pin.instance_id=owner_id and pin.save_id=x.save_id where x.id=entity_id and pin.capability->'allowedTargetKinds' ? x.entity_kind) then raise sqlstate 'PT400' using message='Quest targets must resolve uniquely to registered canonical entities and capability'; end if;
        target_ids:=target_ids||jsonb_build_array(entity_id::text);
      end loop;
      select * into active_quest from private.world_procedural_quests where save_id=settlement.save_id and instance_id=owner_id and state='active' for update;
      if found then
        if command->>'effectKind'<>'update_quest' or active_quest.primitive_key<>private.world_procedural_key(command->>'primitiveKey') then raise sqlstate 'PT409' using message='Resident already has a different active successor quest'; end if;
        if command->>'action'='abandon' then update private.world_procedural_quests set state='abandoned',ended_day=settlement.day_number,payload=jsonb_build_object('action',command->>'action','approach',command->>'approach','targets',target_ids,'motivation',btrim(command->>'motivation'),'proposalFingerprint',fingerprint) where id=active_quest.id;
        else update private.world_procedural_quests set payload=jsonb_build_object('action',command->>'action','approach',command->>'approach','targets',target_ids,'motivation',btrim(command->>'motivation'),'proposalFingerprint',fingerprint) where id=active_quest.id; end if;
        results:=results||jsonb_build_array(jsonb_build_object('operation','quest','questId',active_quest.id,'reused',true));
      else
        if command->>'effectKind'<>'create_quest' or command->>'action'='abandon' then raise sqlstate 'PT409' using message='Successor quest update requires an active quest'; end if;
        insert into private.world_procedural_quests(save_id,instance_id,state,primitive_key,input_fingerprint,payload,started_day) values(settlement.save_id,owner_id,'active',private.world_procedural_key(command->>'primitiveKey'),fingerprint,jsonb_build_object('action',command->>'action','approach',command->>'approach','targets',target_ids,'motivation',btrim(command->>'motivation'),'proposalFingerprint',fingerprint),settlement.day_number) returning * into active_quest;
        results:=results||jsonb_build_array(jsonb_build_object('operation','quest','questId',active_quest.id,'reused',false));
      end if;
    elsif command->>'operation'='public_event' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','sourceResidentId','templateKey','participantEntityRefs','title','summary','reuseKey']) or command->>'effectKind'<>'record_world_event' or not private.world_procedural_text(command->'sourceResidentId',128) or not private.world_procedural_text(command->'templateKey',80) or not private.world_procedural_text(command->'title',120) or not private.world_procedural_text(command->'summary',500) or not private.world_procedural_text(command->'reuseKey',64) or jsonb_typeof(command->'participantEntityRefs')<>'array' or jsonb_array_length(command->'participantEntityRefs') not between 1 and 8 then raise sqlstate 'PT400' using message='Public event command is malformed'; end if;
      template:=private.world_procedural_key(command->>'templateKey'); reuse_key:=private.world_procedural_key(command->>'reuseKey');
      begin owner_id:=(command->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
      if reuse_key !~ '^[a-z][a-z0-9-]{1,63}$' or not exists(select 1 from private.world_canonical_event_templates where template_key=template) or not exists(select 1 from private.world_npc_instances i join private.world_resident_evolution_pins pin on pin.instance_id=i.id and pin.save_id=i.save_id where i.id=owner_id and i.save_id=settlement.save_id and i.status='active' and pin.capability->'allowedWorldEffects' ? 'record_world_event') then raise sqlstate 'PT400' using message='Public event lacks registered initiating capability'; end if;
      target_ids:='[]'::jsonb;
      for ref in select value from jsonb_array_elements_text(command->'participantEntityRefs') loop
        entity_id:=private.world_procedural_resolve_entity(settlement.save_id,ref,array['npc','location','faction','item','world_event']);
        if entity_id is null or entity_id::text = any(array(select value from jsonb_array_elements_text(target_ids))) or not exists(select 1 from private.world_canonical_event_templates t join private.world_canonical_entities x on x.id=entity_id where t.template_key=template and x.entity_kind=any(t.allowed_kinds)) or not exists(select 1 from private.world_canonical_entities x join private.world_resident_evolution_pins pin on pin.instance_id=owner_id and pin.save_id=x.save_id where x.id=entity_id and pin.capability->'allowedTargetKinds' ? x.entity_kind) then raise sqlstate 'PT400' using message='Public event participants are not registered for this template and capability'; end if;
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
    else
      raise sqlstate 'PT400' using message='Unsupported procedural operation';
    end if;
    ordinal:=ordinal+1;
  end loop;
  results:=results;
  output:=jsonb_build_object('status','completed','rulesVersion','procedural-world-v1','settlementId',settlement.id,'jobId',job.id,'proposalFingerprint',fingerprint,'operations',results);
  insert into private.world_procedural_command_receipts(job_id,proposal_fingerprint,canonical_proposal,result) values(job.id,fingerprint,canonical,output);
  perform public.world_settlement_complete(settlement.id,job.id,p_fence,jsonb_build_object('kind',job.job_kind,'procedural',true));
  return output;
end $$;

revoke all on private.world_procedural_entity_archetypes,private.world_procedural_quest_primitives,private.world_procedural_effect_registry,private.world_procedural_public_events,private.world_procedural_command_receipts from public,anon,authenticated,service_role;
revoke all on function private.world_procedural_key(text),private.world_procedural_entity_kind(text),private.world_procedural_resolve_entity(uuid,text,text[]),private.world_procedural_exact_keys(jsonb,text[]),private.world_procedural_text(jsonb,integer),private.world_procedural_safe_value(jsonb,integer),private.world_procedural_safe_payload(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) to service_role;
commit;
