# Garden and apiary technical specification

This document describes the implemented `garden-apiary-v1` rules. The Garden is a persistent planning loop: the keeper tends local soil, grows renewable crops, manages colonies, and turns harvested crop or honey batches into food and drink. PostgreSQL owns every durable rule and mutation. SvelteKit loads the authenticated snapshot, presents previews, and submits bounded commands.

The rules use compressed tavern-day timing and simplified ecology. They are game rules, not horticultural or beekeeping instructions.

## System boundaries

| Boundary | Responsibility |
| --- | --- |
| Supabase Auth | Identifies the keeper. Save identity is derived from `auth.uid()` rather than accepted from browser claims. |
| Public RPCs | Return ownership-filtered snapshots and previews; commit authenticated commands with save locking, revision checks, and replay receipts. |
| Private PostgreSQL functions | Build the deterministic day input, resolve one canonical plan, and apply it inside the existing day-advance transaction. |
| SvelteKit server | Validates form fields, calls typed adapters, maps database failures to recoverable responses, and reloads authoritative state. |
| Svelte components | Render the scene and diagnostics, collect keyboard or pointer input, and retain unresolved action IDs after uncertain transport. |

The browser cannot directly mutate game tables. Catalog tables are readable by authenticated players. Per-save tables use ownership-filtered read policies; public mutation privileges are revoked in favor of the RPCs.

## Persistent model

| Record | Durable meaning |
| --- | --- |
| `garden_cells` | Stable hex identity, coordinate, unlock state, N/P/K, moisture, soil quality, and site light. Soil remains with the hex. |
| `garden_plants` | Movable plant identity, species, lifecycle, health, age, production cycle, accumulated care/stress/companion/pollination history, flowering, and threat state. |
| `apiary_hives` | Movable hive equipment. Equipment remains when a colony is lost. |
| `apiary_colonies` | Colony population, brood, health, food, floral honey, feed contribution, three distinct pressures, treatment, and threat history. |
| `garden_inventory` | Seeds, amendments, feed, treatments, equipment, and replacement colonies. |
| `garden_weather` | Persisted weather per tavern day. The current day and two following days form the visible forecast. |
| `garden_compost_jobs` | Local, delayed releases with source provenance and remaining duration. |
| `garden_daily_grants` | Unique migration and daily basic-seed grants. |
| `garden_day_resolutions` | Input and plan fingerprints plus the causal report for one committed tavern day. |
| `garden_actions` | Normalized input, rules version, committed revision, and exact replay result for Garden and Apiary commands. |
| `ingredient_batches` | Immutable crop or honey output, quality, bonuses, available quantity, reservations/consumption, compost allocation, and source provenance. |

The original `c0`–`c11` identities and coordinates are preserved. `c12`–`c23` are created locked. The first expansion unlocks `c12`–`c15`; the second unlocks every remaining cell.

## Migration chain

| Migration | Purpose |
| --- | --- |
| `202609110024_garden_apiary_foundation.sql` | Adds versioned catalogs and persistent ecosystem tables, expands the coordinate bounds, creates the locked cells, and idempotently maps existing saves. Existing cell moisture and plant/hive occupants become the starting ecosystem state. Each save receives one `migration-starter-v1` grant of two Hops seeds and three Clover seeds. |
| `202609110025_garden_day_engine.sql` | Adds the shared projection/commit kernel, causal reports, fingerprints, daily grants, renewable harvest/regrowth, and the Garden wrapper around tavern-day advancement. |
| `202609110026_garden_commands.sql` | Adds strict Garden previews and commits, separate ingredient-compost allocation, purchases, and land expansion. |
| `202609110027_apiary_commands.sql` | Adds Apiary previews and commits, feed/floral-honey separation, safe extraction, split conservation, treatment restrictions, honey provenance, and the final snapshot extension. |
| `202609110028_local_nosema_resolution.sql` | Restricts Nosema transmission to colonies whose forage neighborhoods overlap. |

All five migrations are additive. Existing gold, ingredient batches, crafting results, serving history, NPC state, and plot IDs remain intact. Old harvested batches are not recalculated. `private.ensure_garden_ecosystem` is safe to call again because cells, weather, grants, plants, hives, and colonies use conflict or existence guards.

## Commands and recovery

`preview_garden_command(commandKind, payload)` and `preview_apiary_command(commandKind, payload)` are read-only. The preview is based on the current revision and reports eligibility, costs, consequences, or restrictions. It is guidance rather than authorization; the commit repeats all checks against locked state.

`garden_command(saveId, actionId, expectedRevision, commandKind, payload)` supports:

- `plant`, `move`, `remove`, `water`, `amend`, `incorporate_clover`, `compost_ingredient`, `purchase`, and `expand`.

`apiary_command(saveId, actionId, expectedRevision, commandKind, payload)` supports:

