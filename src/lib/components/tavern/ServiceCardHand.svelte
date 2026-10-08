<script lang="ts">
	import { onMount, tick } from 'svelte';
	import TavernCard from './TavernCard.svelte';
	import type { TavernCardChoice } from './card-types';

	let {
		choices,
		selectedItemId = '',
		barHand = false,
		conversationOpen = false,
		disabled = false,
		onselect,
		onclose
	}: {
		choices: TavernCardChoice[];
		selectedItemId?: string;
		barHand?: boolean;
		conversationOpen?: boolean;
		disabled?: boolean;
		onselect: (choice: TavernCardChoice) => void;
		onclose: () => void;
	} = $props();

	const totalCardCount = $derived(choices.reduce((count, choice) => count + choice.quantity, 0));
	let viewport = $state<HTMLDivElement>();
	let focusedIndex = $state(0);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);
	$effect(() => {
		if (choices.length === 0) focusedIndex = 0;
		else if (focusedIndex >= choices.length) focusedIndex = choices.length - 1;
		void tick().then(updateScrollHints);
	});

	onMount(() => {
		if (!viewport) return;
		const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateScrollHints);
		observer?.observe(viewport);
		void tick().then(updateScrollHints);
		return () => observer?.disconnect();
	});

	function updateScrollHints() {
		if (!viewport) return;
		canScrollLeft = viewport.scrollLeft > 2;
		canScrollRight = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2;
	}

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
		const viewportRect = viewport.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		const targetLeft = viewport.scrollLeft + cardRect.left - viewportRect.left - (viewport.clientWidth - cardRect.width) / 2;
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

