begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,role,aud) values
 ('62000000-0000-4000-8000-000000000001','prompt-admin@example.test','authenticated','authenticated'),
 ('62000000-0000-4000-8000-000000000002','prompt-manager@example.test','authenticated','authenticated'),
 ('62000000-0000-4000-8000-000000000003','prompt-author@example.test','authenticated','authenticated') on conflict do nothing;
insert into private.npc_capabilities(user_id,capability,granted_by) values
 ('62000000-0000-4000-8000-000000000001','admin','62000000-0000-4000-8000-000000000001'),
 ('62000000-0000-4000-8000-000000000002','prompt_manager','62000000-0000-4000-8000-000000000001') on conflict do nothing;

select is((select count(*) from private.prompt_registry_manifest),26::bigint,'all closed prompt keys are registered');
select is((select count(*) from private.prompt_revisions where revision_number=1),26::bigint,'release 1 has exact immutable revisions');
select is((select count(*) from private.prompt_registry_active_release),1::bigint,'one active release is seeded');
select is((select count(*) from private.prompt_release_entries where release_id=(select release_id from private.prompt_registry_active_release)),26::bigint,'active release is complete');
select throws_ok($$update private.prompt_revisions set body='nope'$$,'55000',null,'revisions are immutable');
select throws_ok($$delete from private.prompt_releases$$,'55000',null,'releases are immutable');
select extensions.hasnt_column('private','prompt_governance_audit','body','audit has no prompt body column');
select extensions.hasnt_column('private','prompt_execution_ledger','payload','ledger has no arbitrary payload column');

select set_config('test.active_release',(select release_id::text from private.prompt_registry_active_release),true);
select set_config('test.speak_revision',(select e.revision_id::text from private.prompt_registry_active_release a join private.prompt_release_entries e on e.release_id=a.release_id where e.prompt_key='dialogue.speak'),true);
select set_config('test.speak_contract',(select contract_hash from private.prompt_registry_manifest where prompt_key='dialogue.speak'),true);
select set_config('test.art_revision',(select e.revision_id::text from private.prompt_registry_active_release a join private.prompt_release_entries e on e.release_id=a.release_id where e.prompt_key='image.runtime_art'),true);
select set_config('test.art_contract',(select contract_hash from private.prompt_registry_manifest where prompt_key='image.runtime_art'),true);

set local role authenticated;
set local request.jwt.claim.sub='62000000-0000-4000-8000-000000000003';
select throws_ok($$select public.prompt_registry_summary()$$,'PT403',null,'ordinary author cannot access registry');
select throws_ok($$select * from private.prompt_revisions$$,'42501',null,'browser role cannot read private prompt rows');

