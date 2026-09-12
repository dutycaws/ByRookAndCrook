import { describe, expect, it } from 'vitest';
import {
  clampGardenPan,
  createGardenCamera,
  focusGardenPoint,
  gardenCameraScale,
  panGardenCamera,
  zoomGardenCameraAt
} from '../../src/lib/game/garden-camera';

const viewport = { width: 100, height: 80 };
const board = { width: 200, height: 100 };

describe('garden camera geometry', () => {
  it('fits every board dimension and centres an axis that is smaller than the frame', () => {
    const camera = createGardenCamera(viewport, board);
    expect(camera.fitScale).toBe(0.5);
    expect(camera.zoom).toBe(1);
    expect(camera.panX).toBe(0);
    expect(camera.panY).toBe(15);
  });

  it('clamps panning to the board and never leaves a blank edge at zoom', () => {
    const camera = createGardenCamera(viewport, board, 2);
    expect(panGardenCamera(camera, viewport, board, 900, 900)).toMatchObject({ panX: 0, panY: 0 });
    expect(panGardenCamera(camera, viewport, board, -900, -900)).toMatchObject({ panX: -100, panY: -20 });
    expect(clampGardenPan({ ...camera, panX: -50, panY: 50 }, viewport, board)).toEqual({ panX: -50, panY: 0 });
  });

  it('zooms around the supplied wheel or pinch anchor and caps at three-times fit', () => {
    const camera = createGardenCamera(viewport, board);
    const zoomed = zoomGardenCameraAt(camera, viewport, board, 2, 25, 40);
    expect(gardenCameraScale(zoomed)).toBe(1);
    expect(zoomed.panX).toBe(-25);
    expect(zoomGardenCameraAt(zoomed, viewport, board, 9).zoom).toBe(3);
  });

  it('brings an offscreen focused plot into the bounded viewport', () => {
    const camera = createGardenCamera(viewport, board, 2);
    expect(focusGardenPoint(camera, viewport, board, { x: 190, y: 90 })).toMatchObject({ panX: -100, panY: -20 });
  });
});
