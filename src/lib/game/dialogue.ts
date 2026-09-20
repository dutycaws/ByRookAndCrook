/** Stable NPC identity and world-resident instance identifiers are UUIDs. */
export type NpcId = string;
export type NpcInstanceId = string;
export type Approach = 'scouting' | 'combat' | 'diplomacy' | 'trade';
export type ActionKind = 'prepare' | 'attempt' | 'wait' | 'abandon';
export interface Intention { goal: string; motivation: string; targets: string[]; steps: Array<{ action: ActionKind; approach: Approach }> }
export interface Decision {
  stance: 'agree' | 'refuse' | 'clarify' | 'respond';
  reaction: -1 | 0 | 1;
  subject: 'quest' | 'personal' | 'hospitality';
  evidence: string;
  intention: Intention | null;
}
export interface Memory { kind: 'keeper_claim' | 'npc_statement' | 'promise' | 'interaction'; text: string; quote: string; speaker: 'keeper' | 'npc' }
export type Offering = { kind: 'food' | 'beverage'; itemId: string };
export interface DialogueInput {
  turnId: string;
  npcId: NpcId;
  message: string;
  expectedConversationSequence: number;
  interactionVersion: 'dialogue-v2';
  intentCardId?: string | null;
  offering?: Offering | null;
}
export interface DialogueReply {
  turnId: string;
  npcId: NpcId;
  instanceId: NpcInstanceId;
  reply: string;
  sequence: number;
  relationship: number;
  relationshipChange: number;
  serving: { goldEarned: number; itemKind: Offering['kind']; itemName: string } | null;
  intentCard: { id: string; cardKey: string; displayName: string; tier: string } | null;
  intention: Intention | null;
  committedRevision: number;
}
/**
 * A deliberately qualitative, player-visible view of a resident's recent
 * change. It never contains the mutable profile, beliefs, social scores, or
 * settlement inputs used to arrive at the change.
 */
export interface PublicDisposition {
  summary: string;
  state: string;
  version: string;
}

/** A bounded, public journal entry emitted by an overnight settlement. */
export interface PublicEvolutionEntry {
  day: number;
  profileRevision: number;
  createdAt: string;
  disposition: PublicDisposition;
}

/**
 * The Bar receives this deliberately small quest projection.  It is distinct
 * from the package-pinned definition and settlement receipts: players learn
 * what a resident is doing, not the odds, draws, or private rationale.
 */
export type QuestLifecycleStatus = 'active' | 'awaiting_transition' | 'departing' | 'departed';
export interface PublicQuestStep { action: ActionKind; approach: Approach; }
export interface CurrentQuest {
  id: string;
  origin: 'authored_milestone' | 'generated_successor';
  title: string;
  objective: string;
  plan: PublicQuestStep[];
  currentStep: number;
  activationDay: number;
  readiness: 'rising' | 'steady' | 'strained';
  risk: 'low' | 'moderate' | 'high';
}
export interface PublicQuestHistoryEntry {
  id: string;
  day: number;
  outcome: string;
  text: string;
  publicNews: boolean;
}

export interface Journal {
  instanceId: NpcInstanceId;
  npcId: NpcId;
  sequence: number;
  availability: 'present' | 'dead' | 'departed' | 'dismissed' | 'removed' | 'quarantined';
  questLifecycleStatus: QuestLifecycleStatus;
  currentQuest: CurrentQuest | null;
  questHistory: PublicQuestHistoryEntry[];
  farewellText: string | null;
  turns: Array<{ id: string; message: string; reply: string; day: number }>;
  pending: { turnId: string; status: string; message: string; error: string | null } | null;
  disposition: PublicDisposition | null;
  evolution: PublicEvolutionEntry[];
}

/** Attempts and abandonment end a quest, so later daily steps cannot execute. */
export function hasExecutableSteps(steps: Intention['steps']): boolean {
  return steps.length >= 1 && steps.length <= 3
    && ['attempt', 'abandon'].includes(steps.at(-1)!.action)
    && steps.slice(0, -1).every(step => ['prepare', 'wait'].includes(step.action))
    && steps.every(step => ['scouting', 'combat', 'diplomacy', 'trade'].includes(step.approach));
}
