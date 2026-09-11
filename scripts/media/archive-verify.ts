import { matchingRestoreReceipt, readReceipts, verifyArchive, writeReceipts } from './master-lib.js';
const index = process.argv.indexOf('--archive');
if (index < 0 || !process.argv[index + 1]) throw new Error('usage: tsx scripts/media/archive-verify.ts --archive <zip>');
const archive = process.argv[index + 1];
verifyArchive(archive, { requireSidecar: true }).then(async (result) => {
  const receipts = await readReceipts();
  const receipt = matchingRestoreReceipt(receipts, result);
  if (receipt) {
    receipt.restoreChecks ??= [];
    receipt.restoreChecks.push({ verifiedAt: new Date().toISOString(), sha256: result.archiveSha256 });
    await writeReceipts(receipts);
    console.log(`recorded restore verification for ${receipt.archiveId}`);
  } else {
    console.warn('archive verified but no tracked receipt matched its SHA-256; no restore record was written');
  }
  console.log(`verified ${result.objectCount} masters; archive SHA-256 ${result.archiveSha256}`);
}).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
