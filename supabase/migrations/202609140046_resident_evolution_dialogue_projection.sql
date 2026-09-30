-- Gate G projects save-bound resident cognition and public-safe evolution.
begin;

create table private.resident_evolution_entries (
  job_id uuid primary key references private.world_settlement_jobs(id) on delete cascade,
  instance_id uuid not null references private.world_npc_instances(id) on delete cascade,
  save_id uuid not null references public.tavern_saves(id) on delete cascade,
  day_number integer not null check (day_number >= 0),
  profile_revision bigint not null check (profile_revision > 0),
  disposition jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(disposition)='object' and octet_length(disposition::text)<=1024)
);
create index resident_evolution_entries_recent on private.resident_evolution_entries(instance_id,created_at desc);
revoke all on private.resident_evolution_entries from public,anon,authenticated,service_role;
create function private.resident_evolution_entry_scope_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from private.world_settlement_jobs j join private.world_settlements s on s.id=j.settlement_id join private.world_npc_instances i on i.id=new.instance_id where j.id=new.job_id and j.job_kind='resident' and j.subject_instance_id=new.instance_id and s.save_id=new.save_id and s.day_number=new.day_number and i.save_id=new.save_id) then raise exception using errcode='23514',message='Evolution entry must match its resident settlement subject and day'; end if;
 return new;
end $$;
create trigger resident_evolution_entry_scope_guard before insert or update on private.resident_evolution_entries for each row execute function private.resident_evolution_entry_scope_guard();

create or replace function private.world_resident_dialogue_cognition(p_instance_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'profileRevision',p.profile_revision,'profile',p.current_profile,
  'beliefs',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'subject',b.subject_key,'statement',left(b.statement,500),'confidence',b.confidence,'contradictionStatus',b.contradiction_status,'provenance',b.provenance,'provenanceChain',b.provenance_chain) order by b.created_at desc,b.id) from (select * from private.world_resident_beliefs where instance_id=p.instance_id and active order by created_at desc,id desc limit 8)b),'[]'::jsonb),
  'social',coalesce((select jsonb_agg(jsonb_build_object('toInstanceId',e.to_instance_id,'trust',e.trust,'affection',e.affection,'respect',e.respect,'fear',e.fear,'obligation',e.obligation) order by e.to_instance_id) from private.world_social_edges e where e.save_id=p.save_id and e.from_instance_id=p.instance_id),'[]'::jsonb)
 ) from private.world_resident_profiles p where p.instance_id=p_instance_id
$$;

