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
  countdownSeconds: number;
  stirRulesVersion: 'rpm-v1' | 'guide-v2';
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

export type IntentCardKey = 'charm' | 'insight' | 'resolve' | 'rumor';

export interface IntentCard {
  id: string;
  cardKey: IntentCardKey;
  displayName: string;
  description: string;
  tier: CardTier;
  sourceBeverageId?: string | null;
  sourceFoodId?: string | null;
  createdAt?: string;
}

export interface Food {
  id: string;
  name: string;
  recipeKey: string;
  qualityIndex: QualityIndex;
  dayNumber: number;
  bakeSessionId?: string | null;
  ingredientBatchId?: string | null;
  rulesVersion?: string;
  createdAt: string;
}

export type BakeStatus = 'folding' | 'scoring' | 'ready' | 'baking';

export interface BakeSession {
  id: string;
  ingredientBatchId: string;
  plantKey: string;
  plantName: string;
  icon: string;
  ingredientQualityIndex: QualityIndex;
  ingredientBakeBonus: number;
  recipeKey: 'herb-loaf';
  rulesVersion: 'bake-v1';
  status: BakeStatus;
  foldCount: number;
  foldPoints: number;
  scoreCount: number;
  scorePoints: number;
  ovenStartedAt: string | null;
  dayNumber: number;
}

export interface BakeryRules {
  rulesVersion: 'bake-v1';
  foldsRequired: 6;
  scoresRequired: 3;
  idealSeconds: 30;
  greenStartMs: number;
  greenEndMs: number;
  yellowStartMs: number;
  yellowEndMs: number;
}

export interface GameSnapshot {
  save: {
    id: string;
    rulesVersion: string;
    revision: number;
    currentDay: number;
    dayMinigameCompleted: boolean;
    dailyCraftKind: 'brew' | 'bake' | null;
  };
  cells: GardenCell[];
  ingredients: IngredientBatch[];
  brewery: {
    activeSession: BrewSession | null;
    beverages: Beverage[];
    socialCards: SocialCard[];
    intentCards: IntentCard[];
  };
  bakery: {
    rules: BakeryRules;
    activeSession: BakeSession | null;
    foods: Food[];
    intentCards: IntentCard[];
  };
  foods: Food[];
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
  countdownSeconds: number;
  stirRulesVersion: 'rpm-v1' | 'guide-v2';
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
  socialCardId?: string | null;
  intentCardId?: string | null;
  intentCardKey?: IntentCardKey | null;
  intentCardTier?: CardTier | null;
  beverageName: string;
  qualityIndex: QualityIndex;
  stirScore: number;
  committedRevision: number;
  dayNumber: number;
  rulesVersion: string;
}

export interface StartBakeCommand {
  saveId: string;
  ingredientBatchId: string;
  actionId: string;
  expectedRevision: number;
}

export interface StartBakeReceipt {
  actionId: string;
  sessionId: string;
  ingredientBatchId: string;
  status: 'folding';
  foldsRequired: number;
  scoresRequired: number;
  committedRevision: number;
  dayNumber: number;
  rulesVersion: 'bake-v1';
}

export interface BakeGestureCommand {
  saveId: string;
  sessionId: string;
  actionId: string;
  expectedRevision: number;
  value: number;
}

export interface BakeGestureReceipt {
  actionId: string;
  sessionId: string;
  status: BakeStatus;
  foldCount?: number;
  foldPoints?: number;
  scoreCount?: number;
  scorePoints?: number;
  committedRevision: number;
}

export interface BeginBakeOvenCommand {
  saveId: string;
  sessionId: string;
  actionId: string;
  expectedRevision: number;
}

export interface BeginBakeOvenReceipt {
  actionId: string;
  sessionId: string;
  status: 'baking';
  ovenStartedAt: string;
  idealSeconds: 30;
  committedRevision: number;
}

export interface CompleteBakeCommand extends BeginBakeOvenCommand {}

