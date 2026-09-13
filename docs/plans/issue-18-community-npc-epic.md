# Issue 18 delivery ledger

This branch replaces the fixed two-patron prototype with a UUID-based community NPC platform. There is no production migration path: local Supabase is reset after the authoritative migration lands.

## Execution order

| Packet | Depends on | Deliverable | Acceptance evidence |
|---|---|---|---|
| M0 | — | Shared `NpcSheet`, UUID contracts, validators, canonical hashes | Unit tests reject malformed sheets and accept both curated pilots |
| M1 | M0 | Profiles, capabilities, identities, immutable versions, drafts, reviews, notifications, audit, quotas | pgTAP capability, ownership, stale-write, immutability, publication and quota coverage |
| M2 | M1 | UUID world residents, campaigns, every-resident dawn resolution, level/capacity and arrival receipts | pgTAP idempotency, settlement, permanent outcomes, eligibility and version-pinning coverage |
| M3 | M2 | UUID dialogue, hospitality, roster summaries and lazy journals | Unit/integration tests prove arbitrary UUID residents and fenced retries |
| M4 | M1 | Authoring services: autosave, assistance proposals, scene records, sandbox, submission/evaluation | Service tests cover quotas, invalidation, failures and frozen submissions |
| M5 | M4 | Responsive creator workspace, submission history, inbox, public creator profile and analytics | Focused Svelte checks and browser journeys |
| M6 | M1, M4 | Admin access, review, moderation, reports, retirement, appeal, purge and mature settings | RLS/service/browser coverage for role conflicts and redaction |
| M7 | M2, M3 | Searchable/paginated tavern roster, campaign state, arrival/news presentation, dismiss/archive/share | Browser journeys with a large roster and privacy checks |
| M8 | all | Reset fixtures, generated types, 1,000-pool/100-resident scale fixture and full verification | Required CI commands and issue progress comment |

## Integration rules

- Root owns all write-bearing packets serially. Read-only agents provide maps, reviews, and workflow oversight.
- Database invariants are authoritative; browser routes call authenticated server actions and never write private narrative or moderation tables directly.
- Published versions and world assignments are immutable. A resident always uses its assigned `npcVersionId`.
- Dawn processing records its receipt, random draw, candidate count, selected version, quest results, and level gains in one transaction.
- Temporary/generated source media belongs in ignored local media storage and is uploaded by `npm run fixtures:users:local`; no source PNG enters Git.
- Run focused checks after each packet. Full database and browser suites run at M8 and may not block implementation for longer than ten minutes.

## Status

- [x] Discovery and fixed-key seam map
- [x] M0 shared contracts
- [x] M1 governance database
- [x] M2 world runtime
- [x] M3 dialogue/runtime conversion
- [x] M4 authoring services
- [x] M5 creator UI
- [x] M6 reviewer/moderation UI
- [x] M7 player roster UI
- [x] M8 fixtures and integrated verification

## M8 fixture status

- [x] `fixtures:users:local` now establishes a deterministic local administrator/author, independent reviewer, profiles, creator terms, capabilities, and a real Willow Vellum author → review → publication path.
- [x] Optional runtime media stays beneath ignored `.local/media/runtime-derivatives/` and is verified before local Storage upload. Missing optional bytes produce a clear skipped-publication message rather than fabricated media.
- [x] `FIXTURE_NPC_SCALE=1` is isolated from normal startup and seeds a disposable 1,000-community-identity / 100-resident local roster for pagination and performance work.
- [x] The normal and scale fixture paths both complete after a reset. The current local media directory contains no dedicated community scene, so Willow publication is skipped with `local_scene_asset_missing` rather than borrowing another character's art.

## Integrated acceptance evidence

- A clean local database reset applies migrations 030–036. The focused authoring experience suite passes 18 assertions and the updated authoring contract suite passes 17 assertions. They cover typed workspace projections, revision-pinned sandbox transcripts, invalidation and preserved history, provider job completion, quotas, retirement idempotency, and frozen submissions.
- `npm run test:unit` passes 22 files and 174 tests. `npm run test:integration` passes nine files and 28 tests, including UUID dialogue isolation, serving replay, stale-action fencing, and concurrent game mutations.
- The focused authoring journey passes three Chromium cases in under 20 seconds. It covers guided editing and reload persistence, assistance comparison and acceptance, two-turn sandbox context, preserved transcripts after revision changes, submission history, and retirement. The earlier focused Bar journeys continue to cover bounded UUID roster search, independent intent and hospitality controls, and lost-response replay.
- `npm run check -- --output human`, `npm run build`, `npm run db:types:check`, `npm run secrets:audit`, `npm run npc:content:check`, and `git diff --check` pass. The working-tree inventory contains no new image or binary media.
- A broader 76-case browser compatibility run completed inside the ten-minute budget and isolated legacy dialogue snapshot assertions, retired Garden menu selectors, and touch-emulation menu behavior. Focused compatibility reruns now pass all ten dialogue cases, eight representative crafting cases, and four transformed/mobile Garden-menu cases across desktop and mobile without repeating the full suite.
