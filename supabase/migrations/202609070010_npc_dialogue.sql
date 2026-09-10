-- Adaptive dialogue v1. All private narrative/effect writes remain server-only.
create table private.npc_content (patron_key text primary key references public.patron_catalog, version text not null, sheet jsonb not null);
create table private.npc_content_versions (
  patron_key text not null references private.npc_content, version text not null, sheet jsonb not null,
  primary key(patron_key,version)
);
create table private.npc_rules (
  version text primary key, turns_per_minute integer not null check(turns_per_minute between 1 and 60),
  turns_per_day integer not null check(turns_per_day between 1 and 1000),
  calls_per_day integer not null check(calls_per_day between 1 and 10000),
  calls_per_turn integer not null check(calls_per_turn between 1 and 8)
);
insert into private.npc_rules values('npc-rules-v1',6,100,400,8);
create table private.npc_lives (
  save_id uuid references public.tavern_saves on delete cascade,
  patron_key text references private.npc_content,
  sequence bigint not null default 0,
  availability text not null default 'present' check (availability in ('present','dead','departed')),
  primary key(save_id,patron_key)
);
create table private.npc_quests (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves on delete cascade,
  patron_key text not null references private.npc_content,
  intention jsonb not null,
  status text not null default 'active' check(status in ('active','succeeded','failed','abandoned')),
  preparation integer not null default 0 check(preparation between 0 and 2),
  step integer not null default 0,
  authored boolean not null default true,
  content_version text not null default 'npc-v1',
  rule_version text not null default 'npc-rules-v1' references private.npc_rules,
  created_at timestamptz not null default now()
);
create unique index npc_one_active_quest on private.npc_quests(save_id,patron_key) where status='active';
create table private.npc_events (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves on delete cascade,
  patron_key text not null, quest_id uuid references private.npc_quests on delete cascade,
  day integer not null, action_id uuid, outcome text not null, text text not null,
  draw integer, chance integer, public_news boolean not null default false,
  content_version text not null default 'npc-v1',
  rule_version text not null default 'npc-rules-v1' references private.npc_rules,
  unique(quest_id,day)
);
create table public.dialogue_turns (
  id uuid primary key, save_id uuid not null references public.tavern_saves on delete cascade,
  actor_id uuid not null references auth.users on delete cascade,
  patron_key text not null references private.npc_content,
  message text not null check(char_length(message) between 1 and 2000),
  input_sequence bigint not null check(input_sequence>=0),
  beverage_id uuid, card_id uuid, source_revision bigint not null, day integer not null,
  status text not null check(status in ('processing','completed','failed','cancelled','stale')),
  fence uuid not null default extensions.gen_random_uuid(), lease_until timestamptz not null,
  calls integer not null default 0, checkpoints jsonb not null default '{}',
  result jsonb, error_code text, content_version text not null default 'npc-v1',
  rule_version text not null default 'npc-rules-v1' references private.npc_rules,
  created_at timestamptz not null default now(), completed_at timestamptz,
  check(card_id is null or beverage_id is not null),
  foreign key(save_id,actor_id) references public.tavern_saves(id,user_id) on delete cascade
);
alter table public.dialogue_turns enable row level security;
revoke all on public.dialogue_turns from public,anon,authenticated;
grant all on public.dialogue_turns to service_role;
create table private.npc_attempts (
  turn_id uuid not null references public.dialogue_turns on delete cascade, fence uuid primary key,
  started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  status text not null default 'processing', calls integer not null default 0, error_code text
);
create table private.npc_retired_targets (
  save_id uuid references public.tavern_saves on delete cascade, patron_key text not null,
  target text not null, source_quest uuid not null references private.npc_quests on delete cascade,
  primary key(save_id,patron_key,target)
);
create index dialogue_recent on public.dialogue_turns(save_id,patron_key,created_at);
create table private.npc_memories (
  id uuid primary key default extensions.gen_random_uuid(),
  turn_id uuid not null references public.dialogue_turns on delete cascade,
  save_id uuid not null references public.tavern_saves on delete cascade,
  patron_key text not null, kind text not null check(kind in ('keeper_claim','npc_statement','promise','interaction')),
  text text not null, quote text not null, speaker text not null check(speaker in ('keeper','npc')),
  importance smallint not null default 1 check(importance between 1 and 3),
  entity_refs text[] not null default '{}',
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english',text)) stored,
  unique(turn_id,text)
);
create index npc_memory_search on private.npc_memories using gin(search);
create index npc_memory_entities on private.npc_memories using gin(entity_refs);
create index npc_memory_scope on private.npc_memories(save_id,patron_key,created_at desc);
create table private.npc_reactions (
  save_id uuid references public.tavern_saves on delete cascade,
  patron_key text not null, day integer not null, subject text not null check(subject in ('quest','personal','hospitality')),
  delta integer not null check(delta in (-2,2)), turn_id uuid references public.dialogue_turns on delete cascade,
  primary key(save_id,patron_key,day,subject)
);
create table private.npc_usage (
  actor_id uuid references auth.users on delete cascade, day date,
  turns integer not null default 0, calls integer not null default 0, primary key(actor_id,day)
);

