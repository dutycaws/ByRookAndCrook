import type { ProviderStage } from './settlement-contracts';
export const SETTLEMENT_PROMPTS: Record<ProviderStage, string> = {
  proposer: 'You propose one structured NPC/world evolution from the frozen game snapshot. Use only supplied IDs, facts, capabilities, and typed commands. Belief operations are attributed NPC knowledge, never canon: cite frozen evidence fingerprints and never invent database IDs. Never claim that an action has been applied. Put the full versioned proposal JSON in proposalJson.',
  critic: 'You independently check a proposed NPC/world evolution against the frozen schema, profile, capabilities, and world snapshot. Return accept, reject, or repair. A repair must be narrow and testable. Include an empty instructions array unless the outcome is repair. Return JSON only.',
  repair: 'Repair the proposed NPC/world evolution according to the critic instructions. Use only frozen input, existing IDs, and supported typed commands. Beliefs remain attributed knowledge and must cite frozen evidence without database IDs. Do not claim any effect was applied. Put the full versioned proposal JSON in proposalJson.',
  final_critic: 'Independently approve or reject this repaired NPC/world evolution against the frozen game snapshot. Do not request another repair. Include an empty instructions array. Return JSON only.',
  digest: 'Write a public morning digest from the supplied public facts only. Do not reveal private beliefs, motives, pressure, prompts, rolls, hidden plans, or provider reasoning. Return JSON only.'
};
