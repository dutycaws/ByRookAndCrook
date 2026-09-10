import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '$lib/game/contracts';
import {
  MAX_DECORATIVE_PARTICLES,
  deriveBakeVisualState,
  deriveBrewVisualState,
  deriveGardenVisualState
} from '$lib/presentation/scene';

function snapshot(): GameSnapshot {
  return {
    save: {
      id: 'save-1', rulesVersion: 'v1', revision: 17, currentDay: 2,
      dayMinigameCompleted: false, dailyCraftKind: null
    },
    cells: [
      {
        id: 'cell-1', layoutKey: 'c1', col: 2, row: 3, kind: 'plant', plantKey: 'fennel',
        plantName: 'Fennel', icon: '🌿', growthStage: 3, water: 2, health: 2, harvestable: true,
        preview: { qualityIndex: 3, quantity: 2, hasHiveBonus: true, brewBonus: 1, bakeBonus: 1 }
      }
    ],
    ingredients: [
      {
        id: 'ingredient-1', plantKey: 'fennel', plantName: 'Fennel', icon: '🌿', qualityIndex: 3,
        quantity: 2, brewBonus: 1, bakeBonus: 1, sourceCellId: 'cell-1', createdAt: '2026-09-10T00:00:00Z'
      }
    ],
    brewery: { activeSession: null, beverages: [], socialCards: [], intentCards: [] },
    bakery: {
      rules: {
        rulesVersion: 'bake-v1', foldsRequired: 6, scoresRequired: 3, idealSeconds: 30,
        greenStartMs: 27_000, greenEndMs: 33_000, yellowStartMs: 22_000, yellowEndMs: 38_000
      },
      activeSession: null, foods: [], intentCards: []
    },
    foods: []
  };
}

