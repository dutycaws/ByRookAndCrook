import { describe, expect, it } from 'vitest';
import { BAR_SCENE_TOUCH_TARGET_CAPACITY, barScenePatronPlacements, presentBarPatrons, reconcileBarSceneSelection, selectedBarPatron } from '$lib/game/bar-scene';

const patrons = [{ instanceId: 'lira' }, { instanceId: 'torvin' }];

describe('Bar scene selection', () => {
  it('keeps selection and focus independent while both guests remain present', () => {
    expect(reconcileBarSceneSelection(patrons, { selectedKey: 'lira', focusedKey: 'torvin' }))
      .toEqual({ selectedKey: 'lira', focusedKey: 'torvin' });
  });

  it('falls back to the first present patron if a selected or focused guest leaves', () => {
    expect(reconcileBarSceneSelection([{ instanceId: 'torvin' }], { selectedKey: 'lira', focusedKey: 'lira' }))
      .toEqual({ selectedKey: 'torvin', focusedKey: 'torvin' });
  });

  it('clears both keys for an empty room', () => {
    expect(reconcileBarSceneSelection([], { selectedKey: 'lira', focusedKey: 'lira' }))
      .toEqual({ selectedKey: null, focusedKey: null });
  });

  it('gets a nullable selected patron without inventing a fallback', () => {
    expect(selectedBarPatron(patrons, 'torvin')).toEqual({ instanceId: 'torvin' });
    expect(selectedBarPatron(patrons, null)).toBeNull();
    expect(selectedBarPatron(patrons, 'missing')).toBeNull();
  });

  it('projects only authoritative present residents and leaves an empty room empty', () => {
    expect(presentBarPatrons(patrons, {
      lira: { availability: 'present' }, torvin: { availability: 'removed' }
    })).toEqual([{ instanceId: 'lira' }]);
    expect(presentBarPatrons(patrons, { lira: { availability: 'removed' } })).toEqual([]);
  });

  it('gives a full roster twenty deterministic, non-overlapping and touch-sized hit regions', () => {
    const ids = Array.from({ length: BAR_SCENE_TOUCH_TARGET_CAPACITY }, (_, index) => `resident-${index.toString().padStart(2, '0')}`);
    const placements = barScenePatronPlacements([...ids].reverse());
    expect(placements.size).toBe(BAR_SCENE_TOUCH_TARGET_CAPACITY);
    expect([...placements.keys()]).toEqual(ids);
    const hitRegions = [...placements.values()].map((placement) => placement.hitBounds);
    expect(hitRegions.every((region) => region.width * .3 >= 44 && region.height * .3 >= 44)).toBe(true);
    expect([...placements.values()].every((placement) => (
      placement.compact.width / placement.width * placement.hitBounds.width * .3 >= 44
      && placement.compact.height / placement.height * placement.hitBounds.height * .3 >= 44
    ))).toBe(true);
    for (const [index, region] of hitRegions.entries()) {
      for (const comparison of hitRegions.slice(index + 1)) {
        expect(region.x + region.width <= comparison.x || comparison.x + comparison.width <= region.x || region.y + region.height <= comparison.y || comparison.y + comparison.height <= region.y).toBe(true);
      }
    }
  });

  it('keeps rendering every resident when the roster spans more than one RPC page', () => {
    const ids = Array.from({ length: 41 }, (_, index) => `resident-${index.toString().padStart(2, '0')}`);
    const placements = barScenePatronPlacements(ids);
    expect([...placements.keys()]).toEqual(ids);
    expect(new Set([...placements.values()].map((placement) => `${placement.x}:${placement.y}`)).size).toBe(ids.length);
  });
});
