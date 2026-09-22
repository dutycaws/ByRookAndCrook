import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDialogueInputTokenBody, buildDialogueResponseBody, createProvider, dialogueRequestBytes, DIALOGUE_REQUEST_BYTE_LIMIT } from '$lib/server/dialogue/provider';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const prompt = fixturePromptRelease.prompts['dialogue.speak'];
const signal = new AbortController().signal;
const completed = () => new Response(JSON.stringify({ status:'completed', usage:{input_tokens:1,output_tokens:1}, output:[{type:'message',content:[{type:'output_text',text:'{"text":"Hello."}'}]}] }),{status:200});
const count = (tokens: number) => new Response(JSON.stringify({input_tokens:tokens}),{status:200});

afterEach(()=>vi.unstubAllGlobals());

describe('dialogue provider preflight',()=>{
  it('counts a canonical context with the exact minimal context-count request',async()=>{
    const fetch=vi.fn(async (_url:string,init:RequestInit)=>count(37)); vi.stubGlobal('fetch',fetch);
    await expect(createProvider({OPENAI_API_KEY:'key',NPC_CONTEXT_MODEL:'gpt-5.6-luna'}).countContext?.('{"payload":"مرحبا 👩‍🌾"}',signal))
      .resolves.toEqual(expect.objectContaining({model:'gpt-5.6-luna',counterId:'openai-responses-input-tokens-v1',inputTokens:37}));
    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/responses/input_tokens',expect.objectContaining({body:JSON.stringify({model:'gpt-5.6-luna',input:'{"payload":"مرحبا 👩‍🌾"}'})}));
  });

  it('uses projection/create parity for token counting and generation',async()=>{
    const bodies: unknown[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url:string,init:RequestInit)=>{ bodies.push(JSON.parse(String(init.body))); return bodies.length===1 ? count(12) : completed(); }));
    await createProvider({OPENAI_API_KEY:'key',NPC_MODEL_INPUT_CAPACITY:'90000'}).generate('speak',{text:'é 👩‍🌾'},signal,prompt);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(buildDialogueInputTokenBody(bodies[1] as Record<string, unknown>));
    expect(bodies[1]).toEqual(buildDialogueResponseBody('speak',{text:'é 👩‍🌾'},prompt,'gpt-5.6-terra'));
  });

  it.each([[79_999,true],[80_000,true],[80_001,false]])('enforces exact input-token boundary %i',async(tokens,allowed)=>{
    let calls=0; const fetch=vi.fn(async (_url:string)=>++calls===1 ? count(tokens) : completed()); vi.stubGlobal('fetch',fetch);
    const action=createProvider({OPENAI_API_KEY:'key',NPC_MODEL_INPUT_CAPACITY:'90000'}).generate('speak',{},signal,prompt);
    if(allowed) await expect(action).resolves.toMatchObject({preflight:{inputTokens:tokens}}); else await expect(action).rejects.toThrow('input-token ceiling');
    expect(fetch).toHaveBeenCalledTimes(allowed ? 2 : 1);
  });

  it('reserves output and repair capacity without weakening the 80k input ceiling',async()=>{
    const fetch=vi.fn(async ()=>count(80_000)); vi.stubGlobal('fetch',fetch);
    await expect(createProvider({OPENAI_API_KEY:'key',NPC_MODEL_INPUT_CAPACITY:'84999'}).generate('speak',{},signal,prompt)).rejects.toThrow('input-token ceiling');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not generate when counting fails or capacity is invalid',async()=>{
    const fetch=vi.fn(async ()=>new Response('no',{status:400})); vi.stubGlobal('fetch',fetch);
    await expect(createProvider({OPENAI_API_KEY:'key',NPC_MODEL_INPUT_CAPACITY:'90000'}).generate('speak',{},signal,prompt)).rejects.toThrow('does not support');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch',vi.fn());
    await expect(createProvider({OPENAI_API_KEY:'key',NPC_MODEL_INPUT_CAPACITY:'unknown'}).generate('speak',{},signal,prompt)).rejects.toThrow('no verified');
  });

  it('measures UTF-8 request bytes, including multilingual joined Unicode',()=>{
    const body=buildDialogueResponseBody('speak',{text:'中文 العربية देवनागरी e\u0301 👩🏽‍🚀'},prompt,'fixture');
    expect(dialogueRequestBytes(body)).toBe(new TextEncoder().encode(JSON.stringify(body)).byteLength);
    expect(dialogueRequestBytes(body)).toBeGreaterThan(JSON.stringify(body).length);
  });

  it.each([[DIALOGUE_REQUEST_BYTE_LIMIT-1,true],[DIALOGUE_REQUEST_BYTE_LIMIT,true],[DIALOGUE_REQUEST_BYTE_LIMIT+1,false]])('enforces transport-byte boundary %i',async(target,allowed)=>{
    const base=buildDialogueResponseBody('speak',{fill:''},prompt,'gpt-5.6-terra');
    const delta=target-dialogueRequestBytes(base);
    const body=buildDialogueResponseBody('speak',{fill:'a'.repeat(delta)},prompt,'gpt-5.6-terra');
    expect(dialogueRequestBytes(body)).toBe(target);
    let calls=0; const fetch=vi.fn(async()=>++calls===1 ? count(1) : completed()); vi.stubGlobal('fetch',fetch);
    const action=createProvider({OPENAI_API_KEY:'key',NPC_MODEL_INPUT_CAPACITY:'90000'}).generate('speak',{fill:'a'.repeat(delta)},signal,prompt);
    if (allowed) await expect(action).resolves.toBeDefined(); else await expect(action).rejects.toThrow('transport-byte');
    expect(fetch).toHaveBeenCalledTimes(allowed ? 2 : 0);
  });
});
