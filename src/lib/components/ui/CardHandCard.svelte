<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes, HTMLButtonAttributes, MouseEventHandler } from 'svelte/elements';

	type CardHandCardProps = Omit<HTMLButtonAttributes, 'children' | 'class' | 'disabled' | 'onclick' | 'type'> & {
		label: string;
		selected?: boolean;
		disabled?: boolean;
		interactive?: boolean;
		children: Snippet;
		onclick?: MouseEventHandler<HTMLButtonElement>;
		class?: string;
		type?: 'button' | 'submit' | 'reset';
	};

	let {
		label,
		selected = false,
		disabled = false,
		interactive = true,
		children,
		onclick,
		type = 'button',
		class: className,
		'aria-label': ariaLabel,
		...attributes
	}: CardHandCardProps = $props();

	const accessibleLabel = $derived(ariaLabel ?? label);
	const ghostAttributes = $derived.by(
		() =>
			Object.fromEntries(
				Object.entries(attributes).filter(([name]) =>
					name === 'id' ||
					name === 'tabindex' ||
					name === 'title' ||
					name.startsWith('aria-') ||
					name.startsWith('data-')
				)
			) as HTMLAttributes<HTMLDivElement>
	);
</script>

{#if interactive}
	<button
		{...attributes}
		class={`card-hand-card ${className ?? ''}`}
		type={type}
		disabled={disabled}
		aria-label={accessibleLabel}
		aria-pressed={selected}
		aria-disabled={disabled ? 'true' : undefined}
		onclick={disabled ? undefined : onclick}
	>
		{@render children()}
	</button>
{:else}
	<div
		{...ghostAttributes}
		class={`card-hand-card card-hand-card--static ${className ?? ''}`}
		role="group"
		aria-label={accessibleLabel}
		aria-current={selected ? 'true' : undefined}
		aria-disabled={disabled ? 'true' : undefined}
	>
		{@render children()}
	</div>
{/if}

<style>
	.card-hand-card {
		position: relative;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		align-content: stretch;
		gap: .45rem;
		width: 100%;
		min-width: 0;
		min-height: 15rem;
		padding: .7rem;
		overflow: hidden;
		border: 1px solid rgb(188 151 81 / 58%);
		border-radius: .8rem .8rem .68rem .68rem;
		background:
			linear-gradient(145deg, rgb(255 238 190 / 8%), transparent 42%),
			linear-gradient(160deg, #302518, #201a13 82%);
		box-shadow: 0 .45rem 1rem rgb(0 0 0 / 24%), inset 0 0 0 3px rgb(22 17 11 / 45%);
		color: #f3e6c5;
		font: inherit;
		text-align: left;
		transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
	}

	button.card-hand-card {
		cursor: pointer;
	}

	button.card-hand-card:hover:not(:disabled) {
		border-color: #dfbd69;
		box-shadow: 0 .65rem 1.25rem rgb(0 0 0 / 28%), inset 0 0 0 3px rgb(22 17 11 / 38%);
	}

	button.card-hand-card[aria-pressed='true'],
	.card-hand-card[aria-current='true'] {
		border-color: #edcf7d;
		box-shadow: 0 0 0 2px rgb(240 210 122 / 34%), 0 .65rem 1.25rem rgb(0 0 0 / 30%), inset 0 0 0 3px rgb(22 17 11 / 38%);
	}

	.card-hand-card:focus-visible {
		z-index: 1;
		outline: 2px solid #ffe49c;
		outline-offset: 3px;
	}

	button.card-hand-card:disabled,
	.card-hand-card[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: .62;
	}

	.card-hand-card--static {
		cursor: default;
	}

	@media (max-width: 700px) {
		.card-hand-card { min-height: 13rem; padding: .58rem; }
	}

	@media (prefers-reduced-motion: reduce) {
		.card-hand-card { transition: none; }
	}
</style>
