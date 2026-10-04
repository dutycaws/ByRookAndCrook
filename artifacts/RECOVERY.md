# Recovered review and acceptance materials

Recovered October 4, 2026 after the artifact cleanup. These documents describe historical work; recovery did not rerun gameplay, tests, migrations, database writes, or model requests.

## Lira browser acceptance

- [Acceptance log](lira-browser-acceptance/acceptance-log.md): recovered from the original file-creation patch, two subsequent patches, and recorded literal shell/browser log writes, in chronological order (41 recovered write events).
- [Final acceptance report](lira-browser-acceptance/final-acceptance-report.md): recovered from the original creation patch and follow-on completion append. Records the successful authored-quest and dynamic-follow-on replay, including its authorized supply shortcut and coverage limits.
- `lira-browser-acceptance/grant-lira-loaves.mjs`: an earlier original revision recovered from a successful historical file read. It uses the original hard-coded save IDs; the later revision supporting user/save/grant command-line arguments was not recovered. Preserved for reference, not executed or validated against the current database.

The Markdown reports retain their historical wording and numbered evidence references. The referenced screenshots and DOM snapshot files have not been recovered. There is no original whole-file checksum for either report, so recovery is based on recorded edits rather than byte-for-byte verification against the deleted files. Early “in progress” status text belongs to the original log; later entries record the eventual outcome.

## Prompt deduplication review

- [Review](prompt-dedup-review/REVIEW.md) and [assembled prompt diff](prompt-dedup-review/assembled-prompts.diff): reconstructed from retained source history, migration bodies, report-generation code, and original measurements.
- `prompt-dedup-review/before.json` and `after.json`: recovered prompt bodies. All 18 before/after SHA-256 hashes match the original measurements.
- `prompt-dedup-review/measurements.json`: exact original measurement rows in a reconstructed JSON wrapper; original wrapper metadata was not recovered.
- `prompt-dedup-review/measure.mts`: original initial script revision recovered from its creation command. Later script edits are not included. This offline measurement helper was not executed during recovery.

## Model comparison preparation

- [Synthetic scenarios](model-comparison-review/SCENARIOS.md): readable rendering of the six original synthetic scenarios from the surviving local generator.
- `model-comparison-review/synthetic-scenarios.json`: regenerated from that original generator. These are invented test cases, not captured player data.

The comparison was paused. No completed comparison results or approved complete payload pack are claimed.

## Retention policy and gaps

Useful Markdown and text diffs are eligible for version control. Generated media, raw JSON, scripts, Playwright reports, and test-result directories remain ignored under the current repository rules. No files were staged, committed, or pushed during recovery.

Large images and binaries were intentionally not restored. Credentials, login exports, and save/database dumps were not copied. The inventory above lists the materials recovered; it does not claim that every deleted artifact was recoverable.