insert into private.npc_content(patron_key,version,sheet) values
('lira','npc-v1',$npc${"key": "lira", "name": "Lira Nightwind", "title": "Elven Ranger", "voice": "Measured, observant, dryly humorous. Short concrete sentences. Cares about people more than glory. Never speaks like an assistant.", "personality": {"values": ["protect Millhaven", "keep promises", "verify rumors"], "likes": ["careful preparation", "honest hospitality", "quiet woods"], "dislikes": ["recklessness", "cruelty", "boasting"], "boundaries": ["Will not deliberately harm civilians", "Does not accept an unverified accusation as fact"]}, "relationships": [{"entity": "scout-mara", "relation": "trusted friend and local scout"}, {"entity": "torvin", "relation": "respects his practical knowledge but distrusts his secrecy"}, {"entity": "bandit-camp", "relation": "rivals threatening Millhaven"}], "facts": [{"id": "lira-road", "category": "history", "text": "Lira has guarded the old road outside Millhaven for several seasons.", "minTrust": 0}, {"id": "lira-mara", "category": "relationships", "text": "Mara once guided Lira home through a storm; Lira values her judgment.", "minTrust": 0}, {"id": "lira-regret", "category": "history", "text": "Years ago Lira rushed an expedition and lost an unnamed companion. She still regrets ignoring a warning.", "minTrust": 60}], "quest": {"title": "The Bandit Camp", "goal": "Protect Millhaven from the bandit camp", "motivation": "The old road must be safe for the people who depend on it", "targets": ["millhaven", "bandit-camp", "old-road", "scout-mara"], "steps": [{"action": "prepare", "approach": "scouting"}, {"action": "attempt", "approach": "combat"}], "skills": {"scouting": 4, "combat": 3, "diplomacy": 2, "trade": 1}, "difficulty": 3, "loss": {"approach": "combat", "maxPreparation": 0, "kind": "dead", "warning": "An unprepared assault could cost Lira her life."}, "success": "Lira secures a safer future for Millhaven through her agreed plan.", "failure": "Lira's attempt fails. The bandits disperse with their spoils; this opportunity is permanently lost.", "retireTargets": ["bandit-camp"]}}$npc$::jsonb),
('torvin','npc-v1',$npc${"key": "torvin", "name": "Torvin Ashbeard", "title": "Dwarven Merchant", "voice": "Warm, shrewd, slightly theatrical. Uses occasional practical merchant comparisons. Pride conceals anxiety; never speaks like an assistant.", "personality": {"values": ["fair bargains", "protect his reputation", "provide for his community"], "likes": ["patient negotiation", "good craftsmanship", "dependable company"], "dislikes": ["being patronized", "empty guarantees", "careless spending"], "boundaries": ["Will not knowingly sell a counterfeit", "Does not spend the keeper's gold without a real game action"]}, "relationships": [{"entity": "lira", "relation": "friend whose honesty he trusts"}, {"entity": "buyer-oren", "relation": "demanding business rival and prospective buyer"}, {"entity": "eastern-mines", "relation": "home community he wants to support"}], "facts": [{"id": "torvin-stone", "category": "history", "text": "Torvin brought the heartstone from the eastern mines to seek a buyer in Millhaven.", "minTrust": 0}, {"id": "torvin-oren", "category": "relationships", "text": "Oren is a demanding buyer who values provenance and preparation.", "minTrust": 0}, {"id": "torvin-debt", "category": "history", "text": "Torvin privately hopes the proceeds will repay a debt incurred supporting the miners.", "minTrust": 55}], "quest": {"title": "The Gemstone Deal", "goal": "Secure a fair future for the heartstone", "motivation": "Turn skilled miners' work into a fair return without compromising his reputation", "targets": ["heartstone", "buyer-oren", "eastern-mines", "millhaven"], "steps": [{"action": "prepare", "approach": "trade"}, {"action": "attempt", "approach": "trade"}], "skills": {"scouting": 1, "combat": 1, "diplomacy": 3, "trade": 4}, "difficulty": 3, "loss": {"approach": "combat", "maxPreparation": 0, "kind": "departed", "warning": "An unprepared confrontation could ruin Torvin's standing and drive him from Millhaven permanently."}, "success": "Torvin achieves his agreed objective for the heartstone and preserves his standing.", "failure": "Torvin's attempt fails. Oren withdraws from the deal; this opportunity is permanently lost.", "retireTargets": ["heartstone", "buyer-oren"]}}$npc$::jsonb);

insert into private.npc_content_versions select patron_key,version,sheet from private.npc_content;
alter table private.npc_content add foreign key(patron_key,version) references private.npc_content_versions(patron_key,version);
alter table private.npc_quests add foreign key(patron_key,content_version) references private.npc_content_versions(patron_key,version);
alter table public.dialogue_turns add foreign key(patron_key,content_version) references private.npc_content_versions(patron_key,version);
alter table private.npc_events add foreign key(patron_key,content_version) references private.npc_content_versions(patron_key,version);
create function private.check_npc_content() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from private.npc_content_versions where patron_key=new.patron_key and version=new.version and sheet=new.sheet) then
    raise exception 'Publish the immutable character version before selecting it';
  end if;
  return new;
end; $$;
create trigger check_npc_content before update on private.npc_content for each row execute function private.check_npc_content();
create function private.immutable_npc_content() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Published NPC content is immutable; publish a new version'; end; $$;
create trigger immutable_npc_content before update or delete on private.npc_content_versions
  for each row execute function private.immutable_npc_content();

create function private.npc_targets(p_save uuid,p_patron text,p_version text) returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(x),'[]'::jsonb) from private.npc_content_versions c,
    jsonb_array_elements_text((c.sheet->'quest'->'targets')||jsonb_build_array('lira','torvin')) x
    where c.patron_key=p_patron and c.version=p_version and not exists(
      select 1 from private.npc_retired_targets r where r.save_id=p_save and r.patron_key=p_patron and r.target=x);
$$;
create function private.retire_npc_targets(p_quest private.npc_quests) returns void language sql set search_path='' as $$
  insert into private.npc_retired_targets(save_id,patron_key,target,source_quest)
  select p_quest.save_id,p_quest.patron_key,x,p_quest.id from jsonb_array_elements_text(
    case when p_quest.authored then (select sheet->'quest'->'retireTargets' from private.npc_content_versions
      where patron_key=p_quest.patron_key and version=p_quest.content_version) else p_quest.intention->'targets' end) x on conflict do nothing;
$$;

