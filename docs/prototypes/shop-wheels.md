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