- `install_hive`, `install_colony`, `feed`, `treat`, `split`, and `extract_honey`.

Every commit canonicalizes a small allow-listed payload, locks the owned save, checks the action ledger, verifies the expected revision, validates all targets and resources, applies the mutation atomically, increments the save revision once, and stores its receipt. A retry with the same action ID, normalized input, and expected revision returns the saved receipt. Reusing the ID for different input conflicts. A stale or foreign-save command changes nothing.

Batch water and amendments use one dose for every selected unlocked cell. The whole batch succeeds or rolls back. Water is unlimited and costs no inventory. Amendment inventory consumption is `target count × dose`. Compost cannot allocate an ingredient unit that is consumed, already allocated to compost, or reserved by an active brew or bake.

The Garden page holds the exact action ID and payload after an unexpected network failure. **Retry** resubmits them. A validation, stale-state, or eligibility response refreshes the snapshot and requires a new preview. This avoids duplicate charges while making an uncertain committed result recoverable.

## Tavern-day resolution

`public.project_garden_day()` calls the same private resolver used by `public.advance_tavern_day(...)`. Projection does not write. Advancement locks the save, rejects active brewing, active baking, and live dialogue processing, obtains one Garden plan, advances the preserved tavern/NPC state, applies the Garden plan, records the report and plan fingerprint, and returns one replayable day receipt.

The resolver uses this phase order:

1. Load one canonical, sorted snapshot and persisted weather.
2. Calculate rainfall, drying, soil-quality moisture buffering, compost releases, and local N/P/K.
3. Calculate neighbor shade, authored companion effects, species tolerances, plant health, threat state, and growth.
4. Advance flowering and accumulate whole-cycle care, stress, companion, and pollination evidence.
5. Calculate finite forage from flowering plants.
6. Allocate that forage across eligible colonies without duplicating supply.
7. Calculate colony food, floral honey, adults, brood, treatment progress, and health.
8. Calculate Varroa, Chalkbrood, and local shared-forage Nosema pressure from the boundary state.
9. Apply plant death, colony loss, lifecycle transitions, and local compost releases.
10. Persist the next forecast day, the next unique basic-seed grant, and a sorted causal report.

Iteration uses stable plot and colony ordering. Weather is persisted before use. The resolver returns input and plan fingerprints; a duplicate day action replays its original receipt instead of resolving again.

## Versioned balance values

### Crops

The maturity and regrowth values are tavern days under suitable care. The initial species catalog is authoritative.

| Species | Maturity | Regrowth | Regrows | Base yield | Forage | Pollination eligible | Base brew / bake |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| Hops | 6 | 3 | yes | 1 | 4 | no | 2 / 0 |
| Chamomile | 3 | 2 | yes | 1 | 5 | yes | 2 / 1 |
| Lavender | 5 | 3 | yes | 1 | 5 | yes | 2 / 1 |
| Fennel | 5 | — | no | 1 | 5 | yes | 1 / 2 |
| Sage | 3 | 2 | yes | 1 | 2 | no | 0 / 2 |
| Pepper | 5 | 3 | yes | 1 | 3 | yes | 0 / 2 |
| Tomatoes | 4 | 3 | yes | 1 | 3 | yes | 0 / 1 |
| Clover | 3 | 2 | yes | 1 | 8 | yes | 0 / 0 |

Good daily care raises plant health by 4. Moisture, nutrient, and light faults contribute 5, 4, and 3 points of daily health loss respectively, before the bounded companion modifier. A plant at 25 health or below begins a visible threat streak; zero health after three threatened days makes the loss permanent.

Harvest quality uses accumulated good days, stress, companions, and pollination across the current production cycle and maps to the existing seven tiers. Sustained eligible pollination adds one unit to base yield. Waiting at least three tavern days after readiness reduces quality by one tier and yield by one, with a minimum yield of one. A retained crop restarts at 35% growth with a new production-cycle history; Fennel is removed after seed harvest.

Authored companion values are Chamomile–Tomatoes `+4`, Clover–Hops `+3`, Lavender–Sage `+4`, Fennel–Tomatoes `−6`, and Pepper–Tomatoes `−3`. Neighbor shade is 8 light points per taller adjacent plant, capped at 24.

### Weather, restoration, and recovery

| Weather | Rain | Drying | Light |
| --- | ---: | ---: | ---: |
| Clear | 0 | 14 | +8 |
| Cloudy | 0 | 7 | −10 |
| Rainy | 24 | 2 | −20 |

The forecast follows a persisted Clear → Cloudy → Rainy cycle in `garden-apiary-v1`. Soil quality reduces drying; N/P/K and moisture remain local to one hex.

Removing an eligible plant creates two daily releases of `+4 N/P/K` and `+3 soil quality`. Composting an available ingredient creates two releases of `+4 N/P/K` and `+5 quality`. Incorporating established Clover at 55% growth or later creates three releases of `+12 N/P/K` and `+4 quality`. Releases begin on the following tavern day.

