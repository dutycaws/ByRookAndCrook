# Visual asset manifest

Runtime imagery is stored under `static/assets`. Design references and review evidence stay under `docs` and are not loaded by the application.

| Asset | Kind | Provenance | Runtime purpose |
| --- | --- | --- | --- |
| `docs/reference/CozyTavernConceptArt.png` | 1,672 × 941 PNG | Supplied by the project owner on 2026-09-08. SHA-256 `e488680c402871eccbd5ea5463bd2de9dec97871019210a9239e8d519954d37c`. | Design reference only. |
| `docs/reference/CozyTavernConceptArt2.png` | 1,672 × 941 PNG | Supplied by the project owner; imported unchanged on 2026-09-09. SHA-256 `06925a9fb1eb1603a3f237c54419701f62c11882f181a1d66a9ae5acc8816b8b`. | Garden design reference only. |
| `docs/reference/CozyTavernConceptArt3.png` | 1,672 × 941 PNG | Supplied by the project owner; imported unchanged on 2026-09-09. SHA-256 `9ae79901a389c228751c828649561f3e982aeda78019e60cbfe4211adce6c2ee`. | Brewery design reference only. |
| `docs/reference/CozyTavernConceptArt4.png` | 1,672 × 941 PNG | Supplied by the project owner; imported unchanged on 2026-09-09. SHA-256 `67f9219290374363de2dd156ff1f83556bb94c2906e2e74546068ddacfb239c0`. | Bakery design reference only. |
| `static/assets/scenes/lira-tavern.webp` | 1,672 × 941 WebP, 181 KB | Generated for this project with OpenAI image generation on 2026-09-09, then converted from lossless PNG to quality-84 WebP. | Bar scene for Lira Nightwind. |
| `static/assets/scenes/torvin-tavern.webp` | 1,672 × 941 WebP, 198 KB | Generated for this project with OpenAI image generation on 2026-09-09, then converted from lossless PNG to quality-84 WebP. | Bar scene for Torvin Ashbeard. |
| `static/raven.svg` | SVG | Existing repository brand asset. Original provenance was not recorded in this ticket. | Header and keeper seal. |

## Generation briefs

**Lira scene:** Wide cinematic fantasy tavern interior in warm candlelight. Lira Nightwind, an elven ranger with braided auburn hair, leather-and-green ranger clothing, bow, and quiver, sits at the bar facing the keeper. Cozy, grounded painterly realism, dark wood and brass, unobstructed room for a lower dialogue overlay, no text, logos, borders, interface, cards, or watermark.

**Torvin scene:** Wide cinematic fantasy tavern interior in warm candlelight. Torvin Ashbeard, a sturdy older dwarven merchant with a braided copper-and-grey beard and practical travel leathers, sits at the bar facing the keeper. Cozy, grounded painterly realism, dark wood and brass, unobstructed room for a lower dialogue overlay, no text, logos, borders, interface, cards, or watermark.

The generated scenes are decorative atmosphere. Patron identity, relationship, story state, dialogue, and gameplay effects continue to come from the authenticated save and server-owned records. If an image fails to load, the figure retains its dark background and the patron's textual caption.

## Motion-proof scene assets

