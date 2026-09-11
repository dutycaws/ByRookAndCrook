import { describe, expect, it } from 'vitest';
import {
  GUIDED_STIR_GOOD_RADIANS,
  GUIDED_STIR_GRACE_MS,
  GUIDED_STIR_PERFECT_RADIANS,
  GUIDED_STIR_TOTAL_TICKS,
  advanceGuidedStir,
  beginGuidedPointer,
  createGuidedStirState,
  endGuidedPointer,
  foldPreviewTransform,
  gestureDistancePercent,
  guideAngleAt,
  guidedPointerSampleTime,
  handleGuidedKey,
  moveGuidedPointer,
  normalizeEllipsePoint,
  restoreGuidedStirState,
  serializeGuidedStirState,
  setGuidedStirVisibility,
  shortestAngleDelta,
  unwrapAngleDelta
} from '../../src/lib/game/scene-motion';

const ellipse = { centerX: 0, centerY: 0, radiusX: 200, radiusY: 50 };
const pointAt = (angle: number, timestamp: number, radius = 1) => ({
  x: Math.cos(angle) * ellipse.radiusX * radius,
  y: Math.sin(angle) * ellipse.radiusY * radius,
  timestamp
});
const stateAt = (now = 0, durationSeconds = 15, countdownSeconds = 2) =>
  createGuidedStirState({ startedAtMs: now, durationSeconds, countdownSeconds }, now);

function startClockwise(now = 0) {
  let state = stateAt(now);
  state = beginGuidedPointer(state, pointAt(0, now), ellipse, now).state;
  state = moveGuidedPointer(state, pointAt(Math.PI / 10, now + 100), ellipse, now + 100).state;
  return state;
}

function followGuide(eventStepMs: number, reducedMotion = false) {
  return followGuideTimes(
    Array.from({ length: Math.floor((17_000 - 200) / eventStepMs) + 1 }, (_, index) => 200 + index * eventStepMs),
    reducedMotion
  );
}

function followGuideTimes(eventTimes: number[], reducedMotion = false, coalescedBatchSize = 1) {
  let state = startClockwise();
  for (let offset = 0; offset < eventTimes.length; offset += coalescedBatchSize) {
    const batch = eventTimes.slice(offset, offset + coalescedBatchSize);
    const deliveredAt = batch.at(-1)!;
    let sampleClock = state.clockAt;
    for (const eventTime of batch) {
      const sampleAt = guidedPointerSampleTime(deliveredAt, deliveredAt, eventTime, sampleClock);
      const guide = guideAngleAt(state, sampleAt, reducedMotion);
      const pointerAngle = state.pointerAngle ?? 0;
      const nextPointerAngle = pointerAngle + shortestAngleDelta(guide - state.paddleAngle);
      state = moveGuidedPointer(state, pointAt(nextPointerAngle, sampleAt), ellipse, sampleAt, reducedMotion).state;
      sampleClock = state.clockAt;
    }
  }
  return advanceGuidedStir(state, 17_000, reducedMotion);
}

function movePaddleTo(state: ReturnType<typeof stateAt>, target: number, now: number) {
  const pointerAngle = state.pointerAngle ?? 0;
  const nextPointerAngle = pointerAngle + shortestAngleDelta(target - state.paddleAngle);
  return moveGuidedPointer(state, pointAt(nextPointerAngle, now), ellipse, now).state;
}

