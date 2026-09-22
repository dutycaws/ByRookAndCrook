-- Issue #31 Packets 4-5: make the canonical quest lifecycle the only
-- dialogue, journal, and generated-shop authority.
begin;

create function private.world_quest_lifecycle_status(p_save_id uuid,p_instance_id uuid)
returns text language sql stable security definer set search_path='' as $function$
  select case
    when exists(select 1 from private.world_npc_departures d where d.save_id=p_save_id and d.instance_id=p_instance_id and d.state='departed')
      or exists(select 1 from private.world_npc_instances i where i.id=p_instance_id and i.save_id=p_save_id and i.status='departed') then 'departed'
    when exists(select 1 from private.world_npc_departures d where d.save_id=p_save_id and d.instance_id=p_instance_id and d.state='farewell') then 'departing'
    when exists(select 1 from private.world_quests q where q.save_id=p_save_id and q.instance_id=p_instance_id and q.state in ('active','scheduled')) then 'active'
    when exists(select 1 from private.world_quest_transitions t where t.save_id=p_save_id and t.instance_id=p_instance_id and t.status in ('awaiting','processing','failed')) then 'awaiting_transition'
    else 'awaiting_transition'
  end
$function$;

create function private.world_quest_public_view(p_quest private.world_quests,p_current_day integer)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare step jsonb; skill integer:=0; hospitality integer:=0; readiness integer:=0; chance integer:=50;
begin
  if p_quest.id is null then return null; end if;
  step:=p_quest.current_plan->p_quest.current_step;
  select coalesce((version.sheet->'skills'->>(step->>'approach'))::integer,0) into skill
  from private.npc_versions version where version.id=p_quest.version_id;
  hospitality:=private.world_quest_hospitality(p_quest.id,p_current_day);
  readiness:=private.world_quest_readiness(p_quest.preparation,hospitality);
  chance:=private.world_quest_chance(skill,p_quest.difficulty,readiness);
  return jsonb_build_object(
    'id',p_quest.id,'origin',p_quest.origin,'title',p_quest.title,'objective',p_quest.objective,
    'plan',p_quest.current_plan,'currentStep',p_quest.current_step,'activationDay',coalesce(p_quest.activated_day,p_quest.scheduled_for_day),
    'readiness',case when readiness>=10 then 'rising' when readiness<0 then 'strained' else 'steady' end,
    'risk',case when chance>=65 then 'low' when chance>=35 then 'moderate' else 'high' end,
    'hospitalityHint','Food and drinks served during this quest contribute to readiness.'
  );
end
$function$;

