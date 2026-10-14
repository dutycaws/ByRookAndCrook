export type TavernCardKind = 'charm' | 'insight' | 'rumor' | 'food' | 'beverage';

export interface TavernCardChoice {
	key: string;
	kind: TavernCardKind;
	itemIds: string[];
	title: string;
	eyebrow: string;
	detail: string;
	quantity: number;
	/** The server-authoritative physical copy in today's daily deck. */
	dailyCardId?: string;
}
