begin;
-- Gate 49 adds exactly one private, attributable encounter after Gate 48's day close.
alter table private.world_settlement_jobs drop constraint world_settlement_jobs_job_kind_check;
alter table private.world_settlement_jobs add constraint world_settlement_jobs_job_kind_check check(job_kind in ('snapshot','canon','resident','quest','effects','news','finalize','social_encounter'));

create table private.world_social_encounter_templates(template_key text primary key check(template_key in ('road-rumor','trade-offer','lost-supply','faction-request')));
insert into private.world_social_encounter_templates values ('road-rumor'),('trade-offer'),('lost-supply'),('faction-request');
create table private.world_social_encounters (
 job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
 settlement_id uuid not null unique references private.world_settlements(id) on delete cascade,
 save_id uuid not null references public.tavern_saves(id) on delete cascade, day_number integer not null check(day_number>=0),
 first_instance_id uuid not null references private.world_npc_instances(id), second_instance_id uuid not null references private.world_npc_instances(id),
 context jsonb not null, context_fingerprint text not null check(context_fingerprint~'^[a-f0-9]{64}$'),
 status text not null default 'queued' check(status in ('queued','completed','skipped')), private_intents jsonb, private_exchange_summary text,
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 check(first_instance_id<second_instance_id), check(jsonb_typeof(context)='object'), check(private_intents is null or jsonb_typeof(private_intents)='array')
);
create table private.world_social_encounter_receipts (
 job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
 proposal_fingerprint text not null check(proposal_fingerprint~'^[a-f0-9]{64}$'), canonical_proposal text not null,
 result jsonb not null check(jsonb_typeof(result)='object'), created_at timestamptz not null default clock_timestamp()
);
create trigger world_social_encounter_receipts_append_only before update or delete on private.world_social_encounter_receipts for each row execute function private.world_history_append_only();
create function private.world_social_encounter_scope_guard() returns trigger language plpgsql set search_path='' as $$
declare j private.world_settlement_jobs; s private.world_settlements;
begin
 select * into j from private.world_settlement_jobs where id=new.job_id; select * into s from private.world_settlements where id=new.settlement_id;
 if j.id is null or s.id is null or j.settlement_id<>new.settlement_id or j.job_kind<>'social_encounter' or j.subject_instance_id is not null or s.save_id<>new.save_id or s.day_number<>new.day_number or new.first_instance_id>=new.second_instance_id
  or not exists(select 1 from private.world_npc_instances i join private.world_resident_profiles p on p.instance_id=i.id join private.world_resident_evolution_pins pin on pin.instance_id=i.id where i.id=new.first_instance_id and i.save_id=new.save_id and p.save_id=new.save_id and pin.save_id=new.save_id and i.status='active' and p.profile_schema_version<>'resident-profile-compat-v1')
  or not exists(select 1 from private.world_npc_instances i join private.world_resident_profiles p on p.instance_id=i.id join private.world_resident_evolution_pins pin on pin.instance_id=i.id where i.id=new.second_instance_id and i.save_id=new.save_id and p.save_id=new.save_id and pin.save_id=new.save_id and i.status='active' and p.profile_schema_version<>'resident-profile-compat-v1') then raise exception using errcode='23514',message='Social encounter must match its ordered active pinned settlement pair'; end if;
 return new;
end $$;
create trigger world_social_encounter_scope before insert or update on private.world_social_encounters for each row execute function private.world_social_encounter_scope_guard();
create function private.world_social_encounter_terminal_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.job_kind='social_encounter' and new.status in ('completed','failed','skipped') and not exists(select 1 from private.world_social_encounter_receipts r where r.job_id=new.id) then
   update private.world_social_encounters set status='skipped',completed_at=clock_timestamp() where job_id=new.id and status='queued';
 end if;
 return new;
end $$;
create trigger world_social_encounter_terminal_guard after update of status on private.world_settlement_jobs for each row execute function private.world_social_encounter_terminal_guard();

