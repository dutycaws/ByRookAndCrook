import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BURN_TREATMENTS,
  DEFAULT_BURN_STYLE,
  profileBurnStyle,
  resolveBurnAction,
  resolveBurnStyle,
  waitForBurn
} from '$lib/card-effects';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('card burn preferences', () => {
  it.each(['crawl', 'drip', 'ash', 'random'] as const)('accepts the supported style %s', (style) => {
    expect(resolveBurnStyle(style)).toBe(style);
  });

  it.each(['', 'Crawl', 'slow', 'random ', null, undefined, 1, true, {}, []])('rejects unsupported style values: %s', (style) => {
    expect(resolveBurnStyle(style)).toBeNull();
  });

  it('uses the default for missing or invalid profile metadata', () => {
    expect(DEFAULT_BURN_STYLE).toBe('drip');
    expect(profileBurnStyle(undefined)).toBe(DEFAULT_BURN_STYLE);
    expect(profileBurnStyle(null)).toBe(DEFAULT_BURN_STYLE);
    expect(profileBurnStyle({})).toBe(DEFAULT_BURN_STYLE);
    expect(profileBurnStyle({ card_burn_style: 'spark' })).toBe(DEFAULT_BURN_STYLE);
  });

  it('keeps a valid profile choice, including random', () => {
    expect(profileBurnStyle({ card_burn_style: 'crawl' })).toBe('crawl');
    expect(profileBurnStyle({ card_burn_style: 'random' })).toBe('random');
  });
});

describe('card burn action resolution', () => {
  it.each(BURN_TREATMENTS)('maps $value to its configured duration', ({ value, durationMs }) => {
    expect(resolveBurnAction(value)).toEqual({ treatment: value, durationMs });
  });

  it('chooses one random treatment and returns its matching duration', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    expect(resolveBurnAction('random')).toEqual({ treatment: 'ash', durationMs: 1300 });
    expect(random).toHaveBeenCalledTimes(1);
  });
});

describe('waitForBurn', () => {
  it('returns false when cancelled and clears its pending timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForBurn(1000, controller.signal);

    controller.abort();

    await expect(waiting).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves true after the requested duration completes', async () => {
    vi.useFakeTimers();
    const waiting = waitForBurn(700);

    await vi.advanceTimersByTimeAsync(699);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(waiting).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('completes immediately without scheduling a timer for reduced motion', async () => {
    vi.useFakeTimers();
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('window', { matchMedia });

    await expect(waitForBurn(60_000)).resolves.toBe(true);

    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(vi.getTimerCount()).toBe(0);
  });
});
