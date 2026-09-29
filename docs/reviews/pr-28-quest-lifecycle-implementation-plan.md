# PR #28 NPC quest lifecycle implementation plan

This plan closes the five gaps identified in issue #32 and in `pr-28-quest-intent-assessment.md` at PR head `6f4d072f7ab76504e1bc6b8b0aba214928b8cc50`.

It is written for a simple coding agent. Complete the work in order, keep each step small, and run the focused tests after every step. Do not refactor the general settlement worker or provider stage architecture while doing this work.

## Intended behavior

Use these rules as the acceptance contract:

1. A terminal quest on day D creates one durable transition tied to its terminal event.
2. Day D+1 is not playable until every transition due for that opening has either committed once or recorded one handled failure and been deferred.
3. A successor committed while D+1 is still `settling` is active when D+1 opens. A result that arrives after D+1 is already `open` is scheduled for D+2.
4. A departure committed before an opening gives exactly that whole playable day as farewell. A late departure begins at the following opening. The resident is tombstoned only after the farewell day closes.
5. A failed transition is not claimable again during the same settlement. Other eligible residents continue. The failed transition retries during a later settlement with the same terminal event and frozen context.
6. Terminal resolution and day close never roll back because model context is too large. Canonical quest, event, author-version, and package records remain the complete audit source; the frozen model snapshot is a deterministic bounded projection of them.
7. After the authored arc, the model may choose a successor or voluntary departure. Its structured critic must explicitly judge durable goal, personality, lore, boundaries, and causal continuity with the terminal quest.
8. Players can page through complete, quest-grouped authored and generated history, including for departed residents, without seeing rolls, exact chances, frozen prompts, private rationale, or model reasoning.

## Scope guardrails

- Keep the canonical quest lifecycle from migrations 070-076. Do not restore generated-supply quest authority.
- Do not add arbitrary model-authored effects or a second quest state machine.
- Do not make the duplicated fenced-worker code or provider stage switches part of this ticket.
- Keep success, failure, and abandonment as terminal outcomes that all enter transition processing.
- Treat the complete authored milestone sequence as the opening arc.
- Preserve leases, fences, append-only attempts/checkpoints/receipts, idempotent commit replay, and the one-active-or-scheduled-quest invariant.
- Add forward migrations. Do not fold all database work into one migration.
- Preserve the existing untracked `docs/lira-baseline-worksheet.md`, `.serena/`, and unrelated review files.

## Work order

### 1. Make terminal resolution durable with a bounded frozen context

Add `supabase/migrations/202609200077_bound_quest_transition_context.sql` and extend `supabase/tests/npc_quest_resolution.test.sql`.

Implementation:

- Extract the context construction currently inside `private.world_resolve_quest_step` into a private deterministic builder.
- Keep the frozen context's existing exact 13-key shape unless the provider and worker parsers are updated in the same change.
- Keep these fields authoritative and present: quest identity and version/package pins, terminal event, ordered quest event summary, capability envelope, registered actions and approaches, valid target IDs/refs, current profile summary, next authored milestone, author intent needed by the critic, and bounded contextual evidence.
- Preserve full canonical data in `private.world_quests`, append-only `private.world_quest_events`, `private.npc_versions`, and the pinned resident package. The model snapshot may summarize or omit optional evidence; it must not delete or mutate those source records.
- Apply stable ordering, collection limits, and per-field UTF-8 byte budgets. Never cut JSON text by bytes and never truncate an identifier. Include an identifier whole or exclude that optional candidate.
- Budget optional content in this priority order: dialogue evidence, beliefs/provenance, social edges, hospitality prose, and nonessential profile prose. Required terminal, author, capability, target, and milestone facts win over optional evidence.
- Measure the final serialized JSON with `octet_length(...::text)` and guarantee it is at most 65,536 bytes. If optional evidence does not fit, emit valid empty arrays/objects so downstream exact-shape parsers still succeed.
- Remove the current overflow exception. Always insert exactly one `private.world_quest_transitions` row in `awaiting` state for a terminal event.
- Keep the canonical fingerprint calculated from the final bounded snapshot.

