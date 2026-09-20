import { describe, expect, it } from 'vitest';
import { GENERATED_CATALOG_MIGRATION, catalogPublications, generateFirstPartyCatalogSql, readFirstPartyCatalogs } from '../../scripts/npc-content';
import { readFileSync } from 'node:fs';
import { canonicalResidentPackageInputs, deriveResidentInitialProfile, deriveResidentPersonalitySchema, validateFirstPartyNpcCatalog } from '../../src/lib/game/first-party-npc-catalog';

describe('first-party-catalog-v1', () => {
  it('is the sole repository catalog source with stable identity/release IDs and orders', () => {
    const catalogs = readFirstPartyCatalogs(); const publications = catalogPublications(catalogs);
    expect(catalogs.map((catalog) => catalog.identity.key)).toEqual(['lira', 'torvin']);
    expect(publications.map((entry) => [entry.identityId, entry.versionId, entry.versionNumber, entry.isCurrent])).toEqual([
      ['18181818-1818-4181-8181-181818181818', '18181818-1818-4181-8181-181818181819', 1, true],
      ['28282828-2828-4282-8282-282828282828', '28282828-2828-4282-8282-282828282829', 1, true]
    ]);
  });

  it('derives immutable deep-resident package inputs deterministically', () => {
    const release = readFirstPartyCatalogs()[0].identity.releases[0];
    expect(deriveResidentPersonalitySchema(release.sheet)).toMatchObject({ version: 'personality-schema-v1', dimensions: release.sheet.personality.dimensions });
    expect(deriveResidentInitialProfile(release.sheet).entries).toEqual(release.sheet.personality.initialEntries);
    expect(canonicalResidentPackageInputs(release)).toBe(canonicalResidentPackageInputs(structuredClone(release)));
  });

  it('generates the private install adapter byte-for-byte deterministically', () => {
    const sql = generateFirstPartyCatalogSql();
    expect(sql).toBe(generateFirstPartyCatalogSql());
    expect(readFileSync(GENERATED_CATALOG_MIGRATION, 'utf8')).toBe(sql);
    expect(sql).toContain('private.npc_install_first_party_release');
    expect(sql).toContain("'lira'");
    expect(sql).toContain("'torvin'");
  });

  it('rejects mutable release selectors and invalid catalog identities', () => {
    const invalid = structuredClone(readFirstPartyCatalogs()[0]); invalid.identity.activeReleaseKey = 'missing'; invalid.identity.releases[0].versionNumber = 0;
    expect(validateFirstPartyNpcCatalog(invalid)).toEqual(expect.arrayContaining(['releases.0.versionNumber must be a unique positive integer', 'identity.activeReleaseKey must name a release']));
  });

  it('accepts only server-issued capability IDs and never treats terminal outcomes as capabilities', () => {
    const invalid = structuredClone(readFirstPartyCatalogs()[0]);
    invalid.identity.releases[0].capabilityOptionIds.push('terminal.dead', 'effect.not_real');
    expect(validateFirstPartyNpcCatalog(invalid)).toContain('releases.0.capabilityOptionIds must be unique server-issued capability option IDs');
  });
});
