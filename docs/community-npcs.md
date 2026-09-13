# Community NPC prototype

Issue 18 replaces the fixed Bar roster with versioned, UUID-addressed NPCs that creators can author, reviewers can publish, and tavern saves can receive and progress independently. This is a local prototype. Reset the local Supabase database when the schema changes; there is no hosted or production migration target.

## Runtime model

An NPC identity owns a sequence of immutable versions. A creator edits one draft at a time, and submission freezes that draft into a version. Review publication makes the version eligible for future world assignments. Existing residents remain pinned to the exact version assigned when they arrived.

Each tavern save begins with UUID-backed Lira Nightwind and Torvin Ashbeard. The current capacity is `communityNpcLevel + 1`, with a minimum of two. Dawn resolves one eligible step for every active resident, applies all same-dawn level gains, and then admits at most one eligible community NPC. The arrival receipt stores the candidate count, draw, selected identity, and version so a retry cannot resample.

The Bar opens with `npc_bar_summary()`, a bounded projection containing save state, offerings, recent hospitality, recent news, and the latest arrival. `npc_roster()` returns at most 20 resident cards with cursor and name search. The selected journal is loaded separately through `npc_journals()`. Dialogue and hospitality address stable NPC and world-instance UUIDs; no active application contract accepts `lira`/`torvin` string keys.

```mermaid
flowchart LR
  Draft[Mutable draft] -->|submit| Version[Immutable version]
  Version --> Evaluate[Structural evaluation]
  Evaluate --> Review[Independent review]
  Review -->|publish| Pool[Eligible version pool]
  Pool -->|dawn assignment| Resident[Pinned world resident]
  Resident --> Dialogue[Dialogue and hospitality]
  Resident --> Dawn[Quest step at dawn]
  Dialogue --> Journal[Private player journal]
  Dawn --> Journal
  Dialogue --> Analytics[Counter-only engagement]
  Dawn --> Analytics
```

## Authoring and review

`/authoring/npcs` is available to users with `npc_author`. The guided editor covers identity, appearance, personality, named relationships, lore, knowledge and disclosure rules, skills, and a two-to-ten-milestone campaign. It keeps stable internal references while creators work with names and structured controls. Autosave sends the expected draft revision after a debounce. A stale write returns a visible conflict and freezes editing until the creator reloads; two browser tabs never merge silently.

Field assistance and sandbox conversations use the configured server-side authoring provider. OpenAI Responses calls use strict structured outputs, the complete draft sheet, and the ordered sandbox transcript. Assistance presents separate Current and Suggested cards and changes the draft only after the creator accepts it. A no-change response is reported as such. Provider absence, invalid output, and timeouts produce explicit recoverable states rather than placeholder prose.

Sandbox sessions freeze their source revision, persist ordered turns, and survive reloads. Saving or accepting an assistance proposal invalidates the active session while preserving its transcript in history. Scene jobs select only an existing derivative under `.local/media/runtime-derivatives/community-npcs/`; missing media produces `local_scene_asset_missing`, without fabricating an image or borrowing another feature's artwork. Submission runs the shared sheet validator and records structural evaluation evidence. History renders version changes, evaluation results, reviewer decisions, comments, and retirement status in readable panels.

Reviewers use `/admin/npcs`. They see frozen submitted content, structural evaluation evidence, linked comments, report evidence, and appeals. Ownership history prevents a current or former owner from reviewing or moderating an identity. Publishing, requesting changes, rejecting, retiring, pausing, quarantining, and banning are audited server operations.

The prototype uses capability checks in database functions and SvelteKit server actions. Browser clients have no direct access to private authoring, narrative, evaluation, report, or audit tables.

## Player privacy and control

Community attribution links an encountered NPC to a public creator profile containing only the creator's display name, bio, join date, and active or retired published NPCs.

A player may dismiss a community resident. The NPC leaves the active roster permanently, its identity receives a no-return tombstone for that save, and its journal remains in the player's read-only archive.

A report applies to the exact pinned version and stores a frozen copy of its metadata plus the reporting world's complete visible transcript. The UI warns about that attachment before submission. One player world can contribute only one threshold-counting report per version. Three distinct-world reports pause new sampling. Review decisions appear in the reporter's inbox; the creator receives a sanitized reason without reporter identity.

A player may also create a permanent conversation share for the NPC's creator. The UI first shows the exact transcript and an irreversible, no-revocation warning. Sharing is anonymous unless the player explicitly includes a snapshot of their public display name. Shared transcripts are separate from analytics.

Mature community content is disabled by default. Enabling it requires an adult attestation and explicit confirmation. Disabling it calls one database operation that updates the setting and removes mature residents, their player-visible narrative, and shares while retaining restricted tombstones and moderation/accounting evidence.

## Analytics

Runtime triggers record only allow-listed counter events: assignment, active presence, dialogue, day present, hospitality, milestone outcome, campaign completion, dismissal, and report. Each event has a deterministic source key, so retries cannot increase counts. Events store a one-way world hash and bounded non-narrative metadata. Raw dialogue, memories, player timelines, and player identifiers are unavailable through creator analytics.

The service-only daily rollup rewrites one UTC date idempotently into `npc_daily_analytics`. `/authoring/npcs` shows the owning creator counts and rates from the first assignment without a cohort threshold or ranking.

## Local media and fixtures

Put approved community scene derivatives in:

```text
.local/media/runtime-derivatives/community-npcs/
```

Supported local derivatives are WebP, JPEG, and AVIF. The directory is ignored by Git. Do not add source PNG, TIFF, PSD, XCF, or KRA files to the repository.

Run:

```sh
npm run fixtures:users:local
```

The fixture command uploads each community derivative to the local Supabase Storage bucket under the `community-npcs/` namespace, verifies the uploaded bytes, provisions independent administrator/author and reviewer users, and exercises the author-to-publication path when a dedicated community asset exists. With no eligible asset, it reports that publication was skipped rather than inventing media.

For explicit scale testing against the disposable local database:

```sh
FIXTURE_NPC_SCALE=1 npm run fixtures:users:local
```

This creates a 1,000-identity candidate pool and assigns 100 residents to one save so roster pagination, search, and set-based dawn behavior can be measured. It is excluded from normal startup.

## Verification

The community-specific database suites are:

- `supabase/tests/community_npc_platform.test.sql`
- `supabase/tests/community_npc_runtime.test.sql`
- `supabase/tests/community_npc_authoring.test.sql`
- `supabase/tests/community_npc_authoring_experience.test.sql`
- `supabase/tests/community_npc_bar_scaling.test.sql`
- `supabase/tests/community_npc_purge.test.sql`
- `supabase/tests/community_npc_engagement.test.sql`

Use the standard repository checks after a local reset:

```sh
npm run db:reset:local
npm run db:types:check
npm run test:db
npm run test:unit
npm run test:integration
npm run check
npm run build
npm run secrets:audit
npm run media:git:check
```

The deterministic local evaluation is part of submission. `npm run npc:eval:live` remains an explicit, billable OpenAI dialogue evaluation and requires `OPENAI_API_KEY` in the ignored root `.env`.
