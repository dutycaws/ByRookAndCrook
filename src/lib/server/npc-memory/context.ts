import { createHash } from 'node:crypto';

export type NpcMemorySourceManifest = Readonly<{
  id: string;
  version: number;
  hash: string;
  kind: string;
}>;
export type NpcMemoryCoverage = Readonly<{
  required: readonly string[];
  included: readonly string[];
  missing: readonly string[];
  complete: boolean;
}>;
export type NpcMemoryContextArtifact = Readonly<{
  policyVersion: string;
  projectionVersion: string;
  tokenizer: string;
  model?: string;
  counterId?: string;
  counterDurationMs?: number;
  cutoffSequence?: number;
  view?: string;
  revision?: number;
  sourceManifest: readonly NpcMemorySourceManifest[];
  coverage: NpcMemoryCoverage;
  payload: Readonly<Record<string, unknown>>;
  canonicalJson: string;
  utf8Bytes: number;
  tokens: number;
  hash: string;
}>;

export class ContextAssemblyConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'ContextAssemblyConfigurationError'; }
}
export class InsufficientNpcMemoryContextError extends Error {
  constructor(message: string) { super(message); this.name = 'InsufficientNpcMemoryContextError'; }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Context canonicalization does not accept non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') throw new TypeError('Context canonicalization accepts JSON values only.');
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) freeze(item);
  }
  return value;
}

/** Canonical JSON is the byte contract shared with SQL-side admission checks. */
export function canonicalJson(value: unknown): string { return canonical(value); }
export function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
export function sha256Hex(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

type ContextPayloadInput = Pick<ContextAssemblyBase, 'sources'|'requiredSourceIds'|'payload'>;
export function canonicalNpcMemoryContextPayload(input: ContextPayloadInput): string {
  const sourceManifest=[...input.sources].map(source=>({...source})).sort((a,b)=>a.id.localeCompare(b.id)||a.version-b.version||a.hash.localeCompare(b.hash));
  const required=[...new Set(input.requiredSourceIds??[])].sort(); const included=[...new Set(sourceManifest.map(source=>source.id))].sort();
  const missing=required.filter(id=>!included.includes(id));
  return canonical({payload:input.payload,sourceManifest,coverage:{required,included,missing,complete:missing.length===0}});
}

type ContextAssemblyBase = {
  policyVersion: string;
  projectionVersion: string;
  maxBytes: number;
  maxTokens: number;
  sources: readonly NpcMemorySourceManifest[];
  requiredSourceIds?: readonly string[];
  payload: Record<string, unknown>;
  model?: string; counterId?: string; counterDurationMs?: number; cutoffSequence?: number; view?: string; revision?: number;
};
type SynchronousContextAssembly = ContextAssemblyBase & { tokenizer: { id: string; count(text: string): number }; tokenCount?: never; tokenizerId?: never };
type VerifiedContextAssembly = ContextAssemblyBase & { tokenCount: number; tokenizerId: string; counterId: string; model: string; tokenizer?: never };
export function assembleNpcMemoryContext(input: SynchronousContextAssembly | VerifiedContextAssembly): NpcMemoryContextArtifact {
  const verified=input as Partial<VerifiedContextAssembly>;
  const synchronous=input as Partial<SynchronousContextAssembly>;
  const usesVerifiedCount=verified.tokenCount !== undefined;
  if (usesVerifiedCount && (
    !Number.isSafeInteger(verified.tokenCount) || (verified.tokenCount ?? -1) < 0 ||
    typeof verified.tokenizerId !== 'string' || !verified.tokenizerId ||
    typeof verified.counterId !== 'string' || !verified.counterId ||
    typeof verified.model !== 'string' || !verified.model
  )) throw new ContextAssemblyConfigurationError('Verified NPC memory token-count metadata is invalid.');
  if (!usesVerifiedCount && (!synchronous.tokenizer || typeof synchronous.tokenizer.id !== 'string' || !synchronous.tokenizer.id || typeof synchronous.tokenizer.count !== 'function')) {
    throw new ContextAssemblyConfigurationError('NPC memory context requires a configured tokenizer.');
  }
  const tokenizerId=usesVerifiedCount ? verified.tokenizerId! : synchronous.tokenizer!.id;
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || !Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1) {
    throw new ContextAssemblyConfigurationError('NPC memory context budgets must be positive integers.');
  }
  const sourceManifest = [...input.sources].map((source) => ({ ...source })).sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version || a.hash.localeCompare(b.hash));
  const required = [...new Set(input.requiredSourceIds ?? [])].sort();
  const included = [...new Set(sourceManifest.map((source) => source.id))].sort();
  const missing = required.filter((id) => !included.includes(id));
  const serialized = canonicalNpcMemoryContextPayload(input);
  const bytes = utf8Bytes(serialized);
  const tokens = usesVerifiedCount ? verified.tokenCount! : synchronous.tokenizer!.count(serialized);
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new ContextAssemblyConfigurationError('The configured tokenizer returned an invalid count.');
  if (input.counterDurationMs !== undefined && (!Number.isSafeInteger(input.counterDurationMs) || input.counterDurationMs < 0)) throw new ContextAssemblyConfigurationError('Verified NPC memory counter duration is invalid.');
  if (missing.length) throw new InsufficientNpcMemoryContextError(`Required NPC memory evidence is unavailable: ${missing.join(', ')}.`);
  if (bytes > input.maxBytes || tokens > input.maxTokens) throw new InsufficientNpcMemoryContextError('Authorized NPC memory evidence exceeds the frozen-context budget.');
  return freeze({ policyVersion: input.policyVersion, projectionVersion: input.projectionVersion, tokenizer: tokenizerId, ...(input.model?{model:input.model}:{}), ...(input.counterId?{counterId:input.counterId}:{}), ...(input.counterDurationMs!==undefined?{counterDurationMs:input.counterDurationMs}:{}), ...(input.cutoffSequence!=null?{cutoffSequence:input.cutoffSequence}:{}), ...(input.view?{view:input.view}:{}), ...(input.revision!==undefined?{revision:input.revision}:{}), sourceManifest: freeze(sourceManifest), coverage: freeze({ required, included, missing, complete: true }), payload: freeze({ ...input.payload }), canonicalJson: serialized, utf8Bytes: bytes, tokens, hash: sha256Hex(serialized) });
}
