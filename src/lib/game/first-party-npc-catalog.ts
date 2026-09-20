import type { NpcInitialPersonalityEntry, NpcPersonalityCollection, NpcPersonalityDimension, NpcSheet } from './npc-sheet';
import { canonicalNpcSheet, validateNpcSheet } from './npc-sheet';

export const FIRST_PARTY_CATALOG_VERSION = 'first-party-catalog-v1' as const;
/** Mirrors the server-issued community-capability-options-v1 registry. Terminal
 * outcomes are deliberately excluded: their permission comes only from an
 * authored campaign permanent-loss template. */
export const CAPABILITY_OPTION_REGISTRY_V1 = [
  'quest.action.prepare', 'quest.action.wait', 'quest.action.attempt', 'quest.action.abandon',
  'quest.approach.scouting', 'quest.approach.combat', 'quest.approach.diplomacy', 'quest.approach.trade',
  'effect.adjust_relationship', 'effect.create_quest', 'effect.update_quest', 'effect.create_entity', 'effect.record_world_event', 'effect.apply_location_modifier', 'effect.transfer_inventory', 'effect.unlock_recipe', 'effect.set_availability',
  'social.conceal', 'social.misdirect', 'social.deceive', 'social.share_gossip'
] as const;
export type FirstPartyNpcRelease = { releaseKey: string; versionId: string; versionNumber: number; sheet: NpcSheet; capabilityOptionIds: string[]; };
export type FirstPartyNpcCatalog = { catalogVersion: typeof FIRST_PARTY_CATALOG_VERSION; identity: { id: string; key: string; startingRosterOrder: number; activeReleaseKey: string; releases: FirstPartyNpcRelease[]; }; };
export type ResidentPersonalitySchemaV1 = { version: 'personality-schema-v1'; dimensions: NpcPersonalityDimension[]; collections: NpcPersonalityCollection[]; };
export type ResidentInitialProfileV1 = { dimensions: Record<string, number>; entries: NpcInitialPersonalityEntry[]; };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = /^[a-z][a-z0-9-]{1,63}$/;
const optionId = /^[a-z]+(?:\.[a-z_]+)+$/;
const capabilityOptionIds = new Set<string>(CAPABILITY_OPTION_REGISTRY_V1);

export function deriveResidentPersonalitySchema(sheet: NpcSheet): ResidentPersonalitySchemaV1 { return structuredClone({ version: 'personality-schema-v1' as const, dimensions: sheet.personality.dimensions, collections: sheet.personality.collections }); }
export function deriveResidentInitialProfile(sheet: NpcSheet): ResidentInitialProfileV1 { return { dimensions: Object.fromEntries(sheet.personality.dimensions.map((dimension) => [dimension.key, dimension.initialValue])), entries: structuredClone(sheet.personality.initialEntries) }; }
export function canonicalResidentPackageInputs(release: FirstPartyNpcRelease): string { return JSON.stringify({ capabilityOptionIds: [...release.capabilityOptionIds].sort(), initialProfile: deriveResidentInitialProfile(release.sheet), personalitySchema: deriveResidentPersonalitySchema(release.sheet), sheetHashInput: canonicalNpcSheet(release.sheet), versionId: release.versionId, versionNumber: release.versionNumber }); }

export function validateFirstPartyNpcCatalog(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['catalog must be an object'];
  const catalog = value as Partial<FirstPartyNpcCatalog>; const identity = catalog.identity as FirstPartyNpcCatalog['identity'] | undefined;
  if (catalog.catalogVersion !== FIRST_PARTY_CATALOG_VERSION) issues.push('catalogVersion must be first-party-catalog-v1');
  if (!identity || !uuid.test(identity.id) || !key.test(identity.key) || !Number.isInteger(identity.startingRosterOrder) || identity.startingRosterOrder < 0 || !Array.isArray(identity.releases) || identity.releases.length < 1) return [...issues, 'identity requires a stable UUID/key/order and one or more releases'];
  const releaseKeys = new Set<string>(); const versionIds = new Set<string>(); const versionNumbers = new Set<number>();
  identity.releases.forEach((release, index) => {
    if (!key.test(release.releaseKey) || releaseKeys.has(release.releaseKey)) issues.push(`releases.${index}.releaseKey must be unique and normalized`); releaseKeys.add(release.releaseKey);
    if (!uuid.test(release.versionId) || versionIds.has(release.versionId)) issues.push(`releases.${index}.versionId must be a unique UUID`); versionIds.add(release.versionId);
    if (!Number.isInteger(release.versionNumber) || release.versionNumber < 1 || versionNumbers.has(release.versionNumber)) issues.push(`releases.${index}.versionNumber must be a unique positive integer`); versionNumbers.add(release.versionNumber);
    if (!Array.isArray(release.capabilityOptionIds) || new Set(release.capabilityOptionIds).size !== release.capabilityOptionIds.length || release.capabilityOptionIds.some((option) => !optionId.test(option) || !capabilityOptionIds.has(option))) issues.push(`releases.${index}.capabilityOptionIds must be unique server-issued capability option IDs`);
    issues.push(...validateNpcSheet(release.sheet).map((entry) => `releases.${index}.sheet.${entry.path}:${entry.code}`));
  });
  if (!releaseKeys.has(identity.activeReleaseKey)) issues.push('identity.activeReleaseKey must name a release');
  return issues;
}
