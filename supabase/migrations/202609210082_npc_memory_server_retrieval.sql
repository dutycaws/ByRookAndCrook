-- Service workers use a service-role connection and must provide the player
-- identity explicitly; auth.uid() is the service account in that context.
begin;

create function public.npc_memory_retrieve_for_actor(
  p_actor uuid,
  p_instance_id uuid,
  p_query text default '',
  p_limit integer default 12,
  p_cutoff_sequence bigint default null,
  p_view text default 'speech'
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise sqlstate '42501' using message='Server memory retrieval requires service role';
  end if;
  return private.world_npc_memory_retrieve(p_actor,p_instance_id,p_query,p_limit,p_cutoff_sequence,p_view);
end $function$;

revoke all on function public.npc_memory_retrieve_for_actor(uuid,uuid,text,integer,bigint,text) from public,anon,authenticated;
grant execute on function public.npc_memory_retrieve_for_actor(uuid,uuid,text,integer,bigint,text) to service_role;

commit;
