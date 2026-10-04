import type { DialogueInput, Offering } from '$lib/game/dialogue';

type RawDialogueStatus = {
  status?: unknown;
  input?: unknown;
  [key: string]: unknown;
};

/** Adapt the database status projection to the same input contract accepted by POST. */
export function dialogueStatusResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const body = value as RawDialogueStatus;
  if (body.status === 'completed' || body.status === 'cancelled' || body.status === 'stale') {
    const { input: _input, ...terminal } = body;
    return terminal;
  }

  if (!body.input || typeof body.input !== 'object') return body;
  const input = body.input as Record<string, unknown>;
  const offering: Offering | null = (input.offeringKind === 'food' || input.offeringKind === 'beverage')
    && typeof input.offeringItemId === 'string'
    ? { kind: input.offeringKind, itemId: input.offeringItemId }
    : null;
  const restored: DialogueInput = {
    turnId: input.turnId as string,
    npcId: input.npcId as string,
    message: input.message as string,
    expectedConversationSequence: input.expectedConversationSequence as number,
    interactionVersion: 'dialogue-v2',
    intentCardId: input.intentCardId as string | null ?? null,
    offering
  };
  return { ...body, input: restored };
}
