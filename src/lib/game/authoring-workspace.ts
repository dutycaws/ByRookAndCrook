import { validateNpcSheet, type NpcSheet, type NpcSheetIssue } from './npc-sheet';

export const AUTHORING_SECTION_LABELS = {
  identity: 'Introduction',
  appearance: 'Appearance',
  personality: 'Personality',
  lore: 'Their world',
  skills: 'Skills',
  campaign: 'Their story arc'
} as const;

export type AuthoringSection = keyof typeof AUTHORING_SECTION_LABELS;
export type AuthoringActionKind = 'save' | 'assist' | 'sandbox' | 'scene' | 'submit' | 'retire' | 'comment';
export type AuthoringActionStatus = 'pending' | 'success' | 'failure' | 'unavailable' | 'stale';
export type AuthoringErrorCategory =
  | 'authentication'
  | 'permission'
  | 'stale_revision'
  | 'invalid_data'
  | 'missing_prerequisite'
  | 'quota_exhausted'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_malformed'
  | 'provider_no_change'
  | 'unexpected';

export interface AuthoringActionResult {
  action: AuthoringActionKind;
  status: AuthoringActionStatus;
  message: string;
  category?: AuthoringErrorCategory;
  revision?: number;
  versionNumber?: number;
  focusTarget?: string;
  conflict?: boolean;
}

export interface AuthoringProviderState {
  available: boolean;
  reason: string | null;
}

export interface AuthoringCapabilities {
  canEdit: boolean;
  canSubmit: boolean;
  canRequestAssistance: boolean;
  canUseSandbox: boolean;
  canRequestRetirement: boolean;
  reasons: Partial<Record<'edit' | 'submit' | 'assistance' | 'sandbox' | 'retirement', string>>;
}

export interface AuthoringDraft {
  id: string;
  revision: number;
  lifecycle: string;
  editable: boolean;
  sheet: NpcSheet;
  fieldPaths: string[];
}

export interface AuthoringNpcOption {
  npcId: string;
  name: string;
  title: string;
}

export interface AuthoringSceneCandidate {
  id: string;
  storageKey: string;
  altText: string;
  createdAt: string | null;
  selected: boolean;
  previewUrl: string | null;
}

export interface AssistanceComparisonRow {
  label: string;
  current: string[];
  suggested: string[];
}

export type AssistanceState = 'ready' | 'creating' | 'suggested' | 'outdated' | 'applied' | 'discarded' | 'no_change' | 'failed';

export interface AuthoringAssistance {
  id: string;
  section: AuthoringSection;
  sectionLabel: string;
  sourceRevision: number;
  state: AssistanceState;
  actionable: boolean;
  reason: string | null;
  explanation: string | null;
  comparison: AssistanceComparisonRow[];
  createdAt: string | null;
  decidedAt: string | null;
}

export interface AuthoringSandboxTurn {
  id: string;
  ordinal: number;
  role: 'keeper' | 'npc';
  content: string;
  createdAt: string | null;
  status: 'pending' | 'completed' | 'failed';
}

export interface AuthoringSandbox {
  id: string | null;
  draftRevision: number;
  active: boolean;
  invalidatedAt: string | null;
  pending: boolean;
  turns: AuthoringSandboxTurn[];
}

export interface AuthoringSandboxWorkspace {
  active: AuthoringSandbox | null;
  preserved: AuthoringSandbox[];
}

export interface AuthoringReviewComment {
  id: string;
  sectionLabel: string;
  body: string;
  resolved: boolean;
  createdAt: string | null;
}

export type EvaluationState = 'pending' | 'passed' | 'blocked' | 'failed';

export interface AuthoringVersionHistory {
  id: string;
  number: number;
  state: string;
  submittedAt: string | null;
  evaluation: {
    state: EvaluationState;
    hardBlocks: string[];
    advisories: string[];
  };
  reviewerDecision: null | {
    decision: string;
    notes: string;
    createdAt: string | null;
  };
  comments: AuthoringReviewComment[];
}

