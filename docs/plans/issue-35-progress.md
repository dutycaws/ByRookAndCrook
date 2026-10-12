# Issue #35 implementation progress

Source of truth: [GitHub issue #35](https://github.com/dutycaws/ByRookAndCrook/issues/35), including the approved specification, implementation comparison, delivery plan, and agent handoff. Updated October 4, 2026 on `codex/issue-35-relationship-garden`.

## Outcome

All gameplay and default-NPC acceptance journeys are demonstrated in the normal port-3000 app or authoritative SQL/integration paths. The approved Luna-only model trial is complete as an evaluation with recorded successes and failures; a failed model output is not represented as a gameplay or model pass. The GitHub checklist and closeout comment (comment 5984034347) reflect this distinction.

| Requirement | Evidence |
| --- | --- |
| Quest plans and hospitality | A live accepted plan changed the remaining steps from scouting/diplomacy to scouting/trade and survived reload. Read-only state evidence confirms revision 2 links to the turn, the objective/motivation/targets and event count stay unchanged, and the stored suffix matches (`artifacts/issue35-ui/accepted-plan-persistence.json`). Refusal is covered by the plan RPC test. Serving Lira and an overnight quest outcome were exercised through explicit close; separate success and failure outcomes show that hospitality does not guarantee success. |
| Relationship progression and repair | The UI shows named stages and committed negative feedback. An apology alone left repair at 0/2; same-day repetition did not count; follow-through on two later days completed repair and persisted after reload (`day2-repair-limited.jpg`, `day3-repair-complete.jpg`). Disclosure gates and boundaries are covered by SQL tests. |
| Quest trinkets and active effects | Lira and Torvin each received their optional first-milestone reward once. Four active slots, fifth-item collection, free swaps, and reload persistence were exercised. A natural Pepper C4 harvest showed base quality 4 + the active Leaf’s 1 = 5, quantity 2, with day and gold unchanged (`artifacts/issue35-ui/natural-harvest-bonus-receipt.json`). A separate drink sale applied the 5% active bonus to base revenue 40 for 42 gold. Matching effects add and quality clamps are covered by authoritative SQL checks. Lira’s earned Leaf remained available while her archive was visible. |
| Garden discovery and time | The normal UI verified a free qualitative inspection, attention marker, pre-planting seed guidance, planting/watering, and chronological plot history. Day-5 history records Clover planted/watered on day 1, watered on day 3, and qualitative clues through day 4 (`artifacts/issue35-ui/day5-care-history.txt`). A post-migration Hops inspection no longer reports the contradictory healthy clue (`artifacts/issue35-ui/day5-consistent-inspection.txt`). Harvesting, brewing, serving, dialogue, and trinket changes did not advance the day; explicit Close did. |
| Failure, departure, archive, and arrival | The connected lifecycle journey showed repeated authored warnings, terminal failure, farewell, preserved archive/history, and automatic arrivals. Torvin’s successor quest and reward were exercised through day 6. The lifecycle UI used deterministic provider responses, so it verifies the UI/persistence path rather than live narrative quality. SQL tests cover the authored condition plus repeated setbacks, retained data, and an empty arrival pool. |
| First-party definitions and saved residents | Lira and Torvin use the updated versioned first-party catalog with optional one-time rewards, intermediate trust-gated disclosures, and repeated-setback departure rules. Existing residents remain pinned to their original immutable package; new materializations use the published version. Catalog, publication, and saved-resident handling checks pass. |

## Luna evaluation record

The user approved the reviewed Luna-only scope, current prompts/stages, and ordinary gameplay paths. The exact captured request payloads are in `artifacts/npc-evals/issue-35-luna-request-payloads.json` (399,581 bytes; SHA-256 `9fa51b5003a411323bcca9df9f07861502137145977a6efeb957cee2bc50a1e7`) and the review packet is `docs/plans/issue-35-luna-evaluation-packet.md`. The pre-run one-pass estimate was $0.81–$0.99, excluding retries. This was not a spending cap. No Sol comparison, automatic Sol fallback, or prompt/stage redesign was added.

Captured usage totals 77 GPT-6 Luna generations, 320,021 input tokens, 9,020 output tokens, and 308,435 cache-write input tokens. Estimated generation cost is $0.044222975; provider preflight charges are unknown and excluded. The eight-turn dialogue run completed with 30 generations (92,578 input, 2,285 output; estimated $0.01264645). One keeper-promise pronoun ambiguity was recorded. A selected Lira transition completed `next_authored_milestone`; its proposer and critic passed (53,082 input, 119 output, including 53,076 cache-write tokens; estimated $0.0066946, excluding preflight). Evidence is `test-results/issue-35-transition-248df11e-8f8e-40f4-b839-e768da3f5b38-luna.json`.

The trial also recorded negative outcomes. Malformed social/procedural proposals stopped their downstream critics; the day-3 world settlement expired after malformed canon attempts. A memory preflight first returned HTTP 400 before generation because its JSON schema omitted required version/mode types. After a schema-only correction, one real Luna response returned HTTP 200 (1,022 input and 385 output tokens; estimated $0.00029470) but omitted the required `protectedRefs`. Semantic validation rejected it and the worker persisted a correct `extractive-v2` fallback, rather than treating the Luna summary as successful. The audit is `artifacts/issue35-ui/memory-summary-persistence.json`; request and response captures are in `test-results/issue35-memory-preflight-schema-failure.json` and `test-results/issue35-memory-live-summary.json`. No further model calls were planned. These results complete the trial as a mixed/negative evaluation, not an all-stages-pass claim. Any prompt or contract change needs a separate review.

## Adopted implementation defaults

These reversible values are implementation choices, not user-approved balance requirements:

- Relationship stages use the 0–100 score with strained 0–24, acquaintance 25–49, familiar 50–64, trusted 65–79, and close 80–100. Initial score 45 remains acquaintance.
- Repair requires a qualifying, source-evidenced positive action on two distinct post-offense days. Apologies, greetings, and generic praise do not count. Positive relationship changes share a four-point daily cap. The lexical follow-through check can miss valid phrasing.
- Active revenue trinkets add 5% each to base sale revenue. Active harvest-quality trinkets add one quality point each, additively, capped at 6; effects apply to the committed sale or harvest.
- Permanent failure requires the authored condition, at least three distinct failed attempts, and previously persisted warnings; an ordinary failed roll remains recoverable.
- Garden history retains seven game days and marks planting/removal boundaries. Automatic arrivals select eligible published first-party and community packages when capacity allows; departed/tombstoned identities stay excluded. Explicit day close remains the trigger.

## Final verification and environment

- Clean disposable migration replay: 88 SQL files and 2,413 assertions passed. Clean integration run: 32 tests across 9 files passed.
- Unit suite: 692 tests across 80 files passed. After the memory schema correction, its focused provider tests passed 8/8. Svelte/type check reported 0 diagnostics; `tsc --noEmit`, catalog generation check, production build after the final fix, and `git diff --check` passed.
- The earlier reused-database suite was contaminated by queued jobs and is not counted as passing. The clean disposable runs passed. Both test stacks were stopped with their data volumes retained; port 3001 is stopped. The normal app remains on port 3000 with automatic paid queues disabled.
- Existing saves and unrelated local changes were preserved. No destructive reset, merge, or deployment occurred. Connected CUA journeys are the UI evidence; no unrun headless E2E result is claimed.

The remaining product limitation is the recorded Luna world/memory reliability issue, with the extractive memory fallback protecting persisted state. The repair follow-through heuristic is bounded English matching and can miss otherwise valid behavior. All gameplay acceptance journeys and final repository gates are complete.
