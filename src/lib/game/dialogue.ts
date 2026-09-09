export type PatronKey = 'lira' | 'torvin';
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
  patronKey: PatronKey;
  message: string;
  expectedConversationSequence: number;
  interactionVersion: 'dialogue-v2';
  intentCardId?: string | null;
  offering?: Offering | null;
}
export interface DialogueReply {
  turnId: string;
  reply: string;
  sequence: number;
  relationship: number;
  relationshipChange: number;
  serving: { goldEarned: number; itemKind: Offering['kind']; itemName: string } | null;
  intentCard: { id: string; cardKey: string; displayName: string; tier: string } | null;
  intention: Intention | null;
  committedRevision: number;
}
export interface Journal {
  sequence: number;
  availability: 'present' | 'dead' | 'departed';
  intention: Intention | null;
  questStatus: string;
  preparation: number;
  nextStep: number;
  risk: 'low' | 'moderate' | 'high' | 'none';
  warning: string | null;
  turns: Array<{ id: string; message: string; reply: string; day: number }>;
  events: Array<{ id: string; patronKey: string; text: string; outcome: string; day: number }>;
  pending: { turnId: string; status: string; message: string; error: string | null } | null;
}

/** Attempts and abandonment end a quest, so later daily steps cannot execute. */
export function hasExecutableSteps(steps: Intention['steps']): boolean {
  return steps.length >= 1 && steps.length <= 3
    && ['attempt', 'abandon'].includes(steps.at(-1)!.action)
    && steps.slice(0, -1).every(step => ['prepare', 'wait'].includes(step.action));
}
