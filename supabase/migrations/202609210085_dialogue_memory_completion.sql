begin;

-- Dialogue memories are authoritative completion records, not best-effort
-- provider artifacts.  Keep both participants alongside the immutable source.
alter table private.world_npc_memories
  add column if not exists participant_actor_id uuid references auth.users(id),
  add column if not exists observer_instance_id uuid references private.world_npc_instances(id),
  add column if not exists learned_day integer check(learned_day > 0),
  add column if not exists learned_sequence bigint check(learned_sequence >= 0);
update private.world_npc_memories memory set learned_day=turn.day_number,learned_sequence=turn.input_sequence
from private.world_npc_dialogue_turns turn where turn.id=memory.turn_id and (memory.learned_day is null or memory.learned_sequence is null);

create or replace function private.world_npc_complete_remember(
  p_turn private.world_npc_dialogue_turns, p_save_id uuid, p_instance private.world_npc_instances,
  p_reply text, p_memories jsonb, p_related_quest_id uuid default null, p_entity_refs text[] default '{}'
) returns void language plpgsql security definer set search_path='' as $function$
declare memory jsonb; prior private.world_npc_memories; root uuid; next_version integer; status text; source_hash text;
begin
  source_hash:=encode(extensions.digest(convert_to(p_turn.message || E'\n' || p_reply,'utf8'),'sha256'),'hex');
  for memory in select value from jsonb_array_elements(coalesce(p_memories->'memories','[]'::jsonb)) limit 3 loop
    if memory->>'kind' not in ('keeper_claim','npc_statement','promise','interaction')
      or char_length(coalesce(memory->>'text','')) not between 1 and 500
      or char_length(coalesce(memory->>'quote','')) not between 3 and 500
      or memory->>'speaker' not in ('keeper','npc') then raise sqlstate 'PT400' using message='Remember output is invalid'; end if;
    if (memory->>'speaker'='keeper' and position(memory->>'quote' in p_turn.message)=0)
      or (memory->>'speaker'='npc' and position(memory->>'quote' in p_reply)=0) then
      raise sqlstate 'PT400' using message='Remember quote is not an exact current source quote';
    end if;
    status:=nullif(memory->>'commitmentStatus','');
    if memory->>'kind'='promise' and memory->>'speaker'<>'npc' then raise sqlstate 'PT400' using message='Only the NPC may create a dialogue promise'; end if;
    if memory->>'speaker'='keeper' and status is not null then raise sqlstate 'PT400' using message='Keeper assertions cannot change commitment status'; end if;
    if memory->>'kind'<>'promise' and status is not null then raise sqlstate 'PT400' using message='Only NPC promises may change commitment status'; end if;
    if status='fulfilled' then raise sqlstate 'PT400' using message='Dialogue cannot mark a commitment fulfilled'; end if;
    if nullif(memory->>'priorCommitmentId','') is not null then
      if memory->>'priorCommitmentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise sqlstate 'PT400' using message='Commitment ID is invalid'; end if;
      select memory_row.* into prior from private.world_npc_memories memory_row where memory_row.id=(memory->>'priorCommitmentId')::uuid and memory_row.save_id=p_save_id and memory_row.instance_id=p_instance.id
        and memory_row.speaker='npc' and memory_row.kind='promise' and memory_row.commitment_status='unresolved'
        and not exists(select 1 from private.world_npc_memories newer where newer.record_root_id=memory_row.record_root_id and newer.record_version>memory_row.record_version);
      if not found or status not in ('withdrawn','disputed','superseded') then raise sqlstate 'PT400' using message='Commitment correction is not eligible'; end if;
      root:=prior.record_root_id; next_version:=prior.record_version+1;
      insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,correction_memory_id,participant_actor_id,observer_instance_id,related_quest_id)
      values(p_turn.id,p_instance.id,'promise',memory->>'text',memory->>'quote','npc',3,p_entity_refs,p_save_id,root,next_version,'dialogue_turn',p_turn.id,1,source_hash,p_turn.day_number,p_turn.input_sequence,p_turn.day_number,p_turn.input_sequence,'attributed','npc_known',status,prior.id,p_turn.actor_id,p_instance.id,p_related_quest_id);
    else
      if status is not null and not (memory->>'kind'='promise' and memory->>'speaker'='npc' and status='unresolved') then raise sqlstate 'PT400' using message='New dialogue commitment must be an unresolved NPC promise'; end if;
      root:=extensions.gen_random_uuid();
      insert into private.world_npc_memories(turn_id,instance_id,kind,text,quote,speaker,importance,entity_refs,save_id,record_root_id,record_version,source_kind,source_id,source_version,source_hash,occurred_day,occurred_sequence,learned_day,learned_sequence,truth_class,disclosure_class,commitment_status,participant_actor_id,observer_instance_id,related_quest_id)
      values(p_turn.id,p_instance.id,memory->>'kind',memory->>'text',memory->>'quote',memory->>'speaker',case when memory->>'kind'='promise' then 3 when memory->>'kind'='keeper_claim' then 1 else 2 end,p_entity_refs,p_save_id,root,1,'dialogue_turn',p_turn.id,1,source_hash,p_turn.day_number,p_turn.input_sequence,p_turn.day_number,p_turn.input_sequence,'attributed','npc_known',case when memory->>'kind'='promise' and memory->>'speaker'='npc' then 'unresolved' else null end,p_turn.actor_id,p_instance.id,p_related_quest_id);
    end if;
  end loop;