describe('guided stirring geometry', () => {
  it('normalizes an ellipse and unwraps both angle seams', () => {
    expect(normalizeEllipsePoint(pointAt(0, 0), ellipse)).toMatchObject({ x: 1, y: 0, radius: 1 });
    expect(normalizeEllipsePoint(pointAt(Math.PI / 2, 0), ellipse).angle).toBeCloseTo(Math.PI / 2);
    expect(unwrapAngleDelta(-Math.PI * 1.9)).toBeCloseTo(Math.PI * .1);
    expect(unwrapAngleDelta(Math.PI * 1.9)).toBeCloseTo(-Math.PI * .1);
    expect(shortestAngleDelta(Math.PI * 1.9)).toBeCloseTo(-Math.PI * .1);
  });

  it('maps coalesced sample timestamps onto one monotonic controller clock', () => {
    const first = guidedPointerSampleTime(10_000, 5_000, 4_750, 9_600);
    const second = guidedPointerSampleTime(10_000, 5_000, 4_925, first);
    const outOfOrder = guidedPointerSampleTime(10_000, 5_000, 4_800, second);
    expect([first, second, outOfOrder]).toEqual([9_750, 9_925, 9_925]);
    expect(guidedPointerSampleTime(10_000, Number.NaN, Number.NaN, 9_600)).toBe(10_000);
  });

  it('keeps Bakery gesture helpers bounded', () => {
    expect(gestureDistancePercent(10, 90, 100)).toBe(80);
    expect(foldPreviewTransform(0, 200, 100)).toEqual({
      translatePercent: 5,
      scaleX: 1.08,
      rotationDegrees: 3
    });
  });
});

