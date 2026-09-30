import type { Json } from '$lib/database.types';
import type { IntentCard, QualityIndex } from './contracts';

export interface Patron {
  instanceId: string;
  npcId: string;
  versionId: string;
  name: string;
  title: string | null;
  description: string | null;
  relationship: number;
  status: string;
  rating: 'standard' | 'mature';
  origin: 'first_party' | 'community' | 'procedural';
  sceneStorageKey: string | null;
  creator: { displayName: string; profile: string } | null;
  sequence: number;
}

export interface ServeCommand {
  saveId: string;
  instanceId: string;
  itemKind: 'food' | 'beverage';
  itemId: string;
  actionId: string;
  expectedRevision: number;
}

export interface ServeReceipt {
  actionId: string;
  instanceId: string;
  itemKind: 'food' | 'beverage';
  itemId: string;
  itemName: string;
  qualityIndex: QualityIndex;
  goldEarned: number;
  goldBalance: number;
  relationshipChange: number;
  relationship: number;
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
  roster: Patron[];
  history: ServeReceipt[];
  news: Array<{ instanceId: string; day: number; outcome: string; text: string }>;
  latestArrival: unknown | null;
  /** @deprecated Legacy serving fixture shape. */
  legacyCards?: Array<Pick<IntentCard, 'id' | 'displayName' | 'tier'>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPatron(value: unknown): value is Patron {
  if (!isRecord(value)) return false;
  const creator = value.creator;
  return typeof value.instanceId === 'string'
    && typeof value.npcId === 'string'
    && typeof value.versionId === 'string'
    && typeof value.name === 'string'
    && isNullableString(value.title)
    && isNullableString(value.description)
    && Number.isSafeInteger(value.relationship)
    && typeof value.status === 'string'
    && (value.rating === 'standard' || value.rating === 'mature')
    && (value.origin === 'first_party' || value.origin === 'community' || value.origin === 'procedural')
    && isNullableString(value.sceneStorageKey)
    && Number.isSafeInteger(value.sequence)
    && (creator === null || (isRecord(creator)
      && typeof creator.displayName === 'string'
      && typeof creator.profile === 'string'));
}

export function parseBarSnapshot(value: Json): BarSnapshot | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bar snapshot');
  const raw = value as any;
  const candidate = {
    save: raw.save,
    roster: raw.roster ?? [], patrons: raw.patrons ?? [],
    beverages: raw.offerings?.beverages ?? raw.beverages ?? [], foods: raw.offerings?.foods ?? raw.foods ?? [], intentCards: raw.offerings?.intentCards ?? raw.intentCards ?? [],
    legacyCards: raw.legacyCards ?? [], history: raw.recent?.hospitality ?? raw.history ?? [], news: raw.recent?.news ?? [], latestArrival: raw.recent?.latestArrival ?? null
  } as BarSnapshot;
  if (!candidate.save?.id || !Number.isSafeInteger(candidate.save.revision) ||
    !Number.isSafeInteger(candidate.save.gold) || !Number.isSafeInteger(candidate.save.currentDay) ||
    !Array.isArray(candidate.roster) || !Array.isArray(candidate.beverages) ||
    !Array.isArray(candidate.foods) || !Array.isArray(candidate.intentCards) ||
    !Array.isArray(candidate.history) || !Array.isArray(candidate.news) ||
    !candidate.roster.every(isPatron)) throw new Error('Invalid bar snapshot');
  return candidate;
}

export function parseServeReceipt(value: Json): ServeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid serving receipt');
  const candidate = value as unknown as ServeReceipt;
  if (!candidate.actionId || !candidate.itemId || !candidate.itemName ||
    !['food', 'beverage'].includes(candidate.itemKind) || !candidate.instanceId ||
    !Number.isSafeInteger(candidate.goldEarned) || !Number.isSafeInteger(candidate.committedRevision)) {
    throw new Error('Invalid serving receipt');
  }
  return candidate;
}
