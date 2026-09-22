import { PROMPT_MANIFEST, PROMPT_WORKFLOW_EDGES } from './manifest';
import { PROMPT_KEYS, type PromptKey, type PromptWorkflow } from './contracts';

const workflows = ['dialogue', 'authoring', 'resident_settlement', 'canon_settlement', 'social_settlement', 'procedural_settlement', 'quest_transition', 'portrait_generation', 'runtime_art'] as const;
export const PROMPT_WORKFLOWS = workflows;

export type SafePromptExecutionRun = Readonly<{
  executionId: string;
  attempt: number;
  workflow: string;
  node: string;
  promptKey: string;
  releaseId: string;
  revisionId: string;
  status: string;
  model: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  occurredAt: string;
}>;

const isPromptKey = (value: string): value is PromptKey => (PROMPT_KEYS as readonly string[]).includes(value);
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null; }
function count(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

/** The browser receives this fixed operational projection only.  It is
 * deliberately incapable of carrying prompt text, input data, model output,
 * provider diagnostics, credentials, or storage references. */
export function safePromptExecutionRuns(value: unknown): SafePromptExecutionRun[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const executionId = text(row.executionId);
    const workflow = text(row.workflow);
    const node = text(row.node);
    const promptKey = text(row.promptKey);
    const releaseId = text(row.releaseId);
    const revisionId = text(row.revisionId);
    const status = text(row.status);
    const occurredAt = text(row.occurredAt);
    const attempt = count(row.attempt);
    if (!executionId || !workflow || !node || !promptKey || !releaseId || !revisionId || !status || !occurredAt || attempt === null) return [];
    return [{ executionId, attempt, workflow, node, promptKey, releaseId, revisionId, status, occurredAt, model: text(row.model), durationMs: count(row.durationMs), inputTokens: count(row.inputTokens), outputTokens: count(row.outputTokens), errorCode: text(row.errorCode) }];
  });
}

/** UI workflow data is projected solely from the same manifest and edge list
 * used by the server registry. */
export function promptWorkflowProjection() {
  const nodeWorkflow = (node: string): PromptWorkflow | null => {
    if (isPromptKey(node)) return PROMPT_MANIFEST[node].contract.workflow;
    if (node.startsWith('dialogue.')) return 'dialogue';
    if (node.startsWith('authoring.')) return 'authoring';
    if (node.startsWith('portrait.')) return 'portrait_generation';
    if (node.startsWith('runtime_art.')) return 'runtime_art';
    if (node.startsWith('settlement.')) return 'resident_settlement';
    return null;
  };
  return workflows.map((workflow) => ({
    workflow,
    label: workflow.replaceAll('_', ' '),
    nodes: Object.values(PROMPT_MANIFEST).filter((prompt) => prompt.contract.workflow === workflow).map((prompt) => ({
      key: prompt.key, name: prompt.name, purpose: prompt.purpose, type: prompt.callType, modelLane: prompt.contract.modelLane,
      contractId: prompt.contract.id, contractHash: prompt.contract.hash, dynamicData: prompt.contract.dynamicData, templateVariables: [...prompt.templateVariables]
    })),
    edges: PROMPT_WORKFLOW_EDGES.filter((edge) => nodeWorkflow(edge.from) === workflow || nodeWorkflow(edge.to) === workflow)
      .filter((edge) => workflow !== 'resident_settlement' || !['canon_settlement', 'social_settlement', 'procedural_settlement'].includes(nodeWorkflow(edge.to) ?? ''))
  }));
}
