-- Gate E1: mutation commits are authorized from the immutable resident package
-- pinned to the save. No pilot registry, V1 conversion, or generic backfill.
begin;

create table private.world_resident_mutation_receipts (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  proposal_fingerprint text not null check(proposal_fingerprint~'^[a-f0-9]{64}$'),
  canonical_proposal text not null, public_digest text not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp(), check(jsonb_typeof(result)='object')
);
create table private.world_resident_mutation_evidence (
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  evidence_key text not null, provenance text not null, source_fingerprint text not null,
  detail jsonb not null, created_at timestamptz not null default clock_timestamp(),
  primary key(job_id,evidence_key), check(jsonb_typeof(detail)='object')
);
create table private.world_resident_pressure_history (
  id bigint generated always as identity primary key,
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  dimension_key text not null, pressure_before integer not null, pressure_added integer not null,
  pressure_after integer not null, created_at timestamptz not null default clock_timestamp()
);
create table private.world_social_effect_receipts (
  job_id uuid not null references private.world_settlement_jobs(id) on delete cascade,
  ordinal smallint not null, input_fingerprint text not null check(input_fingerprint~'^[a-f0-9]{64}$'),
  payload jsonb not null, created_at timestamptz not null default clock_timestamp(),
  primary key(job_id,ordinal), check(jsonb_typeof(payload)='object')
);
create trigger world_mutation_receipt_append_only before update or delete on private.world_resident_mutation_receipts for each row execute function private.world_history_append_only();
create trigger world_mutation_evidence_append_only before update or delete on private.world_resident_mutation_evidence for each row execute function private.world_history_append_only();
create trigger world_mutation_pressure_append_only before update or delete on private.world_resident_pressure_history for each row execute function private.world_history_append_only();
create trigger world_social_effect_receipt_append_only before update or delete on private.world_social_effect_receipts for each row execute function private.world_history_append_only();

create function private.world_canonical_json(p_value jsonb)
returns text language plpgsql immutable strict set search_path='' as $function$
declare item jsonb; key text; rendered text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      rendered := '{';
      for key,item in select x.key,x.value from jsonb_each(p_value) x order by x.key collate "C" loop
        rendered := rendered || case when rendered='{' then '' else ',' end || to_jsonb(key)::text || ':' || private.world_canonical_json(item);
      end loop;
      return rendered || '}';
    when 'array' then
      rendered := '[';
      for item in select value from jsonb_array_elements(p_value) loop
        rendered := rendered || case when rendered='[' then '' else ',' end || private.world_canonical_json(item);
      end loop;
      return rendered || ']';
    else return p_value::text;
  end case;
end $function$;
create function private.world_json_keys_exact(p_value jsonb,p_keys text[])
returns boolean language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_value)='object' and array(select key from jsonb_object_keys(p_value) key order by key)=array(select unnest(p_keys) order by 1)
$$;
create function private.world_safe_mutation_json(p_value jsonb,p_depth integer default 0)
returns boolean language plpgsql immutable strict set search_path='' as $function$
declare key text; item jsonb; count_keys integer:=0;
begin
  if p_depth>6 then return false; end if;
  case jsonb_typeof(p_value)
    when 'null','boolean','number' then return true;
    when 'string' then return char_length(p_value#>>'{}')<=1000;
    when 'array' then
      if jsonb_array_length(p_value)>32 then return false; end if;
      for item in select value from jsonb_array_elements(p_value) loop if not private.world_safe_mutation_json(item,p_depth+1) then return false; end if; end loop;
      return true;
    when 'object' then
      for key,item in select x.key,x.value from jsonb_each(p_value) x loop
        count_keys:=count_keys+1;
        if count_keys>160 or char_length(key)>80 or key in ('__proto__','constructor','prototype') or not private.world_safe_mutation_json(item,p_depth+1) then return false; end if;
      end loop;
      return true;
    else return false;
  end case;
end $function$;

create function private.world_frozen_resident_evolution_base(p_instance_id uuid)
returns jsonb language plpgsql stable strict security definer set search_path='' as $function$
declare profile private.world_resident_profiles; package private.npc_version_resident_packages;
begin
  select p.* into profile from private.world_resident_profiles p where p.instance_id=p_instance_id;
  select package.* into package
  from private.world_resident_package_pins pin
  join private.npc_version_resident_packages package on package.id=pin.package_id and package.package_hash=pin.package_hash
  where pin.instance_id=p_instance_id and pin.save_id=profile.save_id;
  if not found then return null; end if;
  return jsonb_build_object('residentId',profile.instance_id,'npcId',profile.npc_id,'profileRevision',profile.profile_revision,
    'profile',profile.current_profile,'pressureByDimension',profile.pressure,'schema',package.personality_schema,'capability',package.capability_envelope,
    'packageId',package.id,'packageHash',package.package_hash);
end $function$;
revoke all on function private.world_frozen_resident_evolution_base(uuid) from public,anon,authenticated;
grant execute on function private.world_frozen_resident_evolution_base(uuid) to service_role;

create function public.world_settlement_commit_mutation(
  p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb,p_proposal_fingerprint text,p_public_digest text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare settlement private.world_settlements; job private.world_settlement_jobs; prior private.world_resident_mutation_receipts; canonical text; result jsonb;
begin
  perform private.world_settlement_assert_service();
  if jsonb_typeof(p_proposal)<>'object' or not private.world_safe_mutation_json(p_proposal) or coalesce(p_proposal_fingerprint,'') !~ '^[a-f0-9]{64}$' or char_length(trim(coalesce(p_public_digest,''))) not between 1 and 500 then
    raise sqlstate 'PT400' using message='Invalid mutation request';
  end if;
  canonical:=private.world_canonical_json(p_proposal);
  if encode(extensions.digest(canonical,'sha256'),'hex')<>p_proposal_fingerprint then raise sqlstate 'PT400' using message='Mutation proposal fingerprint is invalid'; end if;
  select * into prior from private.world_resident_mutation_receipts where job_id=p_job_id for update;
  if found then
    if prior.proposal_fingerprint=p_proposal_fingerprint and prior.canonical_proposal=canonical and prior.public_digest=trim(p_public_digest) then return prior.result; end if;
    raise sqlstate 'PT409' using message='Mutation job already has a different commit';
  end if;
  select * into settlement from private.world_settlements where id=p_settlement_id for update;
  select * into job from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id and job_kind='resident' and status='processing' for update;
  if not found or settlement.status<>'processing' or settlement.fence<>p_fence or settlement.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
  if not exists(select 1 from private.world_resident_package_pins pin join private.npc_version_resident_packages package on package.id=pin.package_id and package.package_hash=pin.package_hash where pin.save_id=settlement.save_id) then
    raise sqlstate 'PT409' using message='Resident mutation requires an immutable package pin';
  end if;
  result:=jsonb_build_object('status','completed','rulesVersion','evolving-world-v2','outcome','recorded','publicDigest',trim(p_public_digest));
  insert into private.world_resident_mutation_receipts(job_id,proposal_fingerprint,canonical_proposal,public_digest,result) values(job.id,p_proposal_fingerprint,canonical,trim(p_public_digest),result);
  update private.world_settlements set public_digest=trim(p_public_digest) where id=settlement.id;
  insert into private.world_settlement_outbox(settlement_id,job_id,event_key,payload) values(settlement.id,job.id,'mutation:'||job.id::text,result) on conflict do nothing;
  perform public.world_settlement_complete(settlement.id,job.id,p_fence,result);
  return result;
end $function$;
revoke all on function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) to service_role;
commit;
