# Media asset lifecycle

This document defines the storage boundary for visual source material, browser-ready derivatives, capture candidates, and review evidence. It supplements the [asset manifest](asset-manifest.md), which remains the source of truth for scene composition, derivative checksums, dimensions, and source provenance.

## Asset classes

| Class | Canonical location | Git policy | Access and retention |
| --- | --- | --- | --- |
| Runtime derivatives | `static/assets/**` | Ordinary Git; optimized WebP, SVG, JSON, and similar browser inputs only | Public through the app. Each raster is at most 500,000 bytes and all runtime media is at most 10 MiB. |
| Source masters | Git-ignored local store `.local/media/source-masters/` | Catalog, hashes, and derivative links only; never source bytes | Content-addressed, append-only, and verified by local read-back hash. Hosted storage is an optional future mode. |
| Capture candidates | `artifacts/media-captures/**` | Ignored; never commit directly | Local working data. GitHub Actions candidate artifacts expire after 14 days. |
| Curated still evidence | `docs/screenshots/curated/**` | Ordinary Git, immutable commit-scoped directories | At most 12 stills and 4 MiB per evidence set; every file is at most 1 MiB. |
| Curated motion evidence | Public Supabase Storage bucket `review-evidence` | Commit only its index/links and metadata | Immutable content-addressed objects. Retain indefinitely while referenced. |

Existing documentation screenshots, videos, and reference images are historical evidence. They remain available and are not retroactively moved or rewritten. No new Git LFS use, Git video, or history rewrite is part of this policy.

## Guardrails in development

Use these checks before requesting review:

```sh
npm run media:git:check:staged
npm run art:assets:check
```

To inspect a committed range explicitly, use:

```sh
npm run media:git:check -- --base <base-git-oid> --head <head-git-oid>
```

The Git policy rejects every newly introduced blob larger than 1 MiB, including a large blob added and deleted later in the same range. It also rejects new video, Git LFS pointer/configuration, source-master formats in runtime assets, and copies or replacements of grandfathered oversized evidence. A true rename of an unchanged grandfathered object remains valid.

`npm run art:assets:check` keeps the manifest-specific checks in force and additionally reports the runtime inventory and headroom. The 10 MiB runtime-media ceiling is an architectural transition trigger, not an invitation to relax the browser-performance budget.

## Source masters and archive backup

Rapid prototyping uses no hosted Supabase Storage. Source PNG masters live only in the ignored local directory `.local/media/source-masters/`; create it by ingesting a master rather than adding source image files to `docs/`, `static/`, or Git. The catalog stores the immutable key `v1/sha256/<first-two-hex>/<sha256>.png`, not a workstation filename. Ingestion creates that path without overwriting an existing object, reads it back, and requires the read-back SHA-256 to match the catalog before recording verification.

The default requires no media credentials:

```dotenv
MEDIA_MASTER_STORAGE=local
```

`.local/` is Git-ignored. Keep all populated credentials in the ignored root `.env`; `.env.example` is documentation only. Before staging any change, run `npm run media:git:check:staged`. The policy rejects newly introduced source-master formats and every newly introduced blob larger than 1 MiB, including a blob that was later deleted in the same pushed range.

Future hosted storage is optional and must be selected explicitly with `MEDIA_MASTER_STORAGE=supabase`. Only then are `MEDIA_SUPABASE_URL` and the server-only `MEDIA_SUPABASE_SECRET_KEY` required. Never use a browser key, commit populated values, or treat a local development store as a hosted deployment requirement.

The archive and restore commands require the Info-ZIP `zip` and `unzip` executables in addition to the project's normal Node.js and Supabase CLI prerequisites.

The intended commands are:

```sh
npm run media:master:ingest -- --file <master.png> --id <logical-asset-id> --metadata <metadata.json>
npm run media:masters:archive
npm run media:masters:verify -- --archive artifacts/media-master-backups/<archive>.zip
npm run media:masters:confirm-drive -- --archive <archive-id>
npm run media:masters:status
```

Ingestion validates the complete PNG chunk stream, metadata, dimensions, CRCs, and decoded scanlines; it rejects objects over 50 MiB, images over 32 megapixels, and decoded pixel streams over 64 MiB. It hashes the source, writes it under its immutable SHA-256 key in the selected store, reads it back, and records a revision only when those bytes match. Logical IDs may have multiple immutable revisions; `supersedes` links their history, while each current runtime derivative points to one exact `sourceRevisionId`. A derivative is release-eligible only after its master is read-back verified and a matching local ZIP receipt covers the exact catalog.

`media:masters:archive` rebuilds a deterministic ZIP from the selected, read-back-verified store rather than an arbitrary input directory. It publishes the completed snapshot as `source-masters-<full-zip-sha256>.zip` with a matching `.sha256` sibling under ignored `artifacts/media-master-backups/`; it never overwrites or deletes a prior archive. Copy both files manually to the `ByRookAndCrook/media-master-backups/` Google Drive folder. Drive confirmation is recorded for operational visibility but is not a release gate.

