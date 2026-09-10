import { resolve } from 'node:path';
import { collectCatalogObjectsFromStorage, createArchive, readCatalog, readReceipts, writeCatalog, writeReceipts } from './master-lib.js';
async function main() {
  const catalog = await readCatalog();
  // A successful download/hash pass is the primary-storage verification event. Persist it
  // before creating the archive so the receipt covers the exact release-eligible catalog.
  const objects = await collectCatalogObjectsFromStorage(catalog);
  const verifiedAt = new Date().toISOString();
  for (const master of catalog.masters) master.verifiedAt ??= verifiedAt;
  await writeCatalog(catalog);
  const { archive, receipt } = await createArchive(catalog, objects, resolve('artifacts/media-master-backups'));
  const receipts = await readReceipts();
  if (!receipts.receipts.some((item) => item.archiveId === receipt.archiveId)) { receipts.receipts.push(receipt); receipts.receipts.sort((a, b) => a.archiveId.localeCompare(b.archiveId)); await writeReceipts(receipts); }
  console.log(`created ${archive}\nSHA-256 ${receipt.sha256}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
