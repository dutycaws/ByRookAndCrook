import type { TavernCardKind } from '$lib/components/tavern/card-types';

export interface WorkflowChoice {
  id: string;
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: string;
  /** Optional illustration rendered in the shared card hand. */
  artwork?: { kind: TavernCardKind; seed: string };
  meta?: string;
  actionLabel?: string;
  disabled?: boolean;
  /** Opt in for local menu navigation. Real commands own their success animation. */
  burn?: boolean;
}
