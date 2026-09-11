import { describe, expect, it } from 'vitest';
import {
  parseApiaryCommandPreview,
  parseApiaryCommandReceipt,
  parseGardenCommandPreview,
  parseGardenCommandReceipt,
  parseStartBrewReceipt
} from '../../src/lib/game/contracts';

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

describe('Garden command contracts', () => {
  it('accepts authoritative receipts and read-only previews', () => {
    expect(parseGardenCommandReceipt({
      actionId: 'garden-action',
      commandKind: 'water',
      committedRevision: 7,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: { cellIds: ['cell-b', 'cell-a'], dose: 12 },
      result: { wateredCount: 2 }
    })).toMatchObject({
      actionId: 'garden-action',
      commandKind: 'water',
      committedRevision: 7
    });

    expect(parseGardenCommandPreview({
      commandKind: 'amend',
      basedOnRevision: 6,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: { cellIds: ['cell-a'], itemKey: 'compost', dose: 1 },
      canCommit: true,
      predictions: [{ cellId: 'cell-a', nitrogenAfter: 54 }]
    })).toMatchObject({ commandKind: 'amend', basedOnRevision: 6, canCommit: true });
  });

  it('rejects malformed receipts and previews', () => {
    expect(() => parseGardenCommandReceipt({
      actionId: 'garden-action',
      commandKind: 'invent',
      committedRevision: 1,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: {},
      result: {}
    })).toThrow('Invalid garden command receipt');
    expect(() => parseGardenCommandReceipt({
      actionId: 'garden-action',
      commandKind: 'plant',
      committedRevision: 1.5,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: {},
      result: {}
    })).toThrow('Invalid garden command receipt');
    expect(() => parseGardenCommandPreview({
      commandKind: 'water',
      basedOnRevision: '6',
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: {}
    })).toThrow('Invalid garden command preview');
  });
});

describe('Apiary command contracts', () => {
  it('accepts authoritative receipts and previews', () => {
    expect(parseApiaryCommandReceipt({
      actionId: 'apiary-action',
      commandKind: 'extract_honey',
      committedRevision: 8,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: { colonyId: 'colony', quantity: 2 },
      result: { ingredientBatchId: 'batch' }
    })).toMatchObject({ commandKind: 'extract_honey', committedRevision: 8 });
    expect(parseApiaryCommandPreview({
      commandKind: 'feed',
      basedOnRevision: 7,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: { colonyId: 'colony', quantity: 1 },
      availableFeed: 3,
      canCommit: true
    })).toMatchObject({ commandKind: 'feed', canCommit: true });
  });

  it('rejects unsupported commands and incomplete previews', () => {
    expect(() => parseApiaryCommandReceipt({
      actionId: 'apiary-action',
      commandKind: 'sell_honey',
      committedRevision: 8,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: {},
      result: {}
    })).toThrow('Invalid apiary command receipt');
    expect(() => parseApiaryCommandPreview({
      commandKind: 'feed',
      basedOnRevision: 7,
      rulesVersion: 'garden-apiary-v1',
      normalizedPayload: {}
    })).toThrow('Invalid apiary command preview');
  });
});
