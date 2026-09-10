# Local MVP development runbook

This repository contains connected SvelteKit and Supabase vertical slices for By Rook & Crook. Their durable path is:

> sign in → start a tavern → optionally harvest/brew/serve → converse and agree on intentions → close the tavern → discover overnight consequences

The app uses SvelteKit server loads and form actions, Supabase Auth, Postgres row-level security, and ownership-filtered public database functions. The browser never writes game tables directly. `create_tavern()` provisions one save and twelve cells. `get_tavern_snapshot()` and `get_bar_snapshot()` read ownership-filtered state; harvest, craft, and serving commands commit their outcomes atomically.

## Verified local toolchain

- Node.js 22.20.0
- npm 11.18.0
- Supabase CLI 2.114.0
- Docker Engine with Compose support
- Linux `flock` from `util-linux` (the launcher’s advisory session lock)
- Playwright 1.63.0 with Chromium

The JavaScript package versions and npm version are pinned in `package.json` and `package-lock.json`. The project enforces compatible Node and npm versions through `.npmrc`; dependency install scripts require explicit approval in `package.json` (`esbuild` is approved; the optional macOS `fsevents` install script remains disabled). Use `npm ci` for a checkout and `npm install <package>` when adding dependencies, committing the resulting `package-lock.json`. Supabase CLI is intentionally a host prerequisite because it manages the local Docker stack.

## First-time setup and normal local startup

Select Node 22.20.0 and install the pinned npm version with `npm install --global npm@11.18.0`. Install the checkout dependencies with `npm ci`. Install Supabase CLI and Docker Engine with Compose support as host prerequisites; the launcher checks for them and never installs or changes host tools automatically.

Create the ignored root `.env` and add a nonempty `OPENAI_API_KEY`. `NPC_PROVIDER` defaults to `openai`; if present, it must be `openai`. This command does not make a billable provider request to validate the key.

Then use the normal human-testing command from the repository root:

```sh
npm run brac-app:dev
```

The launcher runs preflight and unit tests, starts or reuses this repository's Supabase stack, refreshes the local environment, applies pending migrations with `supabase migration up --local`, provisions pilot users, runs database and RPC integration tests, then starts Vite with hot reload. Open `http://127.0.0.1:3000/login`. It uses real local authentication, migrations, RPCs, and persistent services to keep local behavior close to the future hosted application; production builds remain a CI and `npm run build` check.

The local Supabase services use project-specific ports so they can coexist with another local stack:

| Service | Address |
| --- | --- |
| API and Auth | `http://127.0.0.1:57321` |
| Postgres | `127.0.0.1:57322` |
| Studio | `http://127.0.0.1:57323` |
| Mailpit | `http://127.0.0.1:57324` |

The ignored root `.env` is authoritative for project variables: its values override inherited shell settings, while inherited settings fill values absent from the file. `npm run env:local` obtains the local API URL and publishable key from the CLI, generates local passwords, and writes everything to `.env`. It refuses any host or port outside this repository's local stack. The launcher reloads the generated file before passing environment to later commands, so refreshed Supabase URLs and keys replace stale shell values. The browser uses only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Dialogue's server runtime additionally uses `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`; these are never imported into client modules. `env:local` preserves custom OpenAI/provider configuration while refreshing local database credentials.

`.env` is the repository's sole project-managed secret file and is written with owner-only permissions. `.env.example` contains variable names and non-secret placeholders only. Supabase CLI may generate local container credentials under its ignored `supabase/.temp/` runtime directory; application code does not read that directory. Run `npm run secrets:audit` to verify there are no more than two project-managed secret files, each is ignored and permission-restricted, and configured secret values do not occur in tracked or new source files. Use `npm run env:local -- --rotate` to rotate all generated local passwords.

The launcher uses a Linux `flock` advisory session lock to permit only one active session for this repository. Its helper releases the lock automatically if the supervisor dies and closes stdin. On Ctrl+C, SIGTERM, startup failure after stack adoption, or an unexpected app exit, it stops the app and this repository's adopted Supabase stack while preserving volumes and leaving other stacks alone. It never resets data or rotates passwords automatically. Forced termination can prevent cleanup, so if project-stack cleanup fails, recover with:

```sh
DO_NOT_TRACK=1 supabase stop --project-id by-rook-and-crook
```

