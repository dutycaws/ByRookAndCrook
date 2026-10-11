export interface WorkflowChoice {
  id: string;
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: string;
  meta?: string;
  actionLabel?: string;
  disabled?: boolean;
  /** Opt in for local menu navigation. Real commands own their success animation. */
  burn?: boolean;
}
