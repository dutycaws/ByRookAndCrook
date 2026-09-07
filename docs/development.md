# Local MVP development runbook

This repository contains two connected SvelteKit and Supabase vertical slices for By Rook & Crook. Their durable path is:

> sign in → start a tavern → harvest a mature crop → choose the ingredient in the brewery → stir for 30 seconds → bottle the beverage → earn a quality-based social card → begin the next tavern day

The app uses SvelteKit server loads and form actions, Supabase Auth, Postgres row-level security, and six public database functions. The browser never writes game tables directly. `create_tavern()` provisions one save and twelve cells, `get_tavern_snapshot()` reads one ownership-filtered game snapshot, and the harvest and craft commands validate and commit their outcomes atomically.

## Verified local toolchain

- Node.js 22.20.0
- pnpm 11.19.0
- Supabase CLI 2.114.0
- Docker Engine with Compose support
- Playwright 1.63.0 with Chromium

The JavaScript package versions and pnpm version are pinned in `package.json` and `pnpm-lock.yaml`. Supabase CLI is intentionally a host prerequisite because it manages the local Docker stack.

## First-time setup

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm env:local
pnpm db:reset:local
pnpm fixtures:users:local
pnpm secrets:audit
pnpm exec playwright install chromium
pnpm dev
```

Open `http://127.0.0.1:3000/login`. The local Supabase services use project-specific ports so they can coexist with another local stack:

| Service | Address |
| --- | --- |
| API and Auth | `http://127.0.0.1:57321` |
| Postgres | `127.0.0.1:57322` |
| Studio | `http://127.0.0.1:57323` |
| Mailpit | `http://127.0.0.1:57324` |

`pnpm env:local` obtains the local API URL and publishable key from the CLI, generates local passwords, and writes everything to the gitignored `.env`. It refuses any host or port outside this repository's local stack. Runtime configuration uses only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no administrative key enters the SvelteKit runtime or browser bundle.

`.env` is the repository's sole project-managed secret file and is written with owner-only permissions. `.env.example` contains variable names and non-secret placeholders only. Supabase CLI may generate local container credentials under its ignored `supabase/.temp/` runtime directory; application code does not read that directory. Run `pnpm secrets:audit` to verify there are no more than two project-managed secret files, each is ignored and permission-restricted, and configured secret values do not occur in tracked files. Use `pnpm env:local -- --rotate` to rotate all generated local passwords.

## Local pilot accounts

`pnpm fixtures:users:local` creates or refreshes two confirmed development users. Their emails are `keeper.one@example.test` and `keeper.two@example.test`; retrieve the generated passwords with:

```sh
pnpm credentials:local
```

The fixture script asks the local CLI for a short-lived administrative connection, verifies `127.0.0.1:57321`, and refuses a hosted target. The credentials can be overridden with `LOCAL_PILOT_ONE_EMAIL`, `LOCAL_PILOT_ONE_PASSWORD`, `LOCAL_PILOT_TWO_EMAIL`, and `LOCAL_PILOT_TWO_PASSWORD` in `.env`.

Public sign-up is disabled. Hosted pilot accounts must be provisioned outside the browser flow.

## Demonstration

1. Sign in with either pilot account.
2. Submit **Start tavern**. Reload before starting if you want to verify that a GET does not create a save.
3. Select `c1`, the mature fennel plot beside the hive. The details panel previews two Legendary units, with brew +2 and bake +4 per unit.
4. Submit **Harvest crop**. The cell becomes empty and the save revision advances once.
5. Open **Ingredients** and verify the two-unit fennel batch.
6. Open **Brewery**, choose the fennel, and begin the daily brew. Keep the slider in the green sweet spot for the 30-second timer, then bottle it.
7. Verify the beverage name and quality. A Potable or better beverage also creates a **Pour Ale** social card; its relationship and gold effects rise with beverage quality.
8. Reload or sign into the same account in another browser. The consumed ingredient unit, bottled beverage, earned card, and completed day remain.
9. Submit **Rest and begin next day**. Day two allows one new brew while retaining cellar history.
10. Sign into the other pilot account to see an independent onboarding state.

The current reference captures are [garden](screenshots/garden.png), [ingredients](screenshots/ingredients.png), [brew setup](screenshots/brewery-setup.png), [active stirring](screenshots/brewery-active.png), and [brew result](screenshots/brewery-result.png). With the dev server running, regenerate them using `pnpm screenshots`; the script provisions and removes its own user.

