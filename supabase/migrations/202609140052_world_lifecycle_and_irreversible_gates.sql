-- Issue #17 P9: bounded procedural-world lifecycle and irreversible retirement gates.
-- Canonical rows remain immutable. This migration records mutable casting separately
-- and retires only after durable history and a player-visible warning have been kept.
begin;

create table private.world_generated_entity_lifecycle (
  entity_id uuid primary key references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  entity_role text not null check(entity_role in ('deep_npc','supporting_actor','location')),
  registered_day integer not null,
  role_changed_day integer not null,
  created_at timestamptz not null default clock_timestamp()
);
create table private.world_generated_entity_lifecycle_history (
  id bigint generated always as identity primary key,
  entity_id uuid not null references private.world_canonical_entities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  event_kind text not null check(event_kind in ('registered','promoted','demoted','retired')),
  from_role text check(from_role is null or from_role in ('deep_npc','supporting_actor','location')),
  to_role text check(to_role is null or to_role in ('deep_npc','supporting_actor','location')),
  relevance integer not null default 0,
  reason text not null default '' check(char_length(reason)<=240),
  day_number integer not null,
  created_at timestamptz not null default clock_timestamp()
);
create trigger world_generated_entity_lifecycle_history_append_only before update or delete on private.world_generated_entity_lifecycle_history for each row execute function private.world_history_append_only();

create function private.world_generated_entity_role(p_entity_kind text,p_payload jsonb) returns text language sql immutable strict set search_path='' as $$
  select case
    when p_entity_kind='npc' and p_payload->>'archetypeKey'='deep-npc' then 'deep_npc'
    when p_entity_kind='npc' and p_payload->>'archetypeKey'='supporting-actor' then 'supporting_actor'
    when p_entity_kind='location' then 'location'
    else null
  end
$$;

insert into private.world_generated_entity_lifecycle(entity_id,save_id,entity_role,registered_day,role_changed_day)
select e.id,e.save_id,private.world_generated_entity_role(e.entity_kind,e.payload),coalesce(e.discovered_day,0),coalesce(e.discovered_day,0)
from private.world_canonical_entities e
where e.origin='procedural' and private.world_generated_entity_role(e.entity_kind,e.payload) is not null
on conflict(entity_id) do nothing;
insert into private.world_generated_entity_lifecycle_history(entity_id,save_id,event_kind,to_role,day_number)
select l.entity_id,l.save_id,'registered',l.entity_role,l.registered_day
from private.world_generated_entity_lifecycle l
where not exists(select 1 from private.world_generated_entity_lifecycle_history h where h.entity_id=l.entity_id);

create function private.world_generated_entity_register() returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text; v_day integer;
begin
  v_role:=private.world_generated_entity_role(new.entity_kind,new.payload);
  if new.origin='procedural' and v_role is not null then
    select current_day into v_day from public.tavern_saves where id=new.save_id;
    insert into private.world_generated_entity_lifecycle(entity_id,save_id,entity_role,registered_day,role_changed_day)
    values(new.id,new.save_id,v_role,coalesce(new.discovered_day,v_day),coalesce(new.discovered_day,v_day));
    insert into private.world_generated_entity_lifecycle_history(entity_id,save_id,event_kind,to_role,day_number)
    values(new.id,new.save_id,'registered',v_role,coalesce(new.discovered_day,v_day));
  end if;
  return new;
end $$;
create trigger world_generated_entity_register after insert on private.world_canonical_entities for each row execute function private.world_generated_entity_register();

create function private.world_generated_entity_cap_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text; v_count integer;
begin
  if new.origin<>'procedural' or new.lifecycle<>'active' or (tg_op='UPDATE' and old.lifecycle='active') then return new; end if;
  select count(*) into v_count from private.world_canonical_entities e where e.save_id=new.save_id and e.origin='procedural' and e.lifecycle='active';
  if v_count>=150 then raise sqlstate 'PT409' using message='Generated entity limit reached'; end if;
  v_role:=private.world_generated_entity_role(new.entity_kind,new.payload);
  if v_role is not null then
    select count(*) into v_count from private.world_generated_entity_lifecycle l join private.world_canonical_entities e on e.id=l.entity_id where l.save_id=new.save_id and l.entity_role=v_role and e.lifecycle='active';
    if (v_role='deep_npc' and v_count>=8) or (v_role='supporting_actor' and v_count>=40) or (v_role='location' and v_count>=8) then
      raise sqlstate 'PT409' using message='Active generated entity role limit reached';
    end if;
  end if;
  return new;
