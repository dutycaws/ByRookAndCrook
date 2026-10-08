-- Compose issue 35 projections once, retaining the existing owner-scoped reads.
begin;

alter function public.get_tavern_snapshot() rename to get_tavern_snapshot_before_prototype_progression;
alter function public.get_tavern_snapshot_before_prototype_progression() set schema private;
create function public.get_tavern_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; discovery jsonb; v_save_id uuid;
begin
  result := private.get_tavern_snapshot_before_prototype_progression();
  if result is null then return null; end if;
  select id into strict v_save_id from public.tavern_saves
    where id=(result#>>'{save,id}')::uuid and user_id=auth.uid();
  discovery := private.garden_discovery_projection(v_save_id);
  result := jsonb_set(result, '{garden,inventory}', coalesce((
    select jsonb_agg(item.value || case when item.value->>'kind'='seed' then
      jsonb_build_object('guidance', private.garden_seed_guidance(result#>>'{garden,rulesVersion}',item.value#>>'{effect,species}'))
      else '{}'::jsonb end order by item.ordinality)
    from jsonb_array_elements(result#>'{garden,inventory}') with ordinality item(value, ordinality)
  ), '[]'::jsonb));
  result := jsonb_set(result, '{garden,shop}', coalesce((
    select jsonb_agg(item.value || case when item.value->>'kind'='seed' then
      jsonb_build_object('guidance', private.garden_seed_guidance(result#>>'{garden,rulesVersion}',item.value#>>'{effect,species}'))
      else '{}'::jsonb end order by item.ordinality)
    from jsonb_array_elements(result#>'{garden,shop}') with ordinality item(value, ordinality)
  ), '[]'::jsonb));
  result := jsonb_set(result, '{cells}', coalesce((
    select jsonb_agg(cell.value || coalesce(discovery -> (cell.value->>'id'), '{}'::jsonb) order by cell.ordinality)
    from jsonb_array_elements(result->'cells') with ordinality cell(value, ordinality)
  ), '[]'::jsonb));
  return result || jsonb_build_object('trinkets', jsonb_build_object('collection', private.trinket_collection(v_save_id)));
end;
$$;

alter function public.npc_bar_snapshot() rename to npc_bar_snapshot_before_prototype_progression;
alter function public.npc_bar_snapshot_before_prototype_progression() set schema private;
create function public.npc_bar_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; v_save_id uuid;
begin
  result := private.npc_bar_snapshot_before_prototype_progression();
  if result is null then return null; end if;
  select id into strict v_save_id from public.tavern_saves
    where id=(result#>>'{save,id}')::uuid and user_id=auth.uid();
  result := jsonb_set(result, '{roster}', coalesce((
    select jsonb_agg(resident.value || private.world_npc_relationship_projection((resident.value->>'instanceId')::uuid) order by resident.ordinality)
    from jsonb_array_elements(result->'roster') with ordinality resident(value, ordinality)
  ), '[]'::jsonb));
  result := jsonb_set(result, '{recent,news}', coalesce((
    select jsonb_agg(jsonb_build_object('instanceId',event.instance_id,'questId',event.quest_id,
      'day',event.day_number,'outcome',event.outcome,'text',event.narration) order by event.day_number desc,event.created_at desc)
    from (select event.* from private.world_quest_events event
      where event.save_id=v_save_id and event.public_news
      order by event.day_number desc,event.created_at desc limit 24) event
  ), '[]'::jsonb));
  return result || jsonb_build_object('trinkets', jsonb_build_object('collection', private.trinket_collection(v_save_id)));
end;
$$;

alter function public.npc_roster(integer,uuid,text) rename to npc_roster_before_prototype_progression;
alter function public.npc_roster_before_prototype_progression(integer,uuid,text) set schema private;
create function public.npc_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result := private.npc_roster_before_prototype_progression(p_limit,p_cursor,p_query);
  return coalesce((select jsonb_agg(resident.value || private.world_npc_relationship_projection((resident.value->>'instanceId')::uuid) order by resident.ordinality)
    from jsonb_array_elements(result) with ordinality resident(value, ordinality)), '[]'::jsonb);
end;
$$;

alter function public.npc_archived_roster(integer,uuid,text) rename to npc_archived_roster_before_prototype_progression;
alter function public.npc_archived_roster_before_prototype_progression(integer,uuid,text) set schema private;
create function public.npc_archived_roster(p_limit integer default 20,p_cursor uuid default null,p_query text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result := private.npc_archived_roster_before_prototype_progression(p_limit,p_cursor,p_query);
  return coalesce((select jsonb_agg(resident.value || private.world_npc_relationship_projection((resident.value->>'instanceId')::uuid) order by resident.ordinality)
    from jsonb_array_elements(result) with ordinality resident(value, ordinality)), '[]'::jsonb);
end;
$$;

alter function public.npc_resident(uuid) rename to npc_resident_before_prototype_progression;
alter function public.npc_resident_before_prototype_progression(uuid) set schema private;
create function public.npc_resident(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result := private.npc_resident_before_prototype_progression(p_instance);
  if result is null or result->>'status' in ('dismissed','departed') then return null; end if;
  return result || private.world_npc_relationship_projection(p_instance);
end;
$$;

alter function public.npc_archived_resident(uuid) rename to npc_archived_resident_before_prototype_progression;
alter function public.npc_archived_resident_before_prototype_progression(uuid) set schema private;
create function public.npc_archived_resident(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result := private.npc_archived_resident_before_prototype_progression(p_instance);
  if result is null then return null; end if;
  return result || private.world_npc_relationship_projection(p_instance);
end;
$$;

revoke all on function private.get_tavern_snapshot_before_prototype_progression(),
  private.npc_bar_snapshot_before_prototype_progression(),
  private.npc_roster_before_prototype_progression(integer,uuid,text),
  private.npc_archived_roster_before_prototype_progression(integer,uuid,text),
  private.npc_resident_before_prototype_progression(uuid),
  private.npc_archived_resident_before_prototype_progression(uuid) from public,anon,authenticated;
revoke all on function public.get_tavern_snapshot(), public.npc_bar_snapshot(),
  public.npc_roster(integer,uuid,text), public.npc_archived_roster(integer,uuid,text),
  public.npc_resident(uuid), public.npc_archived_resident(uuid) from public,anon;
grant execute on function public.get_tavern_snapshot(), public.npc_bar_snapshot(),
  public.npc_roster(integer,uuid,text), public.npc_archived_roster(integer,uuid,text),
  public.npc_resident(uuid), public.npc_archived_resident(uuid) to authenticated;

commit;
