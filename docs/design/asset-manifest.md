# Visual asset manifest

Runtime imagery is stored under `static/assets`. Design references and review evidence stay under `docs` and are not loaded by the application.

| Asset | Kind | Provenance | Runtime purpose |
| --- | --- | --- | --- |
| `docs/reference/CozyTavernConceptArt.png` | 1,672 × 941 PNG | Supplied by the project owner on 2026-09-08. SHA-256 `e488680c402871eccbd5ea5463bd2de9dec97871019210a9239e8d519954d37c`. | Design reference only. |
| `static/assets/scenes/lira-tavern.webp` | 1,672 × 941 WebP, 181 KB | Generated for this project with OpenAI image generation on 2026-09-09, then converted from lossless PNG to quality-84 WebP. | Bar scene for Lira Nightwind. |
| `static/assets/scenes/torvin-tavern.webp` | 1,672 × 941 WebP, 198 KB | Generated for this project with OpenAI image generation on 2026-09-09, then converted from lossless PNG to quality-84 WebP. | Bar scene for Torvin Ashbeard. |
| `static/raven.svg` | SVG | Existing repository brand asset. Original provenance was not recorded in this ticket. | Header and keeper seal. |

## Generation briefs

**Lira scene:** Wide cinematic fantasy tavern interior in warm candlelight. Lira Nightwind, an elven ranger with braided auburn hair, leather-and-green ranger clothing, bow, and quiver, sits at the bar facing the keeper. Cozy, grounded painterly realism, dark wood and brass, unobstructed room for a lower dialogue overlay, no text, logos, borders, interface, cards, or watermark.

**Torvin scene:** Wide cinematic fantasy tavern interior in warm candlelight. Torvin Ashbeard, a sturdy older dwarven merchant with a braided copper-and-grey beard and practical travel leathers, sits at the bar facing the keeper. Cozy, grounded painterly realism, dark wood and brass, unobstructed room for a lower dialogue overlay, no text, logos, borders, interface, cards, or watermark.

The generated scenes are decorative atmosphere. Patron identity, relationship, story state, dialogue, and gameplay effects continue to come from the authenticated save and server-owned records. If an image fails to load, the figure retains its dark background and the patron's textual caption.

## Maintenance rules

- Record the source, generation brief, dimensions, encoding, and intended screen for each new bitmap.
- Store one optimized runtime derivative; retain source PNGs outside the repository's runtime bundle.
- Do not place unrevealed story facts, secret character data, future outcomes, or fake game state in visual assets.
- Use CSS and inline SVG for frames, rules, focus states, navigation symbols, and simple ornaments.
