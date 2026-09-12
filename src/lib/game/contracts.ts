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
  unlocked?: boolean;
  kind: 'empty' | 'plant' | 'beehive';
  plantKey: string | null;
  plantName: string | null;
  icon: string | null;
  growthStage: number | null;
  water: number | null;
  health: number | null;
  harvestable: boolean;
  soil?: {
    n: number;
    p: number;
    k: number;
    moisture: number;
    quality: number;
    siteLight: number;
  };
  plant?: {
    id: string;
    speciesKey: string;
    lifecycle: 'seedling' | 'growing' | 'flowering' | 'mature' | 'regrowing' | 'dead';
    ageDays: number;
    growthProgress: number;
    health: number;
    productionCycle: number;
    floweringDaysRemaining: number;
    readySinceDay: number | null;
    qualityIndex: QualityIndex;
    symptoms: Array<{ code: string; severity: 'info' | 'warning' | 'critical'; label: string; cause: string }>;
  } | null;
  hive?: {
    id: string;
    equipmentCondition: number;
    hasColony: boolean;
    colony: {
      id: string;
      adults: number;
      brood: number;
      health: number;
      foodStores: number;
      feedStores?: number;
      floralHoney: number;
      protectedReserve: number;
      extractableSurplus: number;
      varroaPressure: number;
      chalkbroodPressure: number;
      nosemaPressure: number;
      treatmentKey: string | null;
      treatmentDaysRemaining: number;
      treatmentTradeoff?: string | null;
      threatDays?: number;
      symptoms?: Array<{ code: string; severity: 'info' | 'warning' | 'critical'; label: string; cause: string }>;
    } | null;
  } | null;
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
  sourceKind?: 'crop' | 'honey';
  provenance?: Record<string, Json>;
  consumedQuantity?: number;
  compostedQuantity?: number;
  createdAt: string;
}

export interface GardenInventoryItem {
  itemKey: string;
  name: string;
  kind: 'seed' | 'amendment' | 'feed' | 'treatment' | 'equipment' | 'colony';
  quantity: number;
  price: number;
  effect: Record<string, Json>;
}

export interface ShopItem extends Omit<GardenInventoryItem, 'quantity'> {
  dailyCap: number;
  remainingStock: number;
  restockDay: number;
}

export interface GardenState {
  rulesVersion: string;
  plotCount: 12 | 16 | 24;
  forecast: Array<{
    dayNumber: number;
    key: 'clear' | 'cloudy' | 'rainy';
    name: string;
    rainfall: number;
    drying: number;
    lightDelta: number;
  }>;
  inventory: GardenInventoryItem[];
  shop: ShopItem[];
  compostJobs: Array<{
    id: string;
    cellId: string;
    sourceKind: 'plant' | 'green_manure' | 'ingredient';
    sourceLabel: string;
    readyDay: number;
    releasesRemaining: number;
  }>;
  latestReport: Json | null;
  expansions: Array<{ plotCount: 16 | 24; price: number; available: boolean }>;
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
    gold?: number;
    gardenRulesVersion?: string;
    gardenPlotCount?: 12 | 16 | 24;
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
  garden?: GardenState;
}

export type GardenCommandKind =
  | 'plant'
  | 'move'
  | 'remove'
  | 'water'
  | 'amend'
  | 'incorporate_clover'
  | 'compost_ingredient'
  | 'purchase'
  | 'expand';

export type GardenCommandPayload =
  | { cellId: string; seedItemKey: string }
  | { sourceCellId: string; targetCellId: string }
  | { cellId: string; compost?: boolean }
  | { cellIds: string[]; dose: number }
  | { cellIds: string[]; itemKey: string; dose: number }
  | { cellId: string }
  | { cellId: string; ingredientBatchId: string; quantity: number }
  | { itemKey: string; quantity: number }
  | { plotCount: 16 | 24 };

export interface GardenCommand {
  saveId: string;
  actionId: string;
  expectedRevision: number;
  commandKind: GardenCommandKind;
  payload: GardenCommandPayload;
}

