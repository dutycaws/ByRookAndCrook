# Concept-art UI specification

Issue [#6](https://github.com/dutycaws/ByRookAndCrook/issues/6) translates the supplied concept art into a responsive Svelte UI. The reference is preserved unchanged at [`docs/reference/CozyTavernConceptArt.png`](../reference/CozyTavernConceptArt.png). It guides composition, density, materials, and hierarchy; it is never rendered as a page background.

## Common-room composition

At widths of 1,180 pixels and above, the Bar uses three live regions in an approximately 18/59/21 split:

| Region | Contents | Source of truth |
| --- | --- | --- |
| Tavern status | Day, gold, available drinks and food, recent service, restocking routes | Current bar snapshot |
| Tavern scene | Selected patron scene and the latest completed reply | Patron catalog and journal |
| Guest inspector | Patron selection, relationship, current intention, risk, authored context, hospitality counts | Current bar snapshot and NPC journal |

The conversation composer spans the full dashboard below those regions. Its parchment text field, explicit intent-card tray, and food/drink picker remain three separate controls. The selected intent characterizes the keeper's words. The optional hospitality selection points to real inventory and is consumed only with a committed reply.

Standalone serving, day close, and hospitality history remain below the dashboard. They preserve the existing action IDs, expected revisions, frozen retry commands, and server-side atomicity.

## Visual language

- Ebony and warm brown surfaces provide the base; thin brass rules define hierarchy.
- Cinzel is reserved for names, navigation, section labels, and consequential actions. EB Garamond carries dialogue and descriptive copy.
- Patron art owns the largest uninterrupted area. Opaque black-brown backing keeps all overlaid dialogue readable.
- Intent cards use distinct restrained hues and pressed states. Every card is a real button with `aria-pressed`; color is supplemental.
- Parchment is limited to the keeper's text input so it reads as a writable object.
- Icons in the primary navigation are inline SVG. No placeholder emoji is used in the rebuilt shell.
- Keyboard focus uses a three-pixel gold outline. Reduced-motion preferences remove nonessential transition time.

## Responsive behavior

| Target | Layout |
| --- | --- |
| 1,672 × 941 | Full three-column dashboard and full-width composer, matching the supplied reference's working frame. |
| 1,440 × 900 | Full three-column dashboard with a viewport-relative scene height. |
| 768 × 1,024 | Scene first, composer second, guest and status rails below in two columns. The primary navigation stays on one horizontally scrollable row. |
| 390 × 844 | Scene first, composer second, guest information third. The status rail is omitted because the guest and composer actions have priority; the same values remain available on wider layouts. Intent cards scroll horizontally. |

The automated visual-layout journey verifies the desktop proportions, full-width composer, primary Bakery destination, separate Pantry destination, distinct intent and hospitality controls, and absence of horizontal page overflow at all four targets.

## Review evidence

- **Before:** [`docs/screenshots/bar-before.png`](../screenshots/bar-before.png) records the prior stacked panel layout.
- **After, reference width:** [`docs/screenshots/bar-1672.png`](../screenshots/bar-1672.png) records the complete wide dashboard.
- **After, desktop:** [`docs/screenshots/bar-1440.png`](../screenshots/bar-1440.png) records the common desktop target.
- **After, tablet:** [`docs/screenshots/bar-768.png`](../screenshots/bar-768.png) records the reordered tablet layout.
- **After, mobile:** [`docs/screenshots/bar-390.png`](../screenshots/bar-390.png) records the compact mobile layout.
- **Annotated comparison:** [`docs/screenshots/bar-comparison.png`](../screenshots/bar-comparison.png) labels the old panel layout and new scene-led hierarchy side by side.

The screenshots contain seeded test-save values. They do not introduce player-visible XP, reputation, tasks, or levels that the game does not yet support.

## Fixed-camera area scenes

Issue [#7](https://github.com/dutycaws/ByRookAndCrook/issues/7) extends the Bar direction into a fixed-camera layered scene contract for Garden, Brewery, and Bakery. The three supplied references are preserved unchanged and used only for composition, material, palette, and lighting:

| Area | Reference | SHA-256 |
| --- | --- | --- |
| Garden | [`CozyTavernConceptArt2.png`](../reference/CozyTavernConceptArt2.png) | `06925a9fb1eb1603a3f237c54419701f62c11882f181a1d66a9ae5acc8816b8b` |
| Brewery | [`CozyTavernConceptArt3.png`](../reference/CozyTavernConceptArt3.png) | `9ae79901a389c228751c828649561f3e982aeda78019e60cbfe4211adce6c2ee` |
| Bakery | [`CozyTavernConceptArt4.png`](../reference/CozyTavernConceptArt4.png) | `67f9219290374363de2dd156ff1f83556bb94c2906e2e74546068ddacfb239c0` |

The runtime never loads these screenshots as page backgrounds. Their hands, interface text, meters, tasks, card decks, costs, helper chat, watering, fertilizer, heat, foam, and steam controls are reference-only material.

### Coordinate and crop contract

Every scene asset uses a `1672 × 941` design coordinate space with `(0, 0)` at the upper-left. Camera pan, camera zoom, parallax, and camera shake are prohibited. The application scales all layers together and crops from these fixed rectangles:

| Target | Source crop | Intended viewport |
| --- | --- | --- |
| Desktop work scene | `x 220, y 0, w 1232, h 941` | Approximately 1.40:1 central scene between live rails |
| Tablet work scene | `x 83, y 0, w 1506, h 941` | Approximately 1.60:1 scene-first layout |
| Phone work scene | `x 208, y 0, w 1256, h 941` | 4:3 scene before primary controls and details |

The source rectangles are canonical. Responsive rendering must not drift `object-position` independently per layer. Decorative rails move below the action on narrow screens; the scene and its accessible interaction stay first.

The versioned machine-readable form of this contract is [`static/assets/scenes/motion-proof-contract.json`](../../static/assets/scenes/motion-proof-contract.json). Coordinates below refer to that file.

### Garden direction

The Garden keeps the established pointy-top odd-row grid and saved coordinates. Its future illustrated scene uses a high three-quarter fixed camera over an enclosed kitchen garden. Stone-edged beds converge around the lower-middle selection area; hives, trellises, damp soil, labels, and dense planting provide depth without changing the playable plot geometry.

| Property | Direction |
| --- | --- |
| Primary focus | Selected plot near reference `(640, 470)`; neighboring bonus relationship remains visually readable |
| Scene coordinates | Environment `0, 0, 1672, 941`; interactive board `315, 76, 1005, 679`; selection-safe region `430, 250, 760, 450`; apiary anchor `(1105, 235)` |
| Palette | Moss `#344224`, leaf `#718843`, damp earth `#2a1b0f`, stone `#5e5842`, brass `#aa7830` |
| Lighting | Late-afternoon gold from upper left with a deep edge vignette |
| Mobile framing | Preserve the selected plot and its actual adjacent plots; move details below rather than shrinking touch targets |
| Excluded mechanics | Water, fertilizer, soil nutrients, tasks, helper chat, and card costs shown by the reference |

Issue #7 supplies the camera and art direction only. Complete Garden environment and plot-state artwork belongs to issue #12.

### Brewery layer and motion contract

The Brewery uses a large copper vat centered in a dark timber cellar. Copper highlights, the amber wort, and fire remain distinct; no global brown filter may flatten those materials. The canonical environment contains no hand, paddle, interface, text, or brand emblem.

| Z | Layer | Design bounds | Purpose |
| ---: | --- | --- | --- |
| 0 | `brewery-environment.webp` | `0, 0, 1672, 941` | Opaque fixed room, vat, hearth, shelves, barrels, and practical lighting |
| 2 | `brewery-wort-surface.webp` through `brewery-wort-mask.webp` | `445, 345, 782, 235` | Constrains all procedural liquid response to the vat opening |
| 3 | `brewery-paddle.webp` | Native `184 × 570`; local immersion anchor `(92, 520)` | One generated cutout traveling the input path; no generated intermediate frames |
| 4 | `brewery-cauldron-foreground-rim.webp` | `400, 450, 875, 355` | Restores front-rim and vat-body occlusion over the paddle and wort |
| 5 | Live UI | Scene overlay | Existing progress, state, input, retry, and accessible controls |

The paddle immersion anchor travels an ellipse centered at `(836, 500)` with radii `(205, 45)`. Rotation is limited to `−12°…12°`. Pointer or keyboard motion drives the same normalized input; after movement ends, speed and visual response decay to rest over 300 milliseconds. The wort may translate internally by at most three pixels and vary highlight opacity by at most eight percent. It cannot escape its alpha mask.

Normal idle, completion, and reduced-motion views use the same paddle at its static rest pose and a still wort surface. Active motion repositions the cutout and applies a bounded masked swirl. No gameplay state is encoded in a newly generated frame.

### Bakery layer and motion contract

The Bakery holds one fixed view of a soot-dark stone oven. The preferred broad foreground workbench returns as a removable preparation layer, preserving its original full-width composition while still allowing the surface and dough to disappear for the existing oven phase. Fire orange, flour, dough, stone, and timber retain distinct material values.

| Z | Layer | Design bounds | Purpose |
| ---: | --- | --- | --- |
| 0 | `bakery-environment.webp` | `0, 0, 1672, 941` | Opaque fixed oven room without hands, bread, tools, UI, or text |
| 1 | `bakery-preparation-surface.webp` | `0, 550, 1672, 391` | Removable full-width oak workbench for folding, scoring, and ready phases |
| 2 | `bakery-dough-shadow.webp` | `596, 605, 480, 250` | Stable contact shadow independent of the dough texture |
| 3 | Rest, active-fold, or confirmed-fold dough | `596, 535, 480, 250` | Three matching poses cropped from one canonical generated pose sheet |
| 4 | `bakery-score-groove-01.webp` | `596, 535, 480, 250` | First confirmed score overlay; it is never painted into a replacement loaf |
| 5 | `bakery-scoring-tool.webp` | Native `310 × 70`; blade-tip anchor `(8, 35)` | One generated tool cutout following the score gesture |
| 6 | Live UI | Scene overlay | Existing phase, timer, retry, and accessible action controls |

The proof fold begins with `bakery-dough-rest.webp`, uses `bakery-dough-fold-active.webp` during direct manipulation, and settles once into `bakery-dough-fold-confirmed.webp` over 260 milliseconds. Scale deformation is limited to eight percent and rotation to `−3°…3°`. The scoring tool's blade-tip anchor remains within `x 606…1066, y 535…760` and follows one bounded 260-millisecond stroke. The first groove appears only after the accepted scoring action.

Reduced motion switches directly to the current confirmed pose and uses an immediate tool position. It does not substitute unrelated artwork. Full six-fold, three-score, oven-color, and finished-loaf production sets remain owned by issue #11.

### Interaction and accessibility boundary

The artwork is presentational. Existing server actions, immutable command IDs, revisions, persistence, quality, rewards, and retry behavior remain the authority. Scene animation consumes a normalized view of real interaction state; it does not create another gameplay state machine.

- The real input target remains an accessible DOM control with a visible three-pixel gold focus ring.
- Keyboard input produces the same logical progress and recognizable material state as pointer input.
- Per-phase still compositions remain understandable when images fail, reduced motion is requested, or animation is unavailable.
- Generated assets contain no hands, player identity, hidden story data, gameplay numbers, text, meters, or controls.
- Source PNG masters remain outside `static`; only optimized WebP derivatives and the JSON contract ship to the browser.

### Motion-proof review evidence

- [`motion-assets-brewery.jpg`](../screenshots/motion-assets-brewery.jpg) verifies the paddle behind the generated front-rim occluder in the fixed Brewery camera.
- [`motion-assets-bakery.jpg`](../screenshots/motion-assets-bakery.jpg) verifies the full-width preparation workbench, shadow, confirmed dough, scoring tool, and groove in the fixed Bakery camera.
- [`motion-asset-contact-sheet.png`](../screenshots/motion-asset-contact-sheet.png) shows the two assembled scenes and each alpha cutout against a checker field.

These images prove layer compatibility and art direction. Interactive motion, rapid reversal, display-density checks, and demonstration clips remain the acceptance work of issue #8.
