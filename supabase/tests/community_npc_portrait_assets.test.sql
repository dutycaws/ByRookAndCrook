begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users(id,email,role,aud) values
 ('18370000-0000-4000-8000-000000000001','portrait-author@example.test','authenticated','authenticated'),
 ('18370000-0000-4000-8000-000000000002','portrait-reviewer@example.test','authenticated','authenticated'),
 ('18370000-0000-4000-8000-000000000003','portrait-other@example.test','authenticated','authenticated');
insert into private.npc_capabilities(user_id,capability) values
 ('18370000-0000-4000-8000-000000000001','npc_author'),
 ('18370000-0000-4000-8000-000000000002','npc_reviewer'),
 ('18370000-0000-4000-8000-000000000003','npc_author');
create temporary table pg_temp.sheet as
  select jsonb_set(sheet,'{identity,name}','"Portrait Scout"'::jsonb) sheet from private.npc_versions where id='18181818-1818-4181-8181-181818181819';
grant select on pg_temp.sheet to authenticated;

set local request.jwt.claim.role='service_role';
select public.npc_author_set_portrait_provider_status(true,'openai','deterministic-fixture');
select public.npc_author_register_setting_asset('c0370000-0000-4000-8000-000000000001','community-settings/lantern-lit-tavern-table.webp','image/webp',1600,900,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select public.npc_author_register_setting_asset('c0370000-0000-4000-8000-000000000002','community-settings/hearth-side-booth.webp','image/webp',1600,900,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select public.npc_author_register_setting_asset('c0370000-0000-4000-8000-000000000003','community-settings/quiet-window-table.webp','image/webp',1600,900,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
reset request.jwt.claim.role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
select public.npc_update_profile('Portrait Author','Tests safe portrait authoring contracts.',false,false,true);
create temporary table pg_temp.ids as select (public.npc_author_create((select sheet from pg_temp.sheet))->>'npcId')::uuid npc_id;

select is(jsonb_array_length(public.npc_author_list_settings()),3,'all authors can list the three curated setting choices');
select throws_ok($$insert into private.npc_setting_library(id,setting_key,label,description,alt_text,storage_key,sha256) values(extensions.gen_random_uuid(),'intruder','Intruder','An unauthorized setting library entry.','An unauthorized setting without characters.','intruder.webp','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,null,null,'authors cannot mutate the project setting library');
create temporary table pg_temp.portrait_request as
  select public.npc_author_request_portrait((select npc_id from pg_temp.ids),0,'{}'::jsonb,2) value;
select is((select value->>'remainingCredits' from pg_temp.portrait_request),'8','a two-alternative portrait batch reserves exactly two of ten daily credits');
select ok((select value->>'visualInputHash' from pg_temp.portrait_request) ~ '^[0-9a-f]{64}$','portrait request exposes a canonical visual input hash');

reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.complete as select public.npc_author_portrait_complete(
 (select (value->>'jobId')::uuid from pg_temp.portrait_request),
 jsonb_build_array(
  jsonb_build_object('ordinal',1,'storageKey','community-portraits/test-one.webp','masterStorageKey','source-masters/portraits/test-one.png','masterSha256','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','referenceSetHash','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','requestId','fixture-portrait-one','altText','A full-body ranger in a relaxed pose.','mimeType','image/webp','width',1024,'height',1536,'byteSize',120000,'sha256','1111111111111111111111111111111111111111111111111111111111111111','alphaValid',true,'visualInputHash',(select value->>'visualInputHash' from pg_temp.portrait_request),'provider','deterministic','model','fixture','promptHash','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1'),
  jsonb_build_object('ordinal',2,'failureCode','UPSTREAM_TIMEOUT')
 )) value;
grant select on pg_temp.complete to authenticated;
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
create temporary table pg_temp.complete_status as select public.npc_author_portrait_status((select (value->>'jobId')::uuid from pg_temp.complete)) value;
select is(jsonb_array_length((select value->'candidates' from pg_temp.complete_status)),2,'author status exposes two safe portrait candidates after service completion');
select ok(not (((select c.value from pg_temp.complete_status c)->'candidates'->0)::text like '%storageKey%'),'portrait candidate DTO never exposes a raw storage key');
select ok((select value#>>'{candidates,0,previewToken}' from pg_temp.complete_status) ~* '^[0-9a-f-]{36}$' and (select value#>>'{candidates,0,previewToken}' from pg_temp.complete_status)<>(select value#>>'{candidates,0,id}' from pg_temp.complete_status),'candidate preview uses a distinct opaque grant token');
select is(public.npc_author_portrait_preview_authorization((select (value#>>'{candidates,0,previewToken}')::uuid from pg_temp.complete_status))->>'assetId',(select value#>>'{candidates,0,assetId}' from pg_temp.complete_status),'preview authorization resolves only the selected token to its asset');
select is(public.npc_author_select_portrait((select npc_id from pg_temp.ids),0,(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.complete_status))->>'revision','1','author explicitly selects a current valid portrait');
select is(public.npc_author_select_setting((select npc_id from pg_temp.ids),1,'c0370000-0000-4000-8000-000000000001')->>'revision','2','author selects an immutable curated setting reference');
select is(public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'portrait'->'activeBatch'->>'status','partial','a partial portrait batch remains visible after completion');
select ok((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'capabilities'->>'canSubmit')::boolean,'both required current visual assets enable submission');

-- Lore edits are deliberately absent from visual input hashing and retain a selection.
create temporary table pg_temp.lore_sheet as select jsonb_set(sheet,'{lore,facts,0,text}','"Lira guarded the old road for years before this journey."'::jsonb) sheet from pg_temp.sheet;
select is(public.npc_author_save((select npc_id from pg_temp.ids),2,(select sheet from pg_temp.lore_sheet))->>'portraitInvalidated','false','a lore-only edit preserves a selected portrait');
create temporary table pg_temp.visual_sheet as select jsonb_set(sheet,'{appearance,mood}','"Alert and visibly rain-soaked after a long patrol."'::jsonb) sheet from pg_temp.lore_sheet;
select is(public.npc_author_save((select npc_id from pg_temp.ids),3,(select sheet from pg_temp.visual_sheet))->>'portraitInvalidated','true','an appearance edit invalidates portrait selection');
select is((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'portrait'->>'selectedAssetId'),null,'visual mutation clears the draft portrait selection');
select throws_ok(format('select public.npc_author_submit(%L::uuid,4)',(select npc_id from pg_temp.ids)),'PT422',null,'submission independently rejects a stale or missing portrait');

-- The same setting reference can be retained; only a fresh portrait is required.
create temporary table pg_temp.fresh_request as select public.npc_author_request_portrait((select npc_id from pg_temp.ids),4,'{}'::jsonb,1) value;
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.fresh_complete as select public.npc_author_portrait_complete(
 (select (value->>'jobId')::uuid from pg_temp.fresh_request),
 jsonb_build_array(jsonb_build_object('ordinal',1,'storageKey','community-portraits/test-fresh.webp','masterStorageKey','source-masters/portraits/test-fresh.png','masterSha256','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','referenceSetHash','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','requestId','fixture-portrait-fresh','altText','A full-body rain-soaked ranger in a guarded pose.','mimeType','image/webp','width',1024,'height',1536,'byteSize',120000,'sha256','3333333333333333333333333333333333333333333333333333333333333333','alphaValid',true,'visualInputHash',(select value->>'visualInputHash' from pg_temp.fresh_request),'provider','deterministic','model','fixture','promptHash','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','styleVersion','community-npc-portrait-sprite-v1','referenceSetVersion','brac-character-look-v1'))
) value;
grant select on pg_temp.fresh_complete to authenticated;
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
create temporary table pg_temp.fresh_status as select public.npc_author_portrait_status((select (value->>'jobId')::uuid from pg_temp.fresh_complete)) value;
select is(public.npc_author_select_portrait((select npc_id from pg_temp.ids),4,(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.fresh_status))->>'revision','5','fresh portrait selection is revision guarded');

-- Optional expressions are independently selected, but remain anchored to
-- Neutral.  A Neutral replacement atomically removes optional selections and
-- requires an explicit stale re-confirmation.
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.expression_candidates as
with optional_asset as (
  insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by,media_state,mime_type,width,height,byte_size,sha256,alpha_valid,visual_input_hash,style_version,reference_set_version)
  select d.npc_id,'portrait','community-portraits/test-happy.webp','A happy rain-soaked ranger expression.',jsonb_build_object('masterStorageKey','source-masters/portraits/test-happy.png'),'18370000-0000-4000-8000-000000000001','ready','image/webp',1024,1536,120000,'4444444444444444444444444444444444444444444444444444444444444444',true,r.value->>'visualInputHash','community-npc-portrait-sprite-v1','brac-character-look-v1' from pg_temp.fresh_request r join private.npc_drafts d on d.npc_id=(select npc_id from pg_temp.ids) returning id
), replacement_asset as (
  insert into private.npc_assets(npc_id,kind,storage_key,alt_text,generation,created_by,media_state,mime_type,width,height,byte_size,sha256,alpha_valid,visual_input_hash,style_version,reference_set_version)
  select d.npc_id,'portrait','community-portraits/test-neutral-replacement.webp','A neutral rain-soaked ranger expression.',jsonb_build_object('masterStorageKey','source-masters/portraits/test-neutral-replacement.png'),'18370000-0000-4000-8000-000000000001','ready','image/webp',1024,1536,120000,'5555555555555555555555555555555555555555555555555555555555555555',true,r.value->>'visualInputHash','community-npc-portrait-sprite-v1','brac-character-look-v1' from pg_temp.fresh_request r join private.npc_drafts d on d.npc_id=(select npc_id from pg_temp.ids) returning id
), optional_candidate as (
  insert into private.npc_portrait_candidates(job_id,npc_id,draft_id,owner_id,asset_id,ordinal,state,visual_input_hash,source_revision,expression_slot,source_provenance,neutral_anchor_hash,neutral_anchor_asset_id,completed_at)
  select null,d.npc_id,d.id,d.owner_id,a.id,1,'ready',(select value->>'visualInputHash' from pg_temp.fresh_request),5,'happy','author_upload',d.selected_portrait_slots#>>'{neutral,assetHash}',(d.selected_portrait_slots#>>'{neutral,assetId}')::uuid,now() from private.npc_drafts d cross join optional_asset a where d.npc_id=(select npc_id from pg_temp.ids) returning id
), replacement_candidate as (
  insert into private.npc_portrait_candidates(job_id,npc_id,draft_id,owner_id,asset_id,ordinal,state,visual_input_hash,source_revision,expression_slot,source_provenance,completed_at)
  select null,d.npc_id,d.id,d.owner_id,a.id,1,'ready',(select value->>'visualInputHash' from pg_temp.fresh_request),5,'neutral','author_upload',now() from private.npc_drafts d cross join replacement_asset a where d.npc_id=(select npc_id from pg_temp.ids) returning id
) select (select id from optional_candidate) happy_candidate_id,(select id from replacement_candidate) replacement_neutral_candidate_id;
grant select on pg_temp.expression_candidates to authenticated;
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
select is(public.npc_author_select_portrait((select npc_id from pg_temp.ids),5,'happy',(select happy_candidate_id from pg_temp.expression_candidates),false)->>'revision','6','optional expression selects against the current Neutral anchor');
create temporary table pg_temp.queued_optional as select public.npc_author_request_portrait((select npc_id from pg_temp.ids),6,'{}'::jsonb,1,'sad') value;
grant select on pg_temp.queued_optional to authenticated;
create temporary table pg_temp.neutral_replacement as select public.npc_author_select_portrait((select npc_id from pg_temp.ids),6,'neutral',(select replacement_neutral_candidate_id from pg_temp.expression_candidates),false) value;
grant select on pg_temp.neutral_replacement to authenticated;
select is((select value->>'revision' from pg_temp.neutral_replacement),'7','replacement Neutral selection advances the draft once');
select is((select count(*) from jsonb_object_keys((select value->'selectedBySlot' from pg_temp.neutral_replacement))),1::bigint,'changing Neutral atomically clears optional selections');
reset role;
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.claimed_optional as select public.npc_portrait_claim_generation_attempt() value;
grant select on pg_temp.claimed_optional to authenticated;
select is((select value#>>'{neutralAnchorAsset,assetId}' from pg_temp.claimed_optional),(select value->>'neutralAnchorAssetId' from pg_temp.queued_optional),'queued optional generation keeps the exact Neutral asset after Neutral changes');
reset request.jwt.claim.role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
create temporary table pg_temp.stale_workspace as select public.npc_author_expression_sprite_workspace((select npc_id from pg_temp.ids)) value;
grant select on pg_temp.stale_workspace to authenticated;
select is((select candidate->>'state' from jsonb_array_elements((select value->'candidates' from pg_temp.stale_workspace)) candidate where candidate->>'candidateId'=(select happy_candidate_id::text from pg_temp.expression_candidates)),'stale','Neutral replacement moves prior selected optional candidates out of selected state');
select throws_ok(format('select public.npc_author_select_portrait(%L::uuid,7,%L,%L::uuid,false)',(select npc_id from pg_temp.ids),'happy',(select happy_candidate_id from pg_temp.expression_candidates)),'PT409',null,'stale optional expression requires explicit neutral confirmation');
select is(public.npc_author_select_portrait((select npc_id from pg_temp.ids),7,'happy',(select happy_candidate_id from pg_temp.expression_candidates),true)->>'revision','8','author can explicitly reconfirm a stale optional expression');
create temporary table pg_temp.expression_workspace as select public.npc_author_expression_sprite_workspace((select npc_id from pg_temp.ids)) value;
grant select on pg_temp.expression_workspace to authenticated;
select is((select value#>>'{resolvedBySlot,sad,fallbackFrom}' from pg_temp.expression_workspace),'neutral','missing optional slots resolve to Neutral without duplicated media');
select is((select value#>>'{selectedBySlot,happy,source}' from pg_temp.expression_workspace),'author_upload','workspace preserves mixed-source provenance per selected slot');
select is((select value#>>'{resolvedBySlot,sad,assetHash}' from pg_temp.expression_workspace),(select value#>>'{selectedBySlot,neutral,assetHash}' from pg_temp.expression_workspace),'fallback entries retain Neutral hash provenance');
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000003';
select throws_ok(format('select public.npc_author_expression_sprite_workspace(%L::uuid)',(select npc_id from pg_temp.ids)),'PT404',null,'another author cannot read an expression sprite workspace');
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
create temporary table pg_temp.submission as select public.npc_author_submit((select npc_id from pg_temp.ids),8) value;
select ok((public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'versions'->0->>'portraitAssetId') is not null and (public.npc_author_workspace_detail((select npc_id from pg_temp.ids))->'versions'->0->>'settingAssetId') is not null,'submission pins both selected assets to its immutable version');
select throws_ok(format('update private.npc_versions set selected_portrait_asset_id=null where id=%L::uuid',(select value->>'versionId' from pg_temp.submission)),null,null,'immutable version enforcement rejects portrait mutation after submission');
select throws_ok(format($$update private.npc_versions set portrait_slots='{}'::jsonb where id=%L::uuid$$,(select value->>'versionId' from pg_temp.submission)),null,null,'immutable version enforcement rejects sprite map mutation after submission');
reset role;
set local request.jwt.claim.role='service_role';
select ok(exists(select 1 from private.npc_notifications where user_id='18370000-0000-4000-8000-000000000001' and kind='submission_received' and payload->>'versionId'=(select value->>'versionId' from pg_temp.submission)),'submission preserves the author notification');

reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000002';
select ok(not (public.npc_reviewer_submission((select (value->>'versionId')::uuid from pg_temp.submission))::text like '%community-portraits/%'),'reviewer asset descriptor omits private storage keys');
reset role;
select throws_ok($$select public.npc_author_portrait_complete('18370000-0000-4000-8000-000000000099','[]'::jsonb)$$,'PT403',null,'portrait completion remains service-only');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000003';
select throws_ok(format('select public.npc_author_portrait_preview_authorization(%L::uuid)',(select value#>>'{candidates,0,previewToken}' from pg_temp.complete_status)),'PT404',null,'another author cannot redeem a portrait preview grant');
reset role;
update private.npc_assets set media_state='quarantined' where id=(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.complete_status);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='18370000-0000-4000-8000-000000000001';
select throws_ok(format('select public.npc_author_portrait_preview_authorization(%L::uuid)',(select value#>>'{candidates,0,previewToken}' from pg_temp.complete_status)),'PT404',null,'quarantine blocks a previously issued portrait preview grant');
reset role;

-- Physical deletion targets are exclusively leased, and an expired lease can
-- be recovered by another service attempt without accepting the stale token.
update private.npc_assets set media_state='purged' where id=(select (value#>>'{candidates,0,assetId}')::uuid from pg_temp.fresh_status);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.deletion_claim as select public.npc_portrait_next_deletion_target() value;
select ok((select value->>'claimToken' from pg_temp.deletion_claim) is not null,'deletion work returns an exclusive claim token');
reset request.jwt.claim.role;
update private.npc_portrait_deletion_targets set claimed_at=now()-interval '16 minutes' where asset_id=(select (value->>'assetId')::uuid from pg_temp.deletion_claim);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.deletion_retry as select public.npc_portrait_next_deletion_target() value;
select isnt((select value->>'claimToken' from pg_temp.deletion_retry),(select value->>'claimToken' from pg_temp.deletion_claim),'an expired deletion lease is replaced by a fresh claim token');
select throws_ok(format('select public.npc_portrait_deletion_complete(%L::uuid,%L::uuid)',(select value->>'assetId' from pg_temp.deletion_claim),(select value->>'claimToken' from pg_temp.deletion_claim)),'PT409',null,'a stale deletion token cannot complete a retried target');
select lives_ok(format('select public.npc_portrait_deletion_complete(%L::uuid,%L::uuid)',(select value->>'assetId' from pg_temp.deletion_retry),(select value->>'claimToken' from pg_temp.deletion_retry)),'the current deletion token completes the claimed target once');
reset request.jwt.claim.role;

select throws_ok(format('select public.npc_reviewer_decide(%L::uuid,%L,%L)',(select value->>'versionId' from pg_temp.submission),'approve','ordinary author cannot self-review'),'PT403',null,'an ordinary community author remains blocked from self-review');

select * from finish();
rollback;