create function private.ensure_npcs(p_save uuid) returns void language plpgsql set search_path='' as $$
declare c record; q jsonb; progress integer; total integer; seeded private.npc_quests;
begin
  for c in select * from private.npc_content loop
    if exists(select 1 from private.npc_lives where save_id=p_save and patron_key=c.patron_key) then continue; end if;
    insert into private.npc_lives(save_id,patron_key) values(p_save,c.patron_key);
    insert into public.patron_states(save_id,patron_key,relationship)
      select p_save,patron_key,initial_relationship from public.patron_catalog where patron_key=c.patron_key on conflict do nothing;
    select ps.arc_progress,array_length(pc.arc_steps,1) into progress,total from public.patron_states ps
      join public.patron_catalog pc using(patron_key) where ps.save_id=p_save and ps.patron_key=c.patron_key;
    q:=c.sheet->'quest';
    insert into private.npc_quests(save_id,patron_key,intention,status,preparation,step,content_version)
      values(p_save,c.patron_key,jsonb_build_object('goal',q->'goal','motivation',q->'motivation','targets',q->'targets','steps',q->'steps'),
      case when progress>=total then 'succeeded' else 'active' end,least(2,progress),case when progress>0 then 1 else 0 end,c.version) returning * into seeded;
    if seeded.status='succeeded' then perform private.retire_npc_targets(seeded); end if;
    if progress>0 then
      insert into private.npc_events(save_id,patron_key,day,outcome,text,content_version)
        select p_save,c.patron_key,0,'legacy', 'Recorded before dialogue v1: '||pc.arc_steps[progress],c.version
        from public.patron_catalog pc where pc.patron_key=c.patron_key;
    end if;
  end loop;
end; $$;
do $$ declare s record; begin for s in select id from public.tavern_saves loop perform private.ensure_npcs(s.id); end loop; end; $$;

alter function public.create_tavern() rename to create_tavern_before_dialogue;
alter function public.create_tavern_before_dialogue() set schema private;
revoke all on function private.create_tavern_before_dialogue() from public,anon,authenticated;
create function public.create_tavern() returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; begin r:=private.create_tavern_before_dialogue(); perform 1 from public.tavern_saves where id=(r->>'saveId')::uuid for update; perform private.ensure_npcs((r->>'saveId')::uuid); return r; end; $$;
revoke all on function public.create_tavern() from public,anon;
grant execute on function public.create_tavern() to authenticated;

-- Legacy catalog remains intact for historic receipts, but future endings are private.
revoke select on public.patron_catalog from authenticated;
alter function public.get_bar_snapshot() security definer;

create function private.npc_hospitality(p_save uuid,p_patron text,p_day integer) returns integer language sql stable set search_path='' as $$
  select greatest(-3,least(3,coalesce(sum(b.quality_index-3),0)))::integer from public.serving_events e
    join public.beverages b on b.id=e.beverage_id where e.save_id=p_save and e.patron_key=p_patron and e.day_number=p_day;
$$;
create function private.npc_chance(p_save uuid,p_patron text,p_day integer,p_quest private.npc_quests) returns integer language sql stable set search_path='' as $$
  select greatest(10,least(90,50+10*((sheet->'quest'->'skills'->>(p_quest.intention->'steps'->p_quest.step->>'approach'))::integer
    -(sheet->'quest'->>'difficulty')::integer)+10*p_quest.preparation+5*private.npc_hospitality(p_save,p_patron,p_day)))
  from private.npc_content_versions where patron_key=p_patron and version=p_quest.content_version;
$$;
create function private.npc_warning(p_quest private.npc_quests) returns text language sql stable set search_path='' as $$
  select case when p_quest.status='active' and p_quest.authored and p_quest.intention->'steps'->p_quest.step->>'action'='attempt'
    and p_quest.intention->'steps'->p_quest.step->>'approach'=sheet->'quest'->'loss'->>'approach'
    and p_quest.preparation<=(sheet->'quest'->'loss'->>'maxPreparation')::integer then sheet->'quest'->'loss'->>'warning' end
  from private.npc_content_versions where patron_key=p_quest.patron_key and version=p_quest.content_version;
$$;
create function public.get_npc_journal(p_patron text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; l private.npc_lives; q private.npc_quests; chance integer;
begin
  select * into s from public.tavern_saves where user_id=auth.uid();
  if not found then return null; end if;
  select * into l from private.npc_lives where save_id=s.id and patron_key=p_patron;
  if not found then raise sqlstate 'PT404' using message='Patron not found'; end if;
  select * into q from private.npc_quests where save_id=s.id and patron_key=p_patron order by (status='active') desc,created_at desc limit 1;
  chance:=private.npc_chance(s.id,p_patron,s.current_day,q);
  return jsonb_build_object('sequence',l.sequence,'availability',l.availability,'intention',q.intention,
    'questStatus',q.status,'preparation',q.preparation,'nextStep',q.step,'risk',case when q.status<>'active' then 'none' when chance>=70 then 'low' when chance>=45 then 'moderate' else 'high' end,
    'warning',private.npc_warning(q),
    'turns',coalesce((select jsonb_agg(x.item order by x.seq) from (select input_sequence seq,jsonb_build_object('id',id,'message',message,'reply',result->'reply','day',day) item
      from public.dialogue_turns where save_id=s.id and patron_key=p_patron and status='completed' order by input_sequence desc limit 40) x),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(x.item order by x.day desc) from (select day,jsonb_build_object('id',id,'patronKey',patron_key,'text',text,'outcome',outcome,'day',day) item
      from private.npc_events where save_id=s.id and (patron_key=p_patron or public_news and day<s.current_day) order by day desc,id limit 30) x),'[]'::jsonb),
    'pending',(select jsonb_build_object('turnId',id,'status',case when status='processing' and lease_until<now() then 'failed' else status end,'message',message,'error',error_code)
      from public.dialogue_turns where save_id=s.id and patron_key=p_patron and status in ('processing','failed') and input_sequence=l.sequence order by created_at desc limit 1));
end; $$;
revoke all on function public.get_npc_journal(text) from public,anon;
grant execute on function public.get_npc_journal(text) to authenticated;

