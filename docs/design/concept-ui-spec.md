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
