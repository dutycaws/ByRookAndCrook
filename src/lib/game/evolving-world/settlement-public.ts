/**
 * The browser-facing settlement projection.  This deliberately has a much
 * smaller vocabulary than `world_settlement_status`: the RPC is owner scoped,
 * but it also carries operational failure details which are not player UI.
 */
export type PublicSettlementState = 'queued' | 'processing' | 'completed' | 'unavailable';

export interface PublicSettlementStatus {
  id: string;
  dayNumber: number;
  status: PublicSettlementState;
  progress: { completed: number; total: number };
  publicDigest: string | null;
  publicSummary: string | null;
  morningNews: string | null;
}

type RecordValue = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_KEYS = [
  'id', 'dayNumber', 'status', 'deadlineAt', 'failureCode', 'skipReason',
  'publicDigest', 'publicSummary', 'morningNews', 'progress'
] as const;
const RAW_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'expired', 'skipped']);

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function nullableShortText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= 500 ? text : undefined;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && !Number.isNaN(Date.parse(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function settlementStatus(value: unknown): value is Exclude<PublicSettlementState, 'unavailable'> | 'failed' | 'expired' | 'skipped' {
  return typeof value === 'string' && RAW_STATUSES.has(value);
}

/**
 * Parse an exact RPC status shape and discard all operational fields.  Failed
 * and expired work has one player-safe terminal state, so internal codes and
 * retry reasons cannot become a browser contract by accident.
 */
export function parsePublicSettlementStatus(value: unknown): PublicSettlementStatus | null {
  if (value === null) return null;
  if (!object(value) || !exactKeys(value, RAW_KEYS)) throw new Error('Invalid settlement status');
  const { id, dayNumber, deadlineAt, progress } = value;
  const rawStatus = value.status;
  if (typeof id !== 'string' || !UUID.test(id)
    || !nonNegativeInteger(dayNumber) || dayNumber < 1
    || !validTimestamp(deadlineAt)) {
    throw new Error('Invalid settlement status');
  }
  if (!settlementStatus(rawStatus) || !object(progress) || !exactKeys(progress, ['completed', 'total'])) {
    throw new Error('Invalid settlement status');
  }
  const completed = progress.completed;
  const total = progress.total;
  if (!nonNegativeInteger(completed) || !nonNegativeInteger(total) || completed > total) throw new Error('Invalid settlement status');

  const publicDigest = nullableShortText(value.publicDigest);
  const publicSummary = nullableShortText(value.publicSummary);
  const morningNews = nullableShortText(value.morningNews);
  if (publicDigest === undefined || publicSummary === undefined || morningNews === undefined) {
    throw new Error('Invalid settlement status');
  }

  const unavailable = rawStatus === 'failed' || rawStatus === 'expired' || rawStatus === 'skipped';
  return {
    id,
    dayNumber,
    status: unavailable ? 'unavailable' : rawStatus,
    progress: { completed, total },
    publicDigest: unavailable ? null : publicDigest,
    publicSummary: unavailable ? null : publicSummary,
    morningNews: unavailable ? null : morningNews
  };
}

export function isActiveSettlement(status: PublicSettlementStatus | null): boolean {
  return status?.status === 'queued' || status?.status === 'processing';
}
