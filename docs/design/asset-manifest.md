# Visual asset manifest

Runtime imagery is stored under `static/assets`. Design references and review evidence stay under `docs` and are not loaded by the application.

| Asset | Kind | Provenance | Runtime purpose |
| --- | --- | --- | --- |
| `docs/reference/CozyTavernConceptArt.png` | 1,672 × 941 PNG | Supplied by the project owner on 2026-09-08. SHA-256 `e488680c402871eccbd5ea5463bd2de9dec97871019210a9239e8d519954d37c`. | Design reference only. |
| `docs/reference/CozyTavernConceptArt2.png` | 1,672 × 941 PNG | Supplied by the project owner; imported unchanged on 2026-09-09. SHA-256 `06925a9fb1eb1603a3f237c54419701f62c11882f181a1d66a9ae5acc8816b8b`. | Garden design reference only. |
| `docs/reference/CozyTavernConceptArt3.png` | 1,672 × 941 PNG | Supplied by the project owner; imported unchanged on 2026-09-09. SHA-256 `9ae79901a389c228751c828649561f3e982aeda78019e60cbfe4211adce6c2ee`. | Brewery design reference only. |
| `docs/reference/CozyTavernConceptArt4.png` | 1,672 × 941 PNG | Supplied by the project owner; imported unchanged on 2026-09-09. SHA-256 `67f9219290374363de2dd156ff1f83556bb94c2906e2e74546068ddacfb239c0`. | Bakery design reference only. |
| `design-reference-cozy-tavern-art-6@b3429ddfcb61` | 1,672 × 941 PNG | Supplied by the project owner on 2026-09-11. SHA-256 `b3429ddfcb61496411733d82eb438b2d34d680f0224f648156d061efa812fdae`. The source remains only in the Git-ignored local content-addressed store at `.local/media/source-masters/v1/sha256/b3/b3429ddfcb61496411733d82eb438b2d34d680f0224f648156d061efa812fdae.png`. | Shop design reference and source for the reviewed Elara crops; never a Git asset or hosted service object. |
| `static/assets/scenes/lira-tavern.webp` | 1,672 × 941 WebP, 181 KB | Generated for this project with OpenAI image generation on 2026-09-09, then converted from lossless PNG to quality-84 WebP. | Bar scene for Lira Nightwind. |
| `static/assets/scenes/torvin-tavern.webp` | 1,672 × 941 WebP, 198 KB | Generated for this project with OpenAI image generation on 2026-09-09, then converted from lossless PNG to quality-84 WebP. | Bar scene for Torvin Ashbeard. |
| `static/raven.svg` | SVG | Existing repository brand asset. Original provenance was not recorded in this ticket. | Header and keeper seal. |

## Generation briefs

**Lira scene:** Wide cinematic fantasy tavern interior in warm candlelight. Lira Nightwind, an elven ranger with braided auburn hair, leather-and-green ranger clothing, bow, and quiver, sits at the bar facing the keeper. Cozy, grounded painterly realism, dark wood and brass, unobstructed room for a lower dialogue overlay, no text, logos, borders, interface, cards, or watermark.

**Torvin scene:** Wide cinematic fantasy tavern interior in warm candlelight. Torvin Ashbeard, a sturdy older dwarven merchant with a braided copper-and-grey beard and practical travel leathers, sits at the bar facing the keeper. Cozy, grounded painterly realism, dark wood and brass, unobstructed room for a lower dialogue overlay, no text, logos, borders, interface, cards, or watermark.

The generated scenes are decorative atmosphere. Patron identity, relationship, story state, dialogue, and gameplay effects continue to come from the authenticated save and server-owned records. If an image fails to load, the figure retains its dark background and the patron's textual caption.

## Motion-proof scene assets

