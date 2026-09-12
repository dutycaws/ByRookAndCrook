import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { assertRegularFile, readCatalog, storageKey, storageMode, uploadAndVerify, validateCatalog, validateMasterBuffer, validateRuntimeDerivativeInventory, writeCatalog, type MasterRecord } from './master-lib.js';

function argument(name: string, required = true) { const index = process.argv.indexOf(name); const value = index < 0 ? undefined : process.argv[index + 1]; if (required && (!value || value.startsWith('--'))) throw new Error(`missing ${name}`); return value; }
async function main() {
  const sourcePath = resolve(argument('--file')); const id = argument('--id'); const metadataArgument = argument('--metadata', false);
  await assertRegularFile(sourcePath); const source = await readFile(sourcePath); const metadata = metadataArgument ? JSON.parse(await readFile(resolve(metadataArgument), 'utf8')) as { provenance: { acquiredAt: string; source: string; rights: string; promptOrNote: string; exportSettings: string }; derivatives?: Array<{ path: string; sha256: string; recipe: string }>; supersedes?: string } : undefined;
  const details = validateMasterBuffer(source); const catalog = await readCatalog();
  const existing = catalog.masters.find((master) => master.id === id && master.sha256 === details.sha256);
  if (existing) { await uploadAndVerify(existing, source); existing.verifiedAt ??= new Date().toISOString(); await writeCatalog(catalog); console.log(`verified existing catalog record ${existing.id} in ${storageMode()} storage: ${existing.storageKey}`); return; }
  if (!metadata?.provenance || !metadata.provenance.acquiredAt || !metadata.provenance.source || !metadata.provenance.rights || !metadata.provenance.promptOrNote || !metadata.provenance.exportSettings) throw new Error('new masters require --metadata with complete provenance');
  const record: MasterRecord = { id, revisionId: `${id}@${details.sha256.slice(0, 12)}`, originalFilename: basename(sourcePath), ...details, storageKey: storageKey(details.sha256), provenance: metadata.provenance, derivatives: metadata.derivatives ?? [], ...(metadata.supersedes ? { supersedes: metadata.supersedes } : {}) };
  catalog.masters.push(record);
  for (const derivative of record.derivatives) {
    const current = catalog.runtimeDerivatives.find((candidate) => candidate.path === derivative.path);
    if (current) Object.assign(current, { sha256: derivative.sha256, recipe: derivative.recipe, sourceRevisionId: record.revisionId });
    else catalog.runtimeDerivatives.push({ ...derivative, sourceRevisionId: record.revisionId });
  }
  catalog.masters.sort((left, right) => left.id.localeCompare(right.id) || left.revisionId.localeCompare(right.revisionId));
  catalog.runtimeDerivatives.sort((left, right) => left.path.localeCompare(right.path));
  validateCatalog(catalog, 'candidate source-master catalog');
  await validateRuntimeDerivativeInventory(catalog);
  await uploadAndVerify(record, source);
  record.verifiedAt = new Date().toISOString();
  await writeCatalog(catalog);
  console.log(`verified and cataloged ${record.revisionId} in ${storageMode()} storage: ${record.storageKey}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
