-- UUID-based community NPC runtime.  The legacy patron-key dialogue tables are
-- intentionally left in place for historic prototype saves; new Bar code uses
-- only these world-instance contracts.
begin;

alter table private.world_npc_instances
  add column conversation_sequence bigint not null default 0 check (conversation_sequence >= 0);

create table private.world_npc_dialogue_turns (
  id uuid primary key,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  npc_id uuid not null references private.npc_identities(id) on delete restrict,
  version_id uuid not null references private.npc_versions(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete cascade,
  message text not null check(char_length(btrim(message)) between 1 and 2000),
  input_sequence bigint not null check(input_sequence >= 0),
  intent_card_id uuid references public.intent_cards(id),
  offering_kind text check(offering_kind in ('beverage','food')),
  offering_item_id uuid,
  source_revision bigint not null check(source_revision >= 0),
  day_number integer not null check(day_number > 0),
  status text not null check(status in ('processing','completed','failed','cancelled','stale')),
  fence uuid not null default extensions.gen_random_uuid(),
  lease_until timestamptz not null,
  calls integer not null default 0 check(calls between 0 and 8),
  checkpoints jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(save_id,id),
  foreign key(save_id,actor_id) references public.tavern_saves(id,user_id) on delete cascade,
  check((offering_kind is null) = (offering_item_id is null))
);
create unique index world_npc_one_active_dialogue
  on private.world_npc_dialogue_turns(save_id) where status='processing';
create unique index world_npc_one_completed_sequence
  on private.world_npc_dialogue_turns(instance_id,input_sequence) where status='completed';
create index world_npc_dialogue_recent
  on private.world_npc_dialogue_turns(instance_id,input_sequence desc);

create table private.world_npc_dialogue_attempts (
  turn_id uuid not null references private.world_npc_dialogue_turns(id) on delete cascade,
  fence uuid primary key, started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz, status text not null default 'processing', calls integer not null default 0,
  error_code text
);
create table private.world_npc_memories (
  id uuid primary key default extensions.gen_random_uuid(),
  turn_id uuid not null references private.world_npc_dialogue_turns(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  kind text not null check(kind in ('keeper_claim','npc_statement','promise','interaction')),
  text text not null check(char_length(text) between 1 and 500),
  quote text not null check(char_length(quote) between 3 and 500),
  speaker text not null check(speaker in ('keeper','npc')),
  importance smallint not null default 1 check(importance between 1 and 3),
  entity_refs text[] not null default '{}', created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english',text)) stored,
  unique(turn_id,text)
);
create index world_npc_memory_search on private.world_npc_memories using gin(search);
create index world_npc_memory_scope on private.world_npc_memories(instance_id,created_at desc);
create table private.world_npc_reactions (
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  day_number integer not null, subject text not null check(subject in ('quest','personal','hospitality')),
  delta integer not null check(delta in (-2,2)),
  turn_id uuid references private.world_npc_dialogue_turns(id) on delete cascade,
  primary key(instance_id,day_number,subject)
);
create table private.world_npc_intent_card_plays (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  card_id uuid not null references public.intent_cards(id),
  turn_id uuid not null unique references private.world_npc_dialogue_turns(id) on delete cascade,
  card_key text not null, tier text not null, day_number integer not null,
  created_at timestamptz not null default now(), primary key(save_id,card_id)
);
create table private.world_npc_hospitality_events (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null, actor_id uuid not null references auth.users(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  item_kind text not null check(item_kind in ('beverage','food')),
  beverage_id uuid, food_id uuid,
  input_expected_revision bigint not null check(input_expected_revision>=0),
  day_number integer not null check(day_number>0), item_name text not null,
  quality_index smallint not null check(quality_index between 0 and 6),
  gold_earned integer not null check(gold_earned>=0), relationship_change integer not null,
  result jsonb not null, committed_revision bigint not null check(committed_revision>0),
  created_at timestamptz not null default now(), primary key(save_id,action_id),
  unique(save_id,beverage_id), unique(save_id,food_id),
  foreign key(save_id,actor_id) references public.tavern_saves(id,user_id) on delete cascade,
  foreign key(save_id,beverage_id) references public.beverages(save_id,id),
  foreign key(save_id,food_id) references public.foods(save_id,id),
  check((item_kind='beverage' and beverage_id is not null and food_id is null)
     or (item_kind='food' and food_id is not null and beverage_id is null))
);

create function private.world_npc_plan_valid(p_steps jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v_step jsonb; v_index integer:=0; v_count integer;
begin
  if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 3 then return false; end if;
  v_count:=jsonb_array_length(p_steps);
  for v_step in select value from jsonb_array_elements(p_steps) loop
    if v_step->>'action' not in ('prepare','wait','attempt','abandon')
      or v_step->>'approach' not in ('scouting','combat','diplomacy','trade')
      or (v_index<v_count-1 and v_step->>'action' not in ('prepare','wait'))
      or (v_index=v_count-1 and v_step->>'action' not in ('attempt','abandon')) then return false; end if;
    v_index:=v_index+1;
  end loop;
  return true;
end $$;

create or replace function private.world_npc_hospitality(p_save uuid,p_npc uuid,p_day integer) returns integer
language sql stable security definer set search_path='' as $$
  select greatest(-3,least(3,coalesce(sum(quality_index-3),0)))::integer from (
    select e.quality_index from private.world_npc_hospitality_events e
      join private.world_npc_instances w on w.id=e.instance_id
      where e.save_id=p_save and w.npc_id=p_npc and e.day_number=p_day
    union all
    select e.quality_index from public.hospitality_events e
      where e.save_id=p_save and e.patron_key=p_npc::text and e.day_number=p_day
  ) supplied
$$;

create function private.world_npc_transcript(p_instance uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(entry order by happened_at,ordinal),'[]'::jsonb) from (
    select t.created_at happened_at, 0 ordinal, jsonb_build_object(
      'kind','dialogue','turnId',t.id,'sequence',t.input_sequence,'day',t.day_number,
      'keeper',t.message,'npc',t.result->>'reply','relationship',t.result->'relationship') entry
    from private.world_npc_dialogue_turns t where t.instance_id=p_instance and t.status='completed'
    union all
    select e.created_at, 1, jsonb_build_object('kind','world_event','eventId',e.id,'day',e.day,'outcome',e.outcome,'text',e.narration,'publicNews',e.public_news)
    from private.world_npc_quest_events e where e.instance_id=p_instance
  ) transcript
$$;

create function private.world_npc_apply_hospitality(
  p_actor uuid,p_save uuid,p_instance uuid,p_kind text,p_item uuid,p_action uuid,p_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; w private.world_npc_instances; b public.beverages; f public.foods;
  prior private.world_npc_hospitality_events; v_name text; v_quality integer; v_delta integer; v_gold integer; r jsonb;
begin
  if p_actor is null or p_save is null or p_instance is null or p_kind not in ('beverage','food') or p_item is null or p_action is null or p_revision is null then
    raise sqlstate 'PT400' using message='Invalid hospitality request'; end if;
  select * into s from public.tavern_saves where id=p_save and user_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Tavern or offering not found'; end if;
  select * into prior from private.world_npc_hospitality_events where save_id=p_save and action_id=p_action;
  if found then
    if prior.instance_id=p_instance and prior.item_kind=p_kind and coalesce(prior.beverage_id,prior.food_id)=p_item and prior.input_expected_revision=p_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier was already used for different input';
  end if;
  if s.revision<>p_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before serving'; end if;
  select * into w from private.world_npc_instances where id=p_instance and save_id=p_save for update;
  if not found or w.status in ('dead','departed','dismissed','removed','quarantined') then raise sqlstate 'PT422' using message='This guest is unavailable'; end if;
  if p_kind='beverage' then
    select * into b from public.beverages where save_id=p_save and id=p_item;
    if not found or exists(select 1 from private.world_npc_hospitality_events where save_id=p_save and beverage_id=p_item)
       or exists(select 1 from public.hospitality_events where save_id=p_save and beverage_id=p_item) then raise sqlstate 'PT409' using message='Drink is unavailable'; end if;
    v_name:=b.name; v_quality:=b.quality_index;
  else
    select * into f from public.foods where save_id=p_save and id=p_item;
    if not found or exists(select 1 from private.world_npc_hospitality_events where save_id=p_save and food_id=p_item)
       or exists(select 1 from public.hospitality_events where save_id=p_save and food_id=p_item) then raise sqlstate 'PT409' using message='Food is unavailable'; end if;
    v_name:=f.name; v_quality:=f.quality_index;
  end if;
  v_delta:=case when v_quality>=4 then 2 when v_quality>=2 then 1 when v_quality=1 then -1 else -2 end;
  v_gold:=(array[1,3,6,10,16,25,40])[v_quality+1];
  r:=jsonb_build_object('actionId',p_action,'instanceId',p_instance,'itemKind',p_kind,'itemId',p_item,'itemName',v_name,
    'qualityIndex',v_quality,'goldEarned',v_gold,'goldBalance',s.gold+v_gold,'relationshipChange',v_delta,
    'relationship',greatest(0,least(100,w.relationship+v_delta)),'dayNumber',s.current_day,'committedRevision',s.revision+1,'rulesVersion','world-hospitality-v1');
  update private.world_npc_instances set relationship=greatest(0,least(100,relationship+v_delta)) where id=p_instance;
  update public.tavern_saves set gold=gold+v_gold,revision=revision+1,updated_at=now() where id=p_save;
  insert into private.world_npc_hospitality_events(save_id,action_id,actor_id,instance_id,item_kind,beverage_id,food_id,input_expected_revision,day_number,item_name,quality_index,gold_earned,relationship_change,result,committed_revision)
  values(p_save,p_action,p_actor,p_instance,p_kind,case when p_kind='beverage' then p_item end,case when p_kind='food' then p_item end,p_revision,s.current_day,v_name,v_quality,v_gold,v_delta,r,s.revision+1);
  return r;
end $$;

create function public.npc_serve_hospitality(
  p_save_id uuid,p_instance_id uuid,p_item_kind text,p_item_id uuid,p_action_id uuid,p_expected_revision bigint
) returns jsonb language sql security definer set search_path='' as $$
  select private.world_npc_apply_hospitality(auth.uid(),p_save_id,p_instance_id,p_item_kind,p_item_id,p_action_id,p_expected_revision)
$$;

create function public.npc_dialogue_begin(
  p_actor uuid,p_turn_id uuid,p_npc_id uuid,p_message text,p_expected_sequence bigint,
  p_intent_card_id uuid default null,p_offering_kind text default null,p_offering_item_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; w private.world_npc_instances; t private.world_npc_dialogue_turns; c public.intent_cards;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403' using message='Dialogue orchestration is server-only'; end if;
  if p_turn_id is null or p_npc_id is null or p_expected_sequence is null or p_expected_sequence<0 or p_message is null or char_length(btrim(p_message)) not between 1 and 2000
     or (p_offering_kind is null)<>(p_offering_item_id is null) or p_offering_kind not in ('beverage','food') and p_offering_kind is not null then raise sqlstate 'PT400' using message='Invalid dialogue input'; end if;
  select * into s from public.tavern_saves where user_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Start a tavern before talking'; end if;
  -- An expired lease never blocks a fresh turn. The old fenced worker may still
  -- return, but it can no longer checkpoint or commit.
  update private.world_npc_dialogue_attempts a set status='expired',finished_at=now(),error_code='LEASE_EXPIRED'
    from private.world_npc_dialogue_turns expired where a.turn_id=expired.id and expired.save_id=s.id
      and expired.status='processing' and expired.lease_until<=now() and a.status='processing';
  update private.world_npc_dialogue_turns set status='failed',error_code='LEASE_EXPIRED'
    where save_id=s.id and status='processing' and lease_until<=now();
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id for update;
  if found then
    if t.actor_id<>p_actor or t.npc_id<>p_npc_id or t.message<>p_message or t.input_sequence<>p_expected_sequence
      or t.intent_card_id is distinct from p_intent_card_id or t.offering_kind is distinct from p_offering_kind or t.offering_item_id is distinct from p_offering_item_id then raise sqlstate 'PT409' using message='Turn identifier already used for different input'; end if;
    if t.status='completed' then return to_jsonb(t); end if;
    if t.status in ('cancelled','stale') then raise sqlstate 'PT409' using message='Turn is closed'; end if;
    if t.status='processing' and t.lease_until>now() then return to_jsonb(t)||'{"busy":true}'::jsonb; end if;
    if t.source_revision<>s.revision or t.day_number<>s.current_day then update private.world_npc_dialogue_turns set status='stale',error_code='STATE_CHANGED' where id=t.id; return jsonb_build_object('status','stale'); end if;
    update private.world_npc_dialogue_turns set status='processing',fence=extensions.gen_random_uuid(),lease_until=now()+interval '120 seconds',error_code=null where id=t.id returning * into t;
  else
    if exists(select 1 from private.world_npc_dialogue_turns where save_id=s.id and status='processing' and lease_until>now()) then raise sqlstate 'PT409' using message='Another conversation is processing'; end if;
    select * into w from private.world_npc_instances where save_id=s.id and npc_id=p_npc_id for update;
    if not found or w.status in ('dead','departed','dismissed','removed','quarantined') then raise sqlstate 'PT422' using message='This guest is unavailable'; end if;
    if w.conversation_sequence<>p_expected_sequence then raise sqlstate 'PT409' using message='Conversation changed; refresh before replying'; end if;
    if p_intent_card_id is not null then
      select * into c from public.intent_cards where id=p_intent_card_id and save_id=s.id;
      if not found or exists(select 1 from private.world_npc_intent_card_plays where save_id=s.id and card_id=p_intent_card_id)
        or exists(select 1 from public.intent_card_plays where save_id=s.id and card_id=p_intent_card_id) then raise sqlstate 'PT409' using message='Intent card is unavailable'; end if;
    end if;
    insert into private.world_npc_dialogue_turns(id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,intent_card_id,offering_kind,offering_item_id,source_revision,day_number,status,lease_until)
    values(p_turn_id,s.id,w.id,w.npc_id,w.version_id,p_actor,p_message,p_expected_sequence,p_intent_card_id,p_offering_kind,p_offering_item_id,s.revision,s.current_day,'processing',now()+interval '120 seconds') returning * into t;
  end if;
  update private.world_npc_dialogue_attempts set status='expired',finished_at=now() where turn_id=t.id and status='processing';
  insert into private.world_npc_dialogue_attempts(turn_id,fence) values(t.id,t.fence);
  return to_jsonb(t);
end $$;

create function public.npc_dialogue_checkpoint(p_actor uuid,p_turn_id uuid,p_fence uuid,p_stage text,p_value jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare t private.world_npc_dialogue_turns;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor for update;
  if not found or t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Dialogue attempt expired'; end if;
  if p_stage='reserve' then
    if t.calls>=8 then raise sqlstate 'PT429' using message='Dialogue call budget reached'; end if;
    update private.world_npc_dialogue_turns set calls=calls+1 where id=t.id;
    update private.world_npc_dialogue_attempts set calls=calls+1 where fence=p_fence;
  elsif p_stage='fail' then
    update private.world_npc_dialogue_turns set status='failed',error_code=case when p_value->>'code' in ('BUDGET','CONSISTENCY','STRUCTURE','PROVIDER_FAILED') then p_value->>'code' else 'GENERATION_FAILED' end where id=t.id;
    update private.world_npc_dialogue_attempts set status='failed',finished_at=now(),error_code=(select error_code from private.world_npc_dialogue_turns where id=t.id) where fence=p_fence;
  elsif p_stage in ('base','context0','context1','investigate0','investigate1','deliberate','decision','speak','review','rewrite','rereview','remember') then
    -- The orchestrator passes its StageOutput object directly, whose generated
    -- payloads already live under `.value`.
    update private.world_npc_dialogue_turns set checkpoints=jsonb_set(checkpoints,array[p_stage],coalesce(p_value,'null'::jsonb),true) where id=t.id;
  else raise sqlstate 'PT400' using message='Unknown dialogue stage'; end if;
end $$;

create function public.npc_dialogue_context(p_actor uuid,p_turn_id uuid,p_category text default 'base',p_query text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.world_npc_dialogue_turns; w private.world_npc_instances; sheet jsonb; visible_facts jsonb;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  select * into w from private.world_npc_instances where id=t.instance_id;
  select v.sheet into sheet from private.npc_versions v where v.id=t.version_id;
  select coalesce(jsonb_agg(f),'[]'::jsonb) into visible_facts from jsonb_array_elements(sheet#>'{lore,facts}') f where coalesce((f->>'trustThreshold')::integer,0)<=w.relationship;
  if p_category='base' then return jsonb_build_object(
    'npcId',t.npc_id,'versionId',t.version_id,'instanceId',t.instance_id,
    'name',sheet#>>'{identity,name}','identity',sheet->'identity','personality',sheet->'personality',
    'relationship',w.relationship,'campaign',w.campaign_state,'message',t.message,'day',t.day_number,
    'questStatus',case when w.status in ('active','between','failed') then w.status else 'terminal' end,
    'intention',jsonb_build_object('goal',sheet#>>'{campaign,durableGoal}','motivation',sheet#>>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0'),'motivation'],'targets',sheet#>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0'),'allowedTargets'],'steps',w.campaign_state->'activePlan'),
    'allowedTargets',coalesce(sheet#>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0'),'allowedTargets'],'[]'::jsonb),
    'playerIntent',case when t.intent_card_id is null then null else (select jsonb_build_object('key',c.card_key,'instruction',cc.prompt_instruction,'tier',c.tier) from public.intent_cards c join public.intent_card_catalog cc on cc.card_key=c.card_key and cc.version=c.catalog_version where c.id=t.intent_card_id) end,
    'recent',(select coalesce(jsonb_agg(item order by seq),'[]'::jsonb) from (select input_sequence seq,jsonb_build_object('turnId',id,'keeper',message,'npc',result->>'reply') item from private.world_npc_dialogue_turns where instance_id=t.instance_id and status='completed' order by input_sequence desc limit 6) x),
    'hospitality',case when t.offering_kind='beverage' then (select jsonb_build_object('kind','beverage','itemId',b.id,'itemName',b.name,'quality',b.quality_index,'relationshipChange',case when b.quality_index>=4 then 2 when b.quality_index>=2 then 1 when b.quality_index=1 then -1 else -2 end) from public.beverages b where b.id=t.offering_item_id and b.save_id=t.save_id) when t.offering_kind='food' then (select jsonb_build_object('kind','food','itemId',f.id,'itemName',f.name,'quality',f.quality_index,'relationshipChange',case when f.quality_index>=4 then 2 when f.quality_index>=2 then 1 when f.quality_index=1 then -1 else -2 end) from public.foods f where f.id=t.offering_item_id and f.save_id=t.save_id) end
  );
  elsif p_category in ('history','relationships') then return jsonb_build_object('facts',visible_facts,'relationships',sheet#>'{lore,relationships}');
  elsif p_category in ('quests','news') then return jsonb_build_object('campaign',w.campaign_state,'events',private.world_npc_transcript(t.instance_id));
  elsif p_category='memories' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'turnId',turn_id,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'importance',importance,'entities',entity_refs) order by score desc,importance desc,created_at desc) from (select m.*,case when btrim(p_query)='' then 0 else ts_rank(m.search,websearch_to_tsquery('english',left(p_query,200))) end score from private.world_npc_memories m where m.instance_id=t.instance_id order by score desc,m.importance desc,m.created_at desc limit 8) x),'[]'::jsonb);
  end if;
  raise sqlstate 'PT400' using message='Unknown context category';
end $$;

create function public.npc_dialogue_complete(p_actor uuid,p_turn_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.world_npc_dialogue_turns; s public.tavern_saves; w private.world_npc_instances; d jsonb; reply text; mem jsonb;
  v_delta integer:=0; v_budget integer; v_intention jsonb; v_serving jsonb; v_relationship integer; v_result jsonb;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into s from public.tavern_saves where user_id=p_actor for update;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  if t.status='completed' then return t.result; end if;
  if t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Dialogue attempt expired'; end if;
  select * into w from private.world_npc_instances where id=t.instance_id and save_id=s.id for update;
  if not found or s.revision<>t.source_revision or s.current_day<>t.day_number or w.conversation_sequence<>t.input_sequence or w.status in ('dead','departed','dismissed','removed','quarantined') then
    update private.world_npc_dialogue_turns set status='stale',error_code='STATE_CHANGED' where id=t.id;
    update private.world_npc_dialogue_attempts set status='stale',finished_at=now() where fence=p_fence;
    return jsonb_build_object('status','stale');
  end if;
  d:=t.checkpoints#>'{decision,value}'; reply:=t.checkpoints#>>'{speak,value,text}';
  if reply is null or char_length(btrim(reply)) not between 1 and 2000 or not coalesce(d->>'stance' in ('agree','refuse','clarify','respond') and d->>'subject' in ('quest','personal','hospitality') and d->>'reaction' in ('-1','0','1'),false) then raise sqlstate 'PT400' using message='Validated decision and reply are required'; end if;
  if (d->>'reaction')::integer<>0 and (coalesce(char_length(d->>'evidence'),0)<3 or position(d->>'evidence' in t.message)=0) then raise sqlstate 'PT400' using message='Reaction needs source evidence'; end if;
  v_intention:=nullif(d->'intention','null'::jsonb);
  if v_intention is not null and (d->>'stance'<>'agree' or not private.world_npc_plan_valid(v_intention->'steps')) then raise sqlstate 'PT400' using message='Unsupported intention'; end if;
  if t.offering_kind is not null then v_serving:=private.world_npc_apply_hospitality(p_actor,s.id,w.id,t.offering_kind,t.offering_item_id,t.id,s.revision); select * into s from public.tavern_saves where id=s.id for update; end if;
  if (d->>'reaction')::integer<>0 and not exists(select 1 from private.world_npc_reactions where instance_id=w.id and day_number=t.day_number and subject=d->>'subject') then
    select coalesce(sum(abs(delta)),0) into v_budget from private.world_npc_reactions where instance_id=w.id and day_number=t.day_number and sign(delta)=sign((d->>'reaction')::integer);
    if v_budget<4 then v_delta:=2*(d->>'reaction')::integer; insert into private.world_npc_reactions(instance_id,day_number,subject,delta,turn_id) values(w.id,t.day_number,d->>'subject',v_delta,t.id); update private.world_npc_instances set relationship=greatest(0,least(100,relationship+v_delta)) where id=w.id; end if;
  end if;
  if v_intention is not null then update private.world_npc_instances set status='active',campaign_state=jsonb_set(jsonb_set(jsonb_set(campaign_state,'{activePlan}',v_intention->'steps',true),'{step}','0'::jsonb,true),'{preparation}','0'::jsonb,true) where id=w.id; end if;
  if t.intent_card_id is not null then insert into private.world_npc_intent_card_plays(save_id,card_id,turn_id,card_key,tier,day_number) select s.id,c.id,t.id,c.card_key,c.tier,s.current_day from public.intent_cards c where c.id=t.intent_card_id and c.save_id=s.id; if not found then raise sqlstate 'PT409' using message='Intent card is unavailable'; end if; end if;
  update private.world_npc_instances set conversation_sequence=conversation_sequence+1 where id=w.id returning relationship into v_relationship;
  for mem in select value from jsonb_array_elements(coalesce(t.checkpoints#>'{remember,value,memories}','[]'::jsonb)) limit 3 loop
    if mem->>'kind' in ('keeper_claim','npc_statement','promise','interaction') and char_length(coalesce(mem->>'text','')) between 1 and 500 and char_length(coalesce(mem->>'quote','')) between 3 and 500 and (mem->>'speaker'='keeper' and position(mem->>'quote' in t.message)>0 or mem->>'speaker'='npc' and position(mem->>'quote' in reply)>0) then insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs) values(t.id,w.id,mem->>'kind',mem->>'text',mem->>'quote',mem->>'speaker',case when mem->>'kind'='promise' then 3 when mem->>'kind'='keeper_claim' then 1 else 2 end,'{}') on conflict do nothing; end if;
  end loop;
  if v_serving is null and (v_delta<>0 or v_intention is not null or t.intent_card_id is not null) then
    update public.tavern_saves set revision=revision+1,updated_at=now() where id=s.id;
  end if;
  v_result:=jsonb_build_object('turnId',t.id,'npcId',t.npc_id,'instanceId',t.instance_id,'reply',reply,'sequence',t.input_sequence+1,'relationship',v_relationship,'relationshipChange',v_delta,'intention',v_intention,'serving',v_serving,'committedRevision',(select revision from public.tavern_saves where id=s.id));
  update private.world_npc_dialogue_turns set status='completed',result=v_result,completed_at=now() where id=t.id;
  update private.world_npc_dialogue_attempts set status='completed',finished_at=now() where fence=p_fence;
  return v_result;
end $$;

create function public.npc_dialogue_status(p_turn_id uuid,p_cancel boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.world_npc_dialogue_turns;
begin
  select t0.* into t from private.world_npc_dialogue_turns t0 join public.tavern_saves s on s.id=t0.save_id where t0.id=p_turn_id and s.user_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  if p_cancel and t.status<>'completed' then update private.world_npc_dialogue_attempts set status='cancelled',finished_at=now() where turn_id=t.id and status='processing'; update private.world_npc_dialogue_turns set status='cancelled',fence=extensions.gen_random_uuid() where id=t.id returning * into t; end if;
  return jsonb_build_object('status',case when t.status='processing' and t.lease_until<now() then 'failed' else t.status end,'result',t.result,'input',jsonb_build_object('turnId',t.id,'npcId',t.npc_id,'message',t.message,'expectedConversationSequence',t.input_sequence,'intentCardId',t.intent_card_id,'offeringKind',t.offering_kind,'offeringItemId',t.offering_item_id));
end $$;

-- The UUID runtime exposes one bounded Bar projection so the client does not
-- stitch private sheets, inventories, and per-NPC journals together itself.
create or replace function public.npc_journals(p_instance_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(w.id::text,jsonb_build_object(
    'instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
    'sequence',w.conversation_sequence,'relationship',w.relationship,'campaign',w.campaign_state,
    'currentMilestone',v.sheet#>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0')],
    'risk',case when coalesce((w.campaign_state->>'preparation')::integer,0)>=2 then 'low' when coalesce((w.campaign_state->>'preparation')::integer,0)=1 then 'moderate' else 'high' end,
    'turns',coalesce(t.turns,'[]'::jsonb),'events',coalesce(e.events,'[]'::jsonb),'pending',p.pending
  )),'{}'::jsonb)
  from private.world_npc_instances w
  join public.tavern_saves s on s.id=w.save_id
  join private.npc_versions v on v.id=w.version_id
  left join lateral (
    select jsonb_agg(item order by sequence) turns from (
      select input_sequence sequence,jsonb_build_object('turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,'npc',result->>'reply','relationship',result->'relationship') item
      from private.world_npc_dialogue_turns where instance_id=w.id and status='completed' order by input_sequence desc limit 40
    ) recent
  ) t on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',narration,'publicNews',public_news) order by day desc) events
    from (select * from private.world_npc_quest_events where instance_id=w.id order by day desc,id desc limit 12) recent_events
  ) e on true
  left join lateral (
    select jsonb_build_object('turnId',id,'status',case when status='processing' and lease_until<now() then 'failed' else status end,'message',message,'error',error_code) pending
    from private.world_npc_dialogue_turns where instance_id=w.id and status in ('processing','failed') order by created_at desc limit 1
  ) p on true
  where s.user_id=auth.uid() and w.id=any(p_instance_ids)
$$;

create function public.npc_bar_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$
  with owned as (select * from public.tavern_saves where user_id=auth.uid() limit 1),
  roster as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,
      'name',case when w.status in ('removed','quarantined') then 'Unavailable guest' else v.sheet#>>'{identity,name}' end,
      'title',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,title}' end,
      'description',case when w.status in ('removed','quarantined') then null else v.sheet#>>'{identity,shortDescription}' end,
      'relationship',w.relationship,'rating',i.rating,'origin',i.origin,
      'sceneStorageKey',a.storage_key,'creator',case when i.origin='community' then jsonb_build_object('displayName',p.display_name,'profile',p.normalized_display_name) else null end,
      'sequence',w.conversation_sequence
    ) order by w.npc_id),'[]'::jsonb) value
    from private.world_npc_instances w join owned s on s.id=w.save_id join private.npc_identities i on i.id=w.npc_id
    join private.npc_versions v on v.id=w.version_id left join private.npc_assets a on a.id=v.selected_scene_asset_id
    left join public.player_profiles p on p.user_id=i.creator_id
  ),
  offerings as (
    select jsonb_build_object(
      'beverages',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'kind','beverage','name',b.name,'qualityIndex',b.quality_index) order by b.created_at desc,b.id) from public.beverages b join owned s on s.id=b.save_id where not exists(select 1 from public.hospitality_events h where h.save_id=b.save_id and h.beverage_id=b.id) and not exists(select 1 from private.world_npc_hospitality_events h where h.save_id=b.save_id and h.beverage_id=b.id)),'[]'::jsonb),
      'foods',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'kind','food','name',f.name,'qualityIndex',f.quality_index) order by f.created_at desc,f.id) from public.foods f join owned s on s.id=f.save_id where not exists(select 1 from public.hospitality_events h where h.save_id=f.save_id and h.food_id=f.id) and not exists(select 1 from private.world_npc_hospitality_events h where h.save_id=f.save_id and h.food_id=f.id)),'[]'::jsonb),
      'intentCards',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'cardKey',c.card_key,'displayName',cc.display_name,'description',cc.description,'tier',c.tier) order by c.created_at,c.id) from public.intent_cards c join owned s on s.id=c.save_id join public.intent_card_catalog cc on cc.card_key=c.card_key and cc.version=c.catalog_version where not exists(select 1 from public.intent_card_plays p where p.save_id=c.save_id and p.card_id=c.id) and not exists(select 1 from private.world_npc_intent_card_plays p where p.save_id=c.save_id and p.card_id=c.id)),'[]'::jsonb)
    ) value
  ),
  recent as (
    select jsonb_build_object(
      'hospitality',coalesce((select jsonb_agg(h.result order by h.happened_at desc) from (select event.result,event.created_at as happened_at from private.world_npc_hospitality_events event join owned s on s.id=event.save_id order by event.created_at desc limit 20) h),'[]'::jsonb),
      'news',coalesce((select jsonb_agg(jsonb_build_object('instanceId',e.instance_id,'day',e.day,'outcome',e.outcome,'text',e.narration) order by e.created_at desc) from (select e.* from private.world_npc_quest_events e join private.world_npc_instances w on w.id=e.instance_id join owned s on s.id=w.save_id where e.public_news order by e.created_at desc limit 12) e),'[]'::jsonb),
      'latestArrival',(select result from private.world_npc_arrival_receipts a join owned s on s.id=a.save_id order by a.day desc limit 1)
    ) value
  )
  select case when exists(select 1 from owned) then jsonb_build_object(
    'save',(select jsonb_build_object('id',id,'revision',revision,'gold',gold,'currentDay',current_day,'communityNpcLevel',community_npc_level,'communityNpcCapacity',greatest(2,community_npc_level+1)) from owned),
    'roster',(select value from roster),'offerings',(select value from offerings),'recent',(select value from recent)
  ) end
