-- Local compatibility repair for storage-api v1.79.28.
-- The storage service's upsert target explicitly uses name COLLATE "C".
-- Replace only the two partial versioning indexes when a persisted local DB
-- still has their earlier default-collation definitions.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- Prevent new object writes between the duplicate checks and index rebuilds.
-- Readers remain available while this lock is held.
LOCK TABLE storage.objects IN SHARE MODE;

DO $compat$
DECLARE
  current_index_correct boolean;
  null_version_index_correct boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.migrations
    WHERE name = 'objects-current-version-index'
  ) OR NOT EXISTS (
    SELECT 1
    FROM storage.migrations
    WHERE name = 'objects-null-version-index'
  ) THEN
    RAISE EXCEPTION 'Storage versioning migrations 0066/0067 are not present; refusing compatibility repair';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE archived_at IS NULL
    GROUP BY bucket_id, name COLLATE "C"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate current object keys under COLLATE "C"; refusing to rebuild indexes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE NOT is_versioned
    GROUP BY bucket_id, name COLLATE "C"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-versioned object keys under COLLATE "C"; refusing to rebuild indexes';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_index AS index_info
    WHERE index_info.indexrelid = to_regclass('storage.idx_objects_current_version')
      AND index_info.indrelid = 'storage.objects'::regclass
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
      AND pg_get_expr(index_info.indpred, index_info.indrelid) = '(archived_at IS NULL)'
      AND pg_get_indexdef(index_info.indexrelid) LIKE '%name COLLATE "C") WHERE (archived_at IS NULL)'
  ) INTO current_index_correct;

  IF NOT current_index_correct THEN
    IF to_regclass('storage.idx_objects_current_version_before_issue35_collation_fix') IS NOT NULL THEN
      RAISE EXCEPTION 'Unexpected preserved current-version index already exists; refusing to overwrite it';
    END IF;

    IF to_regclass('storage.idx_objects_current_version') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_index AS index_info
        WHERE index_info.indexrelid = to_regclass('storage.idx_objects_current_version')
          AND index_info.indrelid = 'storage.objects'::regclass
      ) THEN
        RAISE EXCEPTION 'idx_objects_current_version is not an index on storage.objects';
      END IF;

      ALTER INDEX storage.idx_objects_current_version
        RENAME TO idx_objects_current_version_before_issue35_collation_fix;
    END IF;

    CREATE UNIQUE INDEX idx_objects_current_version
      ON storage.objects USING btree (bucket_id, name COLLATE "C")
      WHERE archived_at IS NULL;

    IF to_regclass('storage.idx_objects_current_version_before_issue35_collation_fix') IS NOT NULL THEN
      DROP INDEX storage.idx_objects_current_version_before_issue35_collation_fix;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_index AS index_info
    WHERE index_info.indexrelid = to_regclass('storage.idx_objects_null_version')
      AND index_info.indrelid = 'storage.objects'::regclass
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
      AND pg_get_expr(index_info.indpred, index_info.indrelid) = '(NOT is_versioned)'
      AND pg_get_indexdef(index_info.indexrelid) LIKE '%name COLLATE "C") WHERE (NOT is_versioned)'
  ) INTO null_version_index_correct;

  IF NOT null_version_index_correct THEN
    IF to_regclass('storage.idx_objects_null_version_before_issue35_collation_fix') IS NOT NULL THEN
      RAISE EXCEPTION 'Unexpected preserved null-version index already exists; refusing to overwrite it';
    END IF;

    IF to_regclass('storage.idx_objects_null_version') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_index AS index_info
        WHERE index_info.indexrelid = to_regclass('storage.idx_objects_null_version')
          AND index_info.indrelid = 'storage.objects'::regclass
      ) THEN
        RAISE EXCEPTION 'idx_objects_null_version is not an index on storage.objects';
      END IF;

      ALTER INDEX storage.idx_objects_null_version
        RENAME TO idx_objects_null_version_before_issue35_collation_fix;
    END IF;

    CREATE UNIQUE INDEX idx_objects_null_version
      ON storage.objects USING btree (bucket_id, name COLLATE "C")
      WHERE NOT is_versioned;

    IF to_regclass('storage.idx_objects_null_version_before_issue35_collation_fix') IS NOT NULL THEN
      DROP INDEX storage.idx_objects_null_version_before_issue35_collation_fix;
    END IF;
  END IF;
END;
$compat$;

COMMIT;
