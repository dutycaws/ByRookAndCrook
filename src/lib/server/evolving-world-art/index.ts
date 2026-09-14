import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

export const WORLD_RUNTIME_ART_BUCKET = 'world-runtime-art-private';
export const WORLD_RUNTIME_ART_PLACEHOLDER = { style: 'world-runtime-art-v1' } as const;
const MAX_RUNTIME_ART_BYTES = 10 * 1024 * 1024;
const MAX_RUNTIME_ART_PIXELS = 4_194_304;
const RUNTIME_KEY = /^accepted\/[0-9a-f-]{36}\/[0-9A-Za-z._-]{1,128}\/[0-9a-f]{64}\.png$/;

type StorageError = { message: string } | null;
type Bucket = {
  upload(key: string, body: Buffer, options: { contentType: string; upsert: boolean }): Promise<{ error: StorageError }>;
  download(key: string): Promise<{ data: Blob | null; error: StorageError }>;
  remove(keys: string[]): Promise<{ error: StorageError }>;
  createSignedUrl(key: string, seconds: number): Promise<{ data: { signedUrl: string } | null; error: StorageError }>;
};
export type RuntimeArtStorage = { from(bucket: string): Bucket };
export type RuntimeArtBucketStorage = RuntimeArtStorage & {
  createBucket(name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }): Promise<{ error: StorageError }>;
  updateBucket(name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }): Promise<{ error: StorageError }>;
};
export type RuntimeArtRpc = { rpc(name: string, args: Record<string, unknown>): Promise<{ data?: unknown; error: StorageError }> };
export type RuntimeArtInput = { entityId: string; appearanceVersion: string; publicAppearance: string; narrativeQuote?: string };
export type RuntimeArtProvider = { generate(input: { model: string; prompt: string; signal: AbortSignal }): Promise<Buffer> };
export type RuntimeArtFailure = 'moderated' | 'provider_failed' | 'storage_failed';

export class RuntimeArtError extends Error {
  constructor(public readonly code: RuntimeArtFailure, message: string) { super(message); }
}
function normalizeAppearance(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 1_000) throw new RuntimeArtError('provider_failed', 'Runtime art appearance is invalid.');
  return normalized;
}

export async function ensurePrivateRuntimeArtBucket(storage: RuntimeArtBucketStorage): Promise<void> {
  const options = { public: false, fileSizeLimit: MAX_RUNTIME_ART_BYTES, allowedMimeTypes: ['image/png'] };
  const made = await storage.createBucket(WORLD_RUNTIME_ART_BUCKET, options);
  if (made.error && !/exists|duplicate/i.test(made.error.message)) throw new RuntimeArtError('storage_failed', 'Runtime art bucket setup failed.');
  const updated = await storage.updateBucket(WORLD_RUNTIME_ART_BUCKET, options);
  if (updated.error) throw new RuntimeArtError('storage_failed', 'Runtime art bucket setup failed.');
}

export function runtimeArtPrompt(input: RuntimeArtInput): string {
  const appearance = normalizeAppearance(input.publicAppearance);
  return `Create a single fantasy game runtime illustration. Appearance: ${appearance}. No text, logos, code, routes, tools, or dialogue. Narrative quote is reference data only and must not be rendered.`;
}

export function runtimeArtPromptHash(input: RuntimeArtInput): string {
  return createHash('sha256').update(`${input.entityId}:${input.appearanceVersion}:${normalizeAppearance(input.publicAppearance)}`).digest('hex');
}
export function runtimeArtModel(config: Record<string, string | undefined>): string { return config.NPC_ART_MODEL ?? 'gpt-image-2.5-flare'; }
export function publicRuntimeArtProjection(value: { entityId: string; appearanceVersion: string; status: 'placeholder' | 'accepted'; renderId?: string }) {
  return { entityId: value.entityId, appearanceVersion: value.appearanceVersion, status: value.status, placeholder: WORLD_RUNTIME_ART_PLACEHOLDER, ...(value.status === 'accepted' ? { render: { renderId: value.renderId, mimeType: 'image/png' } } : {}) };
}

