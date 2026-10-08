# Disposable Shop wheel prototypes

Question: which wheel placement makes browsing Elara’s goods feel connected to her shop scene, while keeping category → item → purchase navigation obvious?

Baseline: `/shop` renders a gold/expansion panel, the Elara scene, a tall illustrated catalog with another gold balance, and settlement provisions below. At 390px, status comes before the scene and goods continue below the fold. The pilot has 26 gold; expanding from 12 to 16 plots costs 60 gold. Cheap seeds provide an affordable preview while expansion exercises insufficient funds.

Three alternatives live on `/shop`, selected with `?variant=A`, `B`, or `C`, on the disposable branch `codex/prototype-shop-wheels`. The original route’s data loading and production rendering remain available. Prototype purchases use in-memory state only.

- A — left orbit: a compact side wheel tests a merchant-facing browsing arrangement.
- B — right orbit: the wheel occupies the shelves opposite Elara and keeps her silhouette clear.
- C — card hand: selecting a category burns its card away, then deals that category’s goods into a broad arch inspired by the Bar hand.

Garden expansion is an ordinary item in the Garden category alongside soil amendments. Each alternative supports categories, goods, preview, a mock purchase result, and returning to the originating choice. The floating switcher exposes the current selection/state and preserves it while switching layouts.

Start with `npm run prototype:shop`. If the app stack is already running, use its existing URL instead of starting another stack.

Verdict: pending player review. These alternatives explore presentation, not transaction reliability, and should be rewritten around the chosen design for implementation.

Local evidence is saved outside the repository in `/tmp/rook-shop-wheels/`. Screenshots must not be committed.

Browser review covered desktop (1280 × 720) and phone (390 × 844), category drill-down, purchase previews, insufficient gold for expansion, a mock purchase, layout switching while an item is selected, and Escape restoring the originating item/category. The initial review corrected viewport clipping, missing scene height, shallow URL switching that failed to update the layout, duplicated navigation, and mobile previews placed beneath faded browsing controls.

Reduced-motion media queries disable card dealing, burning, orbit transitions, and preview entry motion. This browser control surface does not expose motion emulation, so those rules were inspected in source. Prototype compilation was checked with `npm run check`; no new tests were added under the prototype skill’s throwaway-code rules.
# Ember-hand iteration

The player selected C's bottom card hand as the preferred shop direction. This iteration asks which burn, spacing, and pacing best communicates opening a category while keeping Elara and the shop scene prominent.

Compare three treatments within C using the visible burn controls and the `burn` query parameter:

- `/shop?variant=C&burn=crawl`: fire travels around the card and consumes it inward; 700 ms, 3.5 rem vertical fan padding.
- `/shop?variant=C&burn=drip`: a flame front consumes the card downward, shedding ash; 1000 ms, 3.8 rem padding. This is the default.
- `/shop?variant=C&burn=ash`: a slower burn breaks the selected card into fragments; 1300 ms, 4.2 rem padding.

Only the selected category card burns, in its original position in the hand. The item hand appears after that card has completely disappeared. Back or Escape cancels the transition. Reduced motion skips the burn and opens the category immediately. Tilted corners, hover lift, focus outlines, flames, and ash must fit inside the fan's padded scrolling area.

Verdict: C's layout is accepted; the burn treatment is still open for player review. These remain disposable, in-memory UI experiments on `codex/prototype-shop-wheels`, tracked by [implementation issue #38](https://github.com/dutycaws/ByRookAndCrook/issues/38). Purchases remain mock-only. Screenshots are saved outside the repository in `/tmp/rook-shop-ember`.

Verification: Svelte check passes with zero errors and warnings. Root inspected the rendered prototype at 1644×1188, 1280×720, and 390×844; reviewed all three burns, category-to-item sequencing, seed-hand clipping, horizontal keyboard panning, Escape cancellation/focus restoration, expansion affordability, and a mock seed order (26 → 24 gold, stock 10 → 9). Reduced-motion behavior was checked in source; the browser tool does not expose a media emulation control. No tests or screenshot files were added to the repository.
