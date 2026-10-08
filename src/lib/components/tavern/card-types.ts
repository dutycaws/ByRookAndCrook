export type TavernCardKind = 'charm' | 'insight' | 'flirt' | 'rumor' | 'food' | 'beverage';

export interface TavernCardChoice {
	key: string;
	kind: TavernCardKind;
	itemIds: string[];
	title: string;
	eyebrow: string;
	detail: string;
	quantity: number;
}
