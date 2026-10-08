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

The player selected C's bottom card hand and accepted all three burn styles with their existing speeds. Airy padding is now fixed at 4.2 rem for every style. This iteration explores carrying that visual language through category selection, item inspection, and mock ordering while keeping Elara and the shop scene prominent.

Compare three treatments within C using the visible burn controls and the `burn` query parameter:

- `/shop?variant=C&burn=crawl`: fire travels around the card and consumes it inward; 700 ms.
- `/shop?variant=C&burn=drip`: a flame front consumes the card downward, shedding ash; 1000 ms. This is the initial default.
- `/shop?variant=C&burn=ash`: a slower burn breaks the selected card into fragments; 1300 ms.

The user-facing Card burn style control saves a client-side visual preference. Only the preference persists; purchases and game values remain in memory. Query overrides remain available for shared prototype review.

The selected category card burns in its original hand position before the item hand appears. Selecting an item burns the other item cards together, then expands the selected item into inspection. Mock Order burns that inspection before the result appears. Back or Escape cancels a pending transition and restores its opener; canceled orders do not spend gold or stock. Reduced motion skips burns and expansion delays. Tilted corners, hover lift, focus outlines, flames, and ash fit inside the hand's fixed airy padding.

Verdict: C's layout, all three burn treatments/speeds, and airy padding are accepted. The deeper flow is still a disposable UI experiment on `codex/prototype-shop-wheels`, tracked by [implementation issue #38](https://github.com/dutycaws/ByRookAndCrook/issues/38). Purchases remain mock-only. New screenshots are saved outside the repository in `/tmp/rook-shop-flow`; the earlier comparison evidence remains in `/tmp/rook-shop-ember`.

Earlier burn-comparison verification: Svelte check passed with zero errors and warnings. Root inspected the rendered prototype at 1644×1188, 1280×720, and 390×844; reviewed all three burns, category-to-item sequencing, seed-hand clipping, horizontal keyboard panning, Escape cancellation/focus restoration, expansion affordability, and a mock seed order (26 → 24 gold, stock 10 → 9). Reduced-motion behavior was checked in source; the browser tool does not expose a media emulation control. No tests or screenshot files were added to the repository.


### Accepted flow and burn preference follow-up

Keep Crawl (700 ms), Drip (1000 ms), and Ash (1300 ms), with airy 4.2 rem hand padding for every treatment. The toolbar exposes a saved client-side Card burn style preference. Random chooses one treatment per action; sibling cards share that treatment and duration. Explicit valid `burn` queries override the saved preference for previewing, including `burn=random`.

The selected category burns before its item hand opens. Selecting an item burns its siblings, then expands the selected card into inspection. The inspection itself burns before a mock-order result appears. Back, Escape, and preference changes cancel pending work; canceled orders do not spend mock gold or stock. Burned siblings remain hidden and out of the tab order through inspection and result.

Final desktop review confirmed sibling hiding, full inspection erosion, and result accounting (Soil Builder: 26 to 18 gold, stock 5 to 4). Escape restored item/order focus and canceled an order without spending. Phone review at 390 × 844 confirmed no page-level horizontal overflow and computed hand padding of 67.2 px. Reduced-motion paths were reviewed in source; browser media emulation was unavailable. Screenshots are local only in `/tmp/rook-shop-flow/`. Random preference verification follows below.

Random was verified after reload and through all three levels: one run resolved Crawl/700 ms for the category, Drip/1000 ms consistently across all four sibling cards, and Ash/1300 ms for the order. Changing style during an item burn canceled selection and restored the selected-item focus. Garden expansion remained inspectable with the unaffordable order disabled. `npm run check` passed with zero errors and warnings; whitespace, secret, and staged-media checks passed before publication.