$$;

-- Shares and reports use the same immutable full transcript, including dialogue.
create or replace function public.npc_share_preview(p_instance uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare transcript jsonb; begin
  if not exists(select 1 from private.world_npc_instances w join public.tavern_saves s on s.id=w.save_id where w.id=p_instance and s.user_id=auth.uid()) then raise sqlstate 'PT404'; end if;
  transcript:=private.world_npc_transcript(p_instance);
  return jsonb_build_object('instanceId',p_instance,'transcript',transcript,'contentHash',encode(extensions.digest(transcript::text,'sha256'),'hex'),'irreversible',true);
end $$;
create or replace function public.npc_report(p_version uuid,p_category text,p_evidence text) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid; r uuid; v private.npc_versions; v_transcript jsonb; v_generation jsonb; i uuid;
begin
  select id into s from public.tavern_saves where user_id=auth.uid();
  select id into i from private.world_npc_instances where save_id=s and version_id=p_version and status not in ('removed','quarantined') limit 1;
  if s is null or i is null then raise sqlstate 'PT404' using message='That NPC version is not present in this world'; end if;
  select * into v from private.npc_versions where id=p_version; v_transcript:=private.world_npc_transcript(i);
  select coalesce(asset.generation,'{}') into v_generation from private.npc_assets asset where asset.id=v.selected_scene_asset_id;
  insert into private.npc_reports(reporter_id,world_id,version_id,category,evidence,transcript,frozen_version,generation_metadata) values(auth.uid(),s,p_version,p_category,p_evidence,v_transcript,jsonb_build_object('versionId',v.id,'npcId',v.npc_id,'sheetHash',v.sheet_hash,'sheet',v.sheet),coalesce(v_generation,'{}')) returning id into r;
  return r;
end $$;

revoke all on all tables in schema private from public,anon,authenticated;
revoke all on function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid),public.npc_dialogue_checkpoint(uuid,uuid,uuid,text,jsonb),public.npc_dialogue_context(uuid,uuid,text,text),public.npc_dialogue_complete(uuid,uuid,uuid),public.npc_dialogue_status(uuid,boolean),public.npc_serve_hospitality(uuid,uuid,text,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.npc_dialogue_begin(uuid,uuid,uuid,text,bigint,uuid,text,uuid),public.npc_dialogue_checkpoint(uuid,uuid,uuid,text,jsonb),public.npc_dialogue_context(uuid,uuid,text,text),public.npc_dialogue_complete(uuid,uuid,uuid) to service_role;
grant execute on function public.npc_dialogue_status(uuid,boolean),public.npc_serve_hospitality(uuid,uuid,text,uuid,uuid,bigint),public.npc_journals(uuid[]),public.npc_bar_snapshot(),public.npc_share_preview(uuid),public.npc_report(uuid,text,text) to authenticated;

commit;