## Local pilot accounts

`npm run fixtures:users:local` creates or refreshes two confirmed development users. Their emails are `keeper.one@example.test` and `keeper.two@example.test`; retrieve the generated passwords with:

```sh
npm run credentials:local
```

The fixture script asks the local CLI for a short-lived administrative connection, verifies `127.0.0.1:57321`, and refuses a hosted target. The credentials can be overridden with `LOCAL_PILOT_ONE_EMAIL`, `LOCAL_PILOT_ONE_PASSWORD`, `LOCAL_PILOT_TWO_EMAIL`, and `LOCAL_PILOT_TWO_PASSWORD` in `.env`.

Public sign-up is disabled. Hosted pilot accounts must be provisioned outside the browser flow.

## Demonstration

1. Sign in with either pilot account.
2. Submit **Start tavern**. Reload before starting if you want to verify that a GET does not create a save.
3. Select `c1`, the mature fennel plot beside the hive. The details panel previews two Legendary units, with brew +2 and bake +4 per unit.
4. Submit **Harvest crop**. The cell becomes empty and the save revision advances once.
5. Open **Ingredients** and verify the two-unit fennel batch.
6. Choose one daily craft. In **Brewery**, stir a 30-second infusion and bottle it. In **Bakery**, fold six times, score three times, place the loaf in the oven, and remove it near the 30-second sweet spot. Reloading restores the active stage and cannot reset the oven.
7. Verify the drink or food name and quality. A qualifying craft also creates an intent card such as **Charm**, **Insight**, **Resolve**, or **Rumor**. The intent remains separate from the crafted hospitality item.
8. Open **Bar** from the craft result. Choose Lira or Torvin and serve the food or drink to receive gold and change trust/overnight hospitality. Existing saves may show a labeled legacy Pour Ale entitlement that can still accompany standalone drink service.
9. Reload or sign into the same account in another browser. The gold, relationship, intentions, transcript and serving journal persist. The bottle and any played card are no longer available.
10. In **Bar**, ask about a quest or suggest a plan. Choose an optional intent card to characterize your words and, independently, optional food or drink. Inspect the agreed intention and ordered daily steps, then **Close and begin next day**. Crafting is optional, but an active brew or bake must finish. NPCs act overnight even without conversation, and morning outcomes appear in their journals.
11. Sign into the other pilot account to see an independent onboarding state.

Reference captures include [garden](screenshots/garden.png), [ingredients](screenshots/ingredients.png), [active stirring](screenshots/brewery-active.png), [brew result](screenshots/brewery-result.png), [bar at 1,672 pixels](screenshots/bar-1672.png), [bar at 1,440 pixels](screenshots/bar-1440.png), [tablet bar](screenshots/bar-768.png), [mobile bar](screenshots/bar-390.png), [serving result](screenshots/bar-result.png), and the [annotated before/after comparison](screenshots/bar-comparison.png). The issue-#7 visual handoff adds the [Brewery layered composite](screenshots/motion-assets-brewery.jpg), [Bakery layered composite](screenshots/motion-assets-bakery.jpg), and [canonical cutout contact sheet](screenshots/motion-asset-contact-sheet.png). The [final assembled-scene acceptance record](quality/scene-acceptance.md) adds all four required viewports for Garden, Brewery, and Bakery, direct-interaction clips, and measured rendering limits. See the [concept-art UI specification](design/concept-ui-spec.md) and [asset manifest](design/asset-manifest.md) for the composition, fixed camera, layer coordinates, provenance, and maintenance rules. With the dev server running, regenerate the route captures using `npm run screenshots`; the script provisions and removes its own user.

