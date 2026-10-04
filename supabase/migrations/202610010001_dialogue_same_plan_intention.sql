-- Accept a dialogue intention that restates the active plan without creating a no-op revision.
begin;

create or replace function public.npc_dialogue_complete(p_actor uuid,p_turn_id uuid,p_fence uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t private.world_npc_dialogue_turns; save_row public.tavern_saves; resident private.world_npc_instances; quest_row private.world_quests; decision jsonb; base jsonb; reply text; v_result jsonb; final_relationship integer;
  proposed_intention jsonb; prior_plan jsonb; replacement_suffix jsonb; completed_prefix jsonb:='[]'::jsonb; replacement_plan jsonb; plan_changed boolean:=false;
  relationship_delta integer:=0; relationship_budget integer; serving jsonb;
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
      or proposed_intention->'targets'<>to_jsonb(quest_row.target_refs) or not private.world_quest_plan_is_valid(proposed_intention->'steps') then raise sqlstate 'PT409' using message='Dialogue may only replace the active quest remaining plan'; end if;
    prior_plan:=quest_row.current_plan; replacement_suffix:=proposed_intention->'steps';
    select coalesce(jsonb_agg(element.value order by element.ordinality),'[]'::jsonb) into completed_prefix from jsonb_array_elements(prior_plan) with ordinality element(value,ordinality) where element.ordinality<=quest_row.current_step;
    replacement_plan:=completed_prefix||replacement_suffix;
    if not private.world_quest_plan_is_valid(replacement_plan) then raise sqlstate 'PT400' using message='Replacement quest plan is invalid'; end if;
    if replacement_plan is distinct from prior_plan then
      insert into private.world_quest_plan_revisions(quest_id,expected_prior_revision,expected_current_step,dialogue_turn_id,prior_plan,replacement_plan,suffix_plan,reason) values(quest_row.id,quest_row.plan_revision,quest_row.current_step,t.id,prior_plan,replacement_plan,replacement_suffix,'The resident clearly agreed to replace the remaining plan during dialogue.');
      update private.world_quests set current_plan=replacement_plan,plan_revision=plan_revision+1,preparation=0 where id=quest_row.id;
      plan_changed:=true;
    end if;
  end if;
  if t.offering_kind is not null then serving:=private.world_npc_apply_hospitality(p_actor,save_row.id,resident.id,t.offering_kind,t.offering_item_id,t.id,save_row.revision); select * into save_row from public.tavern_saves where id=save_row.id for update; end if;
  if (decision->>'reaction')::integer<>0 and not exists(select 1 from private.world_npc_reactions where instance_id=resident.id and day_number=t.day_number and subject=decision->>'subject') then
    select coalesce(sum(abs(delta)),0) into relationship_budget from private.world_npc_reactions where instance_id=resident.id and day_number=t.day_number and sign(delta)=sign((decision->>'reaction')::integer);
    if relationship_budget<4 then relationship_delta:=2*(decision->>'reaction')::integer; insert into private.world_npc_reactions(instance_id,day_number,subject,delta,turn_id) values(resident.id,t.day_number,decision->>'subject',relationship_delta,t.id); update private.world_npc_instances set relationship=greatest(0,least(100,relationship+relationship_delta)) where id=resident.id; end if;
  end if;
  if t.intent_card_id is not null then insert into private.world_npc_intent_card_plays(save_id,card_id,turn_id,card_key,tier,day_number) select save_row.id,card.id,t.id,card.card_key,card.tier,save_row.current_day from public.intent_cards card where card.id=t.intent_card_id and card.save_id=save_row.id; if not found then raise sqlstate 'PT409' using message='Intent card is unavailable'; end if; end if;
  update private.world_npc_instances set conversation_sequence=conversation_sequence+1 where id=resident.id returning relationship into final_relationship;
  perform private.world_npc_complete_remember(t,save_row.id,resident,reply,coalesce(t.checkpoints#>'{remember,value}','{}'::jsonb),case when decision->>'subject'='quest' then quest_row.id else null end,case when decision->>'subject'='quest' and quest_row.id is not null then quest_row.target_refs else '{}'::text[] end);
  if serving is null and (relationship_delta<>0 or plan_changed or t.intent_card_id is not null) then update public.tavern_saves set revision=revision+1,updated_at=now() where id=save_row.id; end if;
  v_result:=jsonb_build_object('turnId',t.id,'npcId',t.npc_id,'instanceId',t.instance_id,'reply',reply,'sequence',t.input_sequence+1,'relationship',final_relationship,'relationshipChange',relationship_delta,'intention',proposed_intention,'serving',serving,'committedRevision',(select revision from public.tavern_saves where id=save_row.id));
  update private.world_npc_dialogue_turns set status='completed',result=v_result,completed_at=now() where id=t.id;
  update private.world_npc_dialogue_attempts set status='completed',finished_at=now() where fence=p_fence;
  return v_result;
end $function$;

commit;
