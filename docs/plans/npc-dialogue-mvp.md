# Adaptive NPC dialogue MVP

Implementation record for the user-approved plan (2026-09-07). Status: implemented and verified locally.

The keeper talks to Lira Nightwind and Torvin Ashbeard through adaptive investigation, optional deliberation, rule validation, speech, consistency review, and attributed memory extraction. OpenAI is primary; local generation is an explicit stub. Conversations may include an actual drink and optional card. Private conversations stay private; public quest outcomes become next-day news. NPC intentions act overnight without mandatory crafting. Failures persist; character loss must be authored and warned.

## Execution ledger

Root is the sole writer in the existing shared checkout, preserving all pre-existing serving changes. The current root is GPT-6, not the Sol root assumed by the orchestration skill; no write-bearing fan-out is used. Independent reviewers have no write authority or descendants.

| Packet | Dependencies | Owner | Acceptance | State |
| --- | --- | --- | --- | --- |
| P1 Content, persistence, serving/day rules | Existing migrations 001–003 | Root | Additive migration, SQL authorization and replay tests | Complete |
| P2 Provider, adaptive service, endpoints, configuration | P1 interface | Root | Fixture orchestration and HTTP/RPC integration | Complete |
| P3 Bar conversation, journal, next-day UX | P1 + P2 interfaces | Root | Desktop/mobile journeys and production build | Complete |
| P4 Evaluation, documentation, integrated review | P1–P3 | Root + read-only reviewer | Acceptance matrix and all regression checks | Complete |

All interface/data/order dependencies above are verified against the existing application. Schema and generated types are serialized. Provider work never holds a database lock. Server completion owns effect commits; clients cannot impersonate NPCs.

## Frozen contracts and pilot rules

Character content lives in `supabase/content/npcs.json`; SQL installs a versioned copy into restricted storage. Dialogue turns freeze identity, message, items, day/revision, and conversation sequence. Durable stage checkpoints and expiring fenced leases support retries. Completion revalidates state and commits transcript, relationship effects, intentions, and serving together. Shared serving receipts prevent double consumption.

Actions: prepare, attempt, wait, abandon. Approaches: scouting, combat, diplomacy, trade. One active quest per patron; changed objectives retain established targets and record abandoned history. Terminal opportunities cannot be reopened by renaming a goal. Accepted plans have at most three daily steps. Preparation is capped at two. Attempt chance is clamped 10–90 using `50 + 10*(skill-difficulty) + 10*preparation + 5*hospitality`; hospitality is the day's sum of `(qualityIndex-3)`, clamped -3..3. Outcomes and random draws persist once. Qualitative risk is low at >=70%, moderate at >=45%, otherwise high. Exact odds are server-only.

Conversation reactions are -2/0/+2, deduplicated per subject (quest/personal/hospitality), patron, and tavern day, with separate +4/-4 caps. Published content is immutable and referenced by version; private preparation and emergent plans never become automatic public gossip. Memories are attributed keeper claims, NPC statements, promises, or interactions, never world canon. Only authoritative events can verify actions. No arbitrary model-supplied currency, probability, participant, or completion fields are accepted.

OpenAI defaults: Luna for investigation/review/memory, Terra for deliberation/speech. Up to two investigation rounds, one rewrite/recheck, eight calls per turn across processing attempts and a 90-second deadline. Limits: 2,000 characters, six new turns/minute, 100 processing attempts and 400 model calls per player UTC day. Local provider has no fallback. Live evaluation requires a configured key and is not part of offline CI.

## Accepted review findings

Restrict legacy catalog reads; extract shared private serving logic; synchronize begin/complete/day-end with save-row locks; enforce social caps and effects in SQL; preserve provider configuration when generating local environment. The independent planning review confirmed these boundaries before implementation.

## Verification

All three delivery milestones are complete. The user configured the OpenAI key in `.env`; final four-case evaluations for each character passed independent semantic review using the requested models. Prompts were tightened after review found a promise-attribution error and unsafe interpretations of missing evidence.

