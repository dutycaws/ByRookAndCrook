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

export interface GameSnapshot {
  save: {
    id: string;
    rulesVersion: string;
    revision: number;
  };
  cells: GardenCell[];
  ingredients: IngredientBatch[];
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

export function qualityLabel(index: number): string {
  return QUALITY_LABELS[index] ?? 'Unknown';
}

export function parseSnapshot(value: Json | undefined): GameSnapshot | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid game snapshot');

  const candidate = value as unknown as GameSnapshot;
  if (!candidate.save || !Array.isArray(candidate.cells) || !Array.isArray(candidate.ingredients)) {
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
