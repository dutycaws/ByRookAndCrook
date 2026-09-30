import { primitiveRegistry } from './registry';
import type { ContractIssue, WorldEntityKind } from './contracts';

export const WORLD_CANON_EVENT_VERSION = 'world-canon-event-v1' as const;
const proposalKeys = ['version','kind','templateKey','participantEntityIds','title','summary','payload','reuseKey'] as const;
const summaryKeys = ['version','kind','templateKey','participantEntityIds','title','summary','reuseKey'] as const;
const requiredProposalKeys = proposalKeys.filter((key) => key !== 'reuseKey');
const requiredSummaryKeys = summaryKeys.filter((key) => key !== 'reuseKey');
const payloadKeys = ['template','participants','visibility'] as const;
const forbiddenKey = /(?:^|_)(?:sql|query|route|url|endpoint|code|function|handler|script|executable)(?:$|_)/i;
const forbiddenObjectKeys = new Set(['__proto__','constructor','prototype']);
const entityReference = /^(?:[a-z][a-z0-9_-]{1,127}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const reuseKey = /^[a-z][a-z0-9-]{1,63}$/;
const MAX_BYTES = 4_096;
const MAX_DEPTH = 3;
const MAX_NODES = 48;

export interface WorldCanonEventProposal {
  version: typeof WORLD_CANON_EVENT_VERSION;
  kind: 'world_event';
  templateKey: string;
  participantEntityIds: string[];
  title: string;
  summary: string;
  payload: { template: string; participants: string[]; visibility: 'public' };
  reuseKey?: string;
}

/** A player-safe projection. It deliberately has no model payload or private state. */
export interface PublicWorldCanonEventSummary {
  version: typeof WORLD_CANON_EVENT_VERSION;
  kind: 'world_event';
  templateKey: string;
  participantEntityIds: string[];
  title: string;
  summary: string;
  reuseKey?: string;
}

export interface WorldCanonEventValidationContext {
  entityKinds: Readonly<Record<string, WorldEntityKind>>;
  activeGeneratedEntityCount: number;
  /** Existing public events eligible for this exact reuse key; never inferred from the proposal. */
  existingPublicEventReuseKeys?: readonly string[];
}

export type WorldCanonEventParseResult =
  | { ok: true; value: WorldCanonEventProposal }
  | { ok: false; issues: ContractIssue[] };
export type PublicWorldCanonEventSummaryParseResult =
  | { ok: true; value: PublicWorldCanonEventSummary }
  | { ok: false; issues: ContractIssue[] };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}

function byteSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
}

function safeJson(value: unknown, depth = 0, tally = { nodes: 0 }): boolean {
  if (depth > MAX_DEPTH || ++tally.nodes > MAX_NODES) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 600;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 8 && value.every((entry) => safeJson(entry, depth + 1, tally));
  if (!object(value)) return false;
  return Object.entries(value).every(([key, entry]) => key.length <= 80 && !forbiddenObjectKeys.has(key) && !forbiddenKey.test(key) && safeJson(entry, depth + 1, tally));
}

function exactShape(value: Record<string, unknown>, required: readonly string[], allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => key in value);
}

function issue(path: string, code: string, message: string): ContractIssue[] {
  return [{ path, code, message }];
}

function parseFields(value: unknown, includePayload: boolean): { ok: true; value: PublicWorldCanonEventSummary } | { ok: false; issues: ContractIssue[] } {
  const required=includePayload ? requiredProposalKeys : requiredSummaryKeys;
  const allowed=includePayload ? proposalKeys : summaryKeys;
  if (!object(value) || !exactShape(value, required, allowed) || !safeJson(value) || byteSize(value) > MAX_BYTES) {
    return { ok:false, issues:issue('', 'event_shape', 'A canon event must use the bounded, exact versioned shape.') };
  }
  if (value.version !== WORLD_CANON_EVENT_VERSION || value.kind !== 'world_event') {
    return { ok:false, issues:issue('kind', 'event_kind', 'Only a world-canon-event-v1 world_event is accepted.') };
  }
  if (!boundedText(value.templateKey, 80) || !primitiveRegistry.worldEventTemplates.includes(value.templateKey)) {
    return { ok:false, issues:issue('templateKey', 'event_template', 'The event template must be registered in the primitive registry.') };
  }
  if (!Array.isArray(value.participantEntityIds) || value.participantEntityIds.length < 1 || value.participantEntityIds.length > 8
    || !value.participantEntityIds.every((entry) => typeof entry === 'string' && entityReference.test(entry))
    || new Set(value.participantEntityIds).size !== value.participantEntityIds.length) {
    return { ok:false, issues:issue('participantEntityIds', 'event_participants', 'An event needs one to eight unique stable participant references.') };
  }
  if (!boundedText(value.title, 120) || !boundedText(value.summary, 500)) {
    return { ok:false, issues:issue('title', 'event_text', 'Event title and summary must be non-empty bounded text.') };
  }
  if (value.reuseKey !== undefined && (typeof value.reuseKey !== 'string' || !reuseKey.test(value.reuseKey))) {
    return { ok:false, issues:issue('reuseKey', 'event_reuse_key', 'An optional event reuse key must be a stable lowercase key.') };
  }
  return { ok:true, value:{
    version:WORLD_CANON_EVENT_VERSION, kind:'world_event', templateKey:value.templateKey.trim(),
    participantEntityIds:[...value.participantEntityIds], title:value.title.trim(), summary:value.summary.trim(),
    ...(value.reuseKey === undefined ? {} : { reuseKey:value.reuseKey })
  } };
}