The starter crops are finite. Starting an existing tavern never refills harvested cells. Use the explicit local reset when you need the original demonstration state.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run brac-app:dev` | Run the supervised local human-testing session: preflight, units, local stack, migration, fixtures, database/RPC gates, and Vite at `127.0.0.1:3000`. Ctrl+C preserves data while stopping the app and adopted project stack. |
| `npm run dev` | Start the SvelteKit development server on port 3000. |
| `npm run build` | Create the adapter-node production build. |
| `npm run preview` | Run the built Node server. |
| `npm run db:start` | Start this repository's local Supabase stack. |
| `npm run db:stop` | Stop the local stack without deleting its database volume. |
| `npm run db:status` | Show local endpoints and service state. |
| `npm run env:local` | Safely write `.env` from this local stack. |
| `npm run credentials:local` | Print the two local pilot credentials from the ignored `.env` file. |
| `npm run secrets:audit` | Verify secret-file count, Git ignore coverage, and absence of configured secrets in tracked files. |
| `npm run art:assets:check` | Verify supplied-reference checksums and canonical scene dimensions, alpha, derivative checksums, file-size ceilings, and runtime encoding. |
| `npm run db:reset:local` | Destroy local application/auth data, reapply every migration, and run `supabase/seed.sql`. This cannot target a linked hosted project. |
| `npm run fixtures:users:local` | Create or refresh the two local pilot identities. |
| `npm run db:types` | Print TypeScript definitions generated from the migrated local public schema. |
| `npm run db:types:check` | Generate types in memory and fail if they differ from `src/lib/database.types.ts`. |
| `npm run check` | Run Svelte and TypeScript diagnostics. |
| `npm run test:unit` | Run the focused unit-test suite. |
| `npm run test` | Run the existing full Vitest suite. |
| `npm run test:db` | Run pgTAP assertions for garden, brewery, bakery, serving, dialogue, private data, budgets, permanent outcomes and grants. |
| `npm run test:integration` | Use real Auth and RPC requests to test initialization, harvest, shared daily crafting, replay, locking, isolation, rewards, and denied direct writes. |
| `npm run test:e2e` | Run desktop/mobile browser journeys, including Bakery persistence, dialogue recovery, atomic hospitality, overnight intentions, and visual layout bounds. |
| `npm run npc:content:check` | Validate editable character sheets against their published migration. |
| `npm run npc:content:migration -- --migration=202609080013_character_revision.sql` | Generate a new publication after bumping the content version; choose a timestamp later than every existing migration. |
| `npm run npc:eval:live` | Run opt-in, billable OpenAI dialogue cases on disposable local users. |
| `npm run screenshots` | Capture garden, ingredient, brewery, and desktop/mobile bar views against the running app. |
| `npm run motion:proof:capture` | Capture the issue-#8 Brewery/Bakery 1×/2× stills and interaction clips against the running app. |
| `npm run scene:acceptance:capture` | Capture the issue-#13 annotated three-area/four-viewport matrix, interaction clips, overflow checks, and frame-time report against `APP_URL`. |

For a complete CI-like acceptance pass, including browser coverage and a production build, use:

```sh
npm run db:start
npm run env:local
npm run db:reset:local
npm run fixtures:users:local
npm run secrets:audit
npm run art:assets:check
npm run db:types:check
npm run check
npm run test:db
npm run test:integration
npm run test:e2e
npm run build
```

Integration and browser tests create unique users and remove them after each run when cleanup succeeds. An interrupted RPC test can leave disposable test users; do not automatically delete them. Playwright starts the app when port 3000 is free and preserves traces and screenshots for failures under `test-results/` and `playwright-report/`.

## Command, transaction, and recovery behavior

Every harvest or craft command carries the save ID, expected revision, and a client-generated action UUID. Commands also carry only the cell, ingredient, brew session, or bounded stirring telemetry they require. The database derives the player from `auth.uid()`, locks the owned save before checking the action receipt, and calculates canonical outcomes from saved state. An identical retry returns the original receipt; reuse with different input conflicts; two commands for one revision cannot both commit.

The harvest transaction clears the crop, creates the ingredient batch, advances the revision, and writes its receipt together. Starting a brew or bake reserves the save's single craft for the current tavern day. A bake persists six folds, three scores, and the server-owned oven start before completion. Completing either craft consumes one ingredient unit, freezes the quality evidence, creates the food or beverage and optional intent card, marks the daily craft complete, advances the revision, and writes its receipt in one transaction. Advancing the day rejects an active brew, active bake, or live dialogue lease, resolves one NPC step each and reopens the shared craft exactly once. Craft completion is optional because a day with no started craft may close.

The garden, brewery, and bakery keep an unresolved command in component state after a connection or unexpected server failure. Retrying reuses its action UUID and exact payload. A validation, conflict, or eligibility error refreshes the authoritative snapshot. Server diagnostics record the action ID, outcome code, committed revision when available, and duration; they do not record credentials or session tokens.

The server enforces the 30-second brew duration. The client samples stirring speed every 250 ms, with 42–58 as the perfect band and 30–70 as the wider good band. The submitted counts are range checked and affect a six-point stirring score. Final quality combines the saved ingredient quality with that score and applies the saved brew bonus threshold. Reloading an active brew preserves its timer but discards prior in-memory samples, so missing samples lower its final score. This is acceptable for the pilot; durable event sampling or anti-cheat validation belongs in a later online-competition design.

Quality uses the shared seven-tier scale from Repugnant through Resplendent. Potable and Decent results earn a fine Charm intent card, Great earns superior Insight, and Legendary or Resplendent earns exceptional Resolve. Serving consumes one food or drink, applies the patron's quality-specific price, and persists the actual deltas in `hospitality_events`. Dialogue consumes a chosen intent through `intent_card_plays`; the intent remains independent from the offered item. The brewery keeps production history. Existing Pour Ale rewards remain available as labeled legacy entitlements for standalone drinks and are never issued by new crafts.

Bakery timing uses `bake-v1`: red before 20 seconds or after 42, yellow from 20–28 and 34–42, and green from 28–34 around the 30-second ideal. Server time determines the band, and early or overbaked loaves can always be removed. See the [Bakery implementation record](plans/bakery-vertical-slice.md) for gesture scoring, quality, provenance, recovery, and authored pilot additions.

The bar keeps the entire unresolved command frozen after unknown outcomes. A retry cannot change recipient or inventory selection. A competing command returns a conflict and refreshes current stock. Read-only patron defaults work for existing saves; no reset or new tavern is required. See the [serving implementation record](plans/patron-serving-vertical-slice.md) for prices, card semantics, and draft story rules. Free-text dialogue is implemented; see the [consolidated technical specification](npc-dialogue.md) and [evaluation cases](evaluations/npc-dialogue.md).

## Database changes

Add schema or game-rule changes as new files in `supabase/migrations/`. Then run:

```sh
npm run db:reset:local
npm run --silent db:types > src/lib/database.types.ts
npm run db:types:check
npm run test:db
npm run test:integration
```

Versioned catalog rows and starter content belong in migrations so a blank hosted database receives them. Local identities and disposable failure scenarios stay in fixture or test code.

To upgrade an existing local save without deleting player data, run `DO_NOT_TRACK=1 supabase migration up --local`, then regenerate/check database types. Migrations can transform existing saves, so review and back up data you care about before applying a new migration. Reserve resets for an explicitly disposable demonstration or clean CI database.

## Hosted deployment

These slices have been verified locally and have not been deployed. A hosted pilot needs a Node-compatible SvelteKit host, a separate Supabase project, production values for the two public environment variables and the server-only Supabase/OpenAI credentials, allowed site/redirect URLs in Supabase Auth, migration application through a controlled deployment job, and securely provisioned pilot accounts. Run ownership, sign-in, harvest, brew, reward, day transition, reload, and second-session smoke tests after deployment. Never run the local reset or fixture scripts against hosted data.

## Dialogue configuration and recovery

Verified interface captures: [desktop dialogue and journal](screenshots/npc-dialogue.png), [mobile dialogue and journal](screenshots/npc-dialogue-mobile.png).

Keep credentials in the Git-ignored root `.env` with mode `0600`. Add `OPENAI_API_KEY` directly there, never to public-prefixed variables or chat. `npm run env:local` supplies the local `SUPABASE_SERVICE_ROLE_KEY` and preserves the provider key, custom model choices and other configuration. Restart the dev server after editing environment values if it has not reloaded them.

| Setting | Default / behavior |
| --- | --- |
| `NPC_PROVIDER` | `openai`; `local` explicitly returns not implemented. |
| `NPC_CONTEXT_MODEL` | `gpt-5.6-luna`: investigation, review, memory. |
| `NPC_CHARACTER_MODEL` | `gpt-5.6-terra`: deliberation and response. |
| `NPC_MAX_CALLS` | 8; may reduce the app cap, never exceed the database cap. |
| `NPC_INVESTIGATION_ROUNDS` | 2; clamped to 1–2. |
| `NPC_DEADLINE_MS` | 90000; clamped to 1000–90000, below the 120-second database lease. |

Only a trusted database operator may change the operational limits in `private.npc_rules`: six new turns/minute, 100 processing attempts/player/UTC day, 400 provider-call reservations/player/UTC day. Rules do not accept quota overrides from the browser. Provider usage/latency lives in stage checkpoints; sanitized IDs/error codes appear in server logs. Narrative evidence is private and should not be copied into public diagnostics.

Use **Check reply** after an unknown network result. **Retry the same message** keeps the entire request and resumes saved stages. **Cancel unfinished message** remains available while the reply is generating. It fences late requests and unlocks the day only after cancellation is confirmed. If the reply already committed, the UI reports the saved reply instead; if cancellation cannot be confirmed, use Check reply or cancel again. Completed retries return the saved result. A changed revision/day or unavailable NPC requires a fresh message. The status response disables retry after a rejected rewrite or exhausted unfinished turn; a fully checkpointed turn can still complete without more model calls. Persistent consistency failures should be cancelled and rephrased; replaying the same failed review does not request unlimited rewrites. A failed or expired turn never permanently prevents closing. Provider charges are not exactly-once when a network execution is uncertain; game effects are.

The live script records timestamped reports in ignored `artifacts/npc-evals/`; Playwright artifacts use `test-results/`. CI never invokes the live script. The browser test server uses a non-secret sentinel key only to render the form while all provider-bound dialogue requests are intercepted by the test harness. Unit and RPC fixtures are never imported by the production runtime.

## Editing and publishing character content

Edit `supabase/content/npcs.json`. The provenance field distinguishes prototype names/premises from new authored pilot details. Facts need stable IDs and explicit disclosure thresholds; skills and difficulty use 0–4; default plans end with attempt/abandon; terminal targets and character-loss warnings are authored explicitly.

For a published revision, change the top-level content version (for example, `npc-v2`) and generate a later migration:

```sh
npm run npc:content:migration -- --migration=202609080013_character_revision.sql
npm run npc:content:check
DO_NOT_TRACK=1 supabase migration up --local
```

Choose a filename later than every existing migration. Review the generated migration before applying. The database inserts immutable version rows before changing the current selector. It rejects overwrites and unknown version references. Existing characters retain their pinned version, preserving historical evidence and outcome rules; create a disposable new save to try revised content. Migrating existing characters to a newer authored version requires a separate explicit compatibility migration.

Prompt source and its version are in `src/lib/server/dialogue/prompts.ts`; structured provider-neutral schemas are alongside it. Bump the prompt version and rerun fixture/live evaluations when changing behavior. Database rule changes belong in additive migrations with a new version rather than rewriting a released ruleset.

A lost initial reservation response can leave a processing lease even though no model call started. Use status/cancel, or wait for the 120-second lease to expire; the integration suite verifies this recovery path. The keeper may view both journals, but NPC investigation cannot read another character’s private dialogue or private events.


### Inspecting dialogue context and plan precedence

New stage checkpoints include `inputContext`: payload character count, context version, source IDs, recent exchange IDs and a canonical digest. The `decision.contextWindow` contains the exact evidence shared by deliberation, speech and review, including across retries. JSONB key ordering does not change the digest. `npc-context-v1` preserves whole exchanges; its core limit is 30,000 characters and every model payload is capped at 40,000 characters. Large optional context drops oldest exchanges first, then oldest tool results, with omission counts recorded.

A `CONTEXT_BUDGET` failure consumes no new provider reservation for the rejected stage and applies no game effects. The keeper can cancel or close the day. Inspect authored-sheet size and saved mandatory context if it recurs; increasing provider token output limits does not fix an oversized input. Do not remove source qualifications or overwrite historical turns to force a prompt to fit.

Prompt `npc-prompts-v5` makes `effectiveIntention` authoritative over the previous plan in quest context and treats reviewer corrections as subordinate to the validated decision. A failed second review still rejects the entire turn. Both successful and failed live reports remain in ignored `artifacts/npc-evals/` for review.


Run `npm run npc:eval:review` for the opt-in six-case consistency-review calibration. It checks accepted plan changes, conditional assistance and future commitments against deliberate old-plan, same-night and fabricated-outcome contradictions. This sends six live review calls using the configured context model and writes a timestamped report under `artifacts/npc-evals/review-*.json`; it does not create or change player saves. A pass is agreement with the authored expected classifications, not a claim of perfect review accuracy.
