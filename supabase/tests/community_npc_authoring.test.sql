begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id,email,role,aud) values
 ('18100000-0000-4000-8000-000000000041','authoring-owner@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000042','authoring-reviewer@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000043','authoring-other@example.test','authenticated','authenticated'),
 ('18100000-0000-4000-8000-000000000044','authoring-admin@example.test','authenticated','authenticated');
insert into private.npc_capabilities(user_id,capability) values
 ('18100000-0000-4000-8000-000000000041','npc_author'),
 ('18100000-0000-4000-8000-000000000042','npc_reviewer'),
 ('18100000-0000-4000-8000-000000000044','admin');

create temporary table pg_temp.authoring_sheet as
  select jsonb_set(sheet,'{identity,name}','"Workshop Scout"'::jsonb) sheet from private.npc_versions where id='18181818-1818-4181-8181-181818181819';
grant select on pg_temp.authoring_sheet to authenticated;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select public.npc_update_profile('Workshop Owner','Tests the NPC workshop safely.',false,false,true);
create temporary table pg_temp.authoring_ids as
  select (public.npc_author_create((select sheet from pg_temp.authoring_sheet))->>'npcId')::uuid npc_id;
select is((public.npc_author_workspace_detail((select npc_id from pg_temp.authoring_ids))#>>'{draft,revision}'),'0','owner can read their complete typed workspace detail');
create temporary table pg_temp.assist as
  select public.npc_author_request_assistance((select npc_id from pg_temp.authoring_ids),0,'identity','Make the voice a little more formal.') value;
select throws_ok(format('select public.npc_author_request_assistance(%L::uuid,0,%L,%L)',(select npc_id from pg_temp.authoring_ids),'unknown','No'),'PT400',null,'assistance only targets whitelisted sections');
reset role;

set local request.jwt.claim.role='service_role';
select public.npc_author_assistance_complete((select (value->>'jobId')::uuid from pg_temp.assist),jsonb_build_object('replacement',jsonb_set((select sheet->'identity' from pg_temp.authoring_sheet),'{voice}','"Formal, precise, and measured."'::jsonb)));
reset request.jwt.claim.role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select is((public.npc_author_assistance_status((select (value->>'assistanceEventId')::uuid from pg_temp.assist))->>'disposition'),'proposed','service completion leaves an explicit proposed assistance event');
select is((public.npc_author_assistance_disposition((select (value->>'assistanceEventId')::uuid from pg_temp.assist),0,true)->>'revision'),'1','accepted full-sheet-valid assistance advances draft revision once');
select throws_ok(format('select public.npc_author_assistance_disposition(%L::uuid,0,true)',(select (value->>'assistanceEventId')::uuid from pg_temp.assist)),'PT409',null,'an assistance proposal cannot be accepted twice');
create temporary table pg_temp.scene as
  select public.npc_author_request_scene((select npc_id from pg_temp.authoring_ids),1,'A lantern-lit scout in the Millhaven tavern.',1) value;
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.scene_done as select public.npc_author_scene_complete(
  (select (value->>'jobId')::uuid from pg_temp.scene),
  '[{"storageKey":"runtime-derivatives/npcs/workshop-scout.webp","altText":"A scout holding a lantern in the tavern."},{"storageKey":"runtime-derivatives/npcs/workshop-scout-alt.webp","altText":"A scout studying a lantern in the tavern."}]'::jsonb
) value;
grant select on pg_temp.scene_done to authenticated;
reset request.jwt.claim.role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select is((public.npc_author_select_scene((select npc_id from pg_temp.authoring_ids),1,(select (value#>>'{candidates,1,assetId}')::uuid from pg_temp.scene_done))->>'revision'),'2','owner may select any generated scene candidate they own');
select throws_ok(format('select public.npc_author_select_scene(%L::uuid,2,%L::uuid)',(select npc_id from pg_temp.authoring_ids),'18181818-1818-4181-8181-181818181819'),'PT422',null,'a version UUID cannot be substituted for an owned scene asset');
create temporary table pg_temp.stale_assist as select public.npc_author_request_assistance((select npc_id from pg_temp.authoring_ids),2,'identity','Make it stale.') value;
reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_assistance_complete((select (value->>'jobId')::uuid from pg_temp.stale_assist),jsonb_build_object('replacement',jsonb_set((select sheet->'identity' from pg_temp.authoring_sheet),'{title}','"Road Warden"'::jsonb)));
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select public.npc_author_save((select npc_id from pg_temp.authoring_ids),2,(select sheet from pg_temp.authoring_sheet));
select throws_ok(format('select public.npc_author_assistance_disposition(%L::uuid,3,true)',(select (value->>'assistanceEventId')::uuid from pg_temp.stale_assist)),'PT409',null,'an older assistance result remains readable but cannot mutate a newer draft');
create temporary table pg_temp.stale_scene as select public.npc_author_request_scene((select npc_id from pg_temp.authoring_ids),3,'A newer scene candidate that will become stale before selection.',2) value;
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.stale_scene_done as select public.npc_author_scene_complete((select (value->>'jobId')::uuid from pg_temp.stale_scene),'[{"storageKey":"runtime-derivatives/npcs/stale.webp","altText":"A stale scene candidate in the tavern."}]'::jsonb) value;
grant select on pg_temp.stale_scene_done to authenticated;
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select public.npc_author_save((select npc_id from pg_temp.authoring_ids),3,(select sheet from pg_temp.authoring_sheet));
select throws_ok(format('select public.npc_author_select_scene(%L::uuid,4,%L::uuid)',(select npc_id from pg_temp.authoring_ids),(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.stale_scene_done)),'PT409',null,'a scene candidate from an older draft cannot be selected');
create temporary table pg_temp.sandbox as select public.npc_author_sandbox_start((select npc_id from pg_temp.authoring_ids),4) value;
create temporary table pg_temp.sandbox_turn as
  select public.npc_author_sandbox_send((select (value->>'sandboxId')::uuid from pg_temp.sandbox),'What do you know about the old road?') value;
reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_sandbox_complete((select (value->>'jobId')::uuid from pg_temp.sandbox_turn),'The old road is quiet, but I still watch it.');
reset request.jwt.claim.role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select is((public.npc_author_sandbox_status((select (value->>'sandboxId')::uuid from pg_temp.sandbox))#>>'{turns,1,content}'),'The old road is quiet, but I still watch it.','sandbox output remains isolated in its ordered transcript');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000043';
select throws_ok(format('select public.npc_author_workspace_detail(%L::uuid)',(select npc_id from pg_temp.authoring_ids)),'PT403',null,'another authenticated user cannot inspect a creator workspace');
reset role;

-- Submit a clean successor and make its reviewer detail/comment boundary observable.
reset role;
set local request.jwt.claim.role='service_role';
select public.npc_author_set_portrait_provider_status(true,'openai','deterministic-fixture');
select public.npc_author_register_setting_asset('c0370000-0000-4000-8000-000000000001','community-settings/lantern-lit-tavern-table.webp','image/webp',1600,900,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select public.npc_author_select_setting((select npc_id from pg_temp.authoring_ids),4,'c0370000-0000-4000-8000-000000000001');
create temporary table pg_temp.portrait_request as select public.npc_author_request_portrait((select npc_id from pg_temp.authoring_ids),5,'{}'::jsonb,1) value;
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.portrait_complete as select public.npc_author_portrait_complete((select (value->>'jobId')::uuid from pg_temp.portrait_request),jsonb_build_array(jsonb_build_object('ordinal',1,'storageKey','community-portraits/workshop-scout.webp','masterStorageKey','source-masters/portraits/workshop-scout.png','masterSha256','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','referenceSetHash','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','requestId','workshop-portrait','altText','A full-body workshop scout in a warm tavern pose.','mimeType','image/webp','width',1024,'height',1536,'byteSize',120000,'sha256','1111111111111111111111111111111111111111111111111111111111111111','alphaValid',true,'visualInputHash',(select value->>'visualInputHash' from pg_temp.portrait_request),'provider','deterministic','model','fixture','promptHash','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1'))) value;
grant select on pg_temp.portrait_complete to authenticated;
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000041';
select public.npc_author_select_portrait((select npc_id from pg_temp.authoring_ids),5,(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.portrait_complete));
create temporary table pg_temp.submission as select public.npc_author_submit((select npc_id from pg_temp.authoring_ids),6) value;
reset role;
update private.npc_evaluations set status='completed',result='{"hardBlocks":[],"prohibited":false}'::jsonb where version_id=(select (value->>'versionId')::uuid from pg_temp.submission);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000042';
select is((public.npc_reviewer_submission((select (value->>'versionId')::uuid from pg_temp.submission))->>'versionId'),(select value->>'versionId' from pg_temp.submission),'unrelated reviewer sees submitted immutable detail');
select throws_ok(format('select public.npc_reviewer_comment(%L::uuid,%L::uuid,%L,%L)',(select npc_id from pg_temp.authoring_ids),(select (value->>'versionId')::uuid from pg_temp.submission),'not-a-section','No.'),'PT422',null,'review comments require a known editable section and matching version');
select public.npc_reviewer_comment((select npc_id from pg_temp.authoring_ids),(select (value->>'versionId')::uuid from pg_temp.submission),'identity','Please make the title more specific.');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000044';
select public.npc_admin_set_capability('18100000-0000-4000-8000-000000000043','npc_author',true,'Fixture access grant.');
select ok(jsonb_array_length(public.npc_admin_audit(null,100,null)) > 0,'authoring governance actions are visible in the admin audit');
reset role;

select throws_ok($$select public.npc_author_scene_complete('18181818-1818-4181-8181-181818181819','[]'::jsonb)$$,'PT403',null,'browser callers cannot complete provider jobs');
select is((select public.npc_share_view(extensions.gen_random_uuid()))::text,null,'anonymous share view returns no data for an unknown immutable token');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18100000-0000-4000-8000-000000000043';
select throws_ok($$select public.npc_admin_audit(null,10,null)$$,'PT403',null,'non-admin callers cannot inspect governance audit records');
reset role;
select * from finish();
rollback;
