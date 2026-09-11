export const SCENE_WIDTH = 1672;
export const SCENE_HEIGHT = 941;

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

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

export function guidedPointerSampleTime(
  receivedAt: number,
  envelopeTimeStamp: number,
  sampleTimeStamp: number,
  notBefore: number
): number {
  const lag = Number.isFinite(envelopeTimeStamp) && Number.isFinite(sampleTimeStamp)
    ? Math.max(0, envelopeTimeStamp - sampleTimeStamp)
    : 0;
  return Math.max(notBefore, receivedAt - lag);
}

export const GUIDED_STIR_RULES_VERSION = 'guide-v2' as const;
export const GUIDED_STIR_COUNTDOWN_MS = 2_000;
export const GUIDED_STIR_DURATION_MS = 15_000;
export const GUIDED_STIR_GUIDE_RPM = 15;
export const GUIDED_STIR_TICK_MS = 250;
export const GUIDED_STIR_TOTAL_TICKS = GUIDED_STIR_DURATION_MS / GUIDED_STIR_TICK_MS;
export const GUIDED_STIR_PERFECT_RADIANS = Math.PI / 8;
export const GUIDED_STIR_GOOD_RADIANS = Math.PI / 4;
export const GUIDED_STIR_GRACE_MS = 500;
export const GUIDED_STIR_REANCHOR_MS = 750;
export const GUIDED_STIR_MAX_JUMP_RADIANS = Math.PI / 2;
export const GUIDED_STIR_DIRECTION_LOCK_RADIANS = Math.PI / 12;
export const GUIDED_STIR_FORWARD_RENEW_RADIANS = Math.PI / 36;
export const GUIDED_STIR_MIN_RADIUS = .45;
export const GUIDED_STIR_MAX_RADIUS = 1.55;

export type GuidedStirPhase = 'countdown' | 'scored' | 'complete';
export type GuidedStirInputKind = 'none' | 'pointer' | 'keyboard';
export type GuidedStirDirection = -1 | 1;
export type GuidedStirPerformance =
  | 'ready'
  | 'choose-direction'
  | 'finding-rhythm'
  | 'perfect'
  | 'good'
  | 'catch-guide'
  | 'grace'
  | 'complete';

export interface GuidedStirConfig {
  startedAtMs: number;
  durationSeconds: number;
  countdownSeconds: number;
}

export interface GuidedStirState extends GuidedStirConfig {
  version: typeof GUIDED_STIR_RULES_VERSION;
  clockAt: number;
  phase: GuidedStirPhase;
  inputKind: GuidedStirInputKind;
  direction: GuidedStirDirection | null;
  paddleAngle: number;
  guideOrigin: number | null;
  guideStartedAt: number | null;
  pointerActive: boolean;
  pointerAngle: number | null;
  pointerAt: number | null;
  directionProgress: number;
  pendingForwardProgress: number;
  netForwardProgress: number;
  lastValidMovementAt: number | null;
  scoringCursor: number;
  perfectTicks: number;
  goodTicks: number;
  totalTicks: number;
  claimedKeyboardBeats: number[];
  lastKeyboardResult: 'perfect' | 'good' | 'miss' | null;
  lastKeyboardAt: number | null;
  visible: boolean;
  performance: GuidedStirPerformance;
}

export interface GuidedPointerUpdate {
  state: GuidedStirState;
  accepted: boolean;
  reanchored: boolean;
}

export interface GuidedKeyUpdate {
  state: GuidedStirState;
  accepted: boolean;
  result: 'direction' | 'perfect' | 'good' | 'miss' | null;
}

export interface GuidedStirTelemetry {
  phase: GuidedStirPhase;
  inputKind: GuidedStirInputKind;
  direction: GuidedStirDirection | null;
  performance: GuidedStirPerformance;
  remainingMs: number;
  perfectTicks: number;
  goodTicks: number;
  totalTicks: number;
  targetTicks: number;
  progress: number;
  paddleAngle: number;
  guideAngle: number;
}

