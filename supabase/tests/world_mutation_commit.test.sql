begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- A rollback-contained fixture using the real first-party roster, profile/pin
-- backfill, processing settlements, attempts, fences, and frozen snapshots.
insert into auth.users(id,email,role,aud) values ('17300000-0000-4000-8000-000000000001','mutation-owner@example.test','authenticated','authenticated');
set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='17300000-0000-4000-8000-000000000001';
select public.create_tavern();
create temporary table pg_temp.r as
select (snapshot#>>'{save,id}')::uuid save_id,
       (select (value->>'instanceId')::uuid from jsonb_array_elements(snapshot->'roster') value where value->>'npcId'='18181818-1818-4181-8181-181818181818') lira,
       (select (value->>'instanceId')::uuid from jsonb_array_elements(snapshot->'roster') value where value->>'npcId'='28282828-2828-4282-8282-282828282828') torvin
from (select public.npc_bar_snapshot() snapshot) q;
reset role;

create function pg_temp.p(ch jsonb default '[]', sal text default 'major', entries jsonb default '[]', beliefs jsonb default '[]', effects jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('beliefOperations',beliefs,'causalExplanation','The resident weighed the witnessed event carefully.','dimensionChanges',ch,'entryOperations',entries,'evidenceIds','["evidence-1"]'::jsonb,'questChanges','[]'::jsonb,'rulesVersion','evolving-world-v1','salience',sal,'worldEffects',effects) $$;
create function pg_temp.fp(p jsonb) returns text language sql security definer set search_path='' as $$select encode(extensions.digest(private.world_canonical_json(p),'sha256'),'hex')$$;
create function pg_temp.evo(i uuid,t uuid) returns jsonb language sql as $$select private.world_frozen_resident_evolution_base(i)||jsonb_build_object('authorizedEvidence',jsonb_build_array(jsonb_build_object('happenedOnDay',1,'id','evidence-1','kind','world_event','salience','major','sequence',1,'sourceFingerprint',repeat('a',64),'summary','The road was kept safe.')),'worldSnapshot',jsonb_build_object('entityKinds',jsonb_build_object(t::text,'npc')))$$;
create function pg_temp.case(s uuid,j uuid,f uuid,i uuid,t uuid,d integer) returns void language plpgsql as $$begin
 insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,fence,lease_until,deadline_at,input_snapshot,input_version) values(s,(select save_id from pg_temp.r),d,0,'fixture-'||d,'processing',f,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '5 minutes','{}','fixture-v1');
 insert into private.world_settlement_jobs(id,settlement_id,ordinal,job_kind,subject_instance_id,status,input_fingerprint,input_snapshot,input_version) values(j,s,1,'resident',i,'processing','job-'||d,jsonb_build_object('evolution',pg_temp.evo(i,t)),'fixture-v1');
 insert into private.world_settlement_attempts(job_id,attempt_number,fence,lease_until) values(j,1,f,clock_timestamp()+interval '5 minutes'); end$$;

-- Installed definition authority, including source values the RPC depends upon.
select is((select count(*)::integer from private.world_pilot_resident_definitions),2,'exactly two definitions are installed');
select ok(not has_function_privilege('authenticated','private.world_frozen_resident_evolution_base(uuid)','execute'),'authenticated callers cannot execute frozen resident projection');
select ok(has_function_privilege('service_role','private.world_frozen_resident_evolution_base(uuid)','execute'),'service role can execute frozen resident projection');
select ok((select personality_schema->'dimensions' @> '[{"key":"duty","initialValue":85,"core":true}]' and initial_profile#>>'{entries,3,text}'='careful preparation' and initial_profile#>>'{entries,6,text}'='recklessness' and initial_profile#>>'{entries,9,text}'='Will not deliberately harm civilians' and initial_profile#>>'{entries,11,text}' like 'Measured, observant%' and capability_envelope->'allowedWorldEffects'?'adjust_relationship' and appearance_spec->>'renderingTemplateKey'='tavern-portrait' from private.world_pilot_resident_definitions where npc_id='18181818-1818-4181-8181-181818181818'),'Lira installed schema/profile/capability/appearance preserves authored essentials');
select ok((select personality_schema->'dimensions' @> '[{"key":"fairness","initialValue":85,"core":true},{"key":"guardedness","initialValue":65,"core":false}]' and initial_profile#>>'{entries,3,text}'='patient negotiation' and initial_profile#>>'{entries,6,text}'='being patronized' and initial_profile#>>'{entries,9,text}'='Will not knowingly sell a counterfeit' and initial_profile#>>'{entries,11,text}' like 'Warm, shrewd%' and capability_envelope->'allowedApproaches'?'trade' and appearance_spec->>'renderingTemplateKey'='tavern-portrait' from private.world_pilot_resident_definitions where npc_id='28282828-2828-4282-8282-282828282828'),'Torvin installed schema/profile/capability/appearance preserves authored essentials');
select ok((select count(*)=2 from private.world_resident_profiles p join pg_temp.r r on p.save_id=r.save_id join private.world_resident_evolution_pins x on x.instance_id=p.instance_id where p.profile_schema_version='personality-schema-v1' and x.definition_version='pilot-resident-v1'),'new Lira and Torvin instances have valid typed profiles and pins');

create temporary table pg_temp.a(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.a values('17300000-0000-4000-8000-000000000101','17300000-0000-4000-8000-000000000102','17300000-0000-4000-8000-000000000103',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":7}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),10) from pg_temp.a;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.a;
grant select on pg_temp.a to authenticated, anon, service_role;
set local role authenticated; set local request.jwt.claim.role='authenticated';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'no'),'42501',null,'authenticated is denied mutation commit') from pg_temp.a; reset role;
set local role anon; set local request.jwt.claim.role='anon';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'no'),'42501',null,'anonymous is denied mutation commit') from pg_temp.a; reset role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,jsonb_set(p,'{evidenceIds}','["unfrozen"]'),pg_temp.fp(jsonb_set(p,'{evidenceIds}','["unfrozen"]')),'bad'),'PT400',null,'unauthorized evidence rejects before writes') from pg_temp.a;
reset role;
select is((select count(*) from private.world_resident_mutation_evidence where job_id=(select j from pg_temp.a)),0::bigint,'rejection creates no partial evidence');
select is((select count(*) from private.world_resident_pressure_history where job_id=(select j from pg_temp.a)),0::bigint,'rejection creates no partial pressure');
set local role service_role; set local request.jwt.claim.role='service_role';
select setseed(0.01);
create temporary table pg_temp.ar as select public.world_settlement_commit_mutation(s,j,f,p,pg_temp.fp(p),'Lira became more careful.') result from pg_temp.a;
reset role;
select is((select result->>'outcome' from pg_temp.ar),'changed','service pressure commit succeeds with a deterministic qualifying roll');
select ok((select count(*)=1 from private.world_resident_mutation_evidence where job_id=(select j from pg_temp.a)),'authorized evidence persists atomically');
select ok((select count(*)=1 from private.world_resident_mutation_receipts where job_id=(select j from pg_temp.a)),'receipt persists atomically');
select ok((select status='completed' and output->>'outcome'='changed' from private.world_settlement_jobs where id=(select j from pg_temp.a)),'job completion and output persist');
select ok((select public_digest='Lira became more careful.' from private.world_settlements where id=(select s from pg_temp.a)),'settlement digest persists');
select ok((select count(*)=1 from private.world_settlement_outbox where job_id=(select j from pg_temp.a)),'outbox persists atomically');
select ok((select (result#>>'{dimensions,0,pressureAfterCommit}')::int=h.pressure_after and (result#>>'{dimensions,0,valueAfter}')::int=(p.current_profile#>>'{dimensions,caution}')::int and (result#>>'{dimensions,0,appliedDelta}')::int=7 from pg_temp.ar cross join private.world_resident_pressure_history h join private.world_resident_profiles p on p.instance_id=(select lira from pg_temp.r) where h.job_id=(select j from pg_temp.a)),'receipt pressure and applied/value state equal stored state');
set local role service_role; set local request.jwt.claim.role='service_role';
select is((select public.world_settlement_commit_mutation(a.s,a.j,a.f,a.p,pg_temp.fp(a.p),'Lira became more careful.') from pg_temp.a a),(select result from pg_temp.ar),'completed job exact replay returns identical result');
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,jsonb_set(p,'{salience}','"minor"'),pg_temp.fp(jsonb_set(p,'{salience}','"minor"')),'changed'),'PT409',null,'replay with a changed proposal conflicts') from pg_temp.a;
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'changed digest'),'PT409',null,'replay with a changed digest conflicts') from pg_temp.a;
reset role;

