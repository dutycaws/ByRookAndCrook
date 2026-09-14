begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select jsonb_agg(template_key order by template_key) from private.world_social_encounter_templates),
  '["faction-request","lost-supply","road-rumor","trade-offer"]'::jsonb,
  'social template registry exactly matches primitiveRegistry.encounterTemplates');
select ok(has_function_privilege('service_role','public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb)','execute'),
  'service role owns social encounter completion');
select ok(not has_function_privilege('authenticated','public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb)','execute'),
  'players cannot commit private social encounters');
select ok(not has_table_privilege('authenticated','private.world_social_encounters','select'),
  'players cannot read frozen private participant context');
select ok(position('participantResidentIds' in pg_get_functiondef('public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position('privateCommunicativeIntents' in pg_get_functiondef('public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position('gossipBeliefAdditions' in pg_get_functiondef('public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
  'commit validates the exact ten-field SocialEncounterProposal names');
select ok(position('world_day_close_evidence' in pg_get_functiondef('private.advance_tavern_day_before_procedural_world_v1(uuid,uuid,bigint)'::regprocedure))>0
  and position('world_settlement_attempts' in pg_get_functiondef('private.advance_tavern_day_before_procedural_world_v1(uuid,uuid,bigint)'::regprocedure))>0,
  'the social day-close layer uses attributable evidence and avoids attempted settlement insertion');
select ok(position('world_public_discoveries' in pg_get_functiondef('public.world_settlement_commit_social_encounter(uuid,uuid,uuid,jsonb)'::regprocedure))=0,
  'social completion never projects private exchanges as public news');
select throws_ok($$insert into private.world_social_encounter_templates(template_key) values('invented-template')$$,
  '23514',null,'template table rejects invented keys');
select throws_ok($$insert into private.world_social_encounters(job_id,settlement_id,save_id,day_number,first_instance_id,second_instance_id,context,context_fingerprint) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',1,'00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','{}',repeat('a',64))$$,
  '23514',null,'scope guard rejects an unbound job and settlement');
-- Behavioral fixture: a real close creates the frozen social job from two
-- active pinned residents and a completed, attributable dialogue turn.
insert into auth.users(id,email,role,aud) values('17900000-0000-4000-8000-000000000001','social-owner@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17900000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.social_fixture as
select (snapshot#>>'{save,id}')::uuid save_id,
       (min(r->>'instanceId'))::uuid first_id, (max(r->>'instanceId'))::uuid second_id
from (select public.npc_bar_snapshot() snapshot) x cross join lateral jsonb_array_elements(x.snapshot->'roster') r group by x.snapshot;
-- one snapshot row, aggregated roster ids
reset role;
-- Freeze through the migration's own resident/day-close path.  The pilot roster
-- already supplies its durable profiles and capability envelopes.
set local role postgres;
insert into private.world_social_edges(save_id,from_instance_id,to_instance_id)
select save_id,second_id,first_id from pg_temp.social_fixture;
insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,fence,lease_until,result,completed_at)
select '17900000-0000-4000-8000-000000000010',f.save_id,f.first_id,i.npc_id,i.version_id,'17900000-0000-4000-8000-000000000001','The road watch saw a silver wagon.',1,0,1,'completed','17900000-0000-4000-8000-000000000011',clock_timestamp(),'{"reply":"I will remember the wagon.","relationshipChange":2,"intention":null,"serving":null}'::jsonb,clock_timestamp()
from pg_temp.social_fixture f join private.world_npc_instances i on i.id=f.first_id;
insert into private.world_resident_beliefs(id,instance_id,fingerprint,statement,confidence,provenance,subject_key,provenance_chain,original_claim_fingerprint)
select '17900000-0000-4000-8000-000000000012',first_id,repeat('b',64),'The silver wagon traveled west.',70,'dialogue','world',jsonb_build_array(jsonb_build_object('sourceKind','dialogue_claim','sourceId',e->>'id')),e->>'sourceFingerprint'
from pg_temp.social_fixture f cross join lateral jsonb_array_elements(private.world_day_close_evidence(f.save_id,f.first_id,1)) e limit 1;
reset role;
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17900000-0000-4000-8000-000000000001';
create temporary table pg_temp.social_close as select public.advance_tavern_day((select save_id from pg_temp.social_fixture),'17900000-0000-4000-8000-000000000020',0) result;
reset role;
create temporary table pg_temp.social_job as
select e.*,j.id settlement_job_id,j.input_snapshot from private.world_social_encounters e join private.world_settlement_jobs j on j.id=e.job_id
where e.settlement_id=(select (result#>>'{worldSettlement,settlementId}')::uuid from pg_temp.social_close);
select is((select count(*) from pg_temp.social_job),1::bigint,'real day-close queues exactly one social encounter');
select ok((select first_instance_id<second_instance_id and input_snapshot->>'version'='social-encounter-v1' and jsonb_array_length(input_snapshot->'authorizedEvidence')>0 from pg_temp.social_job),'social job freezes an ordered v1 pair with nonempty attributable evidence');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17900000-0000-4000-8000-000000000001';
select is(public.advance_tavern_day((select save_id from pg_temp.social_fixture),'17900000-0000-4000-8000-000000000020',0),(select result from pg_temp.social_close),'same day-close action replays exactly');
reset role;
select is((select count(*) from private.world_social_encounters where settlement_id=(select settlement_id from pg_temp.social_job)),1::bigint,'replay creates no second social encounter');

-- Make only the social job processing and exercise the service commit against
-- the exact frozen pair/context created above.
set local role postgres;
update private.world_settlement_jobs set status='processing' where id=(select job_id from pg_temp.social_job);
update private.world_settlements set status='processing',fence='17900000-0000-4000-8000-000000000030',lease_until=clock_timestamp()+interval '5 minutes',deadline_at=clock_timestamp()+interval '5 minutes' where id=(select settlement_id from pg_temp.social_job);
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values((select job_id from pg_temp.social_job),1,'17900000-0000-4000-8000-000000000030',clock_timestamp()+interval '5 minutes');
create function pg_temp.social_proposal(p jsonb) returns jsonb language sql as $$
 select jsonb_build_object('version','social-encounter-v1','templateKey',p->>'templateKey','participantResidentIds',p->'participantResidentIds',
  'privateCommunicativeIntents',jsonb_build_array(jsonb_build_object('speakerResidentId',p#>>'{participantResidentIds,0}','recipientResidentId',p#>>'{participantResidentIds,1}','mode','honest','message','A private truth.')),
  'privateExchangeSummary','They quietly compare what they know.','evidenceIds',jsonb_build_array(p#>>'{authorizedEvidence,0,id}'),'causalExplanation','The frozen evidence prompted a private exchange.',
  'relationshipEffects',jsonb_build_array(jsonb_build_object('recipientResidentId',p#>>'{participantResidentIds,1}','sourceResidentId',p#>>'{participantResidentIds,0}','axis','trust','delta',2)),
  'gossipBeliefAdditions',jsonb_build_array(jsonb_build_object('recipientResidentId',p#>>'{participantResidentIds,1}','sourceResidentId',p#>>'{participantResidentIds,0}','sourceBeliefId','17900000-0000-4000-8000-000000000012','sourceEvidenceId',p#>>'{authorizedEvidence,0,id}','originalClaimFingerprint',p#>>'{authorizedEvidence,0,sourceFingerprint}','content','The silver wagon traveled west.','confidence',55,'provenance',jsonb_build_array(jsonb_build_object('sourceKind','dialogue_claim','sourceId',p#>>'{authorizedEvidence,0,id}'),jsonb_build_object('sourceKind','gossip','sourceId','17900000-0000-4000-8000-000000000012','speakerNpcId',p#>>'{participants,0,npcId}')))),'publicSummary',null) $$;
create temporary table pg_temp.social_proposal as select pg_temp.social_proposal(input_snapshot) proposal from pg_temp.social_job;
grant select on pg_temp.social_job,pg_temp.social_proposal to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.social_result as select public.world_settlement_commit_social_encounter((select settlement_id from pg_temp.social_job),(select job_id from pg_temp.social_job),'17900000-0000-4000-8000-000000000030',(select proposal from pg_temp.social_proposal)) result;
reset role;
select ok((select result->>'status'='completed' and result ? 'proposalFingerprint' from pg_temp.social_result),'valid service proposal completes with a safe receipt');
select is((select trust from private.world_social_edges e join pg_temp.social_job j on e.save_id=j.save_id and e.from_instance_id=j.second_instance_id and e.to_instance_id=j.first_instance_id),2::smallint,'commit changes only the intended recipient-to-source trust axis');
select is((select count(*) from private.world_resident_beliefs where instance_id=(select second_instance_id from pg_temp.social_job) and original_claim_fingerprint=(select input_snapshot#>>'{authorizedEvidence,0,sourceFingerprint}' from pg_temp.social_job)),1::bigint,'gossip creates exactly one recipient belief retaining the original fingerprint');
select ok((select statement='The silver wagon traveled west.' and confidence=55 and jsonb_array_length(provenance_chain)=2 from private.world_resident_beliefs where instance_id=(select second_instance_id from pg_temp.social_job) and original_claim_fingerprint=(select input_snapshot#>>'{authorizedEvidence,0,sourceFingerprint}' from pg_temp.social_job)),'gossip copies source content and full provenance plus one link');
select ok((select status='completed' from private.world_social_encounters where job_id=(select job_id from pg_temp.social_job)) and (select status='completed' from private.world_settlement_jobs where id=(select job_id from pg_temp.social_job)),'commit completes encounter and job');
select is((select count(*) from private.world_social_encounter_receipts where job_id=(select job_id from pg_temp.social_job)),1::bigint,'commit stores one social receipt');
select is((select count(*) from private.world_public_discoveries where settlement_id=(select settlement_id from pg_temp.social_job)),0::bigint,'private social commit creates no public discovery or news');
set local role service_role; set local request.jwt.claim.role='service_role';
select is(public.world_settlement_commit_social_encounter((select settlement_id from pg_temp.social_job),(select job_id from pg_temp.social_job),'17900000-0000-4000-8000-000000000030',(select proposal from pg_temp.social_proposal)),(select result from pg_temp.social_result),'exact proposal replay returns the identical receipt');
select throws_ok($$select public.world_settlement_commit_social_encounter((select settlement_id from pg_temp.social_job),(select job_id from pg_temp.social_job),'17900000-0000-4000-8000-000000000030',jsonb_set((select proposal from pg_temp.social_proposal),'{privateExchangeSummary}','"Changed private exchange"'))$$,'PT409',null,'changed proposal conflicts after receipt');
reset role;
select is((select trust from private.world_social_edges e join pg_temp.social_job j on e.save_id=j.save_id and e.from_instance_id=j.second_instance_id and e.to_instance_id=j.first_instance_id),2::smallint,'replays do not repeat relationship effects');

-- Separate processing fixtures prove every rejected path is atomic.  They use
-- the same frozen context but distinct settlement/job/lease identities, so the
-- successful receipt above cannot short-circuit validation.
create function pg_temp.social_attempt(p_settlement uuid,p_job uuid,p_fence uuid,p_day integer default 77) returns void language plpgsql as $$
declare f pg_temp.social_job%rowtype;
begin
 select * into f from pg_temp.social_job;
 insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
 values(p_settlement,f.save_id,p_day,1,'social-fixture-'||p_day,'processing',p_fence,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','social-encounter-v1');
 insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
 values(p_job,p_settlement,1,'social_encounter','processing','social-job-'||p_day,f.input_snapshot,'social-encounter-v1');
 insert into private.world_social_encounters(job_id,settlement_id,save_id,day_number,first_instance_id,second_instance_id,context,context_fingerprint)
 values(p_job,p_settlement,f.save_id,p_day,f.first_instance_id,f.second_instance_id,f.input_snapshot,encode(extensions.digest(private.world_canonical_json(f.input_snapshot),'sha256'),'hex'));
 insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values(p_job,1,p_fence,clock_timestamp()+interval '5 minutes');
end $$;
create temporary table pg_temp.social_stale(s uuid,j uuid,f uuid);
insert into pg_temp.social_stale values('17900000-0000-4000-8000-000000000040','17900000-0000-4000-8000-000000000041','17900000-0000-4000-8000-000000000042');
select pg_temp.social_attempt(s,j,f) from pg_temp.social_stale;
grant select on pg_temp.social_stale to service_role;
set local role postgres;
update private.world_settlement_attempts set lease_until=clock_timestamp()-interval '1 second' where job_id=(select j from pg_temp.social_stale);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_social_encounter(%L,%L,%L,%L::jsonb)',s,j,f,(select proposal::text from pg_temp.social_proposal)),'PT409',null,'expired social attempt rejects before writes') from pg_temp.social_stale;
reset role;
select is((select trust from private.world_social_edges e join pg_temp.social_job j on e.save_id=j.save_id and e.from_instance_id=j.second_instance_id and e.to_instance_id=j.first_instance_id),2::smallint,'expired fence leaves directed trust unchanged');
select is((select count(*) from private.world_resident_beliefs where instance_id=(select second_instance_id from pg_temp.social_job)),1::bigint,'expired fence leaves recipient beliefs unchanged');
select is((select count(*) from private.world_social_encounter_receipts where job_id=(select j from pg_temp.social_stale)),0::bigint,'expired fence creates no receipt');

create temporary table pg_temp.social_capability(s uuid,j uuid,f uuid);
insert into pg_temp.social_capability values('17900000-0000-4000-8000-000000000050','17900000-0000-4000-8000-000000000051','17900000-0000-4000-8000-000000000052');
select pg_temp.social_attempt(s,j,f,78) from pg_temp.social_capability;
grant select on pg_temp.social_capability to service_role;
set local role postgres;
update private.world_social_encounters set context=jsonb_set(context,'{participants,0,capability,socialCapabilities}','[]'::jsonb) where job_id=(select j from pg_temp.social_capability);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_social_encounter(%L,%L,%L,%L::jsonb)',s,j,f,(select proposal::text from pg_temp.social_proposal)),'PT409',null,'stale frozen capability rejects before writes') from pg_temp.social_capability;
reset role;
select is((select trust from private.world_social_edges e join pg_temp.social_job j on e.save_id=j.save_id and e.from_instance_id=j.second_instance_id and e.to_instance_id=j.first_instance_id),2::smallint,'stale capability leaves trust unchanged');
select is((select count(*) from private.world_resident_beliefs where instance_id=(select second_instance_id from pg_temp.social_job)),1::bigint,'stale capability leaves recipient belief unchanged');
select is((select count(*) from private.world_social_encounter_receipts where job_id=(select j from pg_temp.social_capability)),0::bigint,'stale capability creates no receipt');
set local role postgres;
-- Make a fresh profile revision mismatch for the remaining context-validation cases.
create temporary table pg_temp.social_profile(s uuid,j uuid,f uuid);
insert into pg_temp.social_profile values('17900000-0000-4000-8000-000000000060','17900000-0000-4000-8000-000000000061','17900000-0000-4000-8000-000000000062');
select pg_temp.social_attempt(s,j,f,79) from pg_temp.social_profile;
grant select on pg_temp.social_profile to service_role;
update private.world_social_encounters set context=jsonb_set(context,'{participants,0,profileRevision}',to_jsonb((context#>>'{participants,0,profileRevision}')::bigint+1)) where job_id=(select j from pg_temp.social_profile);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_social_encounter(%L,%L,%L,%L::jsonb)',s,j,f,(select proposal::text from pg_temp.social_proposal)),'PT409',null,'stale frozen profile rejects before writes') from pg_temp.social_profile;
reset role;
select is((select count(*) from private.world_social_encounter_receipts where job_id=(select j from pg_temp.social_profile)),0::bigint,'stale profile creates no receipt');
set local role postgres;
create temporary table pg_temp.social_unfrozen(s uuid,j uuid,f uuid);
insert into pg_temp.social_unfrozen values('17900000-0000-4000-8000-000000000070','17900000-0000-4000-8000-000000000071','17900000-0000-4000-8000-000000000072');
select pg_temp.social_attempt(s,j,f,80) from pg_temp.social_unfrozen;
grant select on pg_temp.social_unfrozen to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_social_encounter(%L,%L,%L,%L::jsonb)',s,j,f,jsonb_set((select proposal from pg_temp.social_proposal),'{evidenceIds}','["invented-evidence"]'::jsonb)),'PT400',null,'unfrozen evidence rejects before writes') from pg_temp.social_unfrozen;
select throws_ok(format('select public.world_settlement_commit_social_encounter(%L,%L,%L,%L::jsonb)',s,j,f,jsonb_set((select proposal from pg_temp.social_proposal),'{privateCommunicativeIntents,0,mode}','"not-a-mode"')),'PT400',null,'malformed intent rejects before writes') from pg_temp.social_unfrozen;
reset role;
select is((select trust from private.world_social_edges e join pg_temp.social_job j on e.save_id=j.save_id and e.from_instance_id=j.second_instance_id and e.to_instance_id=j.first_instance_id),2::smallint,'invalid proposal paths leave trust unchanged');
select is((select count(*) from private.world_resident_beliefs where instance_id=(select second_instance_id from pg_temp.social_job)),1::bigint,'invalid proposal paths leave recipient beliefs unchanged');
select is((select count(*) from private.world_social_encounter_receipts where job_id=(select j from pg_temp.social_unfrozen)),0::bigint,'invalid proposal paths create no receipt');

-- A generic worker fallback completes its job without a social receipt.  Gate
-- 49's terminal trigger must expose that private encounter as skipped instead
-- of leaving it falsely queued.
create temporary table pg_temp.social_safe(s uuid,j uuid,f uuid);
insert into pg_temp.social_safe values('17900000-0000-4000-8000-000000000080','17900000-0000-4000-8000-000000000081','17900000-0000-4000-8000-000000000082');
select pg_temp.social_attempt(s,j,f,81) from pg_temp.social_safe;
grant select on pg_temp.social_safe to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok(format('select public.world_settlement_safe_result(%L,%L,%L,%L,%L)',s,j,f,'no_changes','The social worker safely declined this encounter.'),'generic safe result completes social job') from pg_temp.social_safe;
reset role;
select is((select status from private.world_settlement_jobs where id=(select j from pg_temp.social_safe)),'completed','generic fallback completes the social settlement job');
select is((select status from private.world_social_encounters where job_id=(select j from pg_temp.social_safe)),'skipped','generic fallback marks its unreceipted social encounter skipped');
select is((select count(*) from private.world_social_encounter_receipts where job_id=(select j from pg_temp.social_safe)),0::bigint,'generic fallback never fabricates a social receipt');

select * from finish();
rollback;
