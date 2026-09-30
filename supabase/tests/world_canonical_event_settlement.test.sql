begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,role,aud) values ('17700000-0000-4000-8000-000000000001','canon-owner@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17700000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.canon_fixture as
select (snapshot#>>'{save,id}')::uuid save_id,(value->>'instanceId')::uuid participant
from (select public.npc_bar_snapshot() snapshot) s cross join lateral jsonb_array_elements(snapshot->'roster') value limit 1;
reset role;

-- Seed prior public procedural entities in deliberately reverse reuse-key order.
-- The closing wrapper must derive its context from these rows, never a model.
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at,input_snapshot,input_version)
select '17700000-0000-4000-8000-000000000010',save_id,77,0,'prior-canon','completed',clock_timestamp(),'{}','fixture-v1' from pg_temp.canon_fixture;
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at,input_snapshot,input_version)
select '17700000-0000-4000-8000-000000000014',save_id,78,0,'prior-canon-two','completed',clock_timestamp(),'{}','fixture-v1' from pg_temp.canon_fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
values
 ('17700000-0000-4000-8000-000000000011','17700000-0000-4000-8000-000000000010',1,'canon','completed','prior-canon-1','{}','fixture-v1'),
 ('17700000-0000-4000-8000-000000000012','17700000-0000-4000-8000-000000000014',1,'canon','completed','prior-canon-2','{}','fixture-v1');
