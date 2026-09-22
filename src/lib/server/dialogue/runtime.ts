import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import { getSupabaseConfig } from '../config';
import { createProvider, ProviderUnavailable } from './provider';
import { localAiObservabilitySink } from '$lib/server/observability/ai-events';
import { promptRegistryService } from '$lib/server/prompt-registry/service';
export function dialogueRuntime() {
  if(!env.SUPABASE_SERVICE_ROLE_KEY) throw new ProviderUnavailable('The dialogue server credential is not configured.');
  const client=createClient<Database>(getSupabaseConfig().url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  return {client, provider:createProvider(env),options:{maxCalls:Number(env.NPC_MAX_CALLS)||8,rounds:Number(env.NPC_INVESTIGATION_ROUNDS)||2,deadlineMs:Number(env.NPC_DEADLINE_MS)||90000,observability:localAiObservabilitySink,promptRegistry:promptRegistryService(client)}};
}
export function dialogueAvailability() {
  if(env.NPC_PROVIDER==='local') return 'Local model support is not implemented yet.';
  if(!env.OPENAI_API_KEY||!env.SUPABASE_SERVICE_ROLE_KEY) return 'NPC conversations are waiting for server configuration.';
  return null;
}
