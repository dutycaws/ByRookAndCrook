-- Add the current resident repair obligation and its eligibility rule to frozen dialogue state.
begin;

create or replace function public.npc_dialogue_context(p_actor uuid,p_turn_id uuid,p_category text default 'base',p_query text default '')
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_npc_dialogue_turns; w private.world_npc_instances; quest_row private.world_quests; sheet jsonb; visible_facts jsonb; lifecycle text; intention jsonb; current_view jsonb; cognition jsonb; relationship_projection jsonb; relationship_repair jsonb;
begin
  if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
  if p_category not in ('base','beliefs','relationships','history','quests','news','memories') or char_length(coalesce(p_query,''))>160 then raise sqlstate 'PT400'; end if;
  select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor;
  if not found then raise sqlstate 'PT404'; end if;
  select * into w from private.world_npc_instances where id=t.instance_id;
  select version.sheet into sheet from private.npc_versions version where version.id=t.version_id;
  select * into quest_row from private.world_quests quest where quest.save_id=t.save_id and quest.instance_id=t.instance_id and quest.state in ('active','scheduled') order by case quest.state when 'active' then 0 else 1 end,quest.scheduled_for_day,quest.created_at limit 1;
  lifecycle:=private.world_quest_lifecycle_status(t.save_id,t.instance_id);
  cognition:=private.world_resident_dialogue_cognition(w.id);
  relationship_projection:=private.world_npc_relationship_projection(w.id);
  relationship_repair:=relationship_projection->'relationshipRepair';
  if relationship_repair is not null then
    relationship_repair:=relationship_repair||jsonb_build_object('eligibility',jsonb_build_object(
      'qualifyingInteraction','Positive source-evidenced follow-through tied to the keeper’s exact message.',
      'requiredDistinctDaysAfterOffense',2,
      'nonQualifyingAlone',jsonb_build_array('apology','greeting','generic praise')
    ));
  end if;
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
    'identity',sheet->'identity','personality',sheet->'personality','relationship',w.relationship,
    'relationshipStage',private.world_npc_relationship_stage(w.relationship),'relationshipRepair',relationship_repair,'message',t.message,'day',t.day_number,
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
  elsif p_category='relationships' then return jsonb_build_object('stage',private.world_npc_relationship_stage(w.relationship),'facts',visible_facts,'relationships',sheet#>'{lore,relationships}','currentSocial',cognition->'social','relationshipRepair',relationship_repair);
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

revoke all on function public.npc_dialogue_context(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.npc_dialogue_context(uuid,uuid,text,text) to service_role;

commit;
