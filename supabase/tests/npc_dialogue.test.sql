begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,role,aud) values
 ('70000000-0000-4000-8000-000000000001','npc-rules@example.test','authenticated','authenticated'),
 ('70000000-0000-4000-8000-000000000002','npc-legacy@example.test','authenticated','authenticated'),
 ('70000000-0000-4000-8000-000000000003','npc-loss@example.test','authenticated','authenticated');
create function pg_temp.npc_save(p_actor uuid) returns uuid language sql as $$select id from public.tavern_saves where user_id=p_actor;$$;
set local request.jwt.claim.sub='70000000-0000-4000-8000-000000000001';
select public.create_tavern();
select is((select count(*) from private.npc_lives where save_id=pg_temp.npc_save(auth.uid())),2::bigint,'onboarding seeds both NPCs');
select is(public.get_npc_journal('lira')->>'questStatus','active','default intention is active');
select is(private.npc_chance(pg_temp.npc_save(auth.uid()),'lira',1,(select q from private.npc_quests q where save_id=pg_temp.npc_save(auth.uid()) and patron_key='lira')),60,'authored scout skill and difficulty determine baseline chance');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'private schema is server only');
select ok(not has_table_privilege('authenticated','public.patron_catalog','SELECT'),'future catalog material is inaccessible');
select ok(not has_function_privilege('authenticated','public.dialogue_complete(uuid,uuid,uuid)','EXECUTE'),'players cannot fabricate completion');
select ok(not has_function_privilege('anon','public.get_npc_journal(text)','EXECUTE'),'anonymous transcripts are denied');
select throws_ok($$update private.npc_content_versions set sheet='{}' where patron_key='lira'$$,'P0001',null,'published content cannot be overwritten');
select throws_ok($$update private.npc_content set version='missing' where patron_key='lira'$$,'P0001',null,'selector cannot refer to unpublished content');

-- A new content version leaves existing saves pinned to their original sheet.
insert into private.npc_content_versions select patron_key,'npc-test-v2',jsonb_set(sheet,'{voice}','"Different future voice"') from private.npc_content where patron_key='lira';
update private.npc_content set version='npc-test-v2',sheet=(select sheet from private.npc_content_versions where patron_key='lira' and version='npc-test-v2') where patron_key='lira';
select public.dialogue_begin(auth.uid(),'71000000-0000-4000-8000-000000000001','lira','What do you remember?',0);
select is((select content_version from public.dialogue_turns where id='71000000-0000-4000-8000-000000000001'),'npc-v1','turn freezes existing character version');
select isnt(public.dialogue_context(auth.uid(),'71000000-0000-4000-8000-000000000001')->>'voice','Different future voice','retrieval resolves the frozen version');
select ok(public.dialogue_context(auth.uid(),'71000000-0000-4000-8000-000000000001','history')::text not like '%ignoring a warning%','locked backstory is filtered before prompting');
select public.dialogue_status('71000000-0000-4000-8000-000000000001',true);
select is((select status from private.npc_attempts where turn_id='71000000-0000-4000-8000-000000000001'),'cancelled','cancellation closes its attempt');

