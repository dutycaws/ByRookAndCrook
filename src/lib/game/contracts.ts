import type { Json } from '$lib/database.types';

export const QUALITY_LABELS = [
  'Repugnant',
  'Awful',
  'Potable',
  'Decent',
  'Great',
  'Legendary',
  'Resplendent'
] as const;

export type QualityIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface HarvestPreview {
  qualityIndex: QualityIndex;
  quantity: number;
  hasHiveBonus: boolean;
  brewBonus: number;
  bakeBonus: number;
}

export interface GardenCell {
  id: string;
  layoutKey: string;
  col: number;
  row: number;
  kind: 'empty' | 'plant' | 'beehive';
  plantKey: string | null;
  plantName: string | null;
  icon: string | null;
  growthStage: number | null;
  water: number | null;
  health: number | null;
  harvestable: boolean;
  preview: HarvestPreview | null;
}

export interface IngredientBatch {
  id: string;
  plantKey: string;
  plantName: string;
  icon: string;
  qualityIndex: QualityIndex;
  quantity: number;
  brewBonus: number;
  bakeBonus: number;
  sourceCellId: string;
  createdAt: string;
}

export interface BrewSession {
  id: string;
  ingredientBatchId: string;
  plantKey: string;
  plantName: string;
  icon: string;
  ingredientQualityIndex: QualityIndex;
  ingredientBrewBonus: number;
  startedAt: string;
  durationSeconds: number;
}

export interface Beverage {
  id: string;
  name: string;
  qualityIndex: QualityIndex;
  ingredientBatchId: string;
  dayNumber: number;
  createdAt: string;
}

export type CardTier = 'fine' | 'superior' | 'exceptional';

export interface SocialCard {
  id: string;
  cardKey: 'pour-ale';
  displayName: string;
  tier: CardTier;
  relationshipGain: number;
  goldMultiplier: number;
  sourceBeverageId: string;
  createdAt: string;
}

export interface GameSnapshot {
  save: {
    id: string;
    rulesVersion: string;
    revision: number;
    currentDay: number;
    dayMinigameCompleted: boolean;
  };
  cells: GardenCell[];
  ingredients: IngredientBatch[];
  brewery: {
    activeSession: BrewSession | null;
    beverages: Beverage[];
    socialCards: SocialCard[];
  };
}

export interface HarvestCommand {
  saveId: string;
  cellId: string;
  actionId: string;
  expectedRevision: number;
}

export interface HarvestReceipt {
  actionId: string;
  cellId: string;
  ingredientBatchId: string;
  quantity: number;
  qualityIndex: QualityIndex;
  brewBonus: number;
  bakeBonus: number;
  committedRevision: number;
  rulesVersion: string;
}

export interface StartBrewCommand {
  saveId: string;
  ingredientBatchId: string;
  actionId: string;
  expectedRevision: number;
}

export interface StartBrewReceipt {
  actionId: string;
  sessionId: string;
  ingredientBatchId: string;
  startedAt: string;
  durationSeconds: number;
  committedRevision: number;
  dayNumber: number;
}

export interface CompleteBrewCommand {
  saveId: string;
  sessionId: string;
  actionId: string;
  expectedRevision: number;
  perfectTicks: number;
  goodTicks: number;
  totalTicks: number;
}

export interface CompleteBrewReceipt {
  actionId: string;
  sessionId: string;
  beverageId: string;
  socialCardId: string | null;
  beverageName: string;
  qualityIndex: QualityIndex;
  stirScore: number;
  committedRevision: number;
  dayNumber: number;
  rulesVersion: string;
}

export interface AdvanceDayCommand {
  saveId: string;
  actionId: string;
  expectedRevision: number;
}

export interface AdvanceDayReceipt {
  actionId: string;
  newDay: number;
  committedRevision: number;
}

export function qualityLabel(index: number): string {
  return QUALITY_LABELS[index] ?? 'Unknown';
}

export function parseSnapshot(value: Json | undefined): GameSnapshot | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid game snapshot');

  const candidate = value as unknown as GameSnapshot;
  if (
    !candidate.save ||
    !Array.isArray(candidate.cells) ||
    !Array.isArray(candidate.ingredients) ||
    !candidate.brewery ||
    !Array.isArray(candidate.brewery.beverages) ||
    !Array.isArray(candidate.brewery.socialCards)
  ) {
    throw new Error('Invalid game snapshot');
  }

  return candidate;
}

export function parseReceipt(value: Json): HarvestReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid harvest receipt');
  }

  const candidate = value as unknown as HarvestReceipt;
  if (!candidate.actionId || !candidate.ingredientBatchId || !Number.isInteger(candidate.committedRevision)) {
    throw new Error('Invalid harvest receipt');
  }

  return candidate;
}

function parseCommandReceipt<T extends { actionId: string; committedRevision: number }>(value: Json): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid command receipt');
  }

  const candidate = value as unknown as T;
  if (!candidate.actionId || !Number.isInteger(candidate.committedRevision)) {
    throw new Error('Invalid command receipt');
  }
  return candidate;
}

export function parseStartBrewReceipt(value: Json): StartBrewReceipt {
  const receipt = parseCommandReceipt<StartBrewReceipt>(value);
  if (!receipt.sessionId || !receipt.ingredientBatchId || receipt.durationSeconds !== 30) {
    throw new Error('Invalid start brew receipt');
  }
  return receipt;
}

export function parseCompleteBrewReceipt(value: Json): CompleteBrewReceipt {
  const receipt = parseCommandReceipt<CompleteBrewReceipt>(value);
  if (!receipt.sessionId || !receipt.beverageId || !receipt.beverageName) {
    throw new Error('Invalid complete brew receipt');
  }
  return receipt;
}

export function parseAdvanceDayReceipt(value: Json): AdvanceDayReceipt {
  const receipt = parseCommandReceipt<AdvanceDayReceipt>(value);
  if (!Number.isInteger(receipt.newDay) || receipt.newDay < 2) {
    throw new Error('Invalid day transition receipt');
  }
  return receipt;
}
