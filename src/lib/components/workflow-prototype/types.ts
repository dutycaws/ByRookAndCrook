/**
 * Data-only contract for the unified workflow prototype.
 *
 * A workflow describes navigable local UI states. Choosing a card only changes
 * which node the prototype presents; it never invokes gameplay commands or
 * persists game state.
 */
export type WorkflowArea = 'bar' | 'garden' | 'shop' | 'brewery' | 'bakery';

/** Presentation variants share the same graph and differ only in their renderer. */
export type WorkflowVariant = 'A' | 'B' | 'C';

export type WorkflowNodeId = string;

export type WorkflowNodeKind =
	| 'menu'
	| 'inspection'
	| 'chat'
	| 'journal'
	| 'activity'
	| 'result';

export interface WorkflowSceneContext {
	/** Identifier consumed by the scene adapter, such as `resident` or `plot-growing`. */
	id: string;
	label: string;
	detail?: string;
}

export interface WorkflowResult {
	title: string;
	detail: string;
	tone?: 'neutral' | 'success' | 'warning';
}

export interface WorkflowMessage {
	speaker: string;
	text: string;
}

export interface WorkflowChatInput {
	placeholder: string;
	submitLabel: string;
	/** A canned, local-only reply shown after the prototype input is submitted. */
	response: WorkflowMessage;
}

export interface WorkflowJournalEntry {
	title: string;
	detail: string;
	when?: string;
}

export interface WorkflowChoiceContext {
	/** Optional scene to focus when this choice is highlighted or selected. */
	sceneId?: string;
	label?: string;
	detail?: string;
}

export interface WorkflowChoice {
	id: string;
	title: string;
	eyebrow?: string;
	detail?: string;
	icon?: string;
	/** Destination in this workflow graph. */
	next?: WorkflowNodeId;
	/** Local-only feedback for choices that do not need a separate node. */
	result?: WorkflowResult;
	context?: WorkflowChoiceContext;
}

export interface WorkflowNode {
	id: WorkflowNodeId;
	kind?: WorkflowNodeKind;
	title: string;
	description: string;
	scene?: WorkflowSceneContext;
	chat?: {
		messages: WorkflowMessage[];
		input?: WorkflowChatInput;
	};
	entries?: WorkflowJournalEntry[];
	result?: WorkflowResult;
	choices: WorkflowChoice[];
}

export interface WorkflowDefinition {
	area: WorkflowArea;
	title: string;
	initialNodeId: WorkflowNodeId;
	nodes: Record<WorkflowNodeId, WorkflowNode>;
}
