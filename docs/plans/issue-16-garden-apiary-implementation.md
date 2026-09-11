# Issue 16 implementation ledger

**Issue:** [#16 — Implement sophisticated gardening and a detailed year-round apiary](https://github.com/dutycaws/ByRookAndCrook/issues/16)  
**Branch:** `codex/issue-16-sophisticated-garden-apiary`  
**Baseline:** `9207601`  
**Plan version:** 1  
**State:** executing

## Frozen decisions

- PostgreSQL is the authoritative simulation and transaction boundary. A private resolver supplies both projections and committed day advancement; TypeScript validates and presents its output without reimplementing the rules.
- `garden_cells` retains stable land identity, coordinates, and local soil. Movable plant state, hive equipment, and colonies live in separate tables so occupants can move while soil stays put and equipment survives colony loss.
- The original `c0`–`c11` cells and coordinates remain unchanged. Expansion adds `c12`–`c23`; the first tier unlocks 16 and the second unlocks 24.
- Crop, companion, weather, compost, apiary, disease, treatment, and economy values are versioned as `garden-apiary-v1` content.
- Garden projection/commit equality is verified with a garden-plan fingerprint. NPC quest randomness remains outside that fingerprint.
- Crafting is optional before day close. An active brew, active bake, or live dialogue turn blocks advancement; completed crafting never prevents another sequential craft while ingredients remain.
- The fixed courtyard scene remains. The board gets its own reachable viewport so expanded plots keep at least 44px input targets instead of shrinking the whole grid.

## Dependency graph

| Packet | Status | Objective | Depends on | Mutable scope | Gate |
| --- | --- | --- | --- | --- | --- |
| P1 | Accepted with corrective follow-up | Versioned content, persistence, migration/backfill, deterministic projection and day resolution | Baseline | New foundation migration and focused database tests | 91 focused pgTAP assertions, database type parity, and application check pass |
| P2 | Accepted | Replayable garden commands, harvest/regrowth, economy, compost, expansion | P1 | New command migration, server contracts/adapters, focused integration tests | Ownership, revision, replay, atomic batch care, and recovery pass |
| P3 | Accepted | Apiary commands, forage, diseases, treatments, splitting, honey batches | P1, P2 inventory/provenance | New apiary migration and focused tests | Conservation, safe surplus, distinct pressures, and crafting compatibility pass |
| P4 | Accepted | Snapshot extension and responsive accessible Garden UI | P1–P3 contracts | Garden route/components/presentation and focused browser tests | Complete keyboard/pointer journeys at 12/16/24 plots pass |
| P5 | Pending | Runbook, migration notes, balance evidence, complete regressions | P1–P4 | Documentation and test evidence | Every issue acceptance category maps to passing evidence |

Shared migrations, generated database types, `src/lib/game/contracts.ts`, `src/lib/server/game.ts`, and the Garden route are serialized under the primary agent. Discovery and review agents remain read-only in the shared checkout.

## Authoritative day phase order

1. Lock the owned save and establish one canonical boundary snapshot.
2. Apply persisted weather to light, drying, rainfall, and per-hex moisture buffering.
3. Calculate local N/P/K demand, moisture/light stress, companion effects, health, and whole-cycle care.
4. Release eligible compost and incorporated clover for future-day soil availability.
5. Calculate flowering and aggregate finite forage before any colony allocation.
6. Allocate forage deterministically, then calculate bounded, nonstacking crop pollination.
7. Resolve colony stores, population, brood, treatments, and production.
8. Resolve Varroa, Chalkbrood, and Nosema from the frozen pre-spread state and apply deltas simultaneously.
9. Apply plant lifecycle, regrowth, flowering-window, delayed-harvest, death, and colony-loss transitions.
10. Persist warnings, causal reports, the renewable seed grant, and the three-day forecast exactly once.
11. Within one transaction, run the preserved NPC/day boundary, apply the already-frozen garden plan, attach its report and fingerprint to the replay receipt, and retain the existing single save-revision increment.

## Day-close matrix

| State | Result |
| --- | --- |
| Active brew | Reject and preserve all state |
| Active bake | Reject and preserve all state |
| Live dialogue processing | Reject and preserve all state |
| No craft completed | Allow; crafting is optional |
| One or more completed crafts, none active | Allow |
| Duplicate action ID with identical input | Return the original receipt |

## Verification cadence

Use the shortest useful ladder: focused pure/contract tests, focused database tests, focused RPC integration, Garden browser journeys, then one complete regression pass after P4. A broad test run may not block implementation for more than ten minutes; classify and isolate long failures before continuing.

The workflow overseer reviews this ledger at each contract or migration boundary, after each packet gate, and whenever a worker waits on an unstated dependency or tests repeat without new evidence.

## Acceptance receipts

- P1 (`1dac938`): accepted after reset-schema coverage for migration, deterministic resolution, replay, occupancy, day guards, ownership, and representative crop/spatial scenarios.
- P1 corrective follow-up: nutrient maxima, excess-nutrient symptoms, and overdose stress were added before P2 after command design exposed the missing upper-bound rule. The focused P1 suite now passes 91 assertions.
- P2: accepted after 84 focused pgTAP assertions for commands, compost reservations, and finite zero-gold recovery; four contract tests; two live local-Supabase adapter tests; database type parity; and a clean application check. Independent review confirmed exact replay, revision and ownership guards, atomic care, separate compost allocation, active-craft protection, expansion, and route-level recovery semantics.
- P3: accepted after 96 focused pgTAP assertions (54 apiary commands, 23 day scenarios, and 19 honey crafting), a 167-assert relevant P1/P3 database regression, and nine focused TypeScript contract/live-adapter tests. The packet proves exact replay and concurrent serialization; separate equipment and colonies; finite shared forage; local cause-specific health pressure; treatment downtime; conserved splits; permanent colony loss with retained equipment; feed/honey separation; safe extraction; and same-day honey brew/bake compatibility. The local Nosema correction is additive in migration 028, leaving the previously accepted day-engine migration byte-identical.
- P4: accepted after the overseer reviewed four focused interaction groups. Browser evidence proves stable tessellation and keyboard navigation at 12, 16, and 24 plots; independent scroll reachability with at least 44px targets at desktop and phone widths; exact stress, colony-loss, and day-report causes; preview-before-commit care with exact-ID retry; move, remove, regrowth, clover, and compost-reservation flows; and the complete equipment, colony, feed, eight-unit extraction, split, treatment, and expansion journeys. Legacy harvest, responsive/reduced-motion, and asset-fallback journeys remain compatible.
