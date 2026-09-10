import type { DialogueProvider } from '../../src/lib/server/dialogue/provider';
/** Test-only dependency injection. Never imported by the application runtime. */
export function fixtureProvider(options:{secondInvestigation?:boolean;rewrite?:boolean;failStage?:string;badPlan?:boolean;refuse?:boolean;rejectEveryReview?:boolean}={}): DialogueProvider & {stages:string[]} {
  const stages:string[]=[];let reviews=0;
  return {stages,async generate(stage,payload:any) {
    stages.push(stage);if(options.failStage===stage)throw new Error('injected provider failure');
    const base=payload.base;let value:any;
    if(stage==='investigate')value={kind:/advise|scout|thank|plan|attack/.test(base.message)?'planning':'informational',needsMore:!!options.secondInvestigation&&stages.length===1,remember:/thank|plan|advise/.test(base.message),
      requests:[{category:stages.length===1?'quests':'memories',query:base.message.slice(0,100)}]};
    if(stage==='deliberate')value={stance:'agree',reaction:base.message.includes('thank')?1:0,subject:'quest',evidence:base.message,
      intention:base.message.includes('advise')?{...base.intention,targets:options.badPlan?['invented-fortress']:base.intention.targets,
        steps:[{action:'prepare',approach:'scouting'},{action:'attempt',approach:'diplomacy'}]}:null};
    if(stage==='speak')value={text:payload.decision.intention?'I agree. I will scout on my next outing, then try diplomacy on the following one.':payload.decision.stance==='clarify'?'Which place do you mean? I need a clearer plan.':`I am considering my plans carefully. ${base.hospitality?'Thank you for the '+base.hospitality.beverage+'.':''}`};
    if(stage==='review')value={ok:!(options.rewrite&&reviews++===0),issues:options.rewrite&&reviews===1?['Use a future commitment, not completed action.']:[]};
    if(stage==='remember')value={memories:[{kind:'keeper_claim',text:'The keeper offered advice: '+payload.keeper,quote:payload.keeper,speaker:'keeper'}]};
    if(stage==='deliberate'&&options.refuse)value={...value,stance:'refuse',reaction:0,intention:null};
    if(stage==='speak'&&options.refuse)value={text:'I will not adopt that plan. I intend to prepare carefully and protect the road.'};
    if(stage==='review'&&options.rejectEveryReview)value={ok:false,issues:['The reply contradicts the evidence.']};
    return {value,usage:{input:10,output:10},model:'fixture',durationMs:1,promptVersion:'fixture-v1'};
  }};
}