set local request.jwt.claim.sub='62000000-0000-4000-8000-000000000002';
select ok((public.prompt_registry_summary() ? 'activeReleaseId'),'prompt manager receives summary');
select throws_ok(format($sql$select public.prompt_registry_create_candidate('image.runtime_art','bad {{unknown}}','runtime-art-v1',%L::text,%L::uuid,'bad template')$sql$,current_setting('test.art_contract'),current_setting('test.art_revision')),'PT400',null,'unknown template variable rejected');
select throws_ok(format($sql$select public.prompt_registry_create_candidate('dialogue.speak','Candidate response prompt.','dialogue-speak-v1',%L::text,%L::uuid,'stale')$sql$,current_setting('test.speak_contract'),'62000000-0000-4000-8000-000000000099'),'PT409',null,'stale candidate parent rejected');
select set_config('test.candidate',(public.prompt_registry_create_candidate('dialogue.speak','Candidate response prompt.','dialogue-speak-v1',current_setting('test.speak_contract'),current_setting('test.speak_revision')::uuid,'Focused wording change')->>'revisionId'),true);
select throws_ok(format($sql$select public.prompt_registry_activate(%L::uuid,'Candidate release',jsonb_build_object('dialogue.speak',%L::text),'[]'::jsonb,'Exercise warnings')$sql$,current_setting('test.active_release'),current_setting('test.candidate')),'PT400',null,'safety warning requires acknowledgement');
select set_config('test.candidate_release',(public.prompt_registry_activate(current_setting('test.active_release')::uuid,'Candidate release',jsonb_build_object('dialogue.speak',current_setting('test.candidate')),'["safety_language_changed"]'::jsonb,'Exercise atomic release')->>'releaseId'),true);
select is(jsonb_array_length(public.prompt_registry_summary()->'prompts'),26,'activation keeps a complete release');
select throws_ok(format($sql$select public.prompt_registry_activate(%L::uuid,'Stale release','{"dialogue.speak":"%s"}'::jsonb,'["safety_language_changed"]'::jsonb,'Must conflict')$sql$,current_setting('test.active_release'),current_setting('test.candidate')),'PT409',null,'active release conflict protects concurrent activation');
select set_config('test.restored_release',(public.prompt_registry_restore(current_setting('test.candidate_release')::uuid,current_setting('test.active_release')::uuid,'Restored baseline','[]'::jsonb,'Restore known baseline')->>'releaseId'),true);
select is((select count(*) from jsonb_array_elements(public.prompt_registry_recent_runs())),0::bigint,'safe run list starts empty');
select throws_ok($$select public.npc_admin_set_capability('62000000-0000-4000-8000-000000000003','prompt_manager',true,'not admin')$$,'PT403',null,'prompt manager cannot grant capabilities');
reset role;

select is((select count(*) from private.prompt_governance_audit where event_kind='release_restored'),1::bigint,'restore has its own audit event');
select is((select restored_from_release_id::text from private.prompt_releases where id=current_setting('test.restored_release')::uuid),current_setting('test.active_release'),'restore release retains source provenance');

set local role authenticated;
set local request.jwt.claim.sub='62000000-0000-4000-8000-000000000001';
select lives_ok($$select public.npc_admin_set_capability('62000000-0000-4000-8000-000000000003','prompt_manager',true,'test grant')$$,'admin grants prompt-manager capability');
reset role;
select ok(private.has_npc_capability('prompt_manager','62000000-0000-4000-8000-000000000003'),'admin grant persisted');

insert into private.prompt_execution_ledger(execution_id,attempt,workflow,node_key,prompt_key,release_id,revision_id,status,occurred_at)
values('fixture:expired:dialogue',0,'dialogue','dialogue.speak','dialogue.speak',current_setting('test.restored_release')::uuid,current_setting('test.speak_revision')::uuid,'completed',clock_timestamp()-interval '31 days');
set local role service_role;
set local request.jwt.claim.role='service_role';
select set_config('test.resolved',(public.prompt_registry_service_resolve(current_setting('test.restored_release')::uuid))::text,true);
select is((select count(*) from jsonb_object_keys(current_setting('test.resolved')::jsonb->'prompts')),26::bigint,'service resolver returns complete immutable snapshot');
select lives_ok(format($sql$select public.prompt_registry_service_record_run('fixture:dialogue:turn',1,'dialogue','dialogue.speak','dialogue.speak',%L::uuid,%L::uuid,'completed','fixture',10,1,1,null)$sql$,current_setting('test.restored_release'),current_setting('test.speak_revision')),'service records allow-listed safe event');
reset role;
reset request.jwt.claim.role;
select is((select count(*) from private.prompt_execution_ledger),1::bigint,'service insertion prunes expired events');

create temporary table prompt_pin_fixture(prompt_release_id uuid);
create trigger prompt_registry_pin_release before insert on prompt_pin_fixture for each row execute function private.prompt_registry_pin_active_release();
insert into prompt_pin_fixture default values;
select is((select prompt_release_id::text from prompt_pin_fixture),current_setting('test.restored_release'),'future durable work pins the active release');

select * from finish();
rollback;
