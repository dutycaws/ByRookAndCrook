-- Issue #17: finite gameplay availability for generated items and recipes.
begin;

create table private.world_generated_gameplay_definitions (
  canonical_entity_id uuid primary key references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  family text not null check (family='herb_loaf_variant'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  mechanics jsonb not null check (jsonb_typeof(mechanics)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(save_id, family, canonical_entity_id)
);
create table private.world_generated_gameplay_availability (
  canonical_entity_id uuid primary key references private.world_generated_gameplay_definitions(canonical_entity_id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  available_day integer not null check(available_day >= 1),
  status text not null default 'active' check(status='active'),
  created_at timestamptz not null default clock_timestamp()
);
create table private.world_generated_gameplay_receipts (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  proposal_fingerprint text not null check(proposal_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_proposal text not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp()
);
create trigger world_generated_gameplay_receipts_append_only before update or delete on private.world_generated_gameplay_receipts for each row execute function private.world_history_append_only();

create function private.world_generated_gameplay_install(p_save_id uuid,p_day integer,p_entity_id uuid,p_family text,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.world_canonical_entities; result jsonb; existing private.world_generated_gameplay_definitions; was_available boolean:=false;
begin
  select * into e from private.world_canonical_entities where id=p_entity_id and save_id=p_save_id and origin='procedural' and lifecycle='active' for update;
  if not found or p_family<>'herb_loaf_variant' or e.entity_kind<>'recipe' then raise sqlstate 'PT400' using message='Gameplay unlock must target its active generated recipe entity'; end if;
  if not private.world_procedural_exact_keys(p_definition,array['displayName']) or not private.world_procedural_text(p_definition->'displayName',120) then raise sqlstate 'PT400' using message='Generated loaf variant mechanics are invalid'; end if;
  select * into existing from private.world_generated_gameplay_definitions where canonical_entity_id=p_entity_id;
  if found and (existing.save_id<>p_save_id or existing.family<>p_family or existing.display_name<>btrim(p_definition->>'displayName') or existing.mechanics is distinct from p_definition) then raise sqlstate 'PT409' using message='Gameplay definition conflicts with immutable canonical entity'; end if;
  if not found then insert into private.world_generated_gameplay_definitions(canonical_entity_id,save_id,family,display_name,mechanics) values(p_entity_id,p_save_id,p_family,btrim(p_definition->>'displayName'),p_definition); end if;
  was_available:=exists(select 1 from private.world_generated_gameplay_availability where canonical_entity_id=p_entity_id);
  insert into private.world_generated_gameplay_availability(canonical_entity_id,save_id,available_day) values(p_entity_id,p_save_id,p_day) on conflict(canonical_entity_id) do nothing;
  return jsonb_build_object('operation','gameplay_unlock','entityId',p_entity_id,'family',p_family,'reused',was_available);
end $$;

create function public.world_generated_gameplay_availability(p_save_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.tavern_saves where id=p_save_id and user_id=auth.uid()) then raise sqlstate 'PT404' using message='Tavern gameplay availability not found'; end if;
  return jsonb_build_object('version','generated-gameplay-v1','recipes',coalesce((select jsonb_agg(jsonb_build_object('entityId',d.canonical_entity_id,'recipeKey',e.entity_key,'name',d.display_name,'availableDay',a.available_day) order by d.display_name,d.canonical_entity_id) from private.world_generated_gameplay_definitions d join private.world_generated_gameplay_availability a on a.canonical_entity_id=d.canonical_entity_id join private.world_canonical_entities e on e.id=d.canonical_entity_id where d.save_id=p_save_id and d.family='herb_loaf_variant' and e.lifecycle='active'),'[]'::jsonb));
end $$;

alter table public.bake_sessions drop constraint bake_sessions_recipe_key_check;
alter table public.bake_sessions add constraint bake_sessions_recipe_key_check check(recipe_key='herb-loaf' or recipe_key ~ '^generated-[a-z][a-z0-9-]{1,79}$');

-- Preserve the established API while adding an explicit selected recipe key.
create function public.start_bake(p_save_id uuid,p_ingredient_batch_id uuid,p_recipe_key text,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare recipe private.world_generated_gameplay_definitions; result jsonb; session_id uuid; generated_key text;
begin
  if p_recipe_key='herb-loaf' then return public.start_bake(p_save_id,p_ingredient_batch_id,p_action_id,p_expected_revision); end if;
  if p_recipe_key !~ '^generated-[a-z][a-z0-9-]{1,79}$' then raise sqlstate 'PT400' using message='Generated recipe key is invalid'; end if;
  generated_key:=substring(p_recipe_key from 11);
  select d.* into recipe from private.world_generated_gameplay_definitions d join private.world_generated_gameplay_availability a on a.canonical_entity_id=d.canonical_entity_id join private.world_canonical_entities e on e.id=d.canonical_entity_id where d.save_id=p_save_id and d.family='herb_loaf_variant' and e.entity_key=generated_key and e.lifecycle='active';
  if not found then raise sqlstate 'PT422' using message='That generated recipe is not available'; end if;
  result:=public.start_bake(p_save_id,p_ingredient_batch_id,p_action_id,p_expected_revision);
  session_id:=(result->>'sessionId')::uuid;
  if exists(select 1 from public.bake_sessions where id=session_id and save_id=p_save_id and recipe_key<>'herb-loaf' and recipe_key<>p_recipe_key) then raise sqlstate 'PT409' using message='Action identifier was already used for a different recipe'; end if;
  update public.bake_sessions set recipe_key=p_recipe_key where id=session_id and save_id=p_save_id;
  return result || jsonb_build_object('recipeKey',p_recipe_key);
end $$;

alter function public.complete_bake(uuid,uuid,uuid,bigint) rename to complete_bake_before_generated_gameplay;
alter function public.complete_bake_before_generated_gameplay(uuid,uuid,uuid,bigint) set schema private;
create function public.complete_bake(p_save_id uuid,p_session_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_recipe_key text; label text;
begin
  result:=private.complete_bake_before_generated_gameplay(p_save_id,p_session_id,p_action_id,p_expected_revision);
  select session.recipe_key into v_recipe_key from public.bake_sessions session where session.id=p_session_id and session.save_id=p_save_id;
  if v_recipe_key like 'generated-%' then
    select d.display_name into label from private.world_generated_gameplay_definitions d join private.world_canonical_entities e on e.id=d.canonical_entity_id where d.save_id=p_save_id and d.family='herb_loaf_variant' and e.entity_key=substring(v_recipe_key from 11);
    if label is null then raise sqlstate 'PT409' using message='Generated recipe definition is unavailable'; end if;
    update public.foods set recipe_key=v_recipe_key,name=label where id=(result->>'foodId')::uuid and save_id=p_save_id;
    result:=result||jsonb_build_object('foodName',label,'recipeKey',v_recipe_key);
  end if;
  return result;
end $$;

-- The existing procedural command handler remains responsible for every older
-- operation. This wrapper strips only validated availability commands, commits
-- the canonical bundle under the existing lease/fence, then installs the fixed
-- gameplay definitions in the same transaction. The outer receipt preserves
-- exact replay of the complete proposal.
alter function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) rename to world_settlement_commit_procedural_world_before_gameplay;
alter function public.world_settlement_commit_procedural_world_before_gameplay(uuid,uuid,uuid,jsonb) set schema private;
create function public.world_settlement_commit_procedural_world(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare canonical text; fingerprint text; prior private.world_generated_gameplay_receipts; filtered jsonb:='[]'::jsonb; unlocks jsonb:='[]'::jsonb; created_recipe_keys text[]:=array[]::text[]; command jsonb; base jsonb; settlement private.world_settlements; entity_id uuid; owner uuid; capability jsonb; install jsonb:='[]'::jsonb; target private.world_canonical_entities;
begin
  perform private.world_settlement_assert_service();
  canonical:=private.world_canonical_json(p_proposal); fingerprint:=encode(extensions.digest(canonical,'sha256'),'hex');
  select * into prior from private.world_generated_gameplay_receipts where job_id=p_job_id;
  if found then
    if prior.proposal_fingerprint=fingerprint and prior.canonical_proposal=canonical then return prior.result || jsonb_build_object('replayed',true); end if;
    raise sqlstate 'PT409' using message='Gameplay command job already has a different proposal';
  end if;
  if jsonb_typeof(p_proposal)<>'object' or not private.world_procedural_exact_keys(p_proposal,array['version','commands']) or p_proposal->>'version'<>'procedural-world-v1' or jsonb_typeof(p_proposal->'commands')<>'array' then raise sqlstate 'PT400' using message='Procedural proposal violates the exact command envelope'; end if;
  select * into settlement from private.world_settlements where id=p_settlement_id for update;
  if not found then raise sqlstate 'PT409' using message='Settlement mismatch'; end if;
  -- Match TypeScript validation: an unlock may appear before its corresponding
  -- create command, but both must be part of this exact proposal.
  for command in select value from jsonb_array_elements(p_proposal->'commands') loop
    if command->>'operation'='entity' and command->>'entityKind'='recipe' then created_recipe_keys:=array_append(created_recipe_keys,private.world_procedural_key(command->>'entityKey')); end if;
  end loop;
  for command in select value from jsonb_array_elements(p_proposal->'commands') loop
    if command->>'operation'='gameplay_unlock' then
      if not private.world_procedural_exact_keys(command,array['operation','effectKind','sourceResidentId','entityRef','family','definition']) or command->>'effectKind'<>'unlock_gameplay' or command->>'family'<>'herb_loaf_variant' or not private.world_procedural_text(command->'sourceResidentId',128) then raise sqlstate 'PT400' using message='Gameplay unlock is malformed'; end if;
      begin owner:=(command->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400' using message='Gameplay unlock source resident must be a UUID'; end;
      if private.world_procedural_key(command->>'entityRef')<>any(created_recipe_keys) or not exists(select 1 from jsonb_array_elements(p_proposal->'commands') entity_command where entity_command->>'operation'='entity' and entity_command->>'entityKind'='recipe' and private.world_procedural_key(entity_command->>'entityKey')=private.world_procedural_key(command->>'entityRef') and entity_command->>'sourceResidentId'=command->>'sourceResidentId') then raise sqlstate 'PT400' using message='Gameplay unlock must match its resident-owned recipe entity created in this proposal'; end if;
      unlocks:=unlocks||jsonb_build_array(command);
    else
      filtered:=filtered||jsonb_build_array(command);
    end if;
  end loop;
  if jsonb_array_length(filtered)=0 then raise sqlstate 'PT400' using message='Gameplay unlock requires a canonical command in the same proposal'; end if;
  base:=private.world_settlement_commit_procedural_world_before_gameplay(p_settlement_id,p_job_id,p_fence,jsonb_build_object('version','procedural-world-v1','commands',filtered));
  for command in select value from jsonb_array_elements(unlocks) loop
    owner:=(command->>'sourceResidentId')::uuid;
    begin entity_id:=(command->>'entityRef')::uuid; exception when invalid_text_representation then entity_id:=null; end;
    capability:=(select input_snapshot->'capabilities'->(owner::text) from private.world_settlement_jobs where id=p_job_id);
    select * into target from private.world_canonical_entities where save_id=settlement.save_id and (id=entity_id or entity_key=private.world_procedural_key(command->>'entityRef'));
    if capability is null or not (capability->'allowedWorldEffects' ? 'create_entity') or target.id is null or not (capability->'allowedTargetKinds' ? target.entity_kind) or target.entity_kind<>'recipe' or not exists(select 1 from jsonb_array_elements(base->'operations') operation where operation->>'operation'='entity' and operation->>'entityKey'=target.entity_key and (operation->>'reused')::boolean=false) then raise sqlstate 'PT400' using message='Gameplay unlock lacks a newly-created frozen canonical recipe'; end if;
    install:=install || jsonb_build_array(private.world_generated_gameplay_install(settlement.save_id,settlement.day_number,target.id,command->>'family',command->'definition'));
  end loop;
  base:=base || jsonb_build_object('gameplayUnlocks',install,'replayed',false);
  insert into private.world_generated_gameplay_receipts(job_id,proposal_fingerprint,canonical_proposal,result) values(p_job_id,fingerprint,canonical,base);
  return base;
end $$;

revoke all on function private.world_generated_gameplay_install(uuid,integer,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.world_generated_gameplay_availability(uuid) from public,anon;
grant execute on function public.world_generated_gameplay_availability(uuid) to authenticated;
grant execute on function public.start_bake(uuid,uuid,text,uuid,bigint) to authenticated;
revoke all on function private.complete_bake_before_generated_gameplay(uuid,uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.complete_bake(uuid,uuid,uuid,bigint) from public,anon;
grant execute on function public.complete_bake(uuid,uuid,uuid,bigint) to authenticated;
revoke all on function private.world_settlement_commit_procedural_world_before_gameplay(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_procedural_world(uuid,uuid,uuid,jsonb) to service_role;
commit;
