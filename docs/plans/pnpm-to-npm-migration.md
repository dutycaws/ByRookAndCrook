# Replace pnpm with npm

Status: implemented locally on 2026-09-08 on `gpt6-first-pass`. The original execution plan is retained below; verification results follow. No changes have been pushed.

Replace the package manager for local development and CI while keeping the application behavior and direct dependency versions stable. Carry out the work on the existing local branch, `gpt6-first-pass`, preserving its current uncommitted changes.

The repository has one root package. `pnpm-workspace.yaml` lists only `.` and configures `engineStrict: true` and permission for esbuild's install scripts. There are no workspace dependencies, catalogs, patches, or dependency overrides to translate. CI pins Node 22.20.0 and pnpm 11.19.0. The current local environment already has Node 22.20.0 and npm 11.18.0.

## 1. Record the starting state

- Record the current branch, changed files, and tool versions. Preserve the pre-migration contents of files that already contain unrelated edits; rollback must restore those contents rather than blindly restoring from HEAD.
- Save a dependency inventory from `pnpm-lock.yaml` for comparison with the new npm lockfile. Direct dependencies are exactly pinned; transitive dependencies can still resolve differently.
- Establish a baseline with the current install: application checks, unit tests, and a production build. Record existing failures separately from migration failures.
- Keep local `.env` values and saved game data in place. Use a disposable validation copy and Supabase stack for any fresh database reset; the test helpers currently require port 57321, so account for that constraint when isolating the stack.

Completion: the current state and any pre-existing failures can be distinguished from the migration diff.

## 2. Translate package-manager configuration

In `package.json`, change `packageManager` to `npm@11.18.0`, remove `engines.pnpm`, and declare `engines.npm` as `11.18.0`. Keep the verified Node 22.20.0 pin in CI and the runbook. Review the existing broad Node engine range against the installed dependencies when finalizing the configuration; Vite and Vitest already require more than Node 22.0.0.

Add a project `.npmrc` with:

```ini
engine-strict=true
strict-allow-scripts=true
```

Translate the existing esbuild build permission to the npm 11.18.0 project policy:

```json
"allowScripts": {
  "esbuild": true
}
```

