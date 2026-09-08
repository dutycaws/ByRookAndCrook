import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
function environmentFiles(directory:string, prefix=''): string[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const name=prefix+entry.name;
    if(entry.isDirectory()) {
      if(['node_modules','.git','.codex','.agents','.svelte-kit','build','artifacts','test-results','playwright-report','.temp'].includes(entry.name))return [];
      return environmentFiles(`${directory}/${entry.name}`,`${name}/`);
    }
    return /^\.env(?:\..+)?$/.test(entry.name)&&entry.name!=='.env.example'?[name]:[];
  });
}
const candidates = environmentFiles(projectRoot)
  .map((name) => ({ name, path: fileURLToPath(new URL(`../${name}`, import.meta.url)) }))
  .filter(({ path }) => existsSync(path));

if (candidates.length > 2) {
  throw new Error(`Found ${candidates.length} project-managed secret files; at most two are allowed.`);
}

for (const candidate of candidates) {
  const ignored = spawnSync('git', ['check-ignore', '--quiet', candidate.name], { cwd: projectRoot });
  if (ignored.status !== 0) throw new Error(`${candidate.name} contains runtime secrets but is not ignored by Git.`);
  if ((statSync(candidate.path).mode & 0o077) !== 0) {
    throw new Error(`${candidate.name} must not be readable or writable by group or other users.`);
  }
}

const primaryEnvironment = candidates.find(({ name }) => name === '.env');
if (primaryEnvironment) process.loadEnvFile(primaryEnvironment.path);

const secretNames = new Set([
  'LOCAL_PILOT_ONE_PASSWORD',
  'LOCAL_PILOT_TWO_PASSWORD',
  'LOCAL_TEST_USER_PASSWORD',
  'OPENAI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  ...[...(primaryEnvironment?readFileSync(primaryEnvironment.path,'utf8'):'').matchAll(/^(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=/gm)]
    .map(match=>match[1]).filter(name=>!name.startsWith('PUBLIC_')&&/(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name))
]);
const sourceFiles=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:projectRoot,encoding:'utf8'}).split('\0').filter(Boolean);

for (const name of secretNames) {
  const value = process.env[name];
  if (!value) continue;

  // Read tracked and new source files without putting secret values in process arguments.
  for(const source of sourceFiles) {
    const path=`${projectRoot}/${source}`;
    if(existsSync(path)&&statSync(path).isFile()&&readFileSync(path).includes(Buffer.from(value))) {
      throw new Error(`${name} appears in source file ${source}.`);
    }
  }
}

execFileSync('git', ['status', '--short', '--ignored', ...candidates.map(({ path }) => relative(projectRoot, path))], {
  cwd: projectRoot,
  stdio: 'ignore'
});

console.info(`Secret audit passed: ${candidates.length} project-managed secret file${candidates.length === 1 ? '' : 's'}, all ignored and permission-restricted, with no configured secret values tracked.`);
