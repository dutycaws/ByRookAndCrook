# Media asset storage and versioning guidance

**Scope.** This note records the assessment that preceded the repository's media policy. It is based on repository evidence plus official GitHub, Supabase, AWS, and IETF documentation (checked 2026-09-10). The adopted, implementation-authoritative decisions are in the [media lifecycle](../design/media-lifecycle.md): they use no Git LFS or inline size overrides, grandfather unchanged historical evidence, and reject every newly introduced ordinary Git blob over 1 MiB. Where an option discussed below differs, the lifecycle document controls. This is not a history-rewrite plan.

## Repository assessment

**Yes, this repository stores media directly on GitHub as ordinary Git blobs.** `HEAD` exactly matches its pushed `origin/codex/issue-7-motion-proof-assets` upstream, and there is no tracked `.gitattributes`, LFS pointer history, or repository LFS configuration. This is not presently a GitHub hard-limit incident, but the review/reference category is growing much faster than the runtime category.

| Measurement | Current pushed branch |
| --- | ---: |
| Tracked media | 100 files / 37.32 MiB (including one tiny SVG) |
| Runtime media under `static/**` | 52 media files / 3.10 MiB |
| `docs/screenshots/**` | 44 media files / 25.19 MiB |
| `docs/reference/**` | 4 media files / 9.03 MiB |
| Local generated PNG masters outside the repository | 20 files / 39.46 MiB |
| Largest current or reachable-history blob | 2.47 MiB (`CozyTavernConceptArt2.png`) |
| Unique blobs reachable from all local refs | 456 blobs / 44.67 MiB uncompressed |
| Local compressed packs | 9.91 MiB |

The current branch contains 41 PNGs (31.36 MiB), 51 WebPs (3.10 MiB), five WebMs (2.36 MiB), two JPEGs (0.50 MiB), and one SVG. Twelve paths exceed 1 MB, but none exceeds 5 MB; the four largest are 2.1–2.5 MiB concept references. `origin/main` contains 10.96 MiB of media, so this feature branch adds most of the current media footprint.

The history audit found only small superseded screenshot versions and no large unreachable/deleted blobs. The local `.git` directory is about 57 MiB because many objects are loose; that is a workstation representation, not the likely GitHub transfer size. More importantly, Git permanently retains every distinct binary revision reachable from history, so repeated capture commits would make growth approximately additive. The manifest's external generated-image directory currently exists and contains 20 lossless PNG masters totaling 39.46 MiB, but no repository-managed remote/versioned copy is evident.

The categorization is otherwise strong. [`docs/design/asset-manifest.md`](../design/asset-manifest.md) separates runtime derivatives from design/reference evidence, records provenance and checksums, and keeps generated PNG masters out of `static/assets`. [`scripts/validate-scene-assets.ts`](../../scripts/validate-scene-assets.ts) enforces runtime dimensions, checksums, alpha, and size ceilings, and CI runs it. The main gaps are:

- review screenshots/videos are intentionally committed even though they never ship, and already account for most bytes;
- source masters are identified by workstation-local absolute paths, so their recovery and collaboration story depends on one machine;
- no size gate or LFS policy prevents a future PSD, PNG master, or long video from entering ordinary Git;
- `static` assets use stable, unhashed URLs and there is no deployment/CDN/cache configuration;
- Supabase Storage is enabled locally, but no bucket or application media flow is configured.

## Recommendation

Keep reviewed, optimized, redistributable **runtime** art in Git while it stays small; immediately protect the workstation-local editable/generative originals in durable private storage; and keep high-volume iterative review evidence outside Git. Continue serving the current runtime set with the application until a concrete deployment or scale need justifies a separate object-store/CDN origin. When that happens, treat every production media byte as immutable: its URL contains a content hash (or release identifier), so a changed byte gets a new key and caches can be long lived without purge races.

This matches the current repository particularly well: [`docs/design/asset-manifest.md`](../design/asset-manifest.md) already defines runtime WebP derivatives, checksums, source provenance, and the rule that lossless PNG masters stay outside the runtime bundle. The current `static/assets` runtime files peak at about 407 KiB, whereas tracked reference PNGs and screenshot/video evidence are larger. That is a healthy boundary to preserve.

