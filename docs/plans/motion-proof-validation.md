# Layered 2D motion proof validation

Issue [#8](https://github.com/dutycaws/ByRookAndCrook/issues/8) validates the highest-risk Brewery and Bakery interactions before the shared scene framework and production scenes are expanded. The proofs use the canonical assets prepared by issue #7 and the existing route controllers, form actions, Supabase commands, scores, inventory, and timers.

## Architecture handoff

`BreweryScene.svelte` and `BakeryScene.svelte` are presentation components. They own transient pointer state, animation phase, and visual feedback. They do not own a brew session, bakery session, score, reward, item, or save revision.

The route remains the authority for persisted gameplay:

- Brewery reports one normalized speed through `onspeed`. The route samples that value into the existing scoring window and submits the existing completion command.
- Bakery reports a completed `fold` or `score` gesture through `oncommit`. The route freezes its existing idempotent form command and submits it to the existing server action.
- Pointer cancellation clears transient presentation state and commits nothing.
- Keyboard controls invoke the same route commands. Reduced motion removes pose interpolation while preserving the state change and visible feedback.

Reusable motion math lives in `src/lib/game/scene-motion.ts`. It is deterministic and independent of Svelte or the database. The circular stirring implementation normalizes the liquid ellipse, unwraps the angle seam, rejects samples inside the dead zone and non-positive time deltas, reanchors after a long gap, smooths velocity over 120 ms, clamps the result to 0–100, and decays to rest over 400 ms. A half revolution per second maps to speed 50 in either direction.

## Asset and occlusion contract

Both scenes use a fixed 1,672 × 941 design plane and scale the whole plane together. Asset anchors and allowed transforms remain those recorded in `docs/design/asset-manifest.md`.

The Brewery stack is:

1. Brewery environment
2. Wort and liquid response
3. Paddle, rotating around the authored grip anchor
4. Foreground rim/mask, which hides the immersed paddle section
5. Non-interactive scene shade and interaction hint

The Bakery stack is:

1. Bakery environment
2. Full-width preparation surface
3. Dough contact shadow
4. One of the compatible rest, active-fold, or confirmed dough poses
5. Score groove and scoring tool
6. Non-interactive scene shade and interaction hint

The proof animates transforms and canonical matching poses. It does not interpolate separately generated frames. Future scene work should preserve this order and promote these components rather than recreating their input logic.

## Review findings

| Check | Result |
|---|---|
| Normal clockwise stirring | Paddle follows the normalized ellipse, liquid phase follows the same speed, and the rim preserves immersion. |
| Counterclockwise reversal | Seam unwrapping keeps reversal bounded; the speed never exceeds 100. |
| Repeated release and idle | Pointer release and an idle held pointer both decay to zero within the 400 ms release window. |
| Fold and settle | The active dough transform follows the drag, then gives way to the compatible confirmed pose after one committed fold. |
| Scoring stroke | The anchored scoring tool follows a bounded path and one server-confirmed groove remains after release. |
| Keyboard and reduced motion | Both interactions remain operable by labeled buttons; reduced motion removes interpolation without hiding the resulting state. |
| Responsive scaling | The same design plane and anchors remain aligned at desktop and phone widths at 1× and 2× density. No horizontal page overflow was observed. |
| Visual defects | No tool clipping, rim-order failure, pose lighting mismatch, texture shimmer, or frame-slideshow behavior was observed in the recorded proof runs. |

The generated evidence is checked into `docs/screenshots/motion-proofs`:

- [Brewery desktop 1×](../screenshots/motion-proofs/brewery-desktop-1x.png) and [2×](../screenshots/motion-proofs/brewery-desktop-2x.png)
- [Brewery phone 1×](../screenshots/motion-proofs/brewery-phone-1x.png) and [2×](../screenshots/motion-proofs/brewery-phone-2x.png)
- [Bakery fold desktop 1×](../screenshots/motion-proofs/bakery-fold-desktop-1x.png)
- [Bakery score desktop 2×](../screenshots/motion-proofs/bakery-score-desktop-2x.png)
- [Bakery score phone 1×](../screenshots/motion-proofs/bakery-score-phone-1x.png) and [2×](../screenshots/motion-proofs/bakery-score-phone-2x.png)
- [Brewery interaction clip](../screenshots/motion-proofs/brewery-demo.webm)
- [Bakery interaction clip](../screenshots/motion-proofs/bakery-demo.webm)

Regenerate this evidence against a running local stack with:

```bash
npm run motion:proof:capture
```

The capture script creates isolated test players and removes them after capture. `tests/unit/scene-motion.test.ts` covers guided pointer timing, direction, grace, keyboard beats, persistence, and reduced-motion scoring. `tests/e2e/motion-proof.test.ts` covers pointer and keyboard guide paths, hidden-time and reload recovery, fold and score commits, reduced motion, mobile scaling, and page overflow.

## Production handoff

Issue #9 can wrap these proofs in the shared scene layout without moving route state into presentation components. Issue #10 owns promotion of the complete Brewery scene and exact stirring behavior. Issue #11 owns the full six-fold, three-score, oven, and result sequence. The current Bakery proof deliberately exercises one fold and one score while the existing route still supports the complete progression.