Focused acceptance:

- Build a valid fixture with a large sheet/profile/dialogue payload and a long allowed history.
- Resolve its terminal step directly and through `public.advance_tavern_day`.
- Assert the day close succeeds, the terminal event and quest terminal state persist, and exactly one awaiting transition references the terminal event.
- Assert serialized context is within 65,536 bytes, its fingerprint matches, and all required IDs/capabilities/milestone facts remain exact.
- Assert the complete canonical event history still exists even when optional model evidence was omitted.
- Run `supabase/tests/npc_quest_resolution.test.sql` through the repository's established focused `psql` TAP path.

Do not continue until this step proves an oversized valid context cannot roll back day close.

### 2. Make opening, farewell, and retries one database-owned lifecycle

Add `supabase/migrations/202609200078_quest_transition_opening_and_retry.sql`. Extend `supabase/tests/npc_quest_transitions.test.sql`, `tests/unit/world-quest-transition-worker.test.ts`, and `tests/unit/world-settlement-worker.test.ts`.

#### 2a. Store settlement-based eligibility

- Add transition metadata for the target opening and next eligible day/settlement. Backfill existing awaiting rows from their terminal quest day.
- Initial transition eligibility is the opening after the terminal day.
- On handled failure, keep status `awaiting`, keep the same terminal event/context, clear the active lease/fence, record the failure receipt, and set the next eligible opening to a later day. Do not use only a wall-clock delay.
- Make `world_quest_transition_claim_next` select only transitions whose save is `settling` and whose next eligible opening is due. Order eligible work by opening day, creation time, and ID.
- Make direct claim reject an awaiting transition that is not yet eligible. Expired `processing` leases remain reclaimable with a new fence.
- Keep the current checkpoint rule: validation rejection regenerates; operational interruption may reuse structurally accepted checkpoints.

#### 2b. Use `world_phase` as the opening boundary

- In `world_quest_transition_commit`, lock the save row before reading `current_day` and `world_phase`.
- If the save is `settling`, activate the successor or start farewell for that pending opening before publishing `open`.
- If the save is already `open`, schedule the successor/farewell for `current_day + 1`. Never activate or begin farewell mid-day.
- Keep committed receipt replay byte-for-byte idempotent; a replay must not change the scheduled day.
- Replace or extend the current-day trigger so scheduled quests and farewells start at the opening boundary, and farewell closes only after its one playable day.
- Preserve no-revival behavior and tombstone the resident exactly once after farewell closes.

#### 2c. Coordinate settlement completion with transition work

- Add one private database helper that publishes `world_phase='open'` only when normal settlement work is terminal and no quest transition is still due for that opening.
- Call that helper from every normal settlement completion/failure path that currently opens a save, and after transition commit or handled failure/defer. Do not duplicate the predicate in several functions.
- Update `drainWorldSettlementQueue` so due quest-transition work always receives bounded capacity even when ordinary settlement work is full. Prefer one due transition attempt first, then ordinary work, then use remaining capacity for transitions.
- A transition failure must defer that row and let opening continue. A crashed/expired lease remains settling only until the recovery path reclaims it or records a handled failure.
- Do not add a JavaScript-owned day/open flag.

Focused acceptance:

- **On-time successor:** terminate on D, commit while D+1 is settling, open D+1 with the successor active, and resolve no successor step before D+1 closes.
- **Late successor:** open D+1 first, then commit; assert no D+1 activation or retroactive hospitality and activation at the D+2 opening.
- **On-time departure:** start farewell before D+1 opens, keep dialogue and hospitality available throughout D+1, then depart/tombstone on D+1 close.
- **Late departure:** commit after D+1 opens, provide the full D+2 farewell day, then depart at its close.
- **Fair failure:** with A older than B, fail A once; B commits in the same drain, A is not reclaimable in that settlement, and A retries during a later settlement.
- **Fence/idempotency:** expired lease gets a new fence, the old fence is rejected, and commit replay creates no duplicate quest, news, receipt, or departure.
- Replace existing SQL assertions that expect immediate reclaim.

Run:

