<script lang="ts">
	import TavernCard from './TavernCard.svelte';
	import type { TavernCardChoice } from './card-types';

	let {
		choices,
		selectedItemId = '',
		disabled = false,
		onselect,
		onclose
	}: {
		choices: TavernCardChoice[];
		selectedItemId?: string;
		disabled?: boolean;
		onselect: (choice: TavernCardChoice) => void;
		onclose: () => void;
	} = $props();

	let viewport = $state<HTMLDivElement>();
	let focusedIndex = $state(0);
	$effect(() => {
		if (choices.length === 0) focusedIndex = 0;
		else if (focusedIndex >= choices.length) focusedIndex = choices.length - 1;
	});

	function cardAt(index: number) {
		return viewport?.querySelector<HTMLButtonElement>(`[data-card-index="${index}"]`);
	}

	function focusCard(index: number) {
		if (choices.length === 0) return;
		focusedIndex = Math.max(0, Math.min(index, choices.length - 1));
		const card = cardAt(focusedIndex);
		if (!card || !viewport) return;
		card.focus({ preventScroll: true });
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const targetLeft = viewport.scrollLeft + card.offsetLeft - viewport.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2;
		viewport.scrollTo({ left: targetLeft, behavior: reducedMotion ? 'auto' : 'smooth' });
	}

	function moveFocus(event: KeyboardEvent) {
		const target = event.target;
		if (target instanceof HTMLButtonElement && !target.hasAttribute('data-card-index')) return;
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			focusCard(focusedIndex + 1);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			focusCard(focusedIndex - 1);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusCard(0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusCard(choices.length - 1);
		}
	}

	function rememberFocusedCard(event: FocusEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const card = target.closest<HTMLButtonElement>('[data-card-index]');
		if (card) focusedIndex = Number(card.dataset.cardIndex ?? 0);
	}
</script>

<section class="service-card-hand" aria-labelledby="card-hand-title">
	<header class="hand-heading">
		<div>
			<p class="hand-eyebrow">Your hand</p>
			<h2 id="card-hand-title">Choose one card</h2>
		</div>
		<button type="button" class="hand-back-button" onclick={onclose}>Back to talk</button>
	</header>

	{#if choices.length}
		<div class="hand-controls" aria-label="Card navigation">
			<button type="button" class="step-button" aria-label="Previous card" disabled={focusedIndex <= 0} onclick={() => focusCard(focusedIndex - 1)}>‹</button>
			<p class="hand-count">{choices.length} card{choices.length === 1 ? '' : 's'}</p>
			<button type="button" class="step-button" aria-label="Next card" disabled={focusedIndex >= choices.length - 1} onclick={() => focusCard(focusedIndex + 1)}>›</button>
		</div>
		<div
			class="card-viewport"
			bind:this={viewport}
			role="toolbar"
			aria-label="Choose an intent or hospitality card"
			aria-describedby="card-hand-instructions"
			tabindex="-1"
			onkeydown={moveFocus}
			onfocusin={rememberFocusedCard}
		>
			<div class="card-track">
				{#each choices as choice, index (choice.key)}
					<TavernCard
						{choice}
						{index}
						selected={choice.itemIds.includes(selectedItemId)}
						{disabled}
						onselect={() => onselect(choice)}
					/>
				{/each}
			</div>
		</div>
		<p class="sr-only" id="card-hand-instructions">Use the left and right arrow keys, Home, or End to move through your hand. You can also use the previous and next card buttons.</p>
	{:else}
		<p class="quiet-line hand-empty">Your hand is empty. You can still talk without playing a card.</p>
	{/if}
</section>

<style>
	.service-card-hand { min-width: 0; padding: 0.9rem 0 0.15rem; animation: hand-enter 160ms ease-out both; }
	.hand-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; padding: 0 0.2rem 0.65rem; }
	.hand-eyebrow { margin: 0 0 0.2rem; color: #d9bd78; font: 600 0.65rem 'Cinzel', Georgia, serif; letter-spacing: 0.08em; text-transform: uppercase; }
	.hand-heading h2 { margin: 0; font: 600 1rem 'Cinzel', Georgia, serif; }
	.hand-back-button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.25rem; flex: none; padding: 0.25rem 0.45rem; border: 1px solid #5c4727; background: transparent; color: #e9d49f; font: inherit; font-size: 0.76rem; text-decoration: underline; text-underline-offset: 0.2em; cursor: pointer; }
	.hand-back-button:hover:not(:disabled) { color: #fff0bc; border-color: #a48349; }
	.hand-back-button:disabled { opacity: 0.5; cursor: not-allowed; }
	.hand-controls { display: flex; align-items: center; justify-content: flex-end; gap: 0.45rem; margin: 0 0.25rem 0.35rem; }
	.step-button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid rgb(196 158 85 / 42%); border-radius: 50%; background: #211a12; color: #f2dfa7; font-size: 1.2rem; line-height: 1; cursor: pointer; }
	.step-button:disabled { opacity: 0.38; cursor: not-allowed; }
	.step-button:focus-visible, .hand-back-button:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
	.hand-count { min-width: 3.5rem; margin: 0; color: #bcb099; font-size: 0.7rem; text-align: center; }
	.card-viewport { overflow-x: auto; overflow-y: visible; overscroll-behavior-inline: contain; scroll-snap-type: x mandatory; scrollbar-color: #806332 transparent; scrollbar-width: thin; padding: 0.45rem 0.35rem 0.7rem; }
	.card-track { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(9rem, 10.25rem); align-items: start; gap: 0.65rem; width: max-content; min-width: 100%; }
	.card-track :global(.tavern-card) { scroll-snap-align: center; }
	.card-track :global(.tavern-card:nth-child(3n + 1)) { transform: rotate(0.9deg) translateY(0.2rem); }
	.card-track :global(.tavern-card:nth-child(3n + 2)) { transform: rotate(-0.2deg) translateY(0); }
	.card-track :global(.tavern-card:nth-child(3n)) { transform: rotate(-0.9deg) translateY(0.2rem); }
	.card-track :global(.tavern-card:hover), .card-track :global(.tavern-card.selected), .card-track :global(.tavern-card:focus-visible) { transform: translateY(-0.3rem) rotate(0deg); }
	.hand-empty { margin: 0.15rem 0.3rem 0; color: #bcb099; font-size: 0.74rem; }
	@keyframes hand-enter { from { opacity: 0; transform: translateY(0.3rem); } to { opacity: 1; transform: translateY(0); } }
	@media (max-width: 600px) {
		.hand-heading { gap: 0.5rem; }
		.hand-heading h2 { font-size: 0.92rem; }
		.card-track { grid-auto-columns: clamp(9rem, 40vw, 10rem); }
	}
	@media (prefers-reduced-motion: reduce) {
		.card-viewport { scroll-behavior: auto; scroll-snap-type: x proximity; }
		.card-track :global(.tavern-card) { transform: none; }
		.service-card-hand { animation: none; }
	}
</style>
