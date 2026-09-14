# Dev startup and unit-test performance diagnosis

Date: 2026-09-13. Investigated checkout: `aa756e7`.

This document records diagnosis and a remediation plan. Application code, tests,
migrations, and Git configuration have not been changed.

## Findings

`npm run brac-app:dev` reaches its database-test gate and correctly stops when
pgTAP fails. Two independent defects explain the supplied database output:

1. The platform test uses a submission fixture that predates the curated-setting
   and portrait requirements.
2. The portrait migration overwrites a previously corrected quarantine/purge
   function and restores behavior that retains world-NPC rows.

The slow unit suite has a separate cause: disposable Git repositories inherit
the developer's global commit-signing setting. Signing dozens of fixture commits
adds about 21 seconds to this machine's full unit run.

## Startup: outdated platform fixture

The focused feedback command reproduces the exact failure in approximately
2.6 seconds:

```sh
DO_NOT_TRACK=1 supabase test db --local supabase/tests/community_npc_platform.test.sql
```

```text
community_npc_platform.test.sql:41: ERROR: Choose a curated setting before submission
CONTEXT: PL/pgSQL function public.npc_author_submit(uuid,bigint) line 8 at RAISE
Planned 20 tests; reached 5.
```

At line 40, the test calls `npc_author_add_scene`. That legacy function creates
and selects a scene asset without the curated-library relationship. The final
`npc_author_submit` definition in migration
`202609120037_community_npc_portrait_assets.sql:453` requires a selected scene
linked to an active, verified curated setting. Its next check at line 455 also
requires a current, selected, valid portrait, which the fixture does not create.

A temporary copy using the current setting/portrait lifecycle cleared both
submission predicates and reached all 20 assertions. This also exposed stale
revision expectations and reviewer-queue assertions that count unrelated
submissions in the preserved database. The queue test must assert visibility of
its own submitted version, rather than assume the whole queue is empty or has
exactly one entry.

After correcting the revision expectation and scoping those visibility checks,
the temporary copy passed all 20 assertions in approximately 2.5 seconds against
the same preserved database. The transaction rolled back and the temporary file
was removed.

Remediation:

- Follow the deterministic fixture pattern in
  `supabase/tests/community_npc_authoring_experience.test.sql:62`: verify a
  curated setting through the service boundary, select it as the author, request
  a portrait, complete it with fixture metadata, then select the portrait.
- For this platform test's flow, setting selection advances revision 1 to 2;
  portrait selection advances 2 to 3. Submit with expected revision 3 and update
  the submitted-revision assertion accordingly. Portrait request with unchanged
  controls does not itself advance the revision.
- Scope both reviewer visibility assertions to the version created by the test.
  Preserve the owner-exclusion and unrelated-reviewer-visibility checks.
- Keep the current submission validation. Retain the existing negative coverage
  for missing, invalid, or stale setting/portrait inputs.

The incomplete TAP plan is a consequence of the uncaught SQL error. Reducing the
declared plan would conceal the failure rather than repair it.

## Startup: later migration regresses quarantine/purge

The focused feedback command reproduces the exact failure in approximately
2.2 seconds:

```sh
DO_NOT_TRACK=1 supabase test db --local supabase/tests/community_npc_purge.test.sql
```

```text
not ok 13 - quarantine removes the resident from every visible world projection
have: 1
want: 0
line 113: duplicate key value violates unique constraint
          "world_npc_instances_save_id_npc_id_key"
Planned 19 tests; reached 14.
```

Migration `202609120034_community_npc_purge.sql:214` defines the admin removal
function to invoke `private.npc_purge_visible_history`. The helper redacts related
history, writes tombstones, and deletes matching residents at line 87.

Migration `202609120037_community_npc_portrait_assets.sql:341` later replaces the
same public function. It updates portrait state, writes tombstones, and changes
resident status, but omits the purge helper and retains the resident rows. Direct
inspection of the installed database function confirmed this later definition.

The test quarantines the NPC at line 105 and correctly asserts resident absence
at line 107. The subsequent same-save reinsertion at lines 112–113 encounters
the retained row and violates the existing uniqueness constraint. The SQL abort
prevents the remaining five assertions from running.

A rollback-only differential temporarily combined the current portrait update
with the earlier purge-helper call, then executed the existing complete purge
test. All 19 assertions passed, including quarantine, reinsertion, retirement,
and ban. A post-rollback function inspection confirmed the temporary definition
did not persist.

