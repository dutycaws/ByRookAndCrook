<script lang="ts" generics="T">
	import { onMount, tick } from 'svelte';
	import type { Snippet } from 'svelte';

	let {
		items,
		getKey,
		label,
		selectedId = null,
		muted = false,
		card
	}: {
		items: T[];
		getKey: (item: T) => string;
		label: string;
		selectedId?: string | null;
		muted?: boolean;
		card: Snippet<[T, number]>;
	} = $props();

	let viewport = $state<HTMLDivElement>();
	let slots = $state<HTMLDivElement[]>([]);
	let focusedIndex = $state(0);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);
	let reduceMotion = $state(false);

	function updateScrollHints() {
		if (!viewport) return;
		canScrollLeft = viewport.scrollLeft > 1;
		canScrollRight = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1;
	}

	function scrollToCard(index: number, behavior: ScrollBehavior = 'smooth') {
		const slot = slots[index];
		if (!viewport || !slot) return;

		const viewportRect = viewport.getBoundingClientRect();
		const slotRect = slot.getBoundingClientRect();
		const targetLeft = viewport.scrollLeft + slotRect.left - viewportRect.left - (viewport.clientWidth - slotRect.width) / 2;
		viewport.scrollTo({ left: targetLeft, behavior: reduceMotion ? 'instant' : behavior });
	}

	function focusCard(index: number) {
		if (items.length === 0) return;
		const nextIndex = Math.max(0, Math.min(index, items.length - 1));
		focusedIndex = nextIndex;
		const slot = slots[nextIndex];
		if (!slot) return;

		const target = slot.querySelector<HTMLElement>(
			'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
		);
		(target ?? slot).focus();
		scrollToCard(nextIndex);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea, [contenteditable="true"]')) return;
		if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key) || items.length === 0) return;

		const target = event.target;
		const focusedSlot = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-hand-card]') : null;
		if (!focusedSlot || !viewport?.contains(focusedSlot)) return;

		event.preventDefault();
		if (event.key === 'Home') focusCard(0);
		else if (event.key === 'End') focusCard(items.length - 1);
		else focusCard(focusedIndex + (event.key === 'ArrowRight' ? 1 : -1));
	}

	function onFocusIn(event: FocusEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const slot = target.closest<HTMLElement>('[data-hand-card]');
		if (!slot || !viewport?.contains(slot)) return;
		const index = Number(slot.dataset.handCardIndex);
		if (Number.isInteger(index)) focusedIndex = index;
	}

	function onScroll() {
		updateScrollHints();
	}

	onMount(() => {
		const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
		const syncMotionPreference = () => (reduceMotion = motionPreference.matches);
		syncMotionPreference();
		motionPreference.addEventListener('change', syncMotionPreference);

		const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateScrollHints);
		if (viewport) resizeObserver?.observe(viewport);
		void tick().then(updateScrollHints);

		return () => {
			motionPreference.removeEventListener('change', syncMotionPreference);
			resizeObserver?.disconnect();
		};
	});

	$effect(() => {
		const selectedIndex = selectedId === null ? -1 : items.findIndex((item) => getKey(item) === selectedId);
		if (selectedIndex >= 0) void tick().then(() => scrollToCard(selectedIndex));
		void tick().then(updateScrollHints);
	});

	const overlapPx = $derived(Math.min(24, Math.max(0, (items.length - 6) * 5)));
	const handSlots = $derived(
		items.map((item, index) => {
			const midpoint = (items.length - 1) / 2;
			const normalizedOffset = items.length <= 1 ? 0 : (index - midpoint) / Math.max(1, midpoint);
			const angle = normalizedOffset * (items.length <= 2 ? 5 : 10);
			const lift = items.length <= 2 ? 0 : -30 * (1 - normalizedOffset ** 2);
			const mobileAngle = normalizedOffset * 4;
			const mobileLift = items.length <= 2 ? 0 : -5 * (1 - normalizedOffset ** 2);
			return {
				item,
				index,
				key: getKey(item),
				selected: getKey(item) === selectedId,
				style: `--hand-index:${index};--hand-angle:${angle}deg;--hand-lift:${lift}px;--hand-mobile-angle:${mobileAngle}deg;--hand-mobile-lift:${mobileLift}px;--hand-overlap:${overlapPx}px;--hand-count:${items.length};`
			};
		})
	);
