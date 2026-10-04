import { describe, expect, it } from 'vitest';
import { dialogueStatusResponse } from '../../src/lib/server/dialogue/status';
import { parseInput } from '../../src/lib/server/dialogue/orchestrator';

const turnId = '10100000-0000-4000-8000-000000000001';
const npcId = '10100000-0000-4000-8000-000000000002';
const itemId = '10100000-0000-4000-8000-000000000003';

describe('dialogue status retry contract', () => {
  it.each([
    ['plain retry without hospitality', null, null],
    ['food retry', null, 'food'],
    ['drink retry', null, 'beverage']
  ] as const)('restores a valid POST input for %s', (_label, intentCardId, offeringKind) => {
    const rawRpcStatus = {
      status: 'failed',
      result: null,
      input: {
        turnId,
        npcId,
        message: 'I will bring only what I learn.',
        expectedConversationSequence: 4,
        intentCardId,
        offeringKind,
        offeringItemId: offeringKind ? itemId : null
      }
    };

    const restored = dialogueStatusResponse(rawRpcStatus) as { input: unknown };
    const retry = parseInput(restored.input);

    expect(retry).toEqual({
      turnId,
      npcId,
      message: 'I will bring only what I learn.',
      expectedConversationSequence: 4,
      interactionVersion: 'dialogue-v2',
      intentCardId: null,
      offering: offeringKind ? { kind: offeringKind, itemId } : null
    });
  });

  it.each(['completed', 'cancelled', 'stale'])('does not return retry input for terminal status %s', (status) => {
    const response = dialogueStatusResponse({ status, result: null, input: { turnId, message: 'old message' } });
    expect(response).toEqual({ status, result: null });
  });
});
