import type { Json } from '$lib/database.types';
import type { IntentCard, QualityIndex, SocialCard } from './contracts';

export interface Patron {
  key: string;
  name: string;
  title: string;
  icon: string;
  description: string;
  prices: number[];
  relationship: number;
  arcTitle: string;
  arcProgress: number;
  arcTotal: number;
  story: string;
}

export interface ServeCommand {
  saveId: string;
  patronKey: string;
  itemKind: 'food' | 'beverage';
  itemId: string;
  legacyCardId: string | null;
  actionId: string;
  expectedRevision: number;
}

export interface ServeReceipt {
  actionId: string;
  patronKey: string;
  patronName: string;
  itemKind: 'food' | 'beverage';
  itemId: string;
  itemName: string;
  beverageId: string | null;
  beverageName: string | null;
  foodId: string | null;
  foodName: string | null;
  qualityIndex: QualityIndex;
  cardId: string | null;
  goldEarned: number;
  goldBalance: number;
  relationshipChange: number;
  relationship: number;
  arcChange: number;
  arcProgress: number;
  arcTotal: number;
  storyEvent: string;
  dayNumber: number;
  committedRevision: number;
  rulesVersion: string;
}

export interface BarSnapshot {
  save: { id: string; revision: number; gold: number; currentDay: number };
  patrons: Patron[];
  beverages: Array<{ id: string; kind: 'beverage'; name: string; qualityIndex: QualityIndex }>;
  foods: Array<{ id: string; kind: 'food'; name: string; qualityIndex: QualityIndex }>;
  intentCards: Array<Pick<IntentCard, 'id' | 'cardKey' | 'displayName' | 'description' | 'tier'>>;
  legacyCards: Array<Pick<SocialCard, 'id' | 'displayName' | 'tier' | 'relationshipGain' | 'goldMultiplier'>>;
  history: ServeReceipt[];
}

export function parseBarSnapshot(value: Json): BarSnapshot | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bar snapshot');
  const candidate = value as unknown as BarSnapshot;
  if (!candidate.save?.id || !Number.isSafeInteger(candidate.save.revision) ||
    !Array.isArray(candidate.patrons) || !Array.isArray(candidate.beverages) ||
    !Array.isArray(candidate.foods) || !Array.isArray(candidate.intentCards) ||
    !Array.isArray(candidate.legacyCards) || !Array.isArray(candidate.history)) throw new Error('Invalid bar snapshot');
  return candidate;
}

export function parseServeReceipt(value: Json): ServeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid serving receipt');
  const candidate = value as unknown as ServeReceipt;
  if (!candidate.actionId || !candidate.itemId || !candidate.itemName ||
    !['food', 'beverage'].includes(candidate.itemKind) || !candidate.patronKey ||
    !Number.isSafeInteger(candidate.goldEarned) || !Number.isSafeInteger(candidate.committedRevision)) {
    throw new Error('Invalid serving receipt');
  }
  return candidate;
}
