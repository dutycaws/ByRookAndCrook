# Restore the Art6 Shop opening view and animate item details

## Outcome and design decisions

The Shop opens with the composition in **CozyTavernConceptArt6.png**: supported shop status on the left, one large coherent scene of Elara at her counter in the center, and shopkeeper identity plus illustrated goods on the right. No empty item-detail column appears on entry.

Selecting a good animates into the earlier Art8 commerce composition: a compact merchant scene on the left, goods in the middle, and purchase details on the right. Closing details reverses the transition. **The owner explicitly selected this Art6-to-Art8 transition**; do not substitute a drawer over the Art6 opening layout.

This plan supersedes only the always-visible Shop detail layout from [#23](https://github.com/dutycaws/ByRookAndCrook/issues/23). Preserve its automatic purchase previews, expansion detail, error states, receipts, stock, and retry behavior. Garden camera work is outside this plan.

Do not introduce reputation, shop levels, daily tasks, relationship scores, dialogue, selling, advice, notifications, new goods, or new prices simply because the reference depicts them. Use concise labels and values supplied by the current game.

### Local references

| Reference | Purpose |
| --- | --- |
| `/home/hosm/Projects/CozyTavernConceptArt6.png` | Authoritative opening composition and Elara appearance. |
| `/tmp/codex-clipboard-94744de3-9d43-4a37-8e02-3c0796d55457.png` | Reported defect: shelves above a separate rectangular Elara image, plus an empty standing detail column. |
| `CozyTavernConceptArt8_BrowseDetail.png` | Expanded merchant / goods / purchase-detail hierarchy. |
| `CozyTavernConceptArt8_InsufficientGold.png`, `CozyTavernConceptArt8_OutOfStock.png`, `CozyTavernConceptArt8_PurchaseComplete.png` | Existing transaction-state visual direction. |

Reference images and the supplied screenshot remain local. Do not upload, embed, or commit their source bytes. Runtime artwork follows the repository's existing derivative workflow.

## Current implementation and repair boundary

The implementation entry point is `src/lib/components/shop/ShopMarket.svelte`; the Shop route is a thin wrapper. The current `.shop-layout.art8-layout` always reserves merchant, catalog, and detail columns. `detailMode = null` still renders **Garden ledger / Choose a good** in the right column. Selection changes that column's contents without changing the layout.

The merchant frame combines an opaque 1,672 × 941 environment with an opaque 680 × 528 Elara crop. The crop uses `object-fit: contain`, bottom alignment, and additional scaling inside a tall, narrow frame. Its uncovered upper area exposes a different background; its lower rectangle has its own background. This is a compositing and container-aspect defect, not a failed image request. The existing 280 × 280 circular-portrait source is not currently displayed.

Keep `ShopMarket` as the sole owner of selection, category, quantity, previews, action IDs, pending commands, expansion return state, and receipts. Extract presentational scene/status/catalog/detail components only to keep the revised template manageable; do not duplicate purchase controllers or forms between visual layouts. No database, RPC, pricing, inventory, or stock-contract changes are needed.

Existing uncommitted Shop and test changes are the starting point. Read and extend them rather than restoring a previous ticket's implementation.

## Opening composition and artwork

### Desktop layout

At viewport widths of **1,200 CSS pixels and above**, use the available page width below the existing navigation, with a 16px outer inset and 12px panel gaps. Keep the header, branding, and area navigation unchanged.

| Region | Opening view | Expanded detail view |
| --- | --- | --- |
| Left | Shop status, approximately 18% of usable width | Compact merchant scene, approximately 24% |
| Center | Elara counter scene, approximately 58% | Catalog, approximately 42% |
| Right | Shopkeeper identity and catalog, approximately 24% | Item or expansion detail, approximately 34% |

Use `minmax(0, …)` tracks to prevent intrinsic text widths from expanding the shell. Panels align at their upper edge. Remove the current large top gap and the empty **Choose a good** panel. Match Art6's dark timber, thin brass frames, warm lighting, and restrained cream/gold typography.

- **Status:** show Gold, Garden capacity, and the next expansion's capacity/price with **Expand garden**. If expansion is exhausted, show **Garden at full capacity**. Do not fill unused space with invented status modules.
- **Hero:** display one integrated Elara-at-counter image, with her face, hands, counter, and surroundings visible. Do not overlay an opaque merchant rectangle on another room image. No marketing heading, quote, dialogue box, or empty ledger sits above the image.
- **Catalog:** place the existing circular portrait beside **Elara Greenbloom** and **Shopkeeper**, above All / Seeds / Garden / Apiary filters. Keep the identity block compact. Tiles show a recognizable illustration, item name, price, and concise stock badge. Use four columns from 1,600px upward and three between 1,200px and 1,599px; the expanded catalog uses four columns. Allow the goods list to scroll within the rail while keeping its filters reachable. Keep at least three tile rows visible at the target desktop viewports.
- **Expanded view:** move Gold and a compact **Expand garden** control into the catalog header while the full status rail is hidden. Do not duplicate accessible controls. The circular identity treatment belongs above the compact merchant scene rather than repeating above the expanded catalog.

### Correct the image composition before final visual approval

Create a **new versioned, UI-free 4:3 scene derivative** rather than overwriting the existing Elara crop or pretending it has transparency. Use the image-editing/outpainting workflow with the current Art6 reference to produce a single coherent 1,200 × 900 master composition containing Elara, her hands, the counter, and surrounding shop; remove interface frames, lettering, dialogue, and numerical overlays. Extend the surrounding shop and counter to achieve the target ratio instead of stretching the reference or cropping away the required character framing. Preserve the supplied character's face, hair, clothing, and pose. This requires a newly edited composition, not a crop-only export. Do not use CSS to extend the image with a second unrelated room plate.

The current reference is **1,666 × 730 RGBA**, SHA-256 `21cdb0728f337c8864b19aaf081529f4d2d8653ea6fe2413f9e6080eb2541085`. It differs from the historical 1,672 × 941 reference recorded as `design-reference-cozy-tavern-art-6@b3429ddfcb61`. Ingest it as a new source revision and preserve the older record. Follow `docs/design/media-lifecycle.md` and the asset manifest; link the new optimized WebP derivative to its actual source master and update dimension/checksum validation. Keep each runtime raster within the existing 500,000-byte ceiling and existing aggregate media budgets.

Use the new scene as the single image in both large and compact merchant presentations. Render it at its natural 4:3 ratio with uniform scaling and explicit framed space if the surrounding panel is taller. Do not stretch it independently on each axis, bottom-anchor it in a tall empty frame, or place another scene above it. The hero remains centered and visually coherent during layout changes. Reuse `elara-portrait.webp` for the small circular identity image, centered without distortion.

Replace tiny category glyphs as the primary product illustrations with optimized, UI-free art mapped to existing SKUs. Reuse suitable reviewed runtime illustrations; where none exists, create a matching derivative for the existing item, without adding merchandise. Use the same SKU illustration in its tile, detail pane, and receipt. Keep text and an accessible fallback icon when artwork fails. Do not generate new expressions or character animation for this task.

## Interaction, transition, and transaction behavior

Derive the layout from the existing `detailMode`: `null` means the Art6 opening view; `item` or `expand` means the expanded commerce view. Animation progress must not become transaction state.

| Event | Required result |
| --- | --- |
| Enter Shop with no active transaction | Art6 opening view, All filter, no selected item or blank detail surface. |
| Select a good | Record its key immediately, highlight the tile, set quantity to one, open details, and request the existing authoritative preview. |
| Select another good while detail is open | Keep the expanded layout; change only selection/details and invalidate the old preview. Do not replay the full layout transition. |
| Change quantity | Remain expanded; invalidate/reload the preview. Only the latest permitted preview enables **Buy for X gold**. |
| Back to goods or Escape from ordinary detail | Return to Art6, preserving category and catalog scroll position; restore focus to the originating tile. |
| Change category | Clear item detail and return to Art6 with the selected category and focus on its filter. |
| Expand garden | Use the same expanded detail surface and existing capacity/preview rules; remember the previous category, item, and scroll position. |
| Leave expansion | Restore the preceding product detail if one existed; otherwise restore the Art6 view and expansion trigger. |
| Purchase succeeds | Show the existing focused parchment receipt using confirmed receipt values. |
| Buy another | Close the receipt into the expanded detail for the same item, quantity one, with a fresh action ID and preview. |
| Continue shopping | Close the receipt and return to Art6, preserving the category and catalog position. |

Insufficient gold, sold-out, excess quantity, and capacity messages remain inside the expanded detail surface. They do not open a second error modal or collapse the shop. Pending/failed previews remain visible as concise loading/error states. A failed or unresolved commit retains its action ID, selection, quantity, exact retry path, and existing navigation guard; transitions must never dismiss it or start another purchase.

### Motion and focus

- Opening lasts **240ms**, easing `cubic-bezier(0.22, 1, 0.36, 1)`; closing lasts **180ms**, easing `cubic-bezier(0.4, 0, 1, 1)`.
- Animate the merchant panel moving/contracting toward the left, the catalog moving into the center, and the detail panel appearing from the right with a short fade. The header remains fixed. Use existing Svelte/browser animation facilities; add no animation dependency.
- Keep one live catalog and one detail form. Use a layout measurement/translation transition with clipping and opacity; image content must retain uniform scale. Any temporary decorative animation snapshot is noninteractive and hidden from accessibility. Hidden status/detail controls are not focusable.
- Start the preview concurrently with the visual transition. Do not tie network requests, commits, or action IDs to animation-end callbacks. Do not reuse the command's `pending` flag to mean an animation is running.
- Rapid selection, closing, or resizing settles the current motion to the latest requested layout; no queued choreography or second transaction occurs. Preserve selected input values and current preview generation.
- Move focus to the detail heading when the opening transition finishes, independent of preview completion. Subsequent preview responses must not steal focus. If the selection changes during motion, focus only the latest heading.
- `prefers-reduced-motion: reduce` removes spatial movement and fades; layout and focus change immediately. Keep the same controls, selection indication, and transaction behavior.
- Preserve native receipt-dialog focus containment. Escape acts on the receipt first; it must not also close the underlying detail. Success and failed-request announcements remain concise and separate from decorative motion.

## Responsive behavior

- **800–1,199px:** use a two-region opening view with a compact status strip above, scene on the left and catalog on the right. The scene keeps its ratio. On selection, place full-width details beneath these regions and scroll/focus its heading; retain the scene and catalog rather than squeezing in a third column.
- **Below 800px:** show gold and the expansion control first, with remaining status in a disclosure, then the 4:3 hero, compact shopkeeper identity, filters, and a two-column catalog. Details expand immediately after the catalog. Bring their heading into view without horizontal movement; closing returns to the originating tile and prior scroll position.
- Compact-layout detail reveal uses opacity and a small vertical translation for 180ms, never height-driven animation across the entire catalog. Respect reduced motion. Do not introduce a bottom sheet.
- Use at least 44px interactive targets, visible focus, full item labels without forced truncation, and semantic selected/stock states. The mobile layout may scroll vertically; no page-wide horizontal overflow is allowed.
- Hero or portrait load failure leaves a correctly sized styled frame and Elara's accessible name. Missing illustrations must not hide prices, stock, filters, details, or purchase controls.

## Delivery sequence and ownership

1. **Presentation implementer:** extend the current Shop component with the two layout states, stable catalog/detail ownership, supported status region, navigation/return rules, and responsive structure. Preserve all current command and retry logic.
2. **Art implementer, in parallel:** register the current Art6 revision and prepare the integrated hero plus required existing-SKU illustrations through the asset workflow. Own only source/derivative catalog metadata, runtime artwork, and its validator entries. The presentation work can use the existing merchant crop as a single framed temporary image, never as the final layered composite.
3. **Presentation implementer:** integrate approved derivatives, motion, focus behavior, reduced motion, and error fallbacks. Freeze the state/DOM contract before test updates to avoid duplicate rewrites.
4. **Verification implementer:** update `tests/e2e/shop-journey.test.ts` and focused visual evidence for the new opening/expanded states. Preserve receipt, stock, expansion, and retry assertions. The workflow overseer checks for scope drift and redundant testing throughout implementation.

Workers share the repository: each must preserve others' edits and avoid reverting unrelated changes. This plan itself does not authorize GitHub publication, source-image uploads, deployments, or changes to other scenes.

## Acceptance and verification

- [ ] At 1,666 × 941 and 1,440 × 900, the initial Shop has status left, a dominant coherent Elara counter scene center, and identity/catalog right. No permanent empty detail column remains.
- [ ] Elara's face, hands, counter, and surrounding shop are visible with no shelf/portrait seam, doubled backdrop, stretching, or bottom-stacked rectangle. The small circular portrait is present and correctly centered.
- [ ] Selecting a tile visibly transitions to the merchant / goods / detail composition; the same catalog and selected SKU survive. Closing reverses it and restores category, focus, and scroll.
- [ ] Repeated selection, quantity changes, and delayed/out-of-order previews cannot enable an obsolete purchase or reset a pending action.
- [ ] Insufficient gold, sold-out, excess quantity, successful purchase, lost-response retry, and expansion return paths remain functional in the new layout.
- [ ] Gold stays visible in both modes; quantity, total, stock, and receipt values remain authoritative. Expansion never receives product-stock semantics.
- [ ] At 1,024 × 768, 768 × 1,024, and 390 × 844, hero and catalog remain readable, details are reachable, and the page has no horizontal overflow.
- [ ] Keyboard open/close, category changes, receipt focus, rapid repeated input, resize during transition, reduced motion, and failed artwork all retain usable controls and focus.
- [ ] Initial and final geometry tests are supplemented by visual review of the transition midpoint: no stretched face, detached portrait rectangle, duplicate interactive catalog, or blank flashing frame.
- [ ] No unsupported reference-only mechanics, generic ledger instructions, or new economy behavior were introduced.

Update the existing Shop journey's initial Art8 geometry assertion to distinguish the Art6 opening from the selected-item Art8 state. Keep existing server-behavior coverage rather than adding a second stock test suite. Capture opening, selected detail, insufficient-gold, sold-out, receipt, and return-to-browse stills plus one short opening/closing clip as local ignored evidence; do not upload the supplied references or screenshot.

Run `npm run check`, `npm run art:assets:check`, `npm run test:e2e -- tests/e2e/shop-journey.test.ts`, and `npm run build`. Run the existing media Git check if assets are staged. Broaden transaction testing only if implementation changes transaction code or focused checks expose a regression. Update the Shop composition description in the asset manifest and applicable design documentation so the Art6 opening/Art8 detail distinction is explicit.
