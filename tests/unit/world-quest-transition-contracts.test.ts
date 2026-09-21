import { describe, expect, it } from 'vitest';
import {
  canonicalizeQuestTransitionProposal,
  parseQuestTransitionCriticDecision,
  parseQuestTransitionProposal,
  validateQuestTransitionProposal,
  type QuestTransitionValidationContext
} from '../../src/lib/game/evolving-world/quest-transition-contracts';

const resident = '11111111-1111-4111-8111-111111111111';
const otherResident = '22222222-2222-4222-8222-222222222222';
const context: QuestTransitionValidationContext = {
  terminalEventId: 'terminal-event-1', residentId: resident, frozenTargetRefs: ['millhaven', 'northern-pass', resident],
  capabilities: { actions: ['prepare', 'attempt', 'wait'], approaches: ['scouting', 'diplomacy'], allowGeneratedSuccessor: true, allowDeparture: true },
  otherResidentIds: [otherResident]
};
const plan = [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }];
const successor = () => ({ version: 'quest-transition-v1', kind: 'successor', terminalEventId: 'terminal-event-1', title: 'The northern trail', objective: 'Find the signal beyond the pass.', motivation: 'The trail may explain the missing supplies.', constraints: ['Keep the village informed.'], targetRefs: ['millhaven', 'northern-pass'], difficulty: 2, plan });
const departure = () => ({ version: 'quest-transition-v1', kind: 'departure', terminalEventId: 'terminal-event-1', privateRationale: 'The road calls me onward.', farewellText: 'Keep the hearth warm.', publicNews: 'The ranger leaves Millhaven for the northern road.' });

describe('quest transition contracts', () => {
  it('parses valid successor and departure branches after the authored branch is exhausted', () => {
    expect(parseQuestTransitionProposal(successor(), context)).toMatchObject({ ok: true, value: { kind: 'successor', difficulty: 2 } });
    expect(parseQuestTransitionProposal(departure(), context)).toMatchObject({ ok: true, value: { kind: 'departure' } });
  });

  it('permits only the exact frozen authored milestone when one is present', () => {
    const authored = { version: 'quest-transition-v1', kind: 'next_authored_milestone', terminalEventId: 'terminal-event-1', milestoneId: 'milestone-2', plan };
    const frozen = { ...context, nextAuthoredMilestone: { id: 'milestone-2' } };
    expect(parseQuestTransitionProposal(authored, frozen)).toMatchObject({ ok: true, value: { kind: 'next_authored_milestone' } });
    expect(validateQuestTransitionProposal(successor(), frozen)).not.toEqual([]);
    expect(parseQuestTransitionProposal({ ...authored, plan: [{ action: 'wait', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }] }, frozen)).toMatchObject({ ok: true });
  });

  it('rejects an early generated successor or departure and malformed plans or targets', () => {
    const frozen = { ...context, nextAuthoredMilestone: { id: 'milestone-2' } };
    expect(validateQuestTransitionProposal(successor(), frozen)).not.toEqual([]);
    expect(validateQuestTransitionProposal(departure(), frozen)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...successor(), plan: [] }, context)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...successor(), plan: [{ action: 'attempt', approach: 'scouting' }, { action: 'wait', approach: 'scouting' }] }, context)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...successor(), plan: [{ action: 'prepare', approach: 'scouting' }] }, context)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...successor(), targetRefs: ['unknown'] }, context)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...successor(), terminalEventId: 'other-event' }, context)).not.toEqual([]);
  });

  it('rejects death language and another resident from a departure', () => {
    expect(validateQuestTransitionProposal({ ...departure(), privateRationale: 'The ranger died on the road.' }, context)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...departure(), publicNews: `The ranger and ${otherResident} leave together.` }, context)).not.toEqual([]);
    expect(validateQuestTransitionProposal({ ...departure(), targetResidentId: otherResident }, context)).not.toEqual([]);
  });

  it('admits only bounded allow-listed critic repair instructions', () => {
    expect(parseQuestTransitionCriticDecision({ decision: 'accept', instructions: [] })).toEqual({ decision: 'accept', instructions: [] });
    expect(parseQuestTransitionCriticDecision({ decision: 'repair', instructions: [{ code: 'target_frozen', path: 'targetRefs' }, { code: 'plan_shape', path: 'plan' }] })).toEqual({ decision: 'repair', instructions: [{ code: 'target_frozen', path: 'targetRefs' }, { code: 'plan_shape', path: 'plan' }] });
    expect(parseQuestTransitionCriticDecision({ decision: 'repair', instructions: [{ code: 'author_fidelity', path: 'authorGoal' }, { code: 'character_boundary', path: 'characterBoundary' }, { code: 'causal_continuity', path: 'causalContinuity' }] })).toMatchObject({ decision: 'repair' });
    expect(parseQuestTransitionCriticDecision({ decision: 'repair', instructions: [{ code: 'author_fidelity', path: 'plan' }] })).toBeNull();
    expect(parseQuestTransitionCriticDecision({ decision: 'repair', instructions: [{ code: 'causal_continuity', path: 'authorGoal' }] })).toBeNull();
    expect(parseQuestTransitionCriticDecision({ decision: 'repair', instructions: [{ code: 'arbitrary', path: 'proposal' }] })).toBeNull();
    expect(parseQuestTransitionCriticDecision({ decision: 'reject', instructions: [{ code: 'plan_shape', path: 'plan' }] })).toBeNull();
  });

  it('canonicalizes equivalent valid proposals identically', () => {
    const reordered = { difficulty: 2, constraints: ['Keep the village informed.'], plan: [{ approach: 'scouting', action: 'prepare' }, { approach: 'scouting', action: 'attempt' }], targetRefs: ['millhaven', 'northern-pass'], motivation: ' The trail may explain the missing supplies. ', title: ' The northern trail ', objective: ' Find the signal beyond the pass. ', terminalEventId: 'terminal-event-1', kind: 'successor', version: 'quest-transition-v1' };
    expect(canonicalizeQuestTransitionProposal(successor(), context)).toBe(canonicalizeQuestTransitionProposal(reordered, context));
  });
});
