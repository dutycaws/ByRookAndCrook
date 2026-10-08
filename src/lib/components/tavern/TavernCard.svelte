<script lang="ts">
	import TavernCardArt from './TavernCardArt.svelte';
	import type { BurnTreatment } from '$lib/card-effects';
	import type { TavernCardChoice } from './card-types';

	type BurningCard = { turnId: string; itemId: string; treatment: BurnTreatment; durationMs: number };

	let {
		choice,
		selected = false,
		disabled = false,
		interactive = true,
		compact = false,
		index = 0,
		handCount = 1,
		barHand = false,
		burningCard = null,
		onselect
	}: {
		choice: TavernCardChoice;
		selected?: boolean;
		disabled?: boolean;
		interactive?: boolean;
		compact?: boolean;
		index?: number;
		handCount?: number;
		barHand?: boolean;
		burningCard?: BurningCard | null;
		onselect?: () => void;
	} = $props();

	const artSeed = $derived(`${choice.key}-${index}-${compact ? 'small' : 'full'}`);
	const fanOffset = $derived(index - (handCount - 1) / 2);
	const handAngle = $derived(Math.max(-18, Math.min(18, fanOffset * 5.5)));
	const fanRadius = $derived(Math.max(1, (handCount - 1) / 2));
	const handLift = $derived(handCount <= 2 ? 0 : -48 * (1 - (fanOffset / fanRadius) ** 2));
	const barHandStyle = $derived(barHand ? `--hand-angle:${handAngle}deg;--hand-lift:${handLift}px;` : undefined);
	const accessibleLabel = $derived(
		`${choice.eyebrow}. ${choice.title}. ${choice.detail}${choice.quantity > 1 ? `. ${choice.quantity} available` : ''}`
	);
</script>