-- A processing lease can expire; the same immutable input resumes with a new fence and cumulative budget.
select public.dialogue_begin(auth.uid(),'71000000-0000-4000-8000-000000000002','lira','Please wait a moment.',0);
select public.dialogue_checkpoint(auth.uid(),'71000000-0000-4000-8000-000000000002',(select fence from public.dialogue_turns where id='71000000-0000-4000-8000-000000000002'),'reserve');
update public.dialogue_turns set lease_until=now()-interval '1 second' where id='71000000-0000-4000-8000-000000000002';
select public.dialogue_begin(auth.uid(),'71000000-0000-4000-8000-000000000002','lira','Please wait a moment.',0);
select is((select calls from public.dialogue_turns where id='71000000-0000-4000-8000-000000000002'),1,'recovery preserves charged call count');
select is((select count(*) from private.npc_attempts where turn_id='71000000-0000-4000-8000-000000000002'),2::bigint,'each processing attempt has its own record');
select is((select count(*) from private.npc_attempts where turn_id='71000000-0000-4000-8000-000000000002' and status='expired'),1::bigint,'superseded attempt expires');
select throws_ok($$select public.dialogue_checkpoint(auth.uid(),'71000000-0000-4000-8000-000000000002',(select fence from private.npc_attempts where turn_id='71000000-0000-4000-8000-000000000002' and status='expired'),'reserve')$$,'PT409',null,'old fence cannot checkpoint');
update public.dialogue_turns set calls=8 where id='71000000-0000-4000-8000-000000000002';
select throws_ok($$select public.dialogue_checkpoint(auth.uid(),'71000000-0000-4000-8000-000000000002',(select fence from public.dialogue_turns where id='71000000-0000-4000-8000-000000000002'),'reserve')$$,'PT429',null,'eight-call cap survives retries');
update public.dialogue_turns set calls=1 where id='71000000-0000-4000-8000-000000000002';
update private.npc_usage set calls=400 where actor_id=auth.uid();
select throws_ok($$select public.dialogue_checkpoint(auth.uid(),'71000000-0000-4000-8000-000000000002',(select fence from public.dialogue_turns where id='71000000-0000-4000-8000-000000000002'),'reserve')$$,'PT429',null,'daily call cap applies before provider execution');
update private.npc_usage set calls=1,turns=100 where actor_id=auth.uid();
select public.dialogue_status('71000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.dialogue_begin(auth.uid(),'71000000-0000-4000-8000-000000000003','lira','Hello.',0)$$,'PT429',null,'daily turn-attempt cap is enforced');
update private.npc_usage set turns=2 where actor_id=auth.uid();
select public.dialogue_begin(auth.uid(),'71000000-0000-4000-8000-000000000003','lira','Hello.',0);
update public.dialogue_turns set lease_until=now()-interval '1 second' where id='71000000-0000-4000-8000-000000000003';
select lives_ok($$select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'72000000-0000-4000-8000-000000000001',0)$$,'expired processing does not block optional-crafting day end');
select is((select status from public.dialogue_turns where id='71000000-0000-4000-8000-000000000003'),'stale','day end closes expired turn');
select is((select status from private.npc_attempts where turn_id='71000000-0000-4000-8000-000000000003'),'stale','day end closes expired attempt record');
select is((select count(*) from private.npc_events where save_id=pg_temp.npc_save(auth.uid()) and day=1),2::bigint,'unattended NPCs both prepare');
select is((select count(*) from private.npc_events where save_id=pg_temp.npc_save(auth.uid()) and day=1 and public_news),0::bigint,'private preparation is not automatically public gossip');
select is((public.get_npc_journal('lira')->>'preparation')::integer,1,'overnight preparation is retained');
select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'72000000-0000-4000-8000-000000000002',1);
select is((select count(*) from private.npc_events where save_id=pg_temp.npc_save(auth.uid()) and draw between 0 and 99 and chance is not null),2::bigint,'attempts persist random draws and probabilities');
select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'72000000-0000-4000-8000-000000000002',1);
select is((select count(*) from private.npc_events where save_id=pg_temp.npc_save(auth.uid()) and day=2),2::bigint,'replay never rerolls outcomes');
select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'72000000-0000-4000-8000-000000000003',2);
select is((select count(*) from private.npc_events where save_id=pg_temp.npc_save(auth.uid()) and day=3),0::bigint,'terminal quests never resolve again');
select ok(not private.npc_targets(pg_temp.npc_save(auth.uid()),'lira','npc-v1') ? 'bandit-camp','terminal opportunity target is retired');
select ok(private.npc_targets(pg_temp.npc_save(auth.uid()),'lira','npc-v1') ? 'old-road','unrelated known targets remain available');

