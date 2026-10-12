# Delivery plan for the relationship and garden prototype

This plan maps the approved gameplay specification included below to the current implementation and defines a bounded path to a playable result. The audit is read-only and source-based; no tests were run for this planning pass and no gameplay code was changed.

Baseline: local commit `53b5caa` plus substantial pre-existing uncommitted work, inspected October 4, 2026. This is not a newly fetched remote pull-request snapshot. Recheck the matrix at implementation start. Preserve existing work rather than redoing or reverting it.

## Requirement to implementation comparison

| Requirement | Current evidence | Required change |
| --- | --- | --- |
| Stable quest objective with accepted remaining-plan changes | Implemented in the dialogue projection RPC, which checks quest identity and preserves completed steps | Retain and regression-test; do not rebuild persuasion |
| Hospitality affects chances without guaranteeing outcomes | Existing quest/hospitality flow and related lifecycle issues cover this behavior | Validate through one connected quest journey and resolve existing lifecycle gaps rather than add a parallel resolver |
| Five explicit bidirectional relationship stages | Numeric relationship changes and trust-gated hidden facts already exist; UI shows a numeric meter | Project named stages and consistent disclosure/receptiveness behavior; retain authoritative score internally if useful |
| Obvious offense feedback | Dialogue returns relationship changes, but no dedicated negative-change indication was found | Show committed negative changes even within a stage; avoid exposing private motive text |
| Repair only through later-day follow-through | Positive and negative changes exist, including same-day limits; no durable repair gate was found | Add persistent offense/recovery state and prevent apology-only or same-day farming from reversing an offense |
| Authored optional one-time trinket reward | Milestone schema has no reward field; no trinket system found | Extend validated authoring and pinned runtime data, persist ownership and transactional one-time issuance |
| Four visual active slots and collection | Existing scene supports background, actors, foreground and parallax; no slot system found | Add four fixed overlays and a usable collection/swap interface; reuse scene composition |
| Additive food revenue, drink revenue, harvest quality effects | Serving and harvesting already calculate authoritative gold/quality | Sum equipped effects once server-side; define rounding and preserve quality bounds |
| Authored failure condition AND several warned setbacks | Authored permanent-loss warning/outcome fields exist; no repeated-setback gate found | Introduce a supported failure predicate and durable setback/warning sequence; do not equate one failed roll with permanent failure |
| Departures preserve history; no returns in this version | Farewell lifecycle, archive and tombstones already exist | Reuse and verify; preserve personal history, relationships and earned trinkets |
| Automatic replacement arrivals | Day-close admits eligible published NPCs below capacity and excludes instantiated/tombstoned identities | Verify vacancy and no-candidate cases; do not add a roster-selection interface |
| Existing plant art plus simple attention marker | Garden already renders an accessible exclamation marker and severity indication | Keep it; no new plant-state artwork |
| Free qualitative inspection | Selecting a plot is already free; inspection exposes exact ecology values and diagnosed causes | Introduce an observation projection, remove exact living-state values and prescribed cures from player inspection |
| Qualitative seed descriptions | Numeric species profiles exist but qualitative seed guidance is absent | Add consistent sun/moisture and relevant flowering/bee descriptions, available before planting |
| Per-plot care history | Care command input/results and resolved daily plot states exist; UI projects latest report only. Logs are not complete before/after observation pairs | Add a bounded history projection and persist observation snapshots where existing logs cannot reconstruct the required clues |
| Time advances only on explicit end-day | Bar close action explicitly calls day advance; no ticking close found | Retain and verify with other actions and repeated end-day requests |
| Lower-cost text calls with behavior records | Prompt trimming is separate; actual routing and usage need checking | Try GPT-6 Luna only with current prompts/stages; track spend and issues without a spending cutoff or new fixture suite |

## Evidence map

- Dialogue authority, numeric relationship deltas and trust filtering: `supabase/migrations/202609200074_npc_quest_dialogue_projection.sql`, `src/lib/server/dialogue/prompts.ts`, `tests/unit/dialogue.test.ts`, `supabase/tests/npc_quest_dialogue_projection.test.sql`.
- Relationship presentation: `src/lib/components/tavern/GuestInspector.svelte`, `src/lib/components/tavern/TavernScene.svelte`.
- Author schema and optional permanent loss: `src/lib/game/npc-sheet.ts`. Inspect its current publishing/materialization consumers before changing the contract.
- Departure/farewell and persisted archive: `supabase/migrations/202609200072_npc_quest_transitions.sql`, `supabase/tests/npc_quest_transitions.test.sql`, `tests/e2e/npc-quest-lifecycle-journey.test.ts`.
- Automatic arrivals: `supabase/migrations/202609140045_day_close_world_settlement.sql`, `supabase/migrations/202609190066_npc_materializer_cutover.sql`.
- Garden profiles, actions and daily resolutions: `supabase/migrations/202609110024_garden_apiary_foundation.sql`. Existing observations and projection: `supabase/migrations/202609110025_garden_day_engine.sql`, particularly `private.garden_symptoms` and the snapshot report projection.
- Garden presentation: `src/lib/components/garden/CropDetails.svelte`, `src/lib/components/garden/GardenGrid.svelte`, `src/lib/game/contracts.ts`.
- Scene composition: `src/lib/components/tavern/TavernScene.svelte`, `src/lib/presentation/scene-composition.ts`.
- Serving reward calculation: `supabase/migrations/202609120031_community_npc_runtime.sql`. Harvest quality and inventory: `supabase/migrations/202609070001_garden_harvest_slice.sql`, particularly `public.harvest_crop`.
- Explicit end-day: `src/routes/(game)/bar/+page.server.ts`.