export function validateWorldCanonEventProposal(value: unknown, context: WorldCanonEventValidationContext): ContractIssue[] {
  const parsed=parseFields(value, true);
  if (!parsed.ok) return parsed.issues;
  const budget=primitiveRegistry.worldBudgets.activeGeneratedEntities;
  if (!Number.isSafeInteger(context.activeGeneratedEntityCount) || context.activeGeneratedEntityCount < 0
    || context.activeGeneratedEntityCount > budget) {
    return issue('activeGeneratedEntityCount', 'entity_budget', 'The active generated entity count is outside the registry budget.');
  }
  const reusesExisting=typeof parsed.value.reuseKey === 'string'
    && context.existingPublicEventReuseKeys?.includes(parsed.value.reuseKey) === true;
  if (context.activeGeneratedEntityCount >= budget && !reusesExisting) {
    return issue('activeGeneratedEntityCount', 'entity_budget', 'A new world event cannot exceed the active generated entity budget.');
  }
  const allowedKinds=primitiveRegistry.worldEffects.find((effect) => effect.kind === 'record_world_event')!.targetKinds;
  if (parsed.value.participantEntityIds.some((id) => !allowedKinds.includes(context.entityKinds[id]))) {
    return issue('participantEntityIds', 'event_participant_kind', 'Every event participant must be a known entity of a registry-authorized kind.');
  }
  const payload=(value as Record<string, unknown>).payload;
  if (!object(payload) || !exactShape(payload, payloadKeys, payloadKeys)
    || payload.template !== parsed.value.templateKey || payload.visibility !== 'public'
    || !Array.isArray(payload.participants) || payload.participants.length !== parsed.value.participantEntityIds.length
    || payload.participants.some((id, index) => id !== parsed.value.participantEntityIds[index])) {
    return issue('payload', 'event_payload', 'The shallow public payload must exactly repeat template, participants, and public visibility.');
  }
  return [];
}

export function parseWorldCanonEventProposal(value: unknown, context: WorldCanonEventValidationContext): WorldCanonEventParseResult {
  const issues=validateWorldCanonEventProposal(value, context);
  if (issues.length > 0) return { ok:false, issues };
  const parsed=parseFields(value, true);
  if (!parsed.ok) return parsed;
  const payload=(value as Record<string, unknown>).payload as Record<string, unknown>;
  return { ok:true, value:{ ...parsed.value, payload:{ template:payload.template as string, participants:[...(payload.participants as string[])], visibility:'public' } } };
}

export function toPublicWorldCanonEventSummary(proposal: WorldCanonEventProposal): PublicWorldCanonEventSummary {
  return {
    version:WORLD_CANON_EVENT_VERSION, kind:'world_event', templateKey:proposal.templateKey,
    participantEntityIds:[...proposal.participantEntityIds], title:proposal.title, summary:proposal.summary,
    ...(proposal.reuseKey === undefined ? {} : { reuseKey:proposal.reuseKey })
  };
}

export function parsePublicWorldCanonEventSummary(value: unknown): PublicWorldCanonEventSummaryParseResult {
  return parseFields(value, false);
}

/** Sorted canonical JSON makes equivalent proposal key ordering replay-identical. */
export function canonicalizeWorldCanonEventProposal(value: unknown, context: WorldCanonEventValidationContext): string | null {
  const parsed=parseWorldCanonEventProposal(value, context);
  return parsed.ok ? canonical(parsed.value) : null;
}

export async function fingerprintWorldCanonEventProposal(value: unknown, context: WorldCanonEventValidationContext): Promise<string | null> {
  const canonicalProposal=canonicalizeWorldCanonEventProposal(value, context);
  if (!canonicalProposal || !globalThis.crypto?.subtle) return null;
  const bytes=new TextEncoder().encode(canonicalProposal);
  const digest=await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