```sh
npx vitest run tests/unit/world-quest-transition-worker.test.ts tests/unit/world-settlement-worker.test.ts
```

Then run the focused transition SQL TAP suite.

### 3. Make author-story fidelity an explicit critic responsibility

Add `supabase/migrations/202609200079_quest_transition_continuity_prompts.sql`. Update:

- `src/lib/game/evolving-world/quest-transition-contracts.ts`
- `src/lib/server/evolving-world/prompts.ts`
- `src/lib/server/evolving-world/provider.ts`
- `src/lib/server/evolving-world/quest-transition-worker.ts`
- `tests/unit/world-quest-transition-contracts.test.ts`
- `tests/unit/world-quest-transition-provider.test.ts`
- `tests/unit/world-quest-transition-worker.test.ts`

Implementation:

- Add closed critic reason codes and paths for `author_fidelity`, `character_boundary`, and `causal_continuity`.
- Keep deterministic proposal validation responsible for shape, IDs, capabilities, bounds, plan rules, and departure safety. Do not pretend a regex or keyword list can prove narrative meaning.
- Make the proposer explicitly preserve the author's durable goal, identity/personality, lore, and boundaries, and connect the new objective or departure to the terminal outcome and event history.
- Make critic and final critic explicitly return accept/repair/reject based on those five criteria. Repairs must use the new closed reason codes.
- Make repair instructions preserve immutable terminal/milestone facts while correcting only the cited continuity failures.
- Distinguish the immutable author sheet from the evolved profile and from untrusted dialogue/belief evidence in all prompts.
- Update both code-default prompts and release-pinned prompt revisions. Create a new prompt release; do not edit an already pinned revision in place.
- Keep the complete bounded frozen snapshot in provider payloads. Store the critic decision/checkpoints as today so the continuity verdict remains auditable.
- Do not block the post-authored choice between a grounded successor and voluntary departure.

Focused acceptance:

- A well-shaped Lira successor that abandons road safety or contradicts her boundaries is rejected or sent to repair by the structured critic workflow and never committed as-is.
- A coherent Lira successor tied to the completed quest is accepted.
- A grounded voluntary departure is accepted after the authored arc.
- Success, failure, and abandonment terminal outcomes are each included in continuity evaluation.
- Provider schema tests accept the new closed critic reasons and reject unknown reasons/paths.
- Worker tests cover reject, one repair then accept, and final reject. Confirm `validation_rejected` is recorded and no commit happens for an uncorrected contradiction.
- Add a small semantic evaluation fixture using the real provider contract separately from shape-only unit mocks. It may be opt-in if it needs live credentials, but its input and expected rubric must be committed.

Run:

```sh
npx vitest run tests/unit/world-quest-transition-contracts.test.ts tests/unit/world-quest-transition-provider.test.ts tests/unit/world-quest-transition-worker.test.ts
```

### 4. Add complete quest-grouped history and departed-resident access

Add `supabase/migrations/202609200080_quest_history_archive.sql`. Update:

- `src/lib/game/dialogue.ts`
- `src/routes/(game)/bar/+page.server.ts`
- `src/lib/components/NpcDialogue.svelte`
- `src/lib/components/tavern/GuestInspector.svelte`
- `src/lib/game/bar-scene.ts` only if needed to keep archived residents out of playable patrons
- `supabase/tests/npc_quest_dialogue_projection.test.sql`
- relevant Bar/component tests

Implementation:

- Add an owner-scoped cursor-paginated RPC for one resident's quest archive. Use a stable database cursor, not offset pagination.
- Return quests as groups with player-safe fields: `questId`, `origin`, `title`, `objective`, activation day, terminal day/outcome, and ordered public events `{id, day, outcome, text, publicNews}`.
- Return a `nextCursor`; never silently cap the archive at 40 or truncate it again to 24 in the route.
- Add departed residents to an owner-scoped historical roster/detail projection. Keep them selectable for read-only history, but never add them back to `snapshot.patrons`, dialogue submission, serving, or evolution.
- Render current quest separately from grouped prior quests. Label authored versus generated quests and show terminal outcome and chronological events.
- Show farewell text for a departed resident and make the archive reachable from the Bar's past-residents flow and direct selection URL.
- Keep exact chance, draw, readiness internals, private departure rationale, frozen context, prompt/checkpoint data, and model reasoning out of every public projection.

