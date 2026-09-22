import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

export interface GeneratedSupplyCatalogItem {
  entityId: string;
  itemKey: string;
  name: string;
  price: number;
  dailyStock: number;
  remainingStock: number;
}
export interface GeneratedSupplyInventoryItem {
  entityId: string;
  itemKey: string;
  name: string;
  quantity: number;
}
export interface GeneratedSupplies {
  version: 'generated-shop-v1';
  catalog: GeneratedSupplyCatalogItem[];
  inventory: GeneratedSupplyInventoryItem[];
}

function uuid(value: unknown): value is string {
  return typeof value === 'string'
    && value.length === 36
    && /^[0-9a-f-]+$/i.test(value)
    && value[8] === '-' && value[13] === '-' && value[18] === '-' && value[23] === '-'
    && /^[1-8]$/i.test(value[14] ?? '') && /^[89ab]$/i.test(value[19] ?? '');
}
const KEY = /^[a-z][a-z0-9-]{1,79}$/;
type RecordValue = Record<string, unknown>;
function object(value: unknown): value is RecordValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: RecordValue, keys: readonly string[]) { const found = Object.keys(value); return found.length === keys.length && found.every((key) => keys.includes(key)); }
function text(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum; }
function boundedInteger(value: unknown, minimum: number, maximum: number): value is number { return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum; }

/** Reject the complete server response when an unreviewed field reaches the shop boundary. */
export function parseGeneratedSupplies(value: unknown): GeneratedSupplies {
  if (!object(value) || !exact(value, ['version','catalog','inventory']) || value.version !== 'generated-shop-v1' || !Array.isArray(value.catalog) || !Array.isArray(value.inventory) || value.catalog.length > 40 || value.inventory.length > 40) throw new Error('Invalid generated shop projection');
  const catalog = value.catalog.map((item) => {
    if (!object(item)) throw new Error('Invalid generated supply catalog item');
    const valid = exact(item, ['entityId','itemKey','name','price','dailyStock','remainingStock']) && uuid(item.entityId) && KEY.test(String(item.itemKey)) && text(item.name, 120) && boundedInteger(item.price, 1, 100) && boundedInteger(item.dailyStock, 1, 10) && boundedInteger(item.remainingStock, 0, 10) && (item.remainingStock as number) <= (item.dailyStock as number);
    if (!valid) throw new Error('Invalid generated supply catalog item');
    return { entityId:item.entityId as string, itemKey:item.itemKey as string, name:(item.name as string).trim(), price:item.price as number, dailyStock:item.dailyStock as number, remainingStock:item.remainingStock as number };
  });
  const inventory = value.inventory.map((item) => {
    if (!object(item) || !exact(item, ['entityId','itemKey','name','quantity']) || !uuid(item.entityId) || !KEY.test(String(item.itemKey)) || !text(item.name, 120) || !boundedInteger(item.quantity, 1, 999)) throw new Error('Invalid generated supply inventory item');
    return { entityId:item.entityId as string, itemKey:item.itemKey as string, name:(item.name as string).trim(), quantity:item.quantity as number };
  });
  if (new Set(catalog.map((item) => item.entityId)).size !== catalog.length || new Set(inventory.map((item) => item.entityId)).size !== inventory.length) throw new Error('Duplicate generated supply projection item');
  return { version:'generated-shop-v1', catalog, inventory };
}

type RawRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
function rawRpc(client: SupabaseClient<Database>) { return client.rpc.bind(client) as unknown as RawRpc; }

export async function getGeneratedSupplies(client: SupabaseClient<Database>, saveId: string): Promise<GeneratedSupplies> {
  const { data, error } = await rawRpc(client)('world_generated_shop_projection', { p_save_id:saveId });
  if (error) throw new Error(error.code === 'PT404' ? 'Generated shop content is unavailable.' : 'Generated shop content could not be loaded.');
  return parseGeneratedSupplies(data);
}

export async function purchaseGeneratedSupply(client: SupabaseClient<Database>, input: { saveId:string; actionId:string; expectedRevision:number; itemKey:string; quantity:number }) {
  const { data, error } = await rawRpc(client)('purchase_generated_supply', { p_save_id:input.saveId, p_action_id:input.actionId, p_expected_revision:input.expectedRevision, p_item_key:input.itemKey, p_quantity:input.quantity });
  if (error) throw new Error(error.code === 'PT422' || error.code === 'PT409' ? error.message : 'The generated supply purchase could not be completed.');
  return data;
}
