import { describe, expect, it } from 'vitest';
import {
  SCENE_COMPOSITIONS,
  SCENE_COMPOSITION_VERSION,
  getSceneComposition,
  isSceneActorInteractive,
  validateSceneComposition
} from '$lib/presentation/scene-composition';

describe('scene composition contract', () => {
  it('defines the versioned Shop and Bar planes used by rendering and validation', () => {
    expect(getSceneComposition('shop')).toMatchObject({
      version: SCENE_COMPOSITION_VERSION, plane: { width: 1200, height: 900 }
    });
    expect(getSceneComposition('bar')).toMatchObject({
      version: SCENE_COMPOSITION_VERSION, plane: { width: 1672, height: 941 }
    });
    expect(validateSceneComposition(SCENE_COMPOSITIONS.shop)).toEqual([]);
    expect(validateSceneComposition(SCENE_COMPOSITIONS.bar)).toEqual([]);
  });

  it('gives each actor a named placeholder, actionable bounds, compact placement, and decorative motion anchors', () => {
    for (const composition of Object.values(SCENE_COMPOSITIONS)) {
      for (const actor of composition.actors) {
        expect(actor.placeholder).not.toHaveLength(0);
        expect(actor.label).not.toHaveLength(0);
        expect(actor.hitBounds.width).toBeGreaterThan(0);
        expect(actor.hitBounds.height).toBeGreaterThan(0);
        expect(actor.compact.width).toBeGreaterThan(0);
        expect(actor.entrance).not.toEqual(actor.exit);
      }
    }
  });

  it('rejects duplicate keys and invalid actor interaction geometry', () => {
    const invalid = structuredClone(SCENE_COMPOSITIONS.shop);
    invalid.actors[0].key = invalid.background.key;
    invalid.actors[0].hitBounds.width = 0;
    expect(validateSceneComposition(invalid)).toEqual([
      'Duplicate scene layer key: shop-background',
      'shop-background must have positive hit bounds'
    ]);
  });

  it('only exposes actor controls when a scene supplies a selection callback', () => {
    expect(isSceneActorInteractive(undefined)).toBe(false);
    expect(isSceneActorInteractive(null)).toBe(false);
    expect(isSceneActorInteractive(() => undefined)).toBe(true);
  });
});