end $$;
create trigger world_generated_entity_cap_guard before insert or update on private.world_canonical_entities for each row execute function private.world_generated_entity_cap_guard();

-- 041 only has NPC-instance targets. Add entity targets before compiling any
-- lifecycle query that can protect a canonical generated entity by direct ID.
alter table private.world_irreversible_capabilities alter column target_instance_id drop not null;
alter table private.world_irreversible_capabilities add column target_entity_id uuid references private.world_canonical_entities(id) on delete restrict, add column gate_version text not null default 'legacy-v1' check(gate_version in ('legacy-v1','irreversible-gate-v2')), add column critic_evidence_ref text;
alter table private.world_effect_warnings add column capability_id uuid references private.world_irreversible_capabilities(id) on delete restrict, add column target_entity_id uuid references private.world_canonical_entities(id) on delete restrict;
alter table private.world_effect_receipts add column target_entity_id uuid references private.world_canonical_entities(id) on delete restrict;
create unique index world_irreversible_capability_entity_key on private.world_irreversible_capabilities(save_id,target_entity_id,capability_key) where target_entity_id is not null;

create function private.world_generated_entity_is_protected(p_entity_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.world_procedural_quests q where q.state='active' and coalesce(q.payload->'targets','[]'::jsonb) ? p_entity_id::text)
    or exists(select 1 from private.world_canonical_entities e where e.id<>p_entity_id and (coalesce(e.payload->'participantEntityIds','[]'::jsonb) ? p_entity_id::text or coalesce(e.payload->'referencedEntityIds','[]'::jsonb) ? p_entity_id::text))
    or exists(select 1 from private.world_canonical_entity_history h where h.entity_id<>p_entity_id and coalesce(h.payload->'referencedEntityIds','[]'::jsonb) ? p_entity_id::text)
    or exists(select 1 from private.world_effect_receipts r where r.committed_at is not null and (r.target_entity_id=p_entity_id or coalesce(r.payload->'targetEntityIds','[]'::jsonb) ? p_entity_id::text))
    or exists(select 1 from private.world_effect_warnings w where w.target_entity_id=p_entity_id or coalesce(w.payload->'targetEntityIds','[]'::jsonb) ? p_entity_id::text)
$$;
create function private.world_generated_entity_is_protected_except_warning(p_entity_id uuid,p_warning_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.world_procedural_quests q where q.state='active' and coalesce(q.payload->'targets','[]'::jsonb) ? p_entity_id::text)
    or exists(select 1 from private.world_canonical_entities e where e.id<>p_entity_id and (coalesce(e.payload->'participantEntityIds','[]'::jsonb) ? p_entity_id::text or coalesce(e.payload->'referencedEntityIds','[]'::jsonb) ? p_entity_id::text))
    or exists(select 1 from private.world_canonical_entity_history h where h.entity_id<>p_entity_id and coalesce(h.payload->'referencedEntityIds','[]'::jsonb) ? p_entity_id::text)
    or exists(select 1 from private.world_effect_receipts r where r.committed_at is not null and (r.target_entity_id=p_entity_id or coalesce(r.payload->'targetEntityIds','[]'::jsonb) ? p_entity_id::text))
    or exists(select 1 from private.world_effect_warnings w where w.id<>p_warning_id and (w.target_entity_id=p_entity_id or coalesce(w.payload->'targetEntityIds','[]'::jsonb) ? p_entity_id::text))
$$;
create function private.world_generated_entity_relevance(p_entity_id uuid) returns integer language sql stable security definer set search_path='' as $$
  select coalesce((select
    (case when private.world_generated_entity_is_protected(e.id) then 100 else 0 end)
    + (case when exists(select 1 from private.world_procedural_quests q where q.state='active' and coalesce(q.payload->'targets','[]'::jsonb) ? e.id::text) then 50 else 0 end)
    + greatest(0,20-least(20,(s.current_day-coalesce(e.discovered_day,s.current_day))))
    from private.world_canonical_entities e join public.tavern_saves s on s.id=e.save_id where e.id=p_entity_id),0)
$$;

create function private.world_generated_entity_lifecycle_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Generated entity lifecycle is retained with its append-only history'; end if;
  if tg_op='UPDATE' and new.entity_role<>old.entity_role and (new.role_changed_day<old.role_changed_day or not exists(select 1 from private.world_generated_entity_lifecycle_history h where h.entity_id=old.entity_id and h.event_kind in ('promoted','demoted') and h.to_role=new.entity_role and h.day_number=new.role_changed_day and h.created_at>=old.created_at)) then
    raise exception using errcode='55000',message='Generated entity role requires append-only lifecycle history';
  end if;
  if new.save_id<>old.save_id or new.entity_id<>old.entity_id or new.registered_day<>old.registered_day or (new.entity_role=old.entity_role and new.role_changed_day<>old.role_changed_day) then raise exception using errcode='55000',message='Generated entity lifecycle identity is immutable'; end if;
  return new;
