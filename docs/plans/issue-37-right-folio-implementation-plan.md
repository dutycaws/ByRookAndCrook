# Bar right folio implementation plan

Status: implemented and verified on `codex/issue-35-relationship-garden` (2026-10-08). See [implementation verification](issue-37-right-folio-verification.md) for current checks and local evidence.

The normal Bar will adopt the wide player-perspective card hand, soft motion and transparency, and right journal folio selected in the prototype. The tavern scene remains the main interface throughout room overview and patron focus.

## Branch and source

- Target: `codex/issue-35-relationship-garden`, currently `7aa66a8` (the original branch underlying PR #36).
- Design reference: `codex/prototype-bar-interactions`, accepted revision `0f3468b`, `/bar?variant=E`.
- The prototype fork point is `7aa66a8`. Its five subsequent commits are disposable comparisons, not a merge-ready implementation.
- Existing gameplay evidence: [issue-37-progress.md](issue-37-progress.md).

Implement against the latest target-branch state in a suitable checkout/worktree. Rewrite the accepted presentation around its real data and actions. Keep the prototype branch as a reference; do not merge or cherry-pick its mock controller, variants, switcher, or debug controls into the target branch. The implementation below was applied directly to the target branch; the prototype branch remains a design reference.

## Locked design

| State | Accepted behavior |
| --- | --- |
| Room overview | Scene dominates. Compact day/gold status and a discoverable End evening action. Original occupied/empty trinket slots remain visible on the scene. No permanent journal, patron inspector, or trinket collection panel. |
| Patron selected | Camera focuses the chosen NPC. A wide, centered, arched hand rises from the bottom. A small Journal control and obvious return-to-room control remain available. Trinket icons fade away and immediately leave pointer and keyboard interaction. |
| Card selected | Chat rises from the bottom over the hand. The hand stays visible, with unselected cards at approximately 32% opacity and the selected card at 68%. Card selection alone spends nothing. The conversation identifies the card and patron without repeating an inspector header. |
| Journal open | A slightly translucent, scrollable folio sits on the right of the scene. Its patron label, close control, and archive link remain outside the scrolling entries. Opening it suspends the chat presentation while retaining card, draft and conversation state. Closing it restores the previous interaction. |
| Trinket selected | Available only in room overview. An occupied icon opens that item's effect, dedication and actions directly. Replace reveals the collection; an empty slot opens the collection immediately. Slot selection is determined by the scene icon, with no duplicate slot-picker row or generic Trinkets menu. |
| Narrow viewport | Scene stays above the interaction. Hand and chat overlap below it; Journal occupies a bounded surface below the scene rather than covering the NPC. Close/back and composer remain reachable. The page must not scroll horizontally. |

Use the prototype's soft treatment as the initial motion specification: roughly 320ms hand entrance, 240ms chat entrance, short journal fades, and an 82% chat background. Journal background starts near 76% opacity. These values may be adjusted for readability with real content, while preserving the accepted visual hierarchy. Use opacity/transform transitions without delaying inputs or gameplay requests. Reduced motion replaces travel with a brief fade and removes decorative hover movement.

The accepted card-first flow supersedes the old Bar's visible cardless Talk entry and Talk/Deck navigation. Preserve existing request/API capabilities and story choice behavior; this is a presentation change, not removal of gameplay contracts.

## Live implementation map

| Owner | Work to carry over |
| --- | --- |
| `src/routes/(game)/bar/+page.svelte` | Compose room/patron/card/journal state, compact closing access and responsive surfaces. Remove the old competing inspector/navigation presentation. Normal `/bar` uses the winner directly. |
| `src/routes/(game)/bar/+page.server.ts` | Preserve authenticated snapshot/history loading, archived history availability, settlement status and revision-checked `close`/`advanceDay` retry identity. No planned server changes. |
| `src/lib/components/tavern/TavernScene.svelte`, `BarStatusRail.svelte` | Keep real camera/actor selection, scene framing, compact status and original trinket anchors. Fade/inert anchors on patron focus; retain the existing hit-target alignment. |
| `src/lib/components/NpcDialogue.svelte` | Preserve turn creation, frozen pending commands, status polling, retry and successful refresh. Recompose the hand/chat presentation around those behaviors rather than replacing the controller with prototype state. |
| `src/lib/components/tavern/ServiceCardHand.svelte`, `TavernCard.svelte`, `TavernCardArt.svelte` | Render `stock.intentCards` and `serviceCardStacks(...)` as the real wide arch. Keep grouped inventory and each backing UUID from `src/lib/game/service-cards.ts`. |
| `src/lib/components/tavern/NpcHistory.svelte`, `ResidentInspector.svelte` | Reuse the real history presentation inside the right folio. Thin or retire the inspector's layout wrapper where it competes with the scene; retain behavior and archive links. |
| `src/lib/components/tavern/TrinketCollection.svelte` | Adapt the existing real slot/collection operations to icon-first direct detail and Replace selection. Do not create a second inventory or local assignment model. |
| `src/lib/components/ui/` | Reuse `FloatingSurface.svelte`; add reusable arched-hand layout or scrollable-folio primitives only where existing components cannot own the behavior cleanly. Domain card/history/slot components remain reusable under `components/tavern/`. |
| `src/lib/components/tavern/SettlementInterlude.svelte` | Preserve the settlement interlude and recovery/navigation behavior. Keep closing reachable from the accepted scene layout. |

The prototype's visual references are `VariantB.svelte` (stage and motion), `PrototypeCardFan.svelte` (wide arch), `PrototypeConversation.svelte` (chat overlap) and `PrototypeSceneTools.svelte` (E folio/slot surfaces), all under `src/routes/(game)/bar/prototype/`. Their hardcoded cards, fabricated dialogue/serving outcomes, in-memory history, sample trinkets, variant parser/switcher and debug state are excluded.

The server boundaries in `src/routes/api/dialogue/`, `src/routes/api/world-settlements/` and `src/lib/server/` remain authoritative. Selecting a service card passes its exact inventory item ID through the existing dialogue command; completion refreshes live data, and unfinished turns retain the same command for status and retry.

## Implementation sequence

### 1. Establish reusable presentation components

Translate the accepted prototype visuals into the existing UI library. Reuse existing primitives and game card artwork; make new components only where they own a reusable interaction or layout. Keep the Bar route responsible for game state and requests, and presentation components responsible for rendering, focus, and motion.

The needed responsibilities are a responsive arched hand, bottom conversation surface, scrollable journal folio, and contextual slot detail/collection surface. Prefer explicit inputs and callbacks to a single prototype model object. Keep mock cards, mock replies, sample trinkets and local-only assignment maps out of the implementation.

### 2. Connect the real hand and dialogue

Use real learned intent cards and grouped finished food/drink inventory. Preserve actual card IDs, inventory UUIDs, quantities and exact-item selection; the prototype's four sample cards do not define the real hand.

Selecting a patron reveals the hand; selecting a card opens the existing dialogue/composer behavior. Keep authored story choices and service actions within that conversation surface. Do not add Choose cards, Talk/Deck tabs, Back to talk, a separate Serve panel, or repeated resident information.

Handle zero cards, zero stock, loading and stale inventory in context, with the relevant crafting destination where stock is needed. For large hands, retain readable card labels and 44px targets; permit bounded panning within the hand when overlap alone is insufficient, with visible edge cues and keyboard focus scrolling. Do not shrink every card to fit an arbitrary inventory count or introduce horizontal page overflow.

Preserve per-patron drafts, pending request identity, retry identity, item availability, resource updates, gameplay feedback and double-submit protection. Closing an overlay must not discard a request or turn a retry into a new serving transaction. Define switching cards/patrons while a request is pending explicitly before wiring UI dismissal.

### 3. Integrate right journal and scene trinkets

Use the existing history reader/presenter for the selected patron. Keep full journals, conversations, hospitality history and past residents in Codex; the folio is a current-patron reading surface, not a second archive implementation. Preserve existing loading, empty, error/retry and archived/read-only states.

Use the original scene trinket anchors and artwork. Reuse the real collection/slot mutation behavior. Occupied slots start at direct details, Replace opens the collection, and empty slots start at selection. Keep header/close controls fixed and collection/detail content scrollable on short screens. Real assignments must update scene icons and retain existing validation, pending/error/retry feedback.

When patron focus starts, close any slot surface and disable/inert its icons immediately before the fade completes. Let the Bar controller focus the first card; the closing slot surface must not steal focus. Returning to overview restores the icons.

### 4. Integrate navigation, motion and settlement

Use one explicit interaction state flow: room → patron/hand → card/chat, with Journal layered over the patron state and slot details confined to room state. Avoid loosely coupled flags that allow conflicting surfaces to render together.

Preserve camera framing and hit-target alignment. Escape closes only the topmost surface and restores its opener; returning to the room restores the selected NPC control. Keep arrow keys in the hand/composer, visible focus, predictable Tab order, and labelled journal scrolling. Returning from Journal preserves the card and unsent draft.

Retain compact End evening access and the existing settlement confirmation, pending/result/error states and navigation. Closing the tavern must not become a permanent large card or disappear because the hand replaces the old inspector.

### 5. Verify, iterate and capture

Run the repository Svelte check and build. Extend or update the existing focused Bar tests for the new state/focus paths; keep real dialogue/serving retry coverage and history/keepsake/settlement regression checks. This presentation-only work does not require a full database migration replay unless implementation changes server contracts or schema.

Browser review is owned by the primary agent only. Review desktop, a medium viewport and 390px mobile, plus keyboard and reduced-motion behavior. Cover populated and empty room/hand/stock/history/collection states, loading/error/retry, archived residents and settlement. Exercise a successful real dialogue, story choice, drink/food serving, lost-response retry, journal return with draft, slot replacement, and return to the room.

Start with the existing focused checks:

```sh
npm run check
npm run build
npm run test -- tests/unit/service-cards.test.ts tests/unit/dialogue-status.test.ts tests/unit/bar-quest-archive.test.ts tests/unit/bar-scene.test.ts tests/unit/npc-history-view.test.ts tests/integration/service-card-talk.test.ts
npm run test:e2e -- tests/e2e/bar-journey.test.ts tests/e2e/bar-archive-selector.test.ts tests/e2e/trinket-collection-journey.test.ts tests/e2e/settlement-interlude-realtime.test.ts
```

Use the repository's existing local services/fixtures for integration and E2E checks. Update assertions that intentionally expect the old Talk/Deck controls; keep the gameplay assertions. In particular, `bar-journey.test.ts` already exercises one-consume serving replay, reduced motion/slot access, close retry into settlement and failed-load recovery.

Capture before/after stills and short normal/reduced-motion recordings locally only. Fix the biggest rendered usability problem before broadening scope. Document the accepted implementation and validation on issue #37 and its target PR after the work is reviewable.

## Delivery ownership

Start implementation with the locally defined agent-organizer. Keep a fileless workflow overseer active until delivery, and the UI designer as acceptance/design lead. Delegate bounded coding ownership after callback seams are agreed:

- Scene/route owner: Bar route, `TavernScene` and `BarStatusRail`; room/focus/navigation/closing integration.
- Hand/dialogue owner: `NpcDialogue`, `ServiceCardHand` and any arched-hand primitive; real card-first requests and responsive hand/chat.
- Folio/slot owner: `NpcHistory`, `TrinketCollection` and any folio primitive; contextual reading and actual slot operations.

Assign `ResidentInspector` explicitly to one owner before editing it. Integrate the component contracts sequentially where they meet the route; do not let two workers rewrite the same controller. The primary agent owns browser work, cross-component integration review and final verification. Workers must preserve concurrent edits and must not operate the in-app browser.

## Completion criteria

- Normal `/bar`, without a variant query, renders the accepted right-folio experience using real gameplay data.
- Overview has one visual focal point and no permanent secondary panels or repeated information.
- Patron selection, card selection, dialogue, story choices and serving form one connected flow; unrelated panels do not need to be traversed.
- Journal is translucent, scrollable and contextual; archives remain discoverable.
- Trinkets are activated through scene icons and cannot be reached while talking to a patron.
- Empty, loading, error/retry, archived and settlement states remain usable.
- Drafts, serving/resource correctness and replay semantics are preserved.
- Keyboard, Escape, focus restoration, reduced motion and mobile layouts pass rendered review.
- Checks pass, evidence is local only, and no prototype switcher/debug/mock behavior appears on the target route.
