import type { ContractIssue } from './contracts';

/** Closed proposal contract for resolving one frozen terminal quest event. */
export const QUEST_TRANSITION_VERSION = 'quest-transition-v1' as const;

export type QuestPlanStep = { action: string; approach: string };
/** Canonical DB plan shape: one to three ordered action/approach steps. */
export type QuestPlan = QuestPlanStep[];
export type NextAuthoredTransition = { version: typeof QUEST_TRANSITION_VERSION; kind: 'next_authored_milestone'; terminalEventId: string; milestoneId: string; plan: QuestPlan };
export type GeneratedSuccessorTransition = { version: typeof QUEST_TRANSITION_VERSION; kind: 'successor'; terminalEventId: string; title: string; objective: string; motivation: string; constraints: string[]; targetRefs: string[]; difficulty: number; plan: QuestPlan };
export type DepartureTransition = { version: typeof QUEST_TRANSITION_VERSION; kind: 'departure'; terminalEventId: string; privateRationale: string; farewellText: string; publicNews: string };
export type QuestTransitionProposal = NextAuthoredTransition | GeneratedSuccessorTransition | DepartureTransition;

export type QuestTransitionCapabilities = { actions: readonly string[]; approaches: readonly string[]; allowGeneratedSuccessor: boolean; allowDeparture: boolean };
export type FrozenAuthoredMilestone = { id: string };
export type QuestTransitionValidationContext = {
  terminalEventId: string;
  residentId: string;
  frozenTargetRefs: readonly string[];
  capabilities: QuestTransitionCapabilities;
  nextAuthoredMilestone?: FrozenAuthoredMilestone;
  otherResidentIds?: readonly string[];
};

export const QUEST_TRANSITION_CRITIC_CODES = ['proposal_shape', 'terminal_event', 'authored_milestone', 'plan_shape', 'target_frozen', 'capability', 'successor_bounds', 'departure_safety'] as const;
export const QUEST_TRANSITION_CRITIC_PATHS = ['proposal', 'terminalEventId', 'nextAuthoredMilestone', 'plan', 'targetRefs', 'successor', 'departure'] as const;
export type QuestTransitionCriticCode = (typeof QUEST_TRANSITION_CRITIC_CODES)[number];
export type QuestTransitionCriticPath = (typeof QUEST_TRANSITION_CRITIC_PATHS)[number];
export type QuestTransitionCriticInstruction = { code: QuestTransitionCriticCode; path: QuestTransitionCriticPath };
export type QuestTransitionCriticDecision = { decision: 'accept' | 'reject'; instructions: [] } | { decision: 'repair'; instructions: QuestTransitionCriticInstruction[] };
export type QuestTransitionParseResult = { ok: true; value: QuestTransitionProposal } | { ok: false; issues: ContractIssue[] };

