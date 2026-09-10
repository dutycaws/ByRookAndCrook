import type { BakeStatus, GameSnapshot, GardenCell } from '$lib/game/contracts';

export const SCENE_DESIGN_SIZE = { width: 1672, height: 941 } as const;
export const MAX_DECORATIVE_PARTICLES = 40;

export interface SceneTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export type PresentationStatus = 'ready' | 'pending' | 'error';
export type BrewVisualPhase = 'setup' | 'active' | 'ready' | 'result' | 'empty' | 'blocked';
export type BakeVisualPhase = 'setup' | BakeStatus | 'result' | 'empty' | 'blocked';

export interface GardenVisualPlot {
  id: string;
  layoutKey: string;
  col: number;
  row: number;
  kind: GardenCell['kind'];
  stage: number | null;
  selected: boolean;
  harvestable: boolean;
}

export interface GardenVisualState {
  area: 'garden';
  designSize: typeof SCENE_DESIGN_SIZE;
  selectedCellId: string | null;
  plots: GardenVisualPlot[];
  status: PresentationStatus;
}

export interface BrewVisualState {
  area: 'brewery';
  designSize: typeof SCENE_DESIGN_SIZE;
  phase: BrewVisualPhase;
  session: { id: string; startedAt: string; durationSeconds: number } | null;
  agitation: { speed: number; zone: 'slow' | 'good' | 'perfect' | 'fast' };
  pending: boolean;
  error: string | null;
}

export interface BakeVisualState {
  area: 'bakery';
  designSize: typeof SCENE_DESIGN_SIZE;
  phase: BakeVisualPhase;
  folds: { complete: number; required: 6 };
  scores: { complete: number; required: 3 };
  oven: { startedAt: string | null; elapsedMs: number; band: 'red' | 'yellow' | 'green' };
  pending: boolean;
  error: string | null;
}

export interface GardenSceneCallbacks {
  onPlotSelect: (cellId: string) => void;
}

export interface BrewSceneCallbacks {
  onStirSpeed: (speed: number) => void;
}

export interface BakeSceneCallbacks {
  onGesture: (kind: 'fold' | 'score', value: number) => void;
}

export function presentationStatus(pending: boolean, error: string | null): PresentationStatus {
  return error ? 'error' : pending ? 'pending' : 'ready';
}

export function deriveGardenVisualState(
  snapshot: GameSnapshot | null,
  selectedCellId: string | null,
  pending: boolean,
  error: string | null
): GardenVisualState {
  return {
    area: 'garden',
    designSize: SCENE_DESIGN_SIZE,
    selectedCellId,
    plots: (snapshot?.cells ?? []).map((cell) => ({
      id: cell.id,
      layoutKey: cell.layoutKey,
      col: cell.col,
      row: cell.row,
      kind: cell.kind,
      stage: cell.growthStage,
      selected: cell.id === selectedCellId,
      harvestable: cell.harvestable
    })),
    status: presentationStatus(pending, error)
  };
}

export function deriveBrewVisualState(
  snapshot: GameSnapshot | null,
  input: {
    speed: number;
    zone: BrewVisualState['agitation']['zone'];
    remainingMs: number;
    pending: boolean;
    error: string | null;
  }
): BrewVisualState {
  const session = snapshot?.brewery.activeSession ?? null;
  let phase: BrewVisualPhase = 'empty';
  if (snapshot) {
    if (snapshot.save.dailyCraftKind === 'bake') phase = 'blocked';
    else if (snapshot.save.dayMinigameCompleted) phase = 'result';
    else if (session) phase = input.remainingMs <= 0 ? 'ready' : 'active';
    else phase = snapshot.ingredients.length > 0 ? 'setup' : 'empty';
  }
  return {
    area: 'brewery',
    designSize: SCENE_DESIGN_SIZE,
    phase,
    session: session ? { id: session.id, startedAt: session.startedAt, durationSeconds: session.durationSeconds } : null,
    agitation: { speed: Math.min(100, Math.max(0, input.speed)), zone: input.zone },
    pending: input.pending,
    error: input.error
  };
}

export function deriveBakeVisualState(
  snapshot: GameSnapshot | null,
  input: {
    elapsedMs: number;
    ovenBand: BakeVisualState['oven']['band'];
    pending: boolean;
    error: string | null;
  }
): BakeVisualState {
  const session = snapshot?.bakery.activeSession ?? null;
  let phase: BakeVisualPhase = 'empty';
  if (snapshot) {
    if (snapshot.save.dailyCraftKind === 'brew') phase = 'blocked';
    else if (snapshot.save.dayMinigameCompleted && snapshot.save.dailyCraftKind === 'bake') phase = 'result';
    else if (session) phase = session.status;
    else phase = snapshot.ingredients.length > 0 ? 'setup' : 'empty';
  }
  return {
    area: 'bakery',
    designSize: SCENE_DESIGN_SIZE,
    phase,
    folds: { complete: session?.foldCount ?? 0, required: 6 },
    scores: { complete: session?.scoreCount ?? 0, required: 3 },
    oven: { startedAt: session?.ovenStartedAt ?? null, elapsedMs: input.elapsedMs, band: input.ovenBand },
    pending: input.pending,
    error: input.error
  };
}
