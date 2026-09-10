import { describe, expect, it } from 'vitest';
import { ContextBudgetError, describePayload, CONTEXT_LIMIT, PAYLOAD_LIMIT, prepareContext, stagePayload } from '../../src/lib/server/dialogue/context';
const exchange=(id:string)=>({id,keeper:'k'.repeat(1800)+' I promise to listen.',npc:'n'.repeat(2800)+' I have not completed the quest.'});
const base=()=>({name:'Lira',message:'Did it work?',intention:{goal:'Protect Millhaven'},personality:{values:['honesty']},recent:[exchange('last')]});
const evidence=(id:string,size=100)=>({category:'memories',query:'promise',sourceIds:[id],contentVersion:'npc-v1',data:{id,text:'e'.repeat(size)}});
describe('dialogue context windows',()=>{
  it('preserves the end of whole exchanges and never mutates source records',()=>{
    const source=base();const saved=structuredClone(source);
    const window=prepareContext(source,[evidence('promise')]);
    expect(window.base.recent[0]).toEqual(source.recent[0]);
    expect(window.base.recent[0].keeper).toContain('I promise to listen.');
    expect(window.base.recent[0].npc).toContain('I have not completed the quest.');
    expect(source).toEqual(saved);
    expect(window.coverage).toMatchObject({omittedExchanges:0,omittedResults:0});
  });
  it('fits whole records, prioritizing current evidence and the immediately preceding exchange',()=>{
    const source={...base(),recent:Array.from({length:6},(_,i)=>exchange(String(i)))};
    const facts=[evidence('first',6000),evidence('follow-up',6000)];
    const window=prepareContext(source,facts);
    expect(JSON.stringify(window).length).toBeLessThanOrEqual(CONTEXT_LIMIT);
    expect(window.coverage.omittedExchanges).toBeGreaterThan(0);
    expect(window.context).toEqual(facts);
    expect(window.base.recent.at(-1)).toEqual(source.recent.at(-1));
    expect(window.base.message).toBe(source.message);
    const crowded=prepareContext(base(),[evidence('old',25000),evidence('new',25000)]);
    expect(crowded.coverage.omittedResults).toBeGreaterThan(0);
    expect(crowded.base.recent).toEqual(base().recent);
  });
  it('uses identical evidence for decisions, speech, review and rewriting',()=>{
    const window=prepareContext(base(),[evidence('promise',20000)]);
    const decision={stance:'respond',intention:null};
    const payloads=[stagePayload(window),stagePayload(window,{decision}),stagePayload(window,{decision,reply:'r'.repeat(4000)}),
      stagePayload(window,{decision,previousReply:'r'.repeat(4000),corrections:['Keep promise attribution.']})];
    for(const payload of payloads){
      expect(payload.context).toEqual(window.context);expect(payload.base).toEqual(window.base);
      expect(JSON.stringify(payload).length).toBeLessThanOrEqual(PAYLOAD_LIMIT);
    }
    expect(new Set(payloads.map(payload=>describePayload(payload).contextFingerprint)).size).toBe(1);
    // PostgreSQL JSONB may reorder keys at every nesting level when a checkpoint is read.
    const reverse=(v:any):any=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
    expect(describePayload(reverse(payloads[0])).contextFingerprint).toBe(describePayload(payloads[0]).contextFingerprint);
    expect(describePayload(payloads[0])).toMatchObject({sourceIds:['promise'],recentExchangeIds:['last'],contextVersion:'npc-context-v1'});
    expect(()=>stagePayload(window,{reply:'r'.repeat(PAYLOAD_LIMIT)})).toThrow(ContextBudgetError);
  });
  it('rejects an oversized mandatory context instead of truncating personality or the last exchange',()=>{
    expect(()=>prepareContext({...base(),personality:{voice:'x'.repeat(CONTEXT_LIMIT)}},[])).toThrow(ContextBudgetError);
    expect(()=>prepareContext({...base(),recent:[{id:'last',keeper:'x'.repeat(CONTEXT_LIMIT),npc:'No.'}]},[])).toThrow(ContextBudgetError);
  });
});