Issue [#7](https://github.com/dutycaws/ByRookAndCrook/issues/7) establishes the canonical Brewery and Bakery inputs for issue #8's layered-motion proofs. All generated PNG masters remain outside the runtime bundle under `/home/hosm/.codex/generated_images/01a07a19-440d-7091-9a4c-a71dbcf9257f`. Runtime derivatives were exported with Pillow 10.2 as quality-84 opaque WebP or quality-88-and-higher alpha WebP.

### Brewery

| Runtime asset | Dimensions | Alpha | SHA-256 | Source and use |
| --- | ---: | :---: | --- | --- |
| `static/assets/scenes/brewery-environment.webp` | 1,672 × 941 | No | `206e9ccab60d0c774b8cf940aaa464da9d62ab2e5fd05f520b69c69bf325c504` | Generated master `exec-92c010de-aa17-4151-a8cb-a871e1bebce6.png`; fixed room, plain banner, unbranded copper vat, wort, and hearth. |
| `static/assets/scenes/brewery/brewery-fire.webp` | 780 × 325 | Yes | `ab163702a2b29deadd255e4dc8bc6d2c2d8a6a6d7adfc3055641a3221e29c6f1` | Generated master `exec-9594178f-2f07-44b9-9a1e-1ddb0c069ee4.png`; isolated flame and ember overlay for the cauldron brazier. |
| `static/assets/scenes/brewery/brewery-wort-surface.webp` | 782 × 235 | Yes | `9d9c35c65eadfe109269c0f441e1a6e289e854b5e7d0e78091c9774b2e9c9e88` | Elliptical surface derived from the canonical environment, preserving exact liquid texture and light. |
| `static/assets/scenes/brewery/brewery-wort-mask.webp` | 782 × 235 | Yes | `5a1b69fa4636cb6300c3b8e484ff43e7c2cc6118355c83b29395c2a2ccc39859` | Feathered white alpha mask matching the surface bounds. |
| `static/assets/scenes/brewery/brewery-paddle-immersion-shadow.webp` | 260 × 100 | Yes | `7ba33644cf767c6ad83790aa6546e7aecf1ec885dfee9e88e814afd6b9e2d190` | Procedural soft immersion/contact shadow, positioned independently beneath the paddle blade. |
| `static/assets/scenes/brewery/brewery-paddle.webp` | 184 × 570 | Yes | `2b8f64b9a10a46d8f55a41a782eec830e1c8b9cb493a60fd3a76eced1350d3e9` | Generated master `exec-24b3729f-d1d0-4c7b-8072-b6df0c87cca6.png`; isolated wet oak paddle with no hand or baked shadow. |
| `static/assets/scenes/brewery/brewery-cauldron-foreground-rim.webp` | 875 × 355 | Yes | `9bf51e4caa5a4f899f00835c97b8c2b8fd6e163431d79776f88f58d0ad7a5e07` | Foreground crop and curved alpha matte derived from the same environment; restores exact rim/body occlusion. |
| `static/assets/scenes/brewery/brewery-steam.webp` | 680 × 453 | Yes | `e1790cb06a023076c0eda879f5f79e6b6414206e06206aea4142cb955de8dce5` | Generated master `exec-9a8a8477-f1c5-4fc5-af61-875717347cf2.png`; isolated warm steam and condensation overlay. |

**Brewery environment brief:** Create a wide fixed-camera fantasy brewery in grounded painterly realism. Center a large hammered copper vat with an unobstructed amber wort ellipse. Use aged timber, barrels, copper stills, worn brass, hearth light, and deep brown shadows. Include no people, hands, paddles, interface, words, logos, meters, cards, or gameplay information. A second edit removed generated tankard emblems from the banner and vat without changing the camera or cauldron.

**Paddle brief:** Create one complete long dark-oak brewing paddle with a broad flat blade, warm upper-right light, and a restrained wet amber sheen on the lower blade. Isolate it on real transparency with no hand, person, cauldron, background, external shadow, text, or interface.

**Fire and steam briefs:** Create separate real-alpha overlays for the fixed Brewery camera. The fire is a compact strip of orange-gold flames and restrained embers for the circular brazier, with no container or room. The steam is three soft pale-cream wisps with faint amber candlelight and a few condensation motes, with no vat, paddle, room, text, or interface. Both were generated with the built-in OpenAI image tool on 2026-09-10, then resized and exported as quality-90 exact-alpha WebP. The soft paddle immersion shadow is procedural so its contact edge remains stable while the illustrated paddle moves.

The wort surface and foreground rim are extracted from the same reviewed environment plate. They are not separately generated animation frames. Fire, steam, and immersion shadow remain separate so the runtime can suspend, reduce, or move each effect without changing game state.

### Bakery

| Runtime asset | Dimensions | Alpha | SHA-256 | Source and use |
| --- | ---: | :---: | --- | --- |
| `static/assets/scenes/bakery-environment.webp` | 1,672 × 941 | No | `8669352fbb4edb26a4e5ca92248ea17ddbc00d467ae65239ff64165aae36e5eb` | Generated master `exec-0c386dc5-6f2f-4237-b583-75ef46b8fd7a.png`; fixed oven room with the preparation surface removed. |
| `static/assets/scenes/bakery/bakery-preparation-surface.webp` | 1,672 × 391 | Yes | `d40a540982cb46c8579ff95c5cbe67939cb692d949ebcfcf0628cc4d89584bd5` | Transparent extraction master `exec-6d3ff418-c134-4a9f-87cb-e38adf974ac4.png`, derived from the preferred full-width workbench in original Bakery master `exec-419873df-5c96-42a6-9712-64511739f1fe.png`. |
| `static/assets/scenes/bakery/bakery-dough-rest.webp` | 480 × 250 | Yes | `c6b220acf8dbe29857a9bdb1498c4602ce9c70a9697eb15aa0352f42df76d2b4` | First cell of canonical pose-sheet master `exec-8357efe5-91b2-49fb-b25e-e04408e47c15.png`. |
| `static/assets/scenes/bakery/bakery-dough-fold-active.webp` | 480 × 250 | Yes | `489892411f081ce0fee0ec4c83abdcc5fc8d8d1f6df62dcc9840fb34d56b8ffa` | Second cell of the same pose sheet; one lifted, controlled fold. |
| `static/assets/scenes/bakery/bakery-dough-fold-confirmed.webp` | 480 × 250 | Yes | `fa47d37e2d169b0884dc8ea59abfad5cede645d1b5d953af847414d79489d4b7` | Third cell of the same pose sheet; one settled confirmed fold. |
| `static/assets/scenes/bakery/bakery-dough-shadow.webp` | 480 × 250 | Yes | `fe11db96ac086f5cafc5c0df839624867754510210afdc62cdd992f714af3ac1` | Procedural soft contact shadow on the shared dough canvas. |
| `static/assets/scenes/bakery/bakery-scoring-tool.webp` | 310 × 70 | Yes | `36a9ac292097b988424d2271d59e02349d213b3732a60b2f88fcaf07cbcce96d` | Generated master `exec-5c82dd47-6e10-4ebf-99ed-b786d4675e56.png`; isolated baker's lame with left blade-tip anchor. |
| `static/assets/scenes/bakery/bakery-score-groove-01.webp` | 480 × 250 | Yes | `492f88db7932099d4ea7d7e0af120524aaae79a62a54f0e9b062e524c8e35805` | Procedural first-score overlay aligned to the common dough anchor. |

**Bakery environment brief:** Create a fixed-camera soot-dark stone oven room with a clear oven mouth, restrained fire bed, aged timber, side shelves, flour sacks, and warm lantern fill. Include no person, hand, dough, bread, peel, scoring tool, interface, text, logo, meter, or fabricated game state. The final environment edit removes the foreground bench so the canonical full-width workbench can be shown only during the relevant phases.

**Dough pose-sheet brief:** Create exactly three isolated views of the same lightly floured herb dough under one camera and light: a low rest pose, one active left-to-center fold, and one tighter settled fold. Keep scale, material, flour pattern family, herb inclusion, and light direction compatible. The three runtime cutouts are crops from this single generated sheet; they are not independently generated intermediate frames.

**Preparation surface and scoring-tool briefs:** Preserve the broad foreground dark-oak workbench from the first Bakery environment, including its full-width perspective, worn planks, front apron, edge wear, and oven highlights. Extract it onto real transparency without changing its camera or scale. The tool is one horizontal worn-wood baker's lame with a readable left blade tip. Both contain no hand, dough, interface, text, symbol, or gameplay information.

The generated pose sheet and scoring tool initially contained a rendered checker field. Export removed that field and produced real alpha pixels. The replacement preparation surface was generated directly with real transparency from the preferred original workbench. The checked runtime files contain alpha, while both environment plates are deliberately opaque.

### Contract and review evidence

[`static/assets/scenes/motion-proof-contract.json`](../../static/assets/scenes/motion-proof-contract.json) records the design canvas, responsive crops, bounds, anchors, z-order, allowed motion, and static fallbacks. It began as the issues #8 and #9 proof contract and now includes the production Brewery layers delivered by issue #10.

| Evidence | Purpose |
| --- | --- |
| `docs/screenshots/motion-assets-brewery.jpg` | Confirms the generated paddle sits behind the matching front-rim cutout in the fixed vat camera. |
| `docs/screenshots/motion-assets-bakery.jpg` | Confirms the preparation surface, shadow, dough, first groove, and scoring tool share one oven camera. |
| `docs/screenshots/motion-asset-contact-sheet.png` | Reviews every cutout against a checker field and both assembled scenes together. |

Run `npm run art:assets:check` to verify the three reference checksums, runtime dimensions, alpha requirements, derivative checksums, file-size ceilings, and absence of PNG source masters under `static/assets`.

## Export conventions

- Use the common `1672 × 941` design space and preserve the exact layer bounds in the JSON contract.
- Name area assets `<area>-<object>-<state>.webp`; use two-digit suffixes for ordered states such as `groove-01`.
- Opaque environment plates use quality-84 WebP. Alpha cutouts use quality-88 or higher WebP with the `exact` transparency option.
- Keep generated lossless PNG masters outside the repository runtime bundle. Record their source path, prompt brief, date, and derivative relationship here.
- A mask is a separate white-alpha asset. A foreground occluder contains the reviewed environment pixels that must appear in front of a moving layer.
- Every cutout has one documented local anchor and one design-space placement. State variants share dimensions and anchors.
- Generated variants represent durable phase poses only. Continuous motion uses transforms, masks, and bounded procedural effects.
- Review alpha cutouts on both light and dark checker fields before acceptance.

## Maintenance rules

- Record the source, generation brief, dimensions, encoding, and intended screen for each new bitmap.
- Store one optimized runtime derivative; retain source PNGs outside the repository's runtime bundle.
- Do not place unrevealed story facts, secret character data, future outcomes, or fake game state in visual assets.
- Use CSS and inline SVG for frames, rules, focus states, navigation symbols, and simple ornaments.
