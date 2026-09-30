-- Promotion now materializes an immutable NPC version package in the final
-- package cutover. This historical slot intentionally creates no parallel
-- promoted definition registry or V1 conversion path.
begin;
commit;
