# CI initialization failure remediation

Status: diagnostic remediation and initialization contract implemented; original failure investigation remains open.

## Evidence

Inspected the authenticated GitHub Actions job logs and run metadata on 2026-09-07:

- [Run 34164596116, job 101873033651](https://github.com/dutycaws/ByRookAndCrook/actions/runs/34164596116/job/101873033651?pr=1), attempt 1, PR #1.
- Head commit: `efe35d9971ac5ba15291f2d41fac74b432fe7870`, branch `gpt6-first-pass`.
- Failed step: **Test real RPC concurrency**, running `pnpm test:integration`.
- Failed test: `garden harvest RPC > initializes once and commits identical retries exactly once` in `tests/integration/harvest-rpc.test.ts:26`.
- Result: **one failed, three passed**. Both brewery integration tests and the other harvest integration test passed.
- Dependency installation, Supabase startup/reset, secret audit, generated database types, application checks, and database tests passed. Chromium installation, browser tests, and production build were skipped after the integration failure; this run provides no verdict on them.
- The browser artifact upload found no evidence to upload. The run's artifact list is empty.

The failure occurs immediately after two concurrent `create_tavern` requests:

```ts
const created = await Promise.all([
  player.client.rpc('create_tavern'),
  player.client.rpc('create_tavern')
]);
expect(created.every(({ error }) => error === null)).toBe(true);
```

At least one request returned a non-null error. The assertion reports only `expected false to be true`, losing which request failed, HTTP status, RPC error code, and message. The test never reached its snapshot or harvest assertions. There is no evidence here of duplicate harvest rewards or a failed brewery transaction.

## Diagnosis and limits

**Confirmed:** concurrent tavern initialization returned an error in CI, and the test's diagnostics are insufficient to identify its cause.

**Not established:** a PostgreSQL race, authentication failure, PostgREST/schema-cache readiness failure, or transport failure. Do not label any of these the root cause without an error response or server evidence.

The existing `create_tavern` function in migration `202609070001_garden_harvest_slice.sql` inserts a save with `ON CONFLICT (user_id) DO NOTHING`, seeds the twelve cells only when insertion succeeds, and otherwise reads the existing save ID. These operations share one transaction. This already addresses basic duplicate initialization; static inspection does not justify adding a lock or rewriting the upsert alone. PostgreSQL documents that a competing insert can suppress an `ON CONFLICT DO NOTHING` insertion and that subsequent statements at Read Committed can observe committed changes. See [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

A temporary diagnostic harness ran **20 fresh-user trials, each with two concurrent creation requests**, against the running local stack. All 40 requests succeeded and every subsequent snapshot contained twelve cells. Each diagnostic user was deleted afterward. Node `22.20.0`, pnpm `11.19.0`, and Supabase CLI `2.114.0` match the workflow's pins.

This does not reproduce a clean GitHub runner: the local database is warm and includes the uncommitted serving migration. The original initialization migration, helper, harvest integration test, and workflow are unchanged from the failed commit. Local success does not invalidate the CI failure.

## Remediation sequence

### 1. Make the next failure actionable

Files: `tests/integration/harvest-rpc.test.ts`, `.github/workflows/ci.yml`; add a small test diagnostic helper only if reused.

- Replace the aggregate boolean assertion with per-response assertions that identify the call index and expose a sanitized `{ status, code, message, details, hint }` error summary. Do not log clients, sessions, request headers, environment values, passwords, or tokens.
- Preserve both responses before asserting so a first failure does not conceal the second result.
- Configure Vitest to emit its normal console output plus a machine-readable integration report, for example JUnit under `test-results/integration/`.
- Upload the integration report on failure before stopping Supabase. The current browser-only artifact path cannot explain a failure before Playwright runs.
- If service logs are needed, collect bounded, sanitized Postgres/PostgREST diagnostics before teardown. Avoid indiscriminate environment or container inspection dumps. Keep generated evidence ignored by Git.

Acceptance: a deliberately failed diagnostic assertion clearly identifies its RPC and error code/status; the failure remains red and produces a downloadable report.

### 2. Reproduce with the CI baseline

- Use an isolated checkout of `efe35d9`, with only diagnostic changes, and a disposable Supabase project/stack. Match the pinned tool versions and frozen lockfile.
- Run the workflow sequence, including reset, on that disposable stack. Do not reset the developer's existing tavern database or discard the uncommitted serving slice.
- Run the full integration suite under normal file parallelism to preserve the CI conditions. Also isolate concurrent initialization to distinguish interactions with other suites.
- Exercise a bounded batch of fresh-user concurrent initializations after cold startup and again after warmup, recording both responses. Use independent authenticated clients as an additional check of actual simultaneous HTTP requests.
- Preserve the first failing error and nearby service diagnostics. If no local reproduction occurs, push the diagnostic change as a normal PR update and inspect a new CI run. Re-running the old commit alone cannot recover the discarded error details.

Acceptance: obtain a classified RPC failure or explicitly record that the cause remains unconfirmed. A green rerun alone is not a root-cause finding.

### 3. Apply the smallest evidence-supported correction

| Observed evidence | Remediation |
| --- | --- |
| SQLSTATE for a constraint violation, deadlock, or serialization failure | Reproduce the precise transaction interleaving. Correct the identified database operation in a new additive migration. If same-user initialization needs serialization, lock a stable per-user resource before creation and seed selection; retain one atomic transaction and user isolation. Do not introduce a global lock. |
| PostgREST function/schema-cache unavailable or service unavailable | Add a bounded post-reset readiness check for the affected API, with explicit timeout and diagnostic output. Do not replace it with a fixed sleep. |
| Authentication/authorization error | Verify sign-in success and session propagation in the test helper and independent clients; correct the identified token/session handling. Keep RLS and production authentication checks intact. |
| Connection reset/timeout or other transport error | Correlate with runner/service health and resource pressure. Fix readiness or the demonstrated resource issue. Consider narrowly bounded retries only for a classified transient operation whose idempotency is tested. |

Do not serialize the entire suite, remove the concurrent calls, weaken the assertion, or enable blanket test retries to obtain a green check. Do not edit an already-applied migration as the only database fix. If needed after the current local migrations, use a new migration such as `202609070004_create_tavern_concurrency_fix.sql`.

### 4. Strengthen the initialization contract

Split concurrent initialization and harvest replay into distinct tests so a setup failure is accurately named. Retain the existing harvest replay assertions.

For a fresh user's concurrent initialization, assert:

- Every response succeeds and returns the same non-null save ID.
- Exactly one response has `created: true`; the others have `created: false`.
- Exactly one save exists for that user, with revision zero and twelve unique garden cells matching the starter layout.
- A later creation request returns the same ID without reseeding. Include an already-harvested cell to demonstrate that retries preserve progress.
- Another user's initialization remains independent, and unauthenticated execution/direct player writes remain denied.

Where a database fix is required, add deterministic coverage for its confirmed failure mode; use independent database transactions or HTTP requests for genuine concurrency. A sequence of pgTAP calls in one transaction cannot establish concurrent behavior. Keep temporary users isolated and verify cleanup succeeds.

### 5. Validate and close

- Run the targeted regression, then the full integration suite with normal parallelism and no automatic retries.
- Run `pnpm test:db`, `pnpm check`, `pnpm db:types:check`, `pnpm secrets:audit`, `pnpm test:e2e`, and `pnpm build` on the final candidate.
- Validate both a clean disposable database and an additive upgrade if SQL changes are needed.
- With the current serving work included, the baseline is 160 database assertions, seven integration tests, and ten desktop/mobile browser tests; update expected counts for any new tests. The failed commit itself had four integration tests.
- Push the final candidate through PR CI and verify browser tests and the build actually execute and pass. Link the successful run and record the diagnosed cause and correction here.

Completion requires a verified correction for the observed cause and a fully passing CI run. If diagnostics improve but the cause cannot be reproduced or classified, record that limitation and keep the failure investigation open.


## Implementation record — 2026-09-07

Implemented per-call, bounded RPC error summaries containing HTTP status, code, message, details, and hint. Every failed assertion preserves the summaries for the entire concurrent batch. Configured secret values, bearer tokens, JWTs, Supabase keys, and email addresses are redacted; response data and client/session objects are excluded. A unit regression verifies that both failures survive sanitization.

`pnpm test:integration` now emits console output and `test-results/integration/junit.xml`. CI uploads integration evidence immediately after a failure, before browser execution or Supabase teardown. Generated evidence remains covered by the existing `test-results/` ignore rule. A real failing assertion during test development produced the expected status/code and a JUnit report; the test incorrectly used an unprivileged service-role table read and was corrected to use the player's existing SELECT permissions.

Initialization and harvest replay are separate tests. Initialization runs with both a shared client (the original CI pattern) and independent authenticated clients. It checks one common save ID, exactly one creation receipt, one revision-zero save, twelve unique cells with the complete starter layout, progress preservation after harvesting and retrying creation, independent user creation, and denied anonymous execution/direct inserts. Harvest replay and competing-action assertions remain. Initialization test cleanup verifies deletion responses; the player helper also deletes a newly created user if sign-in fails.

Validation of the current working tree, including the pre-existing serving work: 160 database assertions, nine integration tests with normal file parallelism and no retries, one diagnostic unit test, and ten desktop/mobile browser tests passed. Application checks, generated database types, secret audit, and production build passed.

An isolated export of `efe35d9` uses disposable project `tavern-ci-remediation`, API port 58321 and separate database/service ports. Node 22.20.0, pnpm 11.19.0, Supabase CLI 2.114.0 and a fresh frozen-lockfile installation match CI. Only test diagnostics/contract coverage and disposable-stack addressing differ from the baseline; application code and migrations are unchanged. The developer database was not reset. After startup/reset, fixture creation, secret audit, type verification, application checks, 118 baseline database assertions and five integration tests passed.

No failure of concurrent `create_tavern` has yet been classified. No SQL migration, readiness delay, global serialization, or retry policy was added. Passing local checks do not establish the original root cause. CI verification and the investigation outcome are recorded below when available.

A second clean reset exercised the original four integration tests with only the aggregate creation assertion replaced by diagnostics, alongside a ten-user initialization probe under normal file parallelism. All passed. Ten more fresh-user trials passed in isolation on the warm stack. Across both batches all 40 creation responses succeeded; half the trials used independent authenticated clients. Every trial checked a common save ID, exactly one `created: true` receipt and twelve cells. All user deletions succeeded and a database query confirmed zero remaining probe users. The disposable stack was stopped afterward.

Commit `4c189ef` contains only remediation changes; the pre-existing serving slice remains uncommitted in the developer checkout. [PR CI run 34166799619](https://github.com/dutycaws/ByRookAndCrook/actions/runs/34166799619) passed for that commit, including browser tests and the production build (neither was skipped). Consequently remote test counts exclude serving coverage, which was validated locally as described above.

Outcome: diagnostic remediation and regression coverage are validated locally and in PR CI. The original RPC failure remains unconfirmed and the investigation stays open. No evidence-supported database/authentication/readiness correction could be selected because the failure did not recur. A future occurrence will retain both sanitized RPC responses and an integration artifact; a green run is not treated as a root-cause finding.
