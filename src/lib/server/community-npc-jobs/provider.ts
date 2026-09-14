import type { NpcSheet } from '$lib/game/npc-sheet';

export type AuthoringProviderAvailability =
  | { available: true }
  | { available: false; reason: 'local_not_implemented' | 'missing_openai_key' | 'unknown_provider' };

export type SandboxTurn = { role: 'keeper' | 'npc'; content: string };
export type AssistanceRequest = { section: string; instruction: string; sheet: NpcSheet };
export type AssistanceResponse = { replacement: unknown; explanation: string };
export type SandboxRequest = { sheet: NpcSheet; turns: SandboxTurn[] };

/** A narrow provider seam. Only server jobs construct the production adapter. */
export interface AuthoringProvider {
  assist(request: AssistanceRequest, signal: AbortSignal): Promise<AssistanceResponse>;
  sandbox(request: SandboxRequest, signal: AbortSignal): Promise<{ reply: string }>;
}

export class AuthoringProviderError extends Error {
  constructor(public readonly code: 'provider_unavailable' | 'provider_timeout' | 'provider_malformed' | 'provider_failed', message: string) {
    super(message);
    this.name = 'AuthoringProviderError';
  }
}

export function authoringProviderAvailability(config: Record<string, string | undefined>): AuthoringProviderAvailability {
  const provider = config.NPC_PROVIDER ?? 'openai';
  if (provider === 'local') return { available: false, reason: 'local_not_implemented' };
  if (provider !== 'openai') return { available: false, reason: 'unknown_provider' };
  if (!config.OPENAI_API_KEY) return { available: false, reason: 'missing_openai_key' };
  return { available: true };
}

function outputText(result: any): string {
  return result.output
    ?.filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === 'output_text')
    .map((item: any) => item.text)
    .join('') ?? '';
}

function structuredFormat(name: string, schema: Record<string, unknown>): Record<string, unknown> {
  return { format: { type: 'json_schema', name, strict: true, schema } };
}

const assistanceSchema = {
  type: 'object', additionalProperties: false,
  required: ['replacementJson', 'explanation'],
  properties: {
    replacementJson: { type: 'string', minLength: 2, maxLength: 12000 },
    explanation: { type: 'string', minLength: 1, maxLength: 600 }
  }
};

const sandboxSchema = {
  type: 'object', additionalProperties: false,
  required: ['reply'],
  properties: { reply: { type: 'string', minLength: 1, maxLength: 4000 } }
};

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch {
    throw new AuthoringProviderError('provider_malformed', 'The provider returned malformed structured data.');
  }
}

function abortError(signal: AbortSignal): AuthoringProviderError | null {
  if (!signal.aborted) return null;
  return new AuthoringProviderError('provider_timeout', 'The provider request timed out.');
}

async function requestOpenAi(config: Record<string, string | undefined>, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const abort = abortError(signal);
  if (abort) throw abort;
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
  } catch (cause) {
    const aborted = abortError(signal);
    if (aborted) throw aborted;
    throw new AuthoringProviderError('provider_failed', cause instanceof Error ? cause.message : 'The provider request failed.');
  }
  if (!response.ok) {
    if (response.status === 408 || response.status === 504) throw new AuthoringProviderError('provider_timeout', 'The provider request timed out.');
    if (response.status === 401 || response.status === 403) throw new AuthoringProviderError('provider_unavailable', 'The configured provider credential was rejected.');
    throw new AuthoringProviderError('provider_failed', `The provider request failed (${response.status}).`);
  }
  let result: any;
  try { result = await response.json(); } catch { throw new AuthoringProviderError('provider_malformed', 'The provider returned an unreadable response.'); }
  if (result.status !== 'completed') throw new AuthoringProviderError('provider_failed', 'The provider did not complete the request.');
  return result;
}

/**
 * Server-only OpenAI Responses adapter. The stringified replacement keeps the
 * response schema strict while allowing each supported authoring section to
 * retain its canonical shape.
 */
export function createAuthoringProvider(config: Record<string, string | undefined>): AuthoringProvider {
  const availability = authoringProviderAvailability(config);
  if (!availability.available) {
    return {
      async assist() { throw new AuthoringProviderError('provider_unavailable', availability.reason); },
      async sandbox() { throw new AuthoringProviderError('provider_unavailable', availability.reason); }
    };
  }
  const model = config.NPC_AUTHORING_MODEL ?? config.NPC_CHARACTER_MODEL ?? 'gpt-5.6-terra';
  return {
    async assist(request, signal) {
      const result = await requestOpenAi(config, {
        model, store: false, max_output_tokens: 2200, reasoning: { effort: 'low' },
        input: [
          { role: 'system', content: 'You assist a game author. Return a replacement only for the requested NPC sheet section. Preserve established facts unless the instruction asks for a supported change. Do not invent world outcomes, internal IDs, or other sections.' },
          { role: 'user', content: JSON.stringify({ task: 'replace_one_section', section: request.section, instruction: request.instruction, sheet: request.sheet, currentSection: (request.sheet as unknown as Record<string, unknown>)[request.section] }) }
        ],
        text: structuredFormat('npc_authoring_assistance', assistanceSchema)
      }, signal) as any;
      const parsed = safeJson(outputText(result)) as { replacementJson?: unknown; explanation?: unknown };
      if (typeof parsed.replacementJson !== 'string' || typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
        throw new AuthoringProviderError('provider_malformed', 'The provider omitted the suggested section or explanation.');
      }
      return { replacement: safeJson(parsed.replacementJson), explanation: parsed.explanation.trim() };
    },
    async sandbox(request, signal) {
      const result = await requestOpenAi(config, {
        model, store: false, max_output_tokens: 1600, reasoning: { effort: 'low' },
        input: [
          { role: 'system', content: 'You are roleplaying the supplied NPC in an isolated authoring sandbox. Follow only the frozen NPC sheet, maintain continuity with prior turns, and never claim to alter the draft, save, or game world.' },
          { role: 'user', content: JSON.stringify({ task: 'sandbox_reply', sheet: request.sheet, turns: request.turns }) }
        ],
        text: structuredFormat('npc_authoring_sandbox', sandboxSchema)
      }, signal) as any;
      const parsed = safeJson(outputText(result)) as { reply?: unknown };
      if (typeof parsed.reply !== 'string' || !parsed.reply.trim() || parsed.reply.trim().length > 4000) {
        throw new AuthoringProviderError('provider_malformed', 'The provider returned an invalid sandbox reply.');
      }
      return { reply: parsed.reply.trim() };
    }
  };
}