const deathLanguage = /\b(?:death|dead|die|died|dying|kill|killed|murder|murdered|suicide|corpse|funeral)\b/i;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every((key) => key in value) && Object.keys(value).every((key) => keys.includes(key)); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function issue(path: string, code: string, message: string): ContractIssue[] { return [{ path, code, message }]; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function validPlan(value: unknown, context: QuestTransitionValidationContext): value is QuestPlan {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return false;
  return value.every((step, index) => object(step) && exact(step, ['action', 'approach'])
    && text(step.action, 40) && context.capabilities.actions.includes(step.action.trim())
    && text(step.approach, 40) && context.capabilities.approaches.includes(step.approach.trim())
    && (index === value.length - 1 ? ['attempt', 'abandon'].includes(step.action.trim()) : !['attempt', 'abandon'].includes(step.action.trim())));
}
function normalizePlan(plan: QuestPlan): QuestPlan { return plan.map((step) => ({ action: step.action.trim(), approach: step.approach.trim() })); }
function departureText(value: DepartureTransition): string { return `${value.privateRationale}\n${value.farewellText}\n${value.publicNews}`; }

export function parseQuestTransitionCriticDecision(value: unknown): QuestTransitionCriticDecision | null {
  if (!object(value) || !exact(value, ['decision', 'instructions']) || !['accept', 'repair', 'reject'].includes(String(value.decision)) || !Array.isArray(value.instructions)) return null;
  if ((value.decision === 'accept' || value.decision === 'reject') && value.instructions.length !== 0) return null;
  if (value.decision === 'repair' && (value.instructions.length < 1 || value.instructions.length > 4)) return null;
  const instructions: QuestTransitionCriticInstruction[] = [];
  for (const instruction of value.instructions) {
    if (!object(instruction) || !exact(instruction, ['code', 'path']) || !QUEST_TRANSITION_CRITIC_CODES.includes(instruction.code as QuestTransitionCriticCode) || !QUEST_TRANSITION_CRITIC_PATHS.includes(instruction.path as QuestTransitionCriticPath)) return null;
    instructions.push({ code: instruction.code as QuestTransitionCriticCode, path: instruction.path as QuestTransitionCriticPath });
  }
  if (new Set(instructions.map((instruction) => `${instruction.code}:${instruction.path}`)).size !== instructions.length) return null;
  return value.decision === 'repair' ? { decision: 'repair', instructions } : { decision: value.decision as 'accept' | 'reject', instructions: [] };
}

/** Validates a bounded proposal against the immutable terminal-event snapshot. */
export function validateQuestTransitionProposal(value: unknown, context: QuestTransitionValidationContext): ContractIssue[] {
  if (!object(value) || !text(context.terminalEventId, 120) || !text(context.residentId, 120)) return issue('context', 'proposal_shape', 'The frozen transition context is invalid.');
  if (value.version !== QUEST_TRANSITION_VERSION || !text(value.kind, 40) || !text(value.terminalEventId, 120)) return issue('proposal', 'proposal_shape', 'A transition must use the closed versioned envelope.');
  if (value.terminalEventId !== context.terminalEventId) return issue('terminalEventId', 'terminal_event', 'The transition must apply to the exact frozen terminal event.');
  if (context.nextAuthoredMilestone) {
    if (!exact(value, ['version', 'kind', 'terminalEventId', 'milestoneId', 'plan']) || value.kind !== 'next_authored_milestone' || !text(value.milestoneId, 120) || value.milestoneId !== context.nextAuthoredMilestone.id || !validPlan(value.plan, context)) return issue('nextAuthoredMilestone', 'authored_milestone', 'A frozen authored milestone is the only permitted next transition and cannot be rewritten.');
    return [];
  }
  if (value.kind === 'next_authored_milestone') return issue('proposal', 'authored_milestone', 'No frozen authored milestone is available for this terminal event.');
  if (value.kind === 'successor') {
    const difficulty = value.difficulty;
    if (!exact(value, ['version', 'kind', 'terminalEventId', 'title', 'objective', 'motivation', 'constraints', 'targetRefs', 'difficulty', 'plan'])
      || !context.capabilities.allowGeneratedSuccessor || !text(value.title, 120) || !text(value.objective, 500) || !text(value.motivation, 500)
      || !Array.isArray(value.constraints) || value.constraints.length > 6 || !value.constraints.every((constraint) => text(constraint, 180))
      || !Array.isArray(value.targetRefs) || value.targetRefs.length < 1 || value.targetRefs.length > 3 || !value.targetRefs.every((target) => text(target, 120) && context.frozenTargetRefs.includes(target)) || new Set(value.targetRefs).size !== value.targetRefs.length
      || typeof difficulty !== 'number' || !Number.isSafeInteger(difficulty) || difficulty < 0 || difficulty > 4 || !validPlan(value.plan, context)) return issue('successor', 'successor_bounds', 'A generated successor must use bounded text, frozen targets, difficulty, and a valid terminal plan.');
    return [];
  }
  if (value.kind === 'departure') {
    if (!exact(value, ['version', 'kind', 'terminalEventId', 'privateRationale', 'farewellText', 'publicNews']) || !context.capabilities.allowDeparture || !text(value.privateRationale, 500) || !text(value.farewellText, 500) || !text(value.publicNews, 500)) return issue('departure', 'departure_safety', 'A departure requires only bounded departure fields.');
    const prose = departureText(value as DepartureTransition);
    if (deathLanguage.test(prose) || (context.otherResidentIds ?? []).some((id) => id !== context.residentId && prose.includes(id))) return issue('departure', 'departure_safety', 'A departure cannot encode death or another resident.');
    return [];
  }
  return issue('proposal', 'proposal_shape', 'Transition kind is not recognized.');
}

export function parseQuestTransitionProposal(value: unknown, context: QuestTransitionValidationContext): QuestTransitionParseResult {
  const issues = validateQuestTransitionProposal(value, context);
  if (issues.length) return { ok: false, issues };
  const proposal = value as Record<string, unknown>;
  const base = { version: QUEST_TRANSITION_VERSION, terminalEventId: proposal.terminalEventId as string };
  if (proposal.kind === 'next_authored_milestone') return { ok: true, value: { ...base, kind: 'next_authored_milestone', milestoneId: proposal.milestoneId as string, plan: normalizePlan(proposal.plan as QuestPlan) } };
  if (proposal.kind === 'successor') return { ok: true, value: { ...base, kind: 'successor', title: (proposal.title as string).trim(), objective: (proposal.objective as string).trim(), motivation: (proposal.motivation as string).trim(), constraints: (proposal.constraints as string[]).map((item) => item.trim()), targetRefs: [...proposal.targetRefs as string[]], difficulty: proposal.difficulty as number, plan: normalizePlan(proposal.plan as QuestPlan) } };
  return { ok: true, value: { ...base, kind: 'departure', privateRationale: (proposal.privateRationale as string).trim(), farewellText: (proposal.farewellText as string).trim(), publicNews: (proposal.publicNews as string).trim() } };
}

/** Stable JSON input for a SHA-256 proposal fingerprint at the worker boundary. */
export function canonicalizeQuestTransitionProposal(value: unknown, context: QuestTransitionValidationContext): string | null {
  const parsed = parseQuestTransitionProposal(value, context);
  return parsed.ok ? canonical(parsed.value) : null;
}
