import type { NpcSheet } from '$lib/game/npc-sheet';

export type CommunityProfile = { userId: string; displayName: string; bio: string; adultAttested: boolean; matureEnabled: boolean; creatorTermsAccepted: boolean };
export type CommunityWorkspace = { npcId: string; draftRevision: number; draftState: string; sheet: NpcSheet; status: string; rating: string; updatedAt: string };

export const capabilityLabels: Record<string, string> = {
  admin: 'Administrator', npc_author: 'Community author', npc_reviewer: 'Reviewer'
};

export function hasCapability(capabilities: string[], capability: string): boolean {
  return capabilities.includes('admin') || capabilities.includes(capability);
}

export function createNpcSheet(name = 'New companion'): NpcSheet {
  return {
    schemaVersion: 'npc-sheet-v1', rating: 'standard',
    identity: { name, title: 'Wayfarer', shortDescription: 'A capable traveler with a reason to stay near the tavern for a while.', voice: 'Speaks plainly, listens before making a promise, and keeps their replies grounded in what they know.' },
    appearance: { physicalAppearance: 'A travel-worn figure with an alert expression and a practical manner.', attire: 'Layered clothing suited to the road, carefully mended and fit for work.', notableFeatures: 'A weathered keepsake and an observant gaze that notices small changes.', mood: 'Cautiously hopeful, especially when offered a warm place to rest.' },
    personality: { values: ['Keeps promises'], likes: ['Honest work'], dislikes: ['Needless cruelty'], boundaries: ['Will not betray a trusted companion without a compelling reason.'] },
    lore: { entities: [], npcReferences: [], relationships: [], facts: [] },
    skills: { scouting: 4, combat: 3, diplomacy: 2, trade: 1 },
    campaign: { durableGoal: 'Build enough trust and local knowledge to resolve a difficult obligation without leaving friends behind.', milestones: [
      { id: 'first-lead', title: 'Find the first lead', outcome: 'Locate a credible path toward the obligation.', motivation: 'The traveler needs a safe beginning before risking a larger commitment.', constraints: ['Avoid drawing unwanted attention'], allowedTargets: ['old-road'], difficulty: 1, successNews: 'A useful lead has been found near the old road.', nonSuccessNews: 'The first lead went cold, leaving fewer safe options.', retiredTargets: [], permanentLoss: null, startingPlan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }] },
      { id: 'settle-debt', title: 'Settle the obligation', outcome: 'Resolve the obligation and choose what comes next.', motivation: 'A lasting answer matters more than a quick victory.', constraints: ['Protect allies from retaliation'], allowedTargets: ['old-road', 'market-square'], difficulty: 3, successNews: 'The obligation has been settled on honorable terms.', nonSuccessNews: 'The attempt failed, and its cost will endure.', retiredTargets: ['old-road'], permanentLoss: null, startingPlan: null }
    ] }
  };
}

export function prettyJson(value: unknown): string { return JSON.stringify(value, null, 2); }
