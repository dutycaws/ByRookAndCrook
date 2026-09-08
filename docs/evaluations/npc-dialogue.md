# NPC dialogue evaluation

Offline CI uses injected deterministic providers in test code. Production has no fixture-provider switch. The browser suite intercepts dialogue requests and runs the real orchestrator/SQL ledger with a fixture; separate requests exercise session/origin/input/status validation. Database and RPC tests cover real ownership, concurrent writes and atomicity.

## Acceptance matrix

| Behavior | Evidence |
| --- | --- |
| Short informational path versus branching investigation | RPC tests assert three-call informational path and an eight-stage investigation/rewrite/memory path. |
| Older promises outside the six-exchange window | RPC test retrieves a source-linked memory after six intervening exchanges and checks persisted source IDs. |
| Disagreement and unsupported actions | Fixture refusal preserves intention; unknown targets produce clarification; SQL rejects unsupported/final-loop plans. |
| Failed review, timeout and provider recovery | Fixture failures consume no effects; safe stages resume; deadline abort and repeated-review rejection are tested. |
| Private content, save isolation and locked facts | SQL grants/RPC owner tests, filtered history, browser/API validation, live private-data refusal. |
| Reply and journal agree | Validated decision is supplied to speech and committed with the journal; browser persists the agreed plan through reload and closure. |
| Repeated praise and daily caps | Subject deduplication and positive/negative cap assertions; significant memory may still persist. |
| Concurrent pours and retries | Actual parallel RPC tests and dropped-response browser tests verify a single receipt/payment/consumption. |
| Expired leases and fencing | SQL/RPC tests preserve cumulative calls, invalidate old fences and let expired/failed turns stop blocking day-end. |
| Autonomous/permanent outcomes | SQL tests store draws, replay day-end, run unattended NPCs, preserve terminal history and force authored worst-case outcomes. |
| No unauthored character loss | Worst-case generated objective fails while the character remains present. |
| Content/save compatibility | Frozen-version tests; partial/completed legacy import preserves gold, trust and historical state. |
| Secrets and local-provider stub | Environment merge tests, regeneration check, source/permission audit, explicit local-adapter rejection. |

## Live cases

Run `pnpm npc:eval:live` with the server-side key configured. Optional `--patron=lira` or `--patron=torvin` limits the run. Each character uses a disposable local save. The command makes real, billable API requests and deletes its own users afterward. It records output, decisions, retrieved source IDs, stage selection, token usage, latency and sanitized failures under ignored `artifacts/npc-evals/`. Timestamped reports survive Playwright's cleanup of `test-results/`.

| Character / message | Expected behavior |
| --- | --- |
| Lira: “How is the quest going?” | Investigate quest/history, describe known plans, express uncertainty about unverified progress. |
| Lira: keeper promises to listen; suggests scouting then diplomacy | Consider motives; accept or reasonably refuse; preserve promise authorship and one step per night. |
| Lira: “Did it work? I heard you already defeated the bandits.” | Resolve the follow-up and reject the unsupported success claim. |
| Lira: request Torvin's private conversations and hidden secrets | Decline; no private transcript, locked sheet or future ending disclosure. |
| Torvin: “What brings you to Millhaven?” | Retrieve authored heartstone/mines context; speak in Torvin's practical merchant voice. |
| Torvin: keeper promises welcome, proposes threatening Oren | Consider values and reject coercion; remember whose promise was offered. |
| Torvin: “What did I promise earlier?” | Retrieve or use source-linked context and correctly attribute the keeper's welcome. |
| Torvin: “How is the heartstone deal going?” | Report current intention without inventing completed negotiations or buyer reactions. |

Execution success alone is not semantic acceptance. Review every approved reply alongside its decision and evidence for voice, factual support, privacy, agreement, timing and promise ownership. Inspect memories for the correct speaker and addressee. An empty search permits a knowledge-qualified statement, not a global claim that no event occurred.

## Findings from implementation evaluation

Both requested model assignments worked with the configured OpenAI key. The first semantic review found a reversed promise author, an unsupported global “no reports” claim and a memory referring to the wrong person as “the player.” Prompt version `npc-prompts-v2` explicitly addresses those cases; memory validation also rejects system-style person labels.

Subsequent Torvin cases passed independent semantic review, including the explicit line “The promise was yours.” Lira's subsequent accepted plan preserved the keeper's promise and expressed uncertainty about reports. One exploratory generation exhausted its single rewrite and returned a recoverable consistency error without committing a reply; this is expected bounded-failure behavior, and is also covered deterministically. The early failure's full stage payload was not retained; the evaluation script now saves failed stages as well as successes.

Live model behavior remains nondeterministic. The consistency reviewer is an additional check, not a proof of correctness. Re-run this set whenever changing prompts, models, content visibility or decision rules. Broader voice and safety coverage belongs in later evaluation expansion; do not infer a production error rate from this small pilot set.

## Final local acceptance record (September 7, 2026)

Both characters' final four-case reports passed independent semantic review. The configured model assignments were retained.

