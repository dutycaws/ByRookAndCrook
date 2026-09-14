import { describe, expect, it } from 'vitest';
import { type SettlementWorkerClient } from '$lib/server/evolving-world/settlement-worker';
import { drainWorldSettlementQueue, runSettlementClaim, startWorldSettlementWorker } from '$lib/server/evolving-world/settlement-worker';
import { parseSettlementClaim } from '$lib/server/evolving-world/settlement-contracts';
import { createSettlementProvider } from '$lib/server/evolving-world/provider';
import { fixtureProvider } from '../helpers/world-settlement-provider';

const id = (tail: string) => `11111111-1111-4111-8111-${tail.padStart(12, '0')}`;
const proposal = { rulesVersion:'evolving-world-v1', evidenceIds:['evidence-1'], salience:'meaningful', dimensionChanges:[], entryOperations:[], beliefOperations:[], causalExplanation:'An observed event supports no immediate profile change.', questChanges:[], worldEffects:[] };
const digest = { summary:'The tavern rests quietly.', journalEntries:['No new world changes were committed.'], discoveredEntityIds:[] };
function claim(checkpoints: unknown[] = [], leaseUntil = new Date(Date.now() + 120_000).toISOString()) { return { settlementId:id('1'), jobId:id('2'), fence:id('3'), kind:'resident', ordinal:3, attempt:1, leaseUntil, inputFingerprint:'a'.repeat(64), inputVersion:'world-v1', inputSnapshot:{dayNumber:1, publicEntityIds:['town-square']}, jobInputVersion:'world-v1', jobInputSnapshot:{ evolution:{ schema:{version:'personality-schema-v1',dimensions:[{key:'resolve',label:'Resolve',negativeAnchor:'yielding',positiveAnchor:'unyielding',initialValue:0,volatility:1,core:false}],collections:[]}, profile:{dimensions:{resolve:0},entries:[]}, capability:{version:'v1',allowedActions:[],allowedApproaches:[],allowedWorldEffects:[],allowedTargetKinds:[],socialCapabilities:[],irreversibleEffects:[]}, worldSnapshot:{currentDay:1,entityKinds:{lira:'npc'},activeQuestIds:[],authorizedIrreversibleEffects:[]}, pressureByDimension:{resolve:0}, authorizedEvidence:[{id:'evidence-1',kind:'dialogue',happenedOnDay:1,sequence:2,sourceFingerprint:'a'.repeat(64),salience:'meaningful',summary:'The keeper promised a safe place to rest.'}] } }, checkpoints }; }
function client(overrides: Partial<Record<string, unknown>> = {}) { const calls:Array<{name:string;args:Record<string,unknown>}> = []; const api: SettlementWorkerClient = { async rpc(name,args={}) { calls.push({name,args}); const entry=overrides[name]; if (typeof entry === 'function') return (entry as (args:Record<string,unknown>)=>unknown)(args) as any; if (entry) return {data:entry,error:null}; if(name==='world_settlement_heartbeat')return {data:{leaseUntil:new Date(Date.now()+120_000).toISOString()},error:null}; return {data:{status:'recorded'},error:null}; } }; return { api,calls }; }

describe('world settlement worker', () => {
  it('strictly rejects malformed claims before any RPC', async () => {
    expect(() => parseSettlementClaim({ status:'processing', jobId:'nope' })).toThrow();
    const mock=client(); expect(await runSettlementClaim(mock.api, { jobId:'nope' })).toEqual({status:'failed',errorCode:'claim_malformed'}); expect(mock.calls).toHaveLength(0);
  });
  it('accepts a proposal, checkpoints it privately, and records only a safe result', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'no_changes'});
    expect(provider.calls).toEqual(['proposer','critic','digest']);
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_safe_result');
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_complete');
  });
  it('allows one repair and rejects a final repair request', async () => {
    const mock=client(); const provider=fixtureProvider({proposer:proposal,critic:{outcome:'repair',rationale:'clarify',instructions:['Keep it bounded.']},repair:proposal,final_critic:{outcome:'repair',rationale:'still wrong',instructions:['no']}});
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed',kind:'rejected'});
    expect(provider.calls).toEqual(['proposer','critic','repair','final_critic']);
  });
  it('reuses valid checkpoint outputs without making duplicate provider calls', async () => {
    const mock=client(); const provider=fixtureProvider({digest}); const checkpoints=[
      {stage:'proposer',payload:{proposal},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')},
      {stage:'critic',payload:{decision:{outcome:'accept',rationale:'supported',instructions:[]}},usage:{},model:'old',promptVersion:'v',sourceFence:id('4')}
    ];
    expect(await runSettlementClaim(mock.api, claim(checkpoints), {provider,heartbeatMs:99_999})).toMatchObject({status:'completed'}); expect(provider.calls).toEqual(['digest']);
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
    const mock=client(); const provider=fixtureProvider({proposer:proposal});
    expect(await runSettlementClaim(mock.api, claim([],new Date(Date.now()+400).toISOString()), {provider,heartbeatMs:99_999})).toMatchObject({status:'lease_lost'});
    expect(provider.calls).toEqual([]);
  });
  it('abandons a stale fence without calling safe completion', async () => {
    const mock=client({world_settlement_heartbeat:()=>({data:null,error:{message:'Stale settlement fence'}})});
    const provider={ async generate() { await new Promise((resolve)=>setTimeout(resolve,1_050)); return {value:proposal,model:'fixture',usage:{input:1,output:1},durationMs:1,promptVersion:'v'}; } };
    expect(await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:1})).toMatchObject({status:'lease_lost'});
    expect(mock.calls.map((call)=>call.name)).not.toContain('world_settlement_safe_result');
  });
  it('fails and yields its lease after the bounded provider deadline', async () => {
    const mock=client(); const provider={ async generate(_stage:unknown,_payload:unknown,signal:AbortSignal) { await new Promise<void>((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})); throw new Error('unreachable'); } };
    expect(await runSettlementClaim(mock.api, claim(), {provider,timeoutMs:5,heartbeatMs:99_999})).toMatchObject({status:'failed',errorCode:'provider_timeout'});
    expect(mock.calls.map((call)=>call.name)).toContain('world_settlement_fail');
  });
  it('does not leak private frozen state into the digest payload', async () => {
    const mock=client(); let payload:unknown; const provider=fixtureProvider({proposer:proposal,critic:{outcome:'accept',rationale:'supported',instructions:[]},digest}); const original=provider.generate.bind(provider); provider.generate=async(stage,input,signal)=>{if(stage==='digest')payload=input;return original(stage,input,signal);};
    await runSettlementClaim(mock.api, claim(), {provider,heartbeatMs:99_999}); expect(JSON.stringify(payload)).not.toMatch(/pressure|profile|capability|roll|evidence/i);
  });
  it('limits a wake to four serial claims and stays inert in tests', async () => {
    let claims=0; const mock=client({world_settlement_claim_next:()=>({data:claims++ < 6 ? claim() : {status:'idle'},error:null})});
    const provider=fixtureProvider({proposer:proposal,critic:{outcome:'reject',rationale:'no',instructions:[]},digest});
    // The default provider is intentionally not used by this queue seam test; direct parser confirms the cap without network work.
    const outcomes=await drainWorldSettlementQueue(4, mock.api, {provider,heartbeatMs:99_999}); expect(outcomes).toHaveLength(4); startWorldSettlementWorker();
  });
  it('classifies a missing or local provider as unavailable without a network call', async () => {
    await expect(createSettlementProvider({}).generate('proposer',{},new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
    await expect(createSettlementProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test'}).generate('digest',{},new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
  });
});