-- Test-only trusted stage fixtures; authenticated players have no access to completion.
create function pg_temp.npc_decide(p_plan jsonb default null,p_reaction integer default 0,p_subject text default 'quest') returns jsonb language plpgsql as $$
declare t jsonb; id uuid:=extensions.gen_random_uuid(); seq bigint; result jsonb;
begin
  select sequence into seq from private.npc_lives where save_id=pg_temp.npc_save(auth.uid()) and patron_key='lira';
  t:=public.dialogue_begin(auth.uid(),id,'lira','I offer advice and appreciate your honesty.',seq);
  perform public.dialogue_checkpoint(auth.uid(),id,(t->>'fence')::uuid,'decision',jsonb_build_object('value',jsonb_build_object('stance','agree','reaction',p_reaction,'subject',p_subject,'evidence','I offer advice','intention',p_plan)));
  perform public.dialogue_checkpoint(auth.uid(),id,(t->>'fence')::uuid,'speak','{"value":{"text":"I understand your proposal."}}');
  perform public.dialogue_checkpoint(auth.uid(),id,(t->>'fence')::uuid,'review','{"value":{"ok":true,"issues":[]}}');
  result:=public.dialogue_complete(auth.uid(),id,(t->>'fence')::uuid);
  -- Keep this fast SQL fixture outside the real rate window between assertions.
  update public.dialogue_turns set created_at=now()-interval '2 minutes' where actor_id=auth.uid();
  return result;
end; $$;
select throws_ok($$select pg_temp.npc_decide('{"goal":"Try the lost camp again","motivation":"Win","targets":["bandit-camp"],"steps":[{"action":"attempt","approach":"combat"}]}')$$,'PT400',null,'renaming a goal cannot reopen a retired target');
select throws_ok($$select pg_temp.npc_decide('{"goal":"Keep preparing","motivation":"Wait","targets":["old-road"],"steps":[{"action":"prepare","approach":"scouting"}]}')$$,'PT400',null,'a final prepare step cannot loop forever');
select throws_ok($$select pg_temp.npc_decide('{"goal":"Keep waiting","motivation":"Wait","targets":["old-road"],"steps":[{"action":"wait","approach":"scouting"}]}')$$,'PT400',null,'a final wait step needs an explicit next action');
select throws_ok($$select pg_temp.npc_decide('{"goal":"Attempt then prepare","motivation":"Protect travelers","targets":["old-road"],"steps":[{"action":"attempt","approach":"scouting"},{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"combat"}]}')$$,'PT400',null,'an attempt cannot precede unreachable daily steps');
select throws_ok($$select pg_temp.npc_decide('{"goal":"Abandon then attempt","motivation":"Protect travelers","targets":["old-road"],"steps":[{"action":"abandon","approach":"scouting"},{"action":"attempt","approach":"combat"}]}')$$,'PT400',null,'abandonment cannot precede another daily step');
select lives_ok($$select pg_temp.npc_decide('{"goal":"Guard another part of the old road","motivation":"Protect travelers","targets":["old-road"],"steps":[{"action":"attempt","approach":"combat"}]}')$$,'a terminal objective can be followed by an unrelated goal');
select is((select count(*) from private.npc_quests where save_id=pg_temp.npc_save(auth.uid()) and patron_key='lira' and status='active'),1::bigint,'only one successor objective is active');
select is((select authored from private.npc_quests where save_id=pg_temp.npc_save(auth.uid()) and patron_key='lira' and status='active'),false,'emergent objective has no authored character-loss permission');
select is(public.get_npc_journal('lira')->>'warning',null::text,'unauthored risk cannot claim character loss');
select is((pg_temp.npc_decide(null,1,'quest')->>'relationshipChange')::integer,2,'meaningful reaction applies fixed positive change');
select is((pg_temp.npc_decide(null,1,'quest')->>'relationshipChange')::integer,0,'same subject cannot farm trust');
select is((pg_temp.npc_decide(null,1,'personal')->>'relationshipChange')::integer,2,'second subject can earn trust');
select is((pg_temp.npc_decide(null,1,'hospitality')->>'relationshipChange')::integer,0,'daily positive cap is four');
do $$declare n integer; begin for n in 0..9999 loop
  perform setseed(n/10000.0); if floor(random()*100)>=95 then perform setseed(n/10000.0); return; end if;