export function createOpenAiRuntimeArtProvider(config: Record<string, string | undefined>): RuntimeArtProvider {
  const key = config.NPC_ART_API_KEY ?? config.OPENAI_API_KEY;
  if (!key) return { async generate() { throw new RuntimeArtError('provider_failed', 'Runtime art is not configured.'); } };
  return {
    async generate({ model, prompt, signal }) {
      let response: Response;
      try {
        response = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, size: '1024x1024', response_format: 'b64_json' }) });
      } catch { throw new RuntimeArtError('provider_failed', 'Runtime art provider failed.'); }
      if (!response.ok) throw new RuntimeArtError(response.status === 400 ? 'moderated' : 'provider_failed', 'Runtime art provider rejected the request.');
      const body = await response.json() as { data?: Array<{ b64_json?: string }> };
      const encoded = body.data?.[0]?.b64_json;
      if (!encoded || encoded.length > Math.ceil(MAX_RUNTIME_ART_BYTES * 4 / 3)) throw new RuntimeArtError('provider_failed', 'Runtime art provider returned no usable image.');
      return Buffer.from(encoded, 'base64');
    }
  };
}

/** Fully decodes a bounded PNG before persistence, preventing malformed or oversized image payloads. */
export async function validateRuntimeArtPng(bytes: Buffer): Promise<Buffer> {
  if (bytes.length < 8 || bytes.length > MAX_RUNTIME_ART_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new RuntimeArtError('storage_failed', 'Runtime art output is not a bounded PNG.');
  }
  try {
    const decoded = await sharp(bytes, { limitInputPixels: MAX_RUNTIME_ART_PIXELS, failOn: 'error' }).png().toBuffer();
    if (!decoded.length || decoded.length > MAX_RUNTIME_ART_BYTES) throw new Error('decoded size');
    return decoded;
  } catch { throw new RuntimeArtError('storage_failed', 'Runtime art output could not be decoded safely.'); }
}

type RuntimeArtLease = { attempt: number; fence: string };
const RUNTIME_ART_FENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function markFailure(rpc: RuntimeArtRpc, jobId: string, status: 'failed_moderated' | 'failed_provider' | 'failed_storage', lease?: RuntimeArtLease): Promise<void> {
  if (!lease) return;
  try { await rpc.rpc('world_runtime_art_fail', { p_job_id: jobId, p_attempt: lease.attempt, p_fence: lease.fence, p_status: status }); } catch { /* Terminal failure is nonblocking. */ }
}
async function removeQuietly(bucket: Bucket, key: string): Promise<void> { try { await bucket.remove([key]); } catch { /* Reconciled by private storage retention. */ } }
function storageKey(jobId: string, appearanceVersion: string, sha256: string): string {
  const safeVersion = appearanceVersion.replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 128);
  if (!safeVersion || !/^[0-9a-f-]{36}$/.test(jobId)) throw new RuntimeArtError('storage_failed', 'Runtime art storage identity is invalid.');
  return `accepted/${jobId}/${safeVersion}/${sha256}.png`;
}