{#snippet cardFace()}
	<span class="card-art"><TavernCardArt kind={choice.kind} seed={artSeed} /></span>
	<span class="card-copy">
		<span class="card-eyebrow">{choice.eyebrow}</span>
		<strong>{choice.title}</strong>
		<span class="card-detail">{choice.detail}</span>
	</span>
	{#if choice.quantity > 1}<span class="card-quantity" aria-label={`${choice.quantity} in hand`}>×{choice.quantity}</span>{/if}
{/snippet}

{#if interactive}
	<button
		type="button"
		class="tavern-card card-{choice.kind}"
		class:selected
		class:compact
		class:bar-hand={barHand}
		aria-label={accessibleLabel}
		aria-pressed={selected}
		aria-disabled={disabled ? 'true' : undefined}
		data-card-index={index}
		data-card-burn-active={burningCard ? 'true' : undefined}
		data-card-burn-item-id={burningCard?.itemId}
		data-card-burn-turn-id={burningCard?.turnId}
		data-card-burn-treatment={burningCard?.treatment}
		data-card-burn-duration-ms={burningCard?.durationMs}
		style={barHandStyle}
		disabled={disabled && !barHand}
		onclick={disabled && barHand ? undefined : onselect}
	>
		{@render cardFace()}
	</button>
{:else}
	<div
		class="tavern-card card-{choice.kind}"
		class:selected
		class:compact
		class:bar-hand={barHand}
		role="group"
		aria-label={accessibleLabel}
		data-card-burn-active={burningCard ? 'true' : undefined}
		data-card-burn-item-id={burningCard?.itemId}
		data-card-burn-turn-id={burningCard?.turnId}
		data-card-burn-treatment={burningCard?.treatment}
		data-card-burn-duration-ms={burningCard?.durationMs}
		style={barHandStyle}
	>
		{@render cardFace()}
	</div>
{/if}

<style>
	.tavern-card {
		position: relative;
		display: grid;
		grid-template-columns: 3.2rem minmax(0, 1fr);
		align-content: start;
		align-items: start;
		gap: 0.65rem;
		width: 100%;
		min-height: 11.25rem;
		padding: 0.85rem;
		border: 1px solid rgb(182 145 75 / 55%);
		border-radius: 0.9rem 0.9rem 0.72rem 0.72rem;
		background:
			linear-gradient(145deg, rgb(255 238 190 / 8%), transparent 42%),
			linear-gradient(160deg, #302518, #201a13 82%);
		box-shadow: 0 0.5rem 1.1rem rgb(0 0 0 / 22%), inset 0 0 0 3px rgb(22 17 11 / 55%);
		color: #f3e6c5;
		font: inherit;
		text-align: left;
		transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
	}
	button.tavern-card { cursor: pointer; }
	.tavern-card:not(.compact) {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: 7.1rem minmax(0, 1fr);
		align-content: start;
		align-items: stretch;
		gap: 0.45rem;
		min-height: 13.25rem;
		padding: 0.62rem;
	}
	.card-art {
		display: grid;
		place-items: center;
		width: 3.2rem;
		height: 3.8rem;
		padding: 0.1rem;
		border: 1px solid currentColor;
		border-radius: 0.48rem;
		color: var(--card-accent, #e4c27b);
		background: linear-gradient(145deg, rgb(255 236 183 / 11%), rgb(18 14 10 / 30%));
		box-shadow: inset 0 0 0 2px rgb(22 17 11 / 46%), 0 0.2rem 0.35rem rgb(0 0 0 / 24%);
	}
	.tavern-card:not(.compact) .card-art { width: 100%; height: 7.1rem; border-radius: 0.55rem; }
	.card-art :global(svg) { width: 100%; height: 100%; }
	.card-copy { display: grid; gap: 0.3rem; min-width: 0; }
	.tavern-card:not(.compact) .card-copy { align-content: space-between; gap: 0.18rem; padding: 0.05rem 0.1rem 0; }
	.card-eyebrow {
		color: var(--card-accent, #e4c27b);
		font: 600 0.62rem/1.25 'Cinzel', Georgia, serif;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.tavern-card:not(.compact) .card-eyebrow { overflow: hidden; font-size: 0.57rem; letter-spacing: 0.055em; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
	.card-copy strong { font: 600 0.88rem/1.25 'Cinzel', Georgia, serif; }
	.tavern-card:not(.compact) .card-copy strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; line-clamp: 2; -webkit-line-clamp: 2; font-size: 0.82rem; line-height: 1.15; }
	.card-detail { color: #c9bd9f; font-size: 0.72rem; line-height: 1.4; }
	.tavern-card:not(.compact) .card-detail { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; line-clamp: 2; -webkit-line-clamp: 2; font-size: 0.68rem; line-height: 1.25; overflow-wrap: anywhere; }
	.card-quantity {
		position: absolute;
		top: 0.5rem;
		right: 0.6rem;
		padding: 0.12rem 0.38rem;
		border: 1px solid rgb(226 194 123 / 60%);
		border-radius: 99px;
		background: #17130e;
		color: #f3dda5;
		font-size: 0.7rem;
	}
	.card-charm { --card-accent: #e6c17a; }
	.card-insight { --card-accent: #91c7c5; }
	.card-flirt { --card-accent: #e39a9f; }
	.card-rumor { --card-accent: #b6a0d3; }
	.card-food { --card-accent: #e3a66d; }
	.card-beverage { --card-accent: #88b8dc; }
	@keyframes compact-selected-float {
		0%, 100% { transform: translateY(-0.35rem); }
		50% { transform: translateY(calc(-0.35rem - 1.5px)); }
	}
	button.tavern-card:hover:not(:disabled) { transform: translateY(-0.25rem) rotate(0deg); border-color: var(--card-accent); }
	.tavern-card.selected { transform: translateY(-0.35rem) rotate(0deg); border-color: var(--card-accent); box-shadow: 0 0 0 2px rgb(240 210 122 / 34%), 0 0.75rem 1.3rem rgb(0 0 0 / 30%); }
	.tavern-card.bar-hand { width: clamp(10rem, 14vw, 12.4rem); min-height: 13.25rem; flex: 0 0 clamp(10rem, 14vw, 12.4rem); grid-template-rows: 6.4rem minmax(0, 1fr); align-self: end; gap: 0.3rem; padding: 0.55rem; scroll-snap-align: center; }
	button.tavern-card.bar-hand { transform: translateY(clamp(-3rem, var(--hand-lift, 0px), 0px)) rotate(clamp(-18deg, var(--hand-angle, 0deg), 18deg)); transform-origin: 50% 108%; transition: transform 150ms ease, opacity 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
	.tavern-card.bar-hand .card-art { width: 100%; height: 6.4rem; }
	.tavern-card.bar-hand .card-copy { align-content: start; gap: 0.2rem; }
	.tavern-card.bar-hand .card-copy strong { font-size: 0.8rem; }
	.tavern-card.bar-hand .card-detail { font-size: 0.64rem; line-height: 1.3; }
	button.tavern-card.bar-hand:hover:not(:disabled), button.tavern-card.bar-hand.selected { transform: translateY(calc(clamp(-3rem, var(--hand-lift, 0px), 0px) - 0.45rem)) rotate(0deg); }
	.tavern-card.compact.selected:not(button) { animation: compact-selected-float 3.8s ease-in-out infinite; }
	.tavern-card:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
	.tavern-card:disabled { cursor: not-allowed; opacity: 0.62; }
	.tavern-card.bar-hand[aria-disabled="true"] { cursor: not-allowed; }
	.tavern-card.compact { min-height: 0; padding: 0.55rem 0.65rem; border-radius: 0.65rem; grid-template-columns: 2.4rem minmax(0, 1fr); gap: 0.5rem; }
	.compact .card-art { width: 2.4rem; height: 2.7rem; }
	.compact .card-copy { gap: 0.15rem; }
	.compact .card-copy strong { font-size: 0.78rem; }
	.compact .card-detail { font-size: 0.68rem; }
	@media (max-width: 1000px) {
		.tavern-card.bar-hand { width: clamp(10.625rem, 45vw, 12.25rem); min-height: 11rem; flex-basis: clamp(10.625rem, 45vw, 12.25rem); grid-template-rows: 5.4rem minmax(0, 1fr); padding: 0.48rem; }
		.tavern-card.bar-hand .card-art { height: 5.4rem; }
		.tavern-card.bar-hand .card-eyebrow { font-size: 0.58rem; }
		.tavern-card.bar-hand .card-copy strong { font-size: 0.75rem; }
		.tavern-card.bar-hand .card-detail { font-size: 0.67rem; }
		button.tavern-card.bar-hand { transform: translateY(clamp(-1.2rem, var(--hand-lift, 0px), 0px)) rotate(clamp(-11deg, var(--hand-angle, 0deg), 11deg)); }
		button.tavern-card.bar-hand:hover:not(:disabled), button.tavern-card.bar-hand.selected { transform: translateY(calc(clamp(-1.2rem, var(--hand-lift, 0px), 0px) - 0.35rem)) rotate(0deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		.tavern-card { transition: none; }
		button.tavern-card.bar-hand, button.tavern-card.bar-hand:hover:not(:disabled), button.tavern-card.bar-hand.selected { transform: none; }
		.tavern-card.compact.selected:not(button) { animation: none; transform: none; }
		button.tavern-card:hover:not(:disabled), .tavern-card.selected { transform: none; }
	}
</style>
