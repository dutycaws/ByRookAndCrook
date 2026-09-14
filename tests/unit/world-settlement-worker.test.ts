import { describe, expect, it } from 'vitest';
import { type SettlementWorkerClient } from '$lib/server/evolving-world/settlement-worker';
import { drainWorldSettlementQueue, runSettlementClaim, startWorldSettlementWorker } from '$lib/server/evolving-world/settlement-worker';
import { parseSettlementClaim, SettlementProviderError } from '$lib/server/evolving-world/settlement-contracts';
import { canonicalizeProceduralWorldProposal, fingerprintMutationProposal, fingerprintSocialEncounterProposal, parseFrozenProceduralWorldContext } from '$lib/game/evolving-world';
import { createSettlementProvider } from '$lib/server/evolving-world/provider';
import { fixtureProvider } from '../helpers/world-settlement-provider';

const id = (tail: string) => `11111111-1111-4111-8111-${tail.padStart(12, '0')}`;
const proposal = { rulesVersion:'evolving-world-v1', evidenceIds:['evidence-1'], salience:'meaningful', dimensionChanges:[], entryOperations:[], beliefOperations:[], causalExplanation:'An observed event supports no immediate profile change.', questChanges:[], worldEffects:[] };
const digest = { summary:'The tavern rests quietly.', journalEntries:['No new world changes were committed.'], discoveredEntityIds:[] };
function committedReceipt(args: Record<string, unknown>, outcome: 'pressure_only' | 'roll_failed' | 'changed' = 'pressure_only') { return {data:{status:'completed',rulesVersion:'evolving-world-v1',outcome,settlementId:args.p_settlement_id,jobId:args.p_job_id,proposalFingerprint:args.p_proposal_fingerprint,publicDigest:args.p_public_digest},error:null}; }
function claim(checkpoints: unknown[] = [], leaseUntil = new Date(Date.now() + 120_000).toISOString()) { return { settlementId:id('1'), jobId:id('2'), fence:id('3'), kind:'resident', ordinal:3, attempt:1, leaseUntil, inputFingerprint:'a'.repeat(64), inputVersion:'world-v1', inputSnapshot:{dayNumber:1, publicEntityIds:['town-square']}, jobInputVersion:'world-v1', jobInputSnapshot:{ evolution:{ residentId:id('10'),npcId:id('11'),profileRevision:1,schema:{version:'personality-schema-v1',dimensions:[{key:'resolve',label:'Resolve',negativeAnchor:'yielding',positiveAnchor:'unyielding',initialValue:0,volatility:1,core:false}],collections:[]}, profile:{dimensions:{resolve:0},entries:[]}, capability:{version:'v1',allowedActions:[],allowedApproaches:[],allowedWorldEffects:[],allowedTargetKinds:[],socialCapabilities:[],irreversibleEffects:[]}, worldSnapshot:{currentDay:1,entityKinds:{lira:'npc'},activeQuestIds:[],authorizedIrreversibleEffects:[]}, pressureByDimension:{resolve:0}, authorizedEvidence:[{id:'evidence-1',kind:'dialogue',happenedOnDay:1,sequence:2,sourceFingerprint:'a'.repeat(64),salience:'meaningful',summary:'The keeper promised a safe place to rest.'}] } }, checkpoints }; }
function client(overrides: Partial<Record<string, unknown>> = {}) { const calls:Array<{name:string;args:Record<string,unknown>}> = []; const api: SettlementWorkerClient = { async rpc(name,args={}) { calls.push({name,args}); const entry=overrides[name]; if (typeof entry === 'function') return (entry as (args:Record<string,unknown>)=>unknown)(args) as any; if (entry) return {data:entry,error:null}; if(name==='world_settlement_heartbeat')return {data:{leaseUntil:new Date(Date.now()+120_000).toISOString()},error:null}; if(name==='world_discover_procedural_npc_promotions')return {data:{status:'reused',promotedCount:0},error:null}; if(name==='world_retry_procedural_npc_promotion')return {data:{status:'retrying'},error:null}; return {data:{status:'recorded'},error:null}; } }; return { api,calls }; }
const canonEvent={version:'world-canon-event-v1',kind:'world_event',templateKey:'market-day',participantEntityIds:['lira'],title:'Market day arrives',summary:'Merchants have reached the square.',payload:{template:'market-day',participants:['lira'],visibility:'public' as const}};
function canonClaim(checkpoints: unknown[] = []) { const raw=claim(checkpoints) as any; raw.kind='canon'; raw.jobInputSnapshot={worldSnapshot:{activeGeneratedEntityCount:0,existingPublicEventReuseKeys:[],registeredTemplateKeys:['market-day'],entityKinds:{lira:'npc'}},privateSentinel:'sk-secret-canon-input'}; return raw; }
function canonReceipt(args: Record<string,unknown>) { const event=args.p_event as typeof canonEvent; return {data:{status:'completed',rulesVersion:'world-canon-event-v1',settlementId:args.p_settlement_id,jobId:args.p_job_id,proposalFingerprint:'ignored',canonicalEventId:id('88'),kind:'world_event',title:event.title,summary:event.summary},error:null}; }
const socialLira=id('101'); const socialTorvin=id('102'); const socialLiraNpc=id('103'); const socialTorvinNpc=id('104'); const socialBelief=id('105'); const socialFingerprint='b'.repeat(64);
function socialCapability(socialCapabilities: string[]) { return {version:'v1',allowedActions:[],allowedApproaches:[],allowedWorldEffects:[],allowedTargetKinds:[],socialCapabilities,irreversibleEffects:[]}; }
function socialResident(residentId:string,npcId:string,socialCapabilities:string[],beliefs:unknown[]=[]) { return {residentId,npcId,profileRevision:1,profile:{dimensions:{},entries:[]},beliefs,edges:[{subjectNpcId:npcId,objectEntityId:npcId===socialLiraNpc ? socialTorvinNpc : socialLiraNpc,axes:{trust:0,affection:0,respect:0,fear:0,obligation:0}}],capability:socialCapability(socialCapabilities)}; }
function socialContext() { const belief={id:socialBelief,subjectEntityId:socialTorvinNpc,content:'Smoke rose by the northern pass.',confidence:67,provenance:[{sourceKind:'direct_evidence',sourceId:'evidence-smoke'}],originalClaimFingerprint:socialFingerprint,contradictionStatus:'uncontested',state:'active'}; return {version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[socialLira,socialTorvin],publicCanon:{currentDay:4,entityKinds:{[socialLiraNpc]:'npc',[socialTorvinNpc]:'npc'}},authorizedEvidence:[{id:'evidence-smoke',kind:'world_event',sourceFingerprint:socialFingerprint,summary:'Smoke rose by the northern pass.'}],participants:[socialResident(socialLira,socialLiraNpc,['conceal','share_gossip'],[belief]),socialResident(socialTorvin,socialTorvinNpc,[])]}; }
function socialProposal(publicSummary: string | null = 'Lira and Torvin compared reports by the northern road.') { return {version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[socialLira,socialTorvin],privateCommunicativeIntents:[{speakerResidentId:socialLira,recipientResidentId:socialTorvin,mode:'withhold',message:'Do not mention the smoke to the keeper yet.'}],privateExchangeSummary:'Lira privately asks Torvin to keep their smoke report close.',evidenceIds:['evidence-smoke'],causalExplanation:'The exchange relies only on the frozen smoke report.',relationshipEffects:[{recipientResidentId:socialTorvin,sourceResidentId:socialLira,axis:'trust',delta:1}],gossipBeliefAdditions:[{recipientResidentId:socialTorvin,sourceResidentId:socialLira,sourceBeliefId:socialBelief,sourceEvidenceId:'evidence-smoke',originalClaimFingerprint:socialFingerprint,content:'Smoke rose by the northern pass.',confidence:56,provenance:[{sourceKind:'direct_evidence',sourceId:'evidence-smoke'},{sourceKind:'gossip',sourceId:socialBelief,speakerNpcId:socialLiraNpc}]}],publicSummary}; }
function socialClaim(checkpoints: unknown[] = []) { const raw=claim(checkpoints) as any; raw.kind='social_encounter'; raw.jobInputVersion='social-encounter-v1'; raw.jobInputSnapshot=socialContext(); return raw; }
async function socialReceipt(args: Record<string, unknown>) { return {data:{status:'completed',rulesVersion:'social-encounter-v1',settlementId:args.p_settlement_id,jobId:args.p_job_id,proposalFingerprint:await fingerprintSocialEncounterProposal(args.p_proposal,socialContext() as any)},error:null}; }
const proceduralResident=id('201');
function proceduralContext() { return {version:'procedural-world-v1',entityKinds:{millhaven:'location'},activeGeneratedEntityCount:12,activeQuestByResident:{},capabilities:{[proceduralResident]:{version:'capabilities-v1',allowedActions:['prepare'],allowedApproaches:['scouting'],allowedWorldEffects:['create_entity','record_world_event'],allowedTargetKinds:['location'],socialCapabilities:[],irreversibleEffects:[]}}}; }
function proceduralProposal() { return {version:'procedural-world-v1',commands:[{operation:'entity',effectKind:'create_entity',sourceResidentId:proceduralResident,entityKind:'place',entityKey:'Old Mill',archetypeKey:'landmark',proposedName:'Old Mill',payload:{region:'north'}},{operation:'public_event',effectKind:'record_world_event',sourceResidentId:proceduralResident,templateKey:'market-day',participantEntityRefs:['millhaven'],title:'Market day returns',summary:'Merchants gather by the old mill.',reuseKey:'old-mill-market'}]}; }
function proceduralClaim(checkpoints: unknown[] = []) { const raw=claim(checkpoints) as any; raw.kind='procedural_world'; raw.jobInputVersion='procedural-world-v1'; raw.jobInputSnapshot=proceduralContext(); return raw; }
async function proceduralFingerprint(proposal:unknown) { const context=parseFrozenProceduralWorldContext(proceduralContext()); const canonical=context && canonicalizeProceduralWorldProposal(proposal,context); if (!canonical) throw new Error('fixture proposal must canonicalize'); const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)); return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join(''); }
async function proceduralReceipt(args: Record<string,unknown>, replayed=false) { return {data:{status:'completed',rulesVersion:'procedural-world-v1',settlementId:args.p_settlement_id,jobId:args.p_job_id,proposalFingerprint:await proceduralFingerprint(args.p_proposal),replayed},error:null}; }

