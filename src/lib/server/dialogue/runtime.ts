import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import { getSupabaseConfig } from '../config';
import { createProvider, ProviderUnavailable } from './provider';
import { localAiObservabilitySink } from '$lib/server/observability/ai-events';
import { promptRegistryService } from '$lib/server/prompt-registry/service';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { createNpcMemoryEmbeddingProvider } from '$lib/server/npc-memory/provider';
export function dialogueRuntime() {
  const config=privateRuntimeEnvironment(env); if(!config.SUPABASE_SERVICE_ROLE_KEY) throw new ProviderUnavailable('The dialogue server credential is not configured.');
  const client=createClient<Database>(getSupabaseConfig().url,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const embeddingProvider=config.OPENAI_API_KEY&&config.NPC_EMBEDDING_MODEL&&config.NPC_EMBEDDING_DIMENSIONS ? createNpcMemoryEmbeddingProvider(config) : undefined;
  return {client, provider:createProvider(config),options:{maxCalls:Number(config.NPC_MAX_CALLS)||8,rounds:Number(config.NPC_INVESTIGATION_ROUNDS)||2,deadlineMs:Number(config.NPC_DEADLINE_MS)||90000,observability:localAiObservabilitySink,promptRegistry:promptRegistryService(client),embeddingProvider}};
}
export function dialogueAvailability() {
  const config=privateRuntimeEnvironment(env);
  if(config.NPC_PROVIDER==='local') return 'Local model support is not implemented yet.';
  if(!config.OPENAI_API_KEY||!config.SUPABASE_SERVICE_ROLE_KEY) return 'NPC conversations are waiting for server configuration.';
  return null;
}
