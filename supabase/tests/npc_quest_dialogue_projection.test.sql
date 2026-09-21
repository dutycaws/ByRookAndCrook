begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select has_function('private','world_quest_lifecycle_status',array['uuid','uuid'],'one canonical lifecycle status helper exists');
select has_function('private','world_quest_public_view',array['private.world_quests','integer'],'player-safe quest view exists');
select hasnt_function('public','use_generated_supply',array['uuid','uuid','bigint','text','uuid'],'quest supply attachment command is removed');
select ok(to_regclass('private.world_generated_supply_uses') is null,'quest supply attachment ledger is removed');

insert into auth.users(id,email,role,aud) values('74000000-0000-4000-8000-000000000001','quest-dialogue@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values('74000000-0000-4000-8000-000000000011','74000000-0000-4000-8000-000000000001',3,0);
set local request.jwt.claim.role='service_role';
create temporary table pg_temp.resident as
  select * from private.world_materialize_resident_from_version('74000000-0000-4000-8000-000000000011','18181818-1818-4181-8181-181818181818','18181818-1818-4181-8181-181818181819',1);

select is((select campaign_state from private.world_npc_instances where id=(select instance_id from pg_temp.resident)),'{}'::jsonb,'legacy campaign quest state is empty');
create temporary table pg_temp.turn as
  select public.npc_dialogue_begin(
    '74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000021',
    '18181818-1818-4181-8181-181818181818','Let us take a more direct route.',0,null,null,null
  ) result;
create temporary table pg_temp.base as
  select public.npc_dialogue_context('74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000021','base','') result;
select is((select result->>'questLifecycleStatus' from pg_temp.base),'active','dialogue reads the canonical active quest');
select ok((select result ? 'activeQuestId' and not result ? 'campaign' from pg_temp.base),'dialogue exposes a fenced quest identity without campaign JSON');

select public.npc_dialogue_checkpoint(
  '74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000021',
  (select (result->>'fence')::uuid from pg_temp.turn),'base',
  jsonb_build_object('value',(select result from pg_temp.base),'contentVersion','quest-test-v1')
);
select public.npc_dialogue_checkpoint(
  '74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000021',
  (select (result->>'fence')::uuid from pg_temp.turn),'decision',
  jsonb_build_object('value',jsonb_build_object(
    'stance','agree','reaction',0,'subject','quest','evidence','',
    'intention',(select jsonb_build_object('goal',objective,'motivation',motivation,'targets',to_jsonb(target_refs),'steps','[{"action":"attempt","approach":"scouting"}]'::jsonb) from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='active')
  ))
);
select public.npc_dialogue_checkpoint(
  '74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000021',
  (select (result->>'fence')::uuid from pg_temp.turn),'speak','{"value":{"text":"Agreed. I will scout the road tonight."}}'::jsonb
);
create temporary table pg_temp.completed as
  select public.npc_dialogue_complete('74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000021',(select (result->>'fence')::uuid from pg_temp.turn)) result;
select is((select plan_revision from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='active'),2,'accepted dialogue increments the canonical plan revision');
select is((select current_plan from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='active'),'[{"action":"attempt","approach":"scouting"}]'::jsonb,'dialogue replaces only the remaining plan');
select is((select count(*)::integer from private.world_quest_plan_revisions where dialogue_turn_id='74000000-0000-4000-8000-000000000021'),1,'plan replacement has one attributable append-only receipt');
select is((select preparation from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='active'),0,'plan replacement resets preparation');
select ok((select origin='authored_milestone' and authored_milestone_index=0 and authored_milestone_key='scout-camp' and parent_quest_id is null from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='active'),'suffix replacement preserves immutable authored quest identity');
select is((select prior_plan from private.world_quest_plan_revisions where dialogue_turn_id='74000000-0000-4000-8000-000000000021'),'[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb,'plan receipt preserves the complete pre-replacement plan');

insert into private.world_quest_events(
  quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,
  preparation_before,preparation_after,hospitality,readiness,outcome,narration,public_news
)
select id,save_id,instance_id,3,0,'wait','scouting',2,difficulty,0,0,0,0,'waited',
  'The road was watched without forcing a decision.',true
from private.world_quests
where instance_id=(select instance_id from pg_temp.resident) and state='active';

set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='74000000-0000-4000-8000-000000000001';
create temporary table pg_temp.journal as
  select public.npc_journals(array[(select instance_id from pg_temp.resident)]) result;
select is((select result#>>array[(select instance_id::text from pg_temp.resident),'questLifecycleStatus'] from pg_temp.journal),'active','journal reports the unified lifecycle');
select ok((select (result#>array[(select instance_id::text from pg_temp.resident),'currentQuest']) ?& array['origin','title','objective','plan','currentStep','activationDay','readiness','risk'] from pg_temp.journal),'journal exposes the bounded current quest');
select ok((select not ((result#>array[(select instance_id::text from pg_temp.resident),'currentQuest']) ?| array['chance','draw','preparation','privateRationale']) from pg_temp.journal),'journal hides exact mechanics and private rationale');
select is((select result#>>array[(select instance_id::text from pg_temp.resident),'questHistory','0','day'] from pg_temp.journal),'3','journal history exposes an event day');
select is(
  (select array_agg(key order by key)
    from pg_temp.journal,
    lateral jsonb_object_keys(result#>array[(select instance_id::text from pg_temp.resident),'questHistory','0']) key),
  array['day','id','outcome','publicNews','text']::text[],
  'journal history exposes only the player-safe event fields'
);
select is((select public.world_generated_shop_projection('74000000-0000-4000-8000-000000000011') ? 'successorQuest'),false,'generated shop no longer projects a quest attachment');
select is((select count(*) from private.world_quest_plan_revisions where quest_id=(select id from private.world_quests where instance_id=(select instance_id from pg_temp.resident))),1::bigint,'dialogue replacement resets preparation exactly once through one revision receipt');
select throws_ok($$update private.world_quests set state='scheduled',activated_day=null where instance_id=(select instance_id from pg_temp.resident)$$,'55000',null,'active resident cannot be converted to scheduled through dialogue-visible quest state');

-- The full quest archive is independent of the compact journal and uses a
-- terminal-quest keyset cursor, so old stories cannot disappear after 40 rows.
insert into private.world_quest_events(
  quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,
  preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,narration,public_news
)
select id,save_id,instance_id,4,1,'attempt','scouting',2,difficulty,0,0,0,0,50,1,'succeeded',
  'The first archive quest reached its conclusion.',true
from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='active';
update private.world_quests set state='succeeded',terminal_day=4,
  terminal_event_id=(select id from private.world_quest_events where quest_id=private.world_quests.id and outcome='succeeded')
where instance_id=(select instance_id from pg_temp.resident) and state='active';

do $archive$
declare parent private.world_quests; quest_id uuid; event_id uuid; n integer;
begin
  select * into parent from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='succeeded' order by terminal_day limit 1;
  for n in 1..41 loop
    quest_id := extensions.gen_random_uuid();
    insert into private.world_quests(
      id,save_id,instance_id,package_id,package_hash,version_id,origin,parent_quest_id,title,objective,motivation,
      constraints,target_refs,difficulty,definition_plan,current_plan,state,current_step,preparation,scheduled_for_day,activated_day
    ) values (
      quest_id,parent.save_id,parent.instance_id,parent.package_id,parent.package_hash,parent.version_id,'generated_successor',parent.id,
      'Archive quest ' || n,'Keep the archive cursor honest.','Preserve a complete resident story.',
      parent.constraints,parent.target_refs,parent.difficulty,parent.definition_plan,parent.current_plan,'active',0,0,3,3
    );
    insert into private.world_quest_events(
      quest_id,save_id,instance_id,day_number,step_index,action,approach,skill,difficulty,
      preparation_before,preparation_after,hospitality,readiness,chance,draw,outcome,narration,public_news
    ) values (
      quest_id,parent.save_id,parent.instance_id,50 + (n % 2),0,'attempt','scouting',2,parent.difficulty,
      0,0,0,0,50,n % 100,'succeeded','Archive event ' || n,true
    ) returning id into event_id;
    update private.world_quests set state='succeeded',terminal_day=50 + (n % 2),terminal_event_id=event_id where id=quest_id;
  end loop;
end
$archive$;

select has_function('public','npc_quest_history_archive',array['uuid','integer','uuid'],'owner-scoped terminal quest archive exists');
create temporary table pg_temp.archive_first as
  select public.npc_quest_history_archive((select instance_id from pg_temp.resident),20,null) result;
select is(jsonb_array_length((select result->'items' from pg_temp.archive_first)),20,'archive returns a bounded first quest page');
select ok((select result->>'nextCursor' is not null from pg_temp.archive_first),'archive returns a cursor when more than forty terminal quests remain');
select is(
  (select result#>>'{items,0,id}' from pg_temp.archive_first),
  (select id::text from private.world_quests where instance_id=(select instance_id from pg_temp.resident) and state='succeeded' order by terminal_day desc,id desc limit 1),
  'archive uses a deterministic terminal-day and quest-id order for equal days'
);
create temporary table pg_temp.archive_second as
  select public.npc_quest_history_archive((select instance_id from pg_temp.resident),20,(select (result->>'nextCursor')::uuid from pg_temp.archive_first)) result;
select is(jsonb_array_length((select result->'items' from pg_temp.archive_second)),20,'archive cursor returns the second full page');
select ok((select result->>'nextCursor' is not null from pg_temp.archive_second),'second archive page retains a cursor');
create temporary table pg_temp.archive_third as
  select public.npc_quest_history_archive((select instance_id from pg_temp.resident),20,(select (result->>'nextCursor')::uuid from pg_temp.archive_second)) result;
select is(jsonb_array_length((select result->'items' from pg_temp.archive_third)),2,'archive returns every remaining terminal quest after forty rows');
select is((select result->'nextCursor' from pg_temp.archive_third),'null'::jsonb,'archive signals cursor exhaustion explicitly');
select is(
  (select array_agg(key order by key) from pg_temp.archive_first,lateral jsonb_object_keys(result->'items'->0) key),
  array['activationDay','events','id','objective','origin','outcome','terminalDay','title']::text[],
  'archive quest groups expose only player-safe fields'
);
select is(
  (select array_agg(key order by key) from pg_temp.archive_first,lateral jsonb_object_keys(result->'items'->0->'events'->0) key),
  array['day','id','outcome','publicNews','text']::text[],
  'archive events exclude chance, draw, readiness, and worker context'
);
set local request.jwt.claim.sub='74000000-0000-4000-8000-000000000099';
select throws_ok($$select public.npc_quest_history_archive((select instance_id from pg_temp.resident),20,null)$$,'PT404',null,'another player cannot read a resident quest archive');
set local request.jwt.claim.sub='74000000-0000-4000-8000-000000000001';
update private.world_npc_instances set status='departed' where id=(select instance_id from pg_temp.resident);
select ok(public.npc_archived_resident((select instance_id from pg_temp.resident)) is not null,'departed resident remains available only through the archive projection');

select * from finish();
rollback;
