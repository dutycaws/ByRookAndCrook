import { createHash } from 'node:crypto';

/** Whole records only: truncating an exchange can reverse a promise or remove a qualification. */
export interface RecentExchange { id: string; keeper: string; npc: string }
export interface ContextBase { recent: RecentExchange[]; [key: string]: unknown }
export interface ContextEvidence {
  category: string;
  query: string;
  sourceIds: string[];
  contentVersion: string;
  data: unknown;
}
export interface ContextWindow {
  base: ContextBase;
  context: ContextEvidence[];
  coverage: { version: 'npc-context-v1'; omittedExchanges: number; omittedResults: number };
}
/** Frozen dialogue evidence is capped by transport bytes, never UTF-16 code units. */
export const CONTEXT_LIMIT = 64 * 1024;
/** Provider envelopes can contain the frozen evidence plus a reply and repair findings. */
export const PAYLOAD_LIMIT = 384 * 1024;
export class ContextBudgetError extends Error {
  constructor() { super('The conversation is too large to finish. Cancel this message; you can still close the tavern normally.'); }
}
/**
 * Token limits need a tokenizer known to the selected model.  In particular, a
 * bytes-per-token ratio is not a measurement and must never be used for an
 * admission decision.
 */
export class TokenBudgetUnsupportedError extends Error {
  constructor() { super('The selected dialogue model has no configured tokenizer. Please use a supported model or remove the token override.'); }
}

const encoder = new TextEncoder();
export const utf8Bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

export type TokenCounter = (canonicalPayload: string) => number;
export function requireTokenBudget(payload: unknown, tokenLimit?: number, countTokens?: TokenCounter): void {
  if (tokenLimit == null) return;
  if (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1 || !countTokens) throw new TokenBudgetUnsupportedError();
  if (countTokens(JSON.stringify(payload)) > tokenLimit) throw new ContextBudgetError();
}

/** Leave room for the validated decision, candidate reply and rewrite findings. */
export function prepareContext(base: ContextBase, context: ContextEvidence[], limit = CONTEXT_LIMIT): ContextWindow {
  const window: ContextWindow = {
    base: structuredClone(base), context: structuredClone(context),
    coverage: { version: 'npc-context-v1', omittedExchanges: 0, omittedResults: 0 }
  };
  const oversized = () => utf8Bytes(window) > limit;
  // Retrieved evidence answers the current question; retain it ahead of older conversation.
  // The immediately preceding exchange stays intact for follow-up references.
  while (oversized() && window.base.recent.length > 1) {
    window.base.recent.shift(); window.coverage.omittedExchanges++;
  }
  while (oversized() && window.context.length) {
    window.context.shift(); window.coverage.omittedResults++;
  }
  if (oversized()) throw new ContextBudgetError();
  return window;
}

export function requirePayloadBudget(payload: unknown): void {
  if (utf8Bytes(payload) > PAYLOAD_LIMIT) throw new ContextBudgetError();
}

/** Every consequential stage uses the same window; adding prose cannot evict its evidence. */
export function stagePayload(window: ContextWindow, extra: Record<string, unknown> = {}) {
  const payload = { ...structuredClone(window), ...extra };
  requirePayloadBudget(payload);
  return payload;
}

export const evidenceKey = ({category, query}: Pick<ContextEvidence, 'category'|'query'>) =>
  JSON.stringify([category, query.slice(0,200)]);

function canonical(value: unknown): unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)]));
  return value;
}

/** Log identifiers and a digest, avoiding another copy of dialogue text in stage metadata. */
export function describePayload(payload: unknown) {
  const value=payload as Partial<ContextWindow>;
  const window=value.base && value.context && value.coverage
    ? {base:value.base,context:value.context,coverage:value.coverage} : null;
  return {
    bytes:utf8Bytes(payload),
    // A token count is intentionally absent until the selected model supplies
    // a compatible tokenizer.  Consumers must treat this as unsupported, not
    // as an estimate.
    tokenizer:'unsupported',
    contextVersion: window?.coverage.version ?? null,
    contextFingerprint: window ? createHash('sha256').update(JSON.stringify(canonical(window))).digest('hex') : null,
    sourceIds: [...new Set(window?.context.flatMap(result=>result.sourceIds) ?? [])],
    recentExchangeIds: window?.base.recent.map(exchange=>exchange.id) ?? []
  };
}