export interface CompleteBakeReceipt {
  actionId: string;
  sessionId: string;
  foodId: string;
  intentCardId: string | null;
  intentCardKey: IntentCardKey | null;
  intentCardTier: CardTier | null;
  foodName: string;
  qualityIndex: QualityIndex;
  techniqueScore: number;
  timingBand: 'red' | 'yellow' | 'green';
  ovenElapsedMs: number;
  committedRevision: number;
  dayNumber: number;
  rulesVersion: 'bake-v1';
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
    !Array.isArray(candidate.brewery.socialCards) ||
    !Array.isArray(candidate.brewery.intentCards) ||
    !candidate.bakery ||
    !candidate.bakery.rules ||
    !Array.isArray(candidate.bakery.foods) ||
    !Array.isArray(candidate.bakery.intentCards) ||
    !Array.isArray(candidate.foods)
  ) {
    throw new Error('Invalid game snapshot');
  }

  const activeBrew = candidate.brewery.activeSession;
  if (activeBrew) {
    const stirRulesVersion = activeBrew.stirRulesVersion ?? 'rpm-v1';
    const countdownSeconds = activeBrew.countdownSeconds ?? 0;
    const validTiming = (stirRulesVersion === 'guide-v2'
      && activeBrew.durationSeconds === 15 && countdownSeconds === 2)
      || (stirRulesVersion === 'rpm-v1'
        && activeBrew.durationSeconds === 30 && countdownSeconds === 0);
    if (!validTiming) throw new Error('Invalid active brew timing');
    activeBrew.stirRulesVersion = stirRulesVersion;
    activeBrew.countdownSeconds = countdownSeconds;
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
  const raw = parseCommandReceipt<StartBrewReceipt>(value);
  const stirRulesVersion = raw.stirRulesVersion ?? 'rpm-v1';
  const countdownSeconds = raw.countdownSeconds ?? 0;
  const validTiming = (stirRulesVersion === 'guide-v2'
    && raw.durationSeconds === 15 && countdownSeconds === 2)
    || (stirRulesVersion === 'rpm-v1'
      && raw.durationSeconds === 30 && countdownSeconds === 0);
  if (!raw.sessionId || !raw.ingredientBatchId || !validTiming) {
    throw new Error('Invalid start brew receipt');
  }
  return { ...raw, countdownSeconds, stirRulesVersion };
}

export function parseCompleteBrewReceipt(value: Json): CompleteBrewReceipt {
  const receipt = parseCommandReceipt<CompleteBrewReceipt>(value);
  if (!receipt.sessionId || !receipt.beverageId || !receipt.beverageName) {
    throw new Error('Invalid complete brew receipt');
  }
  return receipt;
}

export function parseStartBakeReceipt(value: Json): StartBakeReceipt {
  const receipt = parseCommandReceipt<StartBakeReceipt>(value);
  if (!receipt.sessionId || !receipt.ingredientBatchId || receipt.rulesVersion !== 'bake-v1') {
    throw new Error('Invalid start bake receipt');
  }
  return receipt;
}

export function parseBakeGestureReceipt(value: Json): BakeGestureReceipt {
  const receipt = parseCommandReceipt<BakeGestureReceipt>(value);
  if (!receipt.sessionId || !['folding', 'scoring', 'ready'].includes(receipt.status)) {
    throw new Error('Invalid bake gesture receipt');
  }
  return receipt;
}

export function parseBeginBakeOvenReceipt(value: Json): BeginBakeOvenReceipt {
  const receipt = parseCommandReceipt<BeginBakeOvenReceipt>(value);
  if (!receipt.sessionId || receipt.status !== 'baking' || !receipt.ovenStartedAt) {
    throw new Error('Invalid oven receipt');
  }
  return receipt;
}

export function parseCompleteBakeReceipt(value: Json): CompleteBakeReceipt {
  const receipt = parseCommandReceipt<CompleteBakeReceipt>(value);
  if (!receipt.sessionId || !receipt.foodId || !receipt.foodName || receipt.rulesVersion !== 'bake-v1') {
    throw new Error('Invalid bake completion receipt');
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
