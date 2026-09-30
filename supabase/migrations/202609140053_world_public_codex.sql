-- Issue #17: the player-facing, owner-scoped world codex projection.
-- This is deliberately assembled from public projections, never from the
-- settlement input/output records or resident cognition tables.
begin;

-- Only this bounded, server-derived outcome makes a generated non-event
-- entity visible. The arbitrary command payload never crosses this seam.
create table private.world_procedural_public_entities (
  canonical_entity_id uuid primary key references private.world_canonical_entities(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check(day_number >= 1),
  entity_kind text not null check(entity_kind in ('npc','location','faction','item','recipe')),
  title text not null check(char_length(title) between 1 and 120),
  summary text not null check(char_length(summary) between 1 and 500),
  created_at timestamptz not null default clock_timestamp()
);
create trigger world_procedural_public_entities_append_only before update or delete
  on private.world_procedural_public_entities for each row execute function private.world_history_append_only();

create function private.world_record_procedural_public_entity()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.origin='procedural' and new.source_version='procedural-world-v1'
    and new.entity_kind in ('npc','location','faction','item','recipe')
    and new.lifecycle in ('discovered','active') then
    insert into private.world_procedural_public_entities(canonical_entity_id,save_id,day_number,entity_kind,title,summary)
    values (new.id,new.save_id,coalesce(new.discovered_day,1),new.entity_kind,
      initcap(replace(new.entity_key,'-',' ')),
      'A newly discovered ' || replace(new.entity_kind,'_',' ') || ' is now part of the world record.')
    on conflict (canonical_entity_id) do nothing;
  end if;
  return new;
end $function$;
create trigger world_record_procedural_public_entity after insert on private.world_canonical_entities
  for each row execute function private.world_record_procedural_public_entity();

insert into private.world_procedural_public_entities(canonical_entity_id,save_id,day_number,entity_kind,title,summary)
select entity.id,entity.save_id,coalesce(entity.discovered_day,1),entity.entity_kind,
  initcap(replace(entity.entity_key,'-',' ')),
  'A newly discovered ' || replace(entity.entity_kind,'_',' ') || ' is now part of the world record.'
from private.world_canonical_entities entity
where entity.origin='procedural' and entity.source_version='procedural-world-v1'
  and entity.entity_kind in ('npc','location','faction','item','recipe')
  and entity.lifecycle in ('discovered','active')
on conflict (canonical_entity_id) do nothing;

create or replace function public.world_public_codex(p_save_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
  if not exists (
    select 1 from public.tavern_saves save
    where save.id = p_save_id and save.user_id = auth.uid()
  ) then
    raise sqlstate 'PT404' using message = 'Tavern codex not found';
  end if;

  select jsonb_build_object(
    'version', 'world-public-codex-v1',
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', discovered.id,
        'kind', discovered.entity_kind,
        'title', discovered.title,
        'summary', discovered.summary,
        'day', discovered.day_number,
        'provenance', jsonb_build_object('kind', discovered.provenance_kind, 'day', discovered.day_number)
      ) order by discovered.entity_kind, discovered.title, discovered.id)
      from (
        select * from (
          select distinct on (entity.id)
            entity.id, entity.entity_kind, discovery.title, discovery.summary, discovery.day_number, 'canonical_discovery'::text as provenance_kind
          from private.world_public_discoveries discovery
          join private.world_canonical_entities entity on entity.id = discovery.canonical_entity_id
          where discovery.save_id = p_save_id
            and entity.save_id = p_save_id
            and entity.lifecycle in ('discovered', 'active')
          order by entity.id, discovery.day_number desc, discovery.created_at desc
        ) canonical_discovery
        union all
        select entity.id,entity.entity_kind,outcome.title,outcome.summary,outcome.day_number,'procedural_entity_outcome'::text
        from private.world_procedural_public_entities outcome
        join private.world_canonical_entities entity on entity.id=outcome.canonical_entity_id
        where outcome.save_id=p_save_id and entity.save_id=p_save_id
          and entity.lifecycle in ('discovered','active')
          and not exists (
            select 1 from private.world_public_discoveries discovery
            where discovery.save_id=p_save_id and discovery.canonical_entity_id=entity.id
          )
        order by day_number desc, title, id
        limit 150
      ) discovered
    ), '[]'::jsonb),
    'publicEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.canonical_entity_id,
        'templateKey', event.template_key,
        'title', event.title,
        'summary', event.summary,
        'day', event.day_number,
        'provenance', jsonb_build_object('kind', 'procedural_public_event', 'day', event.day_number)
      ) order by event.day_number desc, event.created_at desc, event.canonical_entity_id)
      from (
        select event.*
        from private.world_procedural_public_events event
        where event.save_id = p_save_id
        order by event.day_number desc, event.created_at desc
        limit 60
      ) event
    ), '[]'::jsonb),
    'dispositions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'instanceId', disposition.instance_id,
        'name', disposition.name,
        'title', disposition.title,
        'state', disposition.state,
        'summary', disposition.summary,
        'day', disposition.day_number,
        'provenance', jsonb_build_object('kind', 'resident_evolution', 'day', disposition.day_number, 'profileRevision', disposition.profile_revision)
      ) order by disposition.day_number desc, disposition.created_at desc, disposition.instance_id)
      from (
        select * from (
          select distinct on (entry.instance_id) entry.instance_id,
            coalesce(nullif(btrim(profile.public_disposition->>'name'), ''), 'A resident') as name,
            nullif(btrim(profile.public_disposition->>'title'), '') as title,
            entry.disposition->>'state' as state,
            entry.disposition->>'summary' as summary,
            entry.day_number, entry.profile_revision, entry.created_at
          from private.resident_evolution_entries entry
          join private.world_resident_profiles profile on profile.instance_id = entry.instance_id
          where entry.save_id = p_save_id
            and profile.save_id = p_save_id
            and entry.disposition->>'version' = 'resident-disposition-v1'
            and char_length(btrim(coalesce(entry.disposition->>'state', ''))) between 1 and 48
            and char_length(btrim(coalesce(entry.disposition->>'summary', ''))) between 1 and 240
          order by entry.instance_id, entry.day_number desc, entry.created_at desc, entry.job_id desc
        ) latest_disposition
        order by day_number desc, created_at desc, instance_id
        limit 60
      ) disposition
    ), '[]'::jsonb)
  ) into result;
  return result;
end $function$;

revoke all on function public.world_public_codex(uuid) from public, anon;
grant execute on function public.world_public_codex(uuid) to authenticated;
revoke all on private.world_procedural_public_entities from public, anon, authenticated, service_role;
revoke all on function private.world_record_procedural_public_entity() from public, anon, authenticated, service_role;

commit;
