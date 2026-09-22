import { schemas, matchesSchema, type Stage } from './schemas';
import { PROMPT_VERSION } from './prompts';
import type { PromptSnapshot } from '$lib/server/prompt-registry';
export interface ContextCount { model: string; counterId: string; inputTokens: number; durationMs: number }
export interface StageOutput { value: unknown; usage: { input: number; output: number }; model: string; durationMs: number; promptVersion: string; preflight?: { inputTokens: number; durationMs: number } }
/** Prompt snapshots are supplied by the orchestrator after it resolves the
 * durable turn pin. Fixture implementations may ignore the fourth argument. */
export interface DialogueProvider { countContext?(canonicalContext: string, signal: AbortSignal): Promise<ContextCount>; generate(stage: Stage, payload: unknown, signal: AbortSignal, prompt: PromptSnapshot): Promise<StageOutput> }
export class ProviderUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderUnavailable'; }
}
export class ProviderContextBudgetError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderContextBudgetError'; }
}
export const DIALOGUE_REQUEST_BYTE_LIMIT = 384 * 1024;
export const DIALOGUE_REQUEST_TOKEN_LIMIT = 80_000;
export const DIALOGUE_OUTPUT_TOKEN_RESERVE = 2_500;
/** One additional validated repair/review envelope is reserved against model capacity. */
export const DIALOGUE_REPAIR_TOKEN_RESERVE = 2_500;
export const dialogueRequestBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Authoritative Responses create body; token counting uses its explicit token-bearing projection. */
export function buildDialogueResponseBody(stage: Stage, payload: unknown, prompt: PromptSnapshot, model: string): Record<string, unknown> {
  const body: Record<string,unknown> = { model, store:false, max_output_tokens:DIALOGUE_OUTPUT_TOKEN_RESERVE,
    reasoning:{effort:stage==='deliberate'||stage==='speak'?'low':'none'},
    input:[{role:'system',content:prompt.body},{role:'user',content:JSON.stringify(payload)}] };
  if(stage==='investigate') {
    body.tools=[{type:'function',name:'request_context',description:'Request scoped NPC knowledge from the game.',strict:true,parameters:schemas.investigate}];
    body.tool_choice={type:'function',name:'request_context'}; body.parallel_tool_calls=false;
  } else body.text={format:{type:'json_schema',name:stage,strict:true,schema:schemas[stage]}};
  return body;
}
/** `/input_tokens` accepts only request fields that affect tokenization. */
export function buildDialogueInputTokenBody(createBody: Record<string, unknown>): Record<string, unknown> {
  const names=['model','input','tools','tool_choice','parallel_tool_calls','text'] as const;
  return Object.fromEntries(names.filter(name=>name in createBody).map(name=>[name,createBody[name]]));
}

async function preflightOpenAiRequest(body: Record<string, unknown>, signal: AbortSignal, apiKey: string, configuredCapacity?: string): Promise<{ inputTokens:number; durationMs:number }> {
  if (dialogueRequestBytes(body) > DIALOGUE_REQUEST_BYTE_LIMIT) throw new ProviderContextBudgetError('Dialogue request exceeds the transport-byte ceiling.');
  const capacity = Number(configuredCapacity);
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new ProviderContextBudgetError('The selected dialogue model has no verified input-token capacity.');
  const started=performance.now();
  const counted = await fetch('https://api.openai.com/v1/responses/input_tokens',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(buildDialogueInputTokenBody(body)),signal});
  if(!counted.ok) throw new ProviderContextBudgetError('The selected dialogue model does not support verified input-token counting.');
  const result=await counted.json(); const tokens=result?.input_tokens;
  if(!Number.isSafeInteger(tokens) || tokens < 0) throw new ProviderContextBudgetError('The token-count service returned an invalid count.');
  if(tokens > DIALOGUE_REQUEST_TOKEN_LIMIT || tokens + DIALOGUE_OUTPUT_TOKEN_RESERVE + DIALOGUE_REPAIR_TOKEN_RESERVE > capacity) throw new ProviderContextBudgetError('Dialogue request exceeds the verified input-token ceiling.');
  return {inputTokens:tokens,durationMs:Math.round(performance.now()-started)};
}
export function createProvider(config: Record<string,string | undefined>): DialogueProvider {
  const provider = config.NPC_PROVIDER ?? 'openai';
  if (provider==='local') return { async countContext() { throw new ProviderUnavailable('Local model support is not implemented.'); }, async generate() { throw new ProviderUnavailable('Local model support is not implemented.'); } };
  if (provider!=='openai') throw new ProviderUnavailable('Unknown NPC provider.');
  return { async countContext(canonicalContext,signal) {
    if (!config.OPENAI_API_KEY) throw new ProviderUnavailable('OpenAI is not configured.');
    const model=config.NPC_CONTEXT_MODEL ?? 'gpt-5.6-luna'; const started=performance.now();
    const response=await fetch('https://api.openai.com/v1/responses/input_tokens',{method:'POST',headers:{Authorization:`Bearer ${config.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:canonicalContext}),signal});
    if(!response.ok) throw new ProviderContextBudgetError('The selected dialogue model does not support verified input-token counting.');
    const data=await response.json(); if(!Number.isSafeInteger(data?.input_tokens) || data.input_tokens<0) throw new ProviderContextBudgetError('The token-count service returned an invalid count.');
    return {model,counterId:'openai-responses-input-tokens-v1',inputTokens:data.input_tokens,durationMs:Math.round(performance.now()-started)};
  }, async generate(stage,payload,signal,prompt) {
    if (!config.OPENAI_API_KEY) throw new ProviderUnavailable('OpenAI is not configured.');
    if (!prompt || prompt.promptType !== 'text_system') throw new ProviderUnavailable('The pinned dialogue prompt is unavailable.');
    const started=performance.now();
    const model = stage==='deliberate' || stage==='speak' ? config.NPC_CHARACTER_MODEL ?? 'gpt-5.6-terra' : config.NPC_CONTEXT_MODEL ?? 'gpt-5.6-luna';
    const body = buildDialogueResponseBody(stage,payload,prompt,model);
    const preflight=await preflightOpenAiRequest(body,signal,config.OPENAI_API_KEY,config.NPC_MODEL_INPUT_CAPACITY);
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${config.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    if(!response.ok) throw new ProviderUnavailable(`OpenAI request failed (${response.status}).`);
    const result=await response.json();
    if(result.status!=='completed') throw new ProviderUnavailable('OpenAI did not complete the generation.');
    const raw=stage==='investigate' ? result.output?.find((o:any)=>o.type==='function_call'&&o.name==='request_context')?.arguments
      : result.output?.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content).filter((o:any)=>o.type==='output_text').map((o:any)=>o.text).join('');
    let value; try {value=JSON.parse(raw);} catch {throw new ProviderUnavailable('OpenAI returned an incomplete structured response.');}
    if(!matchesSchema(value,schemas[stage])) throw new ProviderUnavailable('OpenAI returned an invalid structured response.');
    // Preserve the checkpoint-compatible semantic version; the safe ledger
    // carries the pinned revision and content hash separately.
    return {value,usage:{input:result.usage?.input_tokens??0,output:result.usage?.output_tokens??0},model,durationMs:Math.round(performance.now()-started),promptVersion:PROMPT_VERSION,preflight};
  }};
}
