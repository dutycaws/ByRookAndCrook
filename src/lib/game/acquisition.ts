import { qualityLabel, type ApiaryCommandReceipt, type CompleteBakeReceipt, type CompleteBrewReceipt, type HarvestReceipt } from './contracts';

export type AcquisitionEventKind = 'brew' | 'bake' | 'purchase' | 'harvest' | 'honey';
export type AcquisitionArtKind = 'bottle' | 'loaf' | 'item';
export type AcquisitionDetail = { label: string; value: string };
export type AcquisitionCard = {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  quantityLabel?: string;
  imageSrc?: string | null;
  imageAlt?: string;
  icon?: string;
  artKind: AcquisitionArtKind;
  details?: AcquisitionDetail[];
};

export function brewAcquisitionCard(id: string, receipt: Pick<CompleteBrewReceipt, 'beverageName' | 'dayNumber' | 'qualityIndex'>): AcquisitionCard {
  return {
    id,
    eyebrow: 'Fresh from the brewery',
    title: receipt.beverageName,
    description: `Bottled on tavern day ${receipt.dayNumber}.`,
    quantityLabel: '1 bottle',
    icon: '🍺',
    artKind: 'bottle',
    details: [{ label: 'Quality', value: qualityLabel(receipt.qualityIndex) }]
  };
}

export function bakeAcquisitionCard(id: string, receipt: Pick<CompleteBakeReceipt, 'foodName' | 'dayNumber' | 'qualityIndex' | 'timingBand'>): AcquisitionCard {
  return {
    id,
    eyebrow: 'Fresh from the bakery',
    title: receipt.foodName,
    description: `Baked on tavern day ${receipt.dayNumber}.`,
    quantityLabel: '1 loaf',
    imageSrc: receipt.qualityIndex <= 3 ? '/assets/scenes/bakery/bakery-loaf-overbaked.webp' : '/assets/scenes/bakery/bakery-loaf-ideal.webp',
    icon: '🥖',
    artKind: 'loaf',
    details: [
      { label: 'Quality', value: qualityLabel(receipt.qualityIndex) },
      { label: 'Oven', value: receipt.timingBand }
    ]
  };
}

export function harvestAcquisitionCard(
  id: string,
  receipt: Pick<HarvestReceipt, 'quantity' | 'qualityIndex'>,
  plant: { name: string; icon?: string | null }
): AcquisitionCard {
  return {
    id,
    eyebrow: 'Fresh from the garden',
    title: plant.name,
    description: 'Added to your tavern pantry.',
    quantityLabel: `${receipt.quantity} ingredient${receipt.quantity === 1 ? '' : 's'}`,
    icon: plant.icon ?? '🌿',
    artKind: 'item',
    details: [{ label: 'Quality', value: qualityLabel(receipt.qualityIndex) }]
  };
}

export function honeyAcquisitionCard(id: string, receipt: ApiaryCommandReceipt): AcquisitionCard | null {
  const { quantity, qualityIndex } = receipt.result;
  if (receipt.commandKind !== 'extract_honey' || typeof quantity !== 'number' || quantity < 1 ||
    !Number.isSafeInteger(quantity) || typeof qualityIndex !== 'number' ||
    !Number.isInteger(qualityIndex) || qualityIndex < 0 || qualityIndex > 6) return null;
  return {
    id,
    eyebrow: 'Fresh from the apiary',
    title: 'Honey',
    description: 'Gathered from the colony’s safe surplus and added to your pantry.',
    quantityLabel: `${quantity} ingredient${quantity === 1 ? '' : 's'}`,
    icon: '🍯',
    artKind: 'item',
    details: [{ label: 'Quality', value: qualityLabel(qualityIndex) }]
  };
}

/** Claims an item receipt only when it belongs to the exact submitted completion command. */
export function claimAcquisitionReceipt(
  kind: AcquisitionEventKind,
  commandKind: string,
  commandActionId: string,
  receiptActionId: string | null | undefined,
  seenEvents: Set<string>
): string | null {
  const expectedCommand = {
    purchase: ['purchase', 'expand'], brew: ['complete'], bake: ['complete'],
    harvest: ['harvest_crop'], honey: ['extract_honey']
  }[kind];
  return claimAcquisitionEvent(
    kind,
    commandActionId,
    expectedCommand.includes(commandKind) && receiptActionId === commandActionId,
    seenEvents
  );
}

/** Claims an authoritative acquisition event for this mounted workflow. */
export function claimAcquisitionEvent(
  kind: AcquisitionEventKind,
  actionId: string | null | undefined,
  succeeded: boolean,
  seenEvents: Set<string>
): string | null {
  if (!succeeded || !actionId?.trim()) return null;

  const key = `${kind}:${actionId}`;
  if (seenEvents.has(key)) return null;
  seenEvents.add(key);
  return key;
}
