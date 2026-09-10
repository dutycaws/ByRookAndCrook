# Shared crafting scene framework

Issue [#9](https://github.com/dutycaws/ByRookAndCrook/issues/9) extends the Bar’s status / dominant scene / inspector rhythm to Garden, Brewery, and Bakery. It introduces a reusable presentation boundary without changing a database schema, server action, command, reward, timer, or retry path.

## Ownership boundary

The route controller continues to own its `GameSnapshot`, named form actions, save revision, action IDs, retry state, clocks, and outcomes. Each route derives a small render-only projection:

- `GardenVisualState` exposes plot identity, odd-r coordinates, crop kind and stage, selection, readiness, and presentation status.
- `BrewVisualState` exposes phase, the minimum session identity needed for display, bounded agitation, pending state, and an error message.
- `BakeVisualState` exposes phase, fold/score counts, and the projection of the authoritative oven start time into an elapsed display.

These projections omit save revisions, ingredient bonuses, scoring points, command payloads, rewards, receipts, and mutable snapshots. The callback types in `src/lib/presentation/scene.ts` carry only plot selection, normalized stir speed, or a completed fold/score gesture back to the controller.

## Components

| Component | Responsibility |
|---|---|
| `CraftingSceneLayout` | Shared status rail, central scene, contextual action strip, and inspector composition. |
| `SceneRail` | Semantic status or inspector frame in the existing dark wood and brass language. |
| `ContextualActionStrip` | Phase instruction, live status, and the current reachable action. |
| `IllustratedActionButton` | A 48 px semantic button with loading, disabled, focus, and reduced-motion behavior. |
| `AreaScene` | One 1,672 × 941 design plane, ResizeObserver scaling, phone center crop, visibility signal, reduced-motion signal, and static fallback. |
| `SceneLayer` | An absolute design-space image layer with an actionable fallback for essential missing artwork. |
| `SceneActionSurface` | A semantic design-space hit area for later illustrated scene interactions. |

The Brewery and Bakery motion proofs now render inside `AreaScene`, so the environment, masks, paddle, wort, workbench, dough, and gesture surface all share one transform. Garden uses the same plane around its existing odd-r hex grid. Garden grid sizing scales both each hex and its coordinate projection together; it does not transform only the tile art or hit area.

## Responsive behavior

- At 1,672 × 941 and 1,440 × 900, the layout shows status rail, dominant scene, and inspector in three columns, with the contextual action strip attached below the scene.
- At 768 × 1,024, the scene and active action come first. Inspector and status remain reachable below them.
- At 390 × 844, the scene uses a central 4:3 crop rather than shrinking the whole wide composition. The action and inspector follow, and status moves into a native `details` disclosure.
- The application clips accidental shell overflow while retaining the header’s horizontal area navigation on compact screens.
- Garden plot targets remain at least 44 × 44 CSS pixels on the phone layout. Buttons elsewhere use a minimum 48 px height.

All labels, buttons, meters, selected states, errors, outcomes, and stage counts remain DOM semantics. Artwork is decorative unless it carries an explicit scene label. Reduced motion removes decorative interpolation without removing state changes. `AreaScene` reports visibility but never advances or pauses a game clock. Brewery’s physical input clears when hidden; server-backed Brewery and Bakery elapsed time remains route-owned.

## Asset lifecycle and failure behavior

SvelteKit’s route chunks load only the scene components imported by the active area. The scene framework defines a maximum of 40 decorative particles for later bounded procedural effects; the current framework adds none. `AreaScene` disconnects its `ResizeObserver` and media/visibility listeners on teardown. Existing motion components cancel their animation frames and timers.

An essential `SceneLayer` that fails to load is replaced by a labeled, actionable static panel. Nonessential layers disappear without blocking semantic controls. Setup, blocked, empty, ready, and result phases already render as static semantic route content when no animated scene is needed.

## Verification

`tests/unit/scene-presentation.test.ts` verifies phase derivation, geometry preservation, bounds, and omission of authoritative state. `tests/e2e/crafting-layout.test.ts` checks all three routes at the four target viewports, semantic rails and actions, layout order, overflow, keyboard selection, touch-target size, and reduced motion. `tests/e2e/motion-proof.test.ts` checks the shared scene plane under active Brewery and Bakery motion and deliberately aborts an essential scene image to verify the fallback.

The complete Garden, Brewery, and Bakery production illustrations remain owned by issues #10–#12. Those tickets should compose `SceneLayer` and `SceneActionSurface` within this framework and continue passing state through the narrow view contracts.
