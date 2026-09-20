import type { PromptKey, PromptReleaseSnapshot, PromptSnapshot } from './contracts';
import { PROMPT_MANIFEST } from './manifest';
import { renderPromptTemplate } from './template';

/** Resolving a key from a release is deliberately strict: provider adapters
 * must not fall back to a source constant when a release is incomplete. */
export function releasePrompt(release: PromptReleaseSnapshot, key: PromptKey): PromptSnapshot {
  const prompt = release.prompts[key];
  if (!prompt || prompt.releaseId !== release.releaseId || prompt.key !== key) throw new Error(`Pinned prompt ${key} is unavailable`);
  return prompt;
}

export function releaseTextPrompt(release: PromptReleaseSnapshot, key: PromptKey): PromptSnapshot {
  const prompt = releasePrompt(release, key);
  if (prompt.promptType !== 'text_system') throw new Error(`${key} is not a text prompt`);
  return prompt;
}

export function releaseImagePrompt(release: PromptReleaseSnapshot, key: PromptKey, values: Readonly<Record<string, string>>): PromptSnapshot & { rendered: string } {
  const prompt = releasePrompt(release, key);
  if (prompt.promptType !== 'image_template') throw new Error(`${key} is not an image prompt`);
  return { ...prompt, rendered: renderPromptTemplate(PROMPT_MANIFEST[key], prompt.body, values) };
}

export const DIALOGUE_PROMPT_KEY = {
  investigate: 'dialogue.investigate', deliberate: 'dialogue.deliberate', speak: 'dialogue.speak', review: 'dialogue.review', remember: 'dialogue.remember'
} as const satisfies Record<string, PromptKey>;

export const SETTLEMENT_PROMPT_KEY = {
  proposer: 'resident.proposer', critic: 'resident.critic', repair: 'resident.repair', final_critic: 'resident.final_critic', digest: 'resident.digest',
  canon_proposer: 'canon.proposer', canon_critic: 'canon.critic', canon_repair: 'canon.repair', canon_final_critic: 'canon.final_critic',
  social_encounter_proposer: 'social.proposer', social_encounter_critic: 'social.critic', social_encounter_repair: 'social.repair', social_encounter_final_critic: 'social.final_critic',
  procedural_world_proposer: 'procedural.proposer', procedural_world_critic: 'procedural.critic', procedural_world_repair: 'procedural.repair', procedural_world_final_critic: 'procedural.final_critic',
  quest_transition_proposer: 'quest_transition.proposer', quest_transition_critic: 'quest_transition.critic', quest_transition_repair: 'quest_transition.repair', quest_transition_final_critic: 'quest_transition.final_critic'
} as const satisfies Record<string, PromptKey>;