Focused acceptance:

- Create more than 40 events across authored and generated quests, page through every quest exactly once, and preserve order across equal days.
- Assert groups contain quest identity/origin/outcome and their own events.
- After departure, find the resident in past residents, open the read-only journal, and page through the same complete archive.
- Assert public JSON does not contain `chance`, `draw`, `privateRationale`, `frozenContext`, prompts, checkpoints, or provider reasoning.
- Assert departed residents cannot be served, messaged, materialized again, or returned as playable patrons.

### 5. Add three cross-system lifecycle journeys

Extend `tests/helpers/evolving-world-playable-fixture.ts` with deterministic quest-transition provider fixtures and add a dedicated Playwright file, for example `tests/e2e/npc-quest-lifecycle-journey.test.ts`.

Use the real public serving/day-close paths, real quest resolver, real service claim/checkpoint/commit RPCs, and actual Bar projections. A deterministic provider fixture may replace the external model call, but do not insert terminal events, successor quests, departures, or history rows directly.

Journey A — authored arc to generated successor:

- Start Lira on the first authored milestone.
- Serve both food and beverage through the public Bar path across the quest.
- Complete every authored milestone in order.
- Assert hospitality changes only Lira's recorded terminal calculation, resets at the quest boundary, and generated inventory/intent cards do not contribute.
- Process the final authored transition during settlement and open the next day with one generated successor.

Journey B — generated successor repeats the loop:

- Complete the generated successor through normal daily resolution.
- Process its terminal event through the same transition worker.
- Assert exactly one next successor, one committed receipt, no duplicate news, correct opening-day activation, and both completed quests in grouped history.

Journey C — departure and archival history:

- Complete a quest and make the deterministic provider choose departure.
- Assert one full playable farewell day with farewell dialogue and serving.
- Close that day; assert the resident leaves playable patrons and cannot receive a quest or dialogue.
- Open past residents and assert the complete grouped authored/generated history remains accessible.

Keep the browser matrix to these three journeys. Queue failure/retry, oversize context, lease races, and semantic repair belong in focused SQL/unit tests rather than duplicating them in Playwright.

## Final verification

Run focused checks first, then the repository checks:

```sh
npx vitest run tests/unit/world-quest-transition-contracts.test.ts tests/unit/world-quest-transition-provider.test.ts tests/unit/world-quest-transition-worker.test.ts tests/unit/world-settlement-worker.test.ts
npx playwright test tests/e2e/npc-quest-lifecycle-journey.test.ts
npm run check
npm run build
git diff --check
```

Run the five quest SQL TAP suites after applying the forward migrations:

- `supabase/tests/npc_quest_lifecycle.test.sql`
- `supabase/tests/npc_quest_resolution.test.sql`
- `supabase/tests/npc_quest_transitions.test.sql`
- `supabase/tests/npc_quest_dialogue_projection.test.sql`
- `supabase/tests/npc_quest_authority_consolidation.test.sql`

If an RPC signature or return type changes, regenerate `src/lib/database.types.ts` with the repository's existing local Supabase command before `npm run check`.

## Completion checklist

- [ ] Oversized valid context cannot roll back terminal resolution or day close.
- [ ] Due transition success is applied before opening; late success waits for the next opening.
- [ ] Farewell lasts exactly one complete playable day.
- [ ] One handled failure cannot be reclaimed in the same settlement or starve another resident.
- [ ] Lease fencing, checkpoint recovery, and commit idempotency still pass.
- [ ] Critic workflow explicitly rejects or repairs contradictory author-story continuations.
- [ ] Full quest-grouped history is paginated and available after departure.
- [ ] The three lifecycle browser journeys pass through real serving, resolution, transition, opening, and projection boundaries.
- [ ] No private model, roll, chance, or departure-rationale data reaches public projections.
- [ ] No unrelated settlement/provider refactor or generated-supply quest behavior was added.
