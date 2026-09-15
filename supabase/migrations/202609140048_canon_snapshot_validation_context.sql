-- Freeze the exact server-derived validation context the canon worker receives.
begin;

alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_canon_context_v2;
alter function public.advance_tavern_day_before_canon_context_v2(uuid,uuid,bigint) set schema private;

create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; settlement private.world_settlements; snapshot jsonb;
begin
 result:=private.advance_tavern_day_before_canon_context_v2(p_save_id,p_action_id,p_expected_revision);
 if not (result ? 'worldSettlement') then return result; end if;
 select * into settlement from private.world_settlements where id=(result#>>'{worldSettlement,settlementId}')::uuid;
 if not found then return result; end if;
 select input_snapshot->'worldSnapshot' into snapshot from private.world_settlement_jobs where settlement_id=settlement.id and job_kind='canon' and status='queued' and not exists(select 1 from private.world_settlement_attempts a where a.job_id=private.world_settlement_jobs.id);
 if snapshot is null then return result; end if;
 snapshot:=snapshot || jsonb_build_object(
   'activeGeneratedEntityCount',(select count(*) from private.world_canonical_entities entity where entity.save_id=settlement.save_id and entity.origin='procedural' and entity.lifecycle='active'),
   'existingPublicEventReuseKeys',(select coalesce(jsonb_agg(reuse_key order by reuse_key),'[]'::jsonb) from (select distinct entity.entity_key reuse_key from private.world_canonical_entities entity where entity.save_id=settlement.save_id and entity.entity_kind='world_event' and entity.origin='procedural' and entity.lifecycle='active' and entity.source_version='world-canon-event-v1' and entity.entity_key ~ '^[a-z][a-z0-9-]{1,63}$' and entity.payload->>'proposalFingerprint' ~ '^[a-f0-9]{64}$' and jsonb_typeof(entity.payload#>'{proposal,reuseKey}')='string' and entity.payload#>>'{proposal,reuseKey}'=entity.entity_key and exists(select 1 from private.world_public_discoveries discovery where discovery.canonical_entity_id=entity.id and discovery.save_id=settlement.save_id) order by entity.entity_key limit 150) reusable)
 );
 update private.world_settlement_jobs set input_snapshot=jsonb_set(input_snapshot,'{worldSnapshot}',snapshot,true),input_fingerprint=encode(extensions.digest(jsonb_set(input_snapshot,'{worldSnapshot}',snapshot,true)::text,'sha256'),'hex') where settlement_id=settlement.id and job_kind='canon' and status='queued' and not exists(select 1 from private.world_settlement_attempts a where a.job_id=private.world_settlement_jobs.id);
 return result;
end $$;

revoke all on function private.advance_tavern_day_before_canon_context_v2(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.advance_tavern_day(uuid,uuid,bigint) from public,anon;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
commit;