Issue [#7](https://github.com/dutycaws/ByRookAndCrook/issues/7) establishes the canonical Brewery and Bakery inputs for issue #8's layered-motion proofs. All generated PNG masters remain outside the runtime bundle and are registered in the [source-master catalog](source-master-catalog.json) by logical `exec-…` ID and immutable content-addressed `storageKey`; the IDs cited below resolve there rather than to a workstation path. Runtime derivatives were exported with Pillow 10.2 as quality-84 opaque WebP or quality-88-and-higher alpha WebP.

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
| `static/assets/scenes/bakery/bakery-loaf-pale.webp` | 520 × 415 | Yes | `2201d447d3b74e4be6e6e256ffb17420b3f1920f682a30d2bf399c60793baea9` | Left cell from canonical three-loaf master `exec-bc209f8e-e1b6-466a-8dde-7e7438690afe.png`; pale underbaked state. |
| `static/assets/scenes/bakery/bakery-loaf-ideal.webp` | 520 × 415 | Yes | `95314eec09b66df8ab8d909ec3b5b5effa5410549b1362f4bc3cb33c20b27460` | Center cell from the same master; fully risen golden state. |
| `static/assets/scenes/bakery/bakery-loaf-overbaked.webp` | 520 × 415 | Yes | `d7654ac924f938af9689b155d64540eb7676eabd24061fcd1fe23d1d72736e50` | Right cell from the same master; dark, permanently overbaked but removable state. |
| `static/assets/scenes/bakery/bakery-oven-peel.webp` | 920 × 600 | Yes | `45e9e53ef2b85b65db714a6eff5cf6204f0ee18c560813e25384b33966b488ee` | Generated real-alpha master `exec-b40c0006-46ea-4efd-b57b-f9d58b27bd9f.png`; empty walnut peel for insertion and extraction. |
| `static/assets/scenes/bakery/bakery-oven-embers.webp` | 660 × 275 | Yes | `a725ca0ec6ef27facb581d48f12810a433469d39403dcb9b33d8e0f3d612eece` | Bakery-sized derivative of clean-alpha fire master `exec-9594178f-2f07-44b9-9a1e-1ddb0c069ee4.png`; independently suspended oven effect. |
| `static/assets/scenes/bakery/bakery-oven-steam.webp` | 485 × 323 | Yes | `ea4a35a6b66115a39aefbcc0ef344631d23c0d97b1b68f8bd9f2cad181527ca0` | Bakery-sized derivative of clean-alpha steam master `exec-9a8a8477-f1c5-4fc5-af61-875717347cf2.png`; independently suspended oven effect. |
| `static/assets/scenes/bakery/bakery-oven-foreground.webp` | 900 × 300 | Yes | `4848240cf00e956bb3bd557d9c5f99a79ebebfb6661489d8ed731887fe8e4126` | Alpha-masked extraction of the approved oven plate; restores stone occlusion in front of the inserted loaf. |

**Bakery environment brief:** Create a fixed-camera soot-dark stone oven room with a clear oven mouth, restrained fire bed, aged timber, side shelves, flour sacks, and warm lantern fill. Include no person, hand, dough, bread, peel, scoring tool, interface, text, logo, meter, or fabricated game state. The final environment edit removes the foreground bench so the canonical full-width workbench can be shown only during the relevant phases.

**Dough pose-sheet brief:** Create exactly three isolated views of the same lightly floured herb dough under one camera and light: a low rest pose, one active left-to-center fold, and one tighter settled fold. Keep scale, material, flour pattern family, herb inclusion, and light direction compatible. The three runtime cutouts are crops from this single generated sheet; they are not independently generated intermediate frames.

**Preparation surface and scoring-tool briefs:** Preserve the broad foreground dark-oak workbench from the first Bakery environment, including its full-width perspective, worn planks, front apron, edge wear, and oven highlights. Extract it onto real transparency without changing its camera or scale. The tool is one horizontal worn-wood baker's lame with a readable left blade tip. Both contain no hand, dough, interface, text, symbol, or gameplay information.

**Oven loaf and peel briefs:** Create three isolated views of the same rustic oval herb loaf in one row, with identical camera, silhouette, scale, three-groove scoring pattern, and light. Progress only the crust from pale cream-gold through ideal golden brown to dark overbaked edges. Create the peel separately as an empty broad walnut paddle with its handle toward the lower-right, warm oven rim light, no visible hand, loaf, room, interface, or text. Runtime alpha cleanup removes the model-rendered checker field from the loaf sheet without inventing additional frames.

The generated pose sheet and scoring tool initially contained a rendered checker field. Export removed that field and produced real alpha pixels. The replacement preparation surface was generated directly with real transparency from the preferred original workbench. The checked runtime files contain alpha, while both environment plates are deliberately opaque.

### Garden

| Runtime asset | Dimensions | Alpha | SHA-256 | Source and use |
| --- | ---: | :---: | --- | --- |
| `static/assets/scenes/garden-environment.webp` | 1,672 × 941 | No | `17444dbbcde2554e94d1ecea75551c783eabd5eeac6c2b07fd4156a7ba513e2d` | Generated master `exec-2190b5d2-5fdd-492d-b489-cc63f98423a0.png`; fixed elevated courtyard, paths, trellises, well, perimeter foliage, and a calm central soil field. |
| `static/assets/scenes/garden/garden-plot-base.webp` | 230 × 260 | Yes | `b76d3d0226e9fbabe6a534aac9443044c1331629fbed5ca1babf7fe89fb868b3` | Top-left extraction from generated props master `exec-c6bf6a1e-cfb9-4059-84d1-fadf928d5a13.png`; reusable mossy stone rim and dark soil. |
| `static/assets/scenes/garden/garden-beehive.webp` | 360 × 300 | Yes | `11b5fd9011d5ea874ae2d1dea21fa47c6286478af0f910b8e98d380dc6e8c83e` | Top-right extraction from the props master; the persisted beehive plot. |
| `static/assets/scenes/garden/garden-foreground.webp` | 960 × 330 | Yes | `fe590cf6e63f965b54345502f4e48aa914916b8e38c234886d030cf453dc1a73` | Bottom-left extraction from the props master; non-interactive ferns, ivy, lavender, and flowers at the lower scene edge. |
| `static/assets/scenes/garden/garden-atmosphere.webp` | 620 × 330 | Yes | `2a1c9d88886ae253a2321a49adcdb3148ec3b4609305f8035b0860f8c8d25a0f` | Bottom-right extraction from the props master; twelve bounded decorative bees/leaves rendered as one suspendable layer. |

The 21 crop assets are 240 × 320 alpha WebPs cut from the generated three-stage atlas `exec-8a000304-9733-4a6b-948b-687b0a847de7.png`. Each triplet below is stage 1 / stage 2 / stage 3 in order:

| Crop key | Stage asset SHA-256 values |
| --- | --- |
| `hops` | `b0efbbe5a0a45b46c54614d60f166381fd831be870cbee52c20dcaebf18b4ac1` / `d9c60b462674169168be01f522a80aee143ddb95857259b115ddc18cea30a205` / `d20308fe62e42e1e09c9ed172e6290748655c8fed8bcbac8171ee2ae95d901ed` |
| `fennel` | `74bed97125e2c99efff968e647ed2ce0480fee1fd399ec66bf84a9545e1f8c70` / `ed636c34fc388105c97da3c2f3f7a9cd8b7f32a30e57ac263d8ac06ef28891ff` / `ccfc18a95fedab4c59b028b2a2e631a85a80edf8d37e39fb95d40dad3997bd33` |
| `pepper` | `0985d4b3ede89cd57bcae1038c488a89ded7841b0bc0d94eef7574091a00c47e` / `de0ba90ba41d53738972c53155779c8a26664b18f551c4070f43330b5607441c` / `0533aaa937274dbeceaf1a23b801a6207a9ed1836258ea666e834a9ac52e1a0c` |
| `chamomile` | `db57c904a15a423641078739dd72a1d6ee26398bbf5aa54e3fcbb21db6542f76` / `034c22c0fd19cbb2459e634a6f3fe96937a9c06d25b22a5650bfb102b00ed891` / `944aa8f600cfd612674dc6bc1c3c74bb920f24a52514a339c7beb023667f4e04` |
| `tomatoes` | `74f1ef8f821f482359b1808f435a62dc7d190bf7356a77bfc9c1b742e5d29922` / `9c9479f13d8f244ddfc403e38bfc09ee649af12838583eed3a4d705b93b3cbbe` / `e131f744dd4186e2e801cb172c6cb345e7c6a6010305386531184c2aa93470c3` |
| `lavender` | `6d0a937377ea814895782196b630db47842d4cf8b8f43563357cfc68d094fe57` / `343b75232ab7d3cc610be896dd167d29d6d271879c7a639dbbd768a1a850b332` / `88a07810143218d17de962f16fc96d7fdbd4afd9c918cb3fa8242218c4e07207` |
| `sage` | `529cb8f37dc82d592c3de78b5e0faf9bb45ef62d3d992b7f557c15a9c8521adc` / `4a18f77a2800b952589290d456ab82d26bcb73a45779294a3dda547c21b0107e` / `4d2e8c1b465b1e25b1edcdf5c2e06ae77bffd59920037ca91263f905ada27b80` |

**Garden environment brief:** Create a fixed elevated enclosed medieval courtyard in the reference's painterly warm-gold and forest-green language, with mossy walls, stone paths, timber fencing, hops trellises, a well, and a broad calm central field for separately layered plots. Include no interface, words, hands, people, permanent plot outlines, central crops, or gameplay information.

**Crop atlas brief:** Arrange the seven supported plant keys in columns and growth stages 1–3 in rows on a pure black field, using one camera, ground baseline, and upper-left light. Keep every plant isolated, botanically distinct, and free of soil beds, labels, frames, and interface. Pillow crops the fixed cells and converts the black field to alpha; runtime stage selection comes only from the persisted `growthStage`.

**Garden props brief:** Isolate one pointy-top stone-and-soil bed, one rustic three-box apiary, one lower-edge foliage cluster, and a sparse twelve-element bee/leaf atmosphere in separate quadrants on pure black. Pillow trims, alpha-keys, scales, and exports each reviewed derivative. The atmosphere moves as one bounded layer; it cannot create growth, honey, yield, or other game state.

### Shop

| Runtime asset | Dimensions | Alpha | SHA-256 | Source and use |
| --- | ---: | :---: | --- | --- |
| `static/assets/scenes/shop-environment.webp` | 1,672 × 941 | No | `77bf66f9fe3e595570a556104f763211da08a512d298dc33ada83a763b8d5180` | OpenAI-generated fixed herb-and-apiary shop plate with an open central counter; it contains no person, text, UI, or price information. |
| `static/assets/scenes/shop/elara-merchant.webp` | 680 × 528 | No | `022e692f31cff46903a649f9c8726b69a2d7a03ec6042d6cef9a50693e3b8ddc` | UI-free crop of the supplied Shop reference, used in a framed merchant scene rather than as a floating cutout. |
| `static/assets/scenes/shop/elara-portrait.webp` | 280 × 280 | No | `d0baf79bb61ef8666031ec7f4017a46419e4e57c0fdc640e273767107f5c1880` | UI-free face crop from the supplied Shop reference for the circular shopkeeper portrait. |

**Shop environment brief:** A fixed wide fantasy herb-and-apothecary shop in the supplied reference's warm gold, dark timber, brass, and forest-green language. The environment holds lantern and window light, hanging herbs, jars, honey, apiary tools, shelves, and an open counter. It contains no people, text, signage, logos, price tags, cards, dialogue, or interface so functional HTML retains ownership of every game value.

The first generated merchant-cutout attempt rendered its checker preview into an opaque PNG. It is retained outside the repository and is deliberately not used at runtime. The inspected derivatives above use the generated person-free environment and UI-free crops from the supplied reference, avoiding a misleading fake-transparency layer. Both merchant derivatives are opaque by design and must be displayed in their framed scene or circular portrait crop; failed images cannot suppress the Shop's functional text, filters, or purchase controls.

### Contract and review evidence

[`static/assets/scenes/motion-proof-contract.json`](../../static/assets/scenes/motion-proof-contract.json) records the design canvas, responsive crops, bounds, anchors, z-order, crop-stage mapping, allowed motion, and static fallbacks. It began as the issues #8 and #9 proof contract and now includes the production Brewery, Bakery, and Garden layers delivered by issues #10–#12.

| Evidence | Purpose |
| --- | --- |
| `docs/screenshots/motion-assets-brewery.jpg` | Confirms the generated paddle sits behind the matching front-rim cutout in the fixed vat camera. |
| `docs/screenshots/motion-assets-bakery.jpg` | Confirms the preparation surface, shadow, dough, first groove, and scoring tool share one oven camera. |
| `docs/screenshots/motion-asset-contact-sheet.png` | Reviews every cutout against a checker field and both assembled scenes together. |

Run `npm run art:assets:check` to verify the four reference checksums, runtime dimensions, alpha requirements, derivative checksums, file-size ceilings, and absence of PNG source masters under `static/assets`.

The issue-#13 [assembled-scene acceptance record](../quality/scene-acceptance.md) uses these exact reference files and runtime derivatives. Its twelve annotated viewport screenshots, three WebM interaction clips, and structured benchmark result live under `docs/screenshots/final-review/`. They are review evidence only and never ship from `static/assets` or participate in game state.

## Export conventions

- Use the common `1672 × 941` design space and preserve the exact layer bounds in the JSON contract.
- Name area assets `<area>-<object>-<state>.webp`; use two-digit suffixes for ordered states such as `groove-01`.
- Opaque environment plates use quality-84 WebP. Alpha cutouts use quality-88 or higher WebP with the `exact` transparency option.
- Keep generated lossless PNG masters outside the repository runtime bundle. Record the catalog logical ID, immutable storage key, prompt brief, date, and derivative relationship here; never record a workstation path.
- A mask is a separate white-alpha asset. A foreground occluder contains the reviewed environment pixels that must appear in front of a moving layer.
- Every cutout has one documented local anchor and one design-space placement. State variants share dimensions and anchors.
- Generated variants represent durable phase poses only. Continuous motion uses transforms, masks, and bounded procedural effects.
- Review alpha cutouts on both light and dark checker fields before acceptance.

## Maintenance rules

- Record the source, generation brief, dimensions, encoding, and intended screen for each new bitmap.
- Store one optimized runtime derivative; retain source PNGs outside the repository's runtime bundle.
- Do not place unrevealed story facts, secret character data, future outcomes, or fake game state in visual assets.
- Use CSS and inline SVG for frames, rules, focus states, navigation symbols, and simple ornaments.
