begin;
-- Keep existing snapshot consumers on the same canonical stock projection.
alter function public.npc_bar_snapshot() rename to npc_bar_snapshot_before_issue37;
alter function public.npc_bar_snapshot_before_issue37() set schema private;
create function public.npc_bar_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; summary jsonb;
begin
 result:=private.npc_bar_snapshot_before_issue37(); if result is null then return null; end if;
 summary:=public.npc_bar_summary();
 return jsonb_set(result,'{offerings}',summary->'offerings');
end $f$;
revoke all on function private.npc_bar_snapshot_before_issue37() from public,anon,authenticated,service_role;
revoke all on function public.npc_bar_snapshot() from public,anon;
grant execute on function public.npc_bar_snapshot() to authenticated;
create or replace function public.codex_reports_ack(p_report_ids text[],p_read boolean default true) returns void
language plpgsql security definer set search_path='' as $f$
declare v_save uuid;
begin
 if auth.uid() is null then raise sqlstate 'PT401'; end if;
 if p_report_ids is null or cardinality(p_report_ids)>100 then raise sqlstate 'PT400'; end if;
 select id into v_save from public.tavern_saves where user_id=auth.uid();
 if v_save is null then raise sqlstate 'PT404'; end if;
 insert into private.codex_report_reads(save_id,report_id,notified_at,read_at)
 select v_save,report->>'id',now(),case when p_read then now() end
 from jsonb_array_elements(private.tavern_reports(v_save)) report where report->>'id'=any(p_report_ids)
 on conflict(save_id,report_id) do update set notified_at=coalesce(codex_report_reads.notified_at,excluded.notified_at),read_at=coalesce(codex_report_reads.read_at,excluded.read_at);
end $f$;

commit;