create or replace function public.npc_dialogue_context(p_actor uuid,p_turn_id uuid,p_category text default 'base',p_query text default '')
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_npc_dialogue_turns; w private.world_npc_instances; quest_row private.world_quests; sheet jsonb; visible_facts jsonb; lifecycle text; intention jsonb; current_view jsonb; cognition jsonb;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  if p_category not in ('base','beliefs','relationships','history','quests','news','memories') or char_length(coalesce(p_query,''))>160 then raise sqlstate 'PT400'; end if;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  select * into w from private.world_npc_instances where id=t.instance_id;
  select version.sheet into sheet from private.npc_versions version where version.id=t.version_id;
  select * into quest_row from private.world_quests quest where quest.save_id=t.save_id and quest.instance_id=t.instance_id and quest.state in ('active','scheduled') order by case quest.state when 'active' then 0 else 1 end,quest.scheduled_for_day,quest.created_at limit 1;
  lifecycle:=private.world_quest_lifecycle_status(t.save_id,t.instance_id);
  cognition:=private.world_resident_dialogue_cognition(w.id);
  current_view:=case when quest_row.id is null then null else private.world_quest_public_view(quest_row,t.day_number) end;
  if quest_row.id is not null and quest_row.state='active' and lifecycle='active' then
    select jsonb_build_object(
      'goal',quest_row.objective,'motivation',quest_row.motivation,'targets',to_jsonb(quest_row.target_refs),
      'steps',coalesce(jsonb_agg(element.value order by element.ordinality) filter(where element.ordinality>quest_row.current_step),'[]'::jsonb)
    ) into intention from jsonb_array_elements(quest_row.current_plan) with ordinality element(value,ordinality);
  end if;
  select coalesce(jsonb_agg(fact),'[]'::jsonb) into visible_facts from jsonb_array_elements(sheet#>'{lore,facts}') fact where coalesce((fact->>'trustThreshold')::integer,0)<=w.relationship;

  if p_category='base' then return jsonb_strip_nulls(jsonb_build_object(
    'npcId',t.npc_id,'versionId',t.version_id,'instanceId',t.instance_id,'name',sheet#>>'{identity,name}',
    'identity',sheet->'identity','personality',sheet->'personality','relationship',w.relationship,'message',t.message,'day',t.day_number,
    'questLifecycleStatus',lifecycle,'questStatus',case when lifecycle='active' and quest_row.state='active' then 'active' else lifecycle end,
    'currentQuest',current_view,'activeQuestId',case when quest_row.state='active' then quest_row.id else null end,
    'activeQuestPlanRevision',case when quest_row.state='active' then quest_row.plan_revision else null end,
    'activeQuestStep',case when quest_row.state='active' then quest_row.current_step else null end,
    'intention',intention,'allowedTargets',coalesce(to_jsonb(quest_row.target_refs),'[]'::jsonb),
    'playerIntent',case when t.intent_card_id is null then null else (select jsonb_build_object('key',card.card_key,'instruction',catalog.prompt_instruction,'tier',card.tier) from public.intent_cards card join public.intent_card_catalog catalog on catalog.card_key=card.card_key and catalog.version=card.catalog_version where card.id=t.intent_card_id) end,
    'recent',(select coalesce(jsonb_agg(item order by sequence),'[]'::jsonb) from (select input_sequence sequence,jsonb_build_object('id',id,'keeper',message,'npc',result->>'reply') item from private.world_npc_dialogue_turns where instance_id=t.instance_id and status='completed' order by input_sequence desc limit 6) recent),
    'hospitality',case when t.offering_kind='beverage' then (select jsonb_build_object('kind','beverage','itemId',beverage.id,'itemName',beverage.name,'quality',beverage.quality_index,'relationshipChange',case when beverage.quality_index>=4 then 2 when beverage.quality_index>=2 then 1 when beverage.quality_index=1 then -1 else -2 end) from public.beverages beverage where beverage.id=t.offering_item_id and beverage.save_id=t.save_id) when t.offering_kind='food' then (select jsonb_build_object('kind','food','itemId',food.id,'itemName',food.name,'quality',food.quality_index,'relationshipChange',case when food.quality_index>=4 then 2 when food.quality_index>=2 then 1 when food.quality_index=1 then -1 else -2 end) from public.foods food where food.id=t.offering_item_id and food.save_id=t.save_id) end,
    'profileRevision',cognition->'profileRevision','evolvingProfile',cognition->'profile'
  ));
  elsif p_category='beliefs' then return cognition->'beliefs';
  elsif p_category='relationships' then return jsonb_build_object('facts',visible_facts,'relationships',sheet#>'{lore,relationships}','currentSocial',cognition->'social');
  elsif p_category='history' then return coalesce((select jsonb_agg(jsonb_build_object('turnId',id,'day',day_number,'keeper',left(message,500),'npc',left(result->>'reply',500)) order by input_sequence desc) from (select * from private.world_npc_dialogue_turns where instance_id=t.instance_id and status='completed' order by input_sequence desc limit 12) history),'[]'::jsonb);
  elsif p_category='quests' then return jsonb_build_object(
    'questLifecycleStatus',lifecycle,'currentQuest',current_view,
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',quest.id,'origin',quest.origin,'title',quest.title,'objective',quest.objective,'state',quest.state,'activatedDay',quest.activated_day,'terminalDay',quest.terminal_day) order by quest.created_at desc) from private.world_quests quest where quest.instance_id=t.instance_id and quest.state in ('succeeded','failed','abandoned')),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',event.id,'questId',event.quest_id,'day',event.day_number,'outcome',event.outcome,'text',event.narration,'publicNews',event.public_news) order by event.day_number desc,event.created_at desc) from private.world_quest_events event where event.instance_id=t.instance_id),'[]'::jsonb)
  );
  elsif p_category='news' then return coalesce((select jsonb_agg(jsonb_build_object('id',event.id,'questId',event.quest_id,'day',event.day_number,'outcome',event.outcome,'text',event.narration) order by event.day_number desc,event.created_at desc) from private.world_quest_events event where event.instance_id=t.instance_id and event.public_news),'[]'::jsonb);
  elsif p_category='memories' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'turnId',turn_id,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'importance',importance,'entities',entity_refs) order by score desc,importance desc,created_at desc) from (select memory.*,case when btrim(p_query)='' then 0 else ts_rank(memory.search,websearch_to_tsquery('english',left(p_query,200))) end score from private.world_npc_memories memory where memory.instance_id=t.instance_id order by score desc,memory.importance desc,memory.created_at desc limit 8) ranked),'[]'::jsonb);
  end if;
  raise sqlstate 'PT400' using message='Unknown context category';