end $function$;

-- 074's completion contract is retained verbatim except memory persistence is
-- delegated to the source-backed routine above.  The body below deliberately
-- replaces the public RPC rather than relying on a post-completion trigger.
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
    insert into private.world_quest_plan_revisions(quest_id,expected_prior_revision,expected_current_step,dialogue_turn_id,prior_plan,replacement_plan,suffix_plan,reason) values(quest_row.id,quest_row.plan_revision,quest_row.current_step,t.id,prior_plan,replacement_plan,replacement_suffix,'The resident clearly agreed to replace the remaining plan during dialogue.');
    update private.world_quests set current_plan=replacement_plan,plan_revision=plan_revision+1,preparation=0 where id=quest_row.id; plan_changed:=true;
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

-- Relational obligations consult only the latest correction version.
create index if not exists world_npc_memory_latest_root on private.world_npc_memories(record_root_id,record_version desc);

-- Current obligation selection never treats a superseded root version as live.
create or replace function private.world_npc_memory_retrieve(p_actor uuid,p_instance_id uuid,p_query text,p_limit integer default 12,p_cutoff_sequence bigint default null,p_view text default 'speech')
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,12),32)); v_cutoff bigint; v_disclosures text[];
begin
  if p_view not in ('speech','review','transition') then raise sqlstate 'PT400' using message='Memory view is invalid'; end if;
  if not exists(select 1 from private.world_npc_instances instance_row join public.tavern_saves save_row on save_row.id=instance_row.save_id where instance_row.id=p_instance_id and save_row.user_id=p_actor) then raise sqlstate 'PT404' using message='Resident memory was not found'; end if;
  select coalesce(p_cutoff_sequence,max(input_sequence)) into v_cutoff from private.world_npc_dialogue_turns where instance_id=p_instance_id and status='completed';
  v_disclosures:=case when p_view='speech' then array['player_visible','npc_known'] else array['player_visible','npc_known','npc_private'] end;
  return (with selected as (
    select memory.id,memory.record_root_id,memory.record_version,memory.kind,memory.text,memory.quote,memory.speaker,memory.truth_class,memory.commitment_status,memory.importance,memory.related_quest_id,memory.source_kind,memory.source_id,memory.source_version,memory.occurred_day,memory.occurred_sequence,
      case when memory.commitment_status='unresolved' then 'unresolved_commitment' when memory.related_quest_id is not null then 'quest_link' when btrim(coalesce(p_query,''))<>'' and memory.search @@ websearch_to_tsquery('english',left(p_query,400)) then 'lexical' else 'important_recent' end as selection_reason,
      case when btrim(coalesce(p_query,''))='' then 0 else ts_rank(memory.search,websearch_to_tsquery('english',left(p_query,400))) end rank
    from private.world_npc_memories memory
    where memory.instance_id=p_instance_id and memory.occurred_sequence<=coalesce(v_cutoff,9223372036854775807) and memory.disclosure_class=any(v_disclosures)
      and not exists(select 1 from private.world_npc_memories newer where newer.instance_id=p_instance_id and newer.record_root_id=memory.record_root_id and newer.record_version>memory.record_version and newer.occurred_sequence<=coalesce(v_cutoff,9223372036854775807))
    order by (memory.commitment_status='unresolved') desc,(memory.related_quest_id is not null) desc,(memory.search @@ websearch_to_tsquery('english',left(coalesce(p_query,''),400))) desc,rank desc,memory.importance desc,memory.occurred_sequence desc,memory.id limit v_limit
  ), turns as (
    select turn.id,turn.input_sequence,turn.day_number,turn.message,turn.result->>'reply' reply from private.world_npc_dialogue_turns turn where turn.instance_id=p_instance_id and turn.status='completed' and turn.input_sequence<=coalesce(v_cutoff,9223372036854775807) order by turn.input_sequence desc limit 6
  ), watermark as (
    select jsonb_agg(jsonb_build_object('processor',processor_kind,'version',processor_version,'contiguousSequence',contiguous_sequence,'examinedThroughSequence',examined_through_sequence,'gapSequence',gap_sequence) order by processor_kind,processor_version) item from private.world_npc_memory_watermarks where instance_id=p_instance_id
  ) select jsonb_build_object('cutoffSequence',v_cutoff,'items',coalesce((select jsonb_agg(to_jsonb(selected) order by occurred_sequence desc,id) from selected),'[]'::jsonb),'sourceFallback',coalesce((select jsonb_agg(jsonb_build_object('turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,'npc',reply) order by input_sequence) from turns),'[]'::jsonb),'watermarks',coalesce((select item from watermark),'[]'::jsonb)));
end $function$;

revoke all on function private.world_npc_complete_remember(private.world_npc_dialogue_turns,uuid,private.world_npc_instances,text,jsonb,uuid,text[]) from public,anon,authenticated,service_role;
commit;
