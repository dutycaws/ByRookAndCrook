-- Issue #39: one authoritative physical deck.  A daily_deck_card is the
-- stable player-facing identity; source_id retains the social card or actual item identity.
begin;

create table public.daily_decks (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  phase text not null default 'preparation' check (phase in ('preparation','service','closed')),
  generation_id uuid not null default extensions.gen_random_uuid(),
  guest_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  unique (save_id, day_number)
);
create table public.daily_deck_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  deck_id uuid not null references public.daily_decks(id) on delete cascade,
  source_kind text not null check (source_kind in ('social','food','beverage')),
  source_id uuid not null,
  pile text not null default 'draw' check (pile in ('draw','hand','discard','consumed')),
  position integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (save_id, source_kind, source_id)
);
create index daily_deck_cards_pile_idx on public.daily_deck_cards(save_id, deck_id, pile, position);
create table public.daily_deck_changes (
  id uuid primary key default extensions.gen_random_uuid(),
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  effective_day integer not null check (effective_day > 0),
  change_kind text not null check (change_kind in ('add_social','remove_social')),
  card_key text check (card_key in ('charm','insight','rumor')),
  card_id uuid references public.daily_deck_cards(id) on delete restrict,
  source_action_id uuid not null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  check ((change_kind = 'add_social') = (card_key is not null)),
  check ((change_kind = 'remove_social') = (card_id is not null)),
  unique (save_id, source_action_id),
  unique nulls not distinct (save_id, effective_day, change_kind, card_id)
);
create table public.daily_deck_provisions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  provision_key text not null check (provision_key = 'potion_of_forgetfulness'),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (save_id, provision_key)
);
create table public.daily_deck_purchase_actions (
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  action_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (save_id, action_id)
);
create table public.player_suggestion_batches (
  id uuid primary key references public.daily_decks(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','generating','ready','fallback')),
  frozen_context jsonb not null default '{}'::jsonb,
  claim_expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.player_suggestions (
  generation_id uuid not null references public.player_suggestion_batches(id) on delete cascade,
  daily_card_id uuid not null references public.daily_deck_cards(id) on delete cascade,
  npc_instance_id uuid not null,
  text text not null check (length(btrim(text)) between 1 and 2000),
  source text not null check (source in ('generated','fallback')),
  created_at timestamptz not null default now(),
  primary key (generation_id, daily_card_id, npc_instance_id)
);

alter table public.daily_decks enable row level security;
alter table public.daily_deck_cards enable row level security;
alter table public.daily_deck_changes enable row level security;
alter table public.daily_deck_provisions enable row level security;
alter table public.daily_deck_purchase_actions enable row level security;
alter table public.player_suggestion_batches enable row level security;
alter table public.player_suggestions enable row level security;
create policy daily_decks_read_own on public.daily_decks for select to authenticated using (exists (select 1 from public.tavern_saves s where s.id=save_id and s.user_id=(select auth.uid())));
create policy daily_deck_cards_read_own on public.daily_deck_cards for select to authenticated using (exists (select 1 from public.tavern_saves s where s.id=save_id and s.user_id=(select auth.uid())));
create policy daily_deck_changes_read_own on public.daily_deck_changes for select to authenticated using (exists (select 1 from public.tavern_saves s where s.id=save_id and s.user_id=(select auth.uid())));
create policy daily_deck_provisions_read_own on public.daily_deck_provisions for select to authenticated using (exists (select 1 from public.tavern_saves s where s.id=save_id and s.user_id=(select auth.uid())));
create policy suggestion_batches_read_own on public.player_suggestion_batches for select to authenticated using (exists (select 1 from public.tavern_saves s where s.id=save_id and s.user_id=(select auth.uid())));
create policy suggestions_read_own on public.player_suggestions for select to authenticated using (exists (select 1 from public.player_suggestion_batches b join public.tavern_saves s on s.id=b.save_id where b.id=generation_id and s.user_id=(select auth.uid())));
revoke all on public.daily_decks, public.daily_deck_cards, public.daily_deck_changes, public.daily_deck_provisions, public.player_suggestion_batches, public.player_suggestions from public, anon, authenticated;
revoke all on public.daily_deck_purchase_actions from public, anon, authenticated;
grant select on public.daily_decks, public.daily_deck_cards, public.daily_deck_changes, public.daily_deck_provisions, public.player_suggestion_batches, public.player_suggestions to authenticated;
grant all on public.daily_decks, public.daily_deck_cards, public.daily_deck_changes, public.daily_deck_provisions, public.player_suggestion_batches, public.player_suggestions to service_role;
grant all on public.daily_deck_purchase_actions to service_role;

-- Explicit one-time upgrade: it only adds missing historical starter copies.
-- It never replenishes an existing save after a player has removed all social cards.
create table public.daily_deck_upgrades (save_id uuid primary key references public.tavern_saves(id) on delete cascade, applied_at timestamptz not null default now());
alter table public.daily_deck_upgrades enable row level security;
revoke all on public.daily_deck_upgrades from public, anon, authenticated;
grant all on public.daily_deck_upgrades to service_role;
create or replace function private.daily_deck_upgrade(p_save_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.daily_deck_upgrades where save_id=p_save_id) then return; end if;
  -- Upgrade the untouched legacy four-starter save once. Historical Flirt stays
  -- in provenance, but is excluded from every eligible deck.
  if (select count(*) from public.intent_cards where save_id=p_save_id and source_kind='starter')=4 then
    insert into public.intent_cards(save_id,card_key,tier,source_kind,source_key)
    values(p_save_id,'charm','fine','starter','issue39-second-charm'),
          (p_save_id,'insight','fine','starter','issue39-second-insight'),
          (p_save_id,'rumor','fine','starter','issue39-second-rumor')
    on conflict(save_id,source_kind,source_key) do nothing;
  end if;
  insert into public.daily_deck_upgrades(save_id) values(p_save_id) on conflict do nothing;
end $$;
revoke all on function private.daily_deck_upgrade(uuid) from public, anon, authenticated;
do $$ declare v_save uuid; begin
  for v_save in select id from public.tavern_saves loop perform private.daily_deck_upgrade(v_save); end loop;
end $$;
create or replace function private.ensure_intent_cards(p_save uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.daily_deck_upgrades where save_id=p_save) then return; end if;
  insert into public.intent_cards(save_id,card_key,tier,source_kind,source_key)
  select p_save,k,'fine','starter','issue39-starter-'||k||'-'||n
  from unnest(array['charm','insight','rumor']) k cross join generate_series(1,2) n
  on conflict(save_id,source_kind,source_key) do nothing;
  insert into public.daily_deck_upgrades(save_id) values(p_save) on conflict do nothing;
end $$;
revoke all on function private.ensure_intent_cards(uuid) from public,anon,authenticated;
alter table public.intent_cards drop constraint intent_cards_source_kind_check;
alter table public.intent_cards add constraint intent_cards_source_kind_check
  check(source_kind in ('starter','brew','bake','seed'));


create or replace function private.daily_deck_payload(p_save_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  with d as (select * from public.daily_decks where save_id=p_save_id order by day_number desc limit 1),
  cards as (select c.*, coalesce(i.card_key, c.source_kind) card_key, coalesce(ic.display_name, f.name, b.name, c.source_kind) display_name, coalesce(f.quality_index,b.quality_index) quality_index from public.daily_deck_cards c left join public.intent_cards i on c.source_kind='social' and i.id=c.source_id left join public.intent_card_catalog ic on ic.card_key=i.card_key and ic.version=i.catalog_version left join public.foods f on c.source_kind='food' and f.id=c.source_id left join public.beverages b on c.source_kind='beverage' and b.id=c.source_id where c.deck_id=(select id from d))
  select coalesce((select jsonb_build_object('dayNumber',d.day_number,'phase',d.phase,'generationId',d.id,'drawPileIds',coalesce((select jsonb_agg(id order by position,id) from cards where pile='draw'),'[]'::jsonb),'handIds',coalesce((select jsonb_agg(id order by position,id) from cards where pile='hand'),'[]'::jsonb),'discardIds',coalesce((select jsonb_agg(id order by position,id) from cards where pile='discard'),'[]'::jsonb),'cards',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'kind',source_kind,'sourceId',source_id,'cardKey',case when source_kind='social' then card_key end,'displayName',display_name,'qualityIndex',quality_index,'pile',pile)) order by created_at,id) from cards),'[]'::jsonb),'pending',jsonb_build_object('additions',(select count(*) from public.daily_deck_changes where save_id=p_save_id and applied_at is null and change_kind='add_social'),'removals',coalesce((select jsonb_agg(card_id) from public.daily_deck_changes where save_id=p_save_id and applied_at is null and change_kind='remove_social'),'[]'::jsonb)),'provisions',jsonb_build_object('potionOfForgetfulness',coalesce((select quantity from public.daily_deck_provisions where save_id=p_save_id and provision_key='potion_of_forgetfulness'),0)),'maxHandSize',5) from d), 'null'::jsonb);