end
$function$;

create or replace function public.npc_dialogue_complete(p_actor uuid,p_turn_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_npc_dialogue_turns; save_row public.tavern_saves; resident private.world_npc_instances; quest_row private.world_quests; decision jsonb; base jsonb; reply text; memory jsonb;
  relationship_delta integer:=0; relationship_budget integer; proposed_intention jsonb; serving jsonb; final_relationship integer; v_result jsonb;
  prior_plan jsonb; replacement_suffix jsonb; completed_prefix jsonb:='[]'::jsonb; replacement_plan jsonb; plan_changed boolean:=false;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  select * into save_row from public.tavern_saves where user_id=p_actor for update;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor for update;
  if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
  if t.status='completed' then return t.result; end if;
  if t.fence<>p_fence or t.status<>'processing' or t.lease_until<now() then raise sqlstate 'PT409' using message='Dialogue attempt expired'; end if;
  select * into resident from private.world_npc_instances where id=t.instance_id and save_id=save_row.id for update;
  if not found or save_row.revision<>t.source_revision or save_row.current_day<>t.day_number or resident.conversation_sequence<>t.input_sequence or resident.status in ('dead','departed','dismissed','removed','quarantined') then
    update private.world_npc_dialogue_turns set status='stale',error_code='STATE_CHANGED' where id=t.id;
    update private.world_npc_dialogue_attempts set status='stale',finished_at=now() where fence=p_fence;
    return jsonb_build_object('status','stale');
  end if;
  select * into quest_row from private.world_quests quest where quest.save_id=save_row.id and quest.instance_id=resident.id and quest.state='active' for update;
  decision:=t.checkpoints#>'{decision,value}'; base:=t.checkpoints#>'{base,value}'; reply:=t.checkpoints#>>'{speak,value,text}';
  if reply is null or char_length(btrim(reply)) not between 1 and 2000 or not coalesce(decision->>'stance' in ('agree','refuse','clarify','respond') and decision->>'subject' in ('quest','personal','hospitality') and decision->>'reaction' in ('-1','0','1'),false) then raise sqlstate 'PT400' using message='Validated decision and reply are required'; end if;
  if (decision->>'reaction')::integer<>0 and (coalesce(char_length(decision->>'evidence'),0)<3 or position(decision->>'evidence' in t.message)=0) then raise sqlstate 'PT400' using message='Reaction needs source evidence'; end if;
  proposed_intention:=nullif(decision->'intention','null'::jsonb);
  if proposed_intention is not null then
    if decision->>'stance'<>'agree' or quest_row.id is null or private.world_quest_lifecycle_status(save_row.id,resident.id)<>'active'
      or (base->>'activeQuestId') is distinct from quest_row.id::text
      or (base->>'activeQuestPlanRevision')::integer is distinct from quest_row.plan_revision
      or (base->>'activeQuestStep')::integer is distinct from quest_row.current_step
      or proposed_intention->>'goal'<>quest_row.objective or proposed_intention->>'motivation'<>quest_row.motivation
      or proposed_intention->'targets'<>to_jsonb(quest_row.target_refs) or not private.world_quest_plan_is_valid(proposed_intention->'steps') then
      raise sqlstate 'PT409' using message='Dialogue may only replace the active quest remaining plan';
    end if;
    prior_plan:=quest_row.current_plan; replacement_suffix:=proposed_intention->'steps';
    select coalesce(jsonb_agg(element.value order by element.ordinality),'[]'::jsonb) into completed_prefix
    from jsonb_array_elements(prior_plan) with ordinality element(value,ordinality) where element.ordinality<=quest_row.current_step;
    replacement_plan:=completed_prefix||replacement_suffix;
    if not private.world_quest_plan_is_valid(replacement_plan) then raise sqlstate 'PT400' using message='Replacement quest plan is invalid'; end if;
    insert into private.world_quest_plan_revisions(quest_id,expected_prior_revision,expected_current_step,dialogue_turn_id,prior_plan,replacement_plan,suffix_plan,reason)
    values(quest_row.id,quest_row.plan_revision,quest_row.current_step,t.id,prior_plan,replacement_plan,replacement_suffix,'The resident clearly agreed to replace the remaining plan during dialogue.');
    update private.world_quests set current_plan=replacement_plan,plan_revision=plan_revision+1,preparation=0 where id=quest_row.id;
    plan_changed:=true;
  end if;
  if t.offering_kind is not null then serving:=private.world_npc_apply_hospitality(p_actor,save_row.id,resident.id,t.offering_kind,t.offering_item_id,t.id,save_row.revision); select * into save_row from public.tavern_saves where id=save_row.id for update; end if;
  if (decision->>'reaction')::integer<>0 and not exists(select 1 from private.world_npc_reactions where instance_id=resident.id and day_number=t.day_number and subject=decision->>'subject') then
    select coalesce(sum(abs(delta)),0) into relationship_budget from private.world_npc_reactions where instance_id=resident.id and day_number=t.day_number and sign(delta)=sign((decision->>'reaction')::integer);
    if relationship_budget<4 then relationship_delta:=2*(decision->>'reaction')::integer; insert into private.world_npc_reactions(instance_id,day_number,subject,delta,turn_id) values(resident.id,t.day_number,decision->>'subject',relationship_delta,t.id); update private.world_npc_instances set relationship=greatest(0,least(100,relationship+relationship_delta)) where id=resident.id; end if;
  end if;
  if t.intent_card_id is not null then insert into private.world_npc_intent_card_plays(save_id,card_id,turn_id,card_key,tier,day_number) select save_row.id,card.id,t.id,card.card_key,card.tier,save_row.current_day from public.intent_cards card where card.id=t.intent_card_id and card.save_id=save_row.id; if not found then raise sqlstate 'PT409' using message='Intent card is unavailable'; end if; end if;
  update private.world_npc_instances set conversation_sequence=conversation_sequence+1 where id=resident.id returning relationship into final_relationship;
  for memory in select value from jsonb_array_elements(coalesce(t.checkpoints#>'{remember,value,memories}','[]'::jsonb)) limit 3 loop
    if memory->>'kind' in ('keeper_claim','npc_statement','promise','interaction') and char_length(coalesce(memory->>'text','')) between 1 and 500 and char_length(coalesce(memory->>'quote','')) between 3 and 500 and (memory->>'speaker'='keeper' and position(memory->>'quote' in t.message)>0 or memory->>'speaker'='npc' and position(memory->>'quote' in reply)>0) then insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs) values(t.id,resident.id,memory->>'kind',memory->>'text',memory->>'quote',memory->>'speaker',case when memory->>'kind'='promise' then 3 when memory->>'kind'='keeper_claim' then 1 else 2 end,'{}') on conflict do nothing; end if;
  end loop;
  if serving is null and (relationship_delta<>0 or plan_changed or t.intent_card_id is not null) then update public.tavern_saves set revision=revision+1,updated_at=now() where id=save_row.id; end if;
  v_result:=jsonb_build_object('turnId',t.id,'npcId',t.npc_id,'instanceId',t.instance_id,'reply',reply,'sequence',t.input_sequence+1,'relationship',final_relationship,'relationshipChange',relationship_delta,'intention',proposed_intention,'serving',serving,'committedRevision',(select revision from public.tavern_saves where id=save_row.id));
  update private.world_npc_dialogue_turns set status='completed',result=v_result,completed_at=now() where id=t.id;
  update private.world_npc_dialogue_attempts set status='completed',finished_at=now() where fence=p_fence;
  return v_result;
end
$function$;

create or replace function public.npc_journals(p_instance_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $function$
  select coalesce(jsonb_object_agg(resident.id::text,jsonb_strip_nulls(jsonb_build_object(
    'instanceId',resident.id,'npcId',resident.npc_id,'versionId',resident.version_id,'status',resident.status,
    'sequence',resident.conversation_sequence,'relationship',resident.relationship,
    'questLifecycleStatus',private.world_quest_lifecycle_status(resident.save_id,resident.id),
    'currentQuest',case when current_quest.id is null then null else private.world_quest_public_view(current_quest,save_row.current_day) end,
    -- This is the sole player history vocabulary. Do not add replay inputs,
    -- readiness, private transition context, or settlement diagnostics here.
    'questHistory',coalesce(history.items,'[]'::jsonb),'turns',coalesce(turns.items,'[]'::jsonb),
    'pending',pending.item,'farewellText',departure.farewell_text,
    'disposition',coalesce(evolution.latest_disposition,profile.public_disposition),'evolution',coalesce(evolution.items,'[]'::jsonb)
  ))),'{}'::jsonb)
  from private.world_npc_instances resident
  join public.tavern_saves save_row on save_row.id=resident.save_id
  left join private.world_resident_profiles profile on profile.instance_id=resident.id
  left join private.world_npc_departures departure on departure.instance_id=resident.id
  left join lateral (select quest.* from private.world_quests quest where quest.save_id=resident.save_id and quest.instance_id=resident.id and quest.state in ('active','scheduled') order by case quest.state when 'active' then 0 else 1 end,quest.scheduled_for_day,quest.created_at limit 1) current_quest on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id',event.id,'day',event.day_number,'outcome',event.outcome,
      'text',event.narration,'publicNews',event.public_news
    ) order by event.day_number desc,event.created_at desc) items
    from (
      select * from private.world_quest_events
      where instance_id=resident.id
      order by day_number desc,created_at desc
      limit 40
    ) event
  ) history on true
  left join lateral (select jsonb_agg(item order by sequence) items from (select input_sequence sequence,jsonb_build_object('turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,'npc',result->>'reply','relationship',result->'relationship') item from private.world_npc_dialogue_turns where instance_id=resident.id and status='completed' order by input_sequence desc limit 40) recent) turns on true
  left join lateral (select jsonb_build_object('turnId',id,'status',case when status='processing' and lease_until<now() then 'failed' else status end,'message',message,'error',error_code) item from private.world_npc_dialogue_turns where instance_id=resident.id and status in ('processing','failed') order by created_at desc limit 1) pending on true
  left join lateral (select jsonb_agg(jsonb_build_object('day',day_number,'profileRevision',profile_revision,'disposition',disposition,'createdAt',created_at) order by created_at desc) items,(array_agg(disposition order by created_at desc))[1] latest_disposition from (select * from private.resident_evolution_entries where instance_id=resident.id order by created_at desc limit 6) entry) evolution on true
  where save_row.user_id=auth.uid() and resident.id=any(p_instance_ids)
$function$;

-- Generated canonical goods remain purchasable inventory. They no longer
-- attach to, advance, or project any quest.
drop function if exists public.use_generated_supply(uuid,uuid,bigint,text,uuid);
drop table if exists private.world_generated_supply_uses;
alter table private.world_generated_supply_actions drop constraint if exists world_generated_supply_actions_action_kind_check;
alter table private.world_generated_supply_actions add constraint world_generated_supply_actions_action_kind_check check(action_kind='purchase');
create or replace function public.world_generated_shop_projection(p_save_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
begin
  if not exists(select 1 from public.tavern_saves where id=p_save_id and user_id=auth.uid()) then raise sqlstate 'PT404' using message='Generated shop content not found'; end if;
  return jsonb_build_object('version','generated-shop-v1',
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('entityId',definition.canonical_entity_id,'itemKey',entity.entity_key,'name',definition.display_name,'price',definition.price,'dailyStock',definition.daily_stock,'remainingStock',stock.remaining_quantity) order by definition.display_name,definition.canonical_entity_id) from private.world_generated_supply_definitions definition join private.world_generated_supply_stock stock on stock.canonical_entity_id=definition.canonical_entity_id join private.world_canonical_entities entity on entity.id=definition.canonical_entity_id where definition.save_id=p_save_id and entity.lifecycle='active'),'[]'::jsonb),
    'inventory',coalesce((select jsonb_agg(jsonb_build_object('entityId',inventory.canonical_entity_id,'itemKey',entity.entity_key,'name',definition.display_name,'quantity',inventory.quantity) order by definition.display_name,inventory.canonical_entity_id) from private.world_generated_supply_inventory inventory join private.world_generated_supply_definitions definition on definition.canonical_entity_id=inventory.canonical_entity_id join private.world_canonical_entities entity on entity.id=inventory.canonical_entity_id where inventory.save_id=p_save_id and inventory.quantity>0 and entity.lifecycle='active'),'[]'::jsonb));
end
$function$;

drop function if exists public.npc_world_accept_plan(uuid,uuid,jsonb);
update private.world_npc_instances set campaign_state='{}'::jsonb where campaign_state<>'{}'::jsonb;
alter table private.world_npc_instances alter column campaign_state set default '{}'::jsonb;
alter table private.world_npc_instances add constraint world_npc_instances_no_legacy_quest_state check(campaign_state='{}'::jsonb);

revoke all on function private.world_quest_lifecycle_status(uuid,uuid),private.world_quest_public_view(private.world_quests,integer) from public,anon,authenticated;
revoke all on function public.npc_dialogue_context(uuid,uuid,text,text),public.npc_dialogue_complete(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.npc_dialogue_context(uuid,uuid,text,text),public.npc_dialogue_complete(uuid,uuid,uuid) to service_role;
revoke all on function public.npc_journals(uuid[]),public.world_generated_shop_projection(uuid) from public,anon;
grant execute on function public.npc_journals(uuid[]),public.world_generated_shop_projection(uuid) to authenticated;

commit;
