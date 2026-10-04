begin;
create or replace function public.npc_memory_active_embedding_profile()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare profile private.world_npc_memory_embedding_profiles;
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate '42501' using message='Active embedding profile requires service role'; end if;
  select * into profile from private.world_npc_memory_embedding_profiles where active and invalidated_at is null;
  if not found then return jsonb_build_object('semanticAvailable',false,'profile',null); end if;
  return jsonb_build_object('semanticAvailable',true,'profile',jsonb_build_object('id',profile.id,'processorVersion',profile.processor_version,'model',profile.model,'dimensions',profile.dimensions));
end $f$;
revoke all on function public.npc_memory_active_embedding_profile() from public,anon,authenticated;
grant execute on function public.npc_memory_active_embedding_profile() to service_role;
commit;
