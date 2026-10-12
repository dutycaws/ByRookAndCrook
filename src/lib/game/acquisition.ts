import { qualityLabel, type CompleteBakeReceipt, type CompleteBrewReceipt } from './contracts';

export type AcquisitionEventKind = 'brew' | 'bake' | 'purchase';
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

/** Claims an item receipt only when it belongs to the exact submitted completion command. */
export function claimAcquisitionReceipt(
  kind: Extract<AcquisitionEventKind, 'brew' | 'bake' | 'purchase'>,
  commandKind: string,
  commandActionId: string,
  receiptActionId: string | null | undefined,
  seenEvents: Set<string>
): string | null {
  const expectedCommand = kind === 'purchase' ? ['purchase', 'expand'] : ['complete'];
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
