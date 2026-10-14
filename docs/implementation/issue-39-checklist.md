# Issue 39 implementation and verification

Source: [issue #39](https://github.com/dutycaws/ByRookAndCrook/issues/39), approved product rules, no comments at kickoff. Baseline `291f27d` (merged PR #36); #35, #37 and #38 were already closed. Prepared on `codex/issue-39-daily-deck` for pull-request review; no merge or deployment.

All 16 acceptance scenarios are implemented and verified against the final local implementation. The table maps each scenario to its implementation and passing evidence.

| Acceptance scenario | Implementation | Verification / status |
| --- | --- | --- |
| Two each Charm/Insight/Rumor; five distinct drawn copies | One-time save upgrade and starter provisioning; stable physical deck rows, draw without replacement | Daily-deck integration suite passed (final 8 scenarios) |
| Short, one-card and zero-card decks; optional closing | No minimum or manufactured cards; up-to-five draw and atomic day close | One-card beverage, zero-deck and early-close integration cases passed |
| Preview, guest switching, exact editable text; no free conversation | Physical hand UI, persisted suggestions, exact submitted message, server admission | Chromium and mobile: preview/card/guest switching, draft retention, exact custom-text submission with one spend, technical failure without spending, and reload passed |
| Generation/reply/commit failure and refusal/retry atomicity | Dialogue transaction and physical movement in one commit; unchanged hand during snapshots; replay checks same daily card | Provider failure/refusal/replay and injected commit-fence failure with exact-once retry passed |
| Social discard; serving consumes the specific actual item in one exchange | Daily card associates exact source item; predecessor hospitality effects preserved | Real brewed-item consumption and legacy serving rejection passed |
| Early close recombines surviving copies exactly once and retains stock | Preparation recombines draw/hand/discard, excludes consumed rows | Seven-copy early-close carryover integration passed |
| Special seeds add tomorrow, ordinary harvest/crafts do not | Three catalog SKUs, scheduled harvest ledger, direct brew completion without legacy social award | Real brew and bake SQL transactions and acquisition integration passed; special-seed browser purchase passed in Chromium and mobile |
| Potion purchase/use, next-morning selected-copy removal, retry and zero | Persisted provision and action receipts; simultaneous scheduled additions/removals | Potion purchase/use/replay and next-morning removal integration passed; Chromium and mobile purchase, selected-copy scheduling, stock decrement and reload passed |
| Guests before preparation; garden/shop both phases; crafts only preparation | Preparation projection, visible roster, open action; server/client craft phase checks | Bar prep/open desktop/mobile and acquisition/phase integration passed |
| Prep crafts join opening deck; unserved stock carries forward | Automatic source item synchronization during preparation | Seven-copy brewed-stock carryover integration passed; real bakery harvest → bake → reload → opening-deck flow passed in Chromium and mobile Chromium |
| Whole finalized deck × guests, stable IDs, one structured Luna request | Frozen card/guest context, complete distinct pairing validation, persisted batch claims/results | Six suggestion unit tests, live synthetic Luna, persisted frozen-matrix coverage and replay passed |
| Guest switching/reload reuse; next-day fresh batch | Persisted generation ID, frozen completed public interaction history, new generation on next opening | Persisted replay/next-day integration passed; Chromium and mobile guest-pair switching, draft restoration, reload, and identical persisted suggestion matrix passed |
| Generation failure, timeout and missing pairs end the bounded wait with editable fallbacks | Claim deadline, complete frozen-matrix validation and persisted fallback winner | Suggestion failure/timeout/missing-pair unit cases passed; fallback preview/edit/reload passed in Chromium and mobile Chromium |
| No exclusive social bonuses; existing NPC autonomy/knowledge/memory/quest and serving effects | Social flavor does not pass legacy intent modifiers; NPC provider flow preserved; actual item name/quality supplied | Full unit suite plus adapted memory/quest SQL regressions (67 assertions) passed |
| Scene/folio/Journal/shop/garden/minigames/focus/mobile/reduced motion | Existing workflow components retained; navigation separate from physical hand | Chromium and mobile garden/shop navigation, asset failures and crafting layouts passed; Chromium Journal, keyboard, archive and reduced-motion checks passed; real bakery flow passed on both projects |
| Stale/undrawn/discarded/removed/consumed and alternate serving rejected; empty saves stay empty | Admission requires service hand; direct legacy hospitality rejected; immutable source history and upgrade marker | Stale/cardless/substituted identity/legacy serving/zero integration passed |

## Verification evidence

- Clean application of all four issue-39 migrations on disposable Supabase project `brac-issue39-dzqoyydd` (API 60321, database 60322). Persistent application database unchanged.
- Full unit suite: **88 files, 752 tests passed**. Initial loaded run had one Vite startup timeout; rerun passed the entire suite.
- Final Svelte typecheck: **0 errors, 0 warnings** (`/tmp/brac-issue39-completion-check.log`), including the final enhanced Potion forms and browser-test repairs.
- Production build: **passed** after the final UI repairs.
- Seed/craft isolated SQL suite: **27 checks passed**, including actual brew and bake completions with serving items and no social card/reward receipts. The combined clean isolated SQL run passed **42 assertions** across the three issue-39 files.
- Browser preparation → opening → physical daily-hand: **Chromium and mobile Chromium, 2/2 passed**, isolated app `http://127.0.0.1:3101`.
- Live provider synthetic check: validated two distinct physical Charm copies × one guest using **one `gpt-6-luna` request** and an in-memory store. This verifies provider/schema routing, not database persistence or an end-to-end live-provider gameplay transaction.

- Final focused integration: **12 scenarios passed** across daily-deck and acquisition suites.
- Existing dialogue memory/quest SQL regressions: **67 assertions passed** after fixture admission was updated for physical cards.
- Generated database types match the final isolated public schema.
- Final acquisition UI proof: **2/2 passed** in Chromium and mobile Chromium. It buys a real Charm Bloom seed, buys a Potion, selects a physical social copy, schedules removal, and verifies stock/deck-selection state after reload. Artifacts: `/tmp/brac-issue39-final-acquisition-browser-4`.
- Final guest-pair UI proof: **2/2 passed** in Chromium and mobile Chromium, including the correct persisted pair, first-pair edited draft after guest round-trip and reload, and unchanged persisted suggestion matrix. Artifacts: `/tmp/brac-issue39-final-guest-pair-browser-4`.
- Exact custom-text submission and aborted technical-request proof: **4/4 passed** across Chromium and mobile Chromium in the sequential suggestions run. Those cases were unchanged by the final guest-navigation test repairs. Artifacts: `/tmp/brac-issue39-final-suggestions-browser`.
- Browser regression scope is focused on the current acceptance scenarios. The entire legacy E2E suite was not run; it contains superseded free-dialogue and craft-social expectations.
- Gameplay browser checks use persisted deterministic fallback suggestions and deterministic NPC reply fixtures. The live synthetic provider check above verifies Luna/schema routing only; no full live-provider gameplay transaction is claimed.

## Repeatable focused checks

```bash
npm run test:unit
npm run check
npm run build
npm run test:db:isolated -- supabase/tests/issue_39_daily_deck.test.sql supabase/tests/issue_39_seed_craft.test.sql supabase/tests/issue_39_suggestion_context.test.sql
npm run test:db:isolated -- supabase/tests/npc_dialogue_memory_completion.test.sql supabase/tests/npc_quest_dialogue_projection.test.sql
```

Integration and browser verification use an explicitly configured disposable Supabase runtime. The current runtime file is `/tmp/brac-issue39-runtime.env`; its contents are credentials and must not be printed. The isolated application is `http://127.0.0.1:3101`. Independent Playwright runs use distinct output directories to avoid artifact-cleanup collisions.

Final targeted browser commands (run sequentially with source/test edits frozen):

```bash
node --env-file=/tmp/brac-issue39-runtime.env node_modules/.bin/playwright test tests/e2e/shop-journey.test.ts --grep 'Shop purchases a social seed' --project=chromium --project=mobile-chromium --workers=1 --output=/tmp/brac-issue39-final-acquisition-browser-4 --reporter=line
node --env-file=/tmp/brac-issue39-runtime.env node_modules/.bin/playwright test tests/e2e/issue39-suggestions.test.ts --grep 'persisted daily suggestions' --project=chromium --project=mobile-chromium --workers=1 --output=/tmp/brac-issue39-final-guest-pair-browser-4 --reporter=line
```

## Local development startup compatibility

The launcher runs the full isolated database suite before starting the application. Seven legacy SQL fixtures still assumed direct hospitality, cardless dialogue, craft-generated social rewards, or the previous Shop catalog. Those expectations now use the current daily-hand/dialogue flow and include the special seeds. Hospitality prices, trinket bonuses, harvest recovery, replay, and player/world isolation assertions remain covered.

The repaired files are `serving.test.sql`, `npc_trinket_effects.test.sql`, `bakery.test.sql`, `brewery.test.sql`, `community_npc_runtime.test.sql`, `garden_zero_gold_recovery.test.sql`, and `shop_stock.test.sql` under `supabase/tests`.

- Focused checks: **233 assertions passed** across the seven repaired files.
- Full launcher database gate: `npm run test:db:isolated` — **91 files, 2,477 assertions passed**. Log: `/tmp/brac-dev-stack-full-db-repair-final.log`.
- The next launcher gate also contained stale TypeScript fixtures: bakery/brewery expected craft rewards, and dialogue/serving fixtures omitted drawn physical cards or used the retired direct-serving RPC. Six integration files now exercise real card-backed dialogue, preserving provider repair, memory, quests, item provenance, replay, and ownership checks. A shared fixture controls random hand selection without manufacturing or deleting physical copies.
- Full integration gate: **14 files, 52 tests passed** on a disposable stack. Log: `/tmp/brac-integration-repair-full-final.log`. Type checking: **0 errors, 0 warnings**. Launcher/process lifecycle tests: **27 passed**.
- A subsequent normal startup exposed a cross-file database deadlock: `resolve-migration.test.ts` temporarily alters the shared intent tables while other suites create taverns or advance days. `test:integration` now uses `--no-file-parallelism` to serialize files; explicit concurrent RPC tests remain concurrent, and unit files retain parallel execution.
- Verified the actual `npm run brac-app:dev` launcher end to end after the scheduling fix: **752 unit tests**, **91 SQL files / 2,477 assertions**, and **14 integration files / 52 tests** passed. It started both the settlement worker and Vite and printed `Ready: http://127.0.0.1:3000/login`. Both Keeper One and Keeper Two logged in with session cookies and received authenticated `/garden` responses with HTTP 200. Logs: `/tmp/brac-dev-launch-verified.log` and `/tmp/brac-dev-launch-auth-verified.log`. The terminal launch was interrupted and its remaining Supabase containers explicitly stopped with `DO_NOT_TRACK=1 supabase stop --project-id by-rook-and-crook`, retaining local saves. App and worker exit and free local ports were checked.
- Startup smoke check on the disposable runtime verified provider configuration, pilot bootstrap, 11 Shop assets, 7 scene assets, an actual Vite `/login` response, Keeper One login redirect/session cookie, and one settlement-worker pass. Log: `/tmp/brac-integration-repair-smoke.log`. No model request was needed for this startup check.
- Disposable validation projects were removed after verification. Start the user-testing stack in your own terminal with `npm run brac-app:dev`; its application URL is `http://127.0.0.1:3000`.

## Implementation notes

Acquisition feedback restoration: crop harvest and honey extraction now present the shared centered card from their committed receipts, including item, quantity, and quality. Potion purchases also reveal their received item and reset action identity after confirmed success, preserving recovery identity on failures. The shared reveal remounts each distinct acquisition to replay its fade/zoom and cancels an older dismissal timer. Focused acquisition unit coverage passed **7 tests**; type checking passed with **0 errors / 0 warnings**. CUA verification on a temporary account confirmed harvest, honey, ordinary seed purchase, consecutive Potion purchases, Escape/Continue dismissal, and no acquisition reveal for Potion use. The new `acquisition-reveal-journey.test.ts` contains desktop/mobile/reduced-motion regressions; it was type checked but not executed in this verification. The user's running stack was retained.

The legacy direct `npc_serve_hospitality` RPC now rejects service attempts: serving goes through the existing NPC dialogue transaction with a drawn physical card. Existing quality, gold, payment and hospitality effects are preserved by that dialogue completion path. Brewing creates its beverage directly without issuing legacy craft social rewards. Retained historical intent rows remain immutable provenance and cannot replenish a removed physical copy.

The suggestion batch freezes the full deck and guest membership before play. Coverage uses that frozen matrix, including a serving card consumed after opening; reloads cannot shrink or regenerate the batch. Guest history contains only completed player messages and public NPC replies, never hidden knowledge.

Potion forms now preserve the Provisions view through enhanced submission and refresh the authoritative stock/deck snapshot. Their action ID is shared between the submitted payload and retry field.

World settlement remains the existing bounded background workflow between closing and the next morning. Deterministic integration fixtures drain that workflow before reopening; tests do not bypass its phase fence.

## Pull-request preparation

Final aggregate checks after acquisition restoration: `npm run test:unit` passed **88 files / 754 tests** and `npm run build` passed. The most recent type check reported **0 errors / 0 warnings**. The local credential audit passed; only project source, migrations, tests, documentation, and Serena metadata are included in the commit. The full-stack launch and prior integration/SQL/browser results above remain the recorded behavioral evidence; the newly added acquisition E2E file has not been executed.