export interface AuthoringRetirement {
  id: string;
  status: 'open' | 'approved' | 'rejected';
  reason: string;
  createdAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface AuthoringPreflightIssue {
  path: string;
  section: AuthoringSection;
  sectionLabel: string;
  message: string;
  focusId: string;
}

export interface AuthoringWorkspaceDetail {
  npcId: string;
  draft: AuthoringDraft;
  capabilities: AuthoringCapabilities;
  provider: {
    assistance: AuthoringProviderState;
    sandbox: AuthoringProviderState;
  };
  eligibleNpcs: AuthoringNpcOption[];
  scenes: {
    selectedAssetId: string | null;
    candidates: AuthoringSceneCandidate[];
  };
  assistance: AuthoringAssistance[];
  sandbox: AuthoringSandboxWorkspace;
  versions: AuthoringVersionHistory[];
  retirement: AuthoringRetirement | null;
  preflight: AuthoringPreflightIssue[];
  quota: { assistanceDaily: number | null; sceneDaily: number | null; sandboxDaily: number | null };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function section(value: unknown): AuthoringSection {
  return Object.hasOwn(AUTHORING_SECTION_LABELS, String(value)) ? String(value) as AuthoringSection : 'identity';
}

function lines(value: unknown): string[] {
  return array(value).map((entry) => typeof entry === 'string' ? entry : string(record(entry).message)).filter(Boolean);
}

function summarizeSection(name: AuthoringSection, value: unknown): Array<{ label: string; values: string[] }> {
  const source = record(value);
  if (name === 'identity') return [
    { label: 'Name and role', values: [string(source.name), string(source.title)].filter(Boolean) },
    { label: 'Introduction', values: [string(source.shortDescription)].filter(Boolean) },
    { label: 'Voice', values: [string(source.voice)].filter(Boolean) }
  ];
  if (name === 'appearance') return [
    { label: 'Appearance', values: [string(source.physicalAppearance)].filter(Boolean) },
    { label: 'Clothing and features', values: [string(source.attire), string(source.notableFeatures)].filter(Boolean) },
    { label: 'Default mood', values: [string(source.mood)].filter(Boolean) }
  ];
  if (name === 'personality') return ['values', 'likes', 'dislikes', 'boundaries'].map((key) => ({
    label: key[0].toUpperCase() + key.slice(1), values: lines(source[key])
  }));
  if (name === 'skills') return Object.entries(source).map(([key, score]) => ({
    label: key[0].toUpperCase() + key.slice(1), values: [String(score)]
  }));
  if (name === 'lore') return [
    { label: 'Story details', values: array(source.entities).map((item) => `${string(record(item).name)} — ${string(record(item).description)}`) },
    { label: 'Connections', values: array(source.relationships).map((item) => string(record(item).description)).filter(Boolean) },
    { label: 'Things they know', values: array(source.facts).map((item) => string(record(item).text)).filter(Boolean) }
  ];
  return [
    { label: 'Long-term hope', values: [string(source.durableGoal)].filter(Boolean) },
    { label: 'Chapters', values: array(source.milestones).map((item, index) => `Chapter ${index + 1}: ${string(record(item).title)}`) }
  ];
}

function comparisonRows(sheet: NpcSheet, selected: AuthoringSection, proposal: UnknownRecord): AssistanceComparisonRow[] {
  const current = summarizeSection(selected, sheet[selected]);
  const suggested = summarizeSection(selected, proposal.replacement);
  const labels = [...new Set([...current.map((item) => item.label), ...suggested.map((item) => item.label)])];
  return labels.map((label) => ({
    label,
    current: current.find((item) => item.label === label)?.values ?? [],
    suggested: suggested.find((item) => item.label === label)?.values ?? []
  }));
}

function assistanceState(disposition: string, actionable: boolean, errorCode: string | null): AssistanceState {
  if (disposition === 'accepted') return 'applied';
  if (disposition === 'rejected') return 'discarded';
  if (disposition === 'failed' && errorCode === 'provider_no_change') return 'no_change';
  if (disposition === 'failed') return 'failed';
  if (disposition === 'pending') return 'creating';
  if (disposition === 'proposed' && !actionable) return 'outdated';
  if (disposition === 'proposed') return 'suggested';
  return 'ready';
}

function evaluation(value: unknown): AuthoringVersionHistory['evaluation'] {
  const source = record(value);
  const result = record(source.result);
  const hardBlocks = lines(source.hardBlocks ?? result.hardBlocks);
  const advisories = lines(source.advisories ?? result.advisories);
  const status = string(source.status, 'pending');
  return {
    state: status === 'failed' ? 'failed' : ['queued', 'running', 'pending', 'not_started', ''].includes(status) ? 'pending' : hardBlocks.length > 0 ? 'blocked' : 'passed',
    hardBlocks,
    advisories
  };
}

function decodeSandbox(value: unknown, fallbackRevision: number): AuthoringSandbox | null {
  const source = record(value);
  const sandboxId = nullableString(source.id ?? source.sandboxId);
  if (!sandboxId) return null;
  return {
    id: sandboxId,
    draftRevision: number(source.draftRevision ?? source.basedOnRevision, fallbackRevision),
    active: boolean(source.active, !source.invalidatedAt),
    invalidatedAt: nullableString(source.invalidatedAt),
    pending: boolean(source.pending),
    turns: array(source.turns ?? record(source.state).turns).map((entry, index): AuthoringSandboxTurn => {
      const row = record(entry);
      const roleValue = string(row.role, row.keeper ? 'keeper' : 'npc');
      return {
        id: string(row.id, `legacy-${index}`), ordinal: number(row.ordinal, index + 1),
        role: roleValue === 'keeper' ? 'keeper' : 'npc',
        content: string(row.content ?? row.keeper ?? row.reply), createdAt: nullableString(row.createdAt ?? row.at),
        status: ['pending', 'failed'].includes(string(row.status)) ? string(row.status) as 'pending' | 'failed' : 'completed'
      };
    })
  };
}

function issueSection(issue: NpcSheetIssue): AuthoringSection {
  const first = issue.path.split('.')[0];
  return section(first);
}

export function authoringPreflight(sheet: NpcSheet, selectedSceneAssetId: string | null): AuthoringPreflightIssue[] {
  const issues: AuthoringPreflightIssue[] = validateNpcSheet(sheet).map((entry) => {
    const selected = issueSection(entry);
    return {
      path: entry.path,
      section: selected,
      sectionLabel: AUTHORING_SECTION_LABELS[selected],
      message: entry.message,
      focusId: `field-${entry.path.replaceAll('.', '-')}`
    };
  });
  if (!selectedSceneAssetId) issues.push({
    path: 'scene', section: 'appearance', sectionLabel: 'Scene',
    message: 'Choose a scene before submitting.', focusId: 'scene-candidates'
  });
  return issues;
}

export function decodeAuthoringWorkspace(
  value: unknown,
  provider: AuthoringProviderState,
  previewUrl: (storageKey: string) => string | null = () => null
): AuthoringWorkspaceDetail {
  const root = record(value);
  const draftValue = Object.keys(record(root.draft)).length ? record(root.draft) : root;
  const sheet = draftValue.sheet as NpcSheet;
  if (!sheet || typeof sheet !== 'object') throw new Error('The authoring workspace did not return a draft sheet.');
  const revision = number(draftValue.revision ?? root.revision);
  const lifecycle = string(draftValue.lifecycle ?? draftValue.state ?? root.state, 'open');
  const capabilitiesValue = record(root.capabilities);
  const capabilityReasons = record(capabilitiesValue.reasons);
  const editable = boolean(draftValue.editable, lifecycle === 'open');
  const capabilities: AuthoringCapabilities = {
    canEdit: boolean(capabilitiesValue.canEdit, editable),
    canSubmit: boolean(capabilitiesValue.canSubmit, editable),
    canRequestAssistance: boolean(capabilitiesValue.canRequestAssistance, editable),
    canUseSandbox: boolean(capabilitiesValue.canUseSandbox, editable),
    canRequestRetirement: boolean(capabilitiesValue.canRequestRetirement, true),
    reasons: {
      edit: nullableString(capabilityReasons.edit ?? capabilitiesValue.editReason) ?? undefined,
      submit: nullableString(capabilityReasons.submit ?? capabilitiesValue.submitReason) ?? undefined,
      assistance: nullableString(capabilityReasons.assistance ?? capabilitiesValue.assistanceReason) ?? undefined,
      sandbox: nullableString(capabilityReasons.sandbox ?? capabilitiesValue.sandboxReason) ?? undefined,
      retirement: nullableString(capabilityReasons.retirement ?? capabilitiesValue.retirementReason) ?? undefined
    }
  };
  const scenesValue = record(root.scenes);
  const selectedAssetId = nullableString(scenesValue.selectedAssetId ?? root.selectedSceneAssetId);
  const sceneRows = array(scenesValue.candidates ?? root.assets);
  const assistance = array(root.assistance).map((entry): AuthoringAssistance => {
    const row = record(entry);
    const selected = section(row.sectionPath);
    const sourceRevision = number(row.sourceRevision, revision);
    const disposition = string(row.disposition, 'pending');
    const proposal = record(row.proposal);
    const errorCode = nullableString(row.errorCode);
    const reason = nullableString(row.reason) ?? errorCode;
    const actionable = boolean(row.actionable, disposition === 'proposed' && sourceRevision === revision);
    return {
      id: string(row.id), section: selected, sectionLabel: AUTHORING_SECTION_LABELS[selected], sourceRevision,
      state: assistanceState(disposition, actionable, errorCode), actionable, reason,
      explanation: nullableString(proposal.explanation ?? proposal.note),
      comparison: proposal.replacement === undefined ? [] : comparisonRows(sheet, selected, proposal),
      createdAt: nullableString(row.createdAt), decidedAt: nullableString(row.decidedAt)
    };
  });
  const sandboxValue = record(root.sandbox);
  const sandbox = {
    active: decodeSandbox(sandboxValue.active ?? (sandboxValue.id ? sandboxValue : null), revision),
    preserved: array(sandboxValue.preserved).map((entry) => decodeSandbox(entry, revision)).filter((entry): entry is AuthoringSandbox => entry !== null)
  } satisfies AuthoringSandboxWorkspace;
  const versions = array(root.versions).map((entry): AuthoringVersionHistory => {
    const row = record(entry);
    const decisionRows = array(row.decisions);
    const decision = record(row.reviewerDecision ?? decisionRows[0]);
    return {
      id: string(row.id), number: number(row.number), state: string(row.state), submittedAt: nullableString(row.submittedAt),
      evaluation: evaluation(row.evaluation),
      reviewerDecision: Object.keys(decision).length ? {
        decision: string(decision.decision), notes: string(decision.notes), createdAt: nullableString(decision.createdAt)
      } : null,
      comments: array(row.comments ?? root.comments).map((comment): AuthoringReviewComment => {
        const item = record(comment); const selected = section(item.sectionPath);
        return { id: string(item.id), sectionLabel: AUTHORING_SECTION_LABELS[selected], body: string(item.body), resolved: Boolean(item.resolvedAt), createdAt: nullableString(item.createdAt) };
      })
    };
  });
  const retirementValue = record(root.retirement);
  const retirementId = nullableString(retirementValue.id);
  const quota = record(root.quota);
  return {
    npcId: string(root.npcId),
    draft: {
      id: string(draftValue.id ?? root.draftId), revision, lifecycle, editable,
      sheet, fieldPaths: array(draftValue.fieldPaths ?? root.fieldPaths).map((item) => string(item)).filter(Boolean)
    },
    capabilities,
    provider: { assistance: provider, sandbox: provider },
    eligibleNpcs: array(root.eligibleNpcs).map((entry) => {
      const row = record(entry); return { npcId: string(row.npcId), name: string(row.name), title: string(row.title) };
    }).filter((entry) => entry.npcId && entry.name),
    scenes: {
      selectedAssetId,
      candidates: sceneRows.map((entry): AuthoringSceneCandidate => {
        const row = record(entry); const storageKey = string(row.storageKey);
        return { id: string(row.id), storageKey, altText: string(row.altText), createdAt: nullableString(row.createdAt), selected: string(row.id) === selectedAssetId, previewUrl: previewUrl(storageKey) };
      })
    },
    assistance,
    sandbox,
    versions,
    retirement: retirementId ? {
      id: retirementId, status: string(retirementValue.status, 'open') as AuthoringRetirement['status'],
      reason: string(retirementValue.reason), createdAt: nullableString(retirementValue.createdAt),
      decidedAt: nullableString(retirementValue.decidedAt), decisionReason: nullableString(retirementValue.decisionReason)
    } : null,
    preflight: authoringPreflight(sheet, selectedAssetId),
    quota: {
      assistanceDaily: typeof quota.assistanceDaily === 'number' ? quota.assistanceDaily : null,
      sceneDaily: typeof quota.sceneDaily === 'number' ? quota.sceneDaily : null,
      sandboxDaily: typeof quota.sandboxDaily === 'number' ? quota.sandboxDaily : null
    }
  };
}

export function normalizeAuthoringError(error: { code?: string; message?: string } | null | undefined, fallback: string): Pick<AuthoringActionResult, 'category' | 'message' | 'status' | 'conflict'> {
  const code = string(error?.code);
  const message = string(error?.message, fallback);
  const lower = message.toLowerCase();
  if (code === 'PT401') return { category: 'authentication', message: 'Sign in again before continuing.', status: 'failure' };
  if (code === 'PT403') return { category: 'permission', message: 'Your creator access does not allow this action.', status: 'failure' };
  if (code === 'PT409' || lower.includes('revision') || lower.includes('older draft')) return { category: 'stale_revision', message: 'This draft changed elsewhere. Refresh before continuing.', status: 'stale', conflict: true };
  if (code === 'PT429' || lower.includes('quota')) return { category: 'quota_exhausted', message: 'The daily authoring limit has been reached. Try again tomorrow.', status: 'failure' };
  if (lower.includes('scene')) return { category: 'missing_prerequisite', message, status: 'failure' };
  if (code === 'PT400' || code === 'PT422') return { category: 'invalid_data', message, status: 'failure' };
  return { category: 'unexpected', message: fallback, status: 'failure' };
}

export function providerFailure(errorCode: string | undefined): Pick<AuthoringActionResult, 'category' | 'message' | 'status'> {
  if (errorCode === 'provider_no_change') return { category: 'provider_no_change', message: 'No useful change was proposed. Try a more specific instruction.', status: 'failure' };
  if (errorCode === 'provider_timeout') return { category: 'provider_timeout', message: 'The authoring assistant took too long to respond. Try again.', status: 'failure' };
  if (errorCode === 'provider_malformed') return { category: 'provider_malformed', message: 'The authoring assistant returned an unusable suggestion. Nothing was changed.', status: 'failure' };
  if (errorCode?.includes('unavailable') || errorCode?.includes('unconfigured') || errorCode === 'local_provider_not_implemented') return { category: 'provider_unavailable', message: 'The authoring assistant is unavailable with the current provider configuration.', status: 'unavailable' };
  return { category: 'unexpected', message: 'The authoring assistant could not complete this request. Nothing was changed.', status: 'failure' };
}
