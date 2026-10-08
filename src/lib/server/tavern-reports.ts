import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

export interface TavernReport { id:string; text:string; day:number; instanceId:string|null; unread:boolean; notified:boolean }
export async function getTavernReports(client:SupabaseClient<Database>):Promise<TavernReport[]> {
 const {data,error}=await (client.rpc as any)('codex_tavern_reports');
 if(error)throw error;
 return Array.isArray(data)?data:[];
}