create or replace function public.npc_dialogue_context(p_actor uuid,p_turn_id uuid,p_category text default 'base',p_query text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.world_npc_dialogue_turns; w private.world_npc_instances; sheet jsonb; facts jsonb; cognition jsonb;
begin
 if auth.role()<>'service_role' then raise sqlstate 'PT403'; end if;
 if p_category not in ('base','beliefs','relationships','history','quests','news','memories') or char_length(coalesce(p_query,''))>160 then raise sqlstate 'PT400'; end if;
 select * into t from private.world_npc_dialogue_turns where id=p_turn_id and actor_id=p_actor;
 if not found then raise sqlstate 'PT404' using message='Turn not found'; end if;
 select * into w from private.world_npc_instances where id=t.instance_id and save_id=t.save_id;
 if not found then raise sqlstate 'PT404'; end if;
 select v.sheet into sheet from private.npc_versions v where v.id=t.version_id;
 select coalesce(jsonb_agg(f),'[]'::jsonb) into facts from jsonb_array_elements(sheet#>'{lore,facts}') f where coalesce((f->>'trustThreshold')::integer,0)<=w.relationship;
 cognition:=private.world_resident_dialogue_cognition(w.id);
 if p_category='base' then return jsonb_build_object(
  'npcId',t.npc_id,'versionId',t.version_id,'instanceId',w.id,'name',sheet#>>'{identity,name}','identity',sheet->'identity','personality',sheet->'personality','relationship',w.relationship,'campaign',w.campaign_state,'message',t.message,'day',t.day_number,'questStatus',case when w.status in ('active','between','failed') then w.status else 'terminal' end,
  'intention',jsonb_build_object('goal',sheet#>>'{campaign,durableGoal}','motivation',sheet#>>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0'),'motivation'],'targets',sheet#>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0'),'allowedTargets'],'steps',w.campaign_state->'activePlan'),
  'allowedTargets',coalesce(sheet#>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0'),'allowedTargets'],'[]'::jsonb),'playerIntent',case when t.intent_card_id is null then null else (select jsonb_build_object('key',c.card_key,'instruction',cc.prompt_instruction,'tier',c.tier) from public.intent_cards c join public.intent_card_catalog cc on cc.card_key=c.card_key and cc.version=c.catalog_version where c.id=t.intent_card_id) end,
  'recent',(select coalesce(jsonb_agg(item order by seq),'[]'::jsonb) from (select input_sequence seq,jsonb_build_object('turnId',id,'keeper',message,'npc',result->>'reply') item from private.world_npc_dialogue_turns where instance_id=t.instance_id and status='completed' order by input_sequence desc limit 6) x),
  'hospitality',case when t.offering_kind='beverage' then (select jsonb_build_object('kind','beverage','itemId',b.id,'itemName',b.name,'quality',b.quality_index,'relationshipChange',case when b.quality_index>=4 then 2 when b.quality_index>=2 then 1 when b.quality_index=1 then -1 else -2 end) from public.beverages b where b.id=t.offering_item_id and b.save_id=t.save_id) when t.offering_kind='food' then (select jsonb_build_object('kind','food','itemId',f.id,'itemName',f.name,'quality',f.quality_index,'relationshipChange',case when f.quality_index>=4 then 2 when f.quality_index>=2 then 1 when f.quality_index=1 then -1 else -2 end) from public.foods f where f.id=t.offering_item_id and f.save_id=t.save_id) end,
  'profileRevision',cognition->'profileRevision','evolvingProfile',cognition->'profile');
 elsif p_category='beliefs' then return cognition->'beliefs';
 elsif p_category='relationships' then return jsonb_build_object('facts',facts,'relationships',sheet#>'{lore,relationships}','currentSocial',cognition->'social');
 elsif p_category='history' then return coalesce((select jsonb_agg(jsonb_build_object('turnId',id,'day',day_number,'keeper',left(message,500),'npc',left(result->>'reply',500)) order by input_sequence desc) from (select * from private.world_npc_dialogue_turns where instance_id=t.instance_id and status='completed' order by input_sequence desc limit 12) x),'[]'::jsonb);
 elsif p_category='quests' then return coalesce((select jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',left(narration,500)) order by day desc,id desc) from (select * from private.world_npc_quest_events where instance_id=t.instance_id order by day desc,id desc limit 12) x),'[]'::jsonb);
 elsif p_category='news' then return coalesce((select jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',left(narration,500)) order by day desc,id desc) from (select * from private.world_npc_quest_events where instance_id=t.instance_id and public_news order by day desc,id desc limit 12) x),'[]'::jsonb);
 else return coalesce((select jsonb_agg(jsonb_build_object('id',id,'turnId',turn_id,'kind',kind,'text',text,'quote',quote,'speaker',speaker,'importance',importance,'entities',entity_refs) order by score desc,importance desc,created_at desc) from (select m.*,case when btrim(p_query)='' then 0 else ts_rank(m.search,websearch_to_tsquery('english',left(p_query,200))) end score from private.world_npc_memories m where m.instance_id=t.instance_id order by score desc,m.importance desc,m.created_at desc limit 8) x),'[]'::jsonb); end if;
end $$;

-- Preserve the fully validating E1 implementation behind a private seam.  This
-- wrapper adds one player-safe projection only after an applied result.
alter function private.world_settlement_commit_mutation_core(uuid,uuid,uuid,jsonb,text,text) rename to world_settlement_commit_mutation_core_v1;
create function private.world_safe_mutation_result(p_result jsonb,p_settlement_id uuid,p_job_id uuid,p_fingerprint text,p_digest text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('settlementId',p_settlement_id,'jobId',p_job_id,'proposalFingerprint',p_fingerprint,'publicDigest',btrim(p_digest),'status',coalesce(p_result->>'status','completed'),'rulesVersion','evolving-world-v1','outcome',coalesce(p_result->>'outcome','no_changes'),'applied',coalesce((p_result->>'applied')::boolean,false))
$$;
create function private.world_settlement_commit_mutation_core(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb,p_proposal_fingerprint text,p_public_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; j private.world_settlement_jobs; s private.world_settlements; p private.world_resident_profiles; d jsonb;
begin
 perform private.world_settlement_assert_service();
 select * into j from private.world_settlement_jobs where id=p_job_id and settlement_id=p_settlement_id;
 if not found then raise sqlstate 'PT409'; end if;
 select * into s from private.world_settlements where id=p_settlement_id;
 r:=private.world_settlement_commit_mutation_core_v1(p_settlement_id,p_job_id,p_fence,p_proposal,p_proposal_fingerprint,p_public_digest);
 if coalesce((r->>'applied')::boolean,false) and not exists(select 1 from private.resident_evolution_entries where job_id=j.id) then
  select * into p from private.world_resident_profiles where instance_id=j.subject_instance_id and save_id=s.save_id for update;
  if not found then raise sqlstate 'PT409'; end if;
  d:=jsonb_build_object('version','resident-disposition-v1','state','changed','profileRevision',p.profile_revision,'summary',left(btrim(p_public_digest),240));
  insert into private.resident_evolution_entries(job_id,instance_id,save_id,day_number,profile_revision,disposition) values(j.id,p.instance_id,s.save_id,s.day_number,p.profile_revision,d);
 end if;
 return private.world_safe_mutation_result(r,p_settlement_id,p_job_id,p_proposal_fingerprint,p_public_digest);
end $$;
create or replace function public.world_settlement_commit_mutation(p_settlement_id uuid,p_job_id uuid,p_fence uuid,p_proposal jsonb,p_proposal_fingerprint text,p_public_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.world_settlement_assert_service(); return private.world_settlement_commit_mutation_core(p_settlement_id,p_job_id,p_fence,p_proposal,p_proposal_fingerprint,p_public_digest); end $$;

create or replace function public.npc_journals(p_instance_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(w.id::text,jsonb_build_object('instanceId',w.id,'npcId',w.npc_id,'versionId',w.version_id,'status',w.status,'sequence',w.conversation_sequence,'relationship',w.relationship,'campaign',w.campaign_state,'currentMilestone',v.sheet#>array['campaign','milestones',coalesce((w.campaign_state->>'milestone')::text,'0')],'risk',case when coalesce((w.campaign_state->>'preparation')::integer,0)>=2 then 'low' when coalesce((w.campaign_state->>'preparation')::integer,0)=1 then 'moderate' else 'high' end,'turns',coalesce(t.turns,'[]'::jsonb),'events',coalesce(e.events,'[]'::jsonb),'pending',q.pending,'disposition',coalesce(x.latest_disposition,p.public_disposition),'evolution',coalesce(x.evolution,'[]'::jsonb))),'{}'::jsonb)
 from private.world_npc_instances w join public.tavern_saves s on s.id=w.save_id join private.npc_versions v on v.id=w.version_id left join private.world_resident_profiles p on p.instance_id=w.id
 left join lateral (select jsonb_agg(item order by sequence) turns from (select input_sequence sequence,jsonb_build_object('turnId',id,'sequence',input_sequence,'day',day_number,'keeper',message,'npc',result->>'reply','relationship',result->'relationship') item from private.world_npc_dialogue_turns where instance_id=w.id and status='completed' order by input_sequence desc limit 40) z)t on true
 left join lateral (select jsonb_agg(jsonb_build_object('day',day,'outcome',outcome,'text',narration,'publicNews',public_news) order by day desc) events from (select * from private.world_npc_quest_events where instance_id=w.id order by day desc,id desc limit 12) z)e on true
 left join lateral (select jsonb_build_object('turnId',id,'status',case when status='processing' and lease_until<now() then 'failed' else status end,'message',message,'error',error_code) pending from private.world_npc_dialogue_turns where instance_id=w.id and status in ('processing','failed') order by created_at desc limit 1)q on true
 left join lateral (select jsonb_agg(jsonb_build_object('day',day_number,'profileRevision',profile_revision,'disposition',disposition,'createdAt',created_at) order by created_at desc) evolution,(array_agg(disposition order by created_at desc))[1] latest_disposition from (select * from private.resident_evolution_entries where instance_id=w.id order by created_at desc limit 6) z)x on true
 where s.user_id=auth.uid() and w.id=any(p_instance_ids)
$$;

create or replace function private.world_block_close_for_active_resident_dialogue() returns trigger language plpgsql set search_path='' as $$ begin if new.current_day<>old.current_day and exists(select 1 from private.world_npc_dialogue_turns t where t.save_id=old.id and t.status='processing' and t.lease_until>clock_timestamp()) then raise sqlstate 'PT409' using message='Finish or cancel the active resident dialogue before closing'; end if; return new; end $$;
drop trigger if exists world_block_close_for_active_resident_dialogue on public.tavern_saves;
create trigger world_block_close_for_active_resident_dialogue before update of current_day on public.tavern_saves for each row execute function private.world_block_close_for_active_resident_dialogue();

revoke all on function private.resident_evolution_entry_scope_guard(),private.world_resident_dialogue_cognition(uuid),private.world_safe_mutation_result(jsonb,uuid,uuid,text,text),private.world_settlement_commit_mutation_core(uuid,uuid,uuid,jsonb,text,text),private.world_settlement_commit_mutation_core_v1(uuid,uuid,uuid,jsonb,text,text),private.world_block_close_for_active_resident_dialogue() from public,anon,authenticated,service_role;
revoke all on function public.npc_dialogue_context(uuid,uuid,text,text),public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.npc_dialogue_context(uuid,uuid,text,text),public.world_settlement_commit_mutation(uuid,uuid,uuid,jsonb,text,text) to service_role;
revoke all on function public.npc_journals(uuid[]) from public,anon;
grant execute on function public.npc_journals(uuid[]) to authenticated;
commit;