$$;
revoke all on function private.daily_deck_payload(uuid) from public, anon, authenticated;

create function public.daily_deck_state() returns jsonb language plpgsql security definer set search_path='' as $$ declare v_save uuid; begin select id into v_save from public.tavern_saves where user_id=auth.uid() order by updated_at desc limit 1; if v_save is null then return null; end if; return private.daily_deck_payload(v_save); end $$;
revoke all on function public.daily_deck_state() from public, anon; grant execute on function public.daily_deck_state() to authenticated;

create function public.daily_deck_open(p_expected_revision bigint,p_guest_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves%rowtype; d public.daily_decks%rowtype;
begin
  select * into s from public.tavern_saves where user_id=auth.uid() order by updated_at desc limit 1 for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into d from public.daily_decks where save_id=s.id and day_number=s.current_day for update;
  if found and d.phase='service' then
    return jsonb_build_object('dailyDeck',private.daily_deck_payload(s.id),'committedRevision',s.revision);
  end if;
  if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh'; end if;
  if found and d.phase='closed' then raise sqlstate 'PT409' using message='Service is closed for today'; end if;
  if s.world_phase<>'open' then raise sqlstate 'PT409' using message='The new morning is still settling'; end if;
  perform private.ensure_intent_cards(s.id);
  perform private.daily_deck_prepare(s.id);
  select * into d from public.daily_decks where save_id=s.id and day_number=s.current_day for update;
  -- The random generation UUID supplies a fresh whole-deck shuffle seed.
  update public.daily_deck_cards c set position=x.n
  from(select id,row_number() over(order by md5(id::text||d.id::text)) n
       from public.daily_deck_cards where deck_id=d.id and pile='draw') x where x.id=c.id;
  update public.daily_deck_cards set pile='hand'
  where id in(select id from public.daily_deck_cards where deck_id=d.id and pile='draw' order by position limit 5);
  update public.daily_decks set phase='service',opened_at=now() where id=d.id;
  insert into public.player_suggestion_batches(id,save_id,frozen_context)
  values(d.id,s.id,private.player_suggestion_context(d.id)) on conflict do nothing;
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=s.id;
  return jsonb_build_object('dailyDeck',private.daily_deck_payload(s.id),'committedRevision',s.revision+1);
end $$;
revoke all on function public.daily_deck_open(bigint,uuid[]) from public, anon; grant execute on function public.daily_deck_open(bigint,uuid[]) to authenticated;

create function public.daily_deck_close(p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$ declare s public.tavern_saves%rowtype; d public.daily_decks%rowtype; begin select * into s from public.tavern_saves where user_id=auth.uid() order by updated_at desc limit 1 for update; if not found then raise sqlstate 'PT404'; end if; if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh'; end if; select * into d from public.daily_decks where save_id=s.id and day_number=s.current_day for update; if not found or d.phase<>'service' then raise sqlstate 'PT409' using message='Service is not open'; end if; update public.daily_deck_cards set pile='discard',updated_at=now() where deck_id=d.id and pile='hand'; update public.daily_decks set phase='closed',closed_at=now() where id=d.id; update public.tavern_saves set revision=revision+1,updated_at=now() where id=s.id; return jsonb_build_object('dailyDeck',private.daily_deck_payload(s.id),'committedRevision',s.revision+1); end $$;
revoke all on function public.daily_deck_close(bigint) from public, anon; grant execute on function public.daily_deck_close(bigint) to authenticated;

-- Called by the dialogue admission/completion fence.  Admission only reads/locks;
-- completion moves the social card to discard or the serving card to consumed.
create function private.daily_deck_admit(p_save_id uuid,p_daily_card_id uuid) returns public.daily_deck_cards language plpgsql security definer set search_path='' as $$ declare c public.daily_deck_cards%rowtype; begin select card_source.* into c from public.daily_deck_cards card_source join public.daily_decks d on d.id=card_source.deck_id where card_source.id=p_daily_card_id and card_source.save_id=p_save_id and d.phase='service' and card_source.pile='hand' for update; if not found then raise sqlstate 'PT409' using message='Daily card is unavailable'; end if; return c; end $$;
create function private.daily_deck_commit(p_save_id uuid,p_daily_card_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare c public.daily_deck_cards%rowtype; begin c:=private.daily_deck_admit(p_save_id,p_daily_card_id); update public.daily_deck_cards set pile=case when c.source_kind='social' then 'discard' else 'consumed' end,updated_at=now() where id=c.id; end $$;
revoke all on function private.daily_deck_admit(uuid,uuid), private.daily_deck_commit(uuid,uuid) from public, anon, authenticated;

create function public.daily_deck_use_forgetfulness(p_expected_revision bigint,p_card_id uuid,p_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.tavern_saves%rowtype; c public.daily_deck_cards%rowtype;
  prior public.daily_deck_purchase_actions%rowtype; result jsonb;
begin
  select * into s from public.tavern_saves where user_id=auth.uid() order by updated_at desc limit 1 for update;
  if not found then raise sqlstate 'PT404' using message='Tavern not found'; end if;
  select * into prior from public.daily_deck_purchase_actions where save_id=s.id and action_id=p_action_id;
  if found then
    if prior.result->>'cardId'=p_card_id::text and (prior.result->>'inputRevision')::bigint=p_expected_revision then return prior.result; end if;
    raise sqlstate 'PT409' using message='Action identifier already used';
  end if;
  if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh'; end if;
  select * into c from public.daily_deck_cards where id=p_card_id and save_id=s.id and source_kind='social' and pile<>'consumed' for update;
  if not found then raise sqlstate 'PT409' using message='Select an active social card'; end if;
  if exists(select 1 from public.daily_deck_changes where save_id=s.id and card_id=c.id and change_kind='remove_social') then
    raise sqlstate 'PT409' using message='This copy is already scheduled to leave';
  end if;
  update public.daily_deck_provisions set quantity=quantity-1,updated_at=now()
  where save_id=s.id and provision_key='potion_of_forgetfulness' and quantity>0;
  if not found then raise sqlstate 'PT409' using message='Potion of Forgetfulness is unavailable'; end if;
  insert into public.daily_deck_changes(save_id,effective_day,change_kind,card_id,source_action_id)
  values(s.id,s.current_day+1,'remove_social',c.id,p_action_id);
  update public.tavern_saves set revision=revision+1,updated_at=now() where id=s.id;
  result:=jsonb_build_object('actionId',p_action_id,'cardId',p_card_id,'inputRevision',p_expected_revision,
    'effectiveDay',s.current_day+1,'committedRevision',s.revision+1,'dailyDeck',private.daily_deck_payload(s.id));
  insert into public.daily_deck_purchase_actions(save_id,action_id,result) values(s.id,p_action_id,result);
  return result;
end $$;
revoke all on function public.daily_deck_use_forgetfulness(bigint,uuid,uuid) from public, anon; grant execute on function public.daily_deck_use_forgetfulness(bigint,uuid,uuid) to authenticated;
create function public.daily_deck_purchase_provision(p_expected_revision bigint,p_action_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare s public.tavern_saves%rowtype; prior jsonb; result jsonb; v_price integer:=12; begin select * into s from public.tavern_saves where user_id=auth.uid() order by updated_at desc limit 1 for update; if not found then raise sqlstate 'PT404'; end if; select receipt.result into prior from public.daily_deck_purchase_actions receipt where receipt.save_id=s.id and receipt.action_id=p_action_id; if found then if prior->>'provisionKey'='potion_of_forgetfulness' and (prior->>'inputRevision')::bigint=p_expected_revision then return prior; end if; raise sqlstate 'PT409' using message='Action identifier already used'; end if; if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='Tavern state changed; refresh'; end if; if s.gold<v_price then raise sqlstate 'PT409' using message='Not enough gold'; end if; insert into public.daily_deck_provisions(save_id,provision_key,quantity) values(s.id,'potion_of_forgetfulness',1) on conflict(save_id,provision_key) do update set quantity=public.daily_deck_provisions.quantity+1,updated_at=now(); update public.tavern_saves set gold=gold-v_price,revision=revision+1,updated_at=now() where id=s.id; result:=jsonb_build_object('actionId',p_action_id,'inputRevision',p_expected_revision,'provisionKey','potion_of_forgetfulness','quantity',(select quantity from public.daily_deck_provisions where save_id=s.id and provision_key='potion_of_forgetfulness'),'price',v_price,'committedRevision',s.revision+1,'gold',s.gold-v_price); insert into public.daily_deck_purchase_actions(save_id,action_id,result) values(s.id,p_action_id,result); return result; end $$;
revoke all on function public.daily_deck_purchase_provision(bigint,uuid) from public, anon; grant execute on function public.daily_deck_purchase_provision(bigint,uuid) to authenticated;

create function private.player_suggestion_context(p_deck_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('generationId',d.id,'cards',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',c.id,'kind',c.source_kind,'cardKey',case when c.source_kind='social' then i.card_key end,'displayName',coalesce(ic.display_name,f.name,be.name),'qualityIndex',coalesce(f.quality_index,be.quality_index))) order by c.created_at,c.id) from public.daily_deck_cards c left join public.intent_cards i on i.id=c.source_id and c.source_kind='social' left join public.intent_card_catalog ic on ic.card_key=i.card_key and ic.version=i.catalog_version left join public.foods f on f.id=c.source_id and c.source_kind='food' left join public.beverages be on be.id=c.source_id and c.source_kind='beverage' where c.deck_id=d.id),'[]'::jsonb),'guests',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(n.normalized_name,'Guest'))) from unnest(d.guest_ids) g(id) left join private.world_npc_instances w on w.id=g.id left join private.npc_identities n on n.id=w.npc_id),'[]'::jsonb)) from public.daily_decks d where d.id=p_deck_id
$$;
revoke all on function private.player_suggestion_context(uuid) from public, anon, authenticated;
create function public.player_suggestion_batch_context(p_generation_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select b.frozen_context from public.player_suggestion_batches b join public.tavern_saves t on t.id=b.save_id where b.id=p_generation_id and t.user_id=auth.uid() $$;
revoke all on function public.player_suggestion_batch_context(uuid) from public, anon; grant execute on function public.player_suggestion_batch_context(uuid) to authenticated;
create function public.player_suggestion_batch_claim(p_generation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare b public.player_suggestion_batches%rowtype; begin select batch_source.* into b from public.player_suggestion_batches batch_source join public.tavern_saves t on t.id=batch_source.save_id where batch_source.id=p_generation_id and t.user_id=auth.uid() for update; if not found then raise sqlstate 'PT404' using message='Suggestion batch not found'; end if; if b.status='pending' then update public.player_suggestion_batches set status='generating',claim_expires_at=now()+interval '12 seconds' where id=b.id; return jsonb_build_object('claimed',true,'status','generating','updatedAt',now(),'batch',b.frozen_context); end if; return jsonb_build_object('claimed',false,'status',b.status,'updatedAt',coalesce(b.completed_at,b.created_at),'batch',case when b.status in ('ready','fallback') then public.player_suggestion_batch_get(b.id) else b.frozen_context end); end $$;
revoke all on function public.player_suggestion_batch_claim(uuid) from public, anon; grant execute on function public.player_suggestion_batch_claim(uuid) to authenticated;
create function public.player_suggestion_batch_upsert(p_generation_id uuid,p_status text,p_suggestions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare b public.player_suggestion_batches%rowtype; begin select batch_source.* into b from public.player_suggestion_batches batch_source join public.tavern_saves t on t.id=batch_source.save_id where batch_source.id=p_generation_id and t.user_id=auth.uid() for update; if not found then raise sqlstate 'PT404' using message='Suggestion batch not found'; end if; if b.status in ('ready','fallback') then return public.player_suggestion_batch_get(b.id); end if; if b.status<>'generating' or p_status not in ('ready','fallback') or jsonb_typeof(p_suggestions)<>'array' then raise sqlstate 'PT409' using message='Suggestion batch is not claimed'; end if; if exists(select 1 from jsonb_array_elements(p_suggestions) x where nullif(btrim(x->>'dailyCardId'),'') is null or nullif(btrim(x->>'npcId'),'') is null or nullif(btrim(x->>'text'),'') is null) then raise sqlstate 'PT400' using message='Each suggestion needs a card, guest, and line'; end if; if (select count(*) from jsonb_array_elements(p_suggestions)) <> jsonb_array_length(b.frozen_context->'cards') * jsonb_array_length(b.frozen_context->'guests') then raise sqlstate 'PT400' using message='Suggestions must cover every card and guest'; end if; if exists(select 1 from jsonb_array_elements(p_suggestions) x where not exists(select 1 from jsonb_array_elements(b.frozen_context->'cards') card where card->>'id'=x->>'dailyCardId') or not exists(select 1 from jsonb_array_elements(b.frozen_context->'guests') guest where guest->>'id'=x->>'npcId')) or (select count(distinct (x->>'dailyCardId',x->>'npcId')) from jsonb_array_elements(p_suggestions) x)<>jsonb_array_length(p_suggestions) then raise sqlstate 'PT400' using message='Suggestions must match distinct frozen card and guest pairs'; end if; insert into public.player_suggestions(generation_id,daily_card_id,npc_instance_id,text,source) select b.id,(x->>'dailyCardId')::uuid,(x->>'npcId')::uuid,x->>'text',case when p_status='fallback' then 'fallback' else coalesce(x->>'source','generated') end from jsonb_array_elements(p_suggestions) x; update public.player_suggestion_batches set status=p_status,completed_at=now() where id=b.id; return public.player_suggestion_batch_get(b.id); end $$;
revoke all on function public.player_suggestion_batch_upsert(uuid,text,jsonb) from public, anon; grant execute on function public.player_suggestion_batch_upsert(uuid,text,jsonb) to authenticated;
create function public.player_suggestion_batch_finalize_fallback(p_generation_id uuid,p_suggestions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare b public.player_suggestion_batches%rowtype; begin select batch_source.* into b from public.player_suggestion_batches batch_source join public.tavern_saves t on t.id=batch_source.save_id where batch_source.id=p_generation_id and t.user_id=auth.uid() for update; if not found then raise sqlstate 'PT404' using message='Suggestion batch not found'; end if; if b.status in ('ready','fallback') then return public.player_suggestion_batch_get(b.id); end if; if b.status='generating' and b.claim_expires_at>now() then return jsonb_build_object('generationId',b.id,'status','generating','suggestions','[]'::jsonb); end if; update public.player_suggestion_batches set status='generating',claim_expires_at=now()+interval '1 second' where id=b.id; return public.player_suggestion_batch_upsert(b.id,'fallback',p_suggestions); end $$;
revoke all on function public.player_suggestion_batch_finalize_fallback(uuid,jsonb) from public, anon; grant execute on function public.player_suggestion_batch_finalize_fallback(uuid,jsonb) to authenticated;
create function public.player_suggestion_batch_get(p_generation_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select jsonb_build_object('generationId',b.id,'status',b.status,'suggestions',coalesce((select jsonb_agg(jsonb_build_object('dailyCardId',s.daily_card_id,'npcId',s.npc_instance_id,'text',s.text,'source',s.source)) from public.player_suggestions s where s.generation_id=b.id),'[]'::jsonb)) from public.player_suggestion_batches b join public.tavern_saves t on t.id=b.save_id where b.id=p_generation_id and t.user_id=auth.uid() $$;
revoke all on function public.player_suggestion_batch_get(uuid) from public, anon; grant execute on function public.player_suggestion_batch_get(uuid) to authenticated;

do $outer$
declare v_name text;
begin
  foreach v_name in array array['get_tavern_snapshot','npc_bar_summary','npc_bar_snapshot'] loop
    execute format('alter function public.%I() rename to %I',v_name,v_name||'_before_issue39');
    execute format('alter function public.%I() set schema private',v_name||'_before_issue39');
    execute format('revoke all on function private.%I() from public,anon,authenticated',v_name||'_before_issue39');
    execute format($ddl$create function public.%I() returns jsonb language plpgsql security definer set search_path='' as $body$
      declare snapshot jsonb; v_save uuid;
      begin
        snapshot:=private.%I();
        if snapshot is null then return null; end if;
        v_save:=(snapshot->'save'->>'id')::uuid;
        perform private.daily_deck_prepare(v_save);
        return snapshot||jsonb_build_object('dailyDeck',private.daily_deck_payload(v_save));
      end $body$$ddl$,v_name,v_name||'_before_issue39');
    execute format('revoke all on function public.%I() from public,anon',v_name);
    execute format('grant execute on function public.%I() to authenticated,service_role',v_name);
  end loop;
end $outer$;

commit;
