import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/database.types';

export const expressionSpriteSlots = ['neutral', 'happy', 'sad', 'angry', 'engaged', 'leaving'] as const;
export type ExpressionSpriteSlot = typeof expressionSpriteSlots[number];

/**
 * This is the only job-status shape that crosses an authoring route boundary.
 * In particular, preview grants, hashes, prompt material, storage keys and
 * provider diagnostics must be resolved or retained on the server.
 */
export type PortraitJobAlternativeSnapshot = {
  ordinal: number;
  stage: string;
  status: string;
  candidateId: string | null;
  errorCode: string | null;
};
export type PortraitJobSnapshot = {
  jobId: string;
  slot: ExpressionSpriteSlot;
  status: string;
  alternatives: PortraitJobAlternativeSnapshot[];
  candidates: Array<{
    candidateId: string;
    slot: ExpressionSpriteSlot;
    source: 'author_upload' | 'ai_generated';
    state: string;
    previewUrl: string | null;
    altText: string;
    width: number | null;
    height: number | null;
    hasAlpha: boolean | null;
    mimeType: string | null;
    staleNeutralAnchor: boolean;
  }>;
  pollAfterMs: number;
};

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}
function optionalText(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null; }
function expressionSlot(value: unknown): ExpressionSpriteSlot | null {
  return expressionSpriteSlots.includes(value as ExpressionSpriteSlot) ? value as ExpressionSpriteSlot : null;
}

/** Strip a database portrait job down before resolving authorization-scoped previews. */
export function safePortraitJobSnapshot(value: unknown): PortraitJobSnapshot | null {
  const row = record(value);
  const jobId = optionalText(row.jobId);
  const slot = expressionSlot(row.slot);
  const status = optionalText(row.status);
  if (!jobId || !slot || !status) return null;
  const alternatives = (Array.isArray(row.alternatives) ? row.alternatives : []).flatMap((entry) => {
    const alternative = record(entry);
    const ordinal = Number(alternative.ordinal);
    const stage = optionalText(alternative.stage);
    const alternativeStatus = optionalText(alternative.status);
    if (!Number.isInteger(ordinal) || ordinal < 1 || !stage || !alternativeStatus) return [];
    return [{ ordinal, stage, status: alternativeStatus, candidateId: optionalText(alternative.candidateId), errorCode: optionalText(alternative.errorCode) }];
  });
  const candidates = (Array.isArray(row.candidates) ? row.candidates : []).flatMap((entry) => {
    const candidate = record(entry);
    const candidateId = optionalText(candidate.candidateId ?? candidate.id);
    const candidateSlot = expressionSlot(candidate.slot);
    const source: 'author_upload' | 'ai_generated' | null = candidate.source === 'author_upload' || candidate.source === 'ai_generated' ? candidate.source : null;
    const state = optionalText(candidate.state);
    if (!candidateId || !candidateSlot || !source || !state) return [];
    return [{
      candidateId, slot: candidateSlot, source, state,
      // The opaque token is intentionally not included in this DTO. Routes
      // use it transiently to obtain a signed URL after ownership is checked.
      previewUrl: null,
      altText: optionalText(candidate.altText) ?? 'Expression sprite candidate.',
      width: Number.isFinite(Number(candidate.width)) ? Number(candidate.width) : null,
      height: Number.isFinite(Number(candidate.height)) ? Number(candidate.height) : null,
      hasAlpha: typeof candidate.hasAlpha === 'boolean' ? candidate.hasAlpha : null,
      mimeType: optionalText(candidate.mimeType),
      staleNeutralAnchor: candidate.staleNeutralAnchor === true
    }];
  });
  return { jobId, slot, status, alternatives, candidates, pollAfterMs: 2_000 };
}

export function portraitJobIsTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status);
}

export type CommunityContext = { profile: Record<string, unknown>; capabilities: string[] };
export async function communityContext(client: SupabaseClient<Database>): Promise<CommunityContext> {
  const [profile, capabilities] = await Promise.all([client.rpc('npc_profile_me'), client.rpc('npc_my_capabilities')]);
  if (profile.error || capabilities.error) error(500, 'The community ledger is unavailable.');
  return { profile: (profile.data ?? {}) as Record<string, unknown>, capabilities: (capabilities.data ?? []) as string[] };
}
export function requireCapability(context: CommunityContext, capability: string): void {
  if (!context.capabilities.includes('admin') && !context.capabilities.includes(capability)) error(403, 'This workspace requires community access.');
}
export async function rpcJson(client: SupabaseClient<Database>, name: keyof Database['public']['Functions'], args?: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name as never, args as never);
  if (result.error) throw new Error(result.error.message);
  return result.data as Json;
}
