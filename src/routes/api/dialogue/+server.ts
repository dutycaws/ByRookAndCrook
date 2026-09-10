import { json } from '@sveltejs/kit';
import { DialogueError, parseInput, runDialogue } from '$lib/server/dialogue/orchestrator';
import { dialogueRuntime } from '$lib/server/dialogue/runtime';
import type { RequestHandler } from './$types';
export const POST:RequestHandler=async({locals,request,url})=>{
  if(request.headers.get('origin')!==url.origin) return json({message:'Invalid request origin.'},{status:403});
  const user=await locals.getVerifiedUser();
  if(!user) return json({message:'Please sign in.'},{status:401});
  if(Number(request.headers.get('content-length')??0)>16000) return json({message:'Message too large.'},{status:413});
  try {
    const raw=await request.text(); if(raw.length>16000) return json({message:'Message too large.'},{status:413});
    let parsed; try {parsed=JSON.parse(raw);} catch {throw new DialogueError('Invalid message.',400);}
    const input=parseInput(parsed); const {client,provider,options}=dialogueRuntime();
    return json(await runDialogue(client,user.id,input,provider,options),{headers:{'cache-control':'private, no-store'}});
  } catch(cause) {
    return json({message:cause instanceof DialogueError?cause.message:'NPC dialogue is unavailable. Check the server configuration.',code:cause instanceof DialogueError?cause.code:'UNAVAILABLE'},
      {status:cause instanceof DialogueError?cause.status:503});
  }
};
