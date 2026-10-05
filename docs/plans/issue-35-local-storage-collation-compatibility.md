# Issue #35 local Storage collation compatibility

The local Shop fixture upload failed with PostgreSQL `42P10` from Storage API
`UpsertObject`. The running local image is `storage-api:v1.79.28`; its upsert
targets the partial unique key `(bucket_id, name COLLATE "C") WHERE archived_at
IS NULL`. This database records Storage migrations 0066/0067, but its persisted
`idx_objects_current_version` and `idx_objects_null_version` definitions use the
database's default `en_US.UTF-8` collation for `name`. The versioning migration
names were already recorded, so the Storage service did not rebuild those
indexes from its current migration definitions. PostgreSQL therefore cannot
infer an arbiter for the Storage API's explicit `COLLATE "C"` conflict target.

The repaired index definitions match the current Storage migrations:

```sql
CREATE UNIQUE INDEX idx_objects_current_version
  ON storage.objects USING btree (bucket_id, name COLLATE "C")
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX idx_objects_null_version
  ON storage.objects USING btree (bucket_id, name COLLATE "C")
  WHERE NOT is_versioned;
```

The partial predicates are unchanged, preserving current-version and
non-versioned uniqueness semantics; only the `name` collation changes.

Apply the narrowly scoped, transactional repair to the existing local database
without resetting it or restarting the app:

```sh
docker exec -i supabase_storage_by-rook-and-crook node -e '
const { Client } = require("pg");
const fs = require("node:fs");
const client = new Client({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync(0, "utf8");
(async () => {
  try {
    await client.connect();
    await client.query(sql);
    console.log("Local Storage index compatibility repair committed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
' \
  < scripts/repair-local-storage-version-index-collation.sql
```

The SQL verifies the Storage migration markers, takes a short `SHARE` lock on
`storage.objects` (readers continue; writers are held until commit), and checks
for duplicate keys under the target collation. It rebuilds only the current
version and non-versioned partial unique indexes using the v1.79.28 migration
definitions, then removes each stale index inside the same transaction. It
does not alter object rows or blobs, add unconditional uniqueness, or reset
application data. A 5-second lock timeout and duplicate checks make it fail
closed if the database is busy or incompatible.

Verify the resulting definitions with:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'storage'
  AND indexname IN ('idx_objects_current_version', 'idx_objects_null_version')
ORDER BY indexname;
```

The `name` key in both definitions should show `COLLATE "C"`, with predicates
`archived_at IS NULL` and `NOT is_versioned` respectively. The targeted
`seedLocalShopRuntimeAssets` helper then uploaded and SHA-256 verified 11 Shop
assets. The failing content-addressed WebP is present as `image/webp` at
255,708 bytes. The object row count remained 45 and both duplicate-key checks
returned zero.

Finally, `npm run fixtures:users:local` ran once without errors. It reused the
two local pilots without changing their passwords, verified 11 Shop assets, 7
layered-scene assets, 3 Community NPC scene assets, the private portrait
buckets, and the local Community NPC authoring draft. No database reset or app
restart was performed; `http://127.0.0.1:3000/login` continued to return HTTP
200.