interface GuidedStirStoredState {
  version: typeof GUIDED_STIR_RULES_VERSION;
  direction: GuidedStirDirection | null;
  inputKind: GuidedStirInputKind;
  guideOrigin: number | null;
  guideStartedAt: number | null;
  paddleAngle: number;
  directionProgress: number;
  pendingForwardProgress: number;
  netForwardProgress: number;
  lastValidMovementAt: number | null;
  scoringCursor: number;
  perfectTicks: number;
  goodTicks: number;
  claimedKeyboardBeats: number[];
}

function scoredStart(state: GuidedStirState | GuidedStirConfig): number {
  return state.startedAtMs + state.countdownSeconds * 1_000;
}

function challengeEnd(state: GuidedStirState | GuidedStirConfig): number {
  return scoredStart(state) + state.durationSeconds * 1_000;
}

function targetTicks(state: GuidedStirState | GuidedStirConfig): number {
  return state.durationSeconds * 4;
}

export function shortestAngleDelta(delta: number): number {
  return unwrapAngleDelta(delta);
}

function normalizedAngle(angle: number): number {
  const next = angle % (Math.PI * 2);
  return next < 0 ? next + Math.PI * 2 : next;
}

function phaseAt(state: GuidedStirState | GuidedStirConfig, now: number): GuidedStirPhase {
  if (now < scoredStart(state)) return 'countdown';
  return now < challengeEnd(state) ? 'scored' : 'complete';
}

export function createGuidedStirState(config: GuidedStirConfig, now = config.startedAtMs): GuidedStirState {
  if (!Number.isFinite(config.startedAtMs) || !Number.isInteger(config.durationSeconds)
    || config.durationSeconds <= 0 || !Number.isInteger(config.countdownSeconds)
    || config.countdownSeconds < 0) {
    throw new Error('Invalid guided stir configuration');
  }
  const initial: GuidedStirState = {
    ...config,
    version: GUIDED_STIR_RULES_VERSION,
    clockAt: config.startedAtMs,
    phase: phaseAt(config, config.startedAtMs),
    inputKind: 'none',
    direction: null,
    paddleAngle: Math.PI / 2,
    guideOrigin: null,
    guideStartedAt: null,
    pointerActive: false,
    pointerAngle: null,
    pointerAt: null,
    directionProgress: 0,
    pendingForwardProgress: 0,
    netForwardProgress: 0,
    lastValidMovementAt: null,
    scoringCursor: 0,
    perfectTicks: 0,
    goodTicks: 0,
    totalTicks: 0,
    claimedKeyboardBeats: [],
    lastKeyboardResult: null,
    lastKeyboardAt: null,
    visible: true,
    performance: 'ready'
  };
  return now > config.startedAtMs
    ? advanceGuidedStir({ ...initial, visible: false }, now)
    : initial;
}

function alignGuideWhenNeeded(state: GuidedStirState, now: number): GuidedStirState {
  if (!state.direction || state.guideStartedAt !== null || now < scoredStart(state)) return state;
  const anchorAt = state.clockAt < scoredStart(state) ? scoredStart(state) : now;
  return {
    ...state,
    guideOrigin: state.paddleAngle,
    guideStartedAt: anchorAt,
    lastValidMovementAt: state.inputKind === 'pointer' ? anchorAt : state.lastValidMovementAt
  };
}

export function guideAngleAt(state: GuidedStirState, now: number, reducedMotion = false): number {
  if (state.phase === 'countdown' || !state.direction || state.guideOrigin === null || state.guideStartedAt === null) {
    return normalizedAngle(state.paddleAngle);
  }
  const elapsedMs = Math.max(0, now - state.guideStartedAt);
  const radians = reducedMotion
    ? Math.floor(elapsedMs / 1_000) * (Math.PI / 2)
    : Math.PI * 2 * (GUIDED_STIR_GUIDE_RPM / 60) * (elapsedMs / 1_000);
  return normalizedAngle(state.guideOrigin + state.direction * radians);
}

