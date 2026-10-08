# Bar right folio implementation verification

Implemented on `codex/issue-35-relationship-garden` for PR #36, following the accepted [implementation plan](issue-37-right-folio-implementation-plan.md). The disposable prototype remains on `codex/prototype-bar-interactions`; normal `/bar` uses real inventory, residents, journals, and existing command endpoints.

## Result

The room overview contains the scene, compact day/gold status, End evening, original keepsake icons, and the past-resident destination. Selecting a resident raises a wide, centered card arch. Selecting a card opens the translucent composer over the faded hand. Talk/Deck navigation, hand navigation buttons, and the permanent inspector have been removed from Bar play.

Journal opens a bounded right folio on desktop and a bounded surface below the scene on narrow screens. Identity, close, and full-archive controls remain outside the scrolling entries. The latest player/resident exchange is visible inside the chat; older exchanges remain in Journal. Opening Journal suspends the composer presentation while preserving the selected card, draft, pending result, error, and exact retry identity. Escape closes the top contextual surface and restores its opener; a second Escape returns to the room when no command remains unresolved. Escape can close a pending composer; Return to unfinished reply restores its recovery controls without changing the command. Unfinished commands prevent changing residents or leaving their interaction until resolved.

Keepsakes fade and become inert immediately on resident selection. Occupied icons open details and Remove/Replace; empty icons open the collection. A lost response retains the original swap command and leaves Retry available. Successful Place/Replace refreshes the scene and restores focus to its slot. Remove keeps the collection open.

All presentation remains in reusable scene/card/dialogue/history/collection components. `FloatingSurface` supplies the shared translucent surface treatment. No backend, schema, provider, mock data, variant switcher, or prototype controller was introduced.

## Verification on 2026-10-08

| Check | Result |
| --- | --- |
| `npm run check` | Zero errors and warnings |
| `npm run build` | Passed |
| Focused service-card, dialogue-status, quest-archive, scene, history unit tests and service-card transaction integration | 6 files, 30 tests passed; drink and food UUID/provenance/replay/rewards covered |
| Bar journey | 12 desktop/mobile tests passed; automatic hand, drafts, Journal return, frozen serving retry, one consume/receipt, keyboard, reduced motion, empty hand/crafting destinations and collection, empty slots, load retry, closing retry |
| Codex archive selector | 2 desktop/mobile tests passed; read-only past residents, deep links, empty room |
| Keepsake collection journey | 2 desktop/mobile tests passed; direct details, Replace, committed lost-response replay, reload persistence, Remove retaining the collection, focus restoration |
| Settlement interlude realtime | 4 desktop/mobile tests passed |
| Rendered review | Root inspected normal `/bar` at 1440×900, 900×900, and 390×844; folio scrolling, hand/chat overlap, contextual slots, and no mobile page overflow |

These are the current focused checks. The earlier baseline's larger database/unit suites were not rerun for this presentation change. Dialogue and settlement tests use deterministic providers; this work does not evaluate live model quality.

## Review iteration

The first rendered hand was left aligned with a shallow inverted curve. It was corrected to a centered arch with the middle raised, the outer cards angled, and bounded local panning when inventory exceeds available width. Keyboard focus raises the focused card and scrolls it into view. Mobile review exposed excessive space between the scene and hand; the interaction stage was shortened and Journal moved closer to the scene. The lost-response keepsake test found an invalid error role, which was corrected to an alert. Internal Replace/Remove navigation now focuses Collection instead of dropping keyboard focus. Inspecting the successful serving capture exposed a missing reply in the chat; the latest exchange is now rendered directly in its own scroll region. The mobile keeper-message preview is limited to two lines so the resident reply remains visible; the full exchange stays in Journal. Redundant slot labels and the nested detail border were removed; controls meet 44px target sizing.

## Local evidence

Screenshots and video are local only, excluded from Git. `/tmp/rook-right-folio/` contains:

- `before-desktop-hand.jpg`, `before-desktop-journal.jpg`, `before-mobile.jpg`: preserved captures of the original branch before this implementation. They show earlier viewports/selected residents and compare presentation rather than gameplay progression.
- `after-desktop-overview.png`, `after-desktop-hand.png`, `after-desktop-chat.png`, `after-desktop-journal.png`, `after-desktop-journal-scrolled.png`.
- `motion-normal-{desktop,mobile}.webm`, `motion-reduced-{desktop,mobile}.webm`, `after-medium-journal.png`, `after-mobile-hand.png`, `after-mobile-chat.png`, `after-mobile-journal.png`, and contextual keepsake captures.
- `chromium-*` and `mobile-chromium-*`: deterministic journey captures, including successful serving replay and reduced-motion chat.

Check logs use `/tmp/rook-right-folio-*.log`. The PR remains open for review.

## Remaining limits

Large hands pan within their own viewport instead of shrinking card labels. Mobile area navigation still scrolls horizontally. Long journals scroll within the folio or full Codex. No remaining functional blocker was found in the verified flows.
