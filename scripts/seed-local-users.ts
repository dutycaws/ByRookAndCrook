import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl, seedLocalShopRuntimeAssets } from './local-shop-runtime-assets.js';
import { seedLocalSceneRuntimeAssets } from './local-scene-runtime-assets.js';
import { ensurePrivatePortraitBuckets } from '../src/lib/server/community-npc-portraits/index.js';
import {
  registerLocalCommunityNpcSettingLibrary,
  seedLocalCommunityNpcFixture,
  seedLocalCommunityNpcRuntimeAssets,
  seedOptionalLocalCommunityNpcScale
} from './community-npc-fixtures.js';

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(environmentFile)) throw new Error('Missing .env. Run `npm run env:local` first.');
process.loadEnvFile(environmentFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Run \`npm run env:local\` first.`);
  return value;
}

const DEFAULT_USERS = [
  {
    email: required('LOCAL_PILOT_ONE_EMAIL'),
    password: required('LOCAL_PILOT_ONE_PASSWORD')
  },
  {
    email: required('LOCAL_PILOT_TWO_EMAIL'),
    password: required('LOCAL_PILOT_TWO_PASSWORD')
  }
];

function localStatus(): Record<string, string> {
  const output = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    env: { ...process.env, DO_NOT_TRACK: '1' }
  });

  return Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2]])
  );
}

async function main() {
  const status = localStatus();
  const apiUrl = assertLocalSupabaseUrl(status.API_URL ?? '');

  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('Local Supabase service role key is unavailable.');

  const admin = createClient(apiUrl.toString(), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  const pilotIds = new Map<string, string>();
  for (const account of DEFAULT_USERS) {
    const existing = listed.users.find((user) => user.email === account.email);
    const response = existing
      ? await admin.auth.admin.updateUserById(existing.id, {
          password: account.password,
          email_confirm: true
        })
      : await admin.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true
        });

    if (response.error) throw response.error;
    if (!response.data.user) throw new Error(`Local pilot ${account.email} did not return an identity.`);
    pilotIds.set(account.email, response.data.user.id);
    console.info(`${existing ? 'Updated' : 'Created'} local pilot ${account.email}`);
  }

  const assets = await seedLocalShopRuntimeAssets(admin.storage);
  const sceneAssets = await seedLocalSceneRuntimeAssets(admin.storage);
  await ensurePrivatePortraitBuckets(admin.storage);
  console.info('Verified private Community NPC expression-sprite master and runtime buckets.');
  console.info(`Verified ${assets.length} local Shop runtime asset(s) in local Supabase Storage.`);
  console.info(`Verified ${sceneAssets.length} local layered-scene runtime asset(s) in local Supabase Storage.`);
  const communitySceneAssets = await seedLocalCommunityNpcRuntimeAssets(admin.storage);
  await registerLocalCommunityNpcSettingLibrary(admin, communitySceneAssets);
  console.info(`Verified ${communitySceneAssets.length} dedicated local Community NPC runtime scene asset(s) in local Supabase Storage.`);
  const first = DEFAULT_USERS[0];
  const second = DEFAULT_USERS[1];
  const fixture = await seedLocalCommunityNpcFixture(
    admin,
    apiUrl.toString(),
    status.PUBLISHABLE_KEY ?? required('PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      administrator: { id: pilotIds.get(first.email)!, ...first },
      reviewer: { id: pilotIds.get(second.email)!, ...second }
    },
    communitySceneAssets[0] ?? null
  );
  console.info(fixture.state === 'published'
    ? `Verified local published community-NPC fixture${fixture.npcId ? ` (${fixture.npcId})` : ''}.`
    : fixture.state === 'draft'
      ? `Verified local community-NPC authoring draft${fixture.npcId ? ` (${fixture.npcId})` : ''}; portrait generation remains an explicit author action.`
      : 'Community-NPC authoring fixture skipped because the curated setting media is unavailable.');

  if (process.env.FIXTURE_NPC_SCALE === '1') {
    const creator = await createClient(apiUrl.toString(), status.PUBLISHABLE_KEY ?? required('PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } }).auth.signInWithPassword(first);
    if (creator.error || !creator.data.session) throw new Error(`Unable to create local scale fixture session: ${creator.error?.message ?? 'no session'}`);
    const creatorClient = createClient(apiUrl.toString(), status.PUBLISHABLE_KEY ?? required('PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { global: { headers: { Authorization: `Bearer ${creator.data.session.access_token}` } } });
    const tavern = await creatorClient.rpc('create_tavern');
    if (tavern.error || !tavern.data?.saveId) throw new Error(`Unable to create local scale fixture tavern: ${tavern.error?.message ?? 'no save'}`);
    seedOptionalLocalCommunityNpcScale(status.DB_URL ?? '', pilotIds.get(first.email)!, tavern.data.saveId as string);
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