At least quarterly, download the newest Drive ZIP and its `.sha256` companion to a safe local directory and run `media:masters:verify`. The command safely restores vetted entries into a fresh temporary directory, rejects unsafe or unexpected archive paths, proves every embedded master against the embedded catalog, and appends the successful time and archive hash to the matching tracked receipt. A verified local ZIP is not an off-machine backup until its ZIP and checksum have been copied to Drive.

## Capture, review, and promotion

Normal capture commands write candidates to a commit-scoped ignored directory beneath `artifacts/media-captures/` and create a capture manifest. The manifest identifies the Git commit, worktree cleanliness, browser/viewport conditions, asset hashes, outputs, and measurements. Existing committed evidence remains historical; regenerating a capture does not overwrite it.

```sh
npm run screenshots
npm run motion:proof:capture
npm run scene:acceptance:capture
npm run media:evidence:validate -- --manifest <capture-manifest.json>
```

Promotion is deliberate and always scoped to explicit files:

```sh
npm run media:evidence:promote -- --manifest <capture-manifest.json> --scope <issue-or-release> --stills <file[,file...]> --clips <file[,file...]>
```

Promotion rejects a dirty or mismatched capture, altered candidate hash, unsafe path, symlink, oversize evidence, and all attempted Git-video writes. Selected stills are copied to a fresh `docs/screenshots/curated/<commit-sha>/<scope>/` directory. Promoting clips additionally requires `MEDIA_SUPABASE_URL` and the preferred `MEDIA_SUPABASE_SECRET_KEY` (with the temporary service-role fallback); it publishes under an immutable hash key in `review-evidence`, downloads again for hash verification, and records the result in the tracked evidence index along with the commit, content hash, MIME type, URL/key, purpose, and capture-manifest hash. Normal developer tooling never updates or deletes an evidence object.

The validator requires the complete versioned output set for the selected capture kind and applies the 25 MiB per-clip candidate limit. Full capture packages may intentionally contain more or larger stills while reviewers work; the 1 MiB per-file, 12-still, and 4 MiB aggregate Git budgets apply to the explicit curated selection during promotion. The manually dispatched `media-evidence` workflow runs a capture against an explicit commit and uploads unpromoted candidates as GitHub Actions artifacts for 14 days. These short-lived artifacts are not durable review evidence.

## CI and performance calibration

The fast `media-policy` job checks Git ranges before the slower database and browser jobs. It uses full Git history so that transient large blobs cannot evade the gate. Once the master and evidence workflows have been proven, make this job a required protection for `main`; branch rules restricting direct and force pushes are configured in GitHub, not in repository code.

`npm run media:perf` measures the authenticated Garden, Brewery, Bakery, and Bar routes with a cold cache, a 390 x 844 mobile viewport, Fast-4G-like throttling, and CPU slowdown. It collects three trials per route and reports the median. Initial limits are LCP no slower than 2.5 seconds, CLS no greater than 0.10, representative interaction duration no greater than 200 ms, encoded route media no greater than 1.5 MiB, and no raster larger than 500,000 bytes.

Run this job as report-only on successful `main` builds until ten valid runs exist. Turn it into a required PR gate only if the p75 of those route medians is within every limit. Then retry a breached route once and fail only when both runs breach the same threshold. The interaction measurement is a lab proxy; after hosting, monitor 28-day field p75 Core Web Vitals: LCP 2.5 seconds, INP 200 ms, and CLS 0.1.

After downloading the ten report artifacts beneath one directory, run `npm run media:perf:calibration -- --directory <reports>`. The command recursively discovers GitHub's per-artifact subdirectories, rejects incomplete, non-report, or malformed runs, excludes duplicate runs from the qualifying count, and exits successfully only when all four routes have ten unique valid medians whose nearest-rank p75 meets every absolute limit. Preserve that output, then set the GitHub repository variable `MEDIA_PERF_ENFORCE=true` and make the `media-performance` job required in branch protection. That switch activates enforcement for PRs that change application code, runtime assets, dependency locks, media-performance policy/tooling, or build configuration; unaffected PRs return a successful no-op check. Leave the variable unset until calibration passes.

## Hosting transition

Keep the present small runtime derivatives in the SvelteKit static bundle. Prefer the selected host's native fingerprinted static CDN rather than building a resolver early.

Plan a separate public-runtime bucket and release-manifest design when runtime media exceeds 10 MiB, a route exceeds its 1.5 MiB media/LCP budget, static assets slow deployments, or the host lacks suitable edge caching. That future storage class must be distinct from both `source-masters` and `review-evidence`, use immutable content-hash object keys, publish verified objects before a short-revalidated manifest, send immutable objects with one-year caching, and restrict CORS to preview and production origins.

Future player uploads are a separate capability: they require their own private/quarantine bucket, server-side validation, authorization, and an explicit promotion path. They must not share masters, evidence, or runtime-delivery storage.
