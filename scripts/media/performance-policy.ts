import { mediaPolicy } from './policy.js';

export const MOBILE_MEDIA_ROUTES = mediaPolicy.performance.routes;

export type MediaRoute = (typeof MOBILE_MEDIA_ROUTES)[number];
export type PerformanceMode = 'report' | 'enforce';

/**
 * These interactions deliberately stop before a form submission. They invoke
 * route-owned client handlers while leaving the shared fixture save unchanged
 * for the next isolated, cold-cache context.
 */
export const REPRESENTATIVE_INTERACTION_STRATEGIES: Record<MediaRoute, string> = {
  '/garden': 'Click the c2 hex-cell selection button (GardenScene onselect).',
  '/brewery': 'Check the first ingredient radio (Brewery selectedIngredientId binding).',
  '/bakery': 'Check the first ingredient radio (Bakery selectedIngredientId binding).',
  '/bar': 'Select the second patron in the Choose a patron guest switcher (GuestInspector onselect).'
};

export interface MediaPerformanceBudgets {
  lcpMs: number;
  cls: number;
  interactionMs: number;
  encodedMediaBytes: number;
  largestImageBytes: number;
}

export const MOBILE_MEDIA_BUDGETS: MediaPerformanceBudgets = {
  lcpMs: mediaPolicy.performance.lcpMs,
  cls: mediaPolicy.performance.cls,
  interactionMs: mediaPolicy.performance.interactionMs,
  encodedMediaBytes: mediaPolicy.performance.encodedMediaBytes,
  largestImageBytes: mediaPolicy.performance.largestImageBytes
};

export interface TrialMetrics {
  route: MediaRoute;
  trial: number;
  lcpMs: number | null;
  cls: number;
  interactionMs: number | null;
  imageCount: number;
  encodedMediaBytes: number;
  largestImageBytes: number;
}

export interface RouteMetrics extends Omit<TrialMetrics, 'trial'> {
  trials: number;
}

export interface BudgetFailure {
  metric: keyof MediaPerformanceBudgets;
  actual: number;
  budget: number;
  reason: string;
}

export interface CalibrationReport {
  schemaVersion: 1;
  mode: 'report';
  generatedAt: string;
  gitRevision: string;
  routes: RouteMetrics[];
}

export interface CalibrationMetric {
  route: MediaRoute;
  metric: keyof MediaPerformanceBudgets;
  p75: number;
  budget: number;
  pass: boolean;
}

export interface CalibrationResult {
  requiredRuns: number;
  validRuns: number;
  uniqueRuns: CalibrationReport[];
  metrics: CalibrationMetric[];
  passed: boolean;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the report shape rather than trusting a downloaded CI artifact. */
export function parseCalibrationReport(value: unknown): CalibrationReport {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.mode !== 'report') {
    throw new Error('Expected a schemaVersion 1 report-mode media performance report.');
  }
  if (typeof value.gitRevision !== 'string' || !/^[0-9a-f]{40}$/i.test(value.gitRevision)) {
    throw new Error('Report must include a full Git revision.');
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error('Report must include an ISO generatedAt timestamp.');
  }
  if (!Array.isArray(value.routes) || value.routes.length !== MOBILE_MEDIA_ROUTES.length) {
    throw new Error('Report must include exactly one median for every measured route.');
  }
  const expectedRoutes = new Set<string>(MOBILE_MEDIA_ROUTES);
  const routes = value.routes.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.route !== 'string' || !expectedRoutes.has(candidate.route)) {
      throw new Error('Report includes an unknown route.');
    }
    if (candidate.trials !== 3) throw new Error(`Report route ${candidate.route} must contain exactly three report-mode trials.`);
    const numeric = ['cls', 'imageCount', 'encodedMediaBytes', 'largestImageBytes'] as const;
    for (const key of numeric) if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key])) {
      throw new Error(`Report route ${candidate.route} has an invalid ${key}.`);
    }
    for (const key of ['lcpMs', 'interactionMs'] as const) if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key])) {
      throw new Error(`Report route ${candidate.route} has no valid ${key}.`);
    }
    return candidate as unknown as RouteMetrics;
  });
  if (new Set(routes.map((route) => route.route)).size !== MOBILE_MEDIA_ROUTES.length) {
    throw new Error('Report contains duplicate routes.');
  }
  return { schemaVersion: 1, mode: 'report', generatedAt: value.generatedAt, gitRevision: value.gitRevision, routes };
}

function p75(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  if (ordered.length === 0) throw new Error('Cannot calculate a percentile without values.');
  return ordered[Math.ceil(ordered.length * .75) - 1]!;
}

/**
 * Deduplicates a downloaded artifact by commit and report timestamp, then uses
 * nearest-rank p75 for each route median. A run is never allowed to hide a
 * missing browser metric because parsing rejects incomplete route medians.
 */
