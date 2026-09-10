import { schemas, matchesSchema, type Stage } from './schemas';
import { prompts, PROMPT_VERSION } from './prompts';
export interface StageOutput { value: unknown; usage: { input: number; output: number }; model: string; durationMs: number; promptVersion: string }
export interface DialogueProvider { generate(stage: Stage, payload: unknown, signal: AbortSignal): Promise<StageOutput> }
export class ProviderUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderUnavailable'; }
}
export function createProvider(config: Record<string,string | undefined>): DialogueProvider {
  const provider = config.NPC_PROVIDER ?? 'openai';
  if (provider==='local') return { async generate() { throw new ProviderUnavailable('Local model support is not implemented.'); } };
  if (provider!=='openai') throw new ProviderUnavailable('Unknown NPC provider.');
  return { async generate(stage,payload,signal) {
    if (!config.OPENAI_API_KEY) throw new ProviderUnavailable('OpenAI is not configured.');
    const started=performance.now();
    const model = stage==='deliberate' || stage==='speak' ? config.NPC_CHARACTER_MODEL ?? 'gpt-5.6-terra' : config.NPC_CONTEXT_MODEL ?? 'gpt-5.6-luna';
    const body: Record<string,unknown> = { model, store:false, max_output_tokens:2500,
      reasoning:{effort:stage==='deliberate'||stage==='speak'?'low':'none'},
      input:[{role:'system',content:prompts[stage]},{role:'user',content:JSON.stringify(payload)}] };
    if(stage==='investigate') {
      body.tools=[{type:'function',name:'request_context',description:'Request scoped NPC knowledge from the game.',strict:true,parameters:schemas.investigate}];
      body.tool_choice={type:'function',name:'request_context'}; body.parallel_tool_calls=false;
    } else body.text={format:{type:'json_schema',name:stage,strict:true,schema:schemas[stage]}};
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${config.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    if(!response.ok) throw new ProviderUnavailable(`OpenAI request failed (${response.status}).`);
    const result=await response.json();
    if(result.status!=='completed') throw new ProviderUnavailable('OpenAI did not complete the generation.');
    const raw=stage==='investigate' ? result.output?.find((o:any)=>o.type==='function_call'&&o.name==='request_context')?.arguments
      : result.output?.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content).filter((o:any)=>o.type==='output_text').map((o:any)=>o.text).join('');
    let value; try {value=JSON.parse(raw);} catch {throw new ProviderUnavailable('OpenAI returned an incomplete structured response.');}
    if(!matchesSchema(value,schemas[stage])) throw new ProviderUnavailable('OpenAI returned an invalid structured response.');
    return {value,usage:{input:result.usage?.input_tokens??0,output:result.usage?.output_tokens??0},model,durationMs:Math.round(performance.now()-started),promptVersion:PROMPT_VERSION};
  }};
}