These are evidence locations, not an instruction to edit an old migration blindly. Trace later overrides and the actual active SQL definitions before implementation.

## Implementation sequence

### 1 Confirm contracts and establish deterministic fixtures

Inspect current worktree and overlapping issues before editing. Establish one canonical contract for relationship presentation/repair, authored reward, supported failure predicate, owned/equipped trinkets, and garden observations/history. Preserve existing quest autonomy, journal scope and transactional fences. Add focused fixtures for the acceptance journeys. Adopt and record reversible defaults from the tuning section, revising them where current code provides a better consistent rule.

Exit: validated contracts and fixtures demonstrate the target data without author-controlled executable effects or duplicated sources of truth.

### 2 Deliver relationships from committed state to visible feedback

Map the existing score to the five named stages and align trust-based disclosures. Give models bounded evidence-backed reactions while retaining durable rules and daily limits server-side. Show negative changes from committed results, including within-stage losses. Implement repair eligibility across later days; a single apologetic turn must not clear it. Keep history attributable to the correct NPC.

Exit: one dialogue journey shows offense, visible loss, ineffective immediate apology, later follow-through and recovery. Hidden motives remain protected and relationship growth never guarantees plan acceptance.

### 3 Deliver the complete trinket reward path

Extend authoring with an optional catalog effect, supported art, and personal dedication; carry it through validation, published/versioned data and materialization. Persist earned instances and four active slot assignments. Grant exactly once at eligible initial quest completion in the same authoritative workflow. Fill empty slots automatically, otherwise retain the item in the collection.

Apply active effects in all authoritative serving and harvest paths, including food/drink offered through dialogue where applicable. Sum matching modifiers against the base result, avoiding sequential compounding or double application. Add four fixed scene overlays and free collection swaps. Preserve grants after NPC departure or relationship decline.

Exit: complete quest to visible reward to changed gameplay; a fifth grant stays stored; same-effect builds stack; reload/retry/concurrent requests cannot duplicate grants or exceed four equipped slots.

### 4 Add the warned failure gate using the existing lifecycle

Represent a recoverable setback separately from final quest failure. Authoring selects a supported terminal condition. Persist counted setbacks and warnings; permanent failure requires the authored condition and repeated signaled setbacks. Integrate with current transition scheduling instead of producing a second departure flow. Retain the existing farewell/archive behavior and automatic arrival selection, and prove no candidates is a valid quiet outcome.

Exit: first bad roll does not terminate the initial quest; repeated warned setbacks plus its condition can terminate it; farewell and departure preserve history and rewards; an eligible different patron arrives later. Do not expand scope to death mechanics or returning NPC arcs merely because existing schemas support them.

### 5 Deliver gardening discovery on the existing simulation

Retain the soil, moisture, nutrients, companion and apiary engine. Keep the current attention marker. Separate observable clues from internal causes: player inspection shows evidence, not exact diagnosis/ranges or a cure instruction. Add pre-planting seed guidance and a bounded per-plot timeline built from existing action/day logs where possible. Preserve ordinary commerce and inventory quantities.

Exit: a player can notice stress, inspect for free, consult seed guidance, act, end the day and compare clues/history without new plant-state artwork or diagnostic tools. Clear any exact living-state values leaked by the inspector's expandable sections.

This work can proceed in parallel with relationships once ownership of shared snapshots/contracts is assigned. Trinket harvesting effects and garden projection work require explicit coordination at shared server boundaries.

### 6 Verify the coherent prototype and evaluate model costs

Run focused rules/persistence checks and the small integrated journeys below, then required repository checks. Inspect the rendered bar and garden with keyboard and touch-sized controls as applicable. Test Lira's quest flow using deterministic responses first.

Run the simple Luna-only trial separately from feature verification. Keep the current prompt release, context limits and stages, use ordinary gameplay or existing paths, and record actual usage, cumulative spend, errors/retries and notable behavior. No spending cap, model comparison, automatic fallback or new efficiency fixture suite. Respect any applicable unresolved payload-export restriction; report an unrun trial honestly and continue unaffected work.

Exit: all gameplay acceptance criteria demonstrated, model evaluation either evidenced or explicitly identified as a remaining required workstream rather than silently omitted.

## Proposed implementation defaults