## GitHub and Git LFS guardrails

GitHub's current repository guidance recommends no more than 1 MB for a single regular-Git object and 10 GB for the compressed `.git` directory. Separately, GitHub warns when a regular Git file exceeds 50 MiB and blocks files over 100 MiB. The current project is far below the warning/enforcement thresholds and compressed-repository limit, although twelve current paths exceed the conservative 1 MB recommendation. Removing a binary only in a later commit does **not** make prior Git history small. [GitHub repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits) and [large-file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

Git LFS replaces the tracked blob with a Git pointer while storing the complete binary separately. It is appropriate only for a small, deliberately versioned set of large source artifacts that every developer/CI checkout truly needs. Its maximum single-file size depends on plan (2 GB on Free/Pro, 4 GB Team, 5 GB Enterprise Cloud), and it cannot be used for GitHub Pages or template repositories. [Git LFS behavior and limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)

LFS is not an economical replacement for asset delivery: each changed version uploads and stores the *whole* object again, each clone/pull or Actions download consumes the owner’s LFS bandwidth, and storage includes all associated LFS objects. On Free, GitHub currently includes 10 GiB each of monthly download bandwidth and storage; over-budget behavior can block LFS use. Deleting an LFS-tracked file/history also does not by itself purge the associated remote LFS object or its charge, so LFS onboarding needs an explicit retention/cleanup plan. [Git LFS billing and examples](https://docs.github.com/en/billing/concepts/product-billing/git-lfs) and [LFS-object removal](https://docs.github.com/en/repositories/working-with-files/managing-large-files/removing-files-from-git-large-file-storage)

**Repository policy**

| Asset class | Version-control home during development | Rationale and release path |
| --- | --- | --- |
| Small runtime assets: optimized WebP/SVG, fonts licensed for distribution, sound effects that remain modest | Ordinary Git under `static/assets`; manifest records source, dimensions, license/provenance, SHA-256, and budget | Reviewed bytes are code-adjacent and deterministic. Ship in the app bundle initially; move to CDN only when deploy bandwidth, bundle size, or independent asset release needs justify it. |
| Editable originals: layered design files, lossless PNG/TIFF masters, long audio/video, generated source sheets | Managed asset library/object storage; metadata manifest in Git | Preserve immutable source IDs, creator/license, prompt or source relationship, content hash, and derivative recipe. Do not commit originals merely because a derivative needs review. |
| Large but essential game-source binaries | Private, content-addressed source-master storage; metadata in Git | This project explicitly rejected Git LFS. Add a distinct reviewed storage class if a future non-image source format cannot use `source-masters`. |
| Build output, Playwright trace/video, screenshot evidence, reports | CI artifacts with explicit short retention; promote only selected final evidence to docs/object storage | Artifacts are for output sharing between/after workflow jobs; cache is for reproducible dependencies/intermediates, not an archive. [GitHub Actions artifact guidance](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts) |
| User uploads / player-generated media / private exports | Private object-storage prefix, application authorization, direct signed upload/download URLs | Never Git or LFS. Store ownership/content metadata in the database, enforce MIME/size/scan policy, and separate the public runtime origin from private data. |

Adopted enforcement: retain `npm run art:assets:check`; reject every newly introduced ordinary-Git blob over 1 MiB with no inline override; reject new video and all Git LFS pointers/configuration; grandfather unchanged historical evidence while allowing only true renames; reject copies or replacements of grandfathered oversized blobs; and enforce the separate 10 MiB aggregate runtime ceiling. If a genuinely harmful blob is found in already-pushed history, plan a coordinated `git filter-repo` remediation; GitHub notes that history removal is required for an earlier commit, and that it permanently removes the files from local and hosted history. [GitHub history-removal guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github#removing-files-from-a-repositorys-history)

## Hosted object-storage/CDN design

This is a target design, not an immediate migration requirement. The current frontend uses same-origin literal `/assets/...` paths from SvelteKit `static`, and there is no production deployment configuration yet. At only 3.10 MiB, keeping runtime media inside the versioned app deployment minimizes CORS, preview-environment, manifest-publication, integrity, and fallback coupling. Introduce a separate origin only with a concrete host and an observed need: independent asset releases, transforms, global delivery requirements, or material deploy/bundle cost.

Use separate logical origins/prefixes (ideally separate buckets/projects where access and retention differ):

```
private-source-masters/                 # author/service access only
private-user-uploads/<tenant>/<id>/     # signed access, retention/scan policy
public-runtime/assets/<sha256>/<name>   # CDN only; immutable release bytes
ci-review-evidence/<run-or-release>/    # expiring or selectively promoted
```

For a production byte, upload once to a key such as `public-runtime/assets/sha256-<digest>/garden-environment.webp`; store that key plus digest, MIME type, dimensions, and logical asset ID in the versioned manifest/release record. A byte change receives a new key. Publish the new manifest atomically (or reference it by deployment release) after all objects exist. This avoids overwriting a cacheable object and makes rollback a manifest/deployment change rather than a mass invalidation. CloudFront explicitly recommends version identifiers in object paths for frequently changed files because they avoid expiration/invalidation delays, work through browser/proxy caches, support rollback, and usually cost less than invalidation. [CloudFront object-update guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/UpdatingExistingObjects.html)

Use the CDN as the only public reader of the public bucket, with origin access control and bucket public-access blocking enabled. AWS recommends keeping all Block Public Access settings on; CloudFront Origin Access Control permits secure static delivery while preserving private S3 origin access. [S3 public-access guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingBucket.html#access-permissions)

For immutable hashed media, set a long explicit freshness policy, for example `Cache-Control: public, max-age=31536000, immutable`. For a mutable manifest or pointer, use short TTL/revalidation (for example `max-age=60, must-revalidate`) and never promise long immutable caching. CloudFront uses origin `Cache-Control: max-age`/`s-maxage` or `Expires` subject to its cache policy, and AWS recommends `Cache-Control` instead of `Expires`; `s-maxage` can give shared caches a different policy from browsers. [CloudFront expiration controls](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html) and [HTTP cache semantics](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.10)

Do not rely on cache invalidation as the normal release mechanism. Invalidate only genuinely mutable, emergency-revoked, or accidentally exposed URLs; a purge cannot revoke a browser download already made. Hash-keyed URLs also allow very long CDN TTLs and reduce origin load. S3 scales storage requests and AWS specifically identifies CloudFront as a way to lower latency/cache S3-origin content. [S3 performance guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html)

For private assets, keep the bucket private and have the server decide entitlement from Supabase Auth/RLS-backed data. Issue short-lived CloudFront signed URLs or cookies after that check, with a resource restriction and expiry; custom CloudFront signed policies can additionally restrict an IP range. Prefer a signed URL for one file and signed cookies for a collection (for example, media segments). Cache-control does not make content private—HTTP defines `private` only as a shared-cache storage directive—so authorization must happen at the origin/CDN policy layer. Also ensure the CloudFront minimum TTL is compatible with private/no-store behavior: a positive minimum TTL can override restrictive origin directives. The release checklist must prove that signatures are validated at the edge, the origin cannot be fetched publicly, authorization-sensitive values are part of the cache policy where required, and authenticated API responses cannot enter a shared public cache. [CloudFront private-content options](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html), [cache-policy TTL semantics](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html), and [RFC 9111 `private`](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.7)

For direct user uploads, do not trust the browser's filename, declared MIME type, dimensions, or cache metadata. Assign safe object names and response headers server-side; validate magic bytes, byte size, pixel dimensions/decompression limits, and allowed formats; strip sensitive metadata where appropriate; and quarantine/scan before publication. Reject active formats such as user-provided SVG/HTML or serve them as attachments from an isolated origin. Restrict CORS to the application's known origins.

### Supabase-specific option

Because this application already uses Supabase, Supabase Storage is a reasonable lower-operations choice for future user uploads and public runtime delivery: it supports private/public buckets, RLS-oriented access, signed URLs, and CDN delivery. Its Smart CDN documentation also recommends changing an object's path when the bytes change because browsers can retain an overwritten path. [Supabase Storage](https://supabase.com/docs/guides/storage), [serving assets](https://supabase.com/docs/guides/storage/serving/downloads), and [Smart CDN caching](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

It should **not** be the only recovery layer for irreplaceable masters: Supabase's S3-compatible API does not support S3 bucket versioning, and deleted objects cannot be restored through object versions. If Supabase Storage is chosen, use immutable content-hash keys, prohibit overwrites/deletes in the normal workflow, and export originals to an independently versioned backup. If native object versioning and lifecycle policies are requirements, use a provider that exposes them. [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)

## Durability, lifecycle, and operating controls

Enable object versioning for source masters and any non-derivable user assets. In S3, overwrites create a new entire object version and deletion creates a delete marker, so prior versions can be restored; this improves recovery but multiplies storage, not delta storage. Pair it with lifecycle rules for noncurrent versions, temporary uploads, CI evidence, and abandoned multipart uploads. [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)

Use Object Lock only for a defined legal/retention requirement, not as a default convenience. It requires versioning and applies per object version; it can prevent deletion/overwrite for its retention period, so it needs an owner, an approved duration, and recovery drills. [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

Maintain two independent recovery layers for originals: versioning/replication in the storage platform and a tested backup/export to a separate account or provider. GitHub explicitly says Git is not designed to be a backup tool. For each class, document retention owner, restoration target/time objective, encryption, access roles, malware/quarantine workflow for uploads, and a lifecycle test that proves old versions are retained or expired as intended. [GitHub repository-size guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

## Practical rollout for this repository

1. Do not rewrite history now. The repository is small, no blob is hazardous, and a rewrite would disrupt clones and branches for little immediate gain.
2. Keep the existing optimized runtime WebPs and their checksum/provenance manifest in Git; add a documented maximum per runtime file and total runtime-asset budget.
3. Back up the 20 lossless generation masters to a private, durable asset-library bucket first; commit their immutable source IDs, hashes, derivative metadata, and license/provenance, never credentials or signed URLs. Prove restoration from a second machine. A local Codex-generated-image path is not durable storage.
4. Keep a tightly budgeted, curated acceptance set linked from the long-lived documentation. Write iterative/candidate/retry screenshots and videos to ignored CI/test output and upload them as retention-limited workflow artifacts. If the curated set later moves to durable object storage, update its documentation links and retention contract in the same change.
5. Introduce an `AssetRecord`/manifest schema with logical ID, content digest, immutable object key, MIME, dimensions, source/license, derivative recipe, status, and release ID. The frontend references a release manifest, not hand-maintained mutable cloud paths.
6. For the first hosted release, shipping the current 3.11 MiB runtime set with the application is reasonable. Before applying long immutable caching, add content hashes or release IDs to URLs. Move public runtime media to a CDN/object-store origin when it needs independent releases, on-demand transforms, or has grown enough to make every app deployment wasteful.
7. Keep user uploads in a separate private bucket/prefix with short-lived access issued only after server-side authorization. Do not mix them with public game art or development masters.
8. Keep build packages and test evidence out of ordinary Git: use CI artifacts for run-scoped outputs, then explicitly promote release assets/evidence to durable object storage when needed. Artifact deletion follows workflow-run deletion, so it is not a durable archive. Use a package registry only for a reusable, versioned software deliverable, and use a GitHub Release only for a tagged software distribution—not either as general media storage. [GitHub Actions artifact lifecycle](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts#artifacts-from-deleted-workflow-runs), [GitHub Packages](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/about-github-packages-and-github-actions), and [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## Source list

- [GitHub: About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [GitHub: Repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- [GitHub: About Git Large File Storage](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)
- [GitHub: Git LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs)
- [GitHub Actions: Workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
- [AWS S3: Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), and [public access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingBucket.html)
- [AWS CloudFront: expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html) and [signed URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)
- [Supabase Storage](https://supabase.com/docs/guides/storage), [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn), and [S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)
- [IETF RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