Remediation:

- Add a new corrective migration defining the composed function: retain the
  current portrait handling, invoke `npc_purge_visible_history` for the removal
  reason, and preserve identity/timestamp updates and reviewer authorization.
- Verify the composition with portrait redaction and deletion-target behavior.
- Preserve the uniqueness constraint and the existing resident-removal
  assertion. The assertion already catches the real regression.
- Apply the new migration through the normal pending-migration path. Editing
  migration 037 alone will not update databases that have already recorded it;
  the launcher preserves those databases.

## Unit performance: inherited signing in Git fixtures

The test helper in `tests/unit/media-git-policy.test.ts:11` invokes Git with the
inherited environment/configuration. The repository helper at lines 19–28 creates
a fresh repository and commits a baseline; `commitFile` at lines 31–36 creates
additional commits. The developer's global configuration has
`commit.gpgSign=true`, so these disposable commits are signed.

Measured constituent costs:

- Tiny signed commits: approximately 260–270 ms each.
- The same fixture commit with `-c commit.gpgSign=false`: approximately 10 ms.
- A representative boundary scenario spent about 82% of its measured time in
  repository/commit setup, 13% in policy checks, and under 1% in cleanup.
- A small video scenario launched 20 Git processes: nine fixture operations and
  eleven checker operations. Sixteen extension cases repeat this pattern.

The complete baseline and controlled differential both passed all 180 tests in
23 files:

| Measurement | Inherited signing | Signing disabled for diagnostic command | Reduction |
| --- | ---: | ---: | ---: |
| Media policy file, 28 tests | 29.555 s | 8.898 s | 70% |
| Full Vitest duration | 30.44 s | 9.57 s | 69% |
| Full command wall time | 32.24 s | 11.27 s | 65% |

Commands used:

```sh
/usr/bin/time -f 'WALL_SECONDS=%e' npm run test:unit -- \
  --reporter=default --reporter=json \
  --outputFile.json=/tmp/brac-diag-unit-results.json

env GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=commit.gpgSign GIT_CONFIG_VALUE_0=false \
  /usr/bin/time -f 'WALL_SECONDS=%e' npm run test:unit -- \
  --reporter=default --reporter=json \
  --outputFile.json=/tmp/brac-diag-unit-unsigned-results.json
```

These runs used Node 26.8.1 and npm 11.19.0. The command-scoped override was an
experimental control, not a saved configuration change. Global signing remains
enabled. The other test files finished in approximately 1.73 seconds or less
during the original parallel run.

Remediation, in order:

1. Make disposable fixture commits explicitly unsigned, for example by passing
   `-c commit.gpgSign=false` from the fixture Git helper. Keep normal developer
   and repository signing settings unchanged.
2. Optionally combine the sixteen extension cases into one temporary repository,
   one committed range, and one policy check, asserting every expected path and
   violation. Preserve separate history, rename/copy, staged-index, and boundary
   cases. Measure this additional change separately; its benefit was not
   measured in this investigation.
3. Consider batching checker subprocesses only if the remaining runtime warrants
   it. The first improvement already addresses the dominant measured cause.

Avoid a brittle wall-clock unit assertion. If adding regression coverage for the
fixture helper, use a child Git configuration with signing enabled and verify
that disposable commits still succeed without invoking a signer. Keep runtime
measurements as benchmark evidence.

## Implementation and acceptance sequence

1. Repair the platform fixture and queue isolation; run its focused pgTAP file.
2. Add the composed quarantine/purge migration; run the purge file and the
   adjacent portrait lifecycle coverage. Keep all existing assertions.
3. Isolate fixture commit signing; run the media-policy file and the full unit
   suite, retaining all 180 behavioral checks.
4. Run the complete `npm run test:db` against the migrated preserved database.
5. Finally run `npm run brac-app:dev` and verify it gets past database/RPC gates
   and serves `/login`. The launcher runs units at
   `scripts/brac-app-dev.ts:268`, database tests at line 299, and starts Vite only
   afterward. Its gating and cleanup behavior need no change for these bugs.

Fixes and post-fix acceptance are planned, not applied. SQL experiments ran in
transactions that rolled back, and temporary source/harness files were removed.
The preserved local stack was started for targeted reproduction, then stopped
with backups retained, restoring its initially stopped state. The only repository
addition is this report.
