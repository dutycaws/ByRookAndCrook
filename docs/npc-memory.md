# NPC memory operations and privacy

Issue #33 adds a server-only, source-backed NPC-memory path. It improves context selection; it does not replace the canonical dialogue turn, quest, profile, or world-event records. A derived record is never authority to change a quest, fulfill a promise, grant a capability, or apply a game effect.

## Configuration and limits

The current provider settings remain the dialogue settings in the root, Git-ignored `.env`:

| Setting | Current behavior |
| --- | --- |
| `NPC_PROVIDER` | `openai` by default; `local` reports an explicit unimplemented provider. |
| `NPC_CONTEXT_MODEL` | Defaults to `gpt-5.6-luna` for investigation, review, and the existing remember stage. |
| `NPC_CHARACTER_MODEL` | Defaults to `gpt-5.6-terra` for deliberation and speech. |
| `NPC_MAX_CALLS`, `NPC_INVESTIGATION_ROUNDS`, `NPC_DEADLINE_MS` | Keep their existing dialogue limits: 8 calls, 1–2 rounds, and 1,000–90,000 ms respectively. |

There is no separate memory-worker environment variable in this revision. A worker supplies its explicit processor kind/version and source loader. Embedding is optional and must be supplied by a server-only worker adapter; no external vector database or cache service is used.

The shared context assembler requires an explicit, verified tokenizer for the selected model. It measures canonical JSON with UTF-8 bytes and that tokenizer's count; it never estimates tokens from JavaScript character length or a bytes-per-token ratio. Callers provide positive byte/token ceilings. Missing required sources or an over-ceiling artifact returns an explicit recoverable context error. The currently integrated dialogue context uses a 64 KiB frozen-evidence ceiling and a 384 KiB provider-envelope ceiling; no model-aware dialogue tokenizer is configured yet, so token admission for that legacy path remains explicitly unsupported rather than estimated.

## Source records, retrieval, and context freezing

On completion of a dialogue turn, the database enqueues an `extract` job keyed by source kind, source ID, source version, processor kind, and processor version. Existing completed turns are backfilled once by the migration. The worker reuses the committed `remember` output; it does not make a second extraction model call. Summary work has a deterministic extractive fallback that preserves speaker attribution and original words. Embedding work is optional; a missing embedding adapter must not affect gameplay.

Memory retrieval is owner-scoped by the authenticated save and NPC instance, has a captured sequence cutoff, and allows only the requested view's disclosure classes. It selects unresolved commitments and quest-linked evidence first, then lexical matches, then bounded recent/important evidence. It also returns six bounded, completed source exchanges while derived memory is absent or behind. Watermark output distinguishes contiguous/examined progress from a gap; an empty index or a gap is not proof that no memory exists.

Each frozen context artifact includes a canonical payload, SHA-256 hash, source manifest (ID/version/hash), policy/projection versions, tokenizer ID, byte/token measurements, and required/included/missing-source coverage. Retrying a checkpoint must reuse that captured evidence rather than querying a newer index. The quest-transition worker similarly wraps its terminal-bound frozen context in one deterministic dossier for every proposer/critic/repair stage, with a source-version manifest and UTF-8 byte measurements.

## Scope and privacy rules

The database source boundary checks the actor owns the NPC instance before returning evidence. Speech receives `player_visible` and `npc_known` material only; review/transition may also receive `npc_private`. `system` content is not returned. The cutoff prevents an NPC from learning a later exchange during a replay. Server-role code must still call the scoped boundary; it is not permission to dump another save's memory.

Telemetry contains only allowlisted operational measurements: selected/source counts, UTF-8 bytes, configured or model token counts when actually available, gap count, fresh/cache-hit/replayed status, and query/assembly durations. It never accepts prompt text, queries, source IDs, selected prose, payloads, provider output, beliefs, profiles, or secrets. A telemetry sink failure is best-effort and cannot alter dialogue or settlement execution.

## Queue operation, rebuild, retry, and purge

Claiming uses a per-job fence and a five-minute lease. A worker must complete with that fence; a stale fence is rejected. Duplicate deliveries reuse the unique source/version/processor key, and accepted artifacts reuse the unique `(instance, artifact kind, source hash, processor version)` key. A completed job may legitimately produce no artifact: the watermark records that it was examined.

To rebuild derived work, enqueue the affected canonical source set with a new processor version, then drain the bounded worker queue. This creates new immutable artifacts rather than overwriting accepted artifacts. The outbox claim function processes `pending` work and leases that expired while `processing`. A `failed` job is recorded with its sanitized error code and is not automatically claimed again in the current implementation; retry it by a deliberate re-enqueue/versioned rebuild after diagnosing the failure. Neither retries nor rebuilds may run inside a gameplay transaction.

Purge and quarantine take precedence over derived context. The source tables' existing retention/purge controls remain authoritative. This initial memory migration has **not yet added a dedicated purge/quarantine invalidation hook** for memory artifacts, outbox rows, or already-frozen contexts; do not treat replay or a background worker as a safe way to restore removed source material. Before relying on memory in a purge-capable environment, add and verify that hook so it invalidates affected artifacts/cache/context and fences late workers. This gap is intentionally documented rather than represented as complete behavior.

## Verification and live evaluation status

Focused unit coverage exercises canonical UTF-8/token accounting, missing required-source errors, source-manifest stability, worker fences, idempotent artifacts, fallback summaries, queue drain bounds, and privacy-safe telemetry. Database and integration checks should additionally cover owner isolation, cutoff/disclosure denial, gap fallback, rebuilds, and purge invalidation before release.

No opt-in live narrative evaluation has been run or passed for this implementation. In particular, there is no measured 90% grounding/continuity score, no human-review result, and no claimed token/latency saving. Live evaluations use paid provider calls and remain outside default CI until a labeled suite, independent review, and explicit pass/fail report are available.
