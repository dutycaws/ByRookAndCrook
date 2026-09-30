# NPC memory

NPC memory is a server-only, derived evidence layer. Canonical dialogue turns, quests, residents, and world events remain authoritative; memory never grants a capability, changes a quest, or applies an effect.

## Configuration and workers

`NPC_PROVIDER=openai` requires `OPENAI_API_KEY` and a verified `NPC_MODEL_INPUT_CAPACITY`. `NPC_CONTEXT_MODEL` defaults to `gpt-5.6-luna` and `NPC_CHARACTER_MODEL` to `gpt-5.6-terra`. The embedding worker additionally requires `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, a nonblank `NPC_EMBEDDING_PROCESSOR_VERSION`, `NPC_EMBEDDING_MODEL`, and `NPC_EMBEDDING_DIMENSIONS`. The extract, summary, embedding, and dispatch workers are source/version fenced and may be rebuilt by enqueuing a new processor version. Missing embeddings fall back safely to relational and lexical evidence; they do not block play.

Retrieval is owner/save/instance scoped and cutoff-bound. It combines current relational commitments and exact references, GIN lexical matches, and (only for an exact active immutable profile/vector) exact semantic matches with deterministic RRF. Recent/important fallback and unindexed source fallback are explicit rather than evidence of absence. Speech/review receive only player-visible or NPC-known material; transition can additionally use NPC-private material; system material is never returned.

## Frozen contexts, replay, and cache

Dialogue persists a canonical v4 artifact before generation: routine contexts are 64KiB/8k tokens and consequential contexts are 64KiB/16k. Transition evidence uses the same assembler: ordinary is 128KiB/32k overall (64KiB/16k attachment) and rich is 256KiB/64k overall (192KiB/48k attachment). Rich applies only when there is no next authored milestone and successor/departure is allowed. Every transition model stage receives the identical compact authorized dossier. Full Responses requests are capped at 384KiB UTF-8 and 80k input tokens plus output reserve. Durable `memory_context` checkpoints allow 512KiB; model checkpoints remain 16KiB.

Replay validates cutoff, source manifest, canonical payload/hash, tier, and verified byte/token metadata before provider work. A process-local LRU cache holds at most 32 deep-frozen accepted dialogue artifacts. Its opaque hashed key contains actor/instance/view/cutoff, policy/projection/tier, canonical manifest, and payload hash—never raw prose. Durable replay has priority. Exact cache hits avoid the token counter and emit `cache_hit`; changed source/profile/cutoff inputs miss. Committed dialogue/transition changes invalidate their instance, while mature setting removal and admin quarantine/purge clear the cache.

Purge/quarantine cascades remove derived sources, summaries, embeddings, outbox, dialogue checkpoints, transition contexts, and active fences while retaining only audit-safe tombstone evidence. Late completion/checkpoint writes are rejected.

## Deterministic evidence and evaluation status

The long-horizon SQL fixture spans 30 game days, authored and generated-successor quests, corrections/withdrawals, irrelevant memories, and two-save/multi-NPC isolation. It verifies protected commitments/constraints, deterministic retrieval, explicit fallback, and required-source recall; its `diag` payload reports only fixture-derived channel response-byte/query-time distributions and maintenance, embedding, and retry counts. It makes no timing threshold or savings claim.

Paid live narrative evaluation, independent human review, and real provider input-token/latency median/p95 measurements are **UNRUN**. No quality, grounding, or savings claim is implied by deterministic fixtures.

An opt-in paid transition narrative run must be reviewed independently using a
bounded report with at least ten predeclared cases, a named reviewer, 1–5 scores,
and a predeclared pass rule: at least 90% score 4/5 or higher. `npm run
npc:eval:transition:review -- report.json` validates that report and refuses a
`passed` label below the threshold. The prototype does not yet safely drive a
transition fixture through paid execution, so this executable review contract is
provided while the live run remains **UNRUN**.