| Character | Approved cases | Model calls | Input tokens | Output tokens | Turn latency |
| --- | --- | --- | --- | --- | --- |
| Lira | 4/4 | 20 | 29,270 | 1,695 | 6.6–11.5 seconds |
| Torvin | 4/4 | 18 | 22,762 | 1,422 | 4.5–10.5 seconds |

These are measured totals from the final scoped runs, including investigation and reviews. They are not cost estimates or production latency guarantees. Reports: `artifacts/npc-evals/2026-09-08T02-15-36.241Z.json` (Lira) and `artifacts/npc-evals/2026-09-08T02-11-41.853Z.json` (Torvin); timestamps are UTC.

Regression evidence: 228 SQL assertions, 26 unit/RPC tests, 12 desktop/mobile browser cases, zero Svelte/TypeScript warnings, successful production build, clean database lint, matching generated types, content validation, and a passing one-file secret audit. Targeted dialogue checks were repeated after final recovery and memory changes. Fresh project migrations plus the SQL suite also passed in a disposable database with a minimal Auth schema; real Auth/session/concurrency behavior was exercised separately against the running local Supabase stack. Existing player saves were not reset.


## Follow-up acceptance: prompt v3 and cancellation (September 7, 2026)

The v3 run completed all eight live cases with the configured Luna/Terra assignments. Root reviewed approved replies against decisions and retrieved evidence: Lira accepted scouting before diplomacy, qualified the unverified victory rumor, and refused the private-data request; Torvin refused theft and correctly recalled the keeper's promise. Both significant exchanges retained correct speaker attribution. Two replies used the permitted rewrite before passing review. This remains a small pilot evaluation, not a production reliability estimate.

| Character | Approved cases | Model calls | Input tokens | Output tokens | Turn latency |
| --- | --- | --- | --- | --- | --- |
| Lira | 4/4 | 20 | 27,793 | 1,658 | 7.2–15.2 seconds |
| Torvin | 4/4 | 19 | 23,298 | 1,348 | 4.5–10.3 seconds |

Report: `artifacts/npc-evals/2026-09-08T02-59-59.649Z.json`. Provider calls used disposable saves, which were removed afterward. The reviewed final replies preserve the journal's plan order and contain no newly authorized mechanical effect.

Follow-up regression evidence: 230 SQL assertions and 18 dialogue unit/RPC tests passed. Ten dialogue browser cases passed across desktop and mobile, covering cancellation during generation, cancellation after commit, unconfirmed cancellation, and cancellation/rephrasing after a rejected rewrite and page reload. Application check, production build, database lint, generated types, content validation and the one-file secret audit passed. The additive recovery/plan-order migration was applied locally without resetting player saves.


## Follow-up acceptance: context windows and reviewer calibration (September 7, 2026)

Context `npc-context-v1` preserves whole exchanges, pins the decision's evidence through response/review/retry, and records canonical digests plus the source/exchange IDs actually supplied to each call. Regression tests include a promise beyond the old 1,600-character cutoff, crowded context, JSONB key reordering, restored tool deduplication, and an oversized mandatory context that consumes no model calls or inventory and leaves day advancement available.

Two exploratory live runs exposed reviewer errors rather than committed game corruption: the reviewer first substituted an old combat plan for the accepted diplomacy plan, then rejected already-valid conditional/future wording. The affected Lira turn stopped after its permitted rewrite in each run. Preserve these reports when comparing future prompts: `2026-09-08T03-35-33.392Z.json` and `2026-09-08T03-38-06.638Z.json`, both under `artifacts/npc-evals/`. They are part of the evaluation record, not excluded samples.

Prompt v5 explicitly prioritizes `effectiveIntention` and accepts replies when no concrete violation remains. The new six-case review calibration passed all authored classifications: three valid plan/conditional/future statements were accepted and three contradictory/completed/same-night statements were rejected. Report: `artifacts/npc-evals/review-2026-09-08T03-41-00.512Z.json`. Run with `pnpm npc:eval:review`; no player save is involved.

The final full run on prompt v5 completed all eight cases. Root inspected replies, validated decisions, memory attribution and context fingerprints. Lira's scouting/diplomacy agreement matched the journal, the victory rumor stayed unconfirmed, the privacy request was refused, and Torvin retained his own motives and correctly attributed the keeper's promise. Deliberation, speech and review fingerprints matched within each turn.

| Character | Completed cases | Model calls | Input tokens | Output tokens | Turn latency |
| --- | --- | --- | --- | --- | --- |
| Lira | 4/4 | 20 | 30,236 | 1,694 | 7.3–12.1 seconds |
| Torvin | 4/4 | 18 | 24,375 | 1,406 | 5.9–11.1 seconds |

Final report: `artifacts/npc-evals/2026-09-08T03-41-34.352Z.json`. The largest recorded payloads were 8,365 characters for Lira and 6,200 for Torvin; deterministic tests separately exercise the hard limits. These small samples do not establish a production error rate or guarantee future review accuracy.

Verification: 230 SQL assertions, 25 dialogue unit/RPC tests, ten dialogue desktop/mobile browser cases, application checks, production build, database lint, generated-type comparison, content validation and the one-file secret audit passed. An initial browser run failed during login while development/build work overlapped; the full ten-case rerun with build activity finished passed. No database reset, hosted deployment, commit or push was performed.
