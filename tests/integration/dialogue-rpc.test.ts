import { afterEach, describe, expect, it } from 'vitest';
import { createTestPlayer } from '../helpers/local-supabase';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';
import type { DialogueInput } from '../../src/lib/game/dialogue';
const players:Array<Awaited<ReturnType<typeof createTestPlayer>>>=[];
afterEach(async()=>{for(const p of players.splice(0))expect((await p.admin.auth.admin.deleteUser(p.userId)).error).toBeNull();});
async function player(prefix:string){const p=await createTestPlayer(prefix);players.push(p);expect((await p.client.rpc('create_tavern')).error).toBeNull();return p;}
const input=(message='How is the quest going?'):DialogueInput=>({turnId:crypto.randomUUID(),patronKey:'lira',message,expectedConversationSequence:0});
describe('adaptive dialogue',()=>{
  it('investigates adaptively, reviews a rewrite, remembers attribution, and replays once',async()=>{
    const p=await player('dialogue'); const f=fixtureProvider({secondInvestigation:true,rewrite:true});const command=input('I thank you and advise you to scout, then negotiate.');
    const r=await runDialogue(p.admin,p.userId,command,f);
    expect(r.status).toBe('completed');expect(f.stages).toEqual(['investigate','investigate','deliberate','speak','review','speak','review','remember']);
    expect((r.result as any).relationship).toBe(47);
    const replay=await runDialogue(p.admin,p.userId,command,fixtureProvider({failStage:'investigate'}));expect(replay).toEqual(r);
    const journal=(await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any;
    expect(journal.sequence).toBe(1);expect(journal.turns).toHaveLength(1);expect(journal.intention.steps[1].approach).toBe('diplomacy');
    const memories=(await p.admin.rpc('dialogue_context',{p_actor:p.userId,p_turn:command.turnId,p_category:'memories'})).data as any[];
    expect(memories).toHaveLength(1);expect(memories[0].kind).toBe('keeper_claim');expect(memories[0].quote).toBe(command.message);
  });
  it('rejects invented plans and keeps ordinary dialogue out of save revisions',async()=>{
    const p=await player('dialogue-plan');const f=fixtureProvider({badPlan:true});const command=input('I advise an attack on a place you have never heard of.');
    const r=await runDialogue(p.admin,p.userId,command,f);expect((r.result as any).intention).toBeNull();expect((r.result as any).reply).toContain('clearer plan');
    expect((r.result as any).committedRevision).toBe(0);
  });
  it('commits hospitality with a turn once and supports failed-stage resume',async()=>{
    const p=await createBrewedTavern('dialogue-drink');players.push(p);
    const stock=(await p.client.rpc('get_bar_snapshot')).data as any;
    const command={...input(),beverageId:stock.beverages[0].id,cardId:stock.cards[0].id};
    await expect(runDialogue(p.admin,p.userId,command,fixtureProvider({failStage:'speak'}))).rejects.toThrow();
    expect(((await p.client.rpc('get_bar_snapshot')).data as any).beverages).toHaveLength(1);
    const f=fixtureProvider();const r=await runDialogue(p.admin,p.userId,command,f);expect(f.stages).not.toContain('investigate');
    expect((r.result as any).serving.goldEarned).toBe(90);
    const stockAfter=(await p.client.rpc('get_bar_snapshot')).data as any;
    expect(stockAfter.beverages).toHaveLength(0);expect(stockAfter.cards).toHaveLength(0);expect(stockAfter.history).toHaveLength(1);
  });
  it('isolates private sheets, claims, turns and completion from other players',async()=>{
    const a=await player('dialogue-owner'),b=await player('dialogue-foreign');const command=input('I thank you for your courage.');
    await runDialogue(a.admin,a.userId,command,fixtureProvider());
    expect((await b.client.rpc('dialogue_status',{p_turn:command.turnId})).error?.code).toBe('PT404');
    expect((await a.client.rpc('dialogue_complete',{p_actor:a.userId,p_turn:command.turnId,p_fence:crypto.randomUUID()})).error).not.toBeNull();
    expect((await a.client.from('dialogue_turns').select('*')).error).not.toBeNull();
    expect((await a.client.from('patron_catalog').select('*')).error).not.toBeNull();
    const context=(await a.admin.rpc('dialogue_context',{p_actor:a.userId,p_turn:command.turnId,p_category:'history'})).data;
    expect(JSON.stringify(context)).not.toContain('ignoring a warning');
    expect(((await b.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any).turns).toHaveLength(0);
  });
  it('blocks day end during a live turn and rejects a fenced late completion after cancellation',async()=>{
    const p=await player('dialogue-cancel');const command=input();
    const began=await p.admin.rpc('dialogue_begin',{p_actor:p.userId,p_turn:command.turnId,p_patron:'lira',p_message:command.message,p_sequence:0});expect(began.error).toBeNull();
    const snapshot=(await p.client.rpc('get_tavern_snapshot')).data as any;
    const day={p_save_id:snapshot.save.id,p_action_id:crypto.randomUUID(),p_expected_revision:0};
    expect((await p.client.rpc('advance_tavern_day',day)).error?.code).toBe('PT409');
    expect((await p.client.rpc('dialogue_status',{p_turn:command.turnId,p_cancel:true})).error).toBeNull();
    expect((await p.admin.rpc('dialogue_complete',{p_actor:p.userId,p_turn:command.turnId,p_fence:(began.data as any).fence})).error?.code).toBe('PT409');
    const ended=await p.client.rpc('advance_tavern_day',day);expect(ended.error).toBeNull();expect((ended.data as any).events).toHaveLength(2);
    expect((await p.client.rpc('advance_tavern_day',day)).data).toEqual(ended.data);
  });
  it('deduplicates social subjects and caps daily positive reactions',async()=>{
    const p=await player('dialogue-trust');
    for(let seq=0;seq<3;seq++)await runDialogue(p.admin,p.userId,{...input('I thank you, my friend.'),expectedConversationSequence:seq},fixtureProvider());
    const snapshot=(await p.client.rpc('get_bar_snapshot')).data as any;
    expect(snapshot.patrons.find((x:any)=>x.key==='lira').relationship).toBe(47);
  });
  it('uses a short informational path and persists the evidence used for an older promise',async()=>{
    const p=await player('dialogue-evidence');
    const first=input('I thank you and promise to listen when you return.');
    await runDialogue(p.admin,p.userId,first,fixtureProvider());
    for(let seq=1;seq<=6;seq++) {
      // Move fixture timestamps outside the rate window; production limits are covered in SQL.
      await p.admin.from('dialogue_turns').update({created_at:new Date(Date.now()-120000).toISOString()}).eq('actor_id',p.userId);
      const f=fixtureProvider();
      await runDialogue(p.admin,p.userId,{...input('How is the quest going?'),expectedConversationSequence:seq},f);
      expect(f.stages).toEqual(['investigate','speak','review']);
    }
    await p.admin.from('dialogue_turns').update({created_at:new Date(Date.now()-120000).toISOString()}).eq('actor_id',p.userId);
    const last={...input('What did I promise?'),expectedConversationSequence:7};
    await runDialogue(p.admin,p.userId,last,fixtureProvider({secondInvestigation:true}));
    const stored=(await p.admin.from('dialogue_turns').select('checkpoints').eq('id',last.turnId).single()).data!.checkpoints as any;
    expect(stored.base.value.recent).toHaveLength(6);
    expect(stored.base.value.recent.map((x:any)=>x.id)).not.toContain(first.turnId);
    expect(stored.context1.value[0].sourceIds).toHaveLength(1);
    expect(stored.context1.value[0].data[0].sourceTurn).toBe(first.turnId);
    expect(stored.decision.ruleVersion).toBe('npc-rules-v1');
    expect(stored.decision.validated).toBe(true);
  },30000);
  it('rejects a generation made stale by a competing pour without duplicating payment',async()=>{
    const p=await createBrewedTavern('dialogue-competing');players.push(p);
    const stock=(await p.client.rpc('get_bar_snapshot')).data as any;
    const command={...input(),beverageId:stock.beverages[0].id,cardId:stock.cards[0].id};
    const f=fixtureProvider();
    await expect(runDialogue(p.admin,p.userId,command,{async generate(stage,payload,signal){
      const output=await f.generate(stage,payload,signal);
      if(stage==='review')expect((await p.client.rpc('serve_beverage',{
        p_save_id:p.saveId,p_patron_key:'torvin',p_beverage_id:command.beverageId,p_card_id:command.cardId,
        p_action_id:crypto.randomUUID(),p_expected_revision:3
      })).error).toBeNull();
      return output;
    }})).rejects.toMatchObject({code:'STATE_CHANGED'});
    const after=(await p.client.rpc('get_bar_snapshot')).data as any;
    expect(after.history).toHaveLength(1);expect(after.save.gold).toBe(80);
    expect(((await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any).sequence).toBe(0);
  });
  it('aborts on deadline and resumes safely from recorded stages',async()=>{
    const p=await player('dialogue-deadline');const command=input();
    await expect(runDialogue(p.admin,p.userId,command,{async generate(_stage,_payload,signal){
      await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      throw new Error('unreachable');
    }},{deadlineMs:1000})).rejects.toMatchObject({status:503});
    expect(((await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any).sequence).toBe(0);
    expect((await runDialogue(p.admin,p.userId,command,fixtureProvider())).status).toBe('completed');
    expect((await p.admin.from('dialogue_turns').select('calls').eq('id',command.turnId).single()).data?.calls).toBe(4);
  });
  it('allows only one concurrent generation and fences expired attempts',async()=>{
    const p=await player('dialogue-lease');const command=input();
    const args={p_actor:p.userId,p_turn:command.turnId,p_patron:'lira',p_message:command.message,p_sequence:0};
    const beginnings=await Promise.all([p.admin.rpc('dialogue_begin',args),p.admin.rpc('dialogue_begin',args)]);
    expect(beginnings.every(x=>!x.error)).toBe(true);
    expect(beginnings.filter(x=>(x.data as any).busy)).toHaveLength(1);
    const oldFence=(beginnings[0].data as any).fence;
    await p.admin.from('dialogue_turns').update({lease_until:new Date(Date.now()-1000).toISOString()}).eq('id',command.turnId);
    const newer=await p.admin.rpc('dialogue_begin',args);expect(newer.error).toBeNull();
    expect((newer.data as any).fence).not.toBe(oldFence);
    expect((await p.admin.rpc('dialogue_checkpoint',{p_actor:p.userId,p_turn:command.turnId,p_fence:oldFence,p_stage:'speak',p_value:{value:{text:'Late fabricated reply'}}})).error?.code).toBe('PT409');
    expect((await p.client.rpc('dialogue_status',{p_turn:command.turnId,p_cancel:true})).error).toBeNull();
  });
  it('supports disagreement and rejects an exchange that still fails review after rewriting',async()=>{
    const p=await player('dialogue-refusal');
    const before=(await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any;
    const refused=await runDialogue(p.admin,p.userId,input('I advise you to attack recklessly.'),fixtureProvider({refuse:true}));
    expect((refused.result as any).reply).toContain('will not adopt');
    expect((refused.result as any).intention).toBeNull();
    expect(((await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any).intention).toEqual(before.intention);
    const f=fixtureProvider({rejectEveryReview:true});
    const rejected={...input(),expectedConversationSequence:1};
    await expect(runDialogue(p.admin,p.userId,rejected,f)).rejects.toMatchObject({code:'CONSISTENCY'});
    expect((await p.client.rpc('dialogue_status',{p_turn:rejected.turnId})).data).toMatchObject({status:'failed',error:'CONSISTENCY',canRetry:false});
    expect(f.stages).toEqual(['investigate','speak','review','speak','review']);
    expect(((await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any).sequence).toBe(1);
    const snapshot=(await p.client.rpc('get_tavern_snapshot')).data as any;
    expect((await p.client.rpc('advance_tavern_day',{p_save_id:snapshot.save.id,p_action_id:crypto.randomUUID(),p_expected_revision:snapshot.save.revision})).error).toBeNull();
  });
  it('recovers a reservation whose database response was lost before the fence was received',async()=>{
    const p=await player('dialogue-reservation');const command=input();const f=fixtureProvider();
    const uncertain={rpc(name:string,args:any){return {async abortSignal(){
      const response=await p.admin.rpc(name as any,args);
      if(name==='dialogue_begin'&&!response.error)return {data:null,error:{code:'',message:'Injected response loss'}};
      return response;
    }};}} as unknown as typeof p.admin;
    await expect(runDialogue(uncertain,p.userId,command,f)).rejects.toMatchObject({status:500});
    expect(f.stages).toHaveLength(0);
    expect(((await p.client.rpc('dialogue_status',{p_turn:command.turnId})).data as any).status).toBe('processing');
    expect((await runDialogue(p.admin,p.userId,command,f)).status).toBe('processing');
    expect((await p.client.rpc('dialogue_status',{p_turn:command.turnId,p_cancel:true})).error).toBeNull();
    expect(((await p.client.rpc('get_npc_journal',{p_patron:'lira'})).data as any).sequence).toBe(0);
  });
  it('distinguishes exhausted unfinished work from a fully checkpointed turn needing only commit',async()=>{
    for(const completeStages of [false,true]) {
      const p=await player('dialogue-budget-status');const command=input('I thank you and advise you to scout, then negotiate.');
      const client={rpc(name:string,args:any){return {async abortSignal(){
        if(name==='dialogue_complete')return {data:null,error:{code:'PT503',message:'Injected completion outage'}};
        return p.admin.rpc(name as any,args);
      }};}} as unknown as typeof p.admin;
      await expect(runDialogue(client,p.userId,command,fixtureProvider({secondInvestigation:true,rewrite:true,failStage:completeStages?undefined:'remember'}))).rejects.toThrow();
      expect((await p.client.rpc('dialogue_status',{p_turn:command.turnId})).data).toMatchObject({status:'failed',canRetry:completeStages});
      if(completeStages) {
        const provider=fixtureProvider({failStage:'investigate'});
        expect((await runDialogue(p.admin,p.userId,command,provider)).status).toBe('completed');
        expect(provider.stages).toHaveLength(0);
        expect((await p.client.rpc('dialogue_status',{p_turn:command.turnId,p_cancel:true})).data).toMatchObject({status:'completed',canRetry:false});
      }
    }
  });

  it('preserves long recent promises and checkpoints one evidence window for speech and review',async()=>{
    const p=await player('dialogue-whole-context');
    const promise='I have a long story to tell. '.repeat(65)+'I promise to listen when you return.';
    await runDialogue(p.admin,p.userId,input(promise),fixtureProvider());
    const command={...input('I thank you and advise you to scout, then negotiate.'),expectedConversationSequence:1};
    await expect(runDialogue(p.admin,p.userId,command,fixtureProvider({secondInvestigation:true,failStage:'speak'}))).rejects.toThrow();
    const stored=(await p.admin.from('dialogue_turns').select('checkpoints').eq('id',command.turnId).single()).data!.checkpoints as any;
    const window=stored.decision.contextWindow;
    expect(window.base.recent[0].keeper).toBe(promise);
    expect(window.coverage.version).toBe('npc-context-v1');
    const seen:any[]=[];const f=fixtureProvider();
    await runDialogue(p.admin,p.userId,command,{async generate(stage,payload:any,signal){
      if(stage==='speak'||stage==='review')seen.push(structuredClone(payload));
      return f.generate(stage,payload,signal);
    }});
    expect(seen).toHaveLength(2);
    for(const payload of seen) {
      expect(payload.base).toEqual(window.base);expect(payload.context).toEqual(window.context);
      expect(payload.coverage).toEqual(window.coverage);
      expect(payload.base.intention.steps[1].approach).toBe('combat');
      expect(payload.effectiveIntention.steps[1].approach).toBe('diplomacy');
      expect(payload.effectiveIntention).toEqual(stored.decision.value.intention);
    }
    expect(f.stages).not.toContain('deliberate');
    const final=(await p.admin.from('dialogue_turns').select('checkpoints').eq('id',command.turnId).single()).data!.checkpoints as any;
    expect(final.speak.inputContext.contextFingerprint).toBe(final.deliberate.inputContext.contextFingerprint);
    expect(final.review.inputContext).toMatchObject({contextFingerprint:final.speak.inputContext.contextFingerprint,contextVersion:'npc-context-v1'});
    expect(final.review.inputContext.characters).toBeLessThanOrEqual(40000);
  });
  it('fails oversized mandatory context before a provider charge and keeps day advancement available',async()=>{
    const p=await createBrewedTavern('dialogue-oversized');players.push(p);
    const stock=(await p.client.rpc('get_bar_snapshot')).data as any;
    const command={...input(),beverageId:stock.beverages[0].id,cardId:stock.cards[0].id};
    const client={rpc(name:string,args:any){return {async abortSignal(){
      const response=await p.admin.rpc(name as any,args);
      if(name==='dialogue_context'&&args.p_category==='base'&&!response.error)
        return {...response,data:{...response.data as any,personality:{voice:'x'.repeat(40000)}}};
      return response;
    }};}} as unknown as typeof p.admin;
    const f=fixtureProvider();
    await expect(runDialogue(client,p.userId,command,f)).rejects.toMatchObject({code:'CONTEXT_BUDGET'});
    expect(f.stages).toHaveLength(0);
    expect((await p.client.rpc('dialogue_status',{p_turn:command.turnId})).data).toMatchObject({status:'failed',error:'CONTEXT_BUDGET',canRetry:false});
    expect((await p.admin.from('dialogue_turns').select('calls').eq('id',command.turnId).single()).data?.calls).toBe(0);
    const after=(await p.client.rpc('get_bar_snapshot')).data as any;
    expect(after.beverages).toHaveLength(1);expect(after.cards).toHaveLength(1);expect(after.history).toHaveLength(0);
    const snapshot=(await p.client.rpc('get_tavern_snapshot')).data as any;
    expect((await p.client.rpc('advance_tavern_day',{p_save_id:snapshot.save.id,p_action_id:crypto.randomUUID(),p_expected_revision:snapshot.save.revision})).error).toBeNull();
  });
  it('does not repeat an already checkpointed context request after investigation resumes',async()=>{
    const p=await player('dialogue-resumed-tools');const command=input();let questReads=0;
    const client={rpc(name:string,args:any){if(name==='dialogue_context'&&args.p_category==='quests')questReads++;return p.admin.rpc(name as any,args);}} as unknown as typeof p.admin;
    let investigations=0;let fail=true;const f=fixtureProvider({secondInvestigation:true});
    const provider={async generate(stage:any,payload:any,signal:AbortSignal) {
      if(stage==='investigate'&&++investigations===2&&fail)throw new Error('Injected second investigation outage');
      const result=await f.generate(stage,payload,signal);
      if(stage==='investigate')result.value={...result.value as any,requests:[{category:'quests',query:'current objective'}]};
      return result;
    }};
    await expect(runDialogue(client,p.userId,command,provider)).rejects.toThrow();
    fail=false;
    expect((await runDialogue(client,p.userId,command,provider)).status).toBe('completed');
    expect(questReads).toBe(1);
    const stored=(await p.admin.from('dialogue_turns').select('checkpoints').eq('id',command.turnId).single()).data!.checkpoints as any;
    expect(stored.context1.value).toEqual([]);
    expect(stored.decision.contextWindow.context).toHaveLength(1);
  });

});
