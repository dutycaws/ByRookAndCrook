# Garden, Brewery, and Bakery acceptance record

This record closes the cross-area review in [issue #13](https://github.com/dutycaws/ByRookAndCrook/issues/13). It evaluates the assembled, state-backed Garden, Brewery, and Bakery delivered by issues #10–#12 against the exact supplied references. The references guide composition, material, palette, lighting, and interaction hierarchy; they are never used as runtime backgrounds.

## Review conditions

The committed evidence was captured from application commit `2a75ed010f87c640bc572f425d15f042e06ccbd6` with the issue-#13 capture harness in the working tree. The harness ran the adapter-node production build at `http://127.0.0.1:4173`, with `ORIGIN` set to that address, against disposable authenticated users and the real local Supabase RPCs. It removed the users after the run.

| Condition | Recorded value |
| --- | --- |
| Capture time | 2026-09-10 09:10 UTC |
| Host | Linux 7.1.5, AMD Ryzen 7 1700, 16 logical CPUs, 31.3 GiB RAM |
| Browser | Headless Chromium 153.0.8010.12 |
| Rendering | Device scale factor 1, warm asset cache, no CPU or network throttling |
| Desktop benchmark | 1,440 × 900, three 2-second trials per area |
| Mobile-size benchmark | 390 × 844, three 2-second trials per area |
| Mobile limitation | Desktop Chromium viewport emulation; this run makes no physical-device performance claim |

The machine-readable capture conditions, per-trial timings, file names, and overflow values are in [`acceptance-results.json`](../screenshots/final-review/acceptance-results.json).

## Exact references

| Area | Supplied reference | SHA-256 | Reviewed state |
| --- | --- | --- | --- |
| Garden | [`CozyTavernConceptArt2.png`](../reference/CozyTavernConceptArt2.png) | `06925a9fb1eb1603a3f237c54419701f62c11882f181a1d66a9ae5acc8816b8b` | Mature `c1` selected in the live tessellated garden |
| Brewery | [`CozyTavernConceptArt3.png`](../reference/CozyTavernConceptArt3.png) | `9ae79901a389c228751c828649561f3e982aeda78019e60cbfe4211adce6c2ee` | Active fennel brew with live paddle, wort, fire, steam, and controls |
| Bakery | [`CozyTavernConceptArt4.png`](../reference/CozyTavernConceptArt4.png) | `67f9219290374363de2dd156ff1f83556bb94c2906e2e74546068ddacfb239c0` | One confirmed score on the prepared loaf and preferred broad workbench |

## Annotated viewport evidence

Each screenshot is exactly the named browser viewport. Its annotation identifies the issue, area, persisted state, viewport, and exact reference. The capture script also measured zero horizontal page overflow in all twelve cases.

| Viewport | Garden | Brewery | Bakery |
| --- | --- | --- | --- |
| 1,672 × 941 | [`garden-1672x941.png`](../screenshots/final-review/garden-1672x941.png) | [`brewery-1672x941.png`](../screenshots/final-review/brewery-1672x941.png) | [`bakery-1672x941.png`](../screenshots/final-review/bakery-1672x941.png) |
| 1,440 × 900 | [`garden-1440x900.png`](../screenshots/final-review/garden-1440x900.png) | [`brewery-1440x900.png`](../screenshots/final-review/brewery-1440x900.png) | [`bakery-1440x900.png`](../screenshots/final-review/bakery-1440x900.png) |
| 768 × 1,024 | [`garden-768x1024.png`](../screenshots/final-review/garden-768x1024.png) | [`brewery-768x1024.png`](../screenshots/final-review/brewery-768x1024.png) | [`bakery-768x1024.png`](../screenshots/final-review/bakery-768x1024.png) |
| 390 × 844 | [`garden-390x844.png`](../screenshots/final-review/garden-390x844.png) | [`brewery-390x844.png`](../screenshots/final-review/brewery-390x844.png) | [`bakery-390x844.png`](../screenshots/final-review/bakery-390x844.png) |

The Garden keeps the high three-quarter courtyard, dense green perimeter, warm upper-left light, and a readable central board. All twelve saved cells use one pointy-top odd-row projection for bed art, crops, selection, focus, and hit targets. The wide view preserves the status and inspector rails; tablet and phone views put the illustrated scene and immediate action before those rails.

The Brewery keeps copper, amber liquid, timber, flame, and pale steam visually distinct. The paddle remains visible through the interaction path and passes behind the front rim. The guide marker, angular corridors, guide-relative meter, progress, and keyboard rhythm control stay readable without obscuring the vat. The narrow layout crops the fixed camera around the vat and places status and actions below it.

The Bakery retains the earlier broad oak workbench requested by the project owner. Dough, flour, timber, stone, flame, and brass remain distinct. The confirmed groove and moving lame are separate layers, and the foreground surface disappears only for the server-backed oven stage. Tablet and phone views preserve the oven, loaf, stage count, keyboard alternative, and immediate action in a single reading order.

## Motion and input evidence

- [`garden-interaction.webm`](../screenshots/final-review/garden-interaction.webm) records plot selection followed by a confirmed harvest. The crop remains until the RPC succeeds, then the bounded harvest ghost plays.
- [`brewery-interaction.webm`](../screenshots/final-review/brewery-interaction.webm) records direct circular paddle input, masked wort response, foreground-rim occlusion, and decay after release.
- [`bakery-interaction.webm`](../screenshots/final-review/bakery-interaction.webm) records the remaining keyboard scores, the confirmed ready phase, and insertion into the server-timed oven.

Automated browser coverage complements the clips:

| Concern | Evidence |
| --- | --- |
| Pointer, touch, pen, keyboard | `tests/e2e/motion-proof.test.ts` covers Brewery guided pointer and keyboard rhythm input plus Bakery mouse/touch/pen and keyboard actions. `tests/e2e/crafting-layout.test.ts` covers Garden mouse and keyboard selection, target size, and native touch selection plus harvest in the mobile project. |
| Reduced motion | The same tests assert static Brewery/Bakery poses; Garden tests assert the atmosphere and harvest effect stop. |
| Missing imagery | Garden, Brewery, and Bakery journeys abort their environment image and require the named fallback to remain usable. |
| Hidden tabs and cleanup | Scene visibility tests require ambient animation to pause. Brewery score ticks elapsed while hidden receive no positive credit; cleanup removes frame, media-query, and visibility listeners. |
| Layout | The shared-layout journey executes all three routes at the four required viewports, requires scene-first narrow ordering and zero overflow, and checks every Garden art/hit center. |

## Gameplay and recovery review

The review uses the existing server contracts rather than visual substitutes.

| Contract | Evidence |
| --- | --- |
| Harvest persistence | `garden-journey.test.ts` verifies reload, a second browser context, lost-response retry, and confirmed-only visual removal. `harvest-rpc.test.ts` verifies atomic and concurrent idempotency. |
| Bakery phase recovery | `bakery-journey.test.ts` reloads folding, scoring, ready, baking, and result states. It verifies early and overbaked removal and exact frozen fold, score, oven, and completion retries. |
| Shared daily craft | `bakery-rpc.test.ts` serializes brew versus bake, permits a no-craft day to close, and requires an active craft to finish before rest. |
| Server-owned results | Brewery and Bakery integration tests backdate only the saved server timestamp, then assert canonical duration, quality, inventory consumption, rewards, and one committed receipt. |
| Brewery reload telemetry | `motion-proof.test.ts` verifies reload preserves earned guided-stir credit while elapsed hidden ticks earn nothing; exact completion retry reuses the captured telemetry payload. |

Garden, Brewery, Bakery, and Bar mutation controls remain disabled until hydration attaches their save, subject, action, and revision fields. The no-input tavern creation form remains available from server-rendered HTML.

At the recorded issue-#13 commit, no helper chat, card-cost or deck control, fabricated task/reputation/XP display, watering/fertilizer action, heat control, foam-skimming control, or steam control appeared in the three crafting routes. Garden health and water were read-only values persisted in `garden_cells`. Issue #16 supersedes that historical Garden limitation by adding replayable water, soil-amendment, planting, lifecycle, expansion, and apiary commands; see the current [Garden and apiary specification](../garden-apiary.md). Decorative scene effects still cannot update the save, submit brewing samples, or alter server time.

## Measured rendering performance

The harness measures browser `requestAnimationFrame` intervals during deterministic live scene work: Garden alternates native plot selection every 140 ms, Brewery follows the fixed guide with real pointer events, and Bakery runs its server-timed oven with live embers, steam, loaf rise, and crust progression. Pass/fail uses unrounded values. The nominal desktop target is 60 fps with a 59 fps acceptance floor for vsync sampling variance; mobile-size delivery must remain at or above 30 fps. Any frame over 50 ms fails as a material stall. Values below are rounded only for display.

| Area | 1,440 × 900 target / measured | 390 × 844 target / measured | Worst frame across six trials | Frames over 50 ms |
| --- | --- | --- | ---: | ---: |
| Garden | 60 / 60.0 fps | 30 / 60.0 fps | 16.8 ms | 0 |
| Brewery | 60 / 60.0 fps | 30 / 60.0 fps | 16.8 ms | 0 |
| Bakery | 60 / 60.0 fps | 30 / 60.0 fps | 16.8 ms | 0 |

These numbers show no material interaction stall under the recorded machine and browser conditions. They do not predict slower physical phones, GPU-constrained browsers, cold-cache image decode, or power-saving refresh caps. The scenes limit continuous work to one Garden atmosphere layer, one Brewery frame loop that runs only while needed, and Bakery CSS layers tied to active phases. Existing visibility and reduced-motion assertions remain the durable guardrails for background work.

## Verification results

| Gate | Result |
| --- | --- |
| `npm run scene:acceptance:capture` | Passed: 12 annotated screenshots, 3 interaction clips, 6 performance cases, and 0 horizontal-overflow pixels |
| `npm run secrets:audit` | Passed: 1 ignored, permission-restricted project secret file and no configured value in source |
| `npm run art:assets:check` | Passed: 3 exact references and 49 optimized runtime assets |
| `npm run db:types:check` | Passed: generated public database types match the committed file |
| `npm run check` | Passed: 0 Svelte or TypeScript errors and warnings |
| `npm run test:unit` | Passed: 48 tests in 8 files |
| `npm run test:db` | Passed: 270 assertions in 5 pgTAP files |
| `npm run test:integration` | Passed: 31 authenticated RPC tests in 5 files |
| `npm run test:e2e` | Passed: 40 Chromium and emulated Pixel 7 journeys with bounded concurrency (4 local workers; 2 in CI) |
| `npm run build` | Passed: adapter-node production bundle generated |

## Reproduction

Start the local Supabase stack and refresh `.env`, then build and launch the production server from the repository root:

```sh
npm run db:start
npm run env:local
npm run build
PORT=4173 ORIGIN=http://127.0.0.1:4173 node --env-file=.env build
```

With that server running, capture the evidence in another terminal:

```sh
APP_URL=http://127.0.0.1:4173 ACCEPTANCE_SERVER_MODE=production-preview npm run scene:acceptance:capture
```

The command overwrites `docs/screenshots/final-review/`, fails on horizontal overflow or a missed frame target, and deletes its disposable users even when a capture fails. The separate `npm run motion:proof:capture` command retains the denser issue-#8 1×/2× Brewery and Bakery motion proof set.