describe('scene presentation contracts', () => {
  it('projects garden geometry and selection without save or reward state', () => {
    const visual = deriveGardenVisualState(snapshot(), 'cell-1', false, null);
    expect(visual.plots).toEqual([
      {
        id: 'cell-1', layoutKey: 'c1', col: 2, row: 3, kind: 'plant',
        plantKey: 'fennel', plantName: 'Fennel', stage: 3, selected: true, harvestable: true
      }
    ]);
    expect(visual.status).toBe('ready');
    expect(JSON.stringify(visual)).not.toContain('revision');
    expect(JSON.stringify(visual)).not.toContain('qualityIndex');
  });

  it('derives Brewery setup, active, ready, blocked, and result phases', () => {
    const game = snapshot();
    const input = { speed: 125, zone: 'fast' as const, remainingMs: 12_000, pending: false, error: null };
    expect(deriveBrewVisualState(game, input).phase).toBe('setup');
    expect(deriveBrewVisualState(game, { ...input, pending: true })).toMatchObject({ phase: 'setup', pending: true });
    expect(deriveBrewVisualState(game, { ...input, error: 'ledger offline' })).toMatchObject({ phase: 'setup', error: 'ledger offline' });
    game.brewery.activeSession = {
      id: 'brew-1', ingredientBatchId: 'ingredient-1', plantKey: 'fennel', plantName: 'Fennel', icon: '🌿',
      ingredientQualityIndex: 3, ingredientBrewBonus: 1, startedAt: '2026-09-10T00:00:00Z', durationSeconds: 30
    };
    expect(deriveBrewVisualState(game, input)).toMatchObject({ phase: 'active', agitation: { speed: 100 } });
    expect(deriveBrewVisualState(game, { ...input, remainingMs: 0 }).phase).toBe('ready');
    game.save.dailyCraftKind = 'bake';
    expect(deriveBrewVisualState(game, input).phase).toBe('blocked');
    game.save.dailyCraftKind = 'brew';
    game.save.dayMinigameCompleted = true;
    expect(deriveBrewVisualState(game, input).phase).toBe('result');
  });

  it('derives Bakery phase counts and server-clock projection', () => {
    const game = snapshot();
    game.bakery.activeSession = {
      id: 'bake-1', ingredientBatchId: 'ingredient-1', plantKey: 'fennel', plantName: 'Fennel', icon: '🌿',
      ingredientQualityIndex: 3, ingredientBakeBonus: 1, recipeKey: 'herb-loaf', rulesVersion: 'bake-v1',
      status: 'baking', foldCount: 6, foldPoints: 390, scoreCount: 3, scorePoints: 210,
      ovenStartedAt: '2026-09-10T00:00:00Z', dayNumber: 2
    };
    const visual = deriveBakeVisualState(game, { elapsedMs: 28_000, ovenBand: 'green', pending: true, error: null });
    expect(visual).toMatchObject({
      phase: 'baking', folds: { complete: 6, required: 6 }, scores: { complete: 3, required: 3 },
      oven: {
        elapsedMs: 28_000, band: 'green', appearance: 'ideal',
        riseProgress: 1, crustProgress: 28 / 30, overbakeProgress: 0
      },
      result: { qualityIndex: null }, pending: true
    });
    expect(JSON.stringify(visual)).not.toContain('foldPoints');
    expect(JSON.stringify(visual)).not.toContain('ingredientBatchId');
  });

  it('reconstructs every Bakery phase and bounds oven appearance from persisted state', () => {
    const game = snapshot();
    const input = { elapsedMs: 0, ovenBand: 'red' as const, pending: false, error: null };
    expect(deriveBakeVisualState(game, input)).toMatchObject({ phase: 'setup', oven: { appearance: 'pale' } });

    const active: NonNullable<GameSnapshot['bakery']['activeSession']> = {
      id: 'bake-1', ingredientBatchId: 'ingredient-1', plantKey: 'fennel', plantName: 'Fennel', icon: '🌿',
      ingredientQualityIndex: 3, ingredientBakeBonus: 1, recipeKey: 'herb-loaf',
      rulesVersion: 'bake-v1', status: 'folding', foldCount: 0, foldPoints: 0,
      scoreCount: 0, scorePoints: 0, ovenStartedAt: null, dayNumber: 2
    };
    game.bakery.activeSession = active;
    for (const phase of ['folding', 'scoring', 'ready', 'baking'] as const) {
      active.status = phase;
      expect(deriveBakeVisualState(game, input).phase).toBe(phase);
    }

    const overbaked = deriveBakeVisualState(game, { ...input, elapsedMs: 50_000 });
    expect(overbaked.oven).toMatchObject({ appearance: 'overbaked', riseProgress: 1, crustProgress: 1 });
    expect(overbaked.oven.overbakeProgress).toBeGreaterThan(0);

    game.bakery.activeSession = null;
    game.save.dailyCraftKind = 'brew';
    expect(deriveBakeVisualState(game, input).phase).toBe('blocked');
    game.save.dailyCraftKind = 'bake';
    game.save.dayMinigameCompleted = true;
    game.bakery.foods.push({
      id: 'food-1', name: 'Hearth loaf', recipeKey: 'herb-loaf', qualityIndex: 4,
      dayNumber: 2, createdAt: '2026-09-10T00:00:00Z'
    });
    expect(deriveBakeVisualState(game, input)).toMatchObject({ phase: 'result', result: { qualityIndex: 4 } });
  });

  it('bounds decorative particles and exposes explicit empty/error states', () => {
    expect(MAX_DECORATIVE_PARTICLES).toBeLessThanOrEqual(40);
    expect(deriveGardenVisualState(null, null, false, 'Scene failed').status).toBe('error');
    expect(deriveBrewVisualState(null, { speed: 0, zone: 'slow', remainingMs: 0, pending: false, error: null }).phase).toBe('empty');
    expect(deriveBakeVisualState(null, { elapsedMs: 0, ovenBand: 'red', pending: false, error: null }).phase).toBe('empty');
  });
});