create function private.world_social_encounter_resident(p_save_id uuid,p_instance_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('residentId',i.id,'npcId',p.npc_id,'profileRevision',p.profile_revision,'profile',p.current_profile,
  'beliefs',coalesce((select jsonb_agg(value order by id) from (select b.id,jsonb_build_object('id',b.id,'subjectEntityId',b.subject_key,'content',b.statement,'confidence',b.confidence,'provenance',b.provenance_chain,'originalClaimFingerprint',b.original_claim_fingerprint,'contradictionStatus',case b.contradiction_status when 'none' then 'uncontested' when 'retracted' then 'contradicted' else b.contradiction_status end,'state','active') value from private.world_resident_beliefs b where b.instance_id=i.id and b.active and b.original_claim_fingerprint~'^[a-f0-9]{64}$' and jsonb_typeof(b.provenance_chain)='array' and jsonb_array_length(b.provenance_chain)<=8 order by b.id limit 64) q),'[]'::jsonb),
  'edges',coalesce((select jsonb_agg(value order by npc_id) from (select target.npc_id,jsonb_build_object('subjectNpcId',p.npc_id,'objectEntityId',target.npc_id,'axes',jsonb_build_object('trust',e.trust,'affection',e.affection,'respect',e.respect,'fear',e.fear,'obligation',e.obligation)) value from private.world_social_edges e join private.world_resident_profiles target on target.instance_id=e.to_instance_id and target.save_id=p_save_id where e.save_id=p_save_id and e.from_instance_id=i.id order by target.npc_id limit 64) q),'[]'::jsonb),
  'capability',pin.capability)
 from private.world_npc_instances i join private.world_resident_profiles p on p.instance_id=i.id and p.save_id=p_save_id join private.world_resident_evolution_pins pin on pin.instance_id=i.id and pin.save_id=p_save_id where i.id=p_instance_id and i.save_id=p_save_id
$$;
create function private.world_social_text(p jsonb,n integer) returns boolean language sql immutable strict set search_path='' as $$ select jsonb_typeof(p)='string' and char_length(btrim(p#>>'{}')) between 1 and n $$;
create function private.world_social_pair(p jsonb,a uuid,b uuid) returns boolean language sql immutable strict set search_path='' as $$ select jsonb_typeof(p)='array' and jsonb_array_length(p)=2 and p->>0=a::text and p->>1=b::text $$;

alter function public.advance_tavern_day(uuid,uuid,bigint) rename to advance_tavern_day_before_social_encounter_v1;
alter function public.advance_tavern_day_before_social_encounter_v1(uuid,uuid,bigint) set schema private;
create function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; s private.world_settlements; pair record; context jsonb; job_id uuid; ord smallint;
begin
 r:=private.advance_tavern_day_before_social_encounter_v1(p_save_id,p_action_id,p_expected_revision);
 if not (r?'worldSettlement') then return r; end if;
 select * into s from private.world_settlements where id=(r#>>'{worldSettlement,settlementId}')::uuid;
 if not found or exists(select 1 from private.world_social_encounters where settlement_id=s.id) or exists(select 1 from private.world_settlement_attempts a join private.world_settlement_jobs j on j.id=a.job_id where j.settlement_id=s.id) then return r; end if;
 select a.id first_id,b.id second_id into pair from private.world_npc_instances a join private.world_npc_instances b on a.id<b.id join private.world_resident_profiles ap on ap.instance_id=a.id and ap.save_id=s.save_id and ap.profile_schema_version<>'resident-profile-compat-v1' join private.world_resident_profiles bp on bp.instance_id=b.id and bp.save_id=s.save_id and bp.profile_schema_version<>'resident-profile-compat-v1' join private.world_resident_evolution_pins ax on ax.instance_id=a.id and ax.save_id=s.save_id join private.world_resident_evolution_pins bx on bx.instance_id=b.id and bx.save_id=s.save_id where a.save_id=s.save_id and b.save_id=s.save_id and a.status='active' and b.status='active' and exists(select 1 from jsonb_array_elements(private.world_day_close_evidence(s.save_id,a.id,s.day_number))) order by a.id,b.id limit 1;
 if pair.first_id is null then return r; end if;
 select jsonb_build_object('version','social-encounter-v1','templateKey',(select template_key from private.world_social_encounter_templates order by template_key limit 1),'participantResidentIds',jsonb_build_array(pair.first_id,pair.second_id),'publicCanon',jsonb_build_object('currentDay',s.day_number+1,'entityKinds',coalesce((select input_snapshot#>'{worldSnapshot,entityKinds}' from private.world_settlement_jobs where settlement_id=s.id and job_kind='canon'),'{}'::jsonb)),'authorizedEvidence',(select jsonb_agg(jsonb_build_object('id',e->>'id','kind',e->>'kind','sourceFingerprint',e->>'sourceFingerprint','summary',btrim(e->>'summary')) order by e->>'id') from jsonb_array_elements(private.world_day_close_evidence(s.save_id,pair.first_id,s.day_number)) e),'participants',jsonb_build_array(private.world_social_encounter_resident(s.save_id,pair.first_id),private.world_social_encounter_resident(s.save_id,pair.second_id))) into context;
 if context is null or jsonb_array_length(context->'authorizedEvidence') not between 1 and 64 or context->'participants'->0 is null or context->'participants'->1 is null then return r; end if;
 select coalesce(max(ordinal),0)::smallint+1 into ord from private.world_settlement_jobs where settlement_id=s.id;
 if ord>64 then return r; end if;
 insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint,input_snapshot,input_version) values(s.id,ord,'social_encounter',encode(extensions.digest(private.world_canonical_json(context),'sha256'),'hex'),context,'social-encounter-v1') returning id into job_id;
 insert into private.world_social_encounters(job_id,settlement_id,save_id,day_number,first_instance_id,second_instance_id,context,context_fingerprint) values(job_id,s.id,s.save_id,s.day_number,pair.first_id,pair.second_id,context,encode(extensions.digest(private.world_canonical_json(context),'sha256'),'hex'));
 return r;
end $$;

create function public.world_settlement_commit_social_encounter(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.world_settlements; j private.world_settlement_jobs; e private.world_social_encounters; old private.world_social_encounter_receipts; canon text; fp text; i jsonb; effect jsonb; gossip jsonb; source_id uuid; recipient_id uuid; b private.world_resident_beliefs; out jsonb; new_fp text;
begin
 perform private.world_settlement_assert_service();
 if not exists(select 1 from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id) then raise sqlstate 'PT409' using message='Settlement job mismatch'; end if;
 canon:=private.world_canonical_json(p_proposal); fp:=encode(extensions.digest(canon,'sha256'),'hex');
 select * into old from private.world_social_encounter_receipts where job_id=p_job_id;
 if found then if old.proposal_fingerprint=fp then return old.result; end if; raise sqlstate 'PT409' using message='Social encounter already has a different proposal'; end if;
 select * into s from private.world_settlements where id=p_settlement_id for update;
 select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id and job_kind='social_encounter' and status='processing' for update;
 select * into e from private.world_social_encounters where job_id=p_job_id and settlement_id=p_settlement_id for update;
 if not found or s.status<>'processing' or s.fence<>p_fence or s.deadline_at<=clock_timestamp() or s.lease_until<=clock_timestamp() or not exists(select 1 from private.world_settlement_attempts a where a.job_id=p_job_id and a.fence=p_fence and a.status='processing' and a.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Stale settlement fence'; end if;
 if octet_length(p_proposal::text)>12000 or not private.world_json_keys_exact(p_proposal,array['causalExplanation','evidenceIds','gossipBeliefAdditions','participantResidentIds','privateCommunicativeIntents','privateExchangeSummary','publicSummary','relationshipEffects','templateKey','version'])
  or p_proposal->>'version'<>'social-encounter-v1' or p_proposal->>'templateKey'<>e.context->>'templateKey' or not private.world_social_pair(p_proposal->'participantResidentIds',e.first_instance_id,e.second_instance_id)
  or not private.world_social_text(p_proposal->'privateExchangeSummary',1000) or not private.world_social_text(p_proposal->'causalExplanation',1000)
  or jsonb_typeof(p_proposal->'publicSummary') not in ('null','string') or (jsonb_typeof(p_proposal->'publicSummary')='string' and not private.world_social_text(p_proposal->'publicSummary',500))
  or jsonb_typeof(p_proposal->'privateCommunicativeIntents')<>'array' or jsonb_array_length(p_proposal->'privateCommunicativeIntents')>2
  or jsonb_typeof(p_proposal->'evidenceIds')<>'array' or jsonb_array_length(p_proposal->'evidenceIds') not between 1 and 8
  or jsonb_typeof(p_proposal->'relationshipEffects')<>'array' or jsonb_array_length(p_proposal->'relationshipEffects')>4
  or jsonb_typeof(p_proposal->'gossipBeliefAdditions')<>'array' or jsonb_array_length(p_proposal->'gossipBeliefAdditions')>2
  or not exists(select 1 from private.world_social_encounter_templates where template_key=p_proposal->>'templateKey') then raise sqlstate 'PT400' using message='Social proposal violates the exact contract shape'; end if;
 if (select count(*) from jsonb_array_elements_text(p_proposal->'evidenceIds'))<>(select count(distinct x) from jsonb_array_elements_text(p_proposal->'evidenceIds') x) or exists(select 1 from jsonb_array_elements_text(p_proposal->'evidenceIds') x where not exists(select 1 from jsonb_array_elements(e.context->'authorizedEvidence') z where z->>'id'=x)) then raise sqlstate 'PT400' using message='Social evidence is not frozen and attributable'; end if;
 if (select count(*) from jsonb_array_elements(p_proposal->'privateCommunicativeIntents'))<>(select count(distinct (x->>'speakerResidentId')||':'||(x->>'recipientResidentId')) from jsonb_array_elements(p_proposal->'privateCommunicativeIntents') x)
  or (select count(*) from jsonb_array_elements(p_proposal->'relationshipEffects'))<>(select count(distinct (x->>'recipientResidentId')||':'||(x->>'sourceResidentId')||':'||(x->>'axis')) from jsonb_array_elements(p_proposal->'relationshipEffects') x)
  or (select count(*) from jsonb_array_elements(p_proposal->'gossipBeliefAdditions'))<>(select count(distinct (x->>'recipientResidentId')||':'||(x->>'sourceBeliefId')) from jsonb_array_elements(p_proposal->'gossipBeliefAdditions') x) then raise sqlstate 'PT400' using message='Social proposal contains duplicate directed operations'; end if;
 if not exists(select 1 from private.world_resident_profiles p where p.instance_id=e.first_instance_id and p.save_id=s.save_id and p.profile_revision=(e.context#>>'{participants,0,profileRevision}')::bigint and p.current_profile=e.context#>'{participants,0,profile}')
  or not exists(select 1 from private.world_resident_profiles p where p.instance_id=e.second_instance_id and p.save_id=s.save_id and p.profile_revision=(e.context#>>'{participants,1,profileRevision}')::bigint and p.current_profile=e.context#>'{participants,1,profile}')
  or not exists(select 1 from private.world_npc_instances where id=e.first_instance_id and save_id=s.save_id and status='active')
  or not exists(select 1 from private.world_npc_instances where id=e.second_instance_id and save_id=s.save_id and status='active')
  or not exists(select 1 from private.world_resident_evolution_pins pin where pin.instance_id=e.first_instance_id and pin.save_id=s.save_id and pin.capability=e.context#>'{participants,0,capability}')
  or not exists(select 1 from private.world_resident_evolution_pins pin where pin.instance_id=e.second_instance_id and pin.save_id=s.save_id and pin.capability=e.context#>'{participants,1,capability}') then raise sqlstate 'PT409' using message='Frozen participants are stale'; end if;
 for i in select value from jsonb_array_elements(p_proposal->'privateCommunicativeIntents') loop
  if not private.world_json_keys_exact(i,array['message','mode','recipientResidentId','speakerResidentId']) or not private.world_social_text(i->'message',500) or i->>'mode' not in ('honest','withhold','misdirect','fabricate') then raise sqlstate 'PT400' using message='Invalid private intent'; end if;
  begin source_id:=(i->>'speakerResidentId')::uuid; recipient_id:=(i->>'recipientResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
  if source_id=recipient_id or source_id not in(e.first_instance_id,e.second_instance_id) or recipient_id not in(e.first_instance_id,e.second_instance_id)
   or (i->>'mode'='withhold' and not ((case when source_id=e.first_instance_id then e.context#>'{participants,0,capability,socialCapabilities}' else e.context#>'{participants,1,capability,socialCapabilities}' end)?'conceal'))
   or (i->>'mode'='misdirect' and not ((case when source_id=e.first_instance_id then e.context#>'{participants,0,capability,socialCapabilities}' else e.context#>'{participants,1,capability,socialCapabilities}' end)?'misdirect'))
   or (i->>'mode'='fabricate' and not ((case when source_id=e.first_instance_id then e.context#>'{participants,0,capability,socialCapabilities}' else e.context#>'{participants,1,capability,socialCapabilities}' end)?'deceive')) then raise sqlstate 'PT400' using message='Private intent lacks frozen capability'; end if;
 end loop;
 for effect in select value from jsonb_array_elements(p_proposal->'relationshipEffects') loop
  if not private.world_json_keys_exact(effect,array['axis','delta','recipientResidentId','sourceResidentId']) or effect->>'axis' not in ('trust','affection','respect','fear','obligation') or jsonb_typeof(effect->'delta')<>'number' or (effect->>'delta')::numeric<>trunc((effect->>'delta')::numeric) or (effect->>'delta')::integer not between -4 and 4 or (effect->>'delta')::integer=0 then raise sqlstate 'PT400' using message='Invalid directed relationship effect'; end if;
  begin recipient_id:=(effect->>'recipientResidentId')::uuid; source_id:=(effect->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
  if recipient_id=source_id or recipient_id not in(e.first_instance_id,e.second_instance_id) or source_id not in(e.first_instance_id,e.second_instance_id) or not exists(select 1 from jsonb_array_elements(e.context->'participants') p cross join jsonb_array_elements(p->'edges') edge where p->>'residentId'=recipient_id::text and edge->>'subjectNpcId'=p->>'npcId' and edge->>'objectEntityId'=(select npc_id::text from private.world_resident_profiles where instance_id=source_id)) then raise sqlstate 'PT400' using message='Relationship effect is not a frozen directed edge'; end if;
  execute format('update private.world_social_edges set %I=greatest(-100,least(100,%I+$1)),updated_at=clock_timestamp() where save_id=$2 and from_instance_id=$3 and to_instance_id=$4',effect->>'axis',effect->>'axis') using (effect->>'delta')::integer,s.save_id,recipient_id,source_id;
  if not found then raise sqlstate 'PT409' using message='Frozen directed edge is no longer current'; end if;
 end loop;
 for gossip in select value from jsonb_array_elements(p_proposal->'gossipBeliefAdditions') loop
  if not private.world_json_keys_exact(gossip,array['confidence','content','originalClaimFingerprint','provenance','recipientResidentId','sourceBeliefId','sourceEvidenceId','sourceResidentId']) or jsonb_typeof(gossip->'confidence')<>'number' or (gossip->>'confidence')::numeric<>trunc((gossip->>'confidence')::numeric) or (gossip->>'confidence')::integer not between 0 and 100 or not private.world_social_text(gossip->'content',1000) or gossip->>'originalClaimFingerprint' !~ '^[a-f0-9]{64}$' or jsonb_typeof(gossip->'provenance')<>'array' or jsonb_array_length(gossip->'provenance') not between 1 and 8 or jsonb_typeof(gossip->'sourceBeliefId')<>'string' or gossip->>'sourceBeliefId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or jsonb_typeof(gossip->'sourceEvidenceId')<>'string' or not private.world_social_text(gossip->'sourceEvidenceId',128) then raise sqlstate 'PT400' using message='Invalid gossip addition'; end if;
  begin recipient_id:=(gossip->>'recipientResidentId')::uuid; source_id:=(gossip->>'sourceResidentId')::uuid; exception when invalid_text_representation then raise sqlstate 'PT400'; end;
  if recipient_id=source_id or recipient_id not in(e.first_instance_id,e.second_instance_id) or source_id not in(e.first_instance_id,e.second_instance_id) or not ((case when source_id=e.first_instance_id then e.context#>'{participants,0,capability,socialCapabilities}' else e.context#>'{participants,1,capability,socialCapabilities}' end)?'share_gossip') then raise sqlstate 'PT400' using message='Gossip source lacks frozen sharing capability'; end if;
  select * into b from private.world_resident_beliefs where id=(gossip->>'sourceBeliefId')::uuid and instance_id=source_id and active for update;
  if not found or not exists(select 1 from jsonb_array_elements(e.context->'participants') p cross join jsonb_array_elements(p->'beliefs') frozen where p->>'residentId'=source_id::text and frozen->>'id'=gossip->>'sourceBeliefId' and frozen->>'content'=gossip->>'content' and frozen->>'originalClaimFingerprint'=gossip->>'originalClaimFingerprint' and frozen->'provenance'=b.provenance_chain)
   or b.statement<>btrim(gossip->>'content') or b.original_claim_fingerprint<>gossip->>'originalClaimFingerprint' or not exists(select 1 from jsonb_array_elements(e.context->'authorizedEvidence') z where z->>'id'=gossip->>'sourceEvidenceId' and z->>'sourceFingerprint'=gossip->>'originalClaimFingerprint') or gossip->'provenance' is distinct from b.provenance_chain||jsonb_build_array(jsonb_build_object('sourceKind','gossip','sourceId',b.id,'speakerNpcId',(select npc_id::text from private.world_resident_profiles where instance_id=source_id))) then raise sqlstate 'PT400' using message='Gossip must copy frozen source content, provenance, and exactly one link'; end if;
  new_fp:=encode(extensions.digest(b.original_claim_fingerprint||':'||p_job_id::text||':'||recipient_id::text,'sha256'),'hex');
  insert into private.world_resident_beliefs(instance_id,fingerprint,statement,confidence,provenance,subject_key,provenance_chain,original_claim_fingerprint) values(recipient_id,new_fp,b.statement,(gossip->>'confidence')::integer,'inference',b.subject_key,gossip->'provenance',b.original_claim_fingerprint) on conflict(instance_id,fingerprint) where active do nothing;
 end loop;
 out:=jsonb_build_object('status','completed','rulesVersion','social-encounter-v1','settlementId',s.id,'jobId',j.id,'proposalFingerprint',fp);
 update private.world_social_encounters set status='completed',private_intents=p_proposal->'privateCommunicativeIntents',private_exchange_summary=btrim(p_proposal->>'privateExchangeSummary'),completed_at=clock_timestamp() where job_id=j.id;
 insert into private.world_social_encounter_receipts(job_id,proposal_fingerprint,canonical_proposal,result) values(j.id,fp,canon,out);
 perform public.world_settlement_complete(s.id,j.id,p_fence,jsonb_build_object('kind','social_encounter'));
 return out;
end $$;
revoke all on private.world_social_encounter_templates,private.world_social_encounters,private.world_social_encounter_receipts from public,anon,authenticated,service_role;
revoke all on function private.world_social_encounter_scope_guard(),private.world_social_encounter_terminal_guard(),private.world_social_encounter_resident(uuid,uuid),private.world_social_text(jsonb,integer),private.world_social_pair(jsonb,uuid,uuid),private.advance_tavern_day_before_social_encounter_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb),public.advance_tavern_day(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.advance_tavern_day(uuid,uuid,bigint) to authenticated;
commit;