The installed npm supports these settings. Review any additional dependency scripts identified by the clean installation and record explicit decisions for them. Verify that the root `prepare` script still runs `svelte-kit sync`; disabling all scripts would also affect project setup. npm documents the project policy and strict handling in its [install configuration](https://docs.npmjs.com/cli/v11/commands/npm-ci/#allow-scripts).

Remove `pnpm-workspace.yaml` after translating its settings. No npm workspace declaration is needed for this single package. Keep dependency versions and the existing script bodies unless a body actually invokes pnpm.

Completion: npm is declared consistently and both existing install policies have a deliberate equivalent.

## 3. Generate and verify the npm lockfile

- Move aside the existing pnpm-managed `node_modules` before generating the npm dependency tree. Keep the old lockfile available for comparison.
- With npm 11.18.0, run `npm install` to create `package-lock.json` and a fresh installation.
- Compare the resulting direct versions and transitive package versions with the recorded pnpm inventory. Investigate peer dependency conflicts and significant version changes; resolve their causes instead of adding blanket `--force` or `--legacy-peer-deps` flags.
- Check the platform-specific dependencies used by esbuild, Tailwind, and Vite on the local machine and Ubuntu validation environment.
- Run `npm ls --all`, then `npm ci`. Confirm there are no missing or invalid dependencies, installation succeeds from the new lockfile, and the lockfile content does not change.
- Remove `pnpm-lock.yaml` from the final migration diff once the npm installation is validated.

`npm ci` requires an existing npm lockfile, replaces the installed dependency tree, and fails on a manifest/lockfile mismatch without rewriting the lockfile. Use it for subsequent clean setup and CI. See [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

Completion: `package-lock.json` is the single active lockfile and clean installs are reproducible.

## 4. Update executable commands and troubleshooting messages

Change `playwright.config.ts` from `command: 'pnpm dev'` to `command: 'npm run dev'`. Update pnpm instructions embedded in `scripts/check-database-types.ts`, `scripts/show-local-credentials.ts`, `scripts/seed-local-users.ts`, and `tests/helpers/local-supabase.ts`.

Use these translations throughout the repository:

| Existing command | npm command |
| --- | --- |
| `pnpm install --frozen-lockfile` | `npm ci` |
| `pnpm check` | `npm run check` |
| `pnpm dev` | `npm run dev` |
| `pnpm exec vitest run tests/unit` | `npm exec -- vitest run tests/unit` |
| `pnpm exec playwright install --with-deps chromium` | `npm exec -- playwright install --with-deps chromium` |
| `pnpm env:local -- --rotate` | `npm run env:local -- --rotate` |
| `pnpm npc:content:migration --migration=<filename>` | `npm run npc:content:migration -- --migration=<filename>` |
| `pnpm db:types > src/lib/database.types.ts` | `npm run --silent db:types > src/lib/database.types.ts` |

The `--` separator forwards flags to the underlying script, as described in [npm run](https://docs.npmjs.com/cli/v11/commands/npm-run/). Use `--silent` for database type generation so npm's script banner cannot become part of the TypeScript file. First verify generated output in a temporary file before replacing the existing types.

Completion: application startup, test startup, script flags, and generated output work through npm.

## 5. Update CI without changing its coverage

In `.github/workflows/ci.yml`:

- Remove `pnpm/action-setup`.
- Retain `actions/setup-node@v4` with Node 22.20.0; change its cache to `npm` and set `cache-dependency-path: package-lock.json`.
- Install the selected npm version with `npm install --global npm@11.18.0` after Node setup and before project installation. Print Node and npm versions for diagnostics; the package-manager field alone does not install the requested npm version.
- Replace the dependency installation with `npm ci`.
- Translate every script invocation to `npm run ...` and local binary invocation to `npm exec -- ...`, including Supabase cleanup in the `always()` step.
- Retain the Supabase version, test sequence, failure artifact uploads, timeouts, and production build.

The existing action supports npm cache keys based on the npm lockfile. See [setup-node v4 caching](https://github.com/actions/setup-node/blob/v4/docs/advanced-usage.md#caching-packages-data).

Completion: every existing CI stage has an npm equivalent with the same coverage and cleanup behavior.

## 6. Refresh the development instructions

Update `docs/development.md`, runnable instructions in `docs/evaluations/npc-dialogue.md` and `docs/plans/`, `.env.example`, and the fixture command comment in `supabase/seed.sql`. Check the README's setup links for consistency. Keep historical incident evidence accurate: preserve recorded pnpm versions and commands as historical facts, with a note directing readers to the current npm instructions where helpful.

Document npm 11.18.0 setup, `npm ci` for a checkout, `npm install <package>` for dependency changes, and `npm run <script>` for project commands. Preserve argument separators in migration and evaluation examples. Remove the pnpm-specific `.pnpm-store` ignore entry if it is no longer needed locally; retain all existing secret and generated-output exclusions.

Completion: a developer following the current runbook can set up and operate the project without pnpm.

## 7. Run acceptance checks and review the local diff

After the clean npm installation, run:

```sh
npm run check
npm run npc:content:check
npm exec -- vitest run tests/unit
npm run build
```

Against a prepared local validation database, run the existing CI sequence for secret placement, generated types, database assertions, RPC integration, and browser journeys:

```sh
npm run secrets:audit
npm run db:types:check
npm run test:db
npm run test:integration
npm exec -- playwright install --with-deps chromium
npm run test:e2e
```

Run browser verification with port 3000 available so Playwright starts the server using the changed npm command. Retain the existing fixture provider configuration; billable live NPC evaluations are not required to validate this package-manager migration. Run the translated workflow in a clean Ubuntu environment locally when available; a hosted CI result will require a later push and must not be reported as completed during local-only work.

Check flag forwarding without rotating real credentials or publishing new NPC content just for a smoke test. Confirm silent database type output contains only the generated TypeScript. Search maintained source and configuration for remaining active pnpm commands, treating this migration plan and historical records separately. Run `git diff --check` and review only the migration changes against the recorded starting state.

Acceptance criteria:

- npm 11.18.0 installs the project through `npm ci` without pnpm or a pnpm-created `node_modules` tree.
- The new lockfile is stable, direct dependency pins are preserved, and any transitive changes are explained.
- Install policies, SvelteKit preparation, and native build dependencies work.
- All baseline checks and existing CI test stages pass, or pre-existing/environment failures are explicitly identified.
- Playwright launches the app through npm; current setup instructions and diagnostic commands use npm.
- Only the intended migration diff is added to `gpt6-first-pass`; existing application and raven-icon changes are preserved. No push or deployment is part of this plan.

Rollback: restore the pre-migration versions of the package settings, pnpm lockfile/workspace file, CI, scripts, and documentation; remove only the newly added npm configuration and lockfile; recreate dependencies with the original pnpm toolchain and frozen lockfile. Do not use a broad reset of the working tree or reset the developer database.


## Execution results — 2026-09-08

- Migrated to npm 11.18.0 and retained the CI Node 22.20.0 pin. The Node engine range now reflects the existing Vite/Vitest requirements: `^22.20.0 || ^24.0.0 || >=26.0.0`.
- Added strict engine and dependency-script enforcement. Approved esbuild and explicitly denied the optional macOS fsevents install script, preserving the prior esbuild-only permission policy. macOS behavior was not exercised on this Linux host.
- Replaced both pnpm files with `package-lock.json`. All 217 distinct package/version pairs match the prior lockfile; there were no dependency version additions or removals.
- Fresh `npm install`, `npm ci`, and a second `npm ci` in a separate directory without an existing dependency tree or SvelteKit output passed. The root prepare hook ran successfully and lockfile bytes remained unchanged. `npm ls --all` passed.
- Svelte/TypeScript: zero errors or warnings. NPC content check, 10 unit tests, 230 database assertions, 25 integration tests, and the production build passed.
- Secret audit and generated database type verification passed. Silent type generation matched the existing file byte for byte. An intentionally invalid migration filename confirmed npm forwards script flags without creating a migration.
- Playwright started the server through `npm run dev` with CI server-reuse disabled. The first run passed 19 of 20 desktop/mobile cases; the committed-reply cancellation case timed out while logging in, before reaching dialogue behavior. That single case passed on immediate retry. No application or test behavior was changed to hide the failure. The full suite did not pass in one run.
- npm audit reported three low-severity findings involving cookie, SvelteKit, and adapter-node in the unchanged dependency set. Dependency upgrades remain separate work.
- The existing local Supabase stack was used without a reset. Tests created and cleaned up their own fixtures. Hosted GitHub Actions were not run because the work remains local.
