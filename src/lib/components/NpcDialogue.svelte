<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import NpcHistory from '$lib/components/tavern/NpcHistory.svelte';
	import ResidentExchange from '$lib/components/tavern/ResidentExchange.svelte';
	import ServiceCardHand from '$lib/components/tavern/ServiceCardHand.svelte';
	import TavernCard from '$lib/components/tavern/TavernCard.svelte';
	import type { TavernCardChoice, TavernCardKind } from '$lib/components/tavern/card-types';
	import { serviceCardStacks } from '$lib/game/service-cards';
	import { qualityLabel, type IntentCardKey } from '$lib/game/contracts';
	import { resolveBurnAction, type BurnStyle, type BurnTreatment } from '$lib/card-effects';
	import type { DialogueInput, Journal, Offering } from '$lib/game/dialogue';
	import type { BarSnapshot, ServeReceipt } from '$lib/game/serving';

	type BurningCard = {
		turnId: string;
		itemId: string;
		choice: TavernCardChoice;
		index: number;
		treatment: BurnTreatment;
		durationMs: number;
	};

	let {
		npcId,
		name,
		journal,
		stock,
		instanceId,
		saveId = '',
		history,
		unavailable,
		archiveHref = null,
		archived = false,
		embedded = false,
		journalOnly = false,
		blocked = false,
		focusActive = true,
		barHand = false,
		cardBurnStyle = 'drip',
		suspended = false,
		composerOpen = false,
		deckOpen = false,
		onbusychange,
		oncomposerchange,
		ondeckchange,
		onselectionchange
	}: {
		npcId: string;
		instanceId?: string;
		saveId?: string;
		name: string;
		journal: Journal;
		history?: ServeReceipt[];
		stock: BarSnapshot;
		unavailable: string | null;
		archiveHref?: string | null;
		archived?: boolean;
		embedded?: boolean;
		journalOnly?: boolean;
		blocked?: boolean;
		focusActive?: boolean;
		barHand?: boolean;
		cardBurnStyle?: BurnStyle;
		suspended?: boolean;
		composerOpen?: boolean;
		deckOpen?: boolean;
		onbusychange?: (busy: boolean) => void;
		oncomposerchange?: (open: boolean) => void;
		ondeckchange?: (open: boolean) => void;
		onselectionchange?: (selected: boolean) => void;
	} = $props();

	const residentKey = $derived(instanceId ?? journal.instanceId);
	const residentHistory = $derived(history ?? stock.history);
	const messageFieldId = $derived(`npc-message-${safeId(residentKey)}`);
	const dialogueHeadingId = $derived(`npc-dialogue-heading-${safeId(residentKey)}`);
	const draftKey = $derived(`byrook:bar-draft:${saveId}:${residentKey}`);

	let message = $state('');
	let intentCardId = $state('');
	let offeringSelection = $state('');
	let busy = $state(false);
	let frozen = $state<DialogueInput | null>(null);
	let notice = $state('');
	let failure = $state(false);
	let hydrated = $state(false);
	let draftLoaded = $state(false);
	let restoredTurn = $state<string | null>(null);
	let cancelling = $state(false);
	let canRetry = $state(true);
	let burningCard = $state<BurningCard | null>(null);
	let nextCardFocusIndex = $state<number | null>(null);
	let composerOpenLocal = $state(false);
	let deckOpenLocal = $state(false);
	const handOpen = $derived(deckOpenLocal && (!barHand || focusActive));
	const conversationVisible = $derived(composerOpenLocal && !suspended);
	let operation = 0;
	let posting: AbortController | undefined;
	let lastBurnedTurnId: string | null = null;
	let observedResidentKey: string | undefined;

	$effect(() => {
		composerOpenLocal = composerOpen;
		if (!composerOpen && burningCard) cancelBurn();
	});
	$effect(() => { deckOpenLocal = deckOpen; });
	$effect(() => {
		if (observedResidentKey === undefined) {
			observedResidentKey = residentKey;
			return;
		}
		if (observedResidentKey === residentKey) return;
		observedResidentKey = residentKey;
		cancelBurn();
		nextCardFocusIndex = null;
		lastBurnedTurnId = null;
	});
	$effect(() => { onbusychange?.(busy || frozen !== null); });
	$effect(() => { onselectionchange?.(!!intentCardId || !!offeringSelection); });
	$effect(() => {
		if (!focusActive) {
			setDeckOpen(false);
			setComposerOpen(false);
			if (!frozen) clearChoice();
		}
	});
	$effect(() => {
		if (hydrated && journal.pending && journal.pending.turnId !== restoredTurn && !frozen) {
			restoredTurn = journal.pending.turnId;
			void recover(journal.pending.turnId);
		}
	});
	$effect(() => {
		const key = draftKey;
		const draft = message;
		if (!draftLoaded || !key || typeof window === 'undefined') return;
		try {
			if (draft) window.sessionStorage.setItem(key, draft);
			else window.sessionStorage.removeItem(key);
		} catch {
			// The in-memory draft remains available when browser storage is disabled.
		}
	});

	onMount(() => {
		try {
			if (!journal.pending) message = window.sessionStorage.getItem(draftKey) ?? '';
		} catch {
			// The composer still works without session storage.
		}
		draftLoaded = true;
		hydrated = true;
	});
	onDestroy(() => {
		cancelBurn();
		onbusychange?.(false);
	});

	let intentOptions = $derived.by(() => {
		const grouped = new Map<string, { card: (typeof stock.intentCards)[number]; count: number; ids: string[] }>();
		const tiersByName = new Map<string, Set<string>>();
		for (const card of stock.intentCards) {
			const nameKey = JSON.stringify([card.cardKey, card.displayName]);
			const tiers = tiersByName.get(nameKey) ?? new Set<string>();
			tiers.add(card.tier);
			tiersByName.set(nameKey, tiers);
			const key = JSON.stringify([card.cardKey, card.displayName, card.description, card.tier]);
			const existing = grouped.get(key);
			if (existing) {
				existing.count += 1;
				existing.ids.push(card.id);
			} else {
				grouped.set(key, { card, count: 1, ids: [card.id] });
			}
		}
		return [...grouped.entries()].map(([key, option]) => ({
			key,
			...option,
			label: (tiersByName.get(JSON.stringify([option.card.cardKey, option.card.displayName]))?.size ?? 0) > 1
				? `${option.card.displayName} · ${tierLabel(option.card.tier)}`
				: option.card.displayName
		}));
	});
	let serviceStacks = $derived(serviceCardStacks([...stock.beverages, ...stock.foods]));
	let cardChoices = $derived.by((): TavernCardChoice[] => [
		...intentOptions.map((option) => ({
			key: `intent:${option.key}`,
			kind: option.card.cardKey as IntentCardKey,
			itemIds: option.ids,
			title: option.label,
			eyebrow: `${titleCase(option.card.cardKey)} · ${tierLabel(option.card.tier)}`,
			detail: option.card.description,
			quantity: option.count
		})),
		...serviceStacks.map((stack) => ({
			key: `service:${stack.key}`,
			kind: stack.kind as TavernCardKind,
			itemIds: stack.itemIds,
			title: stack.name,
			eyebrow: stack.kind === 'food' ? 'From the kitchen' : 'From the cellar',
			detail: `${stack.ingredientName} · ${qualityLabel(stack.qualityIndex)}`,
			quantity: stack.quantity
		}))
	]);
	let selectedIntent = $derived(stock.intentCards.find((card) => card.id === intentCardId));
	let selectedOffering = $derived(offeringSelection
		? [...stock.beverages, ...stock.foods].find((item) => `${item.kind}:${item.id}` === offeringSelection)
		: undefined);
	let selectedItemId = $derived(intentCardId || (offeringSelection ? offeringSelection.slice(offeringSelection.indexOf(':') + 1) : ''));
	let selectedChoice = $derived(cardChoices.find((choice) => choice.itemIds.includes(selectedItemId)));
	let staleSelection = $derived(!!selectedItemId && !selectedChoice && !frozen);
	let submitLabel = $derived(
		busy ? 'Thinking…'
			: frozen ? 'Retry the same message'
				: selectedOffering ? 'Speak & serve'
					: selectedIntent ? 'Speak with card' : 'Send message'
	);
	let submitAriaLabel = $derived(
		busy ? 'Considering your words'
			: frozen ? 'Retry the same message'
				: selectedOffering ? 'Speak & serve'
					: selectedIntent ? 'Speak with card' : 'Send message'
	);

	function safeId(value: string) {
		return value.replace(/[^a-zA-Z0-9_-]/g, '-');
	}

	function titleCase(value: string) {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	function tierLabel(tier: string) {
		return ({ fine: 'Fine', superior: 'Superior', exceptional: 'Exceptional' } as Record<string, string>)[tier] ?? tier;
	}

	function clearChoice() {
		intentCardId = '';
		offeringSelection = '';
	}

	function finishBurn(turnId: string) {
		if (burningCard?.turnId !== turnId) return;
		burningCard = null;
	}

	function cancelBurn() {
		burningCard = null;
	}

	function startBurnForCompletedTurn(command: DialogueInput) {
		if (!barHand || lastBurnedTurnId === command.turnId) return;
		const itemId = command.intentCardId ?? command.offering?.itemId;
		if (!itemId) return;
		const choice = cardChoices.find((candidate) => candidate.itemIds.includes(itemId));
		if (!choice) return;

		const index = cardChoices.findIndex((candidate) => candidate.key === choice.key);
		const { treatment, durationMs } = resolveBurnAction(cardBurnStyle);
		cancelBurn();
		burningCard = {
			turnId: command.turnId,
			itemId,
			choice: { ...choice, itemIds: [itemId], quantity: 1 },
			index,
			treatment,
			durationMs
		};
		nextCardFocusIndex = index;
		lastBurnedTurnId = command.turnId;
	}

	async function removeChoice() {
		clearChoice();
		await focusComposer();
	}

	async function dismissCardFromDeck() {
		clearChoice();
		if (!barHand) setDeckOpen(false);
		setComposerOpen(true);
		await focusComposer();
	}

	function setComposerOpen(open: boolean) {
		if (!open) cancelBurn();
		composerOpenLocal = open;
		oncomposerchange?.(open);
	}

	function setDeckOpen(open: boolean) {
		deckOpenLocal = open;
		ondeckchange?.(open);
	}

	async function focusControl(name: 'talk' | 'deck') {
		await tick();
		if (typeof document !== 'undefined') {
			if (barHand) {
				const handCard = document.querySelector<HTMLElement>(
					'.service-card-hand.bar-hand [data-card-index][aria-pressed="true"]'
				) ?? (nextCardFocusIndex !== null
					? document.querySelector<HTMLElement>(`.service-card-hand.bar-hand [data-card-index="${nextCardFocusIndex}"]:not([data-card-burn-active="true"])`)
					: null) ?? document.querySelector<HTMLElement>('.service-card-hand.bar-hand [data-card-index]:not([data-card-burn-active="true"])');
				handCard?.focus({ preventScroll: true });
				return;
			}
			document.querySelector<HTMLElement>(`[data-bar-control="${name}"]`)?.focus();
		}
	}

	async function closeComposer() {
		setComposerOpen(false);
		await focusControl('talk');
	}

	function handleEscape(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (barHand) {
			cancelBurn();
			return;
		}
		if (deckOpenLocal) {
			event.preventDefault();
			event.stopPropagation();
			setDeckOpen(false);
			void focusControl('deck');
		} else if (composerOpenLocal) {
			event.preventDefault();
			event.stopPropagation();
			void closeComposer();
		}
	}

	async function changeCard() {
		setComposerOpen(false);
		setDeckOpen(true);
		await focusControl('deck');
	}

	async function returnToTalk() {
		setDeckOpen(false);
		setComposerOpen(true);
		await focusComposer();
	}

	async function focusComposer() {
		await tick();
		if (typeof document !== 'undefined') {
			const field = document.getElementById(messageFieldId) as HTMLTextAreaElement | null;
			if (field && !field.matches(':disabled')) field.focus();
			else if (barHand) document.querySelector<HTMLElement>('.patron-dialogue.bar-hand .close-composer')?.focus();
		}
	}

	async function resumeConversation() {
		setComposerOpen(true);
		await focusComposer();
	}

	async function chooseCard(choice: TavernCardChoice) {
		if (blocked || busy || frozen) return;
		const itemId = choice.itemIds[0];
		if (!itemId) return;
		nextCardFocusIndex = cardChoices.findIndex((candidate) => candidate.key === choice.key);
		if (choice.kind === 'food' || choice.kind === 'beverage') {
			intentCardId = '';
			offeringSelection = `${choice.kind}:${itemId}`;
		} else {
			intentCardId = itemId;
			offeringSelection = '';
		}
		if (!barHand) setDeckOpen(false);
		setComposerOpen(true);
		await focusComposer();
	}

	async function acceptStatus(body: any, completedNotice = 'Your last reply was saved.') {
		failure = false;
		if (body.status === 'completed') {
			if (frozen) startBurnForCompletedTurn(frozen);
			const completedBurn = burningCard;
			frozen = null;
			message = '';
			clearChoice();
			notice = typeof body.reply === 'string' && body.reply.trim()
				? `${name}: ${body.reply}`
				: completedNotice;
			await invalidateAll();
			if (completedBurn && burningCard?.turnId === completedBurn.turnId && cardChoices.length > 0) {
				nextCardFocusIndex = Math.min(completedBurn.index, cardChoices.length - 1);
			}
		} else if (body.status === 'cancelled' || body.status === 'stale') {
			frozen = null;
			notice = body.status === 'cancelled'
				? 'Unfinished message cancelled. You can edit it and try again.'
				: 'That message is closed. You can edit it and start a new conversation.';
			await invalidateAll();
		} else {
			frozen = body.input;
			message = body.input.message;
			intentCardId = body.input.intentCardId ?? '';
			offeringSelection = body.input.offering
				? `${body.input.offering.kind}:${body.input.offering.itemId}`
				: '';
			canRetry = body.canRetry ?? body.status !== 'processing';
			notice = body.status === 'processing'
				? 'Your conversation is still being completed. Check again shortly.'
				: canRetry
					? 'The last reply was not completed. Retry the same message or cancel it.'
					: 'This reply cannot be resumed. Cancel the unfinished message, then edit it before sending again.';
		}
	}

	async function recover(id: string) {
		if (blocked || busy) return;
		const current = ++operation;
		busy = true;
		failure = false;
		try {
			const response = await fetch(`/api/dialogue/${id}`);
			const body = await response.json();
			if (current !== operation) return;
			if (!response.ok) throw new Error(body.message);
			await acceptStatus(body);
		} catch {
			if (current === operation) {
				notice = 'The conversation could not be checked. Please retry.';
				failure = true;
			}
		} finally {
			if (current === operation) busy = false;
		}
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (blocked || busy || (frozen && !canRetry)) return;
		if (!frozen) canRetry = true;
		const [offeringKind, offeringId] = offeringSelection.split(':', 2);
		const offering: Offering | null = offeringId && (offeringKind === 'food' || offeringKind === 'beverage')
			? { kind: offeringKind, itemId: offeringId }
			: null;
		frozen ??= {
			turnId: crypto.randomUUID(),
			npcId,
			message,
			expectedConversationSequence: journal.sequence,
			interactionVersion: 'dialogue-v2',
			intentCardId: intentCardId || null,
			offering
		};
		const command = frozen as DialogueInput;
		const current = ++operation;
		const controller = new AbortController();
		posting = controller;
		busy = true;
		notice = '';
		failure = false;
		try {
			const response = await fetch('/api/dialogue', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(command),
				signal: controller.signal
			});
			const body = await response.json();
			if (current !== operation) return;
			if (!response.ok) {
				canRetry = !['CONSISTENCY', 'CONTEXT_BUDGET'].includes(body.code);
				if ([400, 409, 422].includes(response.status)) {
					// Only a confirmed closure (or a missing turn after POST has finished) releases the command.
					const closed = await fetch(`/api/dialogue/${command.turnId}`, { method: 'DELETE' });
					if (current !== operation) return;
					if (closed.ok) {
						const status = await closed.json();
						await acceptStatus(status);
						if (status.status === 'completed') return;
					} else if (closed.status === 404) {
						frozen = null;
						await invalidateAll();
					}
				}
				throw new Error(body.message);
			}
			if (body.status === 'completed') await acceptStatus(body, 'Reply saved.');
			else {
				canRetry = false;
				notice = 'Your conversation is still being completed. Check again shortly.';
			}
		} catch (cause) {
			if (current === operation) {
				failure = true;
				notice = cause instanceof Error
					? cause.message
					: 'The result is unknown. Check the conversation before retrying.';
			}
		} finally {
			if (posting === controller) posting = undefined;
			if (current === operation) busy = false;
		}
	}

	async function cancel() {
		if (blocked || !frozen || cancelling) return;
		const command = frozen;
		const current = ++operation;
		const pendingPost = posting;
		busy = true;
		cancelling = true;
		failure = false;
		try {
			const response = await fetch(`/api/dialogue/${command.turnId}`, { method: 'DELETE' });
			const body = await response.json();
			if (!response.ok || !['completed', 'cancelled', 'stale'].includes(body.status)) throw new Error();
			// Fence the server turn first. Aborting the browser request alone cannot cancel a generation.
			pendingPost?.abort();
			await acceptStatus(body);
		} catch {
			failure = true;
			notice = 'Cancellation could not be confirmed. Check the reply or try cancelling again.';
		} finally {
			cancelling = false;
			if (current === operation) busy = false;
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape closes the active dialogue surface and restores its scene opener.) -->
<section
	class="patron-dialogue"
	class:embedded
	class:journal-only={journalOnly}
	class:bar-hand={barHand}
	class:suspended
	data-next-card-focus-index={nextCardFocusIndex}
	aria-labelledby={dialogueHeadingId}
	onkeydown={handleEscape}
>
	<h2 id={dialogueHeadingId} class="sr-only">{journalOnly ? `History for ${name}` : `Talk with ${name}`}</h2>

	{#if journalOnly}
		<NpcHistory {name} {journal} history={residentHistory} instanceId={residentKey} {archiveHref} />
	{:else if journal.availability !== 'present' || archived}
		<div class="dialogue-unavailable" role="status">
			<p class="dialogue-eyebrow">{archived ? 'Read-only archive' : journal.availability === 'dead' ? 'In memory' : journal.availability === 'departed' ? 'Departed' : 'Unavailable'}</p>
			<p>{name} is not available for a new conversation. Their story remains in the tavern history.</p>
		</div>
	{:else}
		{#if handOpen}
			{#if staleSelection && !barHand}
				<div class="stale-selection-note" role="alert">
					<p>{offeringSelection ? 'The selected item left your hand and has not been replaced. Choose a card below or remove it.' : 'The selected card left your hand and has not been replaced. Choose a card below or remove it.'}</p>
					<div class="stale-selection-actions">
						<button type="button" class="dialogue-action" disabled={busy || blocked} onclick={dismissCardFromDeck}>Remove unavailable card</button>
					</div>
				</div>
			{/if}
			<ServiceCardHand
				choices={cardChoices}
				{selectedItemId}
				{barHand}
				conversationOpen={conversationVisible}
				burningCard={burningCard}
				disabled={blocked || busy || !!frozen}
				onselect={chooseCard}
				onclose={returnToTalk}
				onburncomplete={finishBurn}
			/>
			{#if barHand && !conversationVisible && !suspended && (busy || frozen)}
				<button type="button" class="bar-resume-chat" disabled={blocked} onclick={resumeConversation}>Return to unfinished reply</button>
			{/if}
			{#if barHand && !conversationVisible && !suspended && notice}
				<p class="form-message bar-hand-notice" class:error={failure} role={failure ? 'alert' : 'status'}>{notice}</p>
			{/if}
		{/if}

		{#if conversationVisible}
			<section class="dialogue-surface" class:bar-chat={barHand} aria-labelledby={`${dialogueHeadingId}-talk`}>
				<header class="composer-heading">
					<div>
					<p class="dialogue-eyebrow">{barHand && selectedChoice ? `${selectedChoice.eyebrow} · with ${name}` : `A word with ${name}`}</p>
					<h2 id={`${dialogueHeadingId}-talk`}>{barHand && selectedChoice ? selectedChoice.title : 'Talk'}</h2>
				</div>
				<button type="button" class="dialogue-action close-composer" onclick={closeComposer}>{barHand ? 'Close conversation' : 'Close talk'}</button>
			</header>

			{#if unavailable}<p class="form-message provider-notice" role="note">{unavailable}</p>{/if}

				{#if selectedChoice}
					{#if barHand}
						<div class="bar-card-context" aria-label="Card attached to this conversation">
							<span>{selectedChoice.detail}</span>
							<button type="button" class="dialogue-action remove-card" disabled={!!frozen || busy || blocked} onclick={removeChoice}>Remove card</button>
						</div>
					{:else}
						<div class="selected-card-row" aria-label="Card attached to this conversation">
							<TavernCard choice={selectedChoice} selected={true} interactive={false} compact={true} />
							<button type="button" class="dialogue-action remove-card" disabled={!!frozen || busy || blocked} onclick={removeChoice}>Remove card</button>
						</div>
					{/if}
					{#if selectedOffering}
						<p class="service-consumption-note">One {selectedOffering.name} will be consumed if this reply succeeds.</p>
					{/if}
				{:else if frozen && selectedItemId}
					<p class="locked-card-note" role="note">The exact selected card is held for this unfinished reply.</p>
				{:else if staleSelection}
					<div class="stale-selection-note" role="alert">
						<p>{offeringSelection ? 'That item is no longer in your hand. It has not been replaced with another item.' : 'That card is no longer in your hand. It has not been replaced with another card.'}</p>
						<div class="stale-selection-actions">
							<button type="button" class="dialogue-action" disabled={busy || blocked} onclick={removeChoice}>Dismiss unavailable card</button>
							{#if !barHand}<button type="button" class="dialogue-action" disabled={busy || blocked} onclick={changeCard}>Choose another card</button>{/if}
						</div>
					</div>
				{/if}

				{#if barHand}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                    <div class="conversation-reading" role="log" aria-label={`Conversation with ${name}`} tabindex="0">
                        {#if journal.turns.length}
                            <ResidentExchange {name} turn={journal.turns[journal.turns.length - 1]} />
                        {:else}
                            <p class="first-conversation">Ask about their plans, share advice, or simply get to know them.</p>
                        {/if}
                    </div>
                {:else if journal.turns.length === 0}
                    <p class="first-conversation">Ask about their plans, share advice, or simply get to know them.</p>
                {/if}

			<form onsubmit={send} class="dialogue-form">
				<fieldset disabled={!hydrated || busy || !!unavailable || blocked}>
					<legend class="sr-only">Compose a message to {name}</legend>
					<label for={messageFieldId} class="sr-only">Your message to {name}</label>
					<div class="dialogue-composer-row">
						<textarea
							id={messageFieldId}
							rows="2"
							maxlength="2000"
							required
							disabled={!!frozen}
							bind:value={message}
							placeholder="Say something…"
						></textarea>
						<button
							class="composer-send"
							aria-label={submitAriaLabel}
							disabled={!hydrated || busy || !!unavailable || blocked || (!!frozen && !canRetry) || (!frozen && !message.trim()) || staleSelection}
						>
							<span>{!hydrated ? 'Opening…' : submitLabel}</span>
						</button>
					</div>
				</fieldset>
				{#if frozen}
					<div class="recovery-actions">
						<button type="button" class="dialogue-action" disabled={busy || blocked} onclick={() => recover(frozen!.turnId)}>Check reply</button>
						<button type="button" class="dialogue-action" disabled={cancelling || blocked} onclick={cancel}>{cancelling ? 'Cancelling…' : 'Cancel unfinished message'}</button>
					</div>
					{/if}
				</form>
				{#if barHand && notice}
					<p class="form-message dialogue-notice" class:error={failure} role={failure ? 'alert' : 'status'}>{notice}</p>
				{/if}
			</section>
		{/if}
	{/if}

	{#if !barHand && !journalOnly && notice}
		<p class="form-message dialogue-notice" class:error={failure} role={failure ? 'alert' : 'status'}>{notice}</p>
	{/if}
</section>

<style>
	.patron-dialogue { min-width: 0; color: #eee2c3; }
	.patron-dialogue.bar-hand { position: absolute; z-index: 24; inset: 0; width: 100%; overflow: visible; pointer-events: none; }
	.bar-hand :global(.service-card-hand.bar-hand) { position: absolute; z-index: 28; right: 0; bottom: 1.5rem; left: 0; margin-inline: auto; pointer-events: auto; animation: hand-rise 320ms cubic-bezier(.2, .75, .25, 1) both; }
	.dialogue-surface { min-width: 0; animation: surface-enter 150ms ease-out both; }
	.bar-hand .dialogue-surface.bar-chat { position: absolute; z-index: 40; bottom: 1rem; left: 50%; display: flex; width: min(700px, 76vw); height: min(19.375rem, 48vh); min-height: min(14rem, calc(100% - 1rem)); max-height: calc(100% - 1rem); flex-direction: column; gap: 0.35rem; overflow-x: hidden; overflow-y: auto; padding: 0.62rem 0.72rem; transform: translateX(-50%); border: 1px solid #e0c783; border-radius: 0.7rem; background: linear-gradient(165deg, rgb(50 38 19 / 0.82), rgb(22 16 9 / 0.82)); box-shadow: 0 9px 25px rgb(0 0 0 / 0.48), inset 0 1px 0 rgb(255 230 170 / 0.06); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); pointer-events: auto; animation: bar-chat-rise 240ms cubic-bezier(.2, .75, .25, 1) both; }
	.bar-chat .composer-heading { flex: 0 0 auto; gap: 0.5rem; padding-bottom: 0.35rem; }
	.bar-chat .composer-heading h2 { overflow: hidden; color: #ffe39a; font-size: 0.9rem; text-overflow: ellipsis; white-space: nowrap; }
	.bar-chat .dialogue-eyebrow { font-size: 0.58rem; }
	.bar-chat .close-composer { min-width: 2.75rem; min-height: 2.75rem; border: 1px solid #735a2f; border-radius: 0.4rem; text-decoration: none; }
	.bar-card-context { display: flex; min-height: 2.75rem; align-items: center; justify-content: space-between; gap: 0.5rem; color: #d4c399; font-size: 0.68rem; }
	.bar-card-context > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar-card-context .remove-card { min-height: 2.75rem; }
	.bar-chat .dialogue-action { min-height: 2.75rem; }
	.bar-chat .conversation-reading { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: .35rem .1rem; }
	.bar-chat .conversation-reading:focus-visible { outline: 2px solid #ffe49c; outline-offset: -2px; }
	.bar-chat .dialogue-form { flex: 0 0 auto; margin-top: auto; }
	.bar-chat .dialogue-composer-row { gap: 0.45rem; }
	.bar-chat .dialogue-composer-row textarea { min-height: 3rem; padding: 0.55rem 0.65rem; background: rgb(16 11 7 / 0.9); }
	.bar-chat .composer-send { min-height: 2.75rem; }
	.bar-chat .first-conversation { margin: 0.2rem 0; font-size: 0.74rem; }
	.bar-chat .service-consumption-note { margin: 0; font-size: 0.68rem; }
	.bar-chat .form-message { margin: 0; font-size: 0.7rem; }
	.bar-resume-chat { position: absolute; z-index: 36; right: max(4%, calc((100% - 76rem) / 2 + 0.65rem)); bottom: calc(1.5rem + 18rem + 0.3rem); min-height: 2.75rem; padding: 0.4rem 0.75rem; border: 1px solid #b4914c; border-radius: 0.45rem; color: #f5e9c9; background: rgb(19 14 8 / 0.92); font: inherit; font-size: 0.74rem; cursor: pointer; pointer-events: auto; }
	.bar-resume-chat:hover:not(:disabled) { border-color: #ffe08a; color: #fff0bc; }
	.bar-resume-chat:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
	.bar-resume-chat:disabled { opacity: 0.5; cursor: not-allowed; }
	.bar-hand-notice { position: absolute; z-index: 35; right: 4%; bottom: calc(1.5rem + 18rem + 3.4rem); width: min(92%, 38rem); margin: 0; padding: 0.45rem 0.65rem; border: 1px solid rgb(145 112 52 / 50%); border-radius: 0.4rem; background: rgb(19 14 8 / 0.92); pointer-events: none; }
	.composer-heading { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid rgb(145 112 52 / 35%); }
	.dialogue-eyebrow { margin: 0 0 0.15rem; color: #d3b46d; font: 600 0.65rem 'Cinzel', Georgia, serif; letter-spacing: 0.08em; text-transform: uppercase; }
	.composer-heading h2 { margin: 0; font: 600 1rem 'Cinzel', Georgia, serif; }
	.dialogue-action { min-height: 2.25rem; padding: 0.25rem 0.45rem; border: 0; background: transparent; color: #e9d49f; font: inherit; font-size: 0.76rem; text-decoration: underline; text-underline-offset: 0.2em; cursor: pointer; }
	.dialogue-action:hover:not(:disabled) { color: #fff0bc; }
	.dialogue-action:disabled { opacity: 0.5; cursor: not-allowed; }
	.dialogue-action:focus-visible { outline: 2px solid #ffe49c; outline-offset: 2px; border-radius: 0.2rem; }
	.selected-card-row { display: grid; grid-template-columns: minmax(0, 14rem) auto; align-items: center; justify-content: start; gap: 0.55rem; margin: 0.65rem 0 0.35rem; animation: card-attach 160ms ease-out both; }
	.remove-card { white-space: nowrap; }
	.service-consumption-note { margin: 0 0 0.65rem 0.25rem; color: #e3ce97; font-size: 0.74rem; }
	.locked-card-note { margin: 0.65rem 0; color: #e1c983; font-size: 0.76rem; }
	.stale-selection-note { margin: 0.6rem 0; padding-left: 0.7rem; border-left: 2px solid #ac7850; color: #e7bd8a; font-size: 0.78rem; line-height: 1.45; }
	.stale-selection-note p { margin: 0; }
	.stale-selection-actions { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; margin-top: 0.25rem; }
	.first-conversation { margin: 0.6rem 0; color: #c9bd9f; font-size: 0.8rem; }
	.dialogue-form { margin-top: 0.6rem; }
	.dialogue-form fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
	.dialogue-composer-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.6rem; }
	.dialogue-composer-row textarea { width: 100%; min-height: 3.3rem; max-height: 12rem; resize: vertical; padding: 0.75rem 0.85rem; border: 1px solid rgb(171 135 72 / 48%); border-radius: 0.6rem; background: #211a12; color: #f5eddb; font: inherit; font-size: 0.9rem; line-height: 1.4; }
	.dialogue-composer-row textarea::placeholder { color: #a79b81; }
	.dialogue-composer-row textarea:focus-visible { outline: 2px solid #f0cd72; outline-offset: 2px; }
	.dialogue-composer-row textarea:disabled { opacity: 0.78; }
	.composer-send { min-width: 4.5rem; min-height: 2.8rem; padding: 0.45rem 0.8rem; border: 1px solid #9a793d; border-radius: 0.55rem; background: linear-gradient(145deg, #846333, #59411f); color: #fff0c0; font: 600 0.78rem 'Cinzel', Georgia, serif; cursor: pointer; transition: transform 140ms ease, filter 140ms ease; }
	.composer-send:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.12); }
	.composer-send:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
	.composer-send:disabled { opacity: 0.5; cursor: not-allowed; }
	.recovery-actions { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; margin-top: 0.45rem; }
	.form-message { margin: 0.6rem 0; color: #dfc58d; font-size: 0.8rem; line-height: 1.45; }
	.dialogue-notice { padding-top: 0.5rem; border-top: 1px solid rgb(145 112 52 / 25%); }
	.form-message.error { color: #f0a9a1; }
	.dialogue-unavailable { padding: 0.5rem 0; color: #c8b99a; }
	.dialogue-unavailable .dialogue-eyebrow { margin: 0 0 0.2rem; color: #dfbf78; font: 600 0.68rem 'Cinzel', Georgia, serif; text-transform: uppercase; }
	.dialogue-unavailable p:last-child { margin: 0; font-size: 0.84rem; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@keyframes surface-enter { from { opacity: 0; transform: translateY(0.3rem); } to { opacity: 1; transform: translateY(0); } }
	@keyframes card-attach { from { opacity: 0; transform: translateY(0.3rem); } to { opacity: 1; transform: translateY(0); } }
	@keyframes hand-rise { from { opacity: 0; translate: 0 6rem; } to { opacity: 1; translate: 0 0; } }
	@keyframes bar-chat-rise { from { opacity: 0; transform: translate(-50%, 3rem); } to { opacity: 1; transform: translate(-50%, 0); } }
	@media (max-width: 1000px) {
		.bar-hand :global(.service-card-hand.bar-hand) { bottom: 1.25rem; }
		.bar-hand .dialogue-surface.bar-chat { bottom: 0.65rem; width: 92%; height: min(18rem, 46vh); min-height: min(13rem, calc(100% - 0.5rem)); max-height: calc(100% - 0.5rem); padding: 0.48rem 0.55rem; }
		.bar-resume-chat { right: 0.7rem; bottom: calc(1.25rem + 14rem + 0.25rem); }
		.bar-hand-notice { right: 4%; bottom: calc(1.25rem + 14rem + 3.35rem); }
	}
	@media (max-width: 520px) {
		.dialogue-composer-row { grid-template-columns: minmax(0, 1fr); }
		.composer-send { justify-self: end; min-width: 5rem; }
		.selected-card-row { grid-template-columns: minmax(0, 1fr) auto; }
		.bar-hand .dialogue-surface.bar-chat { bottom: 0.35rem; width: calc(100% - 0.7rem); height: min(18rem, 48vh); padding: 0.42rem; }
		.bar-chat .dialogue-composer-row { grid-template-columns: minmax(0, 1fr) auto; }
		.bar-chat .dialogue-composer-row textarea { min-height: 2.6rem; }
	}
	@media (prefers-reduced-motion: reduce) {
		.dialogue-surface { animation: none; }
		.selected-card-row { animation: none; }
		.composer-send { transition: none; }
		.bar-hand :global(.service-card-hand.bar-hand) { animation: entrance-fade 80ms ease-out both; }
		.bar-hand .dialogue-surface.bar-chat { animation: entrance-fade 80ms ease-out both; }
	}
	@keyframes entrance-fade { from { opacity: 0; } to { opacity: 1; } }
</style>