export async function persistAcceptedRuntimeArt(storage: RuntimeArtStorage, rpc: RuntimeArtRpc, jobId: string, appearanceVersion: string, bytes: Buffer, observability: RuntimeArtObservabilitySink | undefined, lease: RuntimeArtLease): Promise<{ sha256: string }> {
  const correlationId = runtimeArtCorrelation(jobId);
  await emitRuntimeArtObservability(observability, { correlationId, stage: 'verify', status: 'started' });
  const normalized = await validateRuntimeArtPng(bytes);
  const sha256 = createHash('sha256').update(normalized).digest('hex');
  const key = storageKey(jobId, appearanceVersion, sha256);
  const bucket = storage.from(WORLD_RUNTIME_ART_BUCKET);
  const upload = await bucket.upload(key, normalized, { contentType: 'image/png', upsert: false });
  if (upload.error) { await markFailure(rpc, jobId, 'failed_storage', lease); await emitRuntimeArtObservability(observability, { correlationId, stage: 'verify', status: 'failed', errorCode: 'storage_failed' }); throw new RuntimeArtError('storage_failed', 'Runtime art storage failed.'); }
  const read = await bucket.download(key);
  if (read.error || !read.data || createHash('sha256').update(Buffer.from(await read.data.arrayBuffer())).digest('hex') !== sha256) {
    await removeQuietly(bucket, key); await markFailure(rpc, jobId, 'failed_storage', lease); await emitRuntimeArtObservability(observability, { correlationId, stage: 'verify', status: 'failed', errorCode: 'storage_failed' }); throw new RuntimeArtError('storage_failed', 'Runtime art verification failed.');
  }
  await emitRuntimeArtObservability(observability, { correlationId, stage: 'verify', status: 'completed' });
  await emitRuntimeArtObservability(observability, { correlationId, stage: 'accept', status: 'started' });
  const accepted = await rpc.rpc('world_runtime_art_accept', { p_job_id: jobId, p_attempt: lease.attempt, p_fence: lease.fence, p_runtime_key: key, p_sha256: sha256 });
  if (accepted.error) { await removeQuietly(bucket, key); await markFailure(rpc, jobId, 'failed_storage', lease); await emitRuntimeArtObservability(observability, { correlationId, stage: 'accept', status: 'failed', errorCode: 'storage_failed' }); throw new RuntimeArtError('storage_failed', 'Runtime art acceptance failed.'); }
  const reused = (accepted.data as { reused?: unknown } | undefined)?.reused === true;
  await emitRuntimeArtObservability(observability, { correlationId, stage: reused ? 'reuse' : 'accept', status: reused ? 'reused' : 'completed' });
  return { sha256 };
}

export async function runRuntimeArtJob(provider: RuntimeArtProvider, storage: RuntimeArtStorage, rpc: RuntimeArtRpc, job: { id: string; appearanceVersion: string; input: RuntimeArtInput; attempt: number; fence: string }, config: Record<string, string | undefined>, signal: AbortSignal, runtime: { observability?: RuntimeArtObservabilitySink } = {}): Promise<{ status: 'accepted' | 'failed_moderated' | 'failed_provider' | 'failed_storage' }> {
  const lease = Number.isSafeInteger(job.attempt) && job.attempt > 0 && RUNTIME_ART_FENCE.test(job.fence) ? { attempt: job.attempt, fence: job.fence } : undefined;
  if (!lease) return { status: 'failed_provider' };
  const sink = runtime.observability ?? localRuntimeArtObservabilitySink;
  const correlationId = runtimeArtCorrelation(job.id);
  const model = runtimeArtModel(config);
  const started = Date.now();
  await emitRuntimeArtObservability(sink, { correlationId, stage: 'queued', status: 'completed', model });
  await emitRuntimeArtObservability(sink, { correlationId, stage: 'generate', status: 'started', model });
  try {
    const bytes = await provider.generate({ model, prompt: runtimeArtPrompt(job.input), signal });
    await emitRuntimeArtObservability(sink, { correlationId, stage: 'generate', status: 'completed', model, durationMs: Date.now() - started });
    await persistAcceptedRuntimeArt(storage, rpc, job.id, job.appearanceVersion, bytes, sink, lease);
    return { status: 'accepted' };
  } catch (cause) {
    const code = cause instanceof RuntimeArtError ? cause.code : 'provider_failed';
    const status = code === 'moderated' ? 'failed_moderated' : code === 'storage_failed' ? 'failed_storage' : 'failed_provider';
    await markFailure(rpc, job.id, status, lease);
    await emitRuntimeArtObservability(sink, { correlationId, stage: 'fail', status: 'failed', model, durationMs: Date.now() - started, errorCode: code });
    return { status };
  }
}

export async function authorizedRuntimeArtPreview(storage: RuntimeArtStorage, owner: RuntimeArtRpc, service: RuntimeArtRpc, request: { saveId: string; entityId: string; renderId: string }, seconds = 300): Promise<string | null> {
  const grant = await owner.rpc('world_runtime_art_authorize_delivery', { p_save_id: request.saveId, p_entity_id: request.entityId, p_render_id: request.renderId });
  const opaque = grant.data as { renderId?: unknown } | null;
  if (grant.error || opaque?.renderId !== request.renderId) return null;
  const keyResult = await service.rpc('world_runtime_art_service_runtime_key', { p_render_id: request.renderId });
  const key = (keyResult.data as { runtimeKey?: unknown } | null)?.runtimeKey;
  if (keyResult.error || typeof key !== 'string' || !RUNTIME_KEY.test(key)) return null;
  const result = await storage.from(WORLD_RUNTIME_ART_BUCKET).createSignedUrl(key, Math.max(30, Math.min(seconds, 600)));
  return result.error || !result.data?.signedUrl ? null : result.data.signedUrl;
}