The starter crops are finite. Starting an existing tavern never refills harvested cells. Use the explicit local reset when you need the original demonstration state.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the SvelteKit development server on port 3000. |
| `pnpm build` | Create the adapter-node production build. |
| `pnpm preview` | Run the built Node server. |
| `pnpm db:start` | Start this repository's local Supabase stack. |
| `pnpm db:stop` | Stop the local stack without deleting its database volume. |
| `pnpm db:status` | Show local endpoints and service state. |
| `pnpm env:local` | Safely write `.env` from this local stack. |
| `pnpm credentials:local` | Print the two local pilot credentials from the ignored `.env` file. |
| `pnpm secrets:audit` | Verify secret-file count, Git ignore coverage, and absence of configured secrets in tracked files. |
| `pnpm db:reset:local` | Destroy local application/auth data, reapply every migration, and run `supabase/seed.sql`. This cannot target a linked hosted project. |
| `pnpm fixtures:users:local` | Create or refresh the two local pilot identities. |
| `pnpm db:types` | Print TypeScript definitions generated from the migrated local public schema. |
| `pnpm db:types:check` | Generate types in memory and fail if they differ from `src/lib/database.types.ts`. |
| `pnpm check` | Run Svelte and TypeScript diagnostics. |
| `pnpm test:db` | Run 118 pgTAP assertions for garden and brewery rules, constraints, ownership, exact-once receipts, rollback, and grants. |
| `pnpm test:integration` | Use real Auth and parallel RPC requests to test initialization, harvest and craft replay, locking, isolation, rewards, and denied direct writes. |
| `pnpm test:e2e` | Run the persistent garden and brewery journeys in desktop and mobile Chromium. |
| `pnpm screenshots` | Capture the garden, ingredient, brew setup, stirring, and result views against the running app. |

The complete local acceptance sequence is:

```sh
pnpm db:start
pnpm env:local
pnpm db:reset:local
pnpm fixtures:users:local
pnpm secrets:audit
pnpm db:types:check
pnpm check
pnpm test:db
pnpm test:integration
pnpm test:e2e
pnpm build
```

Integration and browser tests create unique users and remove them after each run. Playwright starts the app when port 3000 is free and preserves traces and screenshots for failures under `test-results/` and `playwright-report/`.

## Command, transaction, and recovery behavior

Every harvest or craft command carries the save ID, expected revision, and a client-generated action UUID. Commands also carry only the cell, ingredient, brew session, or bounded stirring telemetry they require. The database derives the player from `auth.uid()`, locks the owned save before checking the action receipt, and calculates canonical outcomes from saved state. An identical retry returns the original receipt; reuse with different input conflicts; two commands for one revision cannot both commit.

The harvest transaction clears the crop, creates the ingredient batch, advances the revision, and writes its receipt together. Starting a brew creates one session for the current tavern day. Completing it consumes one ingredient unit, freezes the stirring score and quality, creates the beverage and optional social card, marks the daily craft complete, advances the revision, and writes its receipt in one transaction. Advancing the day requires a completed daily craft and reopens the minigame exactly once.

The garden and brewery keep an unresolved command in component state after a connection or unexpected server failure. Retrying reuses its action UUID and exact payload. A validation, conflict, or eligibility error refreshes the authoritative snapshot. Server diagnostics record the action ID, outcome code, committed revision when available, and duration; they do not record credentials or session tokens.

The server enforces the 30-second brew duration. The client samples stirring speed every 250 ms, with 42–58 as the perfect band and 30–70 as the wider good band. The submitted counts are range checked and affect a six-point stirring score. Final quality combines the saved ingredient quality with that score and applies the saved brew bonus threshold. Reloading an active brew preserves its timer but discards prior in-memory samples, so missing samples lower its final score. This is acceptable for the pilot; durable event sampling or anti-cheat validation belongs in a later online-competition design.

Quality uses the shared seven-tier scale from Repugnant through Resplendent. Potable and Decent results earn a fine Pour Ale card, Great earns superior, and Legendary or Resplendent earns exceptional. The database stores both the reward tier and its concrete relationship/gold effects so later serving can consume a stable result.

## Database changes

Add schema or game-rule changes as new files in `supabase/migrations/`. Then run:

```sh
pnpm db:reset:local
pnpm db:types > src/lib/database.types.ts
pnpm db:types:check
pnpm test:db
pnpm test:integration
```

Versioned catalog rows and starter content belong in migrations so a blank hosted database receives them. Local identities and disposable failure scenarios stay in fixture or test code.

## Hosted deployment

These slices have been verified locally and have not been deployed. A hosted pilot needs a Node-compatible SvelteKit host, a separate Supabase project, production values for the two public environment variables, allowed site/redirect URLs in Supabase Auth, migration application through a controlled deployment job, and securely provisioned pilot accounts. Run ownership, sign-in, harvest, brew, reward, day transition, reload, and second-session smoke tests after deployment. Never run the local reset or fixture scripts against hosted data.
