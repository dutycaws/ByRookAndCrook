import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  aggregateRouteTrials,
  evaluateCalibrationReports,
  evaluateRouteBudget,
  MOBILE_MEDIA_BUDGETS,
  persistentBudgetFailures,
  parseCalibrationReport,
  REPRESENTATIVE_INTERACTION_STRATEGIES,
  shouldRetryBudgetEvaluation,
  type TrialMetrics
} from '../../scripts/media/performance-policy';
import { readCalibrationReports } from '../../scripts/media/performance-calibration';

const trial = (changes: Partial<TrialMetrics> = {}): TrialMetrics => ({
  route: '/garden', trial: 1, lcpMs: 2_000, cls: 0.04, interactionMs: 120,
  imageCount: 4, encodedMediaBytes: 200_000, largestImageBytes: 100_000, ...changes
});

describe('mobile media performance policy', () => {
  it('uses medians to smooth the three cold-cache trials', () => {
    const result = aggregateRouteTrials('/garden', [
      trial({ trial: 1, lcpMs: 2_400, encodedMediaBytes: 300_000 }),
      trial({ trial: 2, lcpMs: 1_900, encodedMediaBytes: 100_000 }),
      trial({ trial: 3, lcpMs: 2_100, encodedMediaBytes: 200_000 })
    ]);
    expect(result.lcpMs).toBe(2_100);
    expect(result.encodedMediaBytes).toBe(200_000);
    expect(result.trials).toBe(3);
  });

  it('does not turn unavailable browser metrics into passing measurements', () => {
    const result = aggregateRouteTrials('/garden', [trial({ lcpMs: null }), trial({ lcpMs: 100 }), trial({ lcpMs: 200 })]);
    expect(result.lcpMs).toBeNull();
    expect(evaluateRouteBudget(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'lcpMs', reason: expect.stringContaining('not reported') })
    ]));
  });

  it('enforces each absolute mobile media budget', () => {
    const result = aggregateRouteTrials('/garden', [trial({
      lcpMs: MOBILE_MEDIA_BUDGETS.lcpMs + 1,
      cls: MOBILE_MEDIA_BUDGETS.cls + .01,
      interactionMs: MOBILE_MEDIA_BUDGETS.interactionMs + 1,
      encodedMediaBytes: MOBILE_MEDIA_BUDGETS.encodedMediaBytes + 1,
      largestImageBytes: MOBILE_MEDIA_BUDGETS.largestImageBytes + 1
    })]);
    expect(evaluateRouteBudget(result).map((failure) => failure.metric)).toEqual([
      'lcpMs', 'interactionMs', 'cls', 'encodedMediaBytes', 'largestImageBytes'
    ]);
  });

  it('rejects a mixed-route aggregation', () => {
    expect(() => aggregateRouteTrials('/garden', [trial({ route: '/bar' })])).toThrow('another route');
  });

  it('only enforces a metric that fails both the first run and retry', () => {
    const first = evaluateRouteBudget(aggregateRouteTrials('/garden', [trial({ lcpMs: 3_000 })]));
    const differentRetry = evaluateRouteBudget(aggregateRouteTrials('/garden', [trial({ cls: 0.2 })]));
    expect(persistentBudgetFailures(first, differentRetry)).toEqual([]);
    const repeated = evaluateRouteBudget(aggregateRouteTrials('/garden', [trial({ lcpMs: 2_900 })]));
    expect(persistentBudgetFailures(first, repeated).map((failure) => failure.metric)).toEqual(['lcpMs']);
  });

  it('retries only a failed enforcement run, never report-mode calibration', () => {
    const failures = evaluateRouteBudget(aggregateRouteTrials('/garden', [trial({ lcpMs: 3_000 })]));
    expect(shouldRetryBudgetEvaluation('report', failures)).toBe(false);
    expect(shouldRetryBudgetEvaluation('enforce', [])).toBe(false);
    expect(shouldRetryBudgetEvaluation('enforce', failures)).toBe(true);
  });

  it('documents a non-persistent route-owned interaction for every measured route', () => {
    expect(REPRESENTATIVE_INTERACTION_STRATEGIES).toEqual({
      '/garden': expect.stringContaining('onselect'),
      '/brewery': expect.stringContaining('selectedIngredientId'),
      '/bakery': expect.stringContaining('selectedIngredientId'),
      '/bar': expect.stringContaining('GuestInspector')
    });
  });

  it('requires ten unique valid report-mode runs before calibration passes', () => {
    const reports = Array.from({ length: 10 }, (_, index) => parseCalibrationReport({
      schemaVersion: 1, mode: 'report', gitRevision: `${index.toString(16).padStart(2, '0')}${'a'.repeat(38)}`,
      generatedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      routes: ['/garden', '/brewery', '/bakery', '/bar'].map((route) => ({
        ...trial({ route: route as TrialMetrics['route'], trial: undefined as never, lcpMs: 2_400 }), trials: 3
      }))
    }));
    expect(evaluateCalibrationReports(reports)).toMatchObject({ validRuns: 10, passed: true });
    expect(evaluateCalibrationReports([...reports, reports[0]!])).toMatchObject({ validRuns: 10, passed: true });
    expect(evaluateCalibrationReports(reports.slice(0, 9))).toMatchObject({ validRuns: 9, passed: false });
  });

  it('blocks calibration when the nearest-rank p75 route median exceeds a budget', () => {
    const reports = Array.from({ length: 10 }, (_, index) => parseCalibrationReport({
      schemaVersion: 1, mode: 'report', gitRevision: `${index.toString(16).padStart(2, '0')}${'b'.repeat(38)}`,
      generatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      routes: ['/garden', '/brewery', '/bakery', '/bar'].map((route) => ({
        ...trial({ route: route as TrialMetrics['route'], trial: undefined as never, lcpMs: index < 7 ? 2_400 : 2_600 }), trials: 3
      }))
    }));
    const result = evaluateCalibrationReports(reports);
    expect(result.passed).toBe(false);
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: '/garden', metric: 'lcpMs', p75: 2_600, pass: false })
    ]));
  });

  it('rejects incomplete reports rather than treating missing metrics as fast', () => {
    expect(() => parseCalibrationReport({ schemaVersion: 1, mode: 'report', gitRevision: 'a'.repeat(40), generatedAt: '2026-09-01T00:00:00Z', routes: [] }))
      .toThrow('exactly one median');
  });

  it('recursively reads extracted GitHub artifacts without following symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-performance-calibration-'));
    try {
      const artifact = join(root, 'media-performance-commit', 'artifacts', 'media-performance');
      await mkdir(artifact, { recursive: true });
      const report = {
        schemaVersion: 1, mode: 'report', gitRevision: 'c'.repeat(40), generatedAt: '2026-09-10T00:00:00.000Z',
        routes: ['/garden', '/brewery', '/bakery', '/bar'].map((route) => ({
          ...trial({ route: route as TrialMetrics['route'], trial: undefined as never }), trials: 3
        }))
      };
      const source = join(artifact, 'latest.json');
      await writeFile(source, JSON.stringify(report));
      await writeFile(join(root, 'not-a-report.json'), '{');
      await symlink(source, join(root, 'linked-report.json'));

      const found = await readCalibrationReports(root);
      expect(found.reports).toHaveLength(1);
      expect(found.reports[0]?.gitRevision).toBe('c'.repeat(40));
      expect(found.rejected.map((entry) => entry.file)).toEqual(['linked-report.json', 'not-a-report.json']);
      expect(found.rejected[0]?.reason).toContain('symbolic links');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