create function public.dialogue_begin(p_actor uuid,p_turn uuid,p_patron text,p_message text,p_sequence bigint,p_beverage uuid default null,p_card uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; t public.dialogue_turns; l private.npc_lives; n integer; u private.npc_usage; rules private.npc_rules; content text;
begin
  select * into s from public.tavern_saves where user_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Start a tavern before talking'; end if;
  if p_turn is null or p_sequence is null or p_sequence<0 or p_message is null or char_length(btrim(p_message)) not between 1 and 2000 or p_card is not null and p_beverage is null then
    raise sqlstate 'PT400' using message='Enter a message; a social card requires a drink'; end if;
  select * into t from public.dialogue_turns where id=p_turn;
  if found then
    if t.actor_id<>p_actor or t.patron_key<>p_patron or t.message<>p_message or t.input_sequence<>p_sequence or t.beverage_id is distinct from p_beverage or t.card_id is distinct from p_card then
      raise sqlstate 'PT409' using message='Turn identifier already used for different input'; end if;
    if t.status='completed' then return to_jsonb(t); end if;
    if t.status in ('cancelled','stale') then raise sqlstate 'PT409' using message='This turn is closed; send a new message'; end if;
    if t.status='processing' and t.lease_until>now() then return to_jsonb(t)||'{"busy":true}'::jsonb; end if;
    if t.source_revision<>s.revision or t.day<>s.current_day then
      update public.dialogue_turns set status='stale',error_code='STATE_CHANGED' where id=t.id;
      update private.npc_attempts set status='stale',finished_at=now() where turn_id=t.id and status='processing';
      return jsonb_build_object('status','stale');
    end if;
  end if;
  perform private.ensure_npcs(s.id);
  select * into l from private.npc_lives where save_id=s.id and patron_key=p_patron;
  if not found or l.availability<>'present' then raise sqlstate 'PT422' using message='This patron is not available'; end if;
  if l.sequence<>p_sequence then raise sqlstate 'PT409' using message='Conversation changed; refresh before replying'; end if;
  if exists(select 1 from public.brew_sessions where save_id=s.id and status='active') then raise sqlstate 'PT422' using message='Finish your active brew before talking'; end if;
  if exists(select 1 from public.dialogue_turns where save_id=s.id and id<>p_turn and status='processing' and lease_until>now()) then
    raise sqlstate 'PT409' using message='Another conversation is still being completed'; end if;
  if p_beverage is not null and not exists(select 1 from public.beverages b where b.save_id=s.id and b.id=p_beverage
    and not exists(select 1 from public.serving_events e where e.save_id=s.id and e.beverage_id=b.id)) then raise sqlstate 'PT409' using message='Drink no longer available'; end if;
  if p_card is not null and not exists(select 1 from public.social_cards c where c.save_id=s.id and c.id=p_card
    and not exists(select 1 from public.serving_events e where e.save_id=s.id and e.card_id=c.id)) then raise sqlstate 'PT409' using message='Card no longer available'; end if;
  if t.id is null then
    insert into private.npc_usage(actor_id,day) values(p_actor,(now() at time zone 'UTC')::date) on conflict do nothing;
    select * into u from private.npc_usage where actor_id=p_actor and day=(now() at time zone 'UTC')::date;
    select count(*) into n from public.dialogue_turns where actor_id=p_actor and created_at>now()-interval '1 minute';
    select * into rules from private.npc_rules where version='npc-rules-v1';
    if n>=rules.turns_per_minute or u.turns>=rules.turns_per_day then raise sqlstate 'PT429' using message='Conversation limit reached; please return later'; end if;
    update private.npc_usage set turns=turns+1 where actor_id=p_actor and day=u.day;
    select content_version into content from private.npc_quests where save_id=s.id and patron_key=p_patron order by (status='active') desc,created_at desc limit 1;
    insert into public.dialogue_turns(id,save_id,actor_id,patron_key,message,input_sequence,beverage_id,card_id,source_revision,day,status,lease_until,content_version)
      values(p_turn,s.id,p_actor,p_patron,p_message,p_sequence,p_beverage,p_card,s.revision,s.current_day,'processing',now()+interval '120 seconds',content) returning * into t;
  else
    select * into u from private.npc_usage where actor_id=p_actor and day=(now() at time zone 'UTC')::date;
    select * into rules from private.npc_rules where version='npc-rules-v1';
    if coalesce(u.turns,0)>=rules.turns_per_day then raise sqlstate 'PT429' using message='Conversation attempt limit reached'; end if;
    insert into private.npc_usage(actor_id,day,turns) values(p_actor,(now() at time zone 'UTC')::date,1) on conflict(actor_id,day) do update set turns=private.npc_usage.turns+1;
    update public.dialogue_turns set status='processing',fence=extensions.gen_random_uuid(),lease_until=now()+interval '120 seconds',error_code=null where id=p_turn returning * into t;
  end if;
  update private.npc_attempts set status='expired',finished_at=now() where turn_id=t.id and status='processing';
  insert into private.npc_attempts(turn_id,fence) values(t.id,t.fence);
  return to_jsonb(t);
end; $$;

create function public.dialogue_checkpoint(p_actor uuid,p_turn uuid,p_fence uuid,p_stage text,p_value jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.dialogue_turns; n integer; rules private.npc_rules;
begin
  perform 1 from public.tavern_saves where user_id=p_actor for update;
  select * into t from public.dialogue_turns where id=p_turn and actor_id=p_actor for update;
  if not found or t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Conversation attempt expired'; end if;
  if p_stage='reserve' then
    insert into private.npc_usage(actor_id,day) values(p_actor,(now() at time zone 'UTC')::date) on conflict do nothing;
    select calls into n from private.npc_usage where actor_id=p_actor and day=(now() at time zone 'UTC')::date;
    select * into rules from private.npc_rules where version='npc-rules-v1';
    if t.calls>=rules.calls_per_turn or n>=rules.calls_per_day then raise sqlstate 'PT429' using message='Conversation generation budget reached'; end if;
    update private.npc_usage set calls=calls+1 where actor_id=p_actor and day=(now() at time zone 'UTC')::date;
    update public.dialogue_turns set calls=calls+1 where id=p_turn;
    update private.npc_attempts set calls=calls+1 where fence=p_fence;
  elsif p_stage='fail' then
    update public.dialogue_turns set status='failed',error_code=case when p_value->>'code' in ('BUDGET','CONSISTENCY','STRUCTURE','PT429','PROVIDER_FAILED') then p_value->>'code' else 'GENERATION_FAILED' end where id=p_turn;
    update private.npc_attempts set status='failed',finished_at=now(),error_code=(select error_code from public.dialogue_turns where id=p_turn) where fence=p_fence;
  elsif p_stage in ('base','context0','context1','investigate0','investigate1','deliberate','decision','speak','review','rewrite','rereview','remember') then
    update public.dialogue_turns set checkpoints=jsonb_set(checkpoints,array[p_stage],p_value,true) where id=p_turn;
  else raise sqlstate 'PT400' using message='Unknown stage'; end if;
end; $$;

create function public.dialogue_context(p_actor uuid,p_turn uuid,p_category text default 'base',p_query text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.dialogue_turns; c jsonb; q private.npc_quests; rel integer; b public.beverages; card public.social_cards; price integer;
begin
  select * into t from public.dialogue_turns where id=p_turn and actor_id=p_actor;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  select sheet into c from private.npc_content_versions where patron_key=t.patron_key and version=t.content_version;
  select relationship into rel from public.patron_states where save_id=t.save_id and patron_key=t.patron_key;
  select * into q from private.npc_quests where save_id=t.save_id and patron_key=t.patron_key order by (status='active') desc,created_at desc limit 1;
  if p_category='base' then
    select * into b from public.beverages where id=t.beverage_id and save_id=t.save_id;
    select * into card from public.social_cards where id=t.card_id and save_id=t.save_id;
    select prices[b.quality_index+1] into price from public.patron_catalog where patron_key=t.patron_key;
    return jsonb_build_object('name',c->'name','voice',c->'voice','personality',c->'personality','entities',
      (select jsonb_agg(distinct x) from jsonb_array_elements_text((c->'quest'->'targets')||jsonb_build_array('lira','torvin')) x),
      'contentVersion',t.content_version,'allowedTargets',private.npc_targets(t.save_id,t.patron_key,t.content_version),'relationship',rel,'questStatus',q.status,'intention',q.intention,'day',t.day,'message',t.message,
      'recent',coalesce((select jsonb_agg(x.item order by x.seq) from (select input_sequence seq,jsonb_build_object('id',id,'keeper',message,'npc',result->'reply') item
        from public.dialogue_turns where save_id=t.save_id and patron_key=t.patron_key and status='completed' order by input_sequence desc limit 6) x),'[]'::jsonb),
      'hospitality',case when b.id is null then null else jsonb_build_object('beverage',b.name,'quality',b.quality_index,'qualityLabel',(array['Repugnant','Awful','Potable','Decent','Great','Legendary','Resplendent'])[b.quality_index+1],'card',card.display_name,
        'gold',round(price*coalesce(card.gold_multiplier,1)),'relationshipChange',coalesce(card.relationship_gain,0)+case when b.quality_index>=4 then 6 when b.quality_index>=2 then 3 when b.quality_index=1 then -2 else -4 end) end);
  elsif p_category in ('history','relationships') then
    return jsonb_build_object('facts',coalesce((select jsonb_agg(f) from jsonb_array_elements(c->'facts') f
      where f->>'category'=p_category and (f->>'minTrust')::integer<=rel),'[]'::jsonb),
      'relationships',case when p_category='relationships' then c->'relationships' else '[]'::jsonb end);
  elsif p_category in ('quests','news') then
    return jsonb_build_object('quest',case when p_category='quests' then jsonb_build_object('id',q.id,'status',q.status,'intention',q.intention,'preparation',q.preparation,'nextStep',q.step) else null end,
      'events',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',id,'patron',patron_key,'day',day,'text',text,'outcome',outcome) item
      from private.npc_events where save_id=t.save_id and (patron_key=t.patron_key or public_news and day<t.day)
      and (p_category<>'news' or public_news and day<t.day) order by day desc limit 12) x),'[]'::jsonb));
  elsif p_category='memories' then
    return coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',id,'sourceTurn',turn_id,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'importance',importance,'entities',entity_refs) item
      from private.npc_memories where save_id=t.save_id and patron_key=t.patron_key
      order by case when btrim(p_query)='' then 0 else ts_rank(search,websearch_to_tsquery('english',left(p_query,200)))
        +case when exists(select 1 from unnest(entity_refs) e where position(replace(e,'-',' ') in lower(p_query))>0) then 1 else 0 end end desc,
        importance desc,created_at desc limit 8) x),'[]'::jsonb);
  end if;
  raise sqlstate 'PT400' using message='Unknown context category';
