# Scene-first shop and shared card effects

Implemented on the original `codex/issue-35-relationship-garden` branch, using the accepted Shop C ember-hand prototype as the visual reference.

- Elara's scene anchors the shop. Category and item cards form the hand, with airy 4.2 rem padding. Garden expansion belongs with garden-care goods.
- Category selection burns the selected category. Item selection burns its siblings and expands the selected item into inspection.
- Live purchases and expansions retain server previews, quantities, stock validation, revision checks, idempotent retries, and receipts. The inspection burns only after a confirmed success; failed orders retain inspection and retry state.
- Social cards burn only after a completed turn. The effect uses a frozen snapshot of the played card while the authoritative hand refreshes. Siblings remain visible; stacked items consume one backing item.
- `CardBurnSurface` and `CardBurnEffect` provide the shared full-face erosion, flame, and ash visuals. Random resolves one treatment and its duration per action. Crawl (700 ms), Drip (1000 ms), and Ash (1300 ms) retain their accepted speeds.
- Card burn effect is saved per user in Settings → Profile. Both routes load the verified user's preference; missing or invalid values use Drip. Live routes have no prototype variants or browser-wide preference.
- Reduced motion skips the visual delay. Cancellation suppresses stale presentation completions; no visual timer dispatches a transaction.

Validation and local screenshots are recorded after final rendered review.

## Verification

- Existing bar/hand/runtime-asset unit suites: 21 tests passed.
- Effect helpers and generated-supply units: 26 tests passed, covering profile defaults, all treatment durations, random selection, cancellation, timer cleanup, and immediate reduced-motion completion.
- Shop stock and service-card talk integration suites: 4 tests passed against isolated test players in local Supabase.
- Profile preference was saved through the real form. Live social play used Ash at 1300 ms for the exact completed turn/card UUID; the first Charm stack fell from two to one and a second completed play depleted its remaining unit.
- Mobile social flow was inspected at 390 × 844 without page overflow. Journal Escape restored focus to its opener.
- Secret audit passed. Screenshots stay under `/tmp/rook-live-ember/`, outside Git.

The Shop journey assertions now use category → item hand → inspection navigation rather than the retired Art6/Art8 columns. The full automated browser suite has not been rerun; rendered checks use the in-app browser.

## Rendered shop review

- Desktop 1280 × 820: category cards, Garden Care hand, sibling burns, Soil builder inspection, confirmed-order burn, real receipt, and keyboard return were inspected in the browser. Soil builder cost 8 gold: balance changed from 26 to 18, stock from 5 to 4, and owned quantity from 0 to 1.
- Quantity edits now invalidate the previous preview immediately and compare the preview payload with current selection and quantity. Two Soil builders previewed 16 gold; five previewed a disabled 40-gold order with a 22-gold deficit. A stale buy total is never actionable while the new preview is loading.
- The 16-plot expansion remained usable with insufficient gold and returned focus to its card through Escape. Both capacity tiers retain database integration coverage; the live player's garden was not expanded during visual review.
- Desktop hands overlay the full-width shop scene. At 390 × 844, cards scroll within a generously padded hand and inspection follows the scene. No document-level horizontal overflow occurred, and purchase/back controls remained reachable.
- Provisions are a secondary destination. Its empty state and Escape return were inspected; this player's provision catalog was empty, so its new purchase animation has source review and existing business/helper coverage rather than a live visual purchase capture.
- Confirmed purchases retain their authoritative receipt if refreshing stock fails. Further ordering is disabled until the user refreshes the shop.
- Scene navigation updates immediately; card deal/zoom/burn motion supplies feedback without a full-document view transition blocking the next input.
- Saved Random was restored after deterministic Ash verification.

Local screenshot evidence: `shop-before.png`, `shop-after.png`, `shop-items.png`, `shop-inspection.png`, `shop-order-burn.png`, `shop-receipt.png`, `shop-mobile.png`, `shop-mobile-inspection.png`, `bar-before.png`, `bar-after.png`, `social-burn.png`, `bar-mobile.png`, and `profile-after.png`, all under `/tmp/rook-live-ember/`.

Final `npm run check` completed with 0 errors and 0 warnings. `npm run build` completed successfully.