</script>

<div
	class="card-hand"
	class:muted
	class:can-scroll-left={canScrollLeft}
	class:can-scroll-right={canScrollRight}
	data-card-hand
	data-card-hand-count={items.length}
	role="toolbar"
	tabindex="-1"
	aria-label={label}
	onkeydown={onKeydown}
	onfocusin={onFocusIn}
>
	<div
		bind:this={viewport}
		class="card-hand-viewport"
		role="list"
		aria-label={label}
		tabindex="-1"
		onscroll={onScroll}
	>
		{#each handSlots as slot (slot.key)}
			<div
				bind:this={slots[slot.index]}
				class="card-hand-slot"
				class:selected={slot.selected}
				role="listitem"
				aria-current={slot.selected ? 'true' : undefined}
				data-hand-card
				data-hand-card-index={slot.index}
				data-hand-card-key={slot.key}
				tabindex="-1"
				style={slot.style}
			>
				{@render card(slot.item, slot.index)}
			</div>
		{/each}
	</div>
</div>

<style>
	.card-hand {
		--hand-card-width: 11rem;
		position: relative;
		min-width: 0;
	}

	.card-hand-viewport {
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-inline: contain;
		scrollbar-width: thin;
		scrollbar-color: rgb(190 154 83 / 65%) transparent;
		scroll-snap-type: x proximity;
		-webkit-overflow-scrolling: touch;
	}

	.card-hand-viewport:focus-visible {
		outline: 2px solid #ffe49c;
		outline-offset: 2px;
	}

	.card-hand-viewport[role='list'] {
		display: flex;
		align-items: flex-end;
		justify-content: safe center;
		gap: .8rem;
		padding: 3.5rem 3rem 1.2rem;
	}

	.card-hand-slot {
		position: relative;
		z-index: var(--hand-index, 0);
		flex: 0 0 var(--hand-card-width);
		width: var(--hand-card-width);
		min-width: 0;
		scroll-snap-align: center;
		transform: translateY(var(--hand-lift, 0px)) rotate(var(--hand-angle, 0deg));
		transform-origin: 50% 108%;
		transition: transform 170ms ease, opacity 170ms ease;
	}

	.card-hand-slot + .card-hand-slot {
		margin-inline-start: calc(0px - var(--hand-overlap, 0px));
	}

	.card-hand-slot.selected,
	.card-hand-slot:focus-within {
		z-index: 100;
		transform: translateY(calc(var(--hand-lift, 0px) - 1.25rem)) rotate(0deg);
	}

	.card-hand-slot:hover {
		z-index: 90;
		transform: translateY(calc(var(--hand-lift, 0px) - 0.65rem)) rotate(0deg);
	}

	.muted .card-hand-slot:not(.selected) { opacity: .76; }
	.can-scroll-left::before,
	.can-scroll-right::after {
		position: absolute;
		z-index: 110;
		top: 0;
		bottom: .8rem;
		width: 1rem;
		content: '';
		pointer-events: none;
	}
	.can-scroll-left::before { left: 0; background: linear-gradient(90deg, rgb(20 16 12 / 46%), transparent); }
	.can-scroll-right::after { right: 0; background: linear-gradient(270deg, rgb(20 16 12 / 46%), transparent); }

	@media (max-width: 700px) {
		.card-hand { --hand-card-width: 8.75rem; }
		.card-hand-viewport[role='list'] {
			justify-content: flex-start;
			padding: 1.6rem 3rem 1rem;
		}
		.card-hand-slot + .card-hand-slot { margin-inline-start: 0; }
		.card-hand-viewport[role='list'] { gap: .6rem; }
		.card-hand-slot {
			transform: translateY(clamp(-.35rem, var(--hand-mobile-lift, 0px), 0px)) rotate(clamp(-5deg, var(--hand-mobile-angle, 0deg), 5deg));
		}
		.card-hand-slot.selected,
		.card-hand-slot:focus-within {
			transform: translateY(calc(clamp(-.35rem, var(--hand-mobile-lift, 0px), 0px) - .5rem)) rotate(0deg);
		}
		.card-hand-slot:hover {
			transform: translateY(calc(clamp(-.35rem, var(--hand-mobile-lift, 0px), 0px) - .3rem)) rotate(0deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card-hand-slot { transition: none; }
	}
</style>