end loop; end; $$;
select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'72000000-0000-4000-8000-000000000004',(select revision from public.tavern_saves where user_id=auth.uid()));
select is(public.get_npc_journal('lira')->>'questStatus','failed','unauthored failure is permanent too');
select is(public.get_npc_journal('lira')->>'availability','present','unauthored failure cannot kill or remove a character even on worst draw');
select is((select count(*) from private.npc_events e join private.npc_quests q on q.id=e.quest_id where e.save_id=pg_temp.npc_save(auth.uid()) and not q.authored and e.public_news),0::bigint,'emergent private objectives are not published as news');
select is((pg_temp.npc_decide(null,-1,'quest')->>'relationshipChange')::integer,-2,'negative reactions have their own fixed change');
select is((pg_temp.npc_decide(null,-1,'personal')->>'relationshipChange')::integer,-2,'second negative subject applies');
select is((pg_temp.npc_decide(null,-1,'hospitality')->>'relationshipChange')::integer,0,'daily negative cap is four');

-- Legacy import covers partial/completed quests while preserving balances and relationships.
set local request.jwt.claim.sub='70000000-0000-4000-8000-000000000002';
select private.create_tavern_before_dialogue();
update public.tavern_saves set gold=123 where user_id=auth.uid();
insert into public.patron_states(save_id,patron_key,relationship,arc_progress) values
 (pg_temp.npc_save(auth.uid()),'lira',73,2),(pg_temp.npc_save(auth.uid()),'torvin',81,4);
select private.ensure_npcs(pg_temp.npc_save(auth.uid()));
select private.ensure_npcs(pg_temp.npc_save(auth.uid()));
select is((select gold from public.tavern_saves where user_id=auth.uid()),123::bigint,'legacy gold is unchanged');
select is((select relationship from public.patron_states where save_id=pg_temp.npc_save(auth.uid()) and patron_key='lira'),73,'legacy trust is unchanged');
select is(public.get_npc_journal('torvin')->>'questStatus','succeeded','completed legacy quest stays completed');
select is((public.get_npc_journal('lira')->>'preparation')::integer,2,'partial progress imports as identified preparation');
select is((select count(*) from private.npc_events where save_id=pg_temp.npc_save(auth.uid()) and outcome='legacy'),2::bigint,'legacy import records each history only once');
select is((select content_version from private.npc_quests where save_id=pg_temp.npc_save(auth.uid()) and patron_key='lira'),'npc-test-v2','new character initialization selects published current version');

-- Force deterministic high draws in this transaction without a production random override.
set local request.jwt.claim.sub='70000000-0000-4000-8000-000000000003';
select public.create_tavern();
update private.npc_quests set intention=jsonb_set(intention,'{steps}','[{"action":"attempt","approach":"combat"}]'),preparation=0 where save_id=pg_temp.npc_save(auth.uid());
select ok(public.get_npc_journal('lira')->>'warning' like '%life%','authored death warning is visible before acting');
select ok(public.get_npc_journal('torvin')->>'warning' like '%permanently%','authored departure warning is visible before acting');
do $$declare n integer; begin for n in 0..9999 loop
  perform setseed(n/10000.0); if floor(random()*100)>=95 and floor(random()*100)>=95 then perform setseed(n/10000.0); return; end if;
end loop; raise exception 'No deterministic high draw seed found'; end; $$;
select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'73000000-0000-4000-8000-000000000001',0);
select is(public.get_npc_journal('lira')->>'availability','dead','authored failed unprepared assault can kill Lira');
select is(public.get_npc_journal('torvin')->>'availability','departed','authored failed confrontation can permanently drive Torvin away');
select is(public.get_npc_journal('lira')->>'questStatus','failed','failure is permanent quest state');
select throws_ok($$select public.dialogue_begin(auth.uid(),'74000000-0000-4000-8000-000000000001','lira','Come back.',0)$$,'PT422',null,'dialogue cannot resurrect an unavailable character');
select public.advance_tavern_day(pg_temp.npc_save(auth.uid()),'73000000-0000-4000-8000-000000000002',1);
select is(public.get_npc_journal('lira')->>'availability','dead','later days cannot resurrect Lira');
select is(jsonb_array_length(public.get_npc_journal('torvin')->'events'),2,'public morning news includes both outcomes');

select * from finish();
rollback;