These numerical values are starting proposals, not user-selected balance values. The user authorizes the implementing agent to choose, adjust and document reversible tuning defaults autonomously, with evidence and reasoning. No further approval is required for ordinary tuning; changes to approved product behavior still require clarification.

| Decision | Proposed starting rule |
| --- | --- |
| Relationship thresholds | Retain the current internal score domain. Define one shared five-band mapping, align initial acquaintance and existing disclosure thresholds, and test each boundary. Record actual cutoffs before implementation. |
| Repair | Track offense day and recovery progress; require qualifying behavior on at least two distinct later days. Repeated apologies do not count. Respect existing daily gain limits and distinguish eligibility to regain trust from instant restoration. |
| Permanent failure | Start with three distinct failed quest attempts, with visible warnings after earlier setbacks. Require an author-selected supported predicate as well; retrying a request is not another attempt. Use a narrow catalog such as an exhausted authored attempt allowance before expanding predicates. |
| Revenue effects | Begin with a small fixed per-trinket percentage such as five percent. Compute base revenue times one plus the sum of active bonuses, round once with a documented rule, and apply consistently across service routes. |
| Harvest quality | Begin with one additive quality point per active quality trinket and clamp to the existing zero-through-six domain. Snapshot active effects at authoritative harvest execution; never mutate old batches when swapping. |
| Effect timing | Snapshot active trinkets at the relevant committed sale or harvest. Free swaps never retroactively alter prior outcomes. |
| Care history | Start with the most recent seven game days per plot. Include explicit planting/removal boundaries so a new crop is not mistaken for the previous one. |
| Arrival behavior | Reuse current eligible published-candidate selection and capacity rules. Departed/tombstoned identities stay excluded for this version. |

Unsettled future design: reward cadence beyond the initial authored quest and return arcs. Neither is required to complete this first-version spec.

## Verification plan

- Relationship rules: named boundaries, positive/negative changes, same-stage offense feedback, private-fact gating, immediate apology rejection, two-day repair and same-day farming resistance.
- Reward persistence/effects: grant idempotency, immutable earned identity, four-slot uniqueness, overflow collection, free swaps, all-four matching effects, authoritative rounding/clamping, dialogue hospitality and standalone serving, reloads, stale and duplicate requests.
- Lifecycle: distinguish setback from final failure; condition plus warning history required; preserve farewell and archive; eligible replacement and exhausted-candidate pool.
- Gardening: existing attention marker retained; free clue inspection, seed guidance, chronological plot history, ordinary quantities still clear, no explicit diagnosis/cure or living-state statistics in expanded inspection.
- Day clock: reading/talking/crafting/care do not advance the day; explicit end-day advances once even with duplicate commands.
- Browser journeys: combine relationship offense/recovery and plan persuasion; quest reward/four-slot overflow/swap; garden experiment over two days; warned failure/departure/replacement. Reuse existing garden, serving, harvest and lifecycle fixtures rather than a large new live-model suite.
- Luna trial records: model actually used, token/cached-token usage where available, cumulative spend, errors/retries and noticeable character or quest behavior issues. Use existing paths; no new efficiency fixtures, Sol comparison or spending cutoff.

Useful existing test surfaces include `tests/unit/dialogue.test.ts`, `tests/unit/garden-feedback.test.ts`, `tests/unit/scene-composition.test.ts`, `tests/e2e/garden-journey.test.ts`, `tests/e2e/garden-expanded-layout.test.ts`, `tests/e2e/npc-quest-lifecycle-journey.test.ts`, `tests/integration/serving-rpc.test.ts`, `tests/integration/harvest-rpc.test.ts`, and their SQL counterparts. This planning pass did not rerun them or claim they cover new behavior.

## Coordination with existing GitHub work

- [Unify NPC authoring and runtime data with immutable resident packages](https://github.com/dutycaws/ByRookAndCrook/issues/30): extend the canonical schema and published packages rather than a parallel reward authoring path.
- [Unify NPC quest progression, hospitality readiness, and AI successor/departure flow](https://github.com/dutycaws/ByRookAndCrook/issues/31): preserve the existing quest authority and hospitality model. The new multi-setback rule refines initial-quest terminal failure and must be reconciled with older single-attempt terminal wording.
- [Finish NPC quest lifecycle integration](https://github.com/dutycaws/ByRookAndCrook/issues/32): reuse opening-day timing, recovery and history work. For this prototype, departed NPC returns remain deferred.
- [NPC Memory system](https://github.com/dutycaws/ByRookAndCrook/issues/33): preserve attributable memories and relationship history; avoid duplicating the memory pipeline.

This umbrella issue carries the complete requirements and plan. Do not automatically close related issues or claim their criteria were tested during planning.

## Current implementation record

The issue is authoritative; this plan is synchronized with its October 4 clarification. See [issue-35-progress.md](issue-35-progress.md) for current checkout evidence, adopted defaults, checks, and remaining work. Historical gap rows above describe the planning audit, not a claim about completed implementation.
