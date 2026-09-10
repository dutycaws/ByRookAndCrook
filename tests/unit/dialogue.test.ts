import { describe,it,expect } from 'vitest';
import { mergeEnvironment } from '../../scripts/environment-merge';
import { parseInput,validateDecision } from '../../src/lib/server/dialogue/orchestrator';
import { createProvider } from '../../src/lib/server/dialogue/provider';
describe('dialogue boundaries',()=>{
  it('preserves custom environment configuration and multiline values',()=>{
    const original='OPENAI_API_KEY="test-only-placeholder"\nCUSTOM="first\nsecond"\nPUBLIC_SUPABASE_URL=old\n';
    const result=mergeEnvironment(original,{PUBLIC_SUPABASE_URL:'http://127.0.0.1:57321'});
    expect(result).toContain('OPENAI_API_KEY="test-only-placeholder"');expect(result).toContain('CUSTOM="first\nsecond"');expect(result).not.toContain('=old');
  });
  it('accepts intent and hospitality independently and validates message/sequence',()=>{
    const input={turnId:crypto.randomUUID(),patronKey:'lira' as const,message:'Hello',expectedConversationSequence:0,interactionVersion:'dialogue-v2' as const};
    expect(parseInput(input)).toMatchObject({intentCardId:null,offering:null});
    expect(parseInput({...input,intentCardId:crypto.randomUUID()}).offering).toBeNull();
    expect(parseInput({...input,offering:{kind:'beverage',itemId:crypto.randomUUID()}}).intentCardId).toBeNull();
    expect(()=>parseInput({...input,offering:{kind:'invalid',itemId:crypto.randomUUID()}})).toThrow();
    expect(()=>parseInput({...input,message:' '.repeat(2001)})).toThrow();
  });
  it('removes unsupported effects and requires quoted player evidence',()=>{
    const base={questStatus:'active',allowedTargets:['millhaven']};
    const d={stance:'agree',reaction:1,subject:'quest',evidence:'invented quote',intention:null};
    expect(validateDecision(d,base,'hello').reaction).toBe(0);
    expect(validateDecision({...d,gold:1000},base,'hello').stance).toBe('clarify');
  });
  it('requires the only terminal action to be the last daily step',()=>{
    const base={questStatus:'active',allowedTargets:['millhaven']};
    const proposal={stance:'agree',reaction:0,subject:'quest',evidence:'',intention:{goal:'Guard Millhaven',motivation:'Protect travelers',targets:['millhaven'],steps:[] as any[]}};
    for(const actions of [['attempt','prepare','attempt'],['abandon','attempt'],['prepare'],['wait']]) {
      proposal.intention.steps=actions.map(action=>({action,approach:'scouting'}));
      expect(validateDecision(proposal,base,'Please consider this plan.').stance).toBe('clarify');
      expect(validateDecision(proposal,base,'Please consider this plan.').intention).toBeNull();
    }
    for(const actions of [['attempt'],['abandon'],['prepare','wait','attempt'],['prepare','abandon']]) {
      proposal.intention.steps=actions.map(action=>({action,approach:'scouting'}));
      expect(validateDecision(proposal,base,'Please consider this plan.').intention).toEqual(proposal.intention);
    }
  });
  it('local mode never falls back to a hosted provider',async()=>{
    await expect(createProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test-only-placeholder'}).generate('speak',{},new AbortController().signal)).rejects.toThrow('not implemented');
  });
});
