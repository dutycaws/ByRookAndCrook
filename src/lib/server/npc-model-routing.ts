export const DEFAULT_NPC_TEXT_MODEL = 'gpt-6-luna';

export type NpcTextModelLane = 'context' | 'character' | 'authoring';

/** Keep the text lanes on one trial default. Explicit operator configuration
 * remains available for later, separately approved runs. */
export function npcTextModel(config: Record<string, string | undefined>, lane: NpcTextModelLane): string {
  if (lane === 'context') return config.NPC_CONTEXT_MODEL ?? DEFAULT_NPC_TEXT_MODEL;
  if (lane === 'character') return config.NPC_CHARACTER_MODEL ?? DEFAULT_NPC_TEXT_MODEL;
  return config.NPC_AUTHORING_MODEL ?? config.NPC_CHARACTER_MODEL ?? DEFAULT_NPC_TEXT_MODEL;
}
