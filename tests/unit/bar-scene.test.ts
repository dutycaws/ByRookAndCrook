import { describe, expect, it } from 'vitest';
import { BAR_SCENE_TOUCH_TARGET_CAPACITY, barSceneCameraForFocus, barScenePatronPlacements, presentBarPatrons, reconcileBarSceneSelection, selectedBarPatron } from '$lib/game/bar-scene';
import { getSceneComposition } from '$lib/presentation/scene-composition';

const patrons = [{ instanceId: 'lira' }, { instanceId: 'torvin' }];

describe('Bar compact scene art bounds', () => {
  it.each([372, 320])('covers the full %ipx 3:2 overview frame without moving actors', (viewportWidth) => {
    const { plane, background, foreground, actors } = getSceneComposition('bar');
    const viewportHeight = viewportWidth * 2 / 3;
    const scale = viewportHeight / plane.height;
    const planeLeft = (viewportWidth - plane.width * scale) / 2;
    const visibleLeft = -planeLeft / scale;
    const visibleRight = (viewportWidth - planeLeft) / scale;
    const artLayers = [background, ...foreground];

    for (const layer of artLayers) {
      expect(layer.compact.x).toBeLessThanOrEqual(visibleLeft);
      expect(layer.compact.x + layer.compact.width).toBeGreaterThanOrEqual(visibleRight);
    }
    expect(actors.map(({ compact }) => compact.x)).toEqual([148, 500]);
  });
});

describe('Bar scene selection', () => {
  it('keeps selection and focus independent while both guests remain present', () => {
    expect(reconcileBarSceneSelection(patrons, { selectedKey: 'lira', focusedKey: 'torvin' }))
      .toEqual({ selectedKey: 'lira', focusedKey: 'torvin' });
  });

  it('starts in overview with no selected patron and a roving keyboard target', () => {
    expect(reconcileBarSceneSelection(patrons, { selectedKey: null, focusedKey: null }))
      .toEqual({ selectedKey: null, focusedKey: 'lira' });
  });

  it('clears a selection when its patron leaves and gives focus a valid roving target', () => {
    expect(reconcileBarSceneSelection([{ instanceId: 'torvin' }], { selectedKey: 'lira', focusedKey: 'lira' }))
      .toEqual({ selectedKey: null, focusedKey: 'torvin' });
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

  it('keeps a focused resident and the full scene plane inside desktop and mobile frames', () => {
    for (const mobile of [false, true]) {
      const viewport = mobile ? { viewportWidth: 390, viewportHeight: 260 } : { viewportWidth: 1100, viewportHeight: 620 };
      const transform = barSceneCameraForFocus({
        ...viewport,
        designWidth: 1672,
        designHeight: 941,
        mobile,
        target: { x: 1320, y: 700, width: 290, height: 220 }
      });
      const baseScale = mobile ? viewport.viewportHeight / 941 : viewport.viewportWidth / 1672;
      const offsetX = mobile ? (viewport.viewportWidth - 1672 * baseScale) / 2 : 0;
      const visibleLeft = Math.max(0, -offsetX / baseScale);
      const visibleRight = visibleLeft + viewport.viewportWidth / baseScale;
      const visibleBottom = viewport.viewportHeight / baseScale;
      const left = transform.x + 1320 * transform.scale;
      const right = transform.x + (1320 + 290) * transform.scale;
      const faceY = transform.y + (700 + 220 * 0.32) * transform.scale;

      expect(transform.x).toBeLessThanOrEqual(visibleLeft);
      expect(transform.x + 1672 * transform.scale).toBeGreaterThanOrEqual(visibleRight);
      expect(transform.y).toBeLessThanOrEqual(0);
      expect(transform.y + 941 * transform.scale).toBeGreaterThanOrEqual(visibleBottom);
      expect(left).toBeGreaterThanOrEqual(visibleLeft);
      expect(right).toBeLessThanOrEqual(visibleRight);
      expect(faceY).toBeGreaterThanOrEqual(0);
      expect(faceY).toBeLessThanOrEqual(visibleBottom);
    }
  });

  it('uses authored pilot bounds to keep the face near the focus line', () => {
    for (const mobile of [false, true]) {
      const viewport = mobile
        ? { viewportWidth: 390, viewportHeight: 260, target: { x: 148, y: 80, width: 610, height: 729 } }
        : { viewportWidth: 1100, viewportHeight: 620, target: { x: 408, y: 42, width: 690, height: 825 } };
      const transform = barSceneCameraForFocus({
        viewportWidth: viewport.viewportWidth,
        viewportHeight: viewport.viewportHeight,
        designWidth: 1672,
        designHeight: 941,
        mobile,
        target: viewport.target
      });
      const baseScale = mobile ? viewport.viewportHeight / 941 : viewport.viewportWidth / 1672;
      const faceY = transform.y + (viewport.target.y + viewport.target.height * 0.32) * transform.scale;
      expect(faceY / (viewport.viewportHeight / baseScale)).toBeGreaterThanOrEqual(0.2);
      expect(faceY / (viewport.viewportHeight / baseScale)).toBeLessThanOrEqual(0.4);
    }
  });

  it('keeps the unfocused camera settled when there is no selected resident', () => {
    expect(barSceneCameraForFocus({
      viewportWidth: 1100, viewportHeight: 620, designWidth: 1672, designHeight: 941,
      mobile: false, target: null
    })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
