begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function('public','world_quest_transition_memory_scope',array['uuid','uuid'],'transition evidence scope exists');
select ok(not has_function_privilege('authenticated','public.world_quest_transition_memory_scope(uuid,uuid)','execute'),'transition evidence scope is service-only');

insert into auth.users(id,email,role,aud) values('72100000-0000-4000-8000-000000000001','transition-evidence@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision,world_phase) values('72100000-0000-4000-8000-000000000011','72100000-0000-4000-8000-000000000001',4,0,'open');
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.resident as select * from private.world_materialize_resident_from_version('72100000-0000-4000-8000-000000000011','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);
create temporary table pg_temp.prepared as select * from private.world_resolve_quest_step((select id from private.world_quests where save_id='72100000-0000-4000-8000-000000000011'),4,0);
create temporary table pg_temp.terminal as select * from private.world_resolve_quest_step((select quest_id from pg_temp.prepared),5,0);
update public.tavern_saves set current_day=6,world_phase='settling' where id='72100000-0000-4000-8000-000000000011';
create temporary table pg_temp.claimed as select public.world_quest_transition_claim((select id from pg_temp.terminal)) result;

select is((select (public.world_quest_transition_memory_scope((result->>'transitionId')::uuid,(result->>'fence')::uuid)->>'actorId')::uuid from pg_temp.claimed),'72100000-0000-4000-8000-000000000001'::uuid,'scope binds the transition save owner');
select is((select (public.world_quest_transition_memory_scope((result->>'transitionId')::uuid,(result->>'fence')::uuid)->>'cutoffLedgerSequence')::bigint from pg_temp.claimed),(select memory_cutoff_ledger_sequence from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'scope returns the stored immutable cutoff');
select ok((select memory_cutoff_ledger_sequence>=-1 from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'terminal transition persists an immutable cutoff');
select ok((select memory_cutoff_ledger_sequence>=0 from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'terminal source produces a nonnegative stored cutoff');
create temporary table pg_temp.later_source(id uuid);
insert into pg_temp.later_source select extensions.gen_random_uuid();
create temporary table pg_temp.stored_cutoff as select memory_cutoff_ledger_sequence cutoff from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed);
insert into private.world_npc_memory_sources(source_kind,source_id,source_version,save_id,instance_id,ledger_sequence,source_hash,disclosure_class,occurred_day,learned_day,envelope)
select 'hospitality',id,1,'72100000-0000-4000-8000-000000000011',(select (result->>'instanceId')::uuid from pg_temp.claimed),cutoff+1,repeat('c',64),'npc_known',6,6,jsonb_build_object('ledgerSequence',(cutoff+1)::text) from pg_temp.later_source cross join pg_temp.stored_cutoff;
select ok(not exists(select 1 from jsonb_array_elements(public.npc_memory_evidence_retrieve_for_actor('72100000-0000-4000-8000-000000000001',(select (result->>'instanceId')::uuid from pg_temp.claimed),'transition',(select memory_cutoff_ledger_sequence from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'',array[]::text[],1,1,16)->'sourceManifest') manifest where manifest->>'sourceId'=(select id::text from pg_temp.later_source)),'stored cutoff excludes a later ledger source from shared evidence');

create temporary table pg_temp.memory_checkpoint as select public.world_quest_transition_checkpoint((result->>'transitionId')::uuid,(result->>'fence')::uuid,'memory_context',jsonb_build_object('evidence',jsonb_build_object('version','v4'),'budget',jsonb_build_object('utf8Bytes',1,'inputTokens',1))) result from pg_temp.claimed;
select is((select public.world_quest_transition_checkpoint((result->>'transitionId')::uuid,(result->>'fence')::uuid,'memory_context',jsonb_build_object('evidence',jsonb_build_object('version','v4'),'budget',jsonb_build_object('utf8Bytes',1,'inputTokens',1))) from pg_temp.claimed),(select result from pg_temp.memory_checkpoint),'same memory context replays exactly');
select throws_ok($$select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'memory_context',jsonb_build_object('different',true))$$,'PT409',null,'divergent memory context replay is rejected');
select throws_ok($$select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'memory_context',jsonb_build_object('x',repeat('x',524289)))$$,'PT400',null,'memory context has a 512KiB hard byte cap');
select throws_ok($$select public.world_quest_transition_checkpoint((select (result->>'transitionId')::uuid from pg_temp.claimed),(select (result->>'fence')::uuid from pg_temp.claimed),'proposer',jsonb_build_object('x',repeat('x',16385)))$$,'PT400',null,'provider checkpoints retain their smaller byte cap');
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at) values('72100000-0000-4000-8000-000000000099','72100000-0000-4000-8000-000000000011',3,0,'live-transition-deadline','queued',clock_timestamp()-interval '1 second');
insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint) values('72100000-0000-4000-8000-000000000099',1,'snapshot','live-transition-deadline');
select is((public.world_settlement_claim('72100000-0000-4000-8000-000000000099')->>'status'),'expired','deadline terminalizes while a transition is live');
select is((select world_phase from public.tavern_saves where id='72100000-0000-4000-8000-000000000011'),'settling','deadline never bypasses a live transition lease');
update private.world_quest_transitions set lease_until=clock_timestamp()-interval '1 second' where id=(select (result->>'transitionId')::uuid from pg_temp.claimed);
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at) values('72100000-0000-4000-8000-000000000100','72100000-0000-4000-8000-000000000011',4,0,'expired-transition-deadline','queued',clock_timestamp()-interval '1 second');
insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint) values('72100000-0000-4000-8000-000000000100',1,'snapshot','expired-transition-deadline');
select is((public.world_settlement_claim('72100000-0000-4000-8000-000000000100')->>'status'),'expired','deadline accepts an expired transition lease');
select is((select status from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'awaiting','expired transition is deferred awaiting');
select ok((select fence is null and lease_until is null and next_eligible_day>6 from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'expired transition fence is cleared and next opening advances');
select is((select world_phase from public.tavern_saves where id='72100000-0000-4000-8000-000000000011'),'open','expired transition deferral reopens the save');
update private.world_quest_transitions set next_eligible_day=(select current_day from public.tavern_saves where id='72100000-0000-4000-8000-000000000011') where id=(select (result->>'transitionId')::uuid from pg_temp.claimed);
update public.tavern_saves set world_phase='settling' where id='72100000-0000-4000-8000-000000000011';
insert into private.world_settlements(id,save_id,day_number,source_revision,input_fingerprint,status,deadline_at) values('72100000-0000-4000-8000-000000000101','72100000-0000-4000-8000-000000000011',5,0,'awaiting-transition-deadline','queued',clock_timestamp()-interval '1 second');
insert into private.world_settlement_jobs(settlement_id,ordinal,job_kind,input_fingerprint) values('72100000-0000-4000-8000-000000000101',1,'snapshot','awaiting-transition-deadline');
select is((public.world_settlement_claim('72100000-0000-4000-8000-000000000101')->>'status'),'expired','deadline defers a due awaiting transition');
select ok((select next_eligible_day>(select current_day from public.tavern_saves where id='72100000-0000-4000-8000-000000000011') from private.world_quest_transitions where id=(select (result->>'transitionId')::uuid from pg_temp.claimed)),'awaiting transition advances again without narrative completion');
select is((select world_phase from public.tavern_saves where id='72100000-0000-4000-8000-000000000011'),'open','awaiting transition deferral reopens the later save');
select * from finish();
rollback;