end; $$;

create or replace function private.apply_serving(
  p_actor uuid, p_save_id uuid, p_patron_key text, p_beverage_id uuid, p_card_id uuid default null,
  p_action_id uuid default null, p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := p_actor;
  v_save public.tavern_saves%rowtype;
  v_patron public.patron_catalog%rowtype;
  v_state public.patron_states%rowtype;
  v_beverage public.beverages%rowtype;
  v_card public.social_cards%rowtype;
  v_prior public.serving_events%rowtype;
  v_gold integer;
  v_relationship integer;
  v_progress integer;
  v_story text;
  v_receipt jsonb;
begin
  if v_actor is null then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  if p_save_id is null or p_beverage_id is null or p_action_id is null or p_patron_key is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise sqlstate 'PT400' using message = 'Invalid serving request';
  end if;
  select * into v_save from public.tavern_saves where id = p_save_id and user_id = v_actor for update;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
  select * into v_prior from public.serving_events where save_id = p_save_id and action_id = p_action_id;
  if found then
    if v_prior.patron_key = p_patron_key and v_prior.beverage_id = p_beverage_id
      and v_prior.card_id is not distinct from p_card_id and v_prior.input_expected_revision = p_expected_revision then
      return v_prior.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;
  if v_save.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Tavern state changed; review the latest bar before serving';
  end if;
  if exists(select 1 from private.npc_lives where save_id=p_save_id and patron_key=p_patron_key and availability<>'present') then raise sqlstate 'PT422' using message='This patron is not available'; end if;
  select * into v_patron from public.patron_catalog where patron_key = p_patron_key;
  if not found then raise sqlstate 'PT404' using message = 'Patron not found'; end if;
  select * into v_beverage from public.beverages where save_id = p_save_id and id = p_beverage_id;
  if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
  if exists (select 1 from public.serving_events where save_id = p_save_id and beverage_id = p_beverage_id) then
    raise sqlstate 'PT409' using message = 'This beverage has already been served';
  end if;
  if p_card_id is not null then
    select * into v_card from public.social_cards where save_id = p_save_id and id = p_card_id;
    if not found then raise sqlstate 'PT404' using message = 'Tavern or serving item not found'; end if;
    if exists (select 1 from public.serving_events where save_id = p_save_id and card_id = p_card_id) then
      raise sqlstate 'PT409' using message = 'This social card has already been played';
    end if;
  end if;

  insert into public.patron_states (save_id, patron_key, relationship)
    values (p_save_id, p_patron_key, v_patron.initial_relationship) on conflict do nothing;
  select * into v_state from public.patron_states where save_id = p_save_id and patron_key = p_patron_key for update;

  v_gold := round(v_patron.prices[v_beverage.quality_index + 1] * coalesce(v_card.gold_multiplier, 1))::integer;
  v_relationship := least(100, greatest(0, v_state.relationship + coalesce(v_card.relationship_gain, 0)
    + case when v_beverage.quality_index >= 4 then 6 when v_beverage.quality_index >= 2 then 3
      when v_beverage.quality_index = 1 then -2 else -4 end));
  v_progress := v_state.arc_progress;
  v_story := 'Hospitality shapes trust and tonight’s preparations. Quest actions occur after closing.';
  v_receipt := jsonb_build_object(
    'actionId', p_action_id, 'patronKey', p_patron_key, 'patronName', v_patron.display_name,
    'beverageId', p_beverage_id, 'beverageName', v_beverage.name, 'qualityIndex', v_beverage.quality_index,
    'cardId', p_card_id, 'goldEarned', v_gold, 'goldBalance', v_save.gold + v_gold,
    'relationshipChange', v_relationship - v_state.relationship, 'relationship', v_relationship,
    'arcChange', v_progress - v_state.arc_progress, 'arcProgress', v_progress,
    'arcTotal', array_length(v_patron.arc_steps, 1), 'storyEvent', v_story,
    'dayNumber', v_save.current_day, 'committedRevision', v_save.revision + 1, 'rulesVersion', 'serving-v1'
  );
  update public.patron_states set relationship = v_relationship, arc_progress = v_progress, updated_at = now()
    where save_id = p_save_id and patron_key = p_patron_key;
  update public.tavern_saves set gold = gold + v_gold, revision = revision + 1, updated_at = now() where id = p_save_id;
  insert into public.serving_events (save_id, action_id, actor_id, patron_key, beverage_id, card_id,
    input_expected_revision, day_number, gold_earned, relationship_change, arc_change, result, rules_version, committed_revision)
  values (p_save_id, p_action_id, v_actor, p_patron_key, p_beverage_id, p_card_id, p_expected_revision,
    v_save.current_day, v_gold, v_relationship - v_state.relationship, v_progress - v_state.arc_progress,
    v_receipt, 'serving-v1', v_save.revision + 1);
  return v_receipt;
end;
$$;


create or replace function public.serve_beverage(p_save_id uuid,p_patron_key text,p_beverage_id uuid,p_card_id uuid default null,p_action_id uuid default null,p_expected_revision bigint default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.apply_serving(auth.uid(),p_save_id,p_patron_key,p_beverage_id,p_card_id,p_action_id,p_expected_revision);
$$;

create function public.dialogue_complete(p_actor uuid,p_turn uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare t public.dialogue_turns; s public.tavern_saves; l private.npc_lives; q private.npc_quests;
  d jsonb; m jsonb; step jsonb; reply text; serving jsonb; reaction integer; delta integer:=0; rel integer; before_rel integer;
  budget integer; r jsonb; changed boolean:=false; intention jsonb; quote text;
begin
  select * into s from public.tavern_saves where user_id=p_actor for update;
  select * into t from public.dialogue_turns where id=p_turn and actor_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  if t.status='completed' then return t.result; end if;
  if t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Conversation attempt expired'; end if;
  select * into l from private.npc_lives where save_id=s.id and patron_key=t.patron_key;
  if s.revision<>t.source_revision or s.current_day<>t.day or l.sequence<>t.input_sequence or l.availability<>'present' then
    update public.dialogue_turns set status='stale',error_code='STATE_CHANGED' where id=t.id;
    update private.npc_attempts set status='stale',finished_at=now() where turn_id=t.id and status='processing';
    return jsonb_build_object('status','stale');
  end if;
  if coalesce((coalesce(t.checkpoints->'rereview',t.checkpoints->'review')->'value'->>'ok')::boolean,false) is not true then
    raise sqlstate 'PT422' using message='Response has not passed consistency review'; end if;
  reply:=coalesce(t.checkpoints->'rewrite',t.checkpoints->'speak')->'value'->>'text';
  d:=t.checkpoints->'decision'->'value';
  if reply is null or char_length(reply) not between 1 and 4000 or d is null then raise sqlstate 'PT400' using message='Invalid reply'; end if;
  if not coalesce(d->>'stance' in ('agree','refuse','clarify','respond') and d->>'subject' in ('quest','personal','hospitality') and d->>'reaction' in ('-1','0','1'),false) then raise sqlstate 'PT400' using message='Invalid decision'; end if;
  reaction:=(d->>'reaction')::integer;
  if reaction is null or reaction not in (-1,0,1) then raise sqlstate 'PT400' using message='Invalid reaction'; end if;
  if reaction<>0 and (coalesce(char_length(d->>'evidence'),0)<3 or position(d->>'evidence' in t.message)=0) then raise sqlstate 'PT400' using message='Reaction needs source evidence'; end if;
  select * into q from private.npc_quests where save_id=s.id and patron_key=t.patron_key order by (status='active') desc,created_at desc limit 1;
  intention:=nullif(d->'intention','null'::jsonb);
  if intention is not null then
    if not coalesce(jsonb_typeof(intention)='object' and jsonb_typeof(intention->'goal')='string' and jsonb_typeof(intention->'motivation')='string' and jsonb_typeof(intention->'steps')='array' and jsonb_typeof(intention->'targets')='array',false) then raise sqlstate 'PT400' using message='Invalid intention shape'; end if;
    if d->>'stance'<>'agree' or (q.status<>'active' and intention->>'goal'=q.intention->>'goal') or char_length(intention->>'goal') not between 1 and 300
      or char_length(intention->>'motivation') not between 1 and 300 or jsonb_array_length(intention->'steps') not between 1 and 3
      or jsonb_array_length(intention->'targets') not between 1 and 5 then raise sqlstate 'PT400' using message='Invalid intention'; end if;
    for step in select value from jsonb_array_elements(intention->'steps') loop
      if not coalesce(step->>'action' in ('prepare','attempt','wait','abandon') and step->>'approach' in ('scouting','combat','diplomacy','trade'),false) then raise sqlstate 'PT400' using message='Unsupported action'; end if;
    end loop;
    if intention->'steps'->-1->>'action' not in ('attempt','abandon') then raise sqlstate 'PT400' using message='A plan needs an attempt or abandonment after preparation or waiting'; end if;
    if exists(select 1 from jsonb_array_elements_text(intention->'targets') x where not private.npc_targets(s.id,t.patron_key,t.content_version) ? x) then raise sqlstate 'PT400' using message='Unknown quest target'; end if;
  end if;
  select relationship into before_rel from public.patron_states where save_id=s.id and patron_key=t.patron_key;
  if t.beverage_id is not null then
    serving:=private.apply_serving(p_actor,s.id,t.patron_key,t.beverage_id,t.card_id,t.id,s.revision);
  end if;
  if reaction<>0 and not exists(select 1 from private.npc_reactions where save_id=s.id and patron_key=t.patron_key and day=t.day and subject=d->>'subject') then
    select coalesce(sum(abs(x.delta)),0) into budget from private.npc_reactions x where save_id=s.id and patron_key=t.patron_key and day=t.day and sign(x.delta)=reaction;
    if budget<4 then
      delta:=reaction*2;
      insert into private.npc_reactions values(s.id,t.patron_key,t.day,d->>'subject',delta,t.id);
      update public.patron_states set relationship=greatest(0,least(100,relationship+delta)),updated_at=now() where save_id=s.id and patron_key=t.patron_key;
      changed:=true;
    end if;
  end if;
  if intention is not null and intention<>q.intention then
    -- Changed goals retain their opportunity lineage; they cannot reset terminal outcomes.
    if intention->>'goal'<>q.intention->>'goal' then
      if q.status='active' then
        update private.npc_quests set status='abandoned' where id=q.id;
        insert into private.npc_events(save_id,patron_key,quest_id,day,outcome,text,content_version)
          values(s.id,t.patron_key,q.id,t.day,'changed_goal','The previous objective was abandoned: '||(q.intention->>'goal'),t.content_version) on conflict do nothing;
      end if;
      insert into private.npc_quests(save_id,patron_key,intention,preparation,authored,content_version,created_at)
        values(s.id,t.patron_key,intention,case when q.status='active' then q.preparation else 0 end,false,t.content_version,clock_timestamp());
    else update private.npc_quests set intention=intention,step=0 where id=q.id; end if;
    changed:=true;
  end if;
  if changed and serving is null then update public.tavern_saves set revision=revision+1 where id=s.id; end if;
  select relationship into rel from public.patron_states where save_id=s.id and patron_key=t.patron_key;
  update private.npc_lives set sequence=sequence+1 where save_id=s.id and patron_key=t.patron_key;
  for m in select value from jsonb_array_elements(coalesce(t.checkpoints->'remember'->'value'->'memories','[]'::jsonb)) limit 3 loop
    quote:=m->>'quote';
    if m->>'kind' in ('keeper_claim','npc_statement','promise','interaction') and char_length(m->>'text') between 1 and 500
      and (m->>'text') !~* '\m(player|npc|assistant|system)\M' and char_length(quote)>=3 and (m->>'speaker'='keeper' and position(quote in t.message)>0 or m->>'speaker'='npc' and position(quote in reply)>0) then
      insert into private.npc_memories(turn_id,save_id,patron_key,kind,text,quote,speaker,importance,entity_refs)
        values(t.id,s.id,t.patron_key,m->>'kind',m->>'text',quote,m->>'speaker',
          case when m->>'kind'='promise' then 3 when m->>'kind'='keeper_claim' then 1 else 2 end,
          array(select e from jsonb_array_elements_text(coalesce(t.checkpoints->'base'->'value'->'entities','[]'::jsonb)) e
            where position(replace(e,'-',' ') in lower((m->>'text')||' '||quote))>0)) on conflict do nothing;
    end if;
  end loop;
  r:=jsonb_build_object('turnId',t.id,'reply',reply,'sequence',l.sequence+1,'relationship',rel,'relationshipChange',rel-before_rel,
    'serving',serving,'intention',intention,'committedRevision',(select revision from public.tavern_saves where id=s.id));
  update public.dialogue_turns set status='completed',result=r,completed_at=now() where id=t.id;
  update private.npc_attempts set status='completed',finished_at=now() where fence=p_fence;
  return r;
end; $$;

create function public.dialogue_status(p_turn uuid,p_cancel boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.dialogue_turns;
begin
  perform 1 from public.tavern_saves where user_id=auth.uid() for update;
  select * into t from public.dialogue_turns where id=p_turn and actor_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  if p_cancel and t.status<>'completed' then
    update private.npc_attempts set status='cancelled',finished_at=now() where turn_id=t.id and status='processing';
    update public.dialogue_turns set status='cancelled',fence=extensions.gen_random_uuid() where id=t.id returning * into t;
  end if;
  return jsonb_build_object('status',case when t.status='processing' and t.lease_until<now() then 'failed' else t.status end,'result',t.result,
    'input',jsonb_build_object('turnId',t.id,'patronKey',t.patron_key,'message',t.message,'expectedConversationSequence',t.input_sequence,'beverageId',t.beverage_id,'cardId',t.card_id));
end; $$;
revoke all on function public.dialogue_status(uuid,boolean) from public,anon;
grant execute on function public.dialogue_status(uuid,boolean) to authenticated;

create or replace function public.advance_tavern_day(p_save_id uuid,p_action_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves; prior public.craft_actions; q private.npc_quests; c jsonb; a text; chance integer; draw integer; outcome text; narration text; warning text; r jsonb;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Authentication required'; end if;
  if p_action_id is null or p_expected_revision is null then raise sqlstate 'PT400' using message='Invalid day transition'; end if;
  select * into s from public.tavern_saves where id=p_save_id and user_id=auth.uid() for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into prior from public.craft_actions where save_id=s.id and action_id=p_action_id;
  if found then
    if prior.command_kind='advance_day' and prior.input_expected_revision=p_expected_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier already used';
  end if;
  if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh before closing'; end if;
  if exists(select 1 from public.brew_sessions where save_id=s.id and status='active') then raise sqlstate 'PT422' using message='Finish the active brew before closing'; end if;
  if exists(select 1 from public.dialogue_turns where save_id=s.id and status='processing' and lease_until>now()) then raise sqlstate 'PT409' using message='Finish or cancel the pending conversation before closing'; end if;
  update private.npc_attempts a set status='stale',finished_at=now(),error_code='DAY_ENDED' from public.dialogue_turns t where a.turn_id=t.id and t.save_id=s.id and a.status='processing';
  update public.dialogue_turns set status='stale',fence=extensions.gen_random_uuid(),error_code='DAY_ENDED' where save_id=s.id and status in ('processing','failed');
  perform private.ensure_npcs(s.id);
  for q in select quests.* from private.npc_quests quests join private.npc_lives l using(save_id,patron_key)
    where quests.save_id=s.id and quests.status='active' and l.availability='present' order by patron_key loop
    select sheet into c from private.npc_content_versions where patron_key=q.patron_key and version=q.content_version;
    a:=q.intention->'steps'->q.step->>'action'; draw:=null; chance:=null;
    if a='prepare' then
      update private.npc_quests set preparation=least(2,preparation+1),step=case when step+1<jsonb_array_length(intention->'steps') then step+1 else step end where id=q.id;
      outcome:='prepared'; narration:=(c->>'name')||' prepared for the agreed objective: '||(q.intention->>'goal');
    elsif a='wait' or a is null then
      update private.npc_quests set step=case when step+1<jsonb_array_length(intention->'steps') then step+1 else step end where id=q.id;
      outcome:='waited'; narration:=(c->>'name')||' waited, keeping the current intention in mind.';
    elsif a='abandon' then
      update private.npc_quests set status='abandoned' where id=q.id;
      perform private.retire_npc_targets(q);
      outcome:='abandoned'; narration:=(c->>'name')||' abandoned the objective: '||(q.intention->>'goal');
    else
      chance:=private.npc_chance(s.id,q.patron_key,s.current_day,q);
      draw:=floor(random()*100)::integer;
      outcome:=case when draw<chance then 'succeeded' else 'failed' end;
      update private.npc_quests set status=outcome where id=q.id;
      perform private.retire_npc_targets(q);
      narration:=(c->>'name')||' '||case when outcome='succeeded' then 'succeeded at' else 'failed permanently at' end||' the agreed objective: '||(q.intention->>'goal');
      if q.authored then narration:=narration||'. '||(c->'quest'->>case when outcome='succeeded' then 'success' else 'failure' end); end if;
      warning:=private.npc_warning(q);
      if outcome='failed' and draw>=95 and warning is not null then
        update private.npc_lives set availability=c->'quest'->'loss'->>'kind' where save_id=s.id and patron_key=q.patron_key;
        narration:=narration||case when c->'quest'->'loss'->>'kind'='dead' then '. The unprepared assault cost Lira her life.' else '. Torvin left Millhaven permanently after the confrontation.' end;
      end if;
      update public.patron_states set relationship=greatest(0,least(100,relationship+case when outcome='succeeded' then 3 else -3 end)) where save_id=s.id and patron_key=q.patron_key;
    end if;
    insert into private.npc_events(save_id,patron_key,quest_id,day,action_id,outcome,text,draw,chance,public_news,content_version)
      -- Only authored terminal outcomes are designated public news. Preparation,
      -- private negotiations and emergent objectives stay with their own character.
      values(s.id,q.patron_key,q.id,s.current_day,p_action_id,outcome,narration,draw,chance,
        q.authored and outcome in ('succeeded','failed'),q.content_version);
  end loop;
  update public.tavern_saves set current_day=current_day+1,day_minigame_completed=false,revision=revision+1,updated_at=now() where id=s.id;
  r:=jsonb_build_object('actionId',p_action_id,'newDay',s.current_day+1,'committedRevision',s.revision+1,
    'events',coalesce((select jsonb_agg(jsonb_build_object('patronKey',e.patron_key,'text',e.text,'outcome',e.outcome)) from private.npc_events e where e.save_id=s.id and e.action_id=p_action_id),'[]'::jsonb));
  insert into public.craft_actions(save_id,action_id,actor_id,command_kind,input_expected_revision,result,committed_revision)
    values(s.id,p_action_id,auth.uid(),'advance_day',p_expected_revision,r,s.revision+1);
  return r;
end; $$;

-- All generated-result endpoints are exclusively callable by the server credential.
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on function public.dialogue_begin(uuid,uuid,text,text,bigint,uuid,uuid) from public,anon,authenticated;
revoke all on function public.dialogue_checkpoint(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.dialogue_context(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.dialogue_complete(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dialogue_begin(uuid,uuid,text,text,bigint,uuid,uuid),public.dialogue_checkpoint(uuid,uuid,uuid,text,jsonb),
 public.dialogue_context(uuid,uuid,text,text),public.dialogue_complete(uuid,uuid,uuid) to service_role;
revoke all on function private.ensure_npcs(uuid),private.npc_hospitality(uuid,text,integer),private.npc_chance(uuid,text,integer,private.npc_quests),
 private.npc_warning(private.npc_quests),private.apply_serving(uuid,uuid,text,uuid,uuid,uuid,bigint) from public,anon,authenticated;

revoke all on function private.immutable_npc_content(),private.npc_targets(uuid,text,text),private.retire_npc_targets(private.npc_quests) from public,anon,authenticated;

alter function public.get_tavern_snapshot() security definer;
revoke usage on schema private from authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
