import { describe, expect, it } from 'vitest';
import { PROMPT_KEYS, PROMPT_MANIFEST, PROMPT_WORKFLOW_EDGES } from '../../src/lib/server/prompt-registry/index.js';
import { promptWorkflowProjection, safePromptExecutionRuns } from '../../src/lib/server/prompt-registry/admin-projection.js';

describe('prompt registry admin projection', () => {
  it('derives every visible prompt node and its transitions from the registry manifest', () => {
    const workflows = promptWorkflowProjection();
    const nodes = workflows.flatMap((workflow) => workflow.nodes);
    expect(nodes.map((node) => node.key).sort()).toEqual([...PROMPT_KEYS].sort());
    expect(nodes.every((node) => node.contractHash === PROMPT_MANIFEST[node.key].contract.hash)).toBe(true);
    const visibleEdges = workflows.flatMap((workflow) => workflow.edges);
    expect(visibleEdges).toEqual(expect.arrayContaining(PROMPT_WORKFLOW_EDGES.filter((edge) => edge.from === 'dialogue.speak' && edge.to === 'dialogue.review')));
  });

  it('projects execution ledger records through an allow-list only', () => {
    const runs = safePromptExecutionRuns([{
      executionId: 'turn:123', attempt: 2, workflow: 'dialogue', node: 'dialogue.speak', promptKey: 'dialogue.speak', releaseId: 'release-12', revisionId: 'revision-7',
      status: 'completed', model: 'fixture', durationMs: 88, inputTokens: 10, outputTokens: 20, errorCode: null, occurredAt: '2026-09-16T00:00:00.000Z',
      renderedPrompt: 'must never reach the browser', privateNpcContext: { name: 'secret' }, providerError: 'sensitive provider detail', storageKey: 'private/key'
    }]);
    expect(runs).toEqual([expect.objectContaining({ executionId: 'turn:123', promptKey: 'dialogue.speak', durationMs: 88 })]);
    expect(Object.keys(runs[0]!).sort()).toEqual(['attempt', 'durationMs', 'errorCode', 'executionId', 'inputTokens', 'model', 'node', 'occurredAt', 'outputTokens', 'promptKey', 'releaseId', 'revisionId', 'status', 'workflow']);
    expect(JSON.stringify(runs)).not.toContain('privateNpcContext');
    expect(JSON.stringify(runs)).not.toContain('renderedPrompt');
  });

  it('rejects malformed ledger records rather than guessing a safe shape', () => {
    expect(safePromptExecutionRuns([{ executionId: 'missing-fields' }, 'not-a-record'])).toEqual([]);
  });
});