describe('guide-v2 pointer controller', () => {
  it('uses a two-second countdown, 15 RPM guide, and exactly 60 score ticks', () => {
    let state = startClockwise();
    expect(advanceGuidedStir(state, 1_999).phase).toBe('countdown');
    state = advanceGuidedStir(state, 2_000);
    expect(state.phase).toBe('scored');
    expect(guideAngleAt(state, 3_000) - guideAngleAt(state, 2_000)).toBeCloseTo(Math.PI / 2);
    state = advanceGuidedStir(state, 17_000);
    expect(state).toMatchObject({ phase: 'complete', totalTicks: GUIDED_STIR_TOTAL_TICKS });
  });

  it('scores the same guide-following trace with regular, sparse, bursty, and coalesced delivery', () => {
    const regular = followGuide(50);
    const sparse = followGuide(250);
    const burstyTimes: number[] = [];
    for (let start = 200; start <= 17_000; start += 250) {
      burstyTimes.push(start, start + 25, start + 50);
    }
    const coalesced = followGuideTimes(
      Array.from({ length: Math.floor((17_000 - 200) / 50) + 1 }, (_, index) => 200 + index * 50),
      false,
      5
    );
    const results = [regular, sparse, followGuideTimes(burstyTimes.filter((time) => time <= 17_000)), coalesced];
    expect(results.map(({ totalTicks }) => totalTicks)).toEqual([60, 60, 60, 60]);
    expect(new Set(results.map(({ perfectTicks }) => perfectTicks)).size).toBe(1);
    expect(new Set(results.map(({ goodTicks }) => goodTicks)).size).toBe(1);
  });

  it('locks clockwise and counterclockwise after 15 degrees and crosses the seam', () => {
    for (const direction of [-1, 1] as const) {
      let state = stateAt();
      state = beginGuidedPointer(state, pointAt(direction * (Math.PI - .05), 0), ellipse, 0).state;
      state = moveGuidedPointer(state, pointAt(direction * (-Math.PI + .25), 100), ellipse, 100).state;
      expect(state.direction).toBe(direction);
      expect(state.inputKind).toBe('pointer');
    }
  });

  it('accepts the broad annulus but rejects its center and outside boundary', () => {
    let state = stateAt();
    expect(beginGuidedPointer(state, pointAt(0, 0, .44), ellipse, 0).accepted).toBe(false);
    expect(beginGuidedPointer(state, pointAt(0, 0, .45), ellipse, 0).accepted).toBe(true);
    expect(beginGuidedPointer(state, pointAt(0, 0, 1.55), ellipse, 0).accepted).toBe(true);
    expect(beginGuidedPointer(state, pointAt(0, 0, 1.56), ellipse, 0).accepted).toBe(false);

    state = beginGuidedPointer(state, pointAt(0, 0), ellipse, 0).state;
    const left = moveGuidedPointer(state, pointAt(.2, 100, 1.6), ellipse, 100);
    expect(left.accepted).toBe(false);
    expect(left.state.pointerActive).toBe(false);
  });

  it('reanchors without moving after a long gap or a jump over 90 degrees', () => {
    let state = beginGuidedPointer(stateAt(), pointAt(0, 0), ellipse, 0).state;
    const gap = moveGuidedPointer(state, pointAt(.5, 751), ellipse, 751);
    expect(gap.reanchored).toBe(true);
    expect(gap.state.paddleAngle).toBeCloseTo(Math.PI / 2);
    state = gap.state;
    const jump = moveGuidedPointer(state, pointAt(.5 + Math.PI / 2 + .01, 800), ellipse, 800);
    expect(jump.reanchored).toBe(true);
    expect(jump.state.paddleAngle).toBeCloseTo(Math.PI / 2);
  });

  it('does not let reversal jitter lock direction or renew forward grace', () => {
    let state = stateAt();
    state = beginGuidedPointer(state, pointAt(0, 0), ellipse, 0).state;
    for (let index = 1; index <= 12; index += 1) {
      const angle = index % 2 ? .12 : 0;
      state = moveGuidedPointer(state, pointAt(angle, index * 40), ellipse, index * 40).state;
    }
    expect(state.direction).toBeNull();
    expect(state.lastValidMovementAt).toBeNull();

    state = moveGuidedPointer(state, pointAt(.32, 520), ellipse, 520).state;
    expect(state.direction).toBe(1);
    const renewedAt = state.lastValidMovementAt;
    state = moveGuidedPointer(state, pointAt(.22, 560), ellipse, 560).state;
    state = moveGuidedPointer(state, pointAt(.32, 600), ellipse, 600).state;
    expect(state.lastValidMovementAt).toBe(renewedAt);
  });

  it('uses grace after release and awards no later positive ticks', () => {
    let state = startClockwise();
    state = advanceGuidedStir(state, 2_000);
    state = moveGuidedPointer(state, pointAt(guideAngleAt(state, 2_100), 2_100), ellipse, 2_100).state;
    state = endGuidedPointer(state, 2_100);
    state = advanceGuidedStir(state, 2_100 + GUIDED_STIR_GRACE_MS);
    const credited = state.perfectTicks + state.goodTicks;
    state = advanceGuidedStir(state, 4_000);
    expect(state.perfectTicks + state.goodTicks).toBe(credited);
    expect(state.totalTicks).toBeGreaterThan(credited);
  });

  it('uses the exact Perfect and Good angular boundaries', () => {
    for (const [error, expected] of [
      [GUIDED_STIR_PERFECT_RADIANS, 'perfect'],
      [GUIDED_STIR_PERFECT_RADIANS + .001, 'good'],
      [GUIDED_STIR_GOOD_RADIANS, 'good'],
      [GUIDED_STIR_GOOD_RADIANS + .001, 'catch-guide']
    ] as const) {
      let state = startClockwise();
      state = advanceGuidedStir(state, 2_000);
      state = moveGuidedPointer(state, pointAt(state.pointerAngle ?? 0, 2_000), ellipse, 2_000).state;
      const guide = guideAngleAt(state, 2_250);
      state = movePaddleTo(state, guide + error, 2_100);
      expect(advanceGuidedStir(state, 2_250).performance).toBe(expected);
    }
  });

  it('uses the visible quarter-turn guide for reduced motion scoring', () => {
    let state = startClockwise();
    state = advanceGuidedStir(state, 2_000, true);
    expect(guideAngleAt(state, 2_999, true)).toBeCloseTo(guideAngleAt(state, 2_000, true));
    expect(shortestAngleDelta(guideAngleAt(state, 3_000, true) - guideAngleAt(state, 2_000, true)))
      .toBeCloseTo(Math.PI / 2);
  });
});

