import { fail } from '@sveltejs/kit';
import { communityContext, requireCapability } from '$lib/server/community-npc-workspace';
import { PROMPT_KEYS, PROMPT_MANIFEST, validatePromptTemplate, type PromptKey, type PromptWorkflow } from '$lib/server/prompt-registry';
import { PROMPT_WORKFLOWS, promptWorkflowProjection, safePromptExecutionRuns } from '$lib/server/prompt-registry/admin-projection';
import type { Actions, PageServerLoad } from './$types';

const isPromptKey = (value: string): value is PromptKey => (PROMPT_KEYS as readonly string[]).includes(value);
const isWorkflow = (value: string): value is PromptWorkflow => (PROMPT_WORKFLOWS as readonly string[]).includes(value);
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function guard(locals: App.Locals) {
  requireCapability(await communityContext(locals.supabase), 'prompt_manager');
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const community = await communityContext(locals.supabase);
  requireCapability(community, 'prompt_manager');
  const requestedKey = url.searchParams.get('key') ?? '';
  const selectedKey = isPromptKey(requestedKey) ? requestedKey : PROMPT_KEYS[0];
  const requestedWorkflow = url.searchParams.get('workflow') ?? '';
  const selectedWorkflow = isWorkflow(requestedWorkflow) ? requestedWorkflow : PROMPT_MANIFEST[selectedKey].contract.workflow;
  const requestedRun = url.searchParams.get('run') ?? '';
  const [summary, detail, runs] = await Promise.all([
    locals.supabase.rpc('prompt_registry_summary' as never),
    locals.supabase.rpc('prompt_registry_detail' as never, { p_key: selectedKey } as never),
    locals.supabase.rpc('prompt_registry_recent_runs' as never, { p_workflow: selectedWorkflow, p_limit: 20 } as never)
  ]);
  // The route is privileged, but database diagnostics still do not belong in
  // an error page.  RPC functions are the detailed authorization boundary.
  for (const result of [summary, detail, runs]) if (result.error) throw new Error('The prompt registry is unavailable.');
  return {
    community,
    selectedKey,
    selectedWorkflow,
    selectedRun: requestedRun,
    summary: asRecord(summary.data),
    detail: asRecord(detail.data),
    runs: safePromptExecutionRuns(runs.data),
    workflows: promptWorkflowProjection()
  };
};

export const actions: Actions = {
  candidate: async ({ locals, request }) => {
    await guard(locals);
    const form = await request.formData();
    const key = String(form.get('key') ?? '');
    const body = String(form.get('body') ?? '');
    const changeNote = String(form.get('changeNote') ?? '').trim();
    const parentRevisionId = String(form.get('parentRevisionId') ?? '');
    if (!isPromptKey(key)) return fail(400, { message: 'Choose a registered prompt before creating a revision.' });
    if (!changeNote) return fail(400, { message: 'A change note is required for every immutable candidate.' });
    try { validatePromptTemplate(PROMPT_MANIFEST[key], body); } catch (error) { return fail(400, { message: error instanceof Error ? error.message : 'The prompt template is invalid.' }); }
    const entry = PROMPT_MANIFEST[key];
    const result = await locals.supabase.rpc('prompt_registry_create_candidate' as never, {
      p_key: key,
      p_body: body,
      p_contract_id: entry.contract.id,
      p_contract_hash: entry.contract.hash,
      p_parent_revision_id: parentRevisionId || null,
      p_change_note: changeNote
    } as never);
    // RPC messages are operational diagnostics; keep the browser response
    // stable and avoid accidentally projecting database/provider detail.
    if (result.error) return fail(result.error.message.includes('Candidate parent') ? 409 : 400, { message: result.error.message.includes('Candidate parent') ? 'The active revision changed. Review the current prompt before creating another candidate.' : 'Could not create this candidate revision. Review the required body, variables, and change note.', conflict: result.error.message.includes('Candidate parent') });
    return { message: `Candidate revision created for ${key}. Add it to the release tray.`, candidate: asRecord(result.data), key };
  },
  activate: async ({ locals, request }) => {
    await guard(locals);
    const form = await request.formData();
    const expectedReleaseId = String(form.get('expectedReleaseId') ?? '');
    const label = String(form.get('label') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();
    let candidates: Record<string, string> = {};
    let acknowledgements: string[] = [];
    try {
      candidates = asRecord(JSON.parse(String(form.get('candidates') ?? '{}'))) as Record<string, string>;
      acknowledgements = JSON.parse(String(form.get('acknowledgements') ?? '[]')) as string[];
    } catch { return fail(400, { message: 'The staged release was malformed. Review its candidates and try again.' }); }
    if (!Object.keys(candidates).length || Object.entries(candidates).some(([key, id]) => !isPromptKey(key) || typeof id !== 'string' || !id)) return fail(400, { message: 'A release must contain one or more registered candidate revisions.' });
    if (!acknowledgements.every((warning) => warning === 'safety_language_changed')) return fail(400, { message: 'The warning acknowledgement is not recognized.' });
    const result = await locals.supabase.rpc('prompt_registry_activate' as never, {
      p_expected_active_release: expectedReleaseId,
      p_label: label,
      p_candidates: candidates,
      p_warning_acknowledgements: acknowledgements,
      p_reason: reason
    } as never);
    if (result.error) return fail(result.error.message.includes('Active release changed') ? 409 : 400, { message: result.error.message.includes('Active release changed') ? 'The active release changed. Your staged candidates are preserved; review and validate them again.' : 'Could not activate this release. Check its candidates, warning acknowledgement, label, and reason.', conflict: result.error.message.includes('Active release changed') });
    return { message: 'Prompt release activated. Newly started work will use it; existing work remains pinned.', activated: asRecord(result.data) };
  },
  restore: async ({ locals, request }) => {
    await guard(locals);
    const form = await request.formData();
    const result = await locals.supabase.rpc('prompt_registry_restore' as never, {
      p_expected_active_release: String(form.get('expectedReleaseId') ?? ''),
      p_restore_release: String(form.get('restoreReleaseId') ?? ''),
      p_label: String(form.get('label') ?? '').trim(),
      p_warning_acknowledgements: form.get('acknowledgeSafety') === 'true' ? ['safety_language_changed'] : [],
      p_reason: String(form.get('reason') ?? '').trim()
    } as never);
    if (result.error) return fail(result.error.message.includes('Active release changed') ? 409 : 400, { message: result.error.message.includes('Active release changed') ? 'The active release changed. Review history and try the restore again.' : 'Could not restore this historical release. Provide a label, reason, and any required warning acknowledgement.', conflict: result.error.message.includes('Active release changed') });
    return { message: 'Historical release restored as a new release. Newly started work will use it.', restored: asRecord(result.data) };
  }
};
