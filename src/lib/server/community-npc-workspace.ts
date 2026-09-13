import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/database.types';

export type CommunityContext = { profile: Record<string, unknown>; capabilities: string[] };
export async function communityContext(client: SupabaseClient<Database>): Promise<CommunityContext> {
  const [profile, capabilities] = await Promise.all([client.rpc('npc_profile_me'), client.rpc('npc_my_capabilities')]);
  if (profile.error || capabilities.error) error(500, 'The community ledger is unavailable.');
  return { profile: (profile.data ?? {}) as Record<string, unknown>, capabilities: (capabilities.data ?? []) as string[] };
}
export function requireCapability(context: CommunityContext, capability: string): void {
  if (!context.capabilities.includes('admin') && !context.capabilities.includes(capability)) error(403, 'This workspace requires community access.');
}
export async function rpcJson(client: SupabaseClient<Database>, name: keyof Database['public']['Functions'], args?: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name as never, args as never);
  if (result.error) throw new Error(result.error.message);
  return result.data as Json;
}