-- The active attempt can accept an already-recorded accepted checkpoint from an expired fence.
create temporary table pg_temp.b(s uuid,j uuid,f uuid,oldf uuid,p jsonb);
insert into pg_temp.b values('17300000-0000-4000-8000-000000000111','17300000-0000-4000-8000-000000000112','17300000-0000-4000-8000-000000000113','17300000-0000-4000-8000-000000000114',pg_temp.p('[{"dimensionKey":"openness","direction":1,"intendedDelta":1}]','minor'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),11) from pg_temp.b;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,oldf,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.b;
grant select on pg_temp.b to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select lives_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'prior-fence'),'latest accepted checkpoint from a prior expired fence is accepted by an active current fence') from pg_temp.b;
reset role;

-- Strict contract rejections: canonical SHA, unsupported work, malformed JSON shapes and stale control plane.
create temporary table pg_temp.c(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.c values('17300000-0000-4000-8000-000000000121','17300000-0000-4000-8000-000000000122','17300000-0000-4000-8000-000000000123',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":1}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),12) from pg_temp.c;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.c;
grant select on pg_temp.c to service_role;
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,repeat('0',64),'bad'),'PT400',null,'wrong canonical SHA rejects') from pg_temp.c;
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,jsonb_set(p,'{questChanges}','[{"kind":"no"}]'),pg_temp.fp(jsonb_set(p,'{questChanges}','[{"kind":"no"}]')),'quest'),'PT400',null,'unsupported quest changes reject') from pg_temp.c;
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,jsonb_set(p,'{dimensionChanges}','[{"dimensionKey":"caution","direction":1,"intendedDelta":1},{"dimensionKey":"caution","direction":1,"intendedDelta":1}]'),pg_temp.fp(jsonb_set(p,'{dimensionChanges}','[{"dimensionKey":"caution","direction":1,"intendedDelta":1},{"dimensionKey":"caution","direction":1,"intendedDelta":1}]')),'duplicate'),'PT400',null,'duplicate dimensions reject') from pg_temp.c;
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,jsonb_set(p,'{salience}','"bad"'),pg_temp.fp(jsonb_set(p,'{salience}','"bad"')),'salience'),'PT400',null,'malformed salience rejects') from pg_temp.c;
reset role;
update private.world_settlement_attempts set lease_until=clock_timestamp()-interval '1 second' where job_id=(select j from pg_temp.c);
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'expired'),'PT409',null,'inactive or expired attempt rejects') from pg_temp.c;
reset role;
select is((select count(*) from private.world_resident_mutation_receipts where job_id=(select j from pg_temp.c)),0::bigint,'every rejected control/contract case leaves no receipt');

