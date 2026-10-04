import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalResidentPackageInputs, type FirstPartyNpcCatalog, validateFirstPartyNpcCatalog } from '../src/lib/game/first-party-npc-catalog.js';
import { canonicalNpcSheet } from '../src/lib/game/npc-sheet.js';

const CATALOG_DIRECTORY = 'supabase/content/first-party-npcs';
/**
 * This is an executable migration, not an auxiliary generated artifact. A
 * clean database reset therefore installs the same catalog that validation
 * checks. The JSON files remain the only authored source.
 */
export const GENERATED_CATALOG_MIGRATION = 'supabase/migrations/202609190064_first_party_npc_catalog.generated.sql';
const stable = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export type CatalogReleasePublication = {
  identityId: string; identityKey: string; startingRosterOrder: number; versionId: string; releaseKey: string; versionNumber: number; isCurrent: boolean;
  sheet: unknown; sheetHash: string; definitionHash: string; capabilityOptionIds: string[];
};

export function readFirstPartyCatalogs(directory = CATALOG_DIRECTORY): FirstPartyNpcCatalog[] {
  const files = readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
  if (!files.length) throw new Error('First-party catalog must contain at least one identity file.');
  const catalogs = files.map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as FirstPartyNpcCatalog);
  const issues = catalogs.flatMap((catalog, index) => validateFirstPartyNpcCatalog(catalog).map((issue) => `${files[index]}: ${issue}`));
  const ids = new Set<string>(); const keys = new Set<string>(); const orders = new Set<number>();
  for (const catalog of catalogs) {
    const identity = catalog.identity;
    if (ids.has(identity.id)) issues.push(`${identity.key}: duplicate identity ID`); ids.add(identity.id);
    if (keys.has(identity.key)) issues.push(`${identity.key}: duplicate identity key`); keys.add(identity.key);
    if (orders.has(identity.startingRosterOrder)) issues.push(`${identity.key}: duplicate starting roster order`); orders.add(identity.startingRosterOrder);
  }
  if (issues.length) throw new Error(`Invalid first-party NPC catalog:\n${issues.join('\n')}`);
  return stable(catalogs);
}

export function catalogPublications(catalogs: FirstPartyNpcCatalog[]): CatalogReleasePublication[] {
  return catalogs.flatMap((catalog) => catalog.identity.releases.map((release) => ({
    identityId: catalog.identity.id, identityKey: catalog.identity.key, startingRosterOrder: catalog.identity.startingRosterOrder,
    versionId: release.versionId, releaseKey: release.releaseKey, versionNumber: release.versionNumber, isCurrent: release.releaseKey === catalog.identity.activeReleaseKey,
    sheet: release.sheet, sheetHash: sha256(canonicalNpcSheet(release.sheet)), definitionHash: sha256(canonicalResidentPackageInputs(release)), capabilityOptionIds: [...release.capabilityOptionIds].sort()
  }))).sort((left, right) => left.startingRosterOrder - right.startingRosterOrder || left.versionNumber - right.versionNumber || left.releaseKey.localeCompare(right.releaseKey));
}

/** Deterministic adapter: all table shape and validation remain in the private install function. */
export function generateFirstPartyCatalogSql(catalogs = readFirstPartyCatalogs()): string {
  const lines = ['-- GENERATED from supabase/content/first-party-npcs. Do not edit.', 'begin;'];
  for (const release of catalogPublications(catalogs)) {
    const canonicalSheet = canonicalNpcSheet(release.sheet as never);
    if (canonicalSheet.includes('$npc$')) {
      throw new Error(`${release.identityKey}/${release.releaseKey} contains the reserved SQL catalog delimiter.`);
    }
    const capabilityIds = `array[${release.capabilityOptionIds.map(quote).join(',')}]::text[]`;
    lines.push(`select private.npc_install_first_party_release(${quote(release.identityId)}::uuid,${quote(release.identityKey)},${release.startingRosterOrder},${quote(release.versionId)}::uuid,${quote(release.releaseKey)},${release.versionNumber},${release.isCurrent},$npc$${canonicalSheet}$npc$::jsonb,${capabilityIds});`);
  }
  lines.push('commit;', '');
  return lines.join('\n');
}

function main(): void {
  const mode = process.argv.includes('--generate') ? 'generate' : 'check';
  const generated = generateFirstPartyCatalogSql();
  if (mode === 'generate') { writeFileSync(GENERATED_CATALOG_MIGRATION, generated); console.info(`Wrote ${GENERATED_CATALOG_MIGRATION}.`); return; }
  const committed = readFileSync(GENERATED_CATALOG_MIGRATION, 'utf8');
  if (generated !== committed) {
    throw new Error(`${GENERATED_CATALOG_MIGRATION} is stale. Run npm run npc:catalog:generate and commit the result.`);
  }
  console.info(`First-party NPC catalog: ${catalogPublications(readFirstPartyCatalogs()).length} immutable release publications are valid and deterministic.`);
}
if (process.argv[1]?.endsWith('first-party-npc-catalog.ts')) main();
