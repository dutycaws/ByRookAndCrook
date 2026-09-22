-- Issue #33: authoritative producers only; no provider/model work occurs here.
begin;
create function private.world_npc_memory_quest_closure_producer() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if new.outcome in ('succeeded','failed','abandoned') then perform private.world_npc_memory_request_quest(new.id); end if;
 return new;
end $f$;
drop trigger if exists world_npc_memory_quest_source_closure on private.world_quest_events;
create trigger world_npc_memory_quest_source_closure after insert on private.world_quest_events for each row execute function private.world_npc_memory_quest_closure_producer();
create function private.world_npc_memory_settlement_closure_producer() returns trigger language plpgsql security definer set search_path='' as $f$
declare item record; cutoff bigint; affected uuid[]:='{}'; instance uuid;
begin
 -- This terminal transaction creates DB-owned requests and may register an
 -- already-contiguous local set/outbox job.  It never calls a provider/model;
 -- registration failures are isolated so authoritative settlement state stands.
 if new.status in ('completed','failed','expired') and old.status is distinct from new.status then
   for item in select distinct instance_id from private.world_npc_memory_sources where save_id=new.save_id and occurred_day=new.day_number order by instance_id loop
     select max(ledger_sequence) into cutoff from private.world_npc_memory_sources where instance_id=item.instance_id and occurred_day<=new.day_number;
     if cutoff is not null then perform private.world_npc_memory_request_episode(item.instance_id,new.day_number,cutoff); affected:=array_append(affected,item.instance_id); end if;
   end loop;
   foreach instance in array(coalesce(array(select distinct unnest(affected) order by 1),'{}'::uuid[])) loop
     begin perform private.world_npc_memory_schedule_closures(instance); exception when others then null; end;
   end loop;
 end if; return new;
end $f$;
drop trigger if exists world_npc_memory_settlement_closure on private.world_settlements;
create trigger world_npc_memory_settlement_closure after update of status on private.world_settlements for each row execute function private.world_npc_memory_settlement_closure_producer();
create function private.world_npc_memory_backfill_closures() returns integer language plpgsql security definer set search_path='' as $f$
declare e record; d record; cutoff bigint; instance uuid; affected uuid[]:='{}'; made integer:=0;
begin
 for e in select qe.id,qe.instance_id from private.world_quest_events qe join private.world_npc_memory_sources x on x.source_kind='quest_event' and x.source_id=qe.id and x.source_version=1 where qe.outcome in ('succeeded','failed','abandoned') order by qe.created_at,qe.id loop
   perform private.world_npc_memory_request_quest(e.id); affected:=array_append(affected,e.instance_id);
 end loop;
 -- The cutoff is the ledger through the closed day, not merely the greatest
 -- row stamped with that day: historical projection order need not match day.
 for d in select days.save_id,days.instance_id,days.occurred_day,cutoff.ledger_sequence cutoff
   from (select distinct x.save_id,x.instance_id,x.occurred_day from private.world_npc_memory_sources x) days
   join public.tavern_saves s on s.id=days.save_id
   cross join lateral (select max(x.ledger_sequence) ledger_sequence from private.world_npc_memory_sources x where x.instance_id=days.instance_id and x.occurred_day<=days.occurred_day) cutoff
   where days.occurred_day<s.current_day
   order by days.save_id,days.instance_id,days.occurred_day loop
   perform private.world_npc_memory_request_episode(d.instance_id,d.occurred_day,d.cutoff); affected:=array_append(affected,d.instance_id);
 end loop;
 foreach instance in array(coalesce(array(select distinct unnest(affected) order by 1),'{}'::uuid[])) loop made:=made+private.world_npc_memory_schedule_closures(instance); end loop;
 return made;
end $f$;
select private.world_npc_memory_backfill_closures();
revoke all on function private.world_npc_memory_quest_closure_producer(),private.world_npc_memory_settlement_closure_producer(),private.world_npc_memory_backfill_closures() from public,anon,authenticated,service_role;
commit;