function pointerBandAt(state: GuidedStirState, now: number, reducedMotion: boolean): 'perfect' | 'good' | null {
  if (!state.visible || !state.direction || state.lastValidMovementAt === null
    || now - state.lastValidMovementAt > GUIDED_STIR_GRACE_MS) return null;
  const error = Math.abs(shortestAngleDelta(state.paddleAngle - guideAngleAt(state, now, reducedMotion)));
  if (error <= GUIDED_STIR_PERFECT_RADIANS + 1e-9) return 'perfect';
  if (error <= GUIDED_STIR_GOOD_RADIANS + 1e-9) return 'good';
  return null;
}

function performanceAt(state: GuidedStirState, now: number, reducedMotion: boolean): GuidedStirPerformance {
  if (phaseAt(state, now) === 'complete') return 'complete';
  if (phaseAt(state, now) === 'countdown') return 'ready';
  if (!state.direction) return 'choose-direction';
  if (state.inputKind === 'keyboard') {
    if (state.lastKeyboardAt === null) return 'finding-rhythm';
    if (now - state.lastKeyboardAt > GUIDED_STIR_GRACE_MS) return 'catch-guide';
    return state.lastKeyboardResult === 'perfect' ? 'perfect'
      : state.lastKeyboardResult === 'good' ? 'good' : 'catch-guide';
  }
  const band = pointerBandAt(state, now, reducedMotion);
  if (band && !state.pointerActive) return 'grace';
  if (band) return band;
  return state.lastValidMovementAt === null ? 'finding-rhythm' : 'catch-guide';
}

export function advanceGuidedStir(state: GuidedStirState, now: number, reducedMotion = false): GuidedStirState {
  const boundedNow = Math.max(state.clockAt, now);
  let next = alignGuideWhenNeeded(state, boundedNow);
  const elapsedScored = clamp(boundedNow - scoredStart(next), 0, next.durationSeconds * 1_000);
  const dueTicks = Math.min(targetTicks(next), Math.floor(elapsedScored / GUIDED_STIR_TICK_MS));
  let perfectTicks = next.perfectTicks;
  let goodTicks = next.goodTicks;
  if (next.inputKind === 'pointer') {
    for (let cursor = next.scoringCursor; cursor < dueTicks; cursor += 1) {
      const tickAt = scoredStart(next) + (cursor + 1) * GUIDED_STIR_TICK_MS;
      const band = pointerBandAt(next, tickAt, reducedMotion);
      if (band === 'perfect') perfectTicks += 1;
      if (band === 'good') goodTicks += 1;
    }
  }
  next = {
    ...next,
    clockAt: boundedNow,
    phase: phaseAt(next, boundedNow),
    scoringCursor: dueTicks,
    totalTicks: dueTicks,
    perfectTicks,
    goodTicks
  };
  return { ...next, performance: performanceAt(next, boundedNow, reducedMotion) };
}

function inAnnulus(point: NormalizedEllipsePoint): boolean {
  return point.radius >= GUIDED_STIR_MIN_RADIUS && point.radius <= GUIDED_STIR_MAX_RADIUS;
}

export function beginGuidedPointer(
  state: GuidedStirState,
  point: ScenePoint,
  ellipse: Ellipse,
  now = point.timestamp,
  reducedMotion = false
): GuidedPointerUpdate {
  const next = advanceGuidedStir(state, now, reducedMotion);
  const normalized = normalizeEllipsePoint(point, ellipse);
  if (next.phase === 'complete' || next.inputKind === 'keyboard' || !inAnnulus(normalized)) {
    return { state: next, accepted: false, reanchored: false };
  }
  return {
    state: { ...next, pointerActive: true, pointerAngle: normalized.angle, pointerAt: now },
    accepted: true,
    reanchored: false
  };
}

function lockDirection(state: GuidedStirState, direction: GuidedStirDirection, now: number): GuidedStirState {
  const active = now >= scoredStart(state);
  return {
    ...state,
    direction,
    directionProgress: 0,
    guideOrigin: active ? state.paddleAngle : null,
    guideStartedAt: active ? now : null,
    lastValidMovementAt: state.inputKind === 'pointer' ? now : state.lastValidMovementAt
  };
}

