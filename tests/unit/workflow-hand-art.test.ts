import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import WorkflowHand from '$lib/components/ui/WorkflowHand.svelte';
import type { WorkflowChoice } from '$lib/components/ui/workflow';

describe('WorkflowHand card illustrations', () => {
	it('renders established illustrations for all social card keys', () => {
		const socialCardKinds = ['charm', 'insight', 'rumor'] as const;
		const items: WorkflowChoice[] = socialCardKinds.map((kind) => ({
			id: `dialogue:intent:${kind}`,
			title: kind,
			icon: '✧',
			artwork: { kind, seed: `intent:${kind}` }
		}));
		const { body } = render(WorkflowHand, {
			props: { items, label: 'Conversation choices', onchoose: () => undefined }
		});

		expect(body.match(/viewBox="0 0 96 96"/g)).toHaveLength(3);
		expect(body).not.toContain('aria-hidden="true">✧</div>');
	});

	it('keeps the existing glyph fallback for choices without an illustration', () => {
		const { body } = render(WorkflowHand, {
			props: {
				items: [{ id: 'bar:talk', title: 'Talk', icon: '“' }],
				label: 'Resident actions',
				onchoose: () => undefined
			}
		});

		expect(body).toContain('class="choice-art');
		expect(body).toContain('aria-hidden="true"><!--[-1-->“');
	});
});