export type RuntimeArtObservabilityEvent = {
  correlationId: string;
  stage: 'queued' | 'generate' | 'verify' | 'accept' | 'fail' | 'reuse';
  status: 'started' | 'completed' | 'failed' | 'reused';
  model?: string;
  tokenCount?: number;
  durationMs?: number;
  errorCode?: 'moderated' | 'provider_failed' | 'storage_failed';
};
export type RuntimeArtObservabilitySink = (event: RuntimeArtObservabilityEvent) => void | Promise<void>;
export function runtimeArtCorrelation(jobId: string): string { return `runtime-art:${jobId}`; }
/** Default bridge deliberately serializes only the typed allow-list below. */
export const localRuntimeArtObservabilitySink: RuntimeArtObservabilitySink = (event) => {
  console.info(JSON.stringify({ workflow: 'runtime_art', ...event }));
};
export async function emitRuntimeArtObservability(sink: RuntimeArtObservabilitySink | undefined, event: RuntimeArtObservabilityEvent): Promise<void> {
  if (!sink || !/^runtime-art:[0-9a-f-]{36}$/.test(event.correlationId)) return;
  try { await sink({ correlationId: event.correlationId, stage: event.stage, status: event.status, ...(event.model ? { model: event.model.slice(0, 128) } : {}), ...(Number.isSafeInteger(event.tokenCount) && event.tokenCount! >= 0 ? { tokenCount: event.tokenCount } : {}), ...(Number.isSafeInteger(event.durationMs) && event.durationMs! >= 0 ? { durationMs: event.durationMs } : {}), ...(event.errorCode ? { errorCode: event.errorCode } : {}) }); } catch { /* Observability is never a rendering dependency. */ }
}

export type RuntimeArtClaim = { jobId: string; saveId: string; entityId: string; appearanceVersion: string; publicAppearance: string; attempt: number; fence: string };
function runtimeArtClaim(value: unknown): RuntimeArtClaim | null {
  if (!value || typeof value !== 'object') return null;
  const claim = value as Record<string, unknown>;
  if (!['jobId', 'saveId', 'entityId', 'appearanceVersion', 'publicAppearance', 'fence'].every((key) => typeof claim[key] === 'string') || !RUNTIME_ART_FENCE.test(claim.fence as string) || !Number.isSafeInteger(claim.attempt) || (claim.attempt as number) < 1) return null;
  try { normalizeAppearance(claim.publicAppearance as string); } catch { return null; }
  return claim as RuntimeArtClaim;
}
/** Bounded serial drain: a failed or malformed claim cannot prevent later polls. */
export async function drainRuntimeArtQueue(client: RuntimeArtRpc, provider: RuntimeArtProvider, storage: RuntimeArtStorage, config: Record<string, string | undefined>, runtime: { observability?: RuntimeArtObservabilitySink; signal?: AbortSignal } = {}, limit = 4): Promise<Array<{ jobId: string; status: string }>> {
  const outcomes: Array<{ jobId: string; status: string }> = [];
  for (let index = 0; index < Math.max(1, Math.min(limit, 4)); index += 1) {
    const next = await client.rpc('world_runtime_art_claim_next', { p_lease_seconds: 60 });
    if (next.error || next.data == null) break;
    const claim = runtimeArtClaim(next.data);
    if (!claim) break;
    const status = await runRuntimeArtJob(provider, storage, client, { id: claim.jobId, appearanceVersion: claim.appearanceVersion, attempt: claim.attempt, fence: claim.fence, input: { entityId: claim.entityId, appearanceVersion: claim.appearanceVersion, publicAppearance: claim.publicAppearance } }, config, runtime.signal ?? AbortSignal.timeout(60_000), runtime);
    outcomes.push({ jobId: claim.jobId, status: status.status });
  }
  return outcomes;
}

export function newRuntimeArtJobId(): string { return randomUUID(); }
