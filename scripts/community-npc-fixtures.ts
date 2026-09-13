import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NpcSheet } from '../src/lib/game/npc-sheet.js';
import { LOCAL_SHOP_RUNTIME_ASSET_BUCKET } from '../src/lib/game/shop-runtime-assets.js';
import {
  ensureLocalShopRuntimeAssetBucket,
  type LocalAssetStorage
} from './local-shop-runtime-assets.js';

type RpcClient = Pick<SupabaseClient, 'rpc'>;

export type LocalCommunityFixtureUsers = {
  administrator: { id: string; email: string; password: string };
  reviewer: { id: string; email: string; password: string };
};

const FIXTURE_NPC_NAME = 'Willow Vellum';
const COMMUNITY_NPC_LOCAL_DIRECTORY = '.local/media/runtime-derivatives/community-npcs';
const COMMUNITY_NPC_SETTING_MASTER = '.local/media/source-masters/community-npcs/settings/CozyTavernBackground.png';
const COMMUNITY_NPC_SETTINGS_DIRECTORY = `${COMMUNITY_NPC_LOCAL_DIRECTORY}/settings`;
const COMMUNITY_NPC_SETTING_VARIANTS = [
  { id: 'c0370000-0000-4000-8000-000000000001', filename: 'lantern-lit-tavern-table.webp', crop: '900x506+760+300' },
  { id: 'c0370000-0000-4000-8000-000000000002', filename: 'hearth-side-booth.webp', crop: '950x534+0+160' },
  { id: 'c0370000-0000-4000-8000-000000000003', filename: 'quiet-window-table.webp', crop: '1000x562+250+80' }
] as const;
// The shared local fixture bucket deliberately admits only WebP derivatives.
const COMMUNITY_NPC_EXTENSIONS = new Set(['.webp']);
const MAX_RUNTIME_BYTES = 2 * 1024 * 1024;

export type LocalCommunityNpcSceneAsset = {
  localFilename: string;
  storageKey: string;
  sha256: string;
};

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The setting library is derived only from the ignored, user-supplied source
 * master.  Nothing is synthesized or committed by this helper.
 */
export function deriveLocalCommunityNpcSettingVariants(projectRoot = process.cwd()): string[] {
  const source = resolve(projectRoot, COMMUNITY_NPC_SETTING_MASTER);
  if (!existsSync(source)) return [];
  const outputDirectory = resolve(projectRoot, COMMUNITY_NPC_SETTINGS_DIRECTORY);
  mkdirSync(outputDirectory, { recursive: true });
  for (const variant of COMMUNITY_NPC_SETTING_VARIANTS) {
    const output = resolve(outputDirectory, variant.filename);
    execFileSync('convert', [source, '-crop', variant.crop, '+repage', '-resize', '1600x900!', '-strip', '-quality', '86', output]);
  }
  return COMMUNITY_NPC_SETTING_VARIANTS.map((variant) => `settings/${variant.filename}`);
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/** Produces the only accepted local scene-storage namespace for community NPCs. */
export function communityNpcStorageKey(localFilename: string): string | null {
  const normalized = localFilename.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  if (normalized.startsWith('settings/') && normalized.split('/').length === 2) return `community-settings/${normalized.slice('settings/'.length)}`;
  return `community-npcs/${normalized}`;
}

function discoverCommunityFiles(directory: string, relativeDirectory = ''): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(directory, entry.name);
    const childRelative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (!isContained(directory, child)) return [];
    if (entry.isDirectory()) return discoverCommunityFiles(child, childRelative);
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    return entry.isFile() && COMMUNITY_NPC_EXTENSIONS.has(extension) ? [childRelative] : [];
  });
}

/** Lists real, ignored Community NPC derivative inputs in deterministic order. */
export function listLocalCommunityNpcSceneAssets(projectRoot = process.cwd()): LocalCommunityNpcSceneAsset[] {
  const root = resolve(projectRoot, COMMUNITY_NPC_LOCAL_DIRECTORY);
  return discoverCommunityFiles(root)
    .sort()
    .map((localFilename) => {
      const path = resolve(root, localFilename);
      if (!isContained(root, path)) throw new Error(`Community NPC fixture path escapes its local directory: ${localFilename}`);
      const bytes = readFileSync(path);
      if (bytes.length > MAX_RUNTIME_BYTES) throw new Error(`Community NPC runtime derivative exceeds ${MAX_RUNTIME_BYTES} bytes: ${localFilename}`);
      const storageKey = communityNpcStorageKey(localFilename);
      if (!storageKey) throw new Error(`Invalid Community NPC runtime derivative path: ${localFilename}`);
      return { localFilename, storageKey, sha256: sha256(bytes) };
    });
}

