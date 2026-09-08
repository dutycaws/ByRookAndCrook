import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { databaseError } from '$lib/server/dialogue/orchestrator';
const handle:RequestHandler=async({locals,params,request,url})=>{
  if(!await locals.getVerifiedUser()) return json({message:'Please sign in.'},{status:401});
  if(request.method==='DELETE'&&request.headers.get('origin')!==url.origin) return json({message:'Invalid origin.'},{status:403});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.turnId)) return json({message:'Invalid turn.'},{status:400});
  const r=await locals.supabase.rpc('dialogue_status',{p_turn:params.turnId,p_cancel:request.method==='DELETE'});
  if(r.error) {const e=databaseError(r.error);return json({message:e.message},{status:e.status});}
  return json(r.data,{headers:{'cache-control':'private, no-store'}});
};
export const GET=handle;
export const DELETE=handle;
