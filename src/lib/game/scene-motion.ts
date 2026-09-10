export const SCENE_WIDTH = 1672;
export const SCENE_HEIGHT = 941;

export const STIR_DEAD_ZONE = 0.25;
export const STIR_REANCHOR_GAP_MS = 750;
export const STIR_SMOOTHING_WINDOW_MS = 500;
export const STIR_IDLE_MS = 500;
export const STIR_DECAY_MS = 400;
export const STIR_MAX_RPM = 40;

export interface ScenePoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface Ellipse {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

export interface NormalizedEllipsePoint {
  x: number;
  y: number;
  radius: number;
  angle: number;
}

interface SpeedSample {
  timestamp: number;
  radians: number;
  elapsedMs: number;
}

export type StirZone = 'slow' | 'good' | 'perfect' | 'fast';

export interface CircularStirState {
  dragging: boolean;
  lastAngle: number | null;
  lastTimestamp: number | null;
  lastMovementAt: number | null;
  speed: number;
  direction: -1 | 1;
  samples: SpeedSample[];
  decayStartedAt: number | null;
  decayStartSpeed: number;
}

export interface CircularStirUpdate {
  state: CircularStirState;
  accepted: boolean;
  reanchored: boolean;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createCircularStirState(): CircularStirState {
  return {
    dragging: false,
    lastAngle: null,
    lastTimestamp: null,
    lastMovementAt: null,
    speed: 0,
    direction: 1,
    samples: [],
    decayStartedAt: null,
    decayStartSpeed: 0
  };
}

export function normalizeEllipsePoint(point: ScenePoint, ellipse: Ellipse): NormalizedEllipsePoint {
  const x = (point.x - ellipse.centerX) / ellipse.radiusX;
  const y = (point.y - ellipse.centerY) / ellipse.radiusY;
  return { x, y, radius: Math.hypot(x, y), angle: Math.atan2(y, x) };
}

export function unwrapAngleDelta(delta: number): number {
  let unwrapped = delta;
  while (unwrapped > Math.PI) unwrapped -= Math.PI * 2;
  while (unwrapped < -Math.PI) unwrapped += Math.PI * 2;
  return unwrapped;
}

export function angularSpeedRpm(deltaRadians: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const revolutionsPerMinute = Math.abs(deltaRadians) / (Math.PI * 2) / (elapsedMs / 60_000);
  return clamp(revolutionsPerMinute, 0, STIR_MAX_RPM);
}

export function classifyStirRpm(rpm: number): StirZone {
  if (rpm >= 10 && rpm <= 20) return 'perfect';
  if (rpm >= 6 && rpm <= 24) return 'good';
  return rpm < 6 ? 'slow' : 'fast';
}

export function stirRpmPercent(rpm: number): number {
  return clamp(rpm / STIR_MAX_RPM * 100, 0, 100);
}

function anchorState(
  state: CircularStirState,
  point: ScenePoint,
  normalized: NormalizedEllipsePoint,
  clearSamples = false
): CircularStirState {
  return {
    ...state,
    lastAngle: normalized.angle,
    lastTimestamp: point.timestamp,
    lastMovementAt: point.timestamp,
    samples: clearSamples ? [] : state.samples,
    decayStartedAt: null,
    decayStartSpeed: 0
  };
}

export function beginCircularStir(
  state: CircularStirState,
  point: ScenePoint,
  ellipse: Ellipse
): CircularStirState {
  const normalized = normalizeEllipsePoint(point, ellipse);
  const started = {
    ...state,
    dragging: true,
    lastAngle: null,
    lastTimestamp: null,
    lastMovementAt: point.timestamp,
    samples: [],
    decayStartedAt: null,
    decayStartSpeed: 0
  };
  return normalized.radius < STIR_DEAD_ZONE ? started : anchorState(started, point, normalized, true);
}

export function sampleCircularStir(
  state: CircularStirState,
  point: ScenePoint,
  ellipse: Ellipse
): CircularStirUpdate {
  if (!state.dragging) return { state, accepted: false, reanchored: false };
  const normalized = normalizeEllipsePoint(point, ellipse);
  if (normalized.radius < STIR_DEAD_ZONE) {
    return { state, accepted: false, reanchored: false };
  }
  if (state.lastAngle === null || state.lastTimestamp === null) {
    return { state: anchorState(state, point, normalized, true), accepted: false, reanchored: true };
  }

  const elapsedMs = point.timestamp - state.lastTimestamp;
  if (elapsedMs <= 0) return { state, accepted: false, reanchored: false };
  if (elapsedMs > STIR_REANCHOR_GAP_MS) {
    return { state: anchorState(state, point, normalized, true), accepted: false, reanchored: true };
  }

  const delta = unwrapAngleDelta(normalized.angle - state.lastAngle);
  if (Math.abs(delta) < 0.0001) {
    return {
      state: { ...state, lastAngle: normalized.angle, lastTimestamp: point.timestamp },
      accepted: false,
      reanchored: false
    };
  }

  const samples = [...state.samples, { timestamp: point.timestamp, radians: Math.abs(delta), elapsedMs }]
    .filter((sample) => point.timestamp - sample.timestamp <= STIR_SMOOTHING_WINDOW_MS);
  const totalRadians = samples.reduce((total, sample) => total + sample.radians, 0);
  const totalElapsedMs = samples.reduce((total, sample) => total + sample.elapsedMs, 0);
  const speed = angularSpeedRpm(totalRadians, totalElapsedMs);
  return {
    state: {
      ...state,
      lastAngle: normalized.angle,
      lastTimestamp: point.timestamp,
      lastMovementAt: point.timestamp,
      speed,
      direction: delta < 0 ? -1 : 1,
      samples,
      decayStartedAt: null,
      decayStartSpeed: 0
    },
    accepted: true,
    reanchored: false
  };
}

export function releaseCircularStir(state: CircularStirState, timestamp: number): CircularStirState {
  if (state.speed <= 0) {
    return { ...state, dragging: false, decayStartedAt: null, decayStartSpeed: 0, samples: [] };
  }
  return {
    ...state,
    dragging: false,
    decayStartedAt: timestamp,
    decayStartSpeed: state.speed,
    samples: []
  };
}

export function tickCircularStir(state: CircularStirState, timestamp: number): CircularStirState {
  let current = state;
  if (
    current.dragging &&
    current.speed > 0 &&
    current.decayStartedAt === null &&
    current.lastMovementAt !== null &&
    timestamp - current.lastMovementAt >= STIR_IDLE_MS
  ) {
    current = {
      ...current,
      decayStartedAt: current.lastMovementAt + STIR_IDLE_MS,
      decayStartSpeed: current.speed,
      samples: []
    };
  }
  if (current.decayStartedAt === null) return current;

  const progress = clamp((timestamp - current.decayStartedAt) / STIR_DECAY_MS, 0, 1);
  const speed = current.decayStartSpeed * (1 - progress);
  if (progress >= 1) {
    return {
      ...current,
      speed: 0,
      decayStartedAt: null,
      decayStartSpeed: 0,
      samples: [],
      lastAngle: current.dragging ? current.lastAngle : null,
      lastTimestamp: current.dragging ? current.lastTimestamp : null
    };
  }
  return { ...current, speed };
}

export function advanceStirPhase(
  phase: number,
  speed: number,
  direction: -1 | 1,
  elapsedMs: number
): number {
  if (elapsedMs <= 0 || speed <= 0) return phase;
  const radians = direction * Math.PI * 2 * (speed / 60) * (elapsedMs / 1000);
  const next = (phase + radians) % (Math.PI * 2);
  return next < 0 ? next + Math.PI * 2 : next;
}

export function gestureDistancePercent(startX: number, endX: number, width: number): number {
  return Math.round(clamp(Math.abs(endX - startX) / Math.max(1, width) * 100, 0, 100));
}

export function foldPreviewTransform(startX: number, currentX: number, width: number) {
  const signedProgress = clamp((currentX - startX) / Math.max(1, width), -1, 1);
  return {
    translatePercent: signedProgress * 5,
    scaleX: 1 + Math.abs(signedProgress) * 0.08,
    rotationDegrees: signedProgress * 3
  };
}
