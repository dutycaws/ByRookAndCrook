import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type MediaPolicy = {
  version: 1;
  git: {
    maxNewBlobBytes: number;
    forbiddenVideoExtensions: string[];
  };
  runtime: {
    maxRasterBytes: number;
    maxTotalMediaBytes: number;
    rasterExtensions: string[];
  };
  evidence: {
    maxStillBytes: number;
    maxStillsPerSet: number;
    maxStillSetBytes: number;
    maxClipBytes: number;
    candidateRetentionDays: number;
  };
  performance: {
    routes: ['/garden', '/brewery', '/bakery', '/bar'];
    lcpMs: number;
    cls: number;
    interactionMs: number;
    encodedMediaBytes: number;
    largestImageBytes: number;
    calibrationRuns: number;
  };
};

const policyPath = fileURLToPath(new URL('../../config/media-policy.json', import.meta.url));
const parsed = JSON.parse(readFileSync(policyPath, 'utf8')) as MediaPolicy;

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer.`);
}

if (parsed.version !== 1) throw new Error('Unsupported media policy version.');
positiveInteger(parsed.git?.maxNewBlobBytes, 'git.maxNewBlobBytes');
positiveInteger(parsed.runtime?.maxRasterBytes, 'runtime.maxRasterBytes');
positiveInteger(parsed.runtime?.maxTotalMediaBytes, 'runtime.maxTotalMediaBytes');
positiveInteger(parsed.evidence?.maxStillBytes, 'evidence.maxStillBytes');
positiveInteger(parsed.evidence?.maxStillsPerSet, 'evidence.maxStillsPerSet');
positiveInteger(parsed.evidence?.maxStillSetBytes, 'evidence.maxStillSetBytes');
positiveInteger(parsed.evidence?.maxClipBytes, 'evidence.maxClipBytes');
positiveInteger(parsed.evidence?.candidateRetentionDays, 'evidence.candidateRetentionDays');
positiveInteger(parsed.performance?.lcpMs, 'performance.lcpMs');
positiveInteger(parsed.performance?.interactionMs, 'performance.interactionMs');
positiveInteger(parsed.performance?.encodedMediaBytes, 'performance.encodedMediaBytes');
positiveInteger(parsed.performance?.largestImageBytes, 'performance.largestImageBytes');
positiveInteger(parsed.performance?.calibrationRuns, 'performance.calibrationRuns');
if (!Array.isArray(parsed.git.forbiddenVideoExtensions) || !Array.isArray(parsed.runtime.rasterExtensions)) {
  throw new Error('Media policy extension lists are required.');
}
if (!Array.isArray(parsed.performance.routes) || parsed.performance.routes.length !== 4) {
  throw new Error('Media performance routes are required.');
}
if (typeof parsed.performance.cls !== 'number' || parsed.performance.cls <= 0) {
  throw new Error('performance.cls must be positive.');
}

export const mediaPolicy = Object.freeze(parsed);
