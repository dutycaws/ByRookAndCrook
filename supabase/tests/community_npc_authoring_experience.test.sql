begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users(id,email,role,aud) values
 ('18100000-0000-4000-8000-000000000071','workspace-owner@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000072','workspace-reviewer@example.test','authenticated','authenticated');
insert into private.npc_capabilities(user_id,capability) values
 ('18100000-0000-4000-8000-000000000071','npc_author'),
 ('18100000-0000-4000-8000-000000000072','npc_reviewer');
create temporary table pg_temp.sheet as select jsonb_set(sheet,'{identity,name}','"Experience Scout"'::jsonb) sheet from private.npc_versions where id='18181818-1818-4181-8181-181818181819';
grant select on pg_temp.sheet to authenticated;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';
select public.npc_update_profile('Experience Owner','Tests typed authoring contracts safely.',false,false,true);
create temporary table pg_temp.ids as select (public.npc_author_create((select sheet from pg_temp.sheet))->>'npcId')::uuid npc_id;
select ok((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'draft'->>'editable')::boolean,'empty lifecycle exposes an editable typed draft');
select is(public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'capabilities'->>'submitReason','Choose a setting before submitting','workspace explains a missing submission prerequisite');
select ok(jsonb_typeof(public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'eligibleNpcs')='array','workspace exposes eligible NPC references without IDs in editor fields');

create temporary table pg_temp.assistance as select public.npc_author_request_assistance((select npc_id from pg_temp.ids),0,'identity','Make the voice considerably more formal.') value;
reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_assistance_complete((select (value->>'jobId')::uuid from pg_temp.assistance),jsonb_build_object('replacement',jsonb_set((select sheet->'identity' from pg_temp.sheet),'{title}','"Formal Scout"'::jsonb)));
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';
select ok((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'assistance'->0->>'actionable')::boolean,'fresh assistance exposes a typed actionable proposal');
select is((public.npc_author_assistance_disposition((select (value->>'assistanceEventId')::uuid from pg_temp.assistance),0,true)->>'revision'),'1','applying assistance advances the authoritative draft revision');

create temporary table pg_temp.stale_assistance as select public.npc_author_request_assistance((select npc_id from pg_temp.ids),1,'identity','Suggest another distinct formal title.') value;
reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_assistance_complete((select (value->>'jobId')::uuid from pg_temp.stale_assistance),jsonb_build_object('replacement',jsonb_set((select sheet->'identity' from pg_temp.sheet),'{title}','"Stale Scout"'::jsonb)));
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';

create temporary table pg_temp.sandbox as select public.npc_author_sandbox_start((select npc_id from pg_temp.ids),1) value;
select is((select value->>'state' from pg_temp.sandbox),'ready','sandbox starts as a revision-pinned ready session');
create temporary table pg_temp.turn as select public.npc_author_sandbox_send((select (value->>'sandboxId')::uuid from pg_temp.sandbox),'What do you know about the old road?') value;
select throws_ok(format('select public.npc_author_sandbox_send(%L::uuid,%L)',(select (value->>'sandboxId')::uuid from pg_temp.sandbox),'Are you still there?'),'PT409',null,'only one sandbox message may be pending');
reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_sandbox_complete((select (value->>'jobId')::uuid from pg_temp.turn),'The old road is quiet, but I still watch it.');
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';
select is((public.npc_author_sandbox_status((select (value->>'sandboxId')::uuid from pg_temp.sandbox))->'turns'->1->>'role'),'npc','sandbox appends the NPC reply in turn order');
select is((public.npc_author_sandbox_status((select (value->>'sandboxId')::uuid from pg_temp.sandbox))->'turns'->1->>'content'),'The old road is quiet, but I still watch it.','sandbox preserves ordered completed replies');
select public.npc_author_save((select npc_id from pg_temp.ids),1,(select sheet from pg_temp.sheet));
select is((public.npc_author_sandbox_status((select (value->>'sandboxId')::uuid from pg_temp.sandbox))->>'state'),'invalidated','saving a draft invalidates its active sandbox');
select ok(not (public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'assistance'->0->>'actionable')::boolean,'a proposal from a saved-over revision is visibly out of date');
select throws_ok(format('select public.npc_author_assistance_disposition(%L::uuid,2,true)',(select (value->>'assistanceEventId')::uuid from pg_temp.stale_assistance)),'PT409',null,'stale assistance cannot overwrite a newer draft');

reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_set_portrait_provider_status(true,'openai','deterministic-fixture');
select public.npc_author_register_setting_asset('c0370000-0000-4000-8000-000000000001','community-settings/lantern-lit-tavern-table.webp','image/webp',1600,900,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';
select public.npc_author_select_setting((select npc_id from pg_temp.ids),2,'c0370000-0000-4000-8000-000000000001');
create temporary table pg_temp.portrait_request as select public.npc_author_request_portrait((select npc_id from pg_temp.ids),3,'{}'::jsonb,1) value;
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.portrait_complete as select public.npc_author_portrait_complete((select (value->>'jobId')::uuid from pg_temp.portrait_request),jsonb_build_array(jsonb_build_object('ordinal',1,'storageKey','community-portraits/experience-scout.webp','masterStorageKey','source-masters/portraits/experience-scout.png','masterSha256','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','referenceSetHash','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','requestId','experience-portrait','altText','A full-body scout in a warm tavern pose.','mimeType','image/webp','width',1024,'height',1536,'byteSize',120000,'sha256','1111111111111111111111111111111111111111111111111111111111111111','alphaValid',true,'visualInputHash',(select value->>'visualInputHash' from pg_temp.portrait_request),'provider','deterministic','model','fixture','promptHash','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1'))) value;
grant select on pg_temp.portrait_complete to authenticated;
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';
select public.npc_author_select_portrait((select npc_id from pg_temp.ids),3,(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.portrait_complete));
create temporary table pg_temp.submit as select public.npc_author_submit((select npc_id from pg_temp.ids),4) value;
select is((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'versions'->0->>'state'),'submitted','immutable submission is visible in typed version history');
select is((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'capabilities'->>'editReason'),'Draft is read-only after submission','submitted lifecycle gives an author-readable edit reason');
select throws_ok(format('update private.npc_versions set sheet=%L::jsonb where id=%L::uuid','{}',(select value->>'versionId' from pg_temp.submit)),null,null,'submitted version content remains immutable');

-- retirement is a governed idempotent request, not immediate deletion.
select public.npc_author_request_retirement((select npc_id from pg_temp.ids),'The author wants this prototype character to leave the community pool.') as retirement_one \gset
select is((public.npc_author_request_retirement((select npc_id from pg_temp.ids),'A second valid rationale must return the existing governed request.')->>'requestId'),:'retirement_one'::jsonb->>'requestId','retirement duplicate returns the existing open request');
select is((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'retirement'->>'status'),'open','typed workspace exposes the pending retirement state');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000072';
select public.npc_reviewer_retirement((:'retirement_one'::jsonb->>'requestId')::uuid,false,'Keep this prototype NPC available for the authoring test.');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000071';
select is((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'retirement'->>'decisionReason'),'Keep this prototype NPC available for the authoring test.','resolved retirement exposes the reviewer decision reason');

reset role;
select * from finish();
rollback;
