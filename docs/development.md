# Garden harvest development runbook

This repository contains the local garden-to-ingredient vertical slice for By Rook & Crook. Its durable path is:

> sign in → start a tavern → select a mature garden crop → harvest it → view the ingredient batch → verify the state after reload or another browser session

The app uses SvelteKit server loads and form actions, Supabase Auth, Postgres row-level security, and three public database functions. The browser never writes game tables directly. `create_tavern()` provisions one save and twelve cells, `get_tavern_snapshot()` reads an ownership-filtered snapshot, and `harvest_crop(...)` validates and commits a harvest atomically.

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

`pnpm env:local` obtains the local API URL and publishable key from the CLI and writes the gitignored `.env`. It refuses any host or port outside this repository's local stack. Runtime configuration uses only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no administrative key enters the SvelteKit runtime or browser bundle.

## Local pilot accounts

`pnpm fixtures:users:local` creates or refreshes two confirmed development users:

| Email | Password |
| --- | --- |
| `keeper.one@example.test` | `RookAndCrook-local-1!` |
| `keeper.two@example.test` | `RookAndCrook-local-2!` |

The fixture script asks the local CLI for a short-lived administrative connection, verifies `127.0.0.1:57321`, and refuses a hosted target. The credentials can be overridden with `LOCAL_PILOT_ONE_EMAIL`, `LOCAL_PILOT_ONE_PASSWORD`, `LOCAL_PILOT_TWO_EMAIL`, and `LOCAL_PILOT_TWO_PASSWORD` in `.env`.

Public sign-up is disabled. Hosted pilot accounts must be provisioned outside the browser flow.

## Demonstration

1. Sign in with either pilot account.
2. Submit **Start tavern**. Reload before starting if you want to verify that a GET does not create a save.
3. Select `c1`, the mature fennel plot beside the hive. The details panel previews two Legendary units, with brew +2 and bake +4 per unit.
4. Submit **Harvest crop**. The cell becomes empty and the save revision advances once.
5. Open **Ingredients** and verify the two-unit fennel batch.
6. Reload, return to the garden, sign out and in, or open the same account in another browser. The empty cell and ingredient batch remain.
7. Sign into the other pilot account to see an independent onboarding state.

The current reference captures are [garden](screenshots/garden.png) and [ingredients](screenshots/ingredients.png). With the dev server running, regenerate them using `pnpm screenshots`; the script provisions and removes its own user.

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
| `pnpm db:reset:local` | Destroy local application/auth data, reapply every migration, and run `supabase/seed.sql`. This cannot target a linked hosted project. |
| `pnpm fixtures:users:local` | Create or refresh the two local pilot identities. |
| `pnpm db:types` | Print TypeScript definitions generated from the migrated local public schema. |
| `pnpm db:types:check` | Generate types in memory and fail if they differ from `src/lib/database.types.ts`. |
| `pnpm check` | Run Svelte and TypeScript diagnostics. |
| `pnpm test:db` | Run 60 pgTAP assertions for rules, constraints, ownership, exact-once receipts, rollback, and grants. |
| `pnpm test:integration` | Use real Auth and parallel RPC requests to test initialization, replay, locking, isolation, and denied direct writes. |
| `pnpm test:e2e` | Run the persistent browser journey in desktop and mobile Chromium. |
| `pnpm screenshots` | Capture the garden and ingredient views against the running app. |

The complete local acceptance sequence is:

```sh
pnpm db:start
pnpm env:local
pnpm db:reset:local
pnpm fixtures:users:local
pnpm db:types:check
pnpm check
pnpm test:db
pnpm test:integration
pnpm test:e2e
pnpm build
```

Integration and browser tests create unique users and remove them after each run. Playwright starts the app when port 3000 is free and preserves traces and screenshots for failures under `test-results/` and `playwright-report/`.

## Transaction and recovery behavior

Every harvest carries the save ID, cell ID, expected revision, and a client-generated action UUID. The database locks the owned save before checking the action receipt. An identical retry returns the original receipt; reuse with different input conflicts; two commands for one revision cannot both commit. The crop clear, ingredient batch, revision increment, and receipt share one transaction.

The garden keeps an unresolved command in component state after a connection or unexpected server failure. Retrying reuses its action UUID and exact payload. A validation, conflict, or eligibility error refreshes the authoritative snapshot. Server diagnostics record the action ID, outcome code, committed revision when available, and duration; they do not record credentials or session tokens.

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

This slice has been verified locally and has not been deployed. A hosted pilot needs a Node-compatible SvelteKit host, a separate Supabase project, production values for the two public environment variables, allowed site/redirect URLs in Supabase Auth, migration application through a controlled deployment job, and securely provisioned pilot accounts. Run ownership, sign-in, harvest, reload, and second-session smoke tests after deployment. Never run the local reset or fixture scripts against hosted data.
