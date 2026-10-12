import { describe, expect, it } from 'vitest';
import { isApologyOnlyMessage, isEmptySocialTurn, relationshipStageFor } from '../../src/lib/game/relationships';

describe('relationship stages', () => {
  it('maps every cutoff to one of the five named stages', () => {
    expect([0, 24, 25, 49, 50, 64, 65, 79, 80, 100].map(relationshipStageFor)).toEqual([
      'strained', 'strained',
      'acquaintance', 'acquaintance',
      'familiar', 'familiar',
      'trusted', 'trusted',
      'close', 'close'
    ]);
  });

  it('keeps the existing starting relationship score in acquaintance', () => {
    expect(relationshipStageFor(45)).toBe('acquaintance');
  });

  it('bounds internal scores before projecting a stage', () => {
    expect(relationshipStageFor(-4)).toBe('strained');
    expect(relationshipStageFor(120)).toBe('close');
  });

  it('rejects expanded apology and generic praise turns as empty social reactions', () => {
    for (const message of [
      'I’m really sorry for what I said.',
      'I regret how I acted when I left you waiting.',
      'You’re truly the best friend I ever had.'
    ]) {
      expect(isEmptySocialTurn(message)).toBe(true);
    }
    expect(isApologyOnlyMessage('I’m really sorry for what I said.')).toBe(true);
  });

  it('keeps a specific, sourceable follow-through interaction eligible when it includes an apology', () => {
    const message = 'I am truly sorry about yesterday. I set up a north road watch and escorted the injured travelers to safety.';
    expect(isEmptySocialTurn(message)).toBe(false);
    expect(isApologyOnlyMessage(message)).toBe(false);
  });
});
