import { describe, expect, it } from 'vitest';
import { fallbackPlayerSuggestions, preparePlayerSuggestions, validatePlayerSuggestions, type SuggestionBatchContext } from '$lib/server/dialogue/player-suggestions';
import type { DialogueProvider } from '$lib/server/dialogue/provider';

const card='11111111-1111-4111-8111-111111111111';
const secondCard='22222222-2222-4222-8222-222222222222';
const npc='33333333-3333-4333-8333-333333333333';
const secondNpc='44444444-4444-4444-8444-444444444444';
const generation='55555555-5555-4555-8555-555555555555';
const context:SuggestionBatchContext={generationId:generation,cards:[{id:card,kind:'social',cardKey:'charm',displayName:'Charm'},{id:secondCard,kind:'beverage',displayName:'Juniper tonic',qualityIndex:3}],guests:[{id:npc,name:'Mara'},{id:secondNpc,name:'Oren'}],history:[{turn:'Mara mentioned the road.'}]};

function provider(value:unknown, calls:{count:number}):DialogueProvider { return { async generate() { calls.count++; return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'}; } }; }

describe('player suggestion batches',()=>{
  it('requires exact physical-card × guest coverage and rejects duplicate pairs',()=>{
    const valid={suggestions:[
      {dailyCardId:card,npcId:npc,text:'Warmly hello.'},{dailyCardId:card,npcId:secondNpc,text:'Warmly hello.'},
      {dailyCardId:secondCard,npcId:npc,text:'Please try this tonic.'},{dailyCardId:secondCard,npcId:secondNpc,text:'Please try this tonic.'}
    ]};
    expect(validatePlayerSuggestions(valid,context)).toHaveLength(4);
    expect(validatePlayerSuggestions({suggestions:[...valid.suggestions.slice(0,3),valid.suggestions[0]]},context)).toBeNull();
  });

  it('uses one request, persists it, and reuses the persisted generation on reload',async()=>{
    let saved:unknown=null; const calls={count:0};
    const store={get:async()=>saved,context:async()=>context,upsert:async (_id:string,status:string,suggestions:unknown[])=>saved={generationId:generation,status,suggestions}};
    const output={suggestions:fallbackPlayerSuggestions(context).map(({source,...row})=>row)};
    await expect(preparePlayerSuggestions(store,generation,provider(output,calls))).resolves.toMatchObject({status:'ready'});
    await expect(preparePlayerSuggestions(store,generation,provider(output,calls))).resolves.toMatchObject({status:'ready'});
    expect(calls.count).toBe(1);
  });

  it('sends the frozen full deck, actual serving quality, and bounded guest history in one request',async()=>{
    let saved:unknown=null; let payload:unknown;
    const rich:SuggestionBatchContext={...context,guests:[{id:npc,name:'Mara',context:{recentTurns:['Mara mentioned the rain.'],knownFacts:['Mara travels the north road.']}},{id:secondNpc,name:'Oren'}],knowledge:{publicNews:['The bridge is under repair.']}};
    const store={get:async()=>saved,context:async()=>rich,upsert:async (_id:string,status:string,suggestions:unknown[])=>saved={generationId:generation,status,suggestions}};
    const model:DialogueProvider={async generate(_stage,nextPayload){payload=nextPayload; return {value:{suggestions:fallbackPlayerSuggestions(rich).map(({source,...row})=>row)},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};}};
    await preparePlayerSuggestions(store,generation,model);
    expect(payload).toMatchObject({cards:[{id:card,kind:'social'},{id:secondCard,kind:'beverage',displayName:'Juniper tonic',qualityIndex:3}],guests:[{id:npc,context:{recentTurns:['Mara mentioned the rain.']}},{id:secondNpc}],history:context.history,knowledge:rich.knowledge});
  });

  it('stores editable fallback coverage on timeout, without retrying another generation',async()=>{
    let saved:unknown=null; const calls={count:0};
    const store={get:async()=>saved,context:async()=>context,upsert:async (_id:string,status:string,suggestions:unknown[])=>saved={generationId:generation,status,suggestions}};
    const failing:DialogueProvider={async generate(){calls.count++; throw new Error('timeout');}};
    const result=await preparePlayerSuggestions(store,generation,failing,1000);
    expect(result.status).toBe('fallback');
    expect(result.suggestions).toHaveLength(4);
    expect(result.suggestions.every(row=>row.source==='fallback')).toBe(true);
    expect(calls.count).toBe(1);
  });

  it('bounds a provider that ignores abort signals and persists fallbacks',async()=>{
    let saved:unknown=null;
    const store={get:async()=>saved,context:async()=>context,upsert:async (_id:string,status:string,suggestions:unknown[])=>saved={generationId:generation,status,suggestions}};
    const hung:DialogueProvider={async generate(){ return await new Promise<any>(()=>{}); }};
    await expect(preparePlayerSuggestions(store,generation,hung,1)).resolves.toMatchObject({status:'fallback'});
  });

  it('makes a follower return the persisted fallback after an abandoned claim without a second model call',async()=>{
    const fallback={generationId:generation,status:'fallback' as const,suggestions:fallbackPlayerSuggestions(context)};
    let finalized=0;
    const store={
      claim:async()=>({claimed:false,status:'generating',batch:{status:'generating'}}),
      context:async()=>context,
      get:async()=>({generationId:generation,status:'generating',suggestions:[]}),
      upsert:async()=>fallback,
      finalizeFallback:async()=>{finalized++;return fallback;}
    };
    const calls={count:0};
    const result=await preparePlayerSuggestions(store,generation,provider({},calls),1);
    expect(result).toEqual(fallback);
    expect(calls.count).toBe(0);
    expect(finalized).toBe(1);
  });
});