describe('world settlement worker', () => {
  it('strictly rejects malformed claims before any RPC', async () => {
    expect(() => parseSettlementClaim({ status:'processing', jobId:'nope' })).toThrow();
    const mock=client(); expect(await runSettlementClaim(mock.api, { jobId:'nope' })).toEqual({status:'failed',errorCode:'claim_malformed'}); expect(mock.calls).toHaveLength(0);
  });
  it('accepts full settlement ordinals and an optional nullable resident subject', () => {
    const full=claim() as any;
    full.ordinal=64; full.subjectInstanceId=id('10');
    expect(parseSettlementClaim(full)).toMatchObject({ordinal:64,subjectInstanceId:id('10')});
    full.subjectInstanceId=null;
    expect(parseSettlementClaim(full)).toMatchObject({ordinal:64,subjectInstanceId:null});
    full.subjectInstanceId='not-a-uuid';
    expect(() => parseSettlementClaim(full)).toThrow();
    full.subjectInstanceId=null; full.ordinal=65;
    expect(() => parseSettlementClaim(full)).toThrow();
  });
  it('atomically commits an accepted resident proposal with its canonical fingerprint and digest', async () => {
    const mock=client({world_settlement_commit_mutation:(args:Record<string,unknown>)=>committedReceipt(args)}); const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest});
    const operationalEvents: unknown[]=[];
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999,observability:(event)=>{operationalEvents.push(event);}})).toMatchObject({status:'completed',kind:'pressure_only'});
    expect(provider.calls).toEqual(['proposer','critic','digest']);
    const commit=mock.calls.find((call)=>call.name==='world_settlement_commit_mutation');
    expect(commit?.args).toMatchObject({p_settlement_id:id('1'),p_job_id:id('2'),p_fence:id('3'),p_proposal:proposal,p_proposal_fingerprint:await fingerprintMutationProposal(proposal),p_public_digest:'The tavern rests quietly. No new world changes were committed.'});
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_safe_result');
    expect(operationalEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({correlationId:`settlement:${id('1')}:job:${id('2')}`,workflow:'world_settlement',stage:'proposer',status:'completed',attempt:1,model:'fixture-model',tokenUsage:{input:1,output:1}}),
      expect.objectContaining({stage:'critic',status:'completed'}), expect.objectContaining({stage:'digest',status:'completed'})
    ]));
    expect(JSON.stringify(operationalEvents)).not.toContain('The keeper promised a safe place to rest.');
  });
  it('safely skips non-resident jobs without provider work or mutation commits', async () => {
    const raw=claim() as any; raw.kind='snapshot';
    const mock=client(); const provider=fixtureProvider({}); const events:unknown[]=[];
    expect(await runSettlementClaim(mock.api, raw, {provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'skipped'});
    expect(provider.calls).toEqual([]);
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_commit_mutation');
    expect(events.map((event:any)=>[event.stage,event.status])).toEqual([
      ['safe_fallback','started'],['safe_fallback','completed']
    ]);
  });
  it('admits a canon event after its independent proposer and critic calls, without a model digest', async () => {
    const events:unknown[]=[];
    const mock=client({world_settlement_commit_canon:async(args:Record<string,unknown>)=>{
      const { fingerprintWorldCanonEventProposal }=await import('$lib/game/evolving-world');
      const fingerprint=await fingerprintWorldCanonEventProposal(args.p_event,{entityKinds:{lira:'npc'},activeGeneratedEntityCount:0,existingPublicEventReuseKeys:[]});
      return {...canonReceipt(args),data:{...(canonReceipt(args).data as object),proposalFingerprint:fingerprint}};
    }});
    const provider=fixtureProvider({canon_proposer:canonEvent,canon_critic:{outcome:'accept',rationale:'frozen',instructions:[]}});
    expect(await runSettlementClaim(mock.api,canonClaim(),{provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'canon'});
    expect(provider.calls).toEqual(['canon_proposer','canon_critic']);
    expect(mock.calls.map((entry)=>entry.name)).toContain('world_settlement_commit_canon');
    expect(mock.calls.map((entry)=>entry.name)).not.toContain('world_settlement_complete_news');
    expect(events.map((event:any)=>[event.stage,event.status])).toEqual([
      ['canon_proposer','started'],['canon_proposer','completed'],['canon_validate','completed'],
      ['canon_critic','started'],['canon_critic','completed'],
      ['canon_commit','started'],['canon_commit','completed']
    ]);
    const serialized=JSON.stringify(events);
    expect(serialized).not.toContain(canonEvent.title); expect(serialized).not.toContain(canonEvent.summary);
    expect(serialized).not.toContain('sk-secret-canon-input');
  });
  it('uses exactly one repair and final critic for a canon event', async () => {
    const mock=client({world_settlement_commit_canon:async(args:Record<string,unknown>)=>{
      const { fingerprintWorldCanonEventProposal }=await import('$lib/game/evolving-world'); const fingerprint=await fingerprintWorldCanonEventProposal(args.p_event,{entityKinds:{lira:'npc'},activeGeneratedEntityCount:0,existingPublicEventReuseKeys:[]});
      return {...canonReceipt(args),data:{...(canonReceipt(args).data as object),proposalFingerprint:fingerprint}};
    }});
    const provider=fixtureProvider({canon_proposer:canonEvent,canon_critic:{outcome:'repair',rationale:'tighten',instructions:['Keep it public.']},canon_repair:canonEvent,canon_final_critic:{outcome:'accept',rationale:'frozen',instructions:[]}});
    expect(await runSettlementClaim(mock.api,canonClaim(),{provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'canon'});
    expect(provider.calls).toEqual(['canon_proposer','canon_critic','canon_repair','canon_final_critic']);
  });
  it('fails canon validation safely and never calls a critic or commit for invalid output', async () => {
    const mock=client(); const provider=fixtureProvider({canon_proposer:{...canonEvent,title:''}});
    expect(await runSettlementClaim(mock.api,canonClaim(),{provider,heartbeatMs:99_999})).toEqual({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual(['canon_proposer']); expect(mock.calls.map((entry)=>entry.name)).not.toContain('world_settlement_commit_canon');
  });
  it('reuses canon checkpoints and never regenerates a prior accepted proposal', async () => {
    const checkpoints=[{stage:'proposer',payload:{proposal:canonEvent},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},{stage:'critic',payload:{decision:{outcome:'accept',rationale:'frozen',instructions:[]}},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')}];
    const mock=client({world_settlement_commit_canon:async(args:Record<string,unknown>)=>{const { fingerprintWorldCanonEventProposal }=await import('$lib/game/evolving-world'); const fingerprint=await fingerprintWorldCanonEventProposal(args.p_event,{entityKinds:{lira:'npc'},activeGeneratedEntityCount:0,existingPublicEventReuseKeys:[]}); return {...canonReceipt(args),data:{...(canonReceipt(args).data as object),proposalFingerprint:fingerprint}};}});
    const provider=fixtureProvider({}); expect(await runSettlementClaim(mock.api,canonClaim(checkpoints),{provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'canon'}); expect(provider.calls).toEqual([]);
  });
  it('commits one accepted social encounter through the server-only social RPC and records no private content in telemetry', async () => {
    const events: unknown[]=[];
    const mock=client({world_settlement_commit_social_encounter:socialReceipt});
    const provider=fixtureProvider({social_encounter_proposer:socialProposal(),social_encounter_critic:{decision:'accept',instructions:[]}});
    const payloads:Array<[string, unknown]>=[]; const generate=provider.generate.bind(provider);
    provider.generate=async(stage,payload,signal)=>{payloads.push([stage,payload]); return generate(stage,payload,signal);};
    expect(await runSettlementClaim(mock.api,socialClaim(),{provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'social_encounter'});
    expect(provider.calls).toEqual(['social_encounter_proposer','social_encounter_critic']);
    expect(payloads[0][1]).toMatchObject({version:'social-encounter-v1',publicCanon:{currentDay:4}});
    expect(payloads[1][1]).toMatchObject({context:payloads[0][1],proposal:socialProposal()});
    expect(Object.keys(payloads[1][1] as object).sort()).toEqual(['context','proposal']);
    const commit=mock.calls.find((entry)=>entry.name==='world_settlement_commit_social_encounter');
    expect(commit?.args).toMatchObject({p_settlement_id:id('1'),p_job_id:id('2'),p_fence:id('3'),p_proposal:socialProposal()});
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({stage:'social_encounter_proposer',status:'completed',model:'fixture-model',tokenUsage:{input:1,output:1}}),
      expect.objectContaining({stage:'social_encounter_critic',status:'completed'}),
      expect.objectContaining({stage:'social_encounter_validate',status:'completed'}),
      expect.objectContaining({stage:'social_encounter_commit',status:'completed'})
    ]));
    expect(JSON.stringify(events)).not.toContain('Do not mention the smoke');
    expect(JSON.stringify(events)).not.toContain('Smoke rose by the northern pass');
  });
  it('uses at most one social repair and one final critic before committing', async () => {
    const mock=client({world_settlement_commit_social_encounter:socialReceipt});
    const provider=fixtureProvider({
      social_encounter_proposer:socialProposal(),
      social_encounter_critic:{decision:'repair',instructions:[{code:'public_projection',path:'publicSummary'}]},
      social_encounter_repair:socialProposal(null),
      social_encounter_final_critic:{decision:'accept',instructions:[]}
    });
    expect(await runSettlementClaim(mock.api,socialClaim(),{provider,heartbeatMs:99_999})).toEqual({status:'completed',kind:'social_encounter'});
    expect(provider.calls).toEqual(['social_encounter_proposer','social_encounter_critic','social_encounter_repair','social_encounter_final_critic']);
  });
  it('reuses valid social checkpoints and avoids duplicate provider work', async () => {
    const checkpoints=[
      {stage:'proposer',payload:{proposal:socialProposal()},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'critic',payload:{decision:{decision:'accept',instructions:[]}},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')}
    ];
    const mock=client({world_settlement_commit_social_encounter:socialReceipt}); const provider=fixtureProvider({}); const events:unknown[]=[];
    expect(await runSettlementClaim(mock.api,socialClaim(checkpoints),{provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'social_encounter'});
    expect(provider.calls).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({stage:'social_encounter_proposer',status:'reused'}),expect.objectContaining({stage:'social_encounter_critic',status:'reused'})]));
  });
  it('commits an accepted procedural proposal through the service-only RPC with two calls and content-free telemetry', async () => {
    const events:unknown[]=[]; const mock=client({world_settlement_commit_procedural_world:proceduralReceipt});
    const provider=fixtureProvider({procedural_world_proposer:proceduralProposal(),procedural_world_critic:{decision:'accept',instructions:[]}});
    expect(await runSettlementClaim(mock.api,proceduralClaim(),{provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'procedural_world'});
    expect(provider.calls).toEqual(['procedural_world_proposer','procedural_world_critic']);
    expect(mock.calls.find((entry)=>entry.name==='world_settlement_commit_procedural_world')?.args).toMatchObject({p_settlement_id:id('1'),p_job_id:id('2'),p_fence:id('3'),p_proposal:{version:'procedural-world-v1'}});
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({stage:'procedural_world_proposer',status:'completed',attempt:1,model:'fixture-model',tokenUsage:{input:1,output:1}}),
      expect.objectContaining({stage:'procedural_world_critic',status:'completed'}),
      expect.objectContaining({stage:'procedural_world_validate',status:'completed'}),
      expect.objectContaining({stage:'procedural_world_commit',status:'completed'})
    ]));
    const serialized=JSON.stringify(events); expect(serialized).not.toContain('Market day returns'); expect(serialized).not.toContain(proceduralResident);
  });
  it('allows one procedural repair, reuses validated checkpoints without historical usage, and accepts an exact replay receipt', async () => {
    const repair=fixtureProvider({procedural_world_proposer:proceduralProposal(),procedural_world_critic:{decision:'repair',instructions:[{code:'entity_registry',path:'commands.entity'}]},procedural_world_repair:proceduralProposal(),procedural_world_final_critic:{decision:'accept',instructions:[]}});
    expect(await runSettlementClaim(client({world_settlement_commit_procedural_world:proceduralReceipt}).api,proceduralClaim(),{provider:repair,heartbeatMs:99_999})).toEqual({status:'completed',kind:'procedural_world'});
    expect(repair.calls).toEqual(['procedural_world_proposer','procedural_world_critic','procedural_world_repair','procedural_world_final_critic']);
    const checkpoints=[
      {stage:'proposer',payload:{proposal:proceduralProposal()},usage:{input:999,output:999},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'critic',payload:{decision:{decision:'accept',instructions:[]}},usage:{input:999,output:999},model:'old',promptVersion:'v',sourceFence:id('4')}
    ];
    const events:unknown[]=[]; const reused=fixtureProvider({});
    expect(await runSettlementClaim(client({world_settlement_commit_procedural_world:(args:Record<string,unknown>)=>proceduralReceipt(args,true)}).api,proceduralClaim(checkpoints),{provider:reused,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'procedural_world'});
    expect(reused.calls).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({stage:'procedural_world_proposer',status:'reused'}),expect.objectContaining({stage:'procedural_world_critic',status:'reused'})]));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({stage:'procedural_world_commit',status:'reused',attempt:1})]));
    expect((events as Array<Record<string,unknown>>).find((event)=>event.stage==='procedural_world_commit')).not.toHaveProperty('durationMs');
    expect(JSON.stringify(events)).not.toContain('999');
  });
  it('discovers post-commit promoted NPCs after a fresh procedural commit without another provider call', async () => {
    const events:unknown[]=[]; const provider=fixtureProvider({procedural_world_proposer:proceduralProposal(),procedural_world_critic:{decision:'accept',instructions:[]}});
    const mock=client({world_settlement_commit_procedural_world:proceduralReceipt,world_discover_procedural_npc_promotions:{status:'completed',promotedCount:1}});
    expect(await runSettlementClaim(mock.api,proceduralClaim(),{provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'procedural_world'});
    expect(provider.calls).toEqual(['procedural_world_proposer','procedural_world_critic']);
    expect(mock.calls.map((entry)=>entry.name)).toEqual(expect.arrayContaining(['world_settlement_commit_procedural_world','world_discover_procedural_npc_promotions']));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({stage:'procedural_world_promotion',status:'completed',attempt:1})]));
    expect(JSON.stringify(events)).not.toContain('entityId');
  });
  it('requeues the durable procedural receipt after promotion failure, then heals on replay without provider work or fallback', async () => {
    const failedEvents:unknown[]=[]; const firstProvider=fixtureProvider({procedural_world_proposer:proceduralProposal(),procedural_world_critic:{decision:'accept',instructions:[]}});
    const first=client({world_settlement_commit_procedural_world:proceduralReceipt,world_discover_procedural_npc_promotions:()=>({data:null,error:{message:'private promotion failure'}}),world_retry_procedural_npc_promotion:{status:'retrying'}});
    expect(await runSettlementClaim(first.api,proceduralClaim(),{provider:firstProvider,heartbeatMs:99_999,observability:(event)=>{failedEvents.push(event);}})).toEqual({status:'failed',errorCode:'promotion_failed'});
    expect(first.calls.map((entry)=>entry.name)).toContain('world_retry_procedural_npc_promotion');
    expect(first.calls.map((entry)=>entry.name)).not.toContain('world_settlement_safe_result');
    expect(firstProvider.calls).toEqual(['procedural_world_proposer','procedural_world_critic']);
    expect(failedEvents).toEqual(expect.arrayContaining([expect.objectContaining({stage:'procedural_world_promotion',status:'failed',errorCode:'promotion_failed'})]));
    expect(JSON.stringify(failedEvents)).not.toContain('private promotion failure');
    const checkpoints=[{stage:'proposer',payload:{proposal:proceduralProposal()},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},{stage:'critic',payload:{decision:{decision:'accept',instructions:[]}},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')}];
    const replayProvider=fixtureProvider({}); const replay=client({world_settlement_commit_procedural_world:(args:Record<string,unknown>)=>proceduralReceipt(args,true),world_discover_procedural_npc_promotions:{status:'completed',promotedCount:1}});
    expect(await runSettlementClaim(replay.api,proceduralClaim(checkpoints),{provider:replayProvider,heartbeatMs:99_999})).toEqual({status:'completed',kind:'procedural_world'});
    expect(replayProvider.calls).toEqual([]);
    expect(replay.calls.map((entry)=>entry.name)).toEqual(expect.arrayContaining(['world_settlement_commit_procedural_world','world_discover_procedural_npc_promotions']));
    expect(replay.calls.map((entry)=>entry.name)).not.toContain('world_settlement_safe_result');
  });
  it('rejects malformed procedural receipts and uses a safe fallback for provider failures without committing', async () => {
    const malformed=client({world_settlement_commit_procedural_world:async(args:Record<string,unknown>)=>({data:{...(await proceduralReceipt(args)).data,replayed:'true'},error:null})});
    const provider=fixtureProvider({procedural_world_proposer:proceduralProposal(),procedural_world_critic:{decision:'accept',instructions:[]}});
    expect(await runSettlementClaim(malformed.api,proceduralClaim(),{provider,heartbeatMs:99_999})).toEqual({status:'failed',errorCode:'commit_unknown'});
    const fallback=client(); const events:unknown[]=[]; const unavailable=fixtureProvider({procedural_world_proposer:new SettlementProviderError('provider_unavailable','private upstream detail')});
    expect(await runSettlementClaim(fallback.api,proceduralClaim(),{provider:unavailable,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'skipped'});
    expect(fallback.calls.map((entry)=>entry.name)).toContain('world_settlement_safe_result'); expect(fallback.calls.map((entry)=>entry.name)).not.toContain('world_settlement_commit_procedural_world');
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({stage:'procedural_world_fallback',status:'completed',errorCode:'provider_unavailable'})]));
    expect(JSON.stringify(events)).not.toContain('private upstream detail');
  });
  it('fails closed into a social safe fallback for invalid, rejected, or unavailable social work', async () => {
    const invalid=client(); const invalidProvider=fixtureProvider({social_encounter_proposer:{invalid:true}});
    expect(await runSettlementClaim(invalid.api,socialClaim(),{provider:invalidProvider,heartbeatMs:99_999})).toEqual({status:'completed',kind:'rejected'});
    expect(invalidProvider.calls).toEqual(['social_encounter_proposer']);
    expect(invalid.calls.map((entry)=>entry.name)).toContain('world_settlement_safe_result');

    const rejected=client(); const rejectedProvider=fixtureProvider({social_encounter_proposer:socialProposal(),social_encounter_critic:{decision:'reject',instructions:[]}});
    expect(await runSettlementClaim(rejected.api,socialClaim(),{provider:rejectedProvider,heartbeatMs:99_999})).toEqual({status:'completed',kind:'rejected'});
    expect(rejected.calls.map((entry)=>entry.name)).toContain('world_settlement_safe_result');

    const unavailable=client(); const unavailableEvents:unknown[]=[]; const unavailableProvider=fixtureProvider({social_encounter_proposer:new SettlementProviderError('provider_unavailable','provider unavailable')});
    expect(await runSettlementClaim(unavailable.api,socialClaim(),{provider:unavailableProvider,heartbeatMs:99_999,observability:(event)=>{unavailableEvents.push(event);}})).toEqual({status:'completed',kind:'skipped'});
    expect(unavailable.calls.map((entry)=>entry.name)).toContain('world_settlement_safe_result');
    expect(unavailable.calls.map((entry)=>entry.name)).not.toContain('world_settlement_commit_social_encounter');
    expect(unavailableEvents).toEqual(expect.arrayContaining([expect.objectContaining({stage:'social_encounter_fallback',status:'completed',errorCode:'provider_unavailable'})]));
    expect(JSON.stringify(unavailableEvents)).not.toContain('Do not mention the smoke');

    const timedOut=client(); const timeoutEvents:unknown[]=[]; const timeoutProvider=fixtureProvider({social_encounter_proposer:new SettlementProviderError('provider_timeout','private upstream timeout detail')});
    expect(await runSettlementClaim(timedOut.api,socialClaim(),{provider:timeoutProvider,heartbeatMs:99_999,observability:(event)=>{timeoutEvents.push(event);}})).toEqual({status:'completed',kind:'skipped'});
    expect(timeoutEvents).toEqual(expect.arrayContaining([expect.objectContaining({stage:'social_encounter_fallback',status:'completed',errorCode:'provider_timeout'})]));
    expect(JSON.stringify(timeoutEvents)).not.toContain('private upstream timeout detail');
  });
  it('treats a malformed canon receipt as unknown rather than retrying or applying a fallback', async () => {
    const mock=client({world_settlement_commit_canon:{status:'completed',rulesVersion:'world-canon-event-v1'}}); const provider=fixtureProvider({canon_proposer:canonEvent,canon_critic:{outcome:'accept',rationale:'frozen',instructions:[]}});
    expect(await runSettlementClaim(mock.api,canonClaim(),{provider,heartbeatMs:99_999})).toEqual({status:'failed',errorCode:'commit_unknown'});
    expect(mock.calls.map((entry)=>entry.name)).not.toContain('world_settlement_safe_result');
  });
  it('completes news deterministically without touching the provider', async () => {
    const raw=canonClaim() as any; raw.kind='news'; const mock=client({world_settlement_complete_news:(args:Record<string,unknown>)=>({data:{status:'completed',rulesVersion:'world-canon-event-v1',settlementId:args.p_settlement_id,jobId:args.p_job_id,morningNews:'Market day arrived.'},error:null})}); const provider=fixtureProvider({}); const events:unknown[]=[];
    expect(await runSettlementClaim(mock.api,raw,{provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toEqual({status:'completed',kind:'news'}); expect(provider.calls).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({stage:'news_aggregate',status:'completed'}),expect.objectContaining({stage:'news_commit',status:'completed'})]));
  });
  it('finishes the queued finalize claim with a safe result after earlier jobs settled', async () => {
    const raw=claim() as any; raw.kind='finalize'; const mock=client();
    expect(await runSettlementClaim(mock.api,raw,{provider:fixtureProvider({}),heartbeatMs:99_999})).toEqual({status:'completed',kind:'skipped'});
    expect(mock.calls.map((entry)=>entry.name)).toContain('world_settlement_safe_result');
  });
  it('allows one repair and rejects a final repair request', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:proposal,critic:{outcome:'repair',rationale:'clarify',instructions:['Keep it bounded.']},repair:proposal,final_critic:{outcome:'repair',rationale:'still wrong',instructions:['no']}});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual(['proposer','critic','repair','final_critic']);
  });
  it('reuses valid checkpoint outputs without making duplicate provider calls', async () => {
    const mock=client({world_settlement_commit_mutation:(args:Record<string,unknown>)=>committedReceipt(args)}); const provider=fixtureProvider({digest}); const checkpoints=[
      {stage:'proposer',payload:{proposal},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'critic',payload:{decision:{outcome:'accept',rationale:'supported',instructions:[]}},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')}
    ];
    expect(await runSettlementClaim(mock.api, claim(checkpoints), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed'}); expect(provider.calls).toEqual(['digest']);
  });
  it('replays a prior-fence accepted checkpoint and exact digest through one commit without provider calls', async () => {
    const mock=client({world_settlement_commit_mutation:(args:Record<string,unknown>)=>committedReceipt(args)}); const checkpoints=[
      {stage:'proposer',payload:{proposal},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'critic',payload:{decision:{outcome:'accept',rationale:'supported',instructions:[]}},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'validated',payload:{accepted:true,proposal},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'digest',payload:{digest},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')}
    ];
    const provider=fixtureProvider({});
    expect(await runSettlementClaim(mock.api, claim(checkpoints), {provider,heartbeatMs:99_999})).toEqual({status:'completed',kind:'pressure_only'});
    expect(provider.calls).toEqual([]);
    expect(mock.calls.filter((call)=>call.name==='world_settlement_commit_mutation')).toHaveLength(1);
  });
  it('rejects malformed model output through a safe result without advancing mechanics', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:{not:'a proposal'}});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
  });
  it('rejects a fabricated evidence reference before critic work', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:{...proposal,evidenceIds:['fabricated']}});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual(['proposer']);
  });
  it('rejects belief provenance that is not frozen authorized evidence', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:{...proposal,beliefOperations:[{operation:'add',subjectEntityId:'lira',content:'The keeper keeps promises.',confidence:60,provenance:[{sourceKind:'dialogue_claim',sourceId:'fabricated'}],originalClaimFingerprint:'a'.repeat(64)}]}});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual(['proposer']);
  });
  it('rejects a belief when its claim fingerprint belongs to different frozen evidence', async () => {
    const raw=claim() as any;
    raw.jobInputSnapshot.evolution.authorizedEvidence.push({id:'evidence-2',kind:'gossip',happenedOnDay:1,sequence:3,sourceFingerprint:'b'.repeat(64),salience:'minor',summary:'A second rumor.'});
    const mock=client(); const provider=fixtureProvider({proposer:{...proposal,beliefOperations:[{operation:'add',subjectEntityId:'lira',content:'The keeper keeps promises.',confidence:60,provenance:[{sourceKind:'dialogue_claim',sourceId:'evidence-1'}],originalClaimFingerprint:'b'.repeat(64)}]}});
    expect(await runSettlementClaim(mock.api, raw, {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual(['proposer']);
  });
  it('gives the proposer only the frozen authorized evidence records', async () => {
    const mock=client(); let received: unknown; const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest}); const generate=provider.generate.bind(provider);
    provider.generate=async(stage,payload,signal)=>{if(stage==='proposer')received=payload;return generate(stage,payload,signal);};
    await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999});
    expect(received).toMatchObject({authorizedEvidence:[{id:'evidence-1',summary:'The keeper promised a safe place to rest.'}]});
    expect(JSON.stringify(received)).not.toMatch(/pressureByDimension|roll/i);
  });
  it('does no provider work when the lease is too close to complete safely', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:proposal}); const events: unknown[]=[];
    expect(await runSettlementClaim(mock.api, claim([],new Date(Date.now()+400).toISOString()), {provider,heartbeatMs:99_999,observability:(event)=>{events.push(event);}})).toMatchObject({status:'lease_lost',errorCode:'lease_unavailable'});
    expect(provider.calls).toEqual([]);
    expect(events).toEqual([expect.objectContaining({workflow:'world_settlement',stage:'lease',status:'failed',attempt:1,errorCode:'lease_unavailable'})]);
  });
  it('abandons a stale fence without calling safe completion', async () => {
    const mock=client({world_settlement_heartbeat:()=>({data:null,error:{message:'Stale settlement fence'}})});
    const provider={ async generate() { await new Promise((resolve)=>setTimeout(resolve,1_050)); return {value:proposal,model:'fixture',usage:{input:1,output:1},durationMs:1,promptVersion:'v'}; } };
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:1})).toMatchObject({status:'lease_lost'});
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_safe_result');
  });
  it('returns lease_lost after a stale commit without calling safe completion or failure', async () => {
    const mock=client({world_settlement_commit_mutation:()=>({data:null,error:{message:'Stale settlement fence'}})});
    const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'lease_lost'});
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_safe_result');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_fail');
  });
  it('returns commit_unknown after an ordinary commit transport failure without attempting a safe result or failure finalization', async () => {
    const mock=client({world_settlement_commit_mutation:()=>({data:null,error:{message:'Mutation receipt write failed'}})});
    const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'failed',errorCode:'commit_unknown'});
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_fail');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_safe_result');
  });
  it.each([
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,outcome:'invented'}),
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,rulesVersion:'wrong-version'}),
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,status:'pending'}),
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,settlementId:id('99')}),
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,jobId:id('99')}),
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,proposalFingerprint:'b'.repeat(64)}),
    (args:Record<string,unknown>) => ({...committedReceipt(args).data,publicDigest:'other digest'})
  ])('returns commit_unknown for malformed or mismatched commit receipts without a safe result: %o', async (receiptFor) => {
    const mock=client({world_settlement_commit_mutation:(args:Record<string,unknown>)=>({data:receiptFor(args),error:null})});
    const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'failed',errorCode:'commit_unknown'});
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_fail');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_safe_result');
  });
  it.each([['residentId','not-a-uuid'],['npcId','not-a-uuid'],['profileRevision',0],['profileRevision',1.5]])('rejects malformed frozen %s without committing', async (field,value) => {
    const raw=claim() as any; raw.jobInputSnapshot.evolution[field]=value;
    const mock=client(); const provider=fixtureProvider({});
    expect(await runSettlementClaim(mock.api, raw, {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual([]);
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_commit_mutation');
  });
  it('rejects an evolution envelope with unrecognized keys before provider work', async () => {
    const raw=claim() as any; raw.jobInputSnapshot.evolution.untrusted='value';
    const mock=client(); const provider=fixtureProvider({});
    expect(await runSettlementClaim(mock.api, raw, {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual([]);
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
  });
  it('rejects corrupt frozen evidence fingerprints before provider work', async () => {
    const raw=claim() as any; raw.jobInputSnapshot.evolution.authorizedEvidence[0].sourceFingerprint='not-a-fingerprint';
    const mock=client(); const provider=fixtureProvider({});
    expect(await runSettlementClaim(mock.api, raw, {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual([]);
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
  });
  it.each([
    (evolution:any) => { evolution.schema.dimensions=[]; },
    (evolution:any) => { evolution.profile.dimensions.resolve=101; },
    (evolution:any) => { evolution.capability.allowedWorldEffects=['invented_effect']; },
    (evolution:any) => { evolution.capability.allowedActions=['arbitrary']; },
    (evolution:any) => { evolution.worldSnapshot.entityKinds.lira='script'; },
    (evolution:any) => { evolution.worldSnapshot.currentDay=0; },
    (evolution:any) => { evolution.pressureByDimension.resolve=1_000_001; }
  ])('rejects invalid frozen contracts before provider work', async (mutate) => {
    const raw=claim() as any; mutate(raw.jobInputSnapshot.evolution);
    const mock=client(); const provider=fixtureProvider({});
    expect(await runSettlementClaim(mock.api, raw, {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual([]);
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_commit_mutation');
  });
  it('fails and yields its lease after the bounded provider deadline', async () => {
    const mock=client(); const provider={ async generate(_stage:unknown,_payload:unknown,signal:AbortSignal) { await new Promise<void>((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})); throw new Error('unreachable'); } };
    const operationalEvents: unknown[]=[];
    expect(await runSettlementClaim(mock.api, claim(), {provider,timeoutMs:5,heartbeatMs:99_999,observability:(event)=>{operationalEvents.push(event);}})).toMatchObject({status:'failed',errorCode:'provider_timeout'});
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_fail');
    expect(operationalEvents).toEqual(expect.arrayContaining([expect.objectContaining({workflow:'world_settlement',stage:'proposer',status:'failed',attempt:1,errorCode:'provider_timeout'})]));
  });
  it('does not leak private frozen state into the digest payload', async () => {
    const mock=client(); let payload:unknown; const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest}); const original=provider.generate.bind(provider); provider.generate=async(stage,input,signal)=>{if(stage==='digest')payload=input;return original(stage,input,signal);};
    await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999}); expect(JSON.stringify(payload)).not.toMatch(/pressure|profile|capability|roll|evidence/i);
  });
  it('limits a wake to four serial claims and stays inert in tests', async () => {
    let claims=0; const mock=client({world_settlement_claim_next:()=>({data:claims++ < 6 ? claim() : {status:'idle'},error:null})});
    const provider=fixtureProvider({proposer:proposal,critic:{outcome:'reject',rationale:'no',instructions:[]},digest});
    // The default provider is intentionally not used by this queue seam test; direct parser confirms the cap without network work.
    const outcomes=await drainWorldSettlementQueue(4, mock.api, {provider,heartbeatMs:99_999,observability:()=>undefined}); expect(outcomes).toHaveLength(4); startWorldSettlementWorker();
  });
  it('classifies a missing or local provider as unavailable without a network call', async () => {
    await expect(createSettlementProvider({}).generate('proposer',{},new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
    await expect(createSettlementProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test'}).generate('digest',{},new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
  });
});