end $$;
create trigger world_generated_entity_lifecycle_guard before update or delete on private.world_generated_entity_lifecycle for each row execute function private.world_generated_entity_lifecycle_guard();

create function private.world_generated_entity_assert_service() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise sqlstate 'PT403' using message='World lifecycle changes require the settlement service'; end if;
end $$;
create function public.world_promote_supporting_actor(p_save_id uuid,p_entity_id uuid,p_reason text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare l private.world_generated_entity_lifecycle; v_day integer; v_count integer; v_relevance integer;
begin
  perform private.world_generated_entity_assert_service();
  select * into l from private.world_generated_entity_lifecycle where entity_id=p_entity_id and save_id=p_save_id for update;
  if not found or l.entity_role<>'supporting_actor' or not exists(select 1 from private.world_canonical_entities e where e.id=p_entity_id and e.lifecycle='active') then raise sqlstate 'PT409' using message='Only an active supporting actor can be promoted'; end if;
  select count(*) into v_count from private.world_generated_entity_lifecycle x join private.world_canonical_entities e on e.id=x.entity_id where x.save_id=p_save_id and x.entity_role='deep_npc' and e.lifecycle='active';
  if v_count>=8 then raise sqlstate 'PT409' using message='Deep NPC limit reached'; end if;
  select current_day into v_day from public.tavern_saves where id=p_save_id; v_relevance:=private.world_generated_entity_relevance(p_entity_id);
  insert into private.world_generated_entity_lifecycle_history(entity_id,save_id,event_kind,from_role,to_role,relevance,reason,day_number) values(p_entity_id,p_save_id,'promoted','supporting_actor','deep_npc',v_relevance,left(coalesce(p_reason,''),240),v_day);
  update private.world_generated_entity_lifecycle set entity_role='deep_npc',role_changed_day=v_day where entity_id=p_entity_id;
  return jsonb_build_object('status','promoted','entityId',p_entity_id,'relevance',v_relevance);
end $$;
create function public.world_demote_low_relevance_deep_npc(p_save_id uuid,p_reason text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare v_lifecycle private.world_generated_entity_lifecycle; v_day integer; v_relevance integer;
begin
  perform private.world_generated_entity_assert_service();
  select l.* into v_lifecycle from private.world_generated_entity_lifecycle l join private.world_canonical_entities e on e.id=l.entity_id where l.save_id=p_save_id and l.entity_role='deep_npc' and e.lifecycle='active' and not private.world_generated_entity_is_protected(l.entity_id) order by private.world_generated_entity_relevance(l.entity_id),e.created_at,e.id limit 1 for update of l;
  if not found then return jsonb_build_object('status','skipped','reason','no_eligible_deep_npc'); end if;
  select current_day into v_day from public.tavern_saves where id=p_save_id; v_relevance:=private.world_generated_entity_relevance(v_lifecycle.entity_id);
  insert into private.world_generated_entity_lifecycle_history(entity_id,save_id,event_kind,from_role,to_role,relevance,reason,day_number) values(v_lifecycle.entity_id,p_save_id,'demoted','deep_npc','supporting_actor',v_relevance,left(coalesce(p_reason,''),240),v_day);
  update private.world_generated_entity_lifecycle set entity_role='supporting_actor',role_changed_day=v_day where entity_id=v_lifecycle.entity_id;
  return jsonb_build_object('status','demoted','entityId',v_lifecycle.entity_id,'relevance',v_relevance);
end $$;

create table private.world_public_irreversible_warning_projections (
  warning_id uuid primary key references private.world_effect_warnings(id) on delete restrict,
  capability_id uuid not null references private.world_irreversible_capabilities(id) on delete restrict,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  target_entity_id uuid not null references private.world_canonical_entities(id) on delete restrict,
  effect_key text not null,
  visible_day integer not null,
  public_message text not null check(char_length(public_message) between 1 and 300),
  created_at timestamptz not null default clock_timestamp(),
  unique(save_id,target_entity_id,effect_key)
);
create trigger world_public_irreversible_warning_projection_append_only before update or delete on private.world_public_irreversible_warning_projections for each row execute function private.world_history_append_only();

create or replace function private.world_capability_scope_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.immutable_at is not null then raise exception using errcode='55000',message='Immutable capability cannot be rewritten'; end if;
  if (new.target_instance_id is null)=(new.target_entity_id is null) then raise exception using errcode='23514',message='Capability requires exactly one save-scoped target'; end if;
  if new.target_instance_id is not null and not exists(select 1 from private.world_npc_instances w where w.id=new.target_instance_id and w.save_id=new.save_id) then raise exception using errcode='23514',message='Capability cannot cross saves'; end if;
  if new.target_entity_id is not null and not exists(select 1 from private.world_canonical_entities e where e.id=new.target_entity_id and e.save_id=new.save_id) then raise exception using errcode='23514',message='Capability cannot cross saves'; end if;
  if new.gate_version='irreversible-gate-v2' and (not new.critic_approved or new.immutable_at is null or char_length(btrim(coalesce(new.critic_evidence_ref,'')))<8) then raise exception using errcode='23514',message='Irreversible v2 capability requires immutable critic evidence'; end if;
  return new;
end $$;
create or replace function private.world_irreversible_effect_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare cap private.world_irreversible_capabilities; warning private.world_effect_warnings; projection private.world_public_irreversible_warning_projections; v_current_day integer;
begin
  if new.capability='irreversible' and new.committed_at is not null then
    select * into cap from private.world_irreversible_capabilities where id=new.capability_id and save_id=new.save_id and target_instance_id is not distinct from new.target_instance_id and target_entity_id is not distinct from new.target_entity_id and critic_approved and immutable_at is not null;
    select * into warning from private.world_effect_warnings where id=new.warning_id and save_id=new.save_id and target_instance_id is not distinct from new.target_instance_id and target_entity_id is not distinct from new.target_entity_id;
    select current_day into v_current_day from public.tavern_saves where id=new.save_id;
    if cap.id is null or warning.id is null or v_current_day<warning.visible_day+1 then raise exception using errcode='23514',message='Irreversible effect requires approved immutable capability and a full visible warning day'; end if;
    if cap.gate_version='irreversible-gate-v2' then
      select * into projection from private.world_public_irreversible_warning_projections where warning_id=warning.id and capability_id=cap.id and save_id=new.save_id and target_entity_id=new.target_entity_id and effect_key=new.effect_key and visible_day=warning.visible_day;
      if cap.capability_key<>new.effect_key or warning.capability_id<>cap.id or new.critic_status<>'approved' or not new.public_full_day or projection.warning_id is null or v_current_day<projection.visible_day+1 or not exists(select 1 from private.world_canonical_entities e where e.id=new.target_entity_id and e.save_id=new.save_id and e.lifecycle='active') then raise exception using errcode='23514',message='Irreversible v2 effect requires exact active target capability and public warning proof'; end if;
    end if;
  end if;
  return new;
end $$;

create function public.world_irreversible_warning_status(p_save_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.tavern_saves s where s.id=p_save_id and s.user_id=auth.uid()) then raise sqlstate 'PT403' using message='That tavern is not yours'; end if;
  return jsonb_build_object('warnings',coalesce((select jsonb_agg(jsonb_build_object('effectKey',p.effect_key,'targetEntityId',p.target_entity_id,'visibleDay',p.visible_day,'message',p.public_message) order by p.visible_day,p.warning_id) from private.world_public_irreversible_warning_projections p where p.save_id=p_save_id),'[]'::jsonb));
end $$;
create function public.world_issue_irreversible_entity_warning(p_save_id uuid,p_target_entity_id uuid,p_capability_id uuid,p_public_message text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_day integer; cap private.world_irreversible_capabilities; warning private.world_effect_warnings;
begin
  perform private.world_generated_entity_assert_service();
  if char_length(btrim(coalesce(p_public_message,''))) not between 1 and 300 then raise sqlstate 'PT400' using message='Irreversible warning is malformed'; end if;
  select current_day into v_day from public.tavern_saves where id=p_save_id for update;
  if not found or not exists(select 1 from private.world_canonical_entities e where e.id=p_target_entity_id and e.save_id=p_save_id and e.origin='procedural' and e.lifecycle='active') then raise sqlstate 'PT409' using message='Irreversible warning target is not active'; end if;
  select * into cap from private.world_irreversible_capabilities where id=p_capability_id and save_id=p_save_id and target_entity_id=p_target_entity_id and capability_key='retire_entity' and gate_version='irreversible-gate-v2' and critic_approved and immutable_at is not null and char_length(btrim(coalesce(critic_evidence_ref,'')))>=8;
  if cap.id is null then raise sqlstate 'PT409' using message='Irreversible warning requires a pre-approved immutable capability'; end if;
  insert into private.world_effect_warnings(save_id,target_entity_id,capability_id,warning_key,visible_day,payload) values(p_save_id,p_target_entity_id,cap.id,'retire-'||cap.id::text,v_day,jsonb_build_object('criticEvidenceRef',cap.critic_evidence_ref,'effectKey',cap.capability_key)) returning * into warning;
  insert into private.world_public_irreversible_warning_projections(warning_id,capability_id,save_id,target_entity_id,effect_key,visible_day,public_message) values(warning.id,cap.id,p_save_id,p_target_entity_id,cap.capability_key,v_day,btrim(p_public_message));
  return jsonb_build_object('status','warning_issued','capabilityId',cap.id,'warningId',warning.id,'visibleDay',v_day);
end $$;
create function public.world_retire_generated_entity(p_save_id uuid,p_entity_id uuid,p_capability_id uuid,p_warning_id uuid,p_input_fingerprint text,p_reason text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.world_canonical_entities; l private.world_generated_entity_lifecycle; v_day integer; receipt private.world_effect_receipts;
begin
  perform private.world_generated_entity_assert_service();
  if p_input_fingerprint !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT400' using message='Retirement requires an immutable input fingerprint'; end if;
  select * into receipt from private.world_effect_receipts where save_id=p_save_id and target_entity_id=p_entity_id and effect_key='retire_entity' and input_fingerprint=p_input_fingerprint;
  if found then
    if receipt.capability_id=p_capability_id and receipt.warning_id=p_warning_id and receipt.committed_at is not null then return jsonb_build_object('status','retired','entityId',p_entity_id,'receiptId',receipt.id,'replayed',true); end if;
    raise sqlstate 'PT409' using message='Retirement fingerprint is already bound to different immutable inputs';
  end if;
  select * into e from private.world_canonical_entities where id=p_entity_id and save_id=p_save_id for update;
  select * into l from private.world_generated_entity_lifecycle where entity_id=p_entity_id and save_id=p_save_id for update;
  if e.id is null or l.entity_id is null or e.origin<>'procedural' or e.lifecycle<>'active' or private.world_generated_entity_is_protected_except_warning(p_entity_id,p_warning_id) then raise sqlstate 'PT409' using message='Generated entity is not eligible for retirement'; end if;
  select current_day into v_day from public.tavern_saves where id=p_save_id;
  insert into private.world_effect_receipts(save_id,effect_key,capability,critic_status,public_full_day,input_fingerprint,target_entity_id,capability_id,warning_id,committed_at,payload) values(p_save_id,'retire_entity','irreversible','approved',true,p_input_fingerprint,p_entity_id,p_capability_id,p_warning_id,clock_timestamp(),jsonb_build_object('reason',left(coalesce(p_reason,''),240))) returning * into receipt;
  insert into private.world_canonical_entity_history(entity_id,event_kind,payload,source_version) values(p_entity_id,'retired',jsonb_build_object('receiptId',receipt.id,'reason',left(coalesce(p_reason,''),240)),'world-lifecycle-v2');
  update private.world_canonical_entities set lifecycle='retired',retired_day=v_day,updated_at=clock_timestamp() where id=p_entity_id;
  insert into private.world_generated_entity_lifecycle_history(entity_id,save_id,event_kind,from_role,relevance,reason,day_number) values(p_entity_id,p_save_id,'retired',l.entity_role,private.world_generated_entity_relevance(p_entity_id),left(coalesce(p_reason,''),240),v_day);
  return jsonb_build_object('status','retired','entityId',p_entity_id,'receiptId',receipt.id);
end $$;

revoke all on function private.world_generated_entity_relevance(uuid),private.world_generated_entity_is_protected(uuid),private.world_generated_entity_is_protected_except_warning(uuid,uuid),private.world_generated_entity_assert_service() from public,anon,authenticated,service_role;
revoke all on function public.world_promote_supporting_actor(uuid,uuid,text),public.world_demote_low_relevance_deep_npc(uuid,text),public.world_issue_irreversible_entity_warning(uuid,uuid,uuid,text),public.world_retire_generated_entity(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.world_promote_supporting_actor(uuid,uuid,text),public.world_demote_low_relevance_deep_npc(uuid,text),public.world_issue_irreversible_entity_warning(uuid,uuid,uuid,text),public.world_retire_generated_entity(uuid,uuid,uuid,uuid,text,text) to service_role;
revoke all on function public.world_irreversible_warning_status(uuid) from public,anon;
grant execute on function public.world_irreversible_warning_status(uuid) to authenticated;
commit;