export function moveGuidedPointer(
  state: GuidedStirState,
  point: ScenePoint,
  ellipse: Ellipse,
  now = point.timestamp,
  reducedMotion = false
): GuidedPointerUpdate {
  let next = advanceGuidedStir(state, now, reducedMotion);
  if (!next.pointerActive || next.inputKind === 'keyboard' || next.phase === 'complete') {
    return { state: next, accepted: false, reanchored: false };
  }
  const normalized = normalizeEllipsePoint(point, ellipse);
  if (!inAnnulus(normalized)) {
    return {
      state: { ...next, pointerActive: false, pointerAngle: null, pointerAt: null },
      accepted: false,
      reanchored: false
    };
  }
  if (next.pointerAngle === null || next.pointerAt === null) {
    return {
      state: { ...next, pointerAngle: normalized.angle, pointerAt: now },
      accepted: false,
      reanchored: true
    };
  }
  const delta = shortestAngleDelta(normalized.angle - next.pointerAngle);
  const gap = now - next.pointerAt;
  if (gap > GUIDED_STIR_REANCHOR_MS || Math.abs(delta) > GUIDED_STIR_MAX_JUMP_RADIANS) {
    return {
      state: { ...next, pointerAngle: normalized.angle, pointerAt: now },
      accepted: false,
      reanchored: true
    };
  }
  if (Math.abs(delta) < .0001) {
    return {
      state: { ...next, pointerAngle: normalized.angle, pointerAt: now },
      accepted: false,
      reanchored: false
    };
  }

  next = {
    ...next,
    inputKind: 'pointer',
    pointerAngle: normalized.angle,
    pointerAt: now,
    paddleAngle: normalizedAngle(next.paddleAngle + delta)
  };
  if (!next.direction) {
    const directionProgress = next.directionProgress + delta;
    next = { ...next, directionProgress };
    if (Math.abs(directionProgress) >= GUIDED_STIR_DIRECTION_LOCK_RADIANS) {
      next = lockDirection(next, directionProgress < 0 ? -1 : 1, now);
    }
  } else {
    const signedProgress = delta * next.direction;
    const netForwardProgress = next.netForwardProgress + signedProgress;
    let pendingForwardProgress = next.pendingForwardProgress + signedProgress;
    let lastValidMovementAt = next.lastValidMovementAt;
    if (pendingForwardProgress >= GUIDED_STIR_FORWARD_RENEW_RADIANS) {
      pendingForwardProgress %= GUIDED_STIR_FORWARD_RENEW_RADIANS;
      lastValidMovementAt = now;
    }
    next = { ...next, netForwardProgress, pendingForwardProgress, lastValidMovementAt };
  }
  next = { ...next, performance: performanceAt(next, now, reducedMotion) };
  return { state: next, accepted: true, reanchored: false };
}

export function endGuidedPointer(state: GuidedStirState, now: number, reducedMotion = false): GuidedStirState {
  const next = advanceGuidedStir(state, now, reducedMotion);
  const ended = { ...next, pointerActive: false, pointerAngle: null, pointerAt: null };
  return { ...ended, performance: performanceAt(ended, now, reducedMotion) };
}

function keyDirection(key: string): GuidedStirDirection | null {
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return null;
}

