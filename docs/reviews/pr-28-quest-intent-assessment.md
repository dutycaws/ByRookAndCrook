# PR #28: NPC quest intent assessment

Reviewed PR head `6f4d072f7ab76504e1bc6b8b0aba214928b8cc50` against merge-base / PR base `b356a497785db7ace6fec0c0f5260862435617de`.

Sources: [PR #28](https://github.com/dutycaws/ByRookAndCrook/pull/28), [issue #31](https://github.com/dutycaws/ByRookAndCrook/issues/31), and the user's stated intent. The current local HEAD matches the remote PR head. This assessment concerns the quest lifecycle, not every feature in the 252-file PR. The user's existing untracked `docs/lira-baseline-worksheet.md` was excluded.

The architecture substantially implements the intended loop. It is not yet complete against issue #31: the remaining work concerns the opening-day boundary, recoverable transitions, explicit author-story fidelity, and player-visible history and acceptance coverage. A percentage would obscure the fact that a few cross-system gaps can break an otherwise implemented lifecycle.

## Implemented intent

| Requirement | Evidence at reviewed head | Assessment |
| --- | --- | --- |
| One current quest per NPC | Migration 070 canonical `world_quests`, unique active/scheduled invariant, shared resident materializer | Implemented |
| Begin with the author quest | Migration 070 pins the first milestone and starting plan to the resident package/version | Implemented |
| Finish the authored opening arc before generated successors | Migration 071 freezes the next authored milestone; migration 072 and transition contracts restrict the next decision to that milestone | Implemented |
| Food and beverages affect success | Migration 071 sums resident food/beverage quality across activation through resolution; applies hospitality, preparation/readiness and chance clamps; persists the draw and outcome | Implemented |
| Completed quest + author sheet feed the LLM | Migration 071 freezes both plus history/profile/evidence; quest worker invokes proposer, critic, optional repair and final critic through the real provider | Implemented structurally; semantic fidelity needs strengthening |
| Repeat successor/departure after generated completion | Authored and generated quests use the same resolver and terminal-event transition path | Implemented structurally |
| One farewell day, no quest revival | Migration 072 has farewell/departure records and tombstones; dialogue projection rejects plans outside an active quest | Implemented state model; opening-day timing remains incomplete |
| Generated supplies cannot improve quest chance | Migrations 074–076 remove quest supply attachment and retire the old procedural quest authority | Implemented |

“Author main quest” is interpreted as the complete author-defined opening arc, as issue #31 explicitly requires. Failure and abandonment are terminal outcomes; they advance the transition workflow rather than forcing the NPC to retry forever. Neither interpretation is treated as a deviation.

## Behavioral diff

This is the requested current-to-intended behavior diff, not an untested implementation patch.

```diff
  Resident materialization activates the first authored milestone.
  One active or scheduled quest exists per resident.
  Food/beverage hospitality affects the persisted terminal success chance.
  Every terminal quest enters the same LLM transition workflow.
- Transition commits can activate against the save's current day without checking whether gameplay has reopened.
+ Commit and activate a successful transition before the opening day becomes playable.
+ A late transition waits for the next opening boundary; farewell lasts one full playable day.
- Failed transitions become immediately claimable again in the global oldest-first queue.
+ Persist one handled failure and retry that terminal event in a later settlement without starving other NPCs.
- An oversized frozen context raises inside the terminal-resolution transaction.
+ Preserve terminal completion and a recoverable awaiting-transition state; bound the model context without losing the authoritative history.
- Successor validation and critic instructions focus on shape, target IDs, capabilities and text bounds.
+ Explicitly evaluate durable goal, personality, lore, boundaries and causal continuity with the completed quest.
- The player's quest journal exposes a bounded recent event list without complete quest grouping/history access.
+ Provide accessible, quest-linked authored and generated history, including departed residents.
- Existing component tests stand in for the complete Lira lifecycle journeys.
+ Exercise real serving, resolution, transition processing and day opening through the requested end-to-end journeys.
```

## Standards

No hard documented coding-standard violations were identified in the bounded quest review. Two judgement-call findings from the code-review skill's baseline remain separate from the behavioral gaps:

1. **Duplicated Code:** `src/lib/server/evolving-world/quest-transition-worker.ts:45`, `:127`, and `:178` repeat RPC/error handling, lease management and prompt/telemetry execution from `settlement-worker.ts`. The lease implementations have already diverged. Consider sharing the stable fenced execution machinery when fixing the lifecycle.
2. **Repeated Switches:** `src/lib/server/evolving-world/provider.ts:43` and `settlement-contracts.ts:20` add parallel stage sets, schema/parser branches and checkpoint/prompt mappings. A stage descriptor map could reduce future drift.

These are maintainability observations, not requirements to rewrite the system before fixing the gameplay gaps.

## Spec

Created follow-up [issue #32: Finish NPC quest lifecycle integration](https://github.com/dutycaws/ByRookAndCrook/issues/32), with five behavioral gaps, implementation objectives and acceptance tests. Code links there are pinned to the reviewed commit so the assessment stays auditable as PR #28 evolves.

Standards: two judgement-call maintainability findings, no hard violations; the main concern is duplicated fenced-worker behavior. Spec: five gaps; the most severe are terminal-context rollback and day-opening timing. Missing end-to-end journeys are additional acceptance work, not proof of a runtime defect.

## Verification

- Remote PR head and base were checked through GitHub; both match the local review references.
- `npx vitest run tests/unit/world-quest-transition-contracts.test.ts tests/unit/world-quest-transition-provider.test.ts tests/unit/world-quest-transition-worker.test.ts`: **3 files, 17 tests passed**.
- A direct structural-validator probe accepted a bounded successor whose prose explicitly disregards the author's former goal. This demonstrates absent semantic checks in that validator; it does **not** demonstrate that a live model/critic produced or accepted such a story.
- Focused quest SQL suites executed against the running local database through `psql`: **5 files, 120 assertions passed** (28 lifecycle, 27 resolution, 34 transitions, 21 dialogue projection, 10 authority consolidation). All TAP plans matched. Each test transaction rolled back; no database reset. The `npx supabase` runner could not use its read-only npm cache, so the existing database client was used.
- `git diff --check` passed.
- No live LLM evaluation, complete browser lifecycle journey, production build or full repository verification was run for this review. Earlier issue comments report prior broader passes; those are not substituted for current end-to-end evidence.
- No gameplay implementation files were changed.