describe('guide-v2 keyboard controller', () => {
  it('locks direction and rates the exact 250/500ms beat boundaries', () => {
    for (const [offset, expected] of [[250, 'perfect'], [251, 'good'], [500, 'good']] as const) {
      let state = advanceGuidedStir(stateAt(), 2_000);
      state = handleGuidedKey(state, 'ArrowRight', 2_000).state;
      const result = handleGuidedKey(state, ' ', 2_500 + offset);
      expect(result.result).toBe(expected);
      expect(result.state.perfectTicks).toBe(expected === 'perfect' ? 4 : 0);
      expect(result.state.goodTicks).toBe(expected === 'good' ? 4 : 0);
    }
  });

  it('ignores repeats, wrong direction, duplicate beats, and pointer input after keyboard locks', () => {
    let state = advanceGuidedStir(stateAt(), 2_000);
    state = handleGuidedKey(state, 'ArrowLeft', 2_000).state;
    expect(handleGuidedKey(state, 'ArrowRight', 2_500).accepted).toBe(false);
    expect(handleGuidedKey(state, 'ArrowLeft', 2_500, true).accepted).toBe(false);
    state = handleGuidedKey(state, 'Enter', 2_500).state;
    expect(handleGuidedKey(state, ' ', 2_500).accepted).toBe(false);
    expect(beginGuidedPointer(state, pointAt(0, 2_600), ellipse, 2_600).accepted).toBe(false);
  });

  it('can claim all fifteen beats for the same 60-tick maximum', () => {
    let state = advanceGuidedStir(stateAt(), 2_000);
    state = handleGuidedKey(state, 'ArrowRight', 2_000).state;
    for (let beat = 0; beat < 15; beat += 1) {
      state = handleGuidedKey(state, ' ', 2_500 + beat * 1_000).state;
    }
    state = advanceGuidedStir(state, 17_000);
    expect(state).toMatchObject({ perfectTicks: 60, goodTicks: 0, totalTicks: 60, phase: 'complete' });
  });
});

describe('guide-v2 persistence', () => {
  it('restores positive credit and gives hidden elapsed ticks zero credit', () => {
    let state = startClockwise();
    state = advanceGuidedStir(state, 2_500);
    const saved = serializeGuidedStirState(state);
    const restored = restoreGuidedStirState(saved, {
      startedAtMs: 0, durationSeconds: 15, countdownSeconds: 2
    }, 5_000);
    expect(restored.perfectTicks).toBe(state.perfectTicks);
    expect(restored.totalTicks).toBe(12);
    expect(restored.visible).toBe(true);
    expect(restored.pointerActive).toBe(false);
  });

  it('discards corrupt and out-of-range storage into a recoverable zero-credit remainder', () => {
    const config = { startedAtMs: 0, durationSeconds: 15, countdownSeconds: 2 };
    const validPointer = JSON.parse(serializeGuidedStirState(startClockwise())) as Record<string, unknown>;
    const impossiblePointerCredit = JSON.stringify({
      ...validPointer, scoringCursor: 0, perfectTicks: 60, goodTicks: 0
    });
    let keyboard = advanceGuidedStir(stateAt(), 2_000);
    keyboard = handleGuidedKey(keyboard, 'ArrowRight', 2_000).state;
    keyboard = handleGuidedKey(keyboard, ' ', 2_500).state;
    const impossibleKeyboardCredit = JSON.stringify({
      ...JSON.parse(serializeGuidedStirState(keyboard)), claimedKeyboardBeats: [], perfectTicks: 60
    });
    for (const value of [
      'bad json',
      JSON.stringify({ version: 'guide-v2', perfectTicks: 999 }),
      impossiblePointerCredit,
      impossibleKeyboardCredit
    ]) {
      const restored = restoreGuidedStirState(value, config, 5_000);
      expect(restored.perfectTicks).toBe(0);
      expect(restored.goodTicks).toBe(0);
      expect(restored.totalTicks).toBe(12);
    }
  });

  it('visibility changes process elapsed time without positive credit', () => {
    let state = startClockwise();
    state = advanceGuidedStir(state, 2_250);
    state = setGuidedStirVisibility(state, false, 2_250);
    const credited = state.perfectTicks;
    state = setGuidedStirVisibility(state, true, 4_250);
    expect(state.perfectTicks).toBe(credited);
    expect(state.totalTicks).toBe(9);
  });
});
