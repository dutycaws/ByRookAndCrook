import { describe, expect, it } from 'vitest';
import { GENERATED_ACTIVE_CATALOG_MIGRATION, GENERATED_CATALOG_MIGRATION, catalogPublications, generateActiveFirstPartyCatalogSql, generateFirstPartyCatalogSql, readFirstPartyCatalogs } from '../../scripts/first-party-npc-catalog';
import { readFileSync } from 'node:fs';
import { canonicalResidentPackageInputs, deriveResidentInitialProfile, deriveResidentPersonalitySchema, validateFirstPartyNpcCatalog } from '../../src/lib/game/first-party-npc-catalog';

describe('first-party-catalog-v1', () => {
  it('retains immutable v1 releases and selects the new v2 catalog for new residents', () => {
    const catalogs = readFirstPartyCatalogs(); const publications = catalogPublications(catalogs);
    expect(catalogs.map((catalog) => catalog.identity.key)).toEqual(['lira', 'torvin']);
    expect(publications.map((entry) => [entry.identityKey, entry.versionId, entry.versionNumber, entry.isCurrent])).toEqual([
      ['lira', '18181818-1818-4181-8181-181818181819', 1, false],
      ['lira', '18181818-1818-4181-8181-18181818181a', 2, true],
      ['torvin', '28282828-2828-4282-8282-282828282829', 1, false],
      ['torvin', '28282828-2828-4282-8282-28282828282a', 2, true]
    ]);
    for (const catalog of catalogs) {
      const active = catalog.identity.releases.find((release) => release.releaseKey === catalog.identity.activeReleaseKey)!;
      expect(active.sheet.campaign.initialQuestTrinket).toBeDefined();
      expect(active.sheet.campaign.milestones[1].failureCondition).toEqual({ type: 'attempt_allowance_exhausted', maxAttempts: 3 });
      expect(active.sheet.campaign.milestones[1].warnings).toHaveLength(2);
    }
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

  it('generates the active version as a separate additive installation migration', () => {
    const sql = generateActiveFirstPartyCatalogSql();
    expect(sql).toBe(generateActiveFirstPartyCatalogSql());
    expect(readFileSync(GENERATED_ACTIVE_CATALOG_MIGRATION, 'utf8')).toBe(sql);
    expect(sql).toContain("'v2',2,true");
    expect(sql).toContain('initialQuestTrinket');
    expect(sql).not.toContain("'v1',1,");
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

  it('rejects author-provided trinket strengths and incomplete failure warning gates', () => {
    const invalidReward = structuredClone(readFirstPartyCatalogs()[0]);
    const lira = invalidReward.identity.releases.find((release) => release.releaseKey === 'v2')!;
    (lira.sheet.campaign.initialQuestTrinket as unknown as Record<string, unknown>).strength = 0.99;
    expect(validateFirstPartyNpcCatalog(invalidReward).some((message) => message.includes('trinket_reward_authority'))).toBe(true);

    const invalidGate = structuredClone(readFirstPartyCatalogs()[1]);
    const torvin = invalidGate.identity.releases.find((release) => release.releaseKey === 'v2')!;
    torvin.sheet.campaign.milestones[1].warnings = [torvin.sheet.campaign.milestones[1].warnings![0]];
    expect(validateFirstPartyNpcCatalog(invalidGate).some((message) => message.includes('failure_warnings'))).toBe(true);

    const tooFewAttempts = structuredClone(readFirstPartyCatalogs()[1]);
    const shortGate = tooFewAttempts.identity.releases.find((release) => release.releaseKey === 'v2')!;
    shortGate.sheet.campaign.milestones[1].failureCondition!.maxAttempts = 2;
    expect(validateFirstPartyNpcCatalog(tooFewAttempts).some((message) => message.includes('failure_condition'))).toBe(true);
  });
});
