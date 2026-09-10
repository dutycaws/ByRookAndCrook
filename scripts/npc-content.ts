import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { hasExecutableSteps } from '../src/lib/game/dialogue';
import { intentionSchema, matchesSchema } from '../src/lib/server/dialogue/schemas';

const content = JSON.parse(readFileSync('supabase/content/npcs.json','utf8'));
const assert = (condition:unknown, message:string) => { if(!condition)throw new Error(message); };
assert(/^npc-[a-z0-9-]+$/.test(content.version), 'Use an explicit npc-* content version.');
assert(typeof content.provenance==='string' && content.provenance.length>20,'Describe content provenance.');
assert(Array.isArray(content.entities) && content.entities.every((x:unknown)=>typeof x==='string'),'Define known entity IDs.');
assert(Array.isArray(content.characters) && content.characters.length===2,'The pilot supports exactly two characters.');
assert(new Set(content.characters.map((c:any)=>c.key)).size===2,'Character keys must be unique.');
for(const c of content.characters) {
  assert(['lira','torvin'].includes(c.key),'Unknown pilot character.');
  assert(['name','title','voice'].every(k=>typeof c[k]==='string'&&c[k].trim()),`Missing identity or voice for ${c.key}.`);
  const q=c.quest;
  assert(matchesSchema({goal:q.goal,motivation:q.motivation,targets:q.targets,steps:q.steps},intentionSchema),`Invalid default intention for ${c.key}.`);
  assert(hasExecutableSteps(q.steps),'Default plans must end with their only attempt or abandonment.');
  assert(q.targets.every((x:string)=>content.entities.includes(x)), 'Quest targets must be authored entities.');
  assert(q.retireTargets.length>0 && q.retireTargets.every((x:string)=>q.targets.includes(x)),'Retired targets must belong to the objective.');
  assert(['scouting','combat','diplomacy','trade'].every(a=>Number.isInteger(q.skills[a])&&q.skills[a]>=0&&q.skills[a]<=4),'Skills must be 0–4.');
  assert(Number.isInteger(q.difficulty)&&q.difficulty>=0&&q.difficulty<=4,'Difficulty must be 0–4.');
  assert(['dead','departed'].includes(q.loss.kind)&&typeof q.loss.warning==='string'&&q.loss.warning.length>10,'Authored loss requires a visible warning.');
  assert(c.facts.every((f:any)=>typeof f.id==='string'&&typeof f.text==='string'&&['history','relationships'].includes(f.category)&&Number.isInteger(f.minTrust)&&f.minTrust>=0&&f.minTrust<=100),'Facts require explicit disclosure thresholds.');
}
const migrations=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
const installed=new Map<string,unknown>();
for(const file of migrations) {
  const source=readFileSync(`supabase/migrations/${file}`,'utf8');
  for(const match of source.matchAll(/\$npc\$([\s\S]*?)\$npc\$/g)) {
    const sheet=JSON.parse(match[1]);
    const prefix=source.slice(0,match.index);
    const version=prefix.match(/'([^']+)','([^']+)',$/)?.[2];
    installed.set(sheet.key,{sheet,version});
  }
}
const output=process.argv.find(a=>a.startsWith('--migration='))?.slice('--migration='.length);
if(output) {
  assert(/^\d{12,14}_[a-z0-9_]+\.sql$/.test(output) && output>migrations.at(-1)!,'Choose a new migration filename after existing migrations.');
  const previousSql=migrations.map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')).join('\n');
  assert(!previousSql.includes(`'${content.version}'`),'Published versions are immutable. Bump the content version first.');
  const lines=['-- Publish authored NPC content; existing saves keep their pinned versions.','begin;'];
  for(const c of content.characters) {
    const payload=JSON.stringify(c);
    assert(!payload.includes('$npc$'),'Content cannot contain the SQL delimiter.');
    lines.push(`insert into private.npc_content_versions(patron_key,version,sheet) values('${c.key}','${content.version}',$npc$${payload}$npc$::jsonb);`);
    lines.push(`update private.npc_content set version='${content.version}',sheet=(select sheet from private.npc_content_versions where patron_key='${c.key}' and version='${content.version}') where patron_key='${c.key}';`);
  }
  lines.push('commit;','');
  writeFileSync(`supabase/migrations/${output}`,lines.join('\n'),{flag:'wx'});
  console.info(`Wrote ${output}. Review and apply it with supabase migration up.`);
} else {
  for(const c of content.characters)assert(isDeepStrictEqual(installed.get(c.key),{sheet:c,version:content.version}),`${c.key} differs from the published migration. Bump the version and generate a content migration.`);
  console.info(`NPC content ${content.version}: two validated character sheets match their migrations.`);
}
