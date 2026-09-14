import { dev } from '$app/environment';
import { error, fail, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { getSnapshot } from '$lib/server/game';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { parseDeveloperInspector } from '$lib/game/evolving-world/developer-inspector';
import type { Database } from '$lib/database.types';
import type { Actions, PageServerLoad } from './$types';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(v:FormDataEntryValue|null,min:number,max:number)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():null;
export function assertLocalInspector(enabled=dev): void { if(!enabled) error(404,'This development tool is unavailable.'); }
function service() { const runtime=privateRuntimeEnvironment(env); if(!runtime.SUPABASE_SERVICE_ROLE_KEY) error(503,'The local service credential is unavailable.'); return createClient<Database>(getSupabaseConfig().url,runtime.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}); }
async function saveForOwner(locals:App.Locals) { const user=await locals.getVerifiedUser(); if(!user) redirect(303,'/login'); const snapshot=await getSnapshot(locals.supabase); if(!snapshot) error(404,'Open a tavern before using the world inspector.'); return { user,saveId:snapshot.save.id }; }

export const load:PageServerLoad=async({locals,setHeaders})=>{
  assertLocalInspector(); setHeaders({'cache-control':'no-store'});
  const {saveId}=await saveForOwner(locals);
  const result=await (service() as any).rpc('world_developer_inspector',{p_save_id:saveId});
  if(result.error) { console.error('world_developer_inspector_failed',{category:'rpc_rejected'}); error(500,'The local world inspector is unavailable.'); }
  return { inspector:parseDeveloperInspector(result.data) };
};

async function mutate(locals:App.Locals,request:Request,operation:'requeue_settlement_job'|'requeue_runtime_art_job'|'set_runtime_art_appearance') {
  assertLocalInspector(); const {user,saveId}=await saveForOwner(locals); const form=await request.formData(); const reason=text(form.get('reason'),3,240);
  if(!reason) return fail(400,{operation,message:'Give this local override a reason of 3–240 characters.'});
  const target=String(form.get(operation==='set_runtime_art_appearance'?'entityId':'jobId')??'');
  if(!uuid.test(target)) return fail(400,{operation,message:'Select a valid inspector target.'});
  const client=service() as any;
  let result;
  if(operation==='requeue_settlement_job') result=await client.rpc('world_developer_requeue_settlement_job',{p_save_id:saveId,p_job_id:target,p_actor_id:user.id,p_reason:reason});
  else if(operation==='requeue_runtime_art_job') result=await client.rpc('world_developer_requeue_runtime_art_job',{p_save_id:saveId,p_job_id:target,p_actor_id:user.id,p_reason:reason});
  else { const appearanceVersion=text(form.get('appearanceVersion'),1,128); const publicAppearance=text(form.get('publicAppearance'),1,1000); if(!appearanceVersion||!publicAppearance)return fail(400,{operation,message:'Provide a new bounded appearance version and public appearance.'}); result=await client.rpc('world_developer_set_runtime_art_appearance',{p_save_id:saveId,p_entity_id:target,p_actor_id:user.id,p_appearance_version:appearanceVersion,p_public_appearance:publicAppearance,p_reason:reason}); }
  if(result.error) { console.warn('world_developer_override_rejected',{operation,category:'rpc_rejected'}); return fail(409,{operation,message:'The local override could not be applied. Refresh the inspector and check the target state.'}); }
  return {success:true,operation,message:'Local override recorded.'};
}
export const actions:Actions={requeueSettlement:({locals,request})=>mutate(locals,request,'requeue_settlement_job'),requeueArt:({locals,request})=>mutate(locals,request,'requeue_runtime_art_job'),setArtAppearance:({locals,request})=>mutate(locals,request,'set_runtime_art_appearance')};
