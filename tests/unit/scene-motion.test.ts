import { describe, expect, it } from 'vitest';
import {
  STIR_DECAY_MS,
  STIR_IDLE_MS,
  STIR_MAX_RPM,
  STIR_REANCHOR_GAP_MS,
  advanceStirPhase,
  angularSpeedRpm,
  beginCircularStir,
  classifyStirRpm,
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

  it('maps either-direction angular movement to low, bounded RPM', () => {
    expect(angularSpeedRpm(Math.PI / 2, 1000)).toBeCloseTo(15);
    expect(angularSpeedRpm(-Math.PI / 2, 1000)).toBeCloseTo(15);
    expect(angularSpeedRpm(Math.PI * 2, 500)).toBe(STIR_MAX_RPM);
  });

  it('classifies the exact low-RPM quality boundaries', () => {
    expect(classifyStirRpm(5.99)).toBe('slow');
    expect(classifyStirRpm(6)).toBe('good');
    expect(classifyStirRpm(10)).toBe('perfect');
    expect(classifyStirRpm(20)).toBe('perfect');
    expect(classifyStirRpm(24)).toBe('good');
    expect(classifyStirRpm(24.01)).toBe('fast');
  });

  it('ignores the inner dead zone and reanchors after long event gaps', () => {
    let state = beginCircularStir(createCircularStirState(), point(10, 5, 0), ellipse);
    expect(state.lastAngle).toBeNull();
    let update = sampleCircularStir(state, point(200, 0, 20), ellipse);
    expect(update.reanchored).toBe(true);
    state = update.state;
    update = sampleCircularStir(state, point(0, 50, 20 + STIR_REANCHOR_GAP_MS + 1), ellipse);
    expect(update.reanchored).toBe(true);
    expect(update.state.speed).toBe(0);
  });

  it('rejects nonpositive time and smooths accepted samples over 500ms', () => {
    let state = beginCircularStir(createCircularStirState(), ellipsePoint(0, 100), ellipse);
    const rejected = sampleCircularStir(state, ellipsePoint(.1 * Math.PI, 100), ellipse);
    expect(rejected.accepted).toBe(false);
    state = sampleCircularStir(state, ellipsePoint(.1 * Math.PI, 200), ellipse).state;
    state = sampleCircularStir(state, ellipsePoint(.2 * Math.PI, 300), ellipse).state;
    expect(state.speed).toBeCloseTo(30);
  });

  it('keeps irregular clockwise and counter-clockwise 15 RPM input in the perfect band', () => {
    for (const direction of [-1, 1]) {
      let timestamp = 0;
      let angle = 0;
      let state = beginCircularStir(createCircularStirState(), ellipsePoint(angle, timestamp), ellipse);
      for (const elapsed of [80, 125, 95, 140, 60]) {
        timestamp += elapsed;
        angle += direction * 15 * Math.PI * 2 * elapsed / 60_000;
        state = sampleCircularStir(state, ellipsePoint(angle, timestamp), ellipse).state;
      }
      expect(state.speed).toBeCloseTo(15);
      expect(classifyStirRpm(state.speed)).toBe('perfect');
    }
  });

  it('decays released and idle motion to zero over 400ms', () => {
    let state = beginCircularStir(createCircularStirState(), point(200, 0, 0), ellipse);
    state = sampleCircularStir(state, point(0, 50, 50), ellipse).state;
    const released = releaseCircularStir(state, 60);
    expect(tickCircularStir(released, 60 + STIR_DECAY_MS / 2).speed).toBeCloseTo(state.speed / 2);
    expect(tickCircularStir(released, 60 + STIR_DECAY_MS).speed).toBe(0);

    state = { ...state, lastMovementAt: 50 };
    const idleStartedAt = 50 + STIR_IDLE_MS;
    expect(tickCircularStir(state, idleStartedAt).decayStartedAt).toBe(idleStartedAt);
    expect(tickCircularStir(tickCircularStir(state, idleStartedAt), idleStartedAt + STIR_DECAY_MS).speed).toBe(0);
  });

  it('advances visual phase from the same speed while bounding fold previews', () => {
    expect(advanceStirPhase(0, 15, 1, 1000)).toBeCloseTo(Math.PI / 2);
    expect(advanceStirPhase(0, 15, -1, 1000)).toBeCloseTo(Math.PI * 1.5);
    expect(gestureDistancePercent(10, 90, 100)).toBe(80);
    expect(foldPreviewTransform(0, 200, 100)).toEqual({
      translatePercent: 5,
      scaleX: 1.08,
      rotationDegrees: 3
    });
  });
});
