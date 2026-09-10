import { mkdirSync, writeFileSync } from 'node:fs';
import { createProvider } from '../src/lib/server/dialogue/provider';
import { prepareContext, stagePayload } from '../src/lib/server/dialogue/context';

if(!process.argv.includes('--live'))throw new Error('Pass --live to authorize provider evaluation.');
process.loadEnvFile('.env');
if(!process.env.OPENAI_API_KEY)throw new Error('Configure OPENAI_API_KEY in the ignored .env.');
const oldPlan={goal:'Protect Millhaven from the bandit camp',motivation:'Protect travelers',targets:['millhaven','bandit-camp','scout-mara'],steps:[{action:'prepare',approach:'scouting'},{action:'attempt',approach:'combat'}]};
const plan={...oldPlan,steps:[{action:'prepare',approach:'scouting'},{action:'attempt',approach:'diplomacy'}]};
const window=prepareContext({name:'Lira Nightwind',message:'Please scout first, then try diplomacy.',personality:{values:['protect travelers','keep promises']},intention:oldPlan,questStatus:'active',recent:[],hospitality:null},[
  {category:'quests',query:'current plan',sourceIds:['pilot-quest'],contentVersion:'npc-v1',data:{quest:{id:'pilot-quest',status:'active',intention:oldPlan,preparation:0,nextStep:0},events:[]}},
  {category:'relationships',query:'Mara',sourceIds:['lira-mara'],contentVersion:'npc-v1',data:{facts:[{id:'lira-mara',text:'Lira values Mara’s judgment.'}]}}
]);
const decision={stance:'agree',reaction:0,subject:'quest',evidence:'',intention:plan};
const cases=[
  {id:'accepted-change',expected:true,reply:'I agree to that plan. I will scout on my next outing, then attempt diplomacy on the following one.'},
  {id:'conditional-assistance',expected:true,reply:'I will scout first. Mara’s judgment would help, if she is available. On the following outing I will attempt diplomacy.'},
  {id:'future-not-completed',expected:true,reply:'I have not made the scouting pass yet. I will do that on my next outing, and attempt diplomacy on a later one.'},
  {id:'old-plan-overrides-agreement',expected:false,reply:'I agree. I will scout on my next outing, then attack the camp in combat on the following one instead of diplomacy.'},
  {id:'two-steps-same-night',expected:false,reply:'I will scout the camp and complete the diplomacy attempt tonight, both on the same outing.'},
  {id:'fabricated-completion',expected:false,reply:'I have already defeated the bandits. The quest succeeded and Millhaven is safe.'}
];
const provider=createProvider(process.env);const results=[];
for(const fixture of cases) {
  const out=await provider.generate('review',stagePayload(window,{decision,effectiveIntention:plan,reply:fixture.reply}),AbortSignal.timeout(30000));
  const passed=(out.value as {ok:boolean}).ok===fixture.expected;
  results.push({...fixture,...out,passed});console.info(`${fixture.id}: ${passed?'passed':'FAILED'}`);
}
const stamp=new Date().toISOString().replaceAll(':','-');
mkdirSync('artifacts/npc-evals',{recursive:true});
writeFileSync(`artifacts/npc-evals/review-${stamp}.json`,JSON.stringify({date:stamp,passed:results.every(r=>r.passed),cases:results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
