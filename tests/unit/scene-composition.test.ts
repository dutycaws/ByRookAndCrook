import { describe, expect, it } from 'vitest';
import {
  SCENE_COMPOSITIONS,
  SCENE_COMPOSITION_VERSION,
  getSceneComposition,
  isSceneActorInteractive,
  validateSceneComposition
} from '$lib/presentation/scene-composition';

function polygonContainsPoint(polygon: readonly (readonly [number, number])[], point: readonly [number, number]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const crosses = (y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}

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

  it('keeps each authored Bar sprite’s visible alpha inside its hit region in desktop and compact frames', () => {
    // Pixel bounds are from the two 600×900 local WebP derivatives. The scene
    // renders each asset with object-fit: contain and object-position: center bottom.
    const sourcePixels = {
      'bar-lira': { width: 600, height: 900, alpha: { x: 100, y: 77, width: 392, height: 772 } },
      'bar-torvin': { width: 600, height: 900, alpha: { x: 0, y: 8, width: 592, height: 892 } }
    } as const;
    const actors = getSceneComposition('bar').actors;

    for (const actor of actors) {
      const source = sourcePixels[actor.key as keyof typeof sourcePixels];
      for (const frame of [actor, actor.compact]) {
        const scale = Math.min(frame.width / source.width, frame.height / source.height);
        const imageWidth = source.width * scale;
        const imageHeight = source.height * scale;
        const visible = {
          x: frame.x + (frame.width - imageWidth) / 2 + source.alpha.x * scale,
          y: frame.y + frame.height - imageHeight + source.alpha.y * scale,
          right: frame.x + (frame.width - imageWidth) / 2 + (source.alpha.x + source.alpha.width) * scale,
          bottom: frame.y + frame.height - imageHeight + (source.alpha.y + source.alpha.height) * scale
        };
        const scaleX = frame.width / actor.width;
        const scaleY = frame.height / actor.height;
        const hit = {
          x: frame.x + (actor.hitBounds.x - actor.x) * scaleX,
          y: frame.y + (actor.hitBounds.y - actor.y) * scaleY,
          right: frame.x + (actor.hitBounds.x + actor.hitBounds.width - actor.x) * scaleX,
          bottom: frame.y + (actor.hitBounds.y + actor.hitBounds.height - actor.y) * scaleY
        };

        expect(hit.x).toBeLessThanOrEqual(visible.x);
        expect(hit.y).toBeLessThanOrEqual(visible.y);
        expect(hit.right).toBeGreaterThanOrEqual(visible.right);
        expect(hit.bottom).toBeGreaterThanOrEqual(visible.bottom);
      }
    }
  });

  it('routes clicks through Torvin’s transparent left corridor while retaining silhouette targets', () => {
    const torvin = getSceneComposition('bar').actors.find((actor) => actor.key === 'bar-torvin');
    expect(torvin?.hitAreaPolygon).toBeDefined();
    const polygon = torvin!.hitAreaPolygon!;
    const sourcePoint = (x: number, y: number): [number, number] => [x / 592, (y - 8) / 892];

    expect(polygonContainsPoint(polygon, sourcePoint(46, 541))).toBe(false);
    expect(polygonContainsPoint(polygon, sourcePoint(95, 300))).toBe(true);
    expect(polygonContainsPoint(polygon, sourcePoint(300, 300))).toBe(true);
    expect(polygonContainsPoint(polygon, sourcePoint(400, 800))).toBe(true);
  });

  it('only exposes actor controls when a scene supplies a selection callback', () => {
    expect(isSceneActorInteractive(undefined)).toBe(false);
    expect(isSceneActorInteractive(null)).toBe(false);
    expect(isSceneActorInteractive(() => undefined)).toBe(true);
  });
});