export function handleGuidedKey(
  state: GuidedStirState,
  key: string,
  now: number,
  repeat = false,
  reducedMotion = false
): GuidedKeyUpdate {
  let next = advanceGuidedStir(state, now, reducedMotion);
  if (repeat || next.phase === 'complete' || next.inputKind === 'pointer') {
    return { state: next, accepted: false, result: null };
  }
  const requestedDirection = keyDirection(key);
  if (!next.direction) {
    if (!requestedDirection) return { state: next, accepted: false, result: null };
    next = lockDirection({ ...next, inputKind: 'keyboard', pointerActive: false }, requestedDirection, now);
    return { state: { ...next, performance: performanceAt(next, now, reducedMotion) }, accepted: true, result: 'direction' };
  }
  if (requestedDirection && requestedDirection !== next.direction) {
    return { state: next, accepted: false, result: null };
  }
  const isBeatKey = key === ' ' || key === 'Enter' || requestedDirection === next.direction;
  if (!isBeatKey) return { state: next, accepted: false, result: null };

  const elapsed = now - scoredStart(next);
  const beatCount = next.durationSeconds;
  let closest = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let beat = 0; beat < beatCount; beat += 1) {
    const currentDistance = Math.abs(elapsed - (500 + beat * 1_000));
    if (currentDistance < distance) {
      distance = currentDistance;
      closest = beat;
    }
  }
  if (closest < 0 || distance > 500) {
    next = { ...next, lastKeyboardResult: 'miss', lastKeyboardAt: now };
    return { state: { ...next, performance: performanceAt(next, now, reducedMotion) }, accepted: true, result: 'miss' };
  }
  if (next.claimedKeyboardBeats.includes(closest)) {
    return { state: next, accepted: false, result: null };
  }
  const result = distance <= 250 ? 'perfect' : 'good';
  const claimedKeyboardBeats = [...next.claimedKeyboardBeats, closest].sort((a, b) => a - b);
  next = {
    ...next,
    paddleAngle: guideAngleAt(next, now, reducedMotion),
    claimedKeyboardBeats,
    perfectTicks: next.perfectTicks + (result === 'perfect' ? 4 : 0),
    goodTicks: next.goodTicks + (result === 'good' ? 4 : 0),
    lastKeyboardResult: result,
    lastKeyboardAt: now
  };
  return { state: { ...next, performance: performanceAt(next, now, reducedMotion) }, accepted: true, result };
}

export function setGuidedStirVisibility(
  state: GuidedStirState,
  visible: boolean,
  now: number,
  reducedMotion = false
): GuidedStirState {
  let next = advanceGuidedStir(state, now, reducedMotion);
  next = { ...next, visible, pointerActive: false, pointerAngle: null, pointerAt: null };
  return { ...next, performance: performanceAt(next, now, reducedMotion) };
}

export function guidedStirTelemetry(state: GuidedStirState, now = state.clockAt, reducedMotion = false): GuidedStirTelemetry {
  const current = advanceGuidedStir(state, now, reducedMotion);
  const remainingMs = Math.max(0, challengeEnd(current) - now);
  const scoredElapsed = clamp(now - scoredStart(current), 0, current.durationSeconds * 1_000);
  return {
    phase: current.phase,
    inputKind: current.inputKind,
    direction: current.direction,
    performance: current.performance,
    remainingMs,
    perfectTicks: current.perfectTicks,
    goodTicks: current.goodTicks,
    totalTicks: current.totalTicks,
    targetTicks: targetTicks(current),
    progress: current.phase === 'countdown' ? 0 : scoredElapsed / (current.durationSeconds * 1_000) * 100,
    paddleAngle: current.paddleAngle,
    guideAngle: guideAngleAt(current, now, reducedMotion)
  };
}