- 228 pgTAP assertions passed against the existing local stack, and against fresh project migrations in a separate disposable PostgreSQL database with minimal Auth bootstrap.
- 26 unit/RPC tests passed against real Supabase Auth; 16 dialogue-specific checks passed after the final timeout/memory changes.
- 12 desktop/mobile browser cases passed, including atomic hospitality, response-loss recovery and autonomous plans. The two dialogue browser cases were rechecked after journal/privacy changes.
- Application check: zero errors/warnings. Production build, database lint, generated-type check and content validation passed.
- One ignored `.env`, owner-only permissions; configured secrets absent from tracked and new source. Regeneration preserved OpenAI/NPC settings.
- Existing saves were upgraded additively; no player-data reset, hosted deployment, commit or push was performed for this implementation.

Artifacts: [technical specification](../npc-dialogue.md), [editable content](../../supabase/content/npcs.json), [evaluation cases/results](../evaluations/npc-dialogue.md), [runbook](../development.md). Detailed synthetic live reports remain in ignored `artifacts/npc-evals/`.

The independent reviewers were read-only and ran as GPT-6 in the effective environment. Root remained the sole writer. Accepted review changes included immutable content versions/FKs, source evidence snapshots, attempt lifecycle closure, terminal target retirement, finite ordered plans and privacy-safe news designation. No unresolved implementation blocker remains. Model prose still requires the documented bounded review/error path; the local provider remains the specified stub.

Final review dispositions: same-save day receipts remain visible to their owning keeper, who is authorized to inspect both journals; they are never passed to another NPC. An uncertain begin is recovered by status/cancel/lease expiry because its fence may be unknown. A dedicated test proves this path has no provider calls or committed exchange.


## Follow-up: executable plans and cancellation recovery

The next acceptance pass found two gaps in the original implementation: terminal actions could precede unreachable daily steps, and the UI disabled cancellation while waiting for the provider. Both are now addressed.

- Shared application/content validation and additive migration `202609080011_dialogue_recovery_and_plan_order.sql` require the only attempt or abandonment to be the final step.
- Cancellation stays available during generation. Confirmed cancellation fences late writes; an already committed reply is shown as saved. Unknown cancellation results retain the original command for checking or another cancellation attempt.
- Status includes `canRetry` and a sanitized error. Rejected rewrites and exhausted unfinished work require cancellation; fully checkpointed work can complete without another provider call.
- Prompt version `npc-prompts-v3` explains the final-step rule. New regression cases cover invalid ordering, cancellation races, lost cancellation responses, and completion after all eight calls have been checkpointed.

The migration was applied to the existing local database without resetting saves. Verification: 230 SQL assertions, 18 dialogue unit/RPC tests and ten dialogue browser cases across desktop/mobile passed. All eight live cases on prompt v3 also passed execution and root semantic review. See the evaluation record for live prompt results and the runbook for recovery controls.


## Follow-up: complete exchanges and consistent context

The next acceptance pass found that recent exchange text was cut at 1,600 characters and independently trimmed stage payloads could give a reviewer less evidence than the writer. Context version `npc-context-v1` now preserves whole records and pins one bounded evidence window in the validated decision checkpoint. All consequential stages and resumed attempts reuse that window, with canonical digests and source identifiers recorded per call. Resumed investigation also restores its set of completed tool requests.

Migration `202609080012_dialogue_context_budget.sql` records context-budget errors, exposes their cancellation path and reserves calls against the turn's recorded rule version. It was applied additively to the existing local save database.

A live run exposed a reviewer confusing the pre-turn combat plan with Lira's accepted diplomacy plan. The turn stopped without committing. Prompt v4 and explicit `effectiveIntention` now establish which plan governs speech and review; the failed run remains part of the evaluation record.


The v4 live run exposed reviewer false positives even after the plan precedence was explicit. Prompt v5 distinguishes actual contradictions from precautionary/style advice and already-conditional statements. `npm run npc:eval:review` adds six authored calibration cases so accepted plans and deliberate contradictions can be checked directly.


This follow-up is verified locally: 230 SQL assertions, 25 dialogue unit/RPC tests and ten dialogue browser cases passed, along with the application check, production build, database lint/types, content check and secret audit. Final live acceptance on prompt v5 passed eight dialogue cases and all six authored reviewer calibration cases. The evaluation document retains the preceding failed runs and their corrective findings.
