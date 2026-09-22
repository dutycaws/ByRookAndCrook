import type { NpcMemorySummaryV2Provider, NpcMemorySummaryV2Prepared } from './contracts';

export class NpcMemorySummaryProviderError extends Error {
  constructor(public readonly code: 'provider_unavailable' | 'provider_failed' | 'provider_timeout' | 'provider_malformed', message: string) { super(message); }
}
const OUTPUT_RESERVE = 4_096;
const TRANSPORT_LIMIT = 384 * 1024;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as object)) freeze(child); } return value; };
function resultSchema(maxSummaryChars: number, maxCitations: number) {
  const leaf = { type: 'object', additionalProperties: false, required: ['ordinal', 'sourceKind', 'sourceId', 'sourceVersion', 'sourceHash', 'ledgerSequence'], properties: { ordinal: { type: 'integer', minimum: 0 }, sourceKind: { type: 'string', minLength: 1 }, sourceId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, sourceVersion: { type: 'integer', minimum: 1 }, sourceHash: { type: 'string', pattern: '^[0-9a-f]{64}$' }, ledgerSequence: { type: 'integer', minimum: 0 } } };
  const citation = { type: 'object', additionalProperties: false, required: ['leafOrdinal', 'recordId', 'speaker', 'quote', 'sourceKind', 'sourceId', 'sourceVersion', 'sourceHash'], properties: { leafOrdinal: { type: 'integer', minimum: 0 }, recordId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, speaker: { type: 'string' }, quote: { type: 'string', minLength: 1, maxLength: 12000 }, sourceKind: { type: 'string', minLength: 1 }, sourceId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, sourceVersion: { type: 'integer', minimum: 0 }, sourceHash: { type: 'string', pattern: '^[0-9a-f]{64}$' } } };
  return { type: 'object', additionalProperties: false, required: ['version', 'mode', 'summary', 'citations', 'protectedRefs', 'leaves'], properties: { version: { const: 'npc-memory-summary-v2' }, mode: { const: 'model' }, summary: { type: 'string', minLength: 1, maxLength: maxSummaryChars }, citations: { type: 'array', maxItems: maxCitations, items: citation }, protectedRefs: { type: 'array', items: leaf }, leaves: { type: 'array', items: leaf } } };
}
export function createNpcMemorySummaryV2Provider(config: Record<string, string | undefined>): NpcMemorySummaryV2Provider {
  const key = config.OPENAI_API_KEY, configuredModel = config.NPC_CONTEXT_MODEL, capacity = Number(config.NPC_MODEL_INPUT_CAPACITY);
  const fail = (code: NpcMemorySummaryProviderError['code'], message: string): never => { throw new NpcMemorySummaryProviderError(code, message); };
  const configured = (model: string) => { if (!key) fail('provider_unavailable', 'OpenAI is not configured.'); if (!configuredModel || configuredModel !== model || !Number.isSafeInteger(capacity) || capacity <= OUTPUT_RESERVE) fail('provider_unavailable', 'Verified model capacity is not configured.'); };
  return {
    async preflight({ systemPrompt, payload, model, maxSummaryChars, maxCitations, maxBytes, signal }) {
      configured(model);
      if (!model.trim() || !systemPrompt.trim() || !Number.isSafeInteger(maxSummaryChars) || maxSummaryChars < 1 || !Number.isSafeInteger(maxCitations) || maxCitations < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > TRANSPORT_LIMIT) fail('provider_malformed', 'Summary request bounds are invalid.');
      const body = { model, store: false, max_output_tokens: OUTPUT_RESERVE, input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(payload) }], text: { format: { type: 'json_schema', name: 'npc_memory_summary_v2', strict: true, schema: resultSchema(maxSummaryChars, maxCitations) } } };
      if (bytes(body) > Math.min(maxBytes, TRANSPORT_LIMIT)) fail('provider_malformed', 'Summary request exceeds byte ceiling.');
      const started = performance.now(); let response: Response | undefined;
      try { response = await fetch('https://api.openai.com/v1/responses/input_tokens', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: body.input, text: body.text }), signal }); } catch { fail(signal.aborted ? 'provider_timeout' : 'provider_failed', 'Summary token preflight failed.'); }
      if (!response || !response.ok) fail(response?.status === 401 || response?.status === 403 ? 'provider_unavailable' : 'provider_failed', 'Summary token preflight failed.');
      const countedResponse = response as Response; let counted: unknown; try { counted = await countedResponse.json(); } catch { fail('provider_malformed', 'Summary token preflight was malformed.'); }
      const inputTokens: unknown = isObject(counted) ? counted.input_tokens : undefined;
      if (!Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0 || (inputTokens as number) > 80_000 || (inputTokens as number) + OUTPUT_RESERVE > capacity) fail('provider_malformed', 'Summary input budget is invalid.');
      return { prepared: freeze({ body, model, inputTokens: inputTokens as number, maxSummaryChars, maxCitations }) as NpcMemorySummaryV2Prepared, inputTokens: inputTokens as number, durationMs: Math.round(performance.now() - started) };
    },
    async generate({ prepared, signal }) {
      configured(prepared.model); const started = performance.now(); let response: Response | undefined;
      try { response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(prepared.body), signal }); } catch { fail(signal.aborted ? 'provider_timeout' : 'provider_failed', 'Summary provider failed.'); }
      if (!response || !response.ok) fail('provider_failed', 'Summary provider failed.'); const generatedResponse = response as Response; let json: unknown; try { json = await generatedResponse.json(); } catch { fail('provider_malformed', 'Summary provider response was malformed.'); }
      if (!isObject(json) || json.status !== 'completed' || !isObject(json.usage) || !Number.isSafeInteger(json.usage.input_tokens) || !Number.isSafeInteger(json.usage.output_tokens) || (json.usage.input_tokens as number) < 0 || (json.usage.output_tokens as number) < 0) fail('provider_malformed', 'Summary provider response was incomplete.');
      const providerJson = json as Record<string, unknown>; const usage = providerJson.usage as Record<string, unknown>; const parts = (Array.isArray(providerJson.output) ? providerJson.output : []).filter(isObject).filter((x: Record<string, unknown>) => x.type === 'message').flatMap((x: Record<string, unknown>) => Array.isArray(x.content) ? x.content : []).filter(isObject).filter((x: Record<string, unknown>) => x.type === 'output_text' && typeof x.text === 'string').map((x: Record<string, unknown>) => x.text as string);
      if (parts.length !== 1) fail('provider_malformed', 'Summary provider output was malformed.'); let result: unknown; try { result = JSON.parse(parts[0]); } catch { fail('provider_malformed', 'Summary provider output was malformed.'); } if (!isObject(result)) fail('provider_malformed', 'Summary provider output was malformed.');
      const requestId = generatedResponse.headers.get('x-request-id'); if (requestId !== null && (!requestId || requestId.length > 200)) fail('provider_malformed', 'Summary provider request ID was malformed.');
      return { result: result as Record<string, unknown>, model: prepared.model, providerRequestId: requestId ?? undefined, inputTokens: usage.input_tokens as number, outputTokens: usage.output_tokens as number, durationMs: Math.round(performance.now() - started) };
    }
  };
}