export function serializeGuidedStirState(state: GuidedStirState): string {
  const stored: GuidedStirStoredState = {
    version: GUIDED_STIR_RULES_VERSION,
    direction: state.direction,
    inputKind: state.inputKind,
    guideOrigin: state.guideOrigin,
    guideStartedAt: state.guideStartedAt,
    paddleAngle: state.paddleAngle,
    directionProgress: state.directionProgress,
    pendingForwardProgress: state.pendingForwardProgress,
    netForwardProgress: state.netForwardProgress,
    lastValidMovementAt: state.lastValidMovementAt,
    scoringCursor: state.scoringCursor,
    perfectTicks: state.perfectTicks,
    goodTicks: state.goodTicks,
    claimedKeyboardBeats: state.claimedKeyboardBeats
  };
  return JSON.stringify(stored);
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function parseStoredState(value: string | null, config: GuidedStirConfig): GuidedStirStoredState | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<GuidedStirStoredState>;
    const maximumTicks = targetTicks(config);
    const validDirection = candidate.direction === null || candidate.direction === -1 || candidate.direction === 1;
    const validInput = candidate.inputKind === 'none' || candidate.inputKind === 'pointer' || candidate.inputKind === 'keyboard';
    const integers = [candidate.scoringCursor, candidate.perfectTicks, candidate.goodTicks];
    const claimed = candidate.claimedKeyboardBeats;
    const positiveTicks = (candidate.perfectTicks ?? 0) + (candidate.goodTicks ?? 0);
    const pointerCreditValid = candidate.inputKind !== 'pointer'
      || (positiveTicks <= (candidate.scoringCursor ?? -1) && claimed?.length === 0);
    const keyboardCreditValid = candidate.inputKind !== 'keyboard' || (
      candidate.direction !== null
      && Number.isInteger(candidate.perfectTicks) && candidate.perfectTicks! % 4 === 0
      && Number.isInteger(candidate.goodTicks) && candidate.goodTicks! % 4 === 0
      && Array.isArray(claimed)
      && positiveTicks === claimed.length * 4
      && claimed.every((beat) => beat * 4 <= (candidate.scoringCursor ?? -1))
    );
    const untouchedCreditValid = candidate.inputKind !== 'none'
      || (candidate.direction === null && positiveTicks === 0 && claimed?.length === 0);
    if (candidate.version !== GUIDED_STIR_RULES_VERSION || !validDirection || !validInput
      || !isFiniteOrNull(candidate.guideOrigin) || !isFiniteOrNull(candidate.guideStartedAt)
      || !Number.isFinite(candidate.paddleAngle) || !Number.isFinite(candidate.directionProgress)
      || !Number.isFinite(candidate.pendingForwardProgress) || !Number.isFinite(candidate.netForwardProgress)
      || !isFiniteOrNull(candidate.lastValidMovementAt)
      || integers.some((number) => !Number.isInteger(number) || number! < 0 || number! > maximumTicks)
      || candidate.perfectTicks! + candidate.goodTicks! > maximumTicks
      || !Array.isArray(claimed) || claimed.some((beat) => !Number.isInteger(beat) || beat < 0 || beat >= config.durationSeconds)
      || new Set(claimed).size !== claimed.length
      || !pointerCreditValid || !keyboardCreditValid || !untouchedCreditValid
      || candidate.paddleAngle! < 0 || candidate.paddleAngle! >= Math.PI * 2
      || (candidate.guideOrigin !== null && (candidate.guideOrigin! < 0 || candidate.guideOrigin! >= Math.PI * 2))
      || (candidate.guideStartedAt !== null
        && (candidate.guideStartedAt! < scoredStart(config) || candidate.guideStartedAt! > challengeEnd(config)))
      || Math.abs(candidate.directionProgress!) > Math.PI * 2
      || Math.abs(candidate.pendingForwardProgress!) > Math.PI * 2
      || Math.abs(candidate.netForwardProgress!) > Math.PI * 1000
      || (candidate.lastValidMovementAt !== null
        && (candidate.lastValidMovementAt! < config.startedAtMs || candidate.lastValidMovementAt! > challengeEnd(config)))) return null;
    return candidate as GuidedStirStoredState;
  } catch {
    return null;
  }
}

export function restoreGuidedStirState(
  value: string | null,
  config: GuidedStirConfig,
  now: number,
  reducedMotion = false
): GuidedStirState {
  const base = createGuidedStirState(config, config.startedAtMs);
  const stored = parseStoredState(value, config);
  const restored = stored ? {
    ...base,
    ...stored,
    clockAt: Math.max(config.startedAtMs, Math.min(now, stored.guideStartedAt ?? now)),
    phase: phaseAt(config, Math.max(config.startedAtMs, Math.min(now, stored.guideStartedAt ?? now))),
    pointerActive: false,
    pointerAngle: null,
    pointerAt: null,
    totalTicks: stored.scoringCursor,
    lastKeyboardResult: null,
    lastKeyboardAt: null,
    visible: false,
    performance: 'ready' as GuidedStirPerformance
  } : { ...base, visible: false };
  const advanced = advanceGuidedStir(restored, now, reducedMotion);
  return setGuidedStirVisibility(advanced, true, now, reducedMotion);
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