-- Non-core entry changes are applied only on a successful qualifying roll.  The
-- second add/revise/retract chain uses newly frozen profile revisions each time.
create temporary table pg_temp.e(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.e values('17300000-0000-4000-8000-000000000131','17300000-0000-4000-8000-000000000132','17300000-0000-4000-8000-000000000133',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":1}]','major','[{"operation":"add","entry":{"id":"lira_preference_patrol","kind":"preference","text":"dawn patrols","core":false,"active":true}},{"operation":"add","entry":{"id":"lira_preference_maps","kind":"preference","text":"clear maps","core":false,"active":true}}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),13) from pg_temp.e;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.e;
grant select on pg_temp.e to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
create temporary table pg_temp.er as select public.world_settlement_commit_mutation(s,j,f,p,pg_temp.fp(p),'Lira adds two practical preferences.') result from pg_temp.e;
reset role;
select is((select result->'appliedEntryOperationIndexes' from pg_temp.er),'[0,1]'::jsonb,'successful non-core entry additions report their exact operation indexes');
select is((select count(*)::int from private.world_resident_profiles p,jsonb_array_elements(p.current_profile->'entries') x where p.instance_id=(select lira from pg_temp.r) and x->>'kind'='preference' and x->>'active'='true'),5,'two successful additions increase Lira preference collection to five');
create temporary table pg_temp.f(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.f values('17300000-0000-4000-8000-000000000141','17300000-0000-4000-8000-000000000142','17300000-0000-4000-8000-000000000143',pg_temp.p('[{"dimensionKey":"openness","direction":1,"intendedDelta":1}]','major','[{"operation":"revise","entryId":"lira_preference_patrol","text":"dawn patrols with neighbors"},{"operation":"retract","entryId":"lira_preference_maps"}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),14) from pg_temp.f;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.f;
grant select on pg_temp.f to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
create temporary table pg_temp.fr as select public.world_settlement_commit_mutation(s,j,f,p,pg_temp.fp(p),'Lira refines a preference.') result from pg_temp.f;
reset role;
select ok((select current_profile#>>'{entries,12,text}'='dawn patrols with neighbors' and current_profile#>>'{entries,13,active}'='false' from private.world_resident_profiles where instance_id=(select lira from pg_temp.r)),'successful non-core revise and retract mutate only the selected entries');

-- Core entries remain omitted unless a defining core threshold itself crosses.
create temporary table pg_temp.g(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.g values('17300000-0000-4000-8000-000000000151','17300000-0000-4000-8000-000000000152','17300000-0000-4000-8000-000000000153',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":1}]','major','[{"operation":"add","entry":{"id":"lira_value_watchfires","kind":"value","text":"keep watchfires lit","core":true,"active":true}}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),15) from pg_temp.g;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.g;
grant select on pg_temp.g to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
create temporary table pg_temp.gr as select public.world_settlement_commit_mutation(s,j,f,p,pg_temp.fp(p),'No defining change.') result from pg_temp.g;
reset role;
select is((select result->'appliedEntryOperationIndexes' from pg_temp.gr),'[]'::jsonb,'core entry operation is omitted without a defining core crossing');
select ok(not exists(select 1 from private.world_resident_profiles p,jsonb_array_elements(p.current_profile->'entries') x where p.instance_id=(select lira from pg_temp.r) and x->>'id'='lira_value_watchfires'),'omitted core operation does not alter profile');
update private.world_resident_profiles set pressure=jsonb_set(pressure,'{duty}','50') where instance_id=(select lira from pg_temp.r);
create temporary table pg_temp.h(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.h values('17300000-0000-4000-8000-000000000161','17300000-0000-4000-8000-000000000162','17300000-0000-4000-8000-000000000163',pg_temp.p('[{"dimensionKey":"duty","direction":1,"intendedDelta":1}]','defining','[{"operation":"add","entry":{"id":"lira_value_watchfires","kind":"value","text":"keep watchfires lit","core":true,"active":true}}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),16) from pg_temp.h;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.h;
grant select on pg_temp.h to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
create temporary table pg_temp.hr as select public.world_settlement_commit_mutation(s,j,f,p,pg_temp.fp(p),'A defining duty change.') result from pg_temp.h;
reset role;
select is((select result->'appliedEntryOperationIndexes' from pg_temp.hr),'[0]'::jsonb,'defining core crossing applies the core entry operation');

-- Beliefs bind their provenance to frozen evidence and use append-only history.
create temporary table pg_temp.i(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.i values('17300000-0000-4000-8000-000000000171','17300000-0000-4000-8000-000000000172','17300000-0000-4000-8000-000000000173',pg_temp.p('[{"dimensionKey":"openness","direction":1,"intendedDelta":1}]','major','[]',('[{"operation":"add","content":"Torvin kept the road safe.","confidence":80,"provenance":[{"sourceKind":"direct_evidence","sourceId":"evidence-1"}],"originalClaimFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","subjectEntityId":"'||(select torvin::text from pg_temp.r)||'"}]')::jsonb));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),17) from pg_temp.i;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.i;
grant select on pg_temp.i to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
select lives_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'A belief is recorded.'),'frozen-evidence belief addition succeeds') from pg_temp.i;
reset role;
create temporary table pg_temp.belief as select id from private.world_resident_beliefs where instance_id=(select lira from pg_temp.r) and statement='Torvin kept the road safe.';
select is((select count(*)::int from private.world_resident_belief_history where belief_id=(select id from pg_temp.belief)),1,'belief addition appends created history');
select throws_ok($$update private.world_resident_belief_history set event_kind='retired' where belief_id=(select id from pg_temp.belief)$$,'55000',null,'belief history edits are append-only guarded');

-- Retraction requires a reason and an authorized frozen fingerprint, then keeps
-- both the original creation and immutable retirement history.
create temporary table pg_temp.retract(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.retract
select '17300000-0000-4000-8000-000000000174'::uuid,'17300000-0000-4000-8000-000000000175'::uuid,'17300000-0000-4000-8000-000000000176'::uuid,
  pg_temp.p('[{"dimensionKey":"openness","direction":1,"intendedDelta":1}]','major','[]',jsonb_build_array(jsonb_build_object('operation','retract','beliefId',b.id,'reason','Later evidence resolved the claim.','sourceFingerprint',repeat('a',64))))
from pg_temp.belief b;
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),20) from pg_temp.retract;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.retract;
grant select on pg_temp.retract to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
select lives_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'The belief was retired.'),'valid belief retraction commits') from pg_temp.retract;
reset role;
select ok((select not active and contradiction_status='retracted' and retired_at is not null from private.world_resident_beliefs where id=(select id from pg_temp.belief)),'retracted belief is inactive, marked retracted, and timestamped');
select is((select array_agg(event_kind order by id) from private.world_resident_belief_history where belief_id=(select id from pg_temp.belief)),array['created','retired']::text[],'belief retains both created and retired append-only history');

-- Bring preferences to five, then prove a two-add proposal which would exceed
-- the immutable six-entry cap is fully rolled back.
create temporary table pg_temp.cap_seed(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.cap_seed values('17300000-0000-4000-8000-000000000184','17300000-0000-4000-8000-000000000185','17300000-0000-4000-8000-000000000186',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":1}]','major','[{"operation":"add","entry":{"id":"lira_preference_lanterns","kind":"preference","text":"well-trimmed lanterns","core":false,"active":true}}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),21) from pg_temp.cap_seed;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.cap_seed;
grant select on pg_temp.cap_seed to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
select lives_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'One preference is added.'),'cap fixture reaches five active preferences') from pg_temp.cap_seed;
reset role;
select is((select count(*)::int from private.world_resident_profiles p,jsonb_array_elements(p.current_profile->'entries') x where p.instance_id=(select lira from pg_temp.r) and x->>'kind'='preference' and x->>'active'='true'),5,'cap fixture has five active preferences');
create temporary table pg_temp.cap_fail(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.cap_fail values('17300000-0000-4000-8000-000000000187','17300000-0000-4000-8000-000000000188','17300000-0000-4000-8000-000000000189',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":1}]','major','[{"operation":"add","entry":{"id":"lira_preference_cap_one","kind":"preference","text":"clean trail markers","core":false,"active":true}},{"operation":"add","entry":{"id":"lira_preference_cap_two","kind":"preference","text":"fresh water skins","core":false,"active":true}}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),22) from pg_temp.cap_fail;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.cap_fail;
grant select on pg_temp.cap_fail to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'Too many preferences.'),'PT400',null,'two additions that exceed a collection cap reject') from pg_temp.cap_fail;
reset role;
select ok(not exists(select 1 from private.world_resident_mutation_evidence where job_id=(select j from pg_temp.cap_fail)) and not exists(select 1 from private.world_resident_pressure_history where job_id=(select j from pg_temp.cap_fail)) and not exists(select 1 from private.world_resident_mutation_receipts where job_id=(select j from pg_temp.cap_fail)) and not exists(select 1 from private.world_settlement_outbox where job_id=(select j from pg_temp.cap_fail)) and not exists(select 1 from private.world_resident_profiles p,jsonb_array_elements(p.current_profile->'entries') x where p.instance_id=(select lira from pg_temp.r) and x->>'id' in ('lira_preference_cap_one','lira_preference_cap_two')),'cap rejection leaves no evidence, pressure, profile, receipt, or outbox writes');

-- Late invalid entry validation proves a failed call leaves every durable surface unchanged.
create temporary table pg_temp.z(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.z values('17300000-0000-4000-8000-000000000181','17300000-0000-4000-8000-000000000182','17300000-0000-4000-8000-000000000183',pg_temp.p('[{"dimensionKey":"caution","direction":1,"intendedDelta":1}]','major','[{"operation":"add","entry":{"id":"bad_entry","kind":"unknown","text":"bad","core":false,"active":true}}]'));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),18) from pg_temp.z;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.z;
grant select on pg_temp.z to service_role; set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'late-invalid'),'PT400',null,'invalid later entry operation rejects after pressure and evidence are prepared') from pg_temp.z;
reset role;
select ok(not exists(select 1 from private.world_resident_mutation_evidence where job_id=(select j from pg_temp.z)) and not exists(select 1 from private.world_resident_pressure_history where job_id=(select j from pg_temp.z)) and not exists(select 1 from private.world_resident_mutation_receipts where job_id=(select j from pg_temp.z)) and not exists(select 1 from private.world_settlement_outbox where job_id=(select j from pg_temp.z)),'late validation failure leaves evidence, pressure, receipt, and outbox empty');

-- Changed outcomes alone apply social effects; same-kind commands retain input order.
insert into private.world_social_edges(save_id,from_instance_id,to_instance_id,trust,affection,respect,fear,obligation)
select save_id,lira,torvin,90,90,90,90,90 from pg_temp.r;
create temporary table pg_temp.social(s uuid,j uuid,f uuid,p jsonb);
insert into pg_temp.social values('17300000-0000-4000-8000-000000000191','17300000-0000-4000-8000-000000000192','17300000-0000-4000-8000-000000000193',pg_temp.p('[{"dimensionKey":"openness","direction":1,"intendedDelta":1}]','major','[]','[]',('[{"kind":"adjust_relationship","subjectNpcId":"'||(select lira::text from pg_temp.r)||'","objectEntityId":"'||(select torvin::text from pg_temp.r)||'","axis":"trust","delta":25},{"kind":"adjust_relationship","subjectNpcId":"'||(select lira::text from pg_temp.r)||'","objectEntityId":"'||(select torvin::text from pg_temp.r)||'","axis":"trust","delta":25},{"kind":"adjust_relationship","subjectNpcId":"'||(select lira::text from pg_temp.r)||'","objectEntityId":"'||(select torvin::text from pg_temp.r)||'","axis":"affection","delta":25},{"kind":"adjust_relationship","subjectNpcId":"'||(select lira::text from pg_temp.r)||'","objectEntityId":"'||(select torvin::text from pg_temp.r)||'","axis":"respect","delta":25}]')::jsonb));
select pg_temp.case(s,j,f,(select lira from pg_temp.r),(select torvin from pg_temp.r),19) from pg_temp.social;
insert into private.world_settlement_stage_checkpoints(job_id,fence,stage,payload) select j,f,'validated',jsonb_build_object('accepted',true,'proposal',p) from pg_temp.social;
grant select on pg_temp.social to service_role; set local role service_role; set local request.jwt.claim.role='service_role'; select setseed(0.01);
select lives_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',s,j,f,p,pg_temp.fp(p),'Relationships strengthen.'),'changed social proposal commits') from pg_temp.social;
reset role;
select ok((select trust=100 and affection=100 and respect=100 and fear=90 and obligation=90 from private.world_social_edges where save_id=(select save_id from pg_temp.r) and from_instance_id=(select lira from pg_temp.r) and to_instance_id=(select torvin from pg_temp.r)),'social axes clamp independently and only specified axes change');
select is((select array_agg(ordinal order by ordinal) from private.world_social_effect_receipts where job_id=(select j from pg_temp.social)),array[1,2,3,4]::smallint[],'same-kind social commands preserve distinct ordinals');
select is((select count(*)::int from private.world_social_effect_receipts where job_id=(select j from pg_temp.b)),0,'pressure-only receipt has no social state or social receipt');

-- E2's public envelope is present on both the original durable receipt and an
-- exact replay, even when the fence supplied to the replay is stale.
set local role service_role; set local request.jwt.claim.role='service_role';
create temporary table pg_temp.e2_replay as select public.world_settlement_commit_mutation(s,j,'17300000-0000-4000-8000-000000000999',p,pg_temp.fp(p),' prior-fence ') result from pg_temp.b;
reset role;
select is((select result->>'settlementId' from pg_temp.e2_replay),(select s::text from pg_temp.b),'replay echoes requested settlement id');
select is((select result->>'jobId' from pg_temp.e2_replay),(select j::text from pg_temp.b),'replay echoes requested job id');
select is((select result->>'proposalFingerprint' from pg_temp.e2_replay),pg_temp.fp((select p from pg_temp.b)),'replay echoes exact proposal fingerprint');
select is((select result->>'publicDigest' from pg_temp.e2_replay),'prior-fence','replay trims and echoes public digest');
set local role service_role; set local request.jwt.claim.role='service_role';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)','17300000-0000-4000-8000-000000000999',(select j from pg_temp.b),'17300000-0000-4000-8000-000000000999',(select p from pg_temp.b),pg_temp.fp((select p from pg_temp.b)),'prior-fence'),'PT409',null,'replay rejects a job paired with another settlement before core receipt lookup');
reset role;
grant select on pg_temp.b to authenticated;
set local role authenticated; set local request.jwt.claim.role='authenticated';
select throws_ok(format('select public.world_settlement_commit_mutation(%L,%L,%L,%L::jsonb,%L,%L)',(select s from pg_temp.b),(select j from pg_temp.b),(select f from pg_temp.b),(select p from pg_temp.b),pg_temp.fp((select p from pg_temp.b)),'prior-fence'),'42501',null,'public mutation wrapper remains service-only');
select throws_ok(format('select private.world_settlement_commit_mutation_core(%L,%L,%L,%L::jsonb,%L,%L)',(select s from pg_temp.b),(select j from pg_temp.b),(select f from pg_temp.b),(select p from pg_temp.b),pg_temp.fp((select p from pg_temp.b)),'prior-fence'),'42501',null,'authenticated callers cannot execute the private mutation core');
reset role;

select * from finish();
rollback;