<section class="service-card-hand" class:bar-hand={barHand} aria-labelledby="card-hand-title">
	<header class="hand-heading" class:bar-hand-heading={barHand}>
		<div>
			<p class="hand-eyebrow">Your hand</p>
			<h2 id="card-hand-title">{barHand ? 'Available cards' : 'Choose one card'}</h2>
		</div>
		{#if barHand}
			<p class="bar-hand-count">{totalCardCount} card{totalCardCount === 1 ? '' : 's'}</p>
		{:else}
			<button type="button" class="hand-back-button" onclick={onclose}>Back to talk</button>
		{/if}
	</header>

	{#if choices.length}
		{#if !barHand}
			<div class="hand-controls" aria-label="Card navigation">
				<button type="button" class="step-button" aria-label="Previous card" disabled={focusedIndex <= 0} onclick={() => focusCard(focusedIndex - 1)}>‹</button>
				<p class="hand-count">{choices.length} card{choices.length === 1 ? '' : 's'}</p>
				<button type="button" class="step-button" aria-label="Next card" disabled={focusedIndex >= choices.length - 1} onclick={() => focusCard(focusedIndex + 1)}>›</button>
			</div>
		{/if}
		<div class="card-viewport-shell" class:can-scroll-left={canScrollLeft} class:can-scroll-right={canScrollRight}>
			<div
				class="card-viewport"
				class:bar-hand-viewport={barHand}
				bind:this={viewport}
				role="toolbar"
				aria-label={barHand ? 'Your intent and hospitality cards' : 'Choose an intent or hospitality card'}
				aria-describedby="card-hand-instructions"
				tabindex="-1"
				onkeydown={moveFocus}
				onfocusin={rememberFocusedCard}
				onscroll={updateScrollHints}
			>
				<div class="card-track" class:bar-hand-track={barHand} class:conversation-open={conversationOpen}>
					{#each choices as choice, index (choice.key)}
						<TavernCard
							{choice}
							{index}
							handCount={choices.length}
							{barHand}
							selected={choice.itemIds.includes(selectedItemId)}
							{disabled}
							onselect={() => onselect(choice)}
						/>
					{/each}
				</div>
			</div>
		</div>
		<p class="sr-only" id="card-hand-instructions">Use the left and right arrow keys, Home, or End to move through your hand. In the regular hand view, you can also use the previous and next card buttons.</p>
	{:else if barHand}
		<div class="bar-empty-hand">
			<p class="hand-empty">Your hand is empty. Prepare an intent or hospitality card before starting a conversation.</p>
			<nav class="empty-hand-links" aria-label="Places to prepare cards">
				<a href="/shop">Shop · intent cards</a>
				<a href="/brewery">Brewery · drinks</a>
				<a href="/bakery">Bakery · food</a>
			</nav>
		</div>
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
	.bar-empty-hand { display: grid; justify-items: center; gap: 0.75rem; max-width: 54rem; margin: 0 auto; padding: 1rem 1.1rem; border: 1px solid rgb(180 145 77 / 45%); border-radius: 0.7rem; color: #eee2c5; background: rgb(20 15 9 / 0.9); text-align: center; }
	.bar-empty-hand .hand-empty { max-width: 34rem; margin: 0; font-size: 0.82rem; line-height: 1.45; }
	.empty-hand-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.45rem; }
	.empty-hand-links a { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; padding: 0.35rem 0.7rem; border: 1px solid #8b6d39; border-radius: 0.4rem; color: #f3dfa7; background: #2b2114; font-size: 0.74rem; text-decoration: none; }
	.empty-hand-links a:hover { border-color: #f0d27a; background: #392c19; }
	.empty-hand-links a:focus-visible { outline: 2px solid #ffe49c; outline-offset: 2px; }
	.bar-hand-count { margin: 0.3rem 0.15rem 0; color: #cbbd9f; font-size: 0.7rem; white-space: nowrap; }
	.card-viewport-shell { position: relative; min-width: 0; }
	.card-viewport-shell::before, .card-viewport-shell::after { position: absolute; z-index: 3; top: 0; bottom: 0.75rem; width: 1rem; content: ''; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
	.card-viewport-shell::before { left: 0; background: linear-gradient(90deg, #17120c 0, transparent 100%); }
	.card-viewport-shell::after { right: 0; background: linear-gradient(270deg, #17120c 0, transparent 100%); }
	.card-viewport-shell.can-scroll-left::before, .card-viewport-shell.can-scroll-right::after { opacity: 0.72; }
	.service-card-hand.bar-hand { width: min(92vw, 76rem); padding: 0; }
	.service-card-hand.bar-hand .bar-hand-heading { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); clip-path: inset(50%); white-space: nowrap; }
	.service-card-hand :global(.card-viewport.bar-hand-viewport) { max-height: 19rem; overflow-x: auto; overflow-y: hidden; padding: 3.75rem 0 1rem; scroll-snap-type: x proximity; scrollbar-color: #806332 rgb(255 255 255 / 5%); }
	.service-card-hand :global(.card-track.bar-hand-track) { display: flex; width: max-content; min-width: 100%; align-items: end; justify-content: space-evenly; gap: 0.55rem; padding: 0 1.2rem; }
	.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand) { transform: translateY(clamp(-3rem, var(--hand-lift, 0px), 0px)) rotate(clamp(-18deg, var(--hand-angle, 0deg), 18deg)); }
	.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand:hover:not(:disabled)), .service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand.selected) { transform: translateY(calc(clamp(-3rem, var(--hand-lift, 0px), 0px) - 0.45rem)) rotate(0deg); }
	.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand.selected) { z-index: 8; }
	.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand:focus-visible) { z-index: 12; opacity: 1; transform: translateY(calc(clamp(-3rem, var(--hand-lift, 0px), 0px) - 0.6rem)) rotate(0deg); }
	.service-card-hand :global(.card-track.bar-hand-track.conversation-open .tavern-card:not(.selected)) { opacity: 0.32; }
	.service-card-hand :global(.card-track.bar-hand-track.conversation-open .tavern-card.selected) { opacity: 0.68; }
	.service-card-hand :global(.card-track.bar-hand-track.conversation-open .tavern-card:focus-visible) { opacity: 1; }
	@keyframes hand-enter { from { opacity: 0; transform: translateY(0.3rem); } to { opacity: 1; transform: translateY(0); } }
	@media (max-width: 600px) {
		.hand-heading { gap: 0.5rem; }
		.hand-heading h2 { font-size: 0.92rem; }
		.card-track { grid-auto-columns: clamp(9rem, 40vw, 10rem); }
	}
	@media (max-width: 1000px) {
		.service-card-hand.bar-hand { width: 100%; }
		.service-card-hand :global(.card-viewport.bar-hand-viewport) { max-height: 14rem; padding: 1.65rem 0 0.9rem; }
		.service-card-hand :global(.card-track.bar-hand-track) { justify-content: space-evenly; gap: 0.5rem; padding-inline: 1rem; }
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand) { transform: translateY(clamp(-1.2rem, var(--hand-lift, 0px), 0px)) rotate(clamp(-11deg, var(--hand-angle, 0deg), 11deg)); }
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand:hover:not(:disabled)), .service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand.selected) { transform: translateY(calc(clamp(-1.2rem, var(--hand-lift, 0px), 0px) - 0.35rem)) rotate(0deg); }
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand:focus-visible) { transform: translateY(calc(clamp(-1.2rem, var(--hand-lift, 0px), 0px) - 0.45rem)) rotate(0deg); }
		.card-viewport-shell::before, .card-viewport-shell::after { width: 0.75rem; }
	}
	@media (prefers-reduced-motion: reduce) {
		.card-viewport { scroll-behavior: auto; scroll-snap-type: x proximity; }
		.card-track :global(.tavern-card) { transform: none; }
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand),
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand:hover:not(:disabled)),
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand.selected),
		.service-card-hand :global(.card-track.bar-hand-track .tavern-card.bar-hand:focus-visible) { transform: none; }
		.service-card-hand { animation: none; }
		.card-viewport-shell::before, .card-viewport-shell::after { transition: none; }
	}
</style>
