import { describe, expect, it } from 'vitest';
import {
  canonicalizeWorldCanonEventProposal,
  fingerprintWorldCanonEventProposal,
  parsePublicWorldCanonEventSummary,
  parseWorldCanonEventProposal,
  toPublicWorldCanonEventSummary,
  validateWorldCanonEventProposal,
  type WorldCanonEventValidationContext
} from '../../src/lib/game/evolving-world';

const context: WorldCanonEventValidationContext={
  entityKinds:{ lira:'npc', millhaven:'location', guild:'faction', herb:'item', recipe:'recipe', oldEvent:'world_event' },
  activeGeneratedEntityCount:149
};
const proposal=()=>({
  version:'world-canon-event-v1',kind:'world_event',templateKey:'market-day',participantEntityIds:['lira','millhaven'],
  title:'Market day reaches Millhaven',summary:'Travelers gather at the mill road market.',reuseKey:'millhaven-market-day',
  payload:{template:'market-day',participants:['lira','millhaven'],visibility:'public'}
});

describe('world canon event contracts',()=>{
  it('accepts one registered public event and projects a safe summary',()=>{
    const parsed=parseWorldCanonEventProposal(proposal(),context);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const summary=toPublicWorldCanonEventSummary(parsed.value);
    expect(summary).not.toHaveProperty('payload');
    expect(parsePublicWorldCanonEventSummary(summary)).toEqual({ok:true,value:summary});
  });
  it('canonicalizes equivalent key ordering and fingerprints it deterministically',async()=>{
    const first=proposal();
    const reordered={ payload:{visibility:'public',participants:['lira','millhaven'],template:'market-day'}, summary:first.summary,title:first.title,
      participantEntityIds:first.participantEntityIds,templateKey:first.templateKey,kind:'world_event',version:'world-canon-event-v1',reuseKey:first.reuseKey };
    expect(canonicalizeWorldCanonEventProposal(first,context)).toBe(canonicalizeWorldCanonEventProposal(reordered,context));
    expect(await fingerprintWorldCanonEventProposal(first,context)).toBe(await fingerprintWorldCanonEventProposal(reordered,context));
  });
  it('rejects unregistered, oversized, unsafe, non-public, and cross-shape proposals',()=>{
    const cases=[
      {...proposal(),templateKey:'invented'},
      {...proposal(),kind:'create_entity'},
      {...proposal(),title:'x'.repeat(121)},
      {...proposal(),summary:'x'.repeat(501)},
      {...proposal(),payload:{template:'market-day',participants:['lira'],visibility:'public'}},
      {...proposal(),payload:{template:'market-day',participants:['lira','millhaven'],visibility:'private'}},
      {...proposal(),payload:{template:'market-day',participants:['lira','millhaven'],visibility:'public',script:'no'}},
      {...proposal(),script:'no'},
      {...proposal(),participantEntityIds:['lira','lira']},
      {...proposal(),participantEntityIds:[]},
      {...proposal(),participantEntityIds:['lira','millhaven','guild','herb','oldEvent','lira-2','lira-3','lira-4','lira-5']},
      {...proposal(),participantEntityIds:['unknown'],payload:{template:'market-day',participants:['unknown'],visibility:'public'}}
    ];
    for(const candidate of cases) expect(validateWorldCanonEventProposal(candidate,context)).not.toEqual([]);
    expect(validateWorldCanonEventProposal(proposal(),{...context,activeGeneratedEntityCount:150})).not.toEqual([]);
    expect(validateWorldCanonEventProposal(proposal(),{...context,activeGeneratedEntityCount:151})).not.toEqual([]);
    expect(validateWorldCanonEventProposal({...proposal(),participantEntityIds:['recipe'],payload:{template:'market-day',participants:['recipe'],visibility:'public'}},context)).not.toEqual([]);
  });
  it('allows a full registry only when the context proves the reuse target already exists',()=>{
    const atCapacity={...context,activeGeneratedEntityCount:150};
    expect(validateWorldCanonEventProposal(proposal(),atCapacity)).not.toEqual([]);
    expect(validateWorldCanonEventProposal(proposal(),{
      ...atCapacity,existingPublicEventReuseKeys:['millhaven-market-day']
    })).toEqual([]);
    expect(validateWorldCanonEventProposal({...proposal(),reuseKey:'other-event'}, {
      ...atCapacity,existingPublicEventReuseKeys:['millhaven-market-day']
    })).not.toEqual([]);
  });
  it('rejects extra and unsafe public-summary fields',()=>{
    const parsed=parseWorldCanonEventProposal(proposal(),context);
    if (!parsed.ok) throw new Error('fixture failed');
    const summary=toPublicWorldCanonEventSummary(parsed.value);
    expect(parsePublicWorldCanonEventSummary({...summary,payload:proposal().payload}).ok).toBe(false);
    expect(parsePublicWorldCanonEventSummary({...summary,code:'no'}).ok).toBe(false);
    expect(parsePublicWorldCanonEventSummary({...summary,participantEntityIds:['lira','lira']}).ok).toBe(false);
  });
});
