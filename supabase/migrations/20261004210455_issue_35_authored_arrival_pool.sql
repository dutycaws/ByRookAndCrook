-- Include every available published authored package in later-day arrivals.
-- Existing residents and tombstoned identities remain excluded; no return visits.
begin;

create or replace function private.maybe_arrive_world_npc(p_save uuid,p_day integer,p_action uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_count integer; v_draw integer; v_selected_npc uuid; v_selected_version uuid; v_rating boolean; v_capacity integer; v_result jsonb; v_materialized record;
begin
  if exists(select 1 from private.world_npc_arrival_receipts where save_id=p_save and day=p_day) then
    return (select result from private.world_npc_arrival_receipts where save_id=p_save and day=p_day);
  end if;
  select count(*) into v_capacity from private.world_npc_instances where save_id=p_save and status in ('active','between','settled','failed','abandoned');
  if v_capacity >= private.world_capacity(p_save) then
    v_result:=jsonb_build_object('arrived',false,'reason','capacity');
    insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,result) values(p_save,p_day,p_action,0,v_result);
    return v_result;
  end if;
  select mature_content_enabled and adult_attested_at is not null into v_rating
  from public.player_profiles profile join public.tavern_saves save on save.user_id=profile.user_id where save.id=p_save;
  with eligible as (
    select i.id,i.current_published_version_id
    from private.npc_identities i
    join private.npc_version_resident_packages p on p.npc_id=i.id and p.version_id=i.current_published_version_id
      and p.source_kind=i.origin and p.source_kind in ('first_party','community') and p.save_id is null
    where i.origin in ('first_party','community') and i.status='published'
      and (i.rating='standard' or coalesce(v_rating,false))
      and not exists(select 1 from private.world_npc_instances w where w.save_id=p_save and w.npc_id=i.id)
      and not exists(select 1 from private.world_npc_tombstones t where t.save_id=p_save and t.npc_id=i.id)
  ) select count(*) into v_count from eligible;
  if v_count > 0 then
    v_draw:=floor(random()*v_count)::integer;
    with eligible as (
      select i.id,i.current_published_version_id,row_number() over(order by i.id)-1 as rn
      from private.npc_identities i
      join private.npc_version_resident_packages p on p.npc_id=i.id and p.version_id=i.current_published_version_id
        and p.source_kind=i.origin and p.source_kind in ('first_party','community') and p.save_id is null
      where i.origin in ('first_party','community') and i.status='published'
        and (i.rating='standard' or coalesce(v_rating,false))
        and not exists(select 1 from private.world_npc_instances w where w.save_id=p_save and w.npc_id=i.id)
        and not exists(select 1 from private.world_npc_tombstones t where t.save_id=p_save and t.npc_id=i.id)
    ) select id,current_published_version_id into strict v_selected_npc,v_selected_version from eligible where rn=v_draw;
    select * into v_materialized from private.world_materialize_resident_from_version(p_save,v_selected_npc,v_selected_version,p_day);
    if not found then raise sqlstate 'PT409' using message='Selected authored NPC lacks its current immutable package'; end if;
    v_result:=jsonb_build_object('arrived',true,'npcId',v_selected_npc,'versionId',v_selected_version);
  else
    v_result:=jsonb_build_object('arrived',false,'reason','no_eligible');
  end if;
  insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,draw,selected_npc_id,selected_version_id,result)
    values(p_save,p_day,p_action,v_count,v_draw,v_selected_npc,v_selected_version,v_result);
  return v_result;
end $f$;

commit;
