import { readCatalog, readReceipts, releaseEligibility, validateRuntimeDerivativeInventory } from './master-lib.js';
async function main() {
  const catalog = await readCatalog(); const status = releaseEligibility(catalog, await readReceipts());
  const runtimeDerivatives = await validateRuntimeDerivativeInventory(catalog);
  console.log(JSON.stringify({ ...status, runtimeDerivativeCount: runtimeDerivatives.length }, null, 2));
  if (!status.eligible) throw new Error(`source masters are not release-eligible: ${status.missingVerificationIds.length} unverified record(s), ${status.matchingReceipt ? 'receipt found' : 'no receipt for the exact current catalog'}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
