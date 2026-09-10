import { describe, expect, it } from 'vitest';
import {
  STIR_DECAY_MS,
  advanceStirPhase,
  angularSpeedPercent,
  beginCircularStir,
  createCircularStirState,
  foldPreviewTransform,
  gestureDistancePercent,
  normalizeEllipsePoint,
  releaseCircularStir,
  sampleCircularStir,
  tickCircularStir,
  unwrapAngleDelta
} from '../../src/lib/game/scene-motion';

const ellipse = { centerX: 0, centerY: 0, radiusX: 200, radiusY: 50 };
const point = (x: number, y: number, timestamp: number) => ({ x, y, timestamp });
const ellipsePoint = (angle: number, timestamp: number) => point(
  Math.cos(angle) * ellipse.radiusX,
  Math.sin(angle) * ellipse.radiusY,
  timestamp
);

describe('layered scene motion', () => {
  it('normalizes an ellipse before measuring the pointer angle', () => {
    expect(normalizeEllipsePoint(point(200, 0, 0), ellipse)).toMatchObject({ x: 1, y: 0, radius: 1 });
    expect(normalizeEllipsePoint(point(0, 50, 0), ellipse).angle).toBeCloseTo(Math.PI / 2);
  });

  it('unwraps signed angular deltas across the pi seam', () => {
    expect(unwrapAngleDelta(-Math.PI * 1.9)).toBeCloseTo(Math.PI * 0.1);
    expect(unwrapAngleDelta(Math.PI * 1.9)).toBeCloseTo(-Math.PI * 0.1);
  });

  it('maps either-direction half-revolutions per second to speed 50', () => {
    expect(angularSpeedPercent(Math.PI / 2, 500)).toBeCloseTo(50);
    expect(angularSpeedPercent(-Math.PI / 2, 500)).toBeCloseTo(50);
  });

  it('ignores the inner dead zone and reanchors after long event gaps', () => {
    let state = beginCircularStir(createCircularStirState(), point(10, 5, 0), ellipse);
    expect(state.lastAngle).toBeNull();
    let update = sampleCircularStir(state, point(200, 0, 20), ellipse);
    expect(update.reanchored).toBe(true);
    state = update.state;
    update = sampleCircularStir(state, point(0, 50, 250), ellipse);
    expect(update.reanchored).toBe(true);
    expect(update.state.speed).toBe(0);
  });

  it('rejects nonpositive time and smooths accepted samples over 120ms', () => {
    let state = beginCircularStir(createCircularStirState(), ellipsePoint(0, 100), ellipse);
    const rejected = sampleCircularStir(state, ellipsePoint(.1 * Math.PI, 100), ellipse);
    expect(rejected.accepted).toBe(false);
    state = sampleCircularStir(state, ellipsePoint(.1 * Math.PI, 200), ellipse).state;
    state = sampleCircularStir(state, ellipsePoint(.2 * Math.PI, 300), ellipse).state;
    expect(state.speed).toBeCloseTo(50);
  });

  it('decays released and idle motion to zero over 400ms', () => {
    let state = beginCircularStir(createCircularStirState(), point(200, 0, 0), ellipse);
    state = sampleCircularStir(state, point(0, 50, 50), ellipse).state;
    const released = releaseCircularStir(state, 60);
    expect(tickCircularStir(released, 60 + STIR_DECAY_MS / 2).speed).toBeCloseTo(state.speed / 2);
    expect(tickCircularStir(released, 60 + STIR_DECAY_MS).speed).toBe(0);

    state = { ...state, lastMovementAt: 50 };
    expect(tickCircularStir(state, 170).decayStartedAt).toBe(170);
    expect(tickCircularStir(tickCircularStir(state, 170), 570).speed).toBe(0);
  });

  it('advances visual phase from the same speed while bounding fold previews', () => {
    expect(advanceStirPhase(0, 50, 1, 1000)).toBeCloseTo(Math.PI);
    expect(advanceStirPhase(0, 50, -1, 1000)).toBeCloseTo(Math.PI);
    expect(gestureDistancePercent(10, 90, 100)).toBe(80);
    expect(foldPreviewTransform(0, 200, 100)).toEqual({
      translatePercent: 5,
      scaleX: 1.08,
      rotationDegrees: 3
    });
  });
});