insert into private.world_canonical_entities(id,save_id,entity_kind,entity_key,origin,source_version,payload,lifecycle,discovered_day)
select x.id,save_id,x.kind,x.key,'procedural',x.version,x.payload,'active',77 from pg_temp.canon_fixture cross join (values
 ('17700000-0000-4000-8000-000000000020'::uuid,'item','procedural-item','world-v1','{}'::jsonb),
 ('17700000-0000-4000-8000-000000000021'::uuid,'world_event','event-aaaaaaaaaaaaaaaaaaaaaaaa','world-canon-event-v1',jsonb_build_object('proposalFingerprint',repeat('a',64),'proposal',jsonb_build_object('reuseKey','not-the-entity-key'))),
 ('17700000-0000-4000-8000-000000000022'::uuid,'world_event','zeta-event','world-canon-event-v1',jsonb_build_object('proposalFingerprint',repeat('b',64),'proposal',jsonb_build_object('reuseKey','zeta-event'))),
 ('17700000-0000-4000-8000-000000000023'::uuid,'world_event','alpha-event','world-canon-event-v1',jsonb_build_object('proposalFingerprint',repeat('c',64),'proposal',jsonb_build_object('reuseKey','alpha-event')))
) x(id,kind,key,version,payload);
insert into private.world_public_discoveries(settlement_id,job_id,canonical_entity_id,save_id,day_number,title,summary)
select case id when '17700000-0000-4000-8000-000000000022'::uuid then '17700000-0000-4000-8000-000000000010'::uuid else '17700000-0000-4000-8000-000000000014'::uuid end,case id when '17700000-0000-4000-8000-000000000022'::uuid then '17700000-0000-4000-8000-000000000011'::uuid else '17700000-0000-4000-8000-000000000012'::uuid end,id,save_id,case id when '17700000-0000-4000-8000-000000000022'::uuid then 77 else 78 end,entity_key,'Prior public event.' from private.world_canonical_entities where id in ('17700000-0000-4000-8000-000000000022','17700000-0000-4000-8000-000000000023');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17700000-0000-4000-8000-000000000001';
create temporary table pg_temp.closed_context as select public.advance_tavern_day((select save_id from pg_temp.canon_fixture),'17700000-0000-4000-8000-000000000030',0) result;
reset role;
select is((select j.input_snapshot#>>'{worldSnapshot,activeGeneratedEntityCount}' from private.world_settlement_jobs j join pg_temp.closed_context c on j.settlement_id=(c.result#>>'{worldSettlement,settlementId}')::uuid where j.job_kind='canon'),'4','frozen snapshot counts every active procedural entity kind');
select is((select j.input_snapshot#>'{worldSnapshot,existingPublicEventReuseKeys}' from private.world_settlement_jobs j join pg_temp.closed_context c on j.settlement_id=(c.result#>>'{worldSettlement,settlementId}')::uuid where j.job_kind='canon'),'["alpha-event", "zeta-event"]'::jsonb,'frozen snapshot sorts explicit public reuse keys and excludes synthetic keys');

create function pg_temp.event(p uuid,p_key text default 'road-event') returns jsonb language sql as $$
 select jsonb_build_object('version','world-canon-event-v1','kind','world_event','templateKey','market-day','participantEntityIds',jsonb_build_array(p::text),'title','Market day arrives','summary','Merchants and neighbors gather at the tavern.','payload',jsonb_build_object('template','market-day','participants',jsonb_build_array(p::text),'visibility','public'),'reuseKey',p_key) $$;
create function pg_temp.job(p_settlement uuid,p_job uuid,p_fence uuid,p_save uuid,p_day int default 8) returns void language plpgsql as $$
begin
 insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version)
 values(p_settlement,p_save,p_day,1,'canon-fixture-'||p_day,'processing',p_fence,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','fixture-v1');
 insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
 values(p_job,p_settlement,1,'canon','processing','canon-job-'||p_day,jsonb_build_object('worldSnapshot',jsonb_build_object('saveId',p_save,'dayNumber',p_day,'sourceRevision',1,'registeredTemplateKeys',jsonb_build_array('festival-arrival','market-day','road-closure','storm-front'),'entityKinds',jsonb_build_object((select participant::text from pg_temp.canon_fixture),'npc'))),'world-canon-event-v1');
 insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values(p_job,1,p_fence,clock_timestamp()+interval '5 minutes');
end $$;

select is((select jsonb_agg(template_key order by template_key) from private.world_canonical_event_templates), '["festival-arrival","market-day","road-closure","storm-front"]'::jsonb,'SQL template registry exactly matches the primitive registry');
select ok(position('activeGeneratedEntityCount' in pg_get_functiondef('private.advance_tavern_day_before_social_encounter_v1(uuid,uuid,bigint)'::regprocedure))>0 and position('private.world_canonical_entities' in pg_get_functiondef('private.advance_tavern_day_before_social_encounter_v1(uuid,uuid,bigint)'::regprocedure))>0,'the canonical snapshot layer freezes the authoritative generated-entity count from canonical rows');
select ok(position('existingPublicEventReuseKeys' in pg_get_functiondef('private.advance_tavern_day_before_social_encounter_v1(uuid,uuid,bigint)'::regprocedure))>0 and position('{proposal,reuseKey}' in pg_get_functiondef('private.advance_tavern_day_before_social_encounter_v1(uuid,uuid,bigint)'::regprocedure))>0,'the canonical snapshot layer freezes only stored matching reuse keys');
select ok(not has_function_privilege('authenticated','public.world_settlement_commit_canon(uuid,uuid,uuid,jsonb)','execute'),'players cannot commit canonical events');
select ok(has_function_privilege('service_role','public.world_settlement_commit_canon(uuid,uuid,uuid,jsonb)','execute'),'service worker owns canonical commits');

create temporary table pg_temp.a(s uuid,j uuid,f uuid,e jsonb);
insert into pg_temp.a select '17700000-0000-4000-8000-000000000101','17700000-0000-4000-8000-000000000102','17700000-0000-4000-8000-000000000103',pg_temp.event(participant) from pg_temp.canon_fixture;
select pg_temp.job(s,j,f,(select save_id from pg_temp.canon_fixture)) from pg_temp.a;
grant select on pg_temp.a to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.result as select public.world_settlement_commit_canon(s,j,f,e) result from pg_temp.a;
reset role;
select ok((select result @> jsonb_build_object('status','completed','rulesVersion','world-canon-event-v1','settlementId',s,'jobId',j,'reused',false) and result ? 'proposalFingerprint' and not (result ?| array['payload','fence','pressure','roll','proposal']) from pg_temp.result cross join pg_temp.a),'fresh commit returns a safe stable receipt');
select is((select count(*) from private.world_public_discoveries where job_id=(select j from pg_temp.a)),1::bigint,'one safe discovery is created for the canon job');
select is((select count(*) from private.world_canonical_entity_history h join private.world_canon_commit_receipts r on r.canonical_entity_id=h.entity_id where r.job_id=(select j from pg_temp.a) and h.event_kind='created'),1::bigint,'new event receives one immutable created history record');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((select public.world_settlement_commit_canon(s,j,f,e) from pg_temp.a),(select result from pg_temp.result),'same proposal replay returns the exact receipt');
select throws_ok(format('select public.world_settlement_commit_canon(%L,%L,%L,%L::jsonb)',s,j,f,jsonb_set(e,'{title}','"Changed title"')),'PT409',null,'same job rejects a changed proposal') from pg_temp.a;
reset role;
select is((select count(*) from private.world_public_discoveries where job_id=(select j from pg_temp.a)),1::bigint,'replay does not duplicate discovery');

create temporary table pg_temp.b(s uuid,j uuid,f uuid,e jsonb);
insert into pg_temp.b select '17700000-0000-4000-8000-000000000111','17700000-0000-4000-8000-000000000112','17700000-0000-4000-8000-000000000113',pg_temp.event(participant) from pg_temp.canon_fixture;
select pg_temp.job(s,j,f,(select save_id from pg_temp.canon_fixture),9) from pg_temp.b;
grant select on pg_temp.b to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.bresult as select public.world_settlement_commit_canon(s,j,f,e) result from pg_temp.b;
select ok((select (result->>'reused')::boolean from pg_temp.bresult),'matching reuse key and immutable fingerprint reuses the event');
select throws_ok(format('select public.world_settlement_commit_canon(%L,%L,%L,%L::jsonb)',s,j,f,jsonb_set(e,'{summary}','"Different immutable meaning"')),'PT409',null,'divergent reuse key is rejected') from pg_temp.b;
select is((select public.world_settlement_commit_canon(s,j,'17700000-0000-4000-8000-000000000999',e) from pg_temp.b),(select result from pg_temp.bresult),'exact replay remains safe across a stale fence');
select throws_ok(format('select public.world_settlement_commit_canon(%L,%L,%L,%L::jsonb)',(select s from pg_temp.a),(select j from pg_temp.b),(select f from pg_temp.b),e),'PT409',null,'mismatched settlement and job cannot reveal a receipt') from pg_temp.b;
reset role;
select is((select count(*) from private.world_public_discoveries where job_id=(select j from pg_temp.b)),1::bigint,'rejection leaves the reused job with only its committed discovery');

create temporary table pg_temp.type_case(s uuid,j uuid,f uuid,e jsonb);
insert into pg_temp.type_case select '17700000-0000-4000-8000-000000000121','17700000-0000-4000-8000-000000000122','17700000-0000-4000-8000-000000000123',jsonb_set(pg_temp.event(participant,'type-event'),'{title}','[]'::jsonb) from pg_temp.canon_fixture;
select pg_temp.job(s,j,f,(select save_id from pg_temp.canon_fixture),10) from pg_temp.type_case;
grant select on pg_temp.type_case to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_canon(%L,%L,%L,%L::jsonb)',s,j,f,e),'PT400',null,'non-string title is rejected without coercion') from pg_temp.type_case;
select throws_ok(format('select public.world_settlement_commit_canon(%L,%L,%L,%L::jsonb)',s,j,f,jsonb_set(e,'{activeGeneratedEntityCount}','99'::jsonb)),'PT400',null,'a model cannot supply or override frozen generated-entity context') from pg_temp.type_case;
reset role;

select throws_ok($$insert into private.world_public_discoveries(settlement_id,job_id,canonical_entity_id,save_id,day_number,title,summary) select s,j,(select canonical_entity_id from private.world_canon_commit_receipts where job_id=(select j from pg_temp.a)),save_id,99,'Wrong day','This must not be admitted.' from pg_temp.a cross join pg_temp.canon_fixture$$,'23514',null,'discovery guard rejects mismatched day scope');
select throws_ok($$insert into private.world_public_discoveries(settlement_id,job_id,canonical_entity_id,save_id,day_number,title,summary) select s,'17700000-0000-4000-8000-000000000999',(select canonical_entity_id from private.world_canon_commit_receipts where job_id=(select j from pg_temp.a)),save_id,8,'Wrong job','This must not be admitted.' from pg_temp.a cross join pg_temp.canon_fixture$$,'23514',null,'discovery guard rejects a missing canon job');
select throws_ok($$insert into private.world_public_discoveries(settlement_id,job_id,canonical_entity_id,save_id,day_number,title,summary) select s,j,(select canonical_entity_id from private.world_canon_commit_receipts where job_id=(select j from pg_temp.a)),'17700000-0000-4000-8000-000000000999',8,'Wrong save','This must not be admitted.' from pg_temp.a$$,'23514',null,'discovery guard rejects cross-save discovery scope');

-- The real news job is completed under its fence and the final generic worker
-- result must retain that curated digest as the terminal public projection.
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version)
select '17700000-0000-4000-8000-000000000131',s,2,'news','processing','news-job','{}','fixture-v1' from pg_temp.a;
update private.world_settlements set status='processing',fence='17700000-0000-4000-8000-000000000131',lease_until=clock_timestamp()+interval '5 minutes',deadline_at=clock_timestamp()+interval '5 minutes' where id=(select s from pg_temp.a);
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values('17700000-0000-4000-8000-000000000131',1,'17700000-0000-4000-8000-000000000131',clock_timestamp()+interval '5 minutes');
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.news as select public.world_settlement_complete_news(s,'17700000-0000-4000-8000-000000000131','17700000-0000-4000-8000-000000000131') result from pg_temp.a;
set local role postgres;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version) select '17700000-0000-4000-8000-000000000132',s,3,'finalize','processing','finalize-job','{}','fixture-v1' from pg_temp.a;
update private.world_settlements set status='processing',fence='17700000-0000-4000-8000-000000000132',lease_until=clock_timestamp()+interval '5 minutes',deadline_at=clock_timestamp()+interval '5 minutes' where id=(select s from pg_temp.a);
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values('17700000-0000-4000-8000-000000000132',1,'17700000-0000-4000-8000-000000000132',clock_timestamp()+interval '5 minutes');
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok(format('select public.world_settlement_safe_result(%L,%L,%L,%L,%L)',s,'17700000-0000-4000-8000-000000000132','17700000-0000-4000-8000-000000000132','no_changes','generic worker text'),'the final safe result completes after curated news') from pg_temp.a;
select throws_ok(format('select public.world_settlement_safe_result(%L,%L,%L,%L,%L)',(select s from pg_temp.b),'17700000-0000-4000-8000-000000000132','17700000-0000-4000-8000-000000000132','no_changes','generic worker text'),'PT409',null,'safe-result replay rejects a mismatched settlement before receipt lookup');
reset role;
select ok((select result->>'morningNews'=public_digest and terminal_receipt->>'publicSummary'=public_digest from pg_temp.news cross join pg_temp.a join private.world_settlements s on s.id=pg_temp.a.s),'curated morning news survives terminal safe-result finalization');
select ok(not has_table_privilege('authenticated','private.world_public_discoveries','select'),'player role cannot read private discoveries');

set local role postgres;
create temporary table pg_temp.expired(s uuid,j uuid,f uuid);
insert into pg_temp.expired values('17700000-0000-4000-8000-000000000141','17700000-0000-4000-8000-000000000142','17700000-0000-4000-8000-000000000143');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version) select s,save_id,11,1,'expired-news','processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','fixture-v1' from pg_temp.expired cross join pg_temp.canon_fixture;
insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,status,input_fingerprint,input_snapshot,input_version) select j,s,1,'news','processing','expired-news','{}','fixture-v1' from pg_temp.expired;
insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) select j,1,f,clock_timestamp()-interval '1 second' from pg_temp.expired;
grant select on pg_temp.expired to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_complete_news(%L,%L,%L)',s,j,f),'PT409',null,'expired news attempt cannot write a receipt or digest') from pg_temp.expired;
reset role;

select * from finish();
rollback;
