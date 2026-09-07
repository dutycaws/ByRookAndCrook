import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(environmentFile)) throw new Error('Missing .env. Run `pnpm env:local` first.');
process.loadEnvFile(environmentFile);

for (const prefix of ['LOCAL_PILOT_ONE', 'LOCAL_PILOT_TWO']) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) throw new Error(`Incomplete ${prefix} credentials. Run \`pnpm env:local\` first.`);
  console.info(`${email}  ${password}`);
}
