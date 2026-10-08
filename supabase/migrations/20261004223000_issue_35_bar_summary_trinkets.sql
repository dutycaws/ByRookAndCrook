begin;

-- The game Bar uses npc_bar_summary rather than the legacy full snapshot.
-- Preserve its bounded projection and add the save-owner's keepsake collection.
alter function public.npc_bar_summary() rename to npc_bar_summary_before_issue35_trinkets;
alter function public.npc_bar_summary_before_issue35_trinkets() set schema private;

create function public.npc_bar_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  save_id uuid;
begin
  result := private.npc_bar_summary_before_issue35_trinkets();
  if result is null then
    return null;
  end if;

  save_id := nullif(result #>> '{save,id}', '')::uuid;
  if save_id is null then
    return result || jsonb_build_object('trinkets', jsonb_build_object('collection', '[]'::jsonb));
  end if;

  return result || jsonb_build_object(
    'trinkets', jsonb_build_object('collection', private.trinket_collection(save_id))
  );
end;
$function$;

revoke all on function private.npc_bar_summary_before_issue35_trinkets()
  from public, anon, authenticated, service_role;
revoke all on function public.npc_bar_summary() from public, anon;
grant execute on function public.npc_bar_summary() to authenticated;

commit;