/** Uploads only dedicated community-NPC runtime derivatives to local Storage. */
export async function seedLocalCommunityNpcRuntimeAssets(storage: LocalAssetStorage, projectRoot = process.cwd()): Promise<LocalCommunityNpcSceneAsset[]> {
  await ensureLocalShopRuntimeAssetBucket(storage);
  deriveLocalCommunityNpcSettingVariants(projectRoot);
  const root = resolve(projectRoot, COMMUNITY_NPC_LOCAL_DIRECTORY);
  const bucket = storage.from(LOCAL_SHOP_RUNTIME_ASSET_BUCKET);
  const assets = listLocalCommunityNpcSceneAssets(projectRoot);
  for (const asset of assets) {
    const bytes = readFileSync(resolve(root, asset.localFilename));
    const upload = await bucket.upload(asset.storageKey, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
    if (upload.error) throw new Error(`Unable to upload local Community NPC runtime asset ${asset.storageKey}: ${upload.error.message}`);
    const downloaded = await bucket.download(asset.storageKey);
    if (downloaded.error || !downloaded.data) throw new Error(`Unable to verify local Community NPC runtime asset ${asset.storageKey}: ${downloaded.error?.message ?? 'empty response'}`);
    if (sha256(Buffer.from(await downloaded.data.arrayBuffer())) !== asset.sha256) throw new Error(`Local Community NPC runtime asset read-back hash mismatch for ${asset.storageKey}`);
  }
  return assets;
}

/** Service-only registration pins the actual uploaded hash; no placeholder hash becomes selectable. */
export async function registerLocalCommunityNpcSettingLibrary(service: RpcClient, assets: readonly LocalCommunityNpcSceneAsset[]): Promise<void> {
  for (const variant of COMMUNITY_NPC_SETTING_VARIANTS) {
    const asset = assets.find((candidate) => candidate.localFilename === `settings/${variant.filename}`);
    if (!asset) continue;
    await callVoid(service, 'npc_author_register_setting_asset', {
      p_setting_id: variant.id, p_storage_key: asset.storageKey, p_mime_type: 'image/webp', p_width: 1600, p_height: 900, p_sha256: asset.sha256
    });
  }
}

function requireData<T>(result: { data: T | null; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${operation}: no result returned`);
  return result.data;
}

async function call<T>(client: RpcClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return requireData(await client.rpc(fn, args), fn);
}

async function callVoid(client: RpcClient, fn: string, args: Record<string, unknown> = {}): Promise<void> {
  const result = await client.rpc(fn, args);
  if (result.error) throw new Error(`${fn}: ${result.error.message}`);
}

export function createFixtureNpcSheet(): NpcSheet {
  return {
    schemaVersion: 'npc-sheet-v1',
    rating: 'standard',
    identity: {
      name: FIXTURE_NPC_NAME,
      title: 'Archive Cartographer',
      shortDescription: 'A patient mapmaker who trades careful routes for stories from the road.',
      voice: 'Warm, precise, and curious. Willow uses mapmaking metaphors sparingly and never claims an uncertain route is safe.'
    },
    appearance: {
      physicalAppearance: 'A compact traveler with ink-stained hands, wind-browned cheeks, and an observant gray gaze.',
      attire: 'A weathered blue coat, many-pocketed satchel, and a brass compass kept on a cord beneath the collar.',
      notableFeatures: 'A folded vellum map is always tucked behind one ear, marked with bright green route pins.',
      mood: 'Calmly pleased when a plan makes room for safety, local knowledge, and a return route.'
    },
    personality: {
      values: ['careful promises', 'shared knowledge'],
      likes: ['well-kept ledgers', 'hot tea'],
      dislikes: ['unmarked hazards', 'careless shortcuts'],
      boundaries: ['Will not guide someone into a known danger', 'Will not present a guess as a surveyed fact']
    },
    lore: {
      entities: [{ id: 'north-road', namespace: 'place', name: 'North Road', description: 'An old trade road whose reliable markers have begun to disappear.' }],
      npcReferences: [],
      relationships: [{ subject: { kind: 'entity', entityId: 'north-road' }, description: 'Willow feels responsible for restoring the road markers before winter travel begins.', trustThreshold: 0 }],
      facts: [{ id: 'missing-markers', category: 'goal', text: 'Willow is collecting reliable sightings of the missing North Road markers before publishing a replacement route.', trustThreshold: 0, entityRefs: ['north-road'], npcRefs: [] }]
    },
    skills: { scouting: 4, combat: 0, diplomacy: 3, trade: 3 },
    campaign: {
      durableGoal: 'Restore a dependable public route across the North Road before winter travel closes the safer passes.',
      milestones: [
        {
          id: 'survey-markers', title: 'Survey the missing markers', outcome: 'Collect enough verified observations to draw a safe preliminary route.', motivation: 'Travelers need a route that does not depend on rumors when the weather turns.', constraints: ['verify each sighting'], allowedTargets: ['north-road'], difficulty: 2,
          successNews: 'Willow completed a careful preliminary map of the North Road.', nonSuccessNews: 'The preliminary survey remains incomplete and the route stays uncertain.', retiredTargets: [], permanentLoss: null,
          startingPlan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }]
        },
        {
          id: 'publish-route', title: 'Publish the safer route', outcome: 'Share a clear, public route guide with the tavern and passing travelers.', motivation: 'A map only helps the community when people can understand and use it.', constraints: ['do not hide hazards'], allowedTargets: ['north-road'], difficulty: 3,
          successNews: 'Willow posted a clear route guide for winter travelers.', nonSuccessNews: 'The route guide could not be completed before winter travel changed.', retiredTargets: ['north-road'],
          permanentLoss: { kind: 'departed', warning: 'If the road grows too dangerous, Willow may have to leave to survey elsewhere.', outcome: 'Willow left Millhaven to find a safer route survey.' }, startingPlan: null
        }
      ]
    }
  };
}

async function signedInClient(apiUrl: string, key: string, email: string, password: string): Promise<SupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(apiUrl, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const response = await client.auth.signInWithPassword({ email, password });
  if (response.error) throw new Error(`Unable to sign in ${email}: ${response.error.message}`);
  return client;
}

/**
 * Seeds the smallest useful authoring path through public contracts. A rerun
 * verifies the existing published fixture rather than creating a duplicate.
 */
export async function seedLocalCommunityNpcFixture(
  service: RpcClient,
  apiUrl: string,
  publishableKey: string,
  users: LocalCommunityFixtureUsers,
  scene: LocalCommunityNpcSceneAsset | null
): Promise<{ state: 'published' | 'draft' | 'scene-unavailable'; npcId?: string; versionId?: string }> {
  await callVoid(service, 'npc_bootstrap_admin', { p_user: users.administrator.id });
  const admin = await signedInClient(apiUrl, publishableKey, users.administrator.email, users.administrator.password);
  const reviewer = await signedInClient(apiUrl, publishableKey, users.reviewer.email, users.reviewer.password);

  await call(admin, 'npc_update_profile', { p_display_name: 'Pilot Creator', p_bio: 'Local community-NPC fixture creator.', p_mature: false, p_attest_adult: false, p_creator_terms: true });
  await call(reviewer, 'npc_update_profile', { p_display_name: 'Pilot Reviewer', p_bio: 'Local community-NPC fixture reviewer.', p_mature: false, p_attest_adult: false, p_creator_terms: false });
  await callVoid(admin, 'npc_admin_set_capability', { p_user: users.administrator.id, p_capability: 'npc_author', p_enabled: true, p_reason: 'Local fixture author access' });
  await callVoid(admin, 'npc_admin_set_capability', { p_user: users.administrator.id, p_capability: 'npc_reviewer', p_enabled: true, p_reason: 'Local first-party review access' });
  await callVoid(admin, 'npc_admin_set_capability', { p_user: users.reviewer.id, p_capability: 'npc_reviewer', p_enabled: true, p_reason: 'Local fixture reviewer access' });
  await callVoid(service, 'npc_local_assign_first_party_author', { p_owner_id: users.administrator.id });

  const existing = await call<{ npcs?: Array<{ name?: string; npcId?: string }> }>(admin, 'npc_public_creator', { p_normalized_name: 'pilot creator' });
  const published = existing?.npcs?.find((npc) => npc.name === FIXTURE_NPC_NAME);
  if (published?.npcId) return { state: 'published', npcId: published.npcId };
  if (!scene) {
    console.warn(`Skipping the author→review→publish community-NPC fixture: no dedicated local scene derivative is available in ${COMMUNITY_NPC_LOCAL_DIRECTORY}.`);
    return { state: 'scene-unavailable' };
  }

  const workspace = await call<Array<{ npcId?: string; sheet?: { identity?: { name?: string } }; draftRevision?: number }>>(admin, 'npc_author_workspace');
  const existingDraft = workspace.find((row) => row.sheet?.identity?.name === FIXTURE_NPC_NAME);
  if (existingDraft?.npcId) return { state: 'draft', npcId: existingDraft.npcId };

  const setting = COMMUNITY_NPC_SETTING_VARIANTS.find((candidate) => scene.localFilename === `settings/${candidate.filename}`);
  if (!setting) return { state: 'scene-unavailable' };
  const created = await call<{ npcId: string; revision: number }>(admin, 'npc_author_create', { p_sheet: createFixtureNpcSheet() });
  await call(admin, 'npc_author_select_setting', {
    p_npc_id: created.npcId,
    p_expected_revision: created.revision,
    p_setting_id: setting.id
  });
  // Portrait generation stays an explicit author action because it may incur a
  // provider charge. The local fixture leaves this draft visibly blocked until
  // a real validated portrait is generated and selected.
  return { state: 'draft', npcId: created.npcId };
}

/** Scale data is explicitly opt-in and is inserted only into the disposable local database. */
export function seedOptionalLocalCommunityNpcScale(databaseUrl: string, creatorId: string, saveId: string): void {
  if (process.env.FIXTURE_NPC_SCALE !== '1') return;
  const sql = `
begin;
insert into private.npc_identities(origin,creator_id,normalized_name,status,rating)
select 'community','${creatorId}'::uuid,'scale fixture npc ' || lpad(n::text,4,'0'),'published','standard'
from generate_series(1,1000) n on conflict(normalized_name) where name_reserved do nothing;

with source as (select sheet from private.npc_versions where id='18181818-1818-4181-8181-181818181819'::uuid)
insert into private.npc_versions(npc_id,version_number,schema_version,sheet,sheet_hash,state,published_at,created_by)
select i.id,1,'npc-sheet-v1',
  jsonb_set(source.sheet,'{identity,name}',to_jsonb(initcap(i.normalized_name))),
  encode(extensions.digest((jsonb_set(source.sheet,'{identity,name}',to_jsonb(initcap(i.normalized_name))))::text,'sha256'),'hex'),
  'published',now(),'${creatorId}'::uuid
from private.npc_identities i cross join source
where i.normalized_name like 'scale fixture npc %'
  and not exists(select 1 from private.npc_versions v where v.npc_id=i.id);

update private.npc_identities i set current_published_version_id=v.id
from private.npc_versions v
where i.id=v.npc_id and i.normalized_name like 'scale fixture npc %'
  and i.current_published_version_id is distinct from v.id;

insert into private.world_npc_instances(save_id,npc_id,version_id,arrived_day)
select '${saveId}'::uuid,i.id,i.current_published_version_id,1 from private.npc_identities i
where i.normalized_name like 'scale fixture npc %' and i.current_published_version_id is not null
order by i.normalized_name limit 100
on conflict(save_id,npc_id) do nothing;
commit;`;
  const container = 'supabase_db_by-rook-and-crook';
  try {
    execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
    console.info('Seeded opt-in community scale fixture: 1,000 identities and 100 residents.');
  } catch (cause) {
    throw new Error(`FIXTURE_NPC_SCALE=1 requires the local Supabase database container (${container}): ${cause instanceof Error ? cause.message : cause}`);
  }
}
