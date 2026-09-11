import { describe, expect, it } from 'vitest';
import { parseStartBrewReceipt } from '../../src/lib/game/contracts';

const receipt = {
  actionId: 'action',
  sessionId: 'session',
  ingredientBatchId: 'ingredient',
  startedAt: '2026-09-10T00:00:00.000Z',
  committedRevision: 2,
  dayNumber: 1
};

describe('Brewery contracts', () => {
  it('accepts guide-v2 timing and normalizes historical receipts', () => {
    expect(parseStartBrewReceipt({
      ...receipt, durationSeconds: 15, countdownSeconds: 2, stirRulesVersion: 'guide-v2'
    })).toMatchObject({ durationSeconds: 15, countdownSeconds: 2, stirRulesVersion: 'guide-v2' });
    expect(parseStartBrewReceipt({
      ...receipt, durationSeconds: 30
    })).toMatchObject({ durationSeconds: 30, countdownSeconds: 0, stirRulesVersion: 'rpm-v1' });
  });

  it('rejects unknown rules and mismatched timing', () => {
    expect(() => parseStartBrewReceipt({
      ...receipt, durationSeconds: 30, countdownSeconds: 0, stirRulesVersion: 'unknown'
    })).toThrow('Invalid start brew receipt');
    expect(() => parseStartBrewReceipt({
      ...receipt, durationSeconds: 15, countdownSeconds: 0, stirRulesVersion: 'guide-v2'
    })).toThrow('Invalid start brew receipt');
  });
});