export function evaluateCalibrationReports(
  reports: CalibrationReport[],
  requiredRuns = mediaPolicy.performance.calibrationRuns,
  budgets: MediaPerformanceBudgets = MOBILE_MEDIA_BUDGETS
): CalibrationResult {
  const unique = [...new Map(reports
    .map((report) => [`${report.gitRevision}:${report.generatedAt}`, report] as const)
    .sort(([left], [right]) => left.localeCompare(right))).values()];
  const metrics: CalibrationMetric[] = [];
  if (unique.length >= requiredRuns) {
    for (const route of MOBILE_MEDIA_ROUTES) {
      const medians = unique.map((report) => report.routes.find((item) => item.route === route)!);
      for (const metric of ['lcpMs', 'cls', 'interactionMs', 'encodedMediaBytes', 'largestImageBytes'] as const) {
        const value = p75(medians.map((median) => median[metric] as number));
        metrics.push({ route, metric, p75: value, budget: budgets[metric], pass: value <= budgets[metric] });
      }
    }
  }
  return {
    requiredRuns,
    validRuns: unique.length,
    uniqueRuns: unique,
    metrics,
    passed: unique.length >= requiredRuns && metrics.every((metric) => metric.pass)
  };
}

/**
 * Collapses repeated cold-cache attempts into a stable route measurement.  A
 * missing browser metric remains missing rather than being treated as a fast
 * result; enforcement can therefore surface broken instrumentation.
 */
export function aggregateRouteTrials(route: MediaRoute, trials: TrialMetrics[]): RouteMetrics {
  if (trials.length === 0) throw new Error(`No performance trials were collected for ${route}.`);
  if (trials.some((trial) => trial.route !== route)) throw new Error(`Cannot aggregate another route into ${route}.`);

  const optionalMedian = (metric: 'lcpMs' | 'interactionMs') => {
    const values = trials.map((trial) => trial[metric]).filter((value): value is number => value !== null);
    return values.length === trials.length ? median(values) : null;
  };

  return {
    route,
    trials: trials.length,
    lcpMs: optionalMedian('lcpMs'),
    cls: median(trials.map((trial) => trial.cls)),
    interactionMs: optionalMedian('interactionMs'),
    imageCount: Math.round(median(trials.map((trial) => trial.imageCount))),
    encodedMediaBytes: Math.round(median(trials.map((trial) => trial.encodedMediaBytes))),
    largestImageBytes: Math.round(median(trials.map((trial) => trial.largestImageBytes)))
  };
}

export function evaluateRouteBudget(
  metrics: RouteMetrics,
  budgets: MediaPerformanceBudgets = MOBILE_MEDIA_BUDGETS
): BudgetFailure[] {
  const failures: BudgetFailure[] = [];
  const requireMetric = (metric: 'lcpMs' | 'interactionMs', budget: number) => {
    const actual = metrics[metric];
    if (actual === null) {
      failures.push({ metric, actual: Number.NaN, budget, reason: `${metric} was not reported by the browser.` });
    } else if (actual > budget) {
      failures.push({ metric, actual, budget, reason: `${actual} exceeds ${budget}.` });
    }
  };
  requireMetric('lcpMs', budgets.lcpMs);
  requireMetric('interactionMs', budgets.interactionMs);
  for (const [metric, actual, budget] of [
    ['cls', metrics.cls, budgets.cls],
    ['encodedMediaBytes', metrics.encodedMediaBytes, budgets.encodedMediaBytes],
    ['largestImageBytes', metrics.largestImageBytes, budgets.largestImageBytes]
  ] as const) {
    if (actual > budget) failures.push({ metric, actual, budget, reason: `${actual} exceeds ${budget}.` });
  }
  return failures;
}

/** A noisy route only fails enforcement when the same metric breaches twice. */
export function persistentBudgetFailures(initial: BudgetFailure[], retry: BudgetFailure[]) {
  const initialMetrics = new Set(initial.map((failure) => failure.metric));
  return retry.filter((failure) => initialMetrics.has(failure.metric));
}

/** Report-only calibration never adds a second run; enforcement retries once. */
export function shouldRetryBudgetEvaluation(mode: PerformanceMode, failures: BudgetFailure[]) {
  return mode === 'enforce' && failures.length > 0;
}

export function formatPerformanceSummary(metrics: RouteMetrics, failures: BudgetFailure[]) {
  const format = (value: number | null, suffix = '') => value === null ? 'missing' : `${Math.round(value)}${suffix}`;
  const line = `${metrics.route}: LCP ${format(metrics.lcpMs, 'ms')}, CLS ${metrics.cls.toFixed(3)}, `
    + `interaction ${format(metrics.interactionMs, 'ms')}, images ${metrics.imageCount}, `
    + `media ${(metrics.encodedMediaBytes / 1024).toFixed(1)}KiB, largest ${(metrics.largestImageBytes / 1024).toFixed(1)}KiB`;
  return failures.length === 0 ? `${line} — within budget` : `${line} — ${failures.map((failure) => failure.metric).join(', ')} failed`;
}