export interface GardenCommandReceipt {
  actionId: string;
  commandKind: GardenCommandKind;
  committedRevision: number;
  rulesVersion: string;
  normalizedPayload: Record<string, Json>;
  result: Record<string, Json>;
}

export interface GardenCommandPreview {
  commandKind: GardenCommandKind;
  basedOnRevision: number;
  rulesVersion: string;
  normalizedPayload: Record<string, Json>;
  canCommit?: boolean;
  [key: string]: Json | undefined;
}

export type ApiaryCommandKind =
  | 'install_hive'
  | 'install_colony'
  | 'feed'
  | 'treat'
  | 'split'
  | 'extract_honey';

export type ApiaryCommandPayload =
  | { cellId: string }
  | { hiveId: string }
  | { colonyId: string; quantity: number }
  | { colonyId: string; treatmentItemKey: string }
  | { sourceColonyId: string; targetHiveId: string };

export interface ApiaryCommand {
  saveId: string;
  actionId: string;
  expectedRevision: number;
  commandKind: ApiaryCommandKind;
  payload: ApiaryCommandPayload;
}

export interface ApiaryCommandReceipt {
  actionId: string;
  commandKind: ApiaryCommandKind;
  committedRevision: number;
  rulesVersion: string;
  normalizedPayload: Record<string, Json>;
  result: Record<string, Json>;
}

export interface ApiaryCommandPreview {
  commandKind: ApiaryCommandKind;
  basedOnRevision: number;
  rulesVersion: string;
  normalizedPayload: Record<string, Json>;
  canCommit: boolean;
  [key: string]: Json | undefined;
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

const GARDEN_COMMAND_KINDS = new Set<GardenCommandKind>([
  'plant',
  'move',
  'remove',
  'water',
  'amend',
  'incorporate_clover',
  'compost_ingredient',
  'purchase',
  'expand'
]);

const APIARY_COMMAND_KINDS = new Set<ApiaryCommandKind>([
  'install_hive',
  'install_colony',
  'feed',
  'treat',
  'split',
  'extract_honey'
]);

export function parseGardenCommandReceipt(value: Json): GardenCommandReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid garden command receipt');
  }
  const candidate = value as unknown as GardenCommandReceipt;
  if (
    !candidate.actionId ||
    !GARDEN_COMMAND_KINDS.has(candidate.commandKind) ||
    !Number.isInteger(candidate.committedRevision) ||
    !candidate.rulesVersion ||
    !candidate.normalizedPayload ||
    !candidate.result
  ) {
    throw new Error('Invalid garden command receipt');
  }
  return candidate;
}

export function parseGardenCommandPreview(value: Json): GardenCommandPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid garden command preview');
  }
  const candidate = value as unknown as GardenCommandPreview;
  if (
    !GARDEN_COMMAND_KINDS.has(candidate.commandKind) ||
    !Number.isInteger(candidate.basedOnRevision) ||
    !candidate.rulesVersion ||
    !candidate.normalizedPayload
  ) {
    throw new Error('Invalid garden command preview');
  }
  return candidate;
}

export function parseApiaryCommandReceipt(value: Json): ApiaryCommandReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid apiary command receipt');
  }
  const candidate = value as unknown as ApiaryCommandReceipt;
  if (
    !candidate.actionId ||
    !APIARY_COMMAND_KINDS.has(candidate.commandKind) ||
    !Number.isInteger(candidate.committedRevision) ||
    !candidate.rulesVersion ||
    !candidate.normalizedPayload ||
    !candidate.result
  ) {
    throw new Error('Invalid apiary command receipt');
  }
  return candidate;
}

export function parseApiaryCommandPreview(value: Json): ApiaryCommandPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid apiary command preview');
  }
  const candidate = value as unknown as ApiaryCommandPreview;
  if (
    !APIARY_COMMAND_KINDS.has(candidate.commandKind) ||
    !Number.isInteger(candidate.basedOnRevision) ||
    !candidate.rulesVersion ||
    !candidate.normalizedPayload ||
    typeof candidate.canCommit !== 'boolean'
  ) {
    throw new Error('Invalid apiary command preview');
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
