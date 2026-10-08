> This report records the earlier Issue 37 baseline. The accepted right-folio/card-first presentation supersedes its Talk/Deck navigation and compact-card layout; see [the current implementation verification](issue-37-right-folio-verification.md).

# Issue 37 acceptance and evidence

[Issue #37](https://github.com/dutycaws/ByRookAndCrook/issues/37) is implemented on `codex/issue-35-relationship-garden` for [PR #36](https://github.com/dutycaws/ByRookAndCrook/pull/36). This extends the existing relationship/garden work. The PR remains open for review; this work does not merge it or close the issue.

## Result

The Bar opens on the common room with compact day/gold status, contextual keepsake slots, and End evening. Selecting a resident focuses the shared camera and opens a reusable `ResidentInspector`. Talk and Card Deck lead into the same composer. The journal scrolls within the desktop panel, with a full reading destination in the Codex. Mobile keeps the scene, back action, hand, and composer in a single readable sequence.

The illustrated hand contains Charm, Insight, Flirt, Rumor, Serve Drink, and Serve Food. Service cards project actual finished inventory, grouped by kind, product, ingredient type, and final quality while retaining each backing UUID. Speaking with a service card consumes one exact item and applies existing hospitality rewards atomically. Lost-response retries reuse the same command and serving identity. Cardless Talk remains available. Resolve is removed without resetting unrelated progress.

The Codex shares the Bar's history reader/presenter, including past residents, conversations, and hospitality. Meaningful reports produce short notifications and persistent unread state. Expiration does not mark a report read. Backlogs acknowledge in batches of 100; the reader has no cap that could hide older unread events.

## Acceptance mapping

Numbers correspond to the ordered issue checkboxes. All groups are implemented; verification combines automated behavioral checks and actual rendered review.

| Criteria | Implementation and evidence |
| --- | --- |
| A1–A3: scene, compact overview, no autofocus | `TavernScene`, `BarStatusRail`, Bar route; scene unit tests, overview E2E and desktop/mobile stills. Permanent readiness/status/inspector blocks removed. |
| A4–A6: camera, contextual actions, composer/history | Shared compositor/parallax camera with clamped bounds; `ResidentInspector`, `NpcDialogue`; focused/deck/selected stills and normal-motion clips. Faces remain unobstructed. |
| A7–A8: back, layered Escape, keepsake context | Bar journey and trinket collection E2E verify drafts, selection clearing, empty/occupied slots, Escape and opener focus. Closing uses the centered shared Dialog. |
| A9: readiness filler | Report/chronicle filtering and settlement presentation; unit/realtime checks preserve meaningful errors and terminal settlement copy. |
| B1–B2: illustrated scrolling hand | Reusable `TavernCard`, `TavernCardArt`, `TavernDeckBack`, `ServiceCardHand`; six distinct illustrations, horizontal scrolling, arrow/Home/End keys and previous/next controls. Desktop/mobile hand inspection. |
| B3–B4, B10: service identity/stacking | `serviceCardStacks` and finished-item projection; unit tests distinguish kind/product/ingredient/final quality and ignore source quality/batch/time/UUID for grouping while retaining UUIDs. No second inventory or per-combination catalog. |
| B5–B7: selection, dismissal, retry, drafts | Compact selected card beside composer with short entry/glow/hover; reduced motion disables travel/hover. E2E verifies dismissal spends nothing, exact replay, clearing on exit and per-resident drafts. |
| B8–B9: Resolve removal, Flirt | Migration and active contracts/acquisition/dialogue updated; migration, dialogue and database tests verify conversion and retained unrelated progress. |
| B11: cardless Talk | Existing cardless request path and explicit Talk action; no Plain card in hand. Dialogue regression coverage and rendered composer inspection. |
| C1–C3: serving through Talk | Standalone Bar Serve action removed. Inventory card opens composer with a concrete UUID, no picker and no independent offering selector. Unit/integration/E2E checks. Legacy RPC remains for compatibility/parity tests. |
| C4–C5, C7: transaction, parity, validation | Service-card/dialogue integration and serving SQL tests: one item, legacy final-quality/keepsake rewards, exclusive intent/offering, stale/unowned/unavailable rejection, no partial spend and idempotent replay. |
| C6, C8–C9: context, outcome, stock, crafting | Drink and food integration fixtures verify ingredient-specific identity/final quality, no source-quality context, hospitality and depleted stock. Brewery/database regression checks preserve production provenance/calculations. |
| D1–D3: current/past history | Shared reader and `NpcHistory`; history unit tests, archive E2E and Codex stills. Full journal/conversation/hospitality data shared; authored neutral portrait fallback inspected. |
| D4–D7: reports, notifications, unread | Shared layout, report reader and Codex read API; notification E2E seeds 112 reports and checks pause/expiry/deduplication/anchor navigation/read retry/batch bounds. Ordinary payouts remain in resident history. |
| E1–E3: input, layout, motion | Desktop and 390×844 rendered review; scene/hand roving keys, visible focus, Escape/restoration E2E; normal/reduced desktop/mobile clips. No horizontal page overflow with focused composer or hand. |
| E4–E8: behavioral coverage | UI E2E plus service/history/report/migration/production tests cover preceding contracts. Both service kinds are integration-tested; captured E2E demonstrates drink selection and lost-response replay. |
| E9: checks and rendered evidence | Checks below; local stills/clips with hashes, dimensions, duration and runtime-asset provenance in the tavern acceptance manifest. |

## Verification

- Svelte/type check: zero errors and warnings. Production build passed.
- Unit suite: 83 files, 705 tests passed.
- Integration suite: 12 files, 37 tests passed.
- Fresh isolated migration replay/database suite: 88 SQL files, 2,413 assertions passed.
- Scoped desktop/mobile E2E: 20 tests passed across Bar journey, archives, keepsakes, notifications and settlement realtime.
- Generated database types match; NPC catalog, optimized assets, secret audit and whitespace checks passed. Staged media policy checked before commit.

Logs remain local under `/tmp/issue37-final-*.log`. Final E2E capture reruns the same source after commit, recording clean provenance in the media manifest.

## Local visual and motion evidence

Screenshots/videos are ignored local artifacts, never committed. The historical baseline predates this redesign and uses an earlier day/save state; comparison illustrates layout, not gameplay progression.

- Before: `/tmp/rook-tavern-ui/before-desktop.jpg`, `/tmp/rook-tavern-ui/before-mobile.jpg`.
- After directory: `artifacts/media-captures/issue-37-final/`.
- Overview/focus/deck/selection: `tavern-{overview,focus,deck,selected}-{desktop,mobile}.jpg`.
- Reading/closing: `codex-desktop.jpg`, `codex-mobile.jpg`, `close-mobile.jpg`.
- Motion: `normal-desktop.webm`, `normal-mobile.webm`, `reduced-desktop.webm`, `reduced-mobile.webm`.
- Results/provenance: `acceptance-results.json`, `capture-manifest.json`.
- Validate: `npm run media:evidence:validate -- --directory artifacts/media-captures/issue-37-final`.

## Review iteration and limits

Rendered review identified desktop journal overflow, dialog positioning, excessive keepsake containers and missing authored Codex portraits, a compact overview artwork gap, and mobile notices intercepting keepsake clicks. Repairs use a bounded journal surface, shared Dialog centering, flat contextual slot management a neutral portrait fallback, and corrected compact background/counter bounds with a geometry regression test. Mobile notices now use a compact bottom position and only their link/dismiss controls accept pointer input. Final desktop/mobile inspection verifies those repairs, connected card/composer behavior and no horizontal page overflow.

Mobile area navigation remains horizontally scrollable. Long journals intentionally scroll within their destination. Dialogue/settlement tests use deterministic providers; they verify UI/transactional contracts but are not a live provider quality evaluation. The legacy serving RPC remains for compatibility although its standalone playable action is removed.

Organizer/design lead established bounded UI ownership; the fileless workflow overseer stayed active through implementation and verification. Root owns browser evidence and Git/PR integration. Source changes and this report are committed; media remains local.