Each completed day grants one Hops seed and one Clover seed through the unique `daily-basics-v1` ledger. Together with unlimited water and delayed Clover restoration, this is the zero-gold recovery path. Young seedlings cannot be profitably recycled.

### Shop and expansion

| Item | Price | Effect |
| --- | ---: | --- |
| Seeds | 2–4 gold | One seed for the named crop |
| N, P, or K amendment | 5 gold | +18 to that nutrient per dose |
| Soil builder | 8 gold | +12 soil quality per dose |
| Colony feed | 4 gold | +18 food; tracked separately from floral honey |
| Varroa / Chalkbrood / Nosema treatment | 8 / 6 / 7 gold | Three-day matching treatment; no honey production or extraction during treatment |
| Empty hive equipment | 30 gold | Installs a hive without a colony |
| Replacement colony | 30 gold | Installs 5,000 adults, 1,000 brood, 75 health, and 18 food into empty equipment |
| Expand 12 → 16 | 60 gold | Unlocks the fourth plot column |
| Expand 16 → 24 | 180 gold | Unlocks the two remaining columns |

Purchases are funded by existing food and drink service. Raw produce and honey have no direct sale action.

### Apiary

Colonies forage within two hexes. Shared forage is divided among every eligible colony that can reach it. A healthy colony gains adults and brood when food and health thresholds are met; poor food or severe pressure produces deterministic decline.

Food and floral honey are separate. Feeding adds 18 food per unit and records the feed contribution without increasing floral honey. Twelve food units are identified as the protected survival reserve. Extraction uses only floral honey above a separate four-unit honey reserve, allows 1–20 units per command, and is disabled during treatment. The extracted quantity becomes one immutable `source_kind = 'honey'` ingredient batch with colony, hive, day, health, pressure, and reserve provenance.

A split requires at least 10,000 adults, 2,000 brood, 30 food, and 60 health plus an empty equipped hive. It transfers half of adults, brood, food, floral honey, and feed stores and copies health pressures and treatment state. It cannot create or cleanse colony resources.

Varroa grows from parasite/brood pressure and its treatment reduces pressure by 9 per day. Chalkbrood responds to rainy/damp conditions and its treatment reduces pressure by 8. Nosema can spread only from a colony at pressure 35 or above to another colony within the overlapping-forage distance; its treatment reduces pressure by 8. Severe pressure reduces health. A colony at zero health after three threatened days is permanently removed while its hive equipment remains.

## Presentation and access

The established fixed-camera courtyard art remains the scene background. Only unlocked cells render as controls. The plot board scrolls independently at 16 and 24 plots so hit targets stay at least 44px on desktop and phone. Original cell coordinates do not move.

Every cell is a semantic button. Arrow keys move to the adjacent coordinate while retaining focus. Garden and Apiary actions use native fields and buttons; multi-select care has a labeled checkbox for every unlocked plot. Symptoms pair severity with text labels and exact causes, and the threatened overview moves focus and selection to its target. Reduced motion removes decorative movement without changing state. Missing scene, plot, crop, or hive art leaves the controls and inspector usable.

The inspector shows N/P/K, moisture, soil quality, site light, plant lifecycle and quality history, flowering and harvest delay, adult population, brood, health, food, feed, floral honey, reserves, all three pressures, treatment restrictions, and causal warnings. The latest committed day report is visible separately from previews.

## Acceptance evidence

| Acceptance area | Primary evidence |
| --- | --- |
| Foundation, migration, ownership, deterministic resolution, reports, guards | `supabase/tests/garden_ecosystem.test.sql`, `garden_day_scenarios.test.sql`, `garden_day_guards.test.sql`, `garden_occupancy_invariants.test.sql`, `garden_security.test.sql` |
| Renewable commands, atomic care, compost allocation, zero-gold recovery | `supabase/tests/garden_commands.test.sql`, `garden_compost_reservations.test.sql`, `garden_zero_gold_recovery.test.sql`, `tests/integration/garden-commands-rpc.test.ts` |
| Apiary, disease routes, conservation, honey and crafting | `supabase/tests/apiary_commands.test.sql`, `apiary_day_scenarios.test.sql`, `honey_crafting.test.sql`, `tests/integration/apiary-commands-rpc.test.ts` |
| Responsive and accessible complete journeys | `tests/e2e/garden-expanded-layout.test.ts`, `garden-journey.test.ts`, and `crafting-layout.test.ts` |
| Snapshot and scene contracts | `tests/unit/game-contracts.test.ts` and `scene-presentation.test.ts` |

The implementation ledger in [`docs/plans/issue-16-garden-apiary-implementation.md`](plans/issue-16-garden-apiary-implementation.md) records packet gates and final command totals.
