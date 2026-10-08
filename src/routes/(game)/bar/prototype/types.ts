import type { OwnedTrinket, TrinketSlot } from '$lib/game/trinkets';
import type { Patron } from '$lib/game/serving';

export type BarPrototypeVariant = 'A' | 'B' | 'C' | 'D';
export type PrototypeMode = 'overview' | 'talk' | 'cards' | 'journal';
export type MockCardKind = 'intent' | 'hospitality';

export interface MockCard {
  id: string;
  kind: MockCardKind;
  title: string;
  detail: string;
  color: string;
}

export interface MockEntry {
  id: number;
  kind: 'player' | 'patron' | 'service';
  text: string;
  label?: string;
}

export const PROTOTYPE_CARDS: readonly MockCard[] = [
  { id: 'intent-rumors', kind: 'intent', title: 'Trade rumors', detail: 'Invite a story from the road.', color: 'amber' },
  { id: 'intent-kindness', kind: 'intent', title: 'Share a kindness', detail: 'Ask what would help today.', color: 'sage' },
  { id: 'drink-cider', kind: 'hospitality', title: 'Spiced cider', detail: 'A warm cup from the house.', color: 'copper' },
  { id: 'food-roots', kind: 'hospitality', title: 'Roasted roots', detail: 'A plate made for a cold night.', color: 'plum' }
];

export type BarPrototypeModel = {
  patrons: Patron[];
  trinkets: OwnedTrinket[];
  day: number;
  gold: number;
  archiveHref: string;
  selected: Patron | null;
  focusedKey: string | null;
  mode: PrototypeMode;
  journalReturnMode: PrototypeMode;
  draft: string;
  selectedCardId: string | null;
  selectedCard: MockCard | null;
  cards: readonly MockCard[];
  history: MockEntry[];
  notice: string;
  onselect: (instanceId: string) => void;
  onfocus: (instanceId: string) => void;
  onback: () => void;
  ontalk: () => void;
  ondeck: () => void;
  onclose: () => void;
  onkeepsake: (slot: TrinketSlot) => void;
  onmode: (mode: PrototypeMode) => void;
  onjournal: () => void;
  onjournalclose: () => void;
  ondraft: (value: string) => void;
  oncard: (id: string) => void;
  onchatclose: () => void;
  onsend: () => void;
  onserve: () => void;
};
