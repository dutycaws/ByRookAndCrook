import type { FinishedServiceItem } from './serving';

export interface ServiceCardStack extends Omit<FinishedServiceItem, 'id'> {
  key: string;
  quantity: number;
  itemIds: string[];
}

/** Stock cards never create an owned card or include batch/source quality in identity. */
export function serviceCardStacks(items: readonly FinishedServiceItem[]): ServiceCardStack[] {
  const stacks = new Map<string, ServiceCardStack>();
  for (const item of items) {
    const key = JSON.stringify([item.kind, item.productKey, item.ingredientType, item.qualityIndex]);
    const existing = stacks.get(key);
    if (existing) {
      if (!existing.itemIds.includes(item.id)) { existing.itemIds.push(item.id); existing.quantity += 1; }
    } else {
      stacks.set(key, { kind:item.kind,productKey:item.productKey,ingredientType:item.ingredientType,
        ingredientName:item.ingredientName,name:item.name,qualityIndex:item.qualityIndex,
        key, quantity: 1, itemIds: [item.id] });
    }
  }
  return [...stacks.values()];
}
