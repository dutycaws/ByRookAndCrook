import { readReceipts, writeReceipts } from './master-lib.js';
const index = process.argv.indexOf('--archive');
if (index < 0 || !process.argv[index + 1]) throw new Error('usage: tsx scripts/media/master-confirm-drive.ts --archive <archive-id>');
const archiveId = process.argv[index + 1];
readReceipts().then(async (receipts) => { const receipt = receipts.receipts.find((item) => item.archiveId === archiveId); if (!receipt) throw new Error(`unknown archive receipt ${archiveId}`); receipt.driveConfirmedAt = new Date().toISOString(); await writeReceipts(receipts); console.log(`recorded manual Drive confirmation for ${archiveId}`); }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
