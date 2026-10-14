import type { QualityIndex } from './contracts';

export type SocialCardFlavor = 'charm' | 'insight' | 'rumor';
export type DailyDeckPhase = 'preparation' | 'service' | 'closed';
export type DailyCardPile = 'draw' | 'hand' | 'discard' | 'consumed';

/** One physical copy. sourceId binds social inventory or a specific crafted item. */
export interface DailyDeckCard {
	id: string;
	kind: 'social' | 'food' | 'beverage';
	sourceId: string;
	cardKey?: SocialCardFlavor;
	displayName: string;
	qualityIndex?: QualityIndex;
	pile: DailyCardPile;
}

export interface DailyDeckState {
	dayNumber: number;
	phase: DailyDeckPhase;
	generationId: string | null;
	drawPileIds: string[];
	handIds: string[];
	discardIds: string[];
	cards: DailyDeckCard[];
	pending: { additions: number; removals: string[] };
	provisions?: { potionOfForgetfulness: number };
	maxHandSize: number;
}

export interface ForgetfulnessCommand {
	expectedRevision: number;
	cardId: string;
	actionId: string;
}

export interface ForgetfulnessReceipt {
	actionId: string;
	cardId: string;
	effectiveDay: number;
	committedRevision: number;
	dailyDeck: DailyDeckState;
}

export interface PurchaseForgetfulnessCommand {
	expectedRevision: number;
	actionId: string;
}

export interface PurchaseForgetfulnessReceipt {
	actionId: string;
	provisionKey: 'potion_of_forgetfulness';
	quantity: number;
	price: number;
	committedRevision: number;
	gold: number;
}
