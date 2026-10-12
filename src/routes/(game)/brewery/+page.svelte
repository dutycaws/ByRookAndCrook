<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, tick } from 'svelte';
  import CardWorkflowFrame from '$lib/components/ui/CardWorkflowFrame.svelte';
  import WorkflowHand from '$lib/components/ui/WorkflowHand.svelte';
  import WorkflowInspection from '$lib/components/ui/WorkflowInspection.svelte';
  import AcquisitionReveal from '$lib/components/ui/AcquisitionReveal.svelte';
  import type { WorkflowChoice } from '$lib/components/ui/workflow';
  import { resolveBurnAction, waitForBurn, type ResolvedBurnAction } from '$lib/card-effects';
  import BreweryScene from '$lib/components/scenes/BreweryScene.svelte';
  import { qualityLabel, type CompleteBrewReceipt } from '$lib/game/contracts';
  import { brewAcquisitionCard, claimAcquisitionReceipt, type AcquisitionCard } from '$lib/game/acquisition';
  import {
    clamp,
    shortestAngleDelta,
    type GuidedStirPerformance,
    type GuidedStirTelemetry
  } from '$lib/game/scene-motion';
  import { deriveBrewVisualState } from '$lib/presentation/scene';
  import type { PageProps, SubmitFunction } from './$types';

  type FrozenBreweryCommand =
    | { kind: 'start'; actionId: string; saveId: string; expectedRevision: number; ingredientBatchId: string }
    | {
        kind: 'complete'; actionId: string; saveId: string; expectedRevision: number; sessionId: string;
        perfectTicks: number; goodTicks: number; totalTicks: number;
      }
    | { kind: 'advance'; actionId: string; saveId: string; expectedRevision: number };

  let { data, form }: PageProps = $props();
  let snapshot = $derived(data.snapshot);
  let selectedIngredientId = $state<string | null>(null);
  let focusReturnId = $state<string | null>(null);
  let archiveOpen = $state(false);
  let archiveHeading = $state<HTMLHeadingElement>();
  let pending = $state(false);
  let transportError = $state<string | null>(null);
  let unresolved = $state<FrozenBreweryCommand | null>(null);
  let startForm = $state<HTMLFormElement>();
  let startBurning = $state(false);
  let startBurnAction = $state<ResolvedBurnAction | undefined>();
  let hydrated = $state(false);
  let acquisitionCard = $state<AcquisitionCard | null>(null);
  const seenAcquisitionEvents = new Set<string>();
  let stirring = $state<GuidedStirTelemetry>({
    phase: 'countdown', inputKind: 'none', direction: null, performance: 'ready',
    remainingMs: 17_000, perfectTicks: 0, goodTicks: 0, totalTicks: 0,
    targetTicks: 60, progress: 0, paddleAngle: Math.PI / 2, guideAngle: Math.PI / 2
  });

  onMount(() => { hydrated = true; });

  let session = $derived(snapshot?.brewery.activeSession ?? null);
  let latestBeverage = $derived(snapshot?.brewery.beverages[0] ?? null);
  let ingredients = $derived(snapshot?.ingredients ?? []);
  let availableIngredients = $derived(ingredients.filter((ingredient) => ingredient.quantity > 0));
  let choices = $derived<WorkflowChoice[]>(availableIngredients.map((ingredient) => ({
    id: ingredient.id,
    title: ingredient.plantName,
    eyebrow: 'Cellar ingredient',
    description: `${qualityLabel(ingredient.qualityIndex)} quality · Brew affinity +${ingredient.brewBonus}`,
    icon: ingredient.icon,
    meta: `${ingredient.quantity} unit${ingredient.quantity === 1 ? '' : 's'} available`,
    actionLabel: 'Inspect ingredient'
  })));
  let selectedIngredient = $derived(availableIngredients.find((ingredient) => ingredient.id === selectedIngredientId) ?? null);
  let selectedChoice = $derived(choices.find((choice) => choice.id === selectedIngredientId) ?? null);
  let brewedToday = $derived(latestBeverage?.dayNumber === snapshot?.save.currentDay);
  let remainingMs = $derived(stirring.remainingMs);
  let visualError = $derived(transportError ?? (form?.message && !form?.success ? form.message : null));
  let progress = $derived(stirring.progress);
  let canBottle = $derived(Boolean(
    session && stirring.phase === 'complete' && stirring.totalTicks === stirring.targetTicks && !pending && !unresolved
  ));
  let visual = $derived(deriveBrewVisualState(snapshot ?? null, { remainingMs, pending, error: visualError }));
  let guideOffset = $derived(
    stirring.direction
      ? shortestAngleDelta(stirring.paddleAngle - stirring.guideAngle) * stirring.direction
      : 0
  );
  let guideMeterPercent = $derived(clamp(50 + guideOffset / (Math.PI / 4) * 50, 0, 100));
  let countdownRemaining = $derived(
    session && stirring.phase === 'countdown'
      ? Math.max(0, Math.ceil((remainingMs - session.durationSeconds * 1000) / 1000))
      : 0
  );
  let blockedByBakery = $derived(Boolean(!session && snapshot?.save.dailyCraftKind === 'bake'));
  let canChooseIngredient = $derived(Boolean(snapshot && !session && !blockedByBakery && availableIngredients.length > 0));

  $effect(() => {
    const available = snapshot?.ingredients ?? [];
    if (selectedIngredientId && !available.some((ingredient) => ingredient.id === selectedIngredientId && ingredient.quantity > 0)) {
      selectedIngredientId = null;
      focusReturnId = null;
    }
  });

  function randomActionId() { return crypto.randomUUID(); }

  function performanceLabel(performance: GuidedStirPerformance) {
    if (performance === 'choose-direction') return 'Choose a direction';
    if (performance === 'finding-rhythm') return 'Finding rhythm';
    if (performance === 'catch-guide') return 'Catch the guide';
    return performance[0].toUpperCase() + performance.slice(1);
  }

  function inspectIngredient(id: string) {
    if (pending || unresolved) return;
    focusReturnId = null;
    selectedIngredientId = id;
    transportError = null;
  }

  function cancelInspection() {
    if (pending || unresolved) return;
    focusReturnId = selectedIngredientId;
    selectedIngredientId = null;
  }

  function openArchive() {
    if (pending || unresolved) return;
    selectedIngredientId = null;
    focusReturnId = null;
    archiveOpen = true;
    void tick().then(() => archiveHeading?.focus({ preventScroll: true }));
  }

  function returnToCraft() {
    if (archiveOpen) {
      archiveOpen = false;
      void tick().then(() => document.querySelector<HTMLButtonElement>('[data-archive-toggle="brewery"]')?.focus({ preventScroll: true }));
      return;
    }
    cancelInspection();
  }

  function confirmStart() {
    if (!selectedIngredientId || pending) return;
    startForm?.requestSubmit();
  }

  function commandEnhancer(kind: FrozenBreweryCommand['kind']): SubmitFunction {
    return ({ formData, cancel }) => {
      if (!snapshot || pending) { cancel(); return; }
      if (unresolved && unresolved.kind !== kind) { cancel(); return; }

      let command = unresolved;
      if (!command) {
        if (kind === 'start') {
          const ingredient = selectedIngredient;
          if (!ingredient || ingredient.quantity < 1 || !canChooseIngredient) { cancel(); return; }
          command = {
            kind, actionId: randomActionId(), saveId: snapshot.save.id,
            expectedRevision: snapshot.save.revision, ingredientBatchId: ingredient.id
          };
        } else if (kind === 'complete') {
          if (!session) { cancel(); return; }
          command = {
            kind, actionId: randomActionId(), saveId: snapshot.save.id,
            expectedRevision: snapshot.save.revision, sessionId: session.id,
            perfectTicks: stirring.perfectTicks, goodTicks: stirring.goodTicks, totalTicks: stirring.totalTicks
          };
        } else {
          command = {
            kind, actionId: randomActionId(), saveId: snapshot.save.id,
            expectedRevision: snapshot.save.revision
          };
        }
      }

      unresolved = command;
      formData.set('saveId', command.saveId);
      formData.set('actionId', command.actionId);
      formData.set('expectedRevision', String(command.expectedRevision));
      if (command.kind === 'start') formData.set('ingredientBatchId', command.ingredientBatchId);
      if (command.kind === 'complete') {
        formData.set('sessionId', command.sessionId);
        formData.set('perfectTicks', String(command.perfectTicks));
        formData.set('goodTicks', String(command.goodTicks));
        formData.set('totalTicks', String(command.totalTicks));
      }
      pending = true;
      transportError = null;

      return async ({ result, update }) => {
        if (result.type === 'error' || result.type === 'failure' && result.status >= 500) {
          pending = false;
          transportError = kind === 'start'
            ? 'The start response was lost. Retry the same ingredient to check its result.'
            : kind === 'complete'
              ? 'The bottling response was lost. Retry bottling to check its result.'
              : 'The day transition response was lost. Retry resting to check its result.';
          return;
        }

        if (kind === 'start' && result.type === 'success') {
          const burn = resolveBurnAction(data.cardBurnStyle);
          startBurnAction = burn;
          startBurning = true;
          await tick();
          await waitForBurn(burn.durationMs);
          startBurning = false;
          startBurnAction = undefined;
          selectedIngredientId = null;
          focusReturnId = null;
        }
        let completedAcquisition: AcquisitionCard | null = null;
        if (kind === 'complete' && result.type === 'success' && 'data' in result) {
          const receipt = (result.data as { receipt?: CompleteBrewReceipt } | undefined)?.receipt;
          const eventId = claimAcquisitionReceipt('brew', kind, command.actionId, receipt?.actionId, seenAcquisitionEvents);
          if (eventId && receipt) completedAcquisition = brewAcquisitionCard(eventId, receipt);
        }
        unresolved = null;
        try {
          await update({ reset: false, invalidateAll: true });
        } finally {
          pending = false;
          if (completedAcquisition) acquisitionCard = completedAcquisition;
        }
      };
    };
  }

  const enhanceStart = commandEnhancer('start');
  const enhanceComplete = commandEnhancer('complete');
  const enhanceAdvance = commandEnhancer('advance');
</script>

<svelte:head>
  <title>Brewery · By Rook and Crook</title>
  <meta name="description" content="Stir garden ingredients into a tavern mead." />
</svelte:head>

<main class="page-shell crafting-page brewery-live-page">
  {#if !snapshot}
    <section class="empty-state panel">
      <span aria-hidden="true">🍺</span>
      <h1>No tavern cellar yet</h1>
      <p>Start the tavern and harvest an ingredient before brewing.</p>
      <a class="primary-button inline-button" href="/garden">Start in the garden</a>
    </section>
  {:else}
    <CardWorkflowFrame
      sceneAspect={1672 / 941}
      title="The Brewery"
      eyebrow={`Tavern day ${snapshot.save.currentDay} · Daily craft`}
      location="Tavern · Cellar"
      inspectionMode={selectedChoice ? 'center' : 'folio'}
      onback={(archiveOpen || selectedChoice) && !pending && !unresolved ? returnToCraft : undefined}
      backLabel={archiveOpen ? 'Back to craft' : 'Choose another'}
    >
      {#snippet scene()}
        <BreweryScene
          {visual}
          saveId={snapshot.save.id}
          disabled={pending || !!unresolved}
          ontelemetry={(value) => (stirring = value)}
        />
      {/snippet}
      {#snippet status()}
        <dl class="workflow-status" aria-label="Brewery status">
          <div><dt>Phase</dt><dd>{session ? visual.phase : blockedByBakery ? 'Bakery active' : canChooseIngredient ? 'Ready' : 'Empty shelf'}</dd></div>
          <div><dt>Cellar</dt><dd>{availableIngredients.length} batch{availableIngredients.length === 1 ? '' : 'es'}</dd></div>
          <div><dt>Bottled</dt><dd>{snapshot.brewery.beverages.length}</dd></div>
        </dl>
      {/snippet}
      {#snippet controls()}
        <div class="frame-links">
          <button type="button" data-archive-toggle="brewery" disabled={pending || !!unresolved} onclick={openArchive}>Cellar archive</button>
        </div>
      {/snippet}
      {#snippet folio()}
        {#if archiveOpen}
          <section class="brew-archive">
            <p class="eyebrow">Brewery inventory</p>
            <h2 bind:this={archiveHeading} tabindex="-1">Cellar archive</h2>
            {#if snapshot.brewery.beverages.length === 0}
              <p class="muted">No finished batches yet.</p>
            {:else}
              <ul class="brew-history">
                {#each snapshot.brewery.beverages as beverage (beverage.id)}
                  {@const intentCard = snapshot.brewery.intentCards.find((card) => card.sourceBeverageId === beverage.id)}
                  <li>
                    <span aria-hidden="true">🍺</span>
                    <div>
                      <strong>{beverage.name}</strong>
                      <small>{qualityLabel(beverage.qualityIndex)} · Day {beverage.dayNumber}</small>
                      {#if intentCard}<p class="earned-card"><span>Intent card · {intentCard.tier}</span><strong>{intentCard.displayName}</strong><small>{intentCard.description}</small></p>{/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
            <a class="secondary-link" href="/bar">Offer a bottled drink at the bar <span aria-hidden="true">→</span></a>
          </section>
        {:else if selectedChoice && selectedIngredient}
          <WorkflowInspection
            item={selectedChoice}
            onconfirm={confirmStart}
            oncancel={unresolved ? undefined : cancelInspection}
            confirmLabel="Use 1 unit"
            consequence={`This starts today's brew and consumes one ${selectedIngredient.plantName} unit.`}
            pending={pending}
            burning={startBurning}
            burnAction={startBurnAction}
            error={visualError}
          />
        {:else if blockedByBakery}
          <section class="workflow-note">
            <p class="eyebrow">Today's craft</p>
            <h2>A loaf is active in the bakery</h2>
            <p>Finish the current loaf before starting another craft.</p>
            <a class="secondary-link" href="/bakery">Return to the bakery <span aria-hidden="true">→</span></a>
          </section>
        {:else if session}
          <section class="brew-controls" data-brew-sample-ticks={stirring.totalTicks}>
            <div class="brew-progress-heading">
              <div>
                <p class="eyebrow">{session.icon} {session.plantName} infusion</p>
                <h2>Stir the wort</h2>
              </div>
              <strong>{stirring.phase === 'countdown' ? `${countdownRemaining}s ready` : `${Math.ceil(remainingMs / 1000)}s`}</strong>
            </div>
            <div class="brew-progress" aria-label="Brewing progress"><span style={`width: ${progress}%`}></span></div>
            <div class="sweet-spot-wrap">
              <div class="sweet-spot-labels" aria-hidden="true"><span>Behind</span><span>With the guide</span><span>Ahead</span></div>
              <div class="sweet-spot-bar guide-relative"><i style={`left: calc(${guideMeterPercent}% - 2px)`}></i></div>
            </div>
            <div class="guided-instructions">
              <strong>Target: 15 RPM · one beat per second</strong>
              <span>Drag the paddle with the marker, or focus “Stir on the beat” and choose Left or Right.</span>
            </div>
            <div class="zone-readout {stirring.performance}" role="status" aria-live="polite">
              <strong>{performanceLabel(stirring.performance)}</strong>
              <span>
                {stirring.phase === 'countdown'
                  ? 'Get ready. The guide begins after the countdown.'
                  : stirring.inputKind === 'keyboard'
                    ? `${stirring.perfectTicks + stirring.goodTicks} of ${stirring.targetTicks} rhythm ticks earned`
                    : stirring.direction
                      ? `${stirring.direction === 1 ? 'Clockwise' : 'Counterclockwise'} · keep the paddle inside the guide arcs`
                      : 'Move at least 15° clockwise or counterclockwise to choose a direction'}
              </span>
            </div>
            <form method="POST" action="?/complete" use:enhance={enhanceComplete}>
              <button class="primary-button full-button" type="submit" disabled={!hydrated || !canBottle}>
                {pending ? 'Bottling…' : stirring.phase === 'countdown' ? `Ready in ${countdownRemaining}s` : remainingMs > 0 ? `Follow the guide for ${Math.ceil(remainingMs / 1000)}s` : unresolved?.kind === 'complete' ? 'Retry bottling' : 'Bottle this brew'}
              </button>
            </form>
            {#if visualError}<p class="form-message error" role="alert">{visualError}</p>
            {:else if form?.message}<p class="form-message" class:error={!form?.success} role={form?.success ? 'status' : 'alert'}>{form.message}</p>{/if}
          </section>
        {:else if availableIngredients.length === 0}
          <section class="workflow-note">
            <p class="eyebrow">Cellar inventory</p>
            <h2>The ingredient shelf is empty</h2>
            <p>Harvest a mature crop before beginning today's brew.</p>
            {#if brewedToday && latestBeverage}<p class="recent-craft">Latest: <strong>{latestBeverage.name}</strong> · {qualityLabel(latestBeverage.qualityIndex)}</p>{/if}
            <a class="primary-button inline-button" href="/garden">Visit the garden</a>
          </section>
        {:else}
          <section class="brew-context">
            <p class="eyebrow">Cellar</p>
            {#if snapshot.brewery.beverages.length === 0}
              <h2>Ready for a new infusion</h2>
              <p class="muted">Choose an ingredient card to inspect its quality and brew affinity.</p>
            {:else}
              <h2>{latestBeverage?.name ?? 'Cellar stocked'}</h2>
              <p class="muted">Latest bottle · {latestBeverage ? qualityLabel(latestBeverage.qualityIndex) : 'Ready to serve'}</p>
            {/if}
            {#if snapshot.save.dailyCraftKind === null}
              <form method="POST" action="?/advance" use:enhance={enhanceAdvance} class="close-tavern">
                <p>{snapshot.save.dayMinigameCompleted ? 'Craft another batch or close the tavern for today.' : 'Crafting is optional. The tavern may close now.'}</p>
                <button class="text-button full-button" type="submit" disabled={!hydrated || pending || !!unresolved}>
                  {pending ? 'Closing the tavern…' : unresolved?.kind === 'advance' ? 'Retry resting' : snapshot.save.dayMinigameCompleted ? 'Rest and begin next day' : 'Rest without crafting'}
                </button>
              </form>
            {/if}
          </section>
        {/if}
      {/snippet}
      {#snippet hand()}
        {#if canChooseIngredient && !selectedChoice && !archiveOpen}
          <div class="ingredient-hand">
            <WorkflowHand
              items={choices}
              label="Cellar ingredients"
              selectedId={null}
              focusId={focusReturnId}
              burnStyle={data.cardBurnStyle}
              pending={pending || !!unresolved}
              onchoose={inspectIngredient}
            />
          </div>
        {/if}
      {/snippet}
    </CardWorkflowFrame>
    <form bind:this={startForm} method="POST" action="?/start" use:enhance={enhanceStart} hidden>
      <input type="hidden" name="saveId" value={snapshot.save.id} />
      <input type="hidden" name="ingredientBatchId" value={selectedIngredientId ?? ''} />
      <input type="hidden" name="actionId" value="" />
      <input type="hidden" name="expectedRevision" value={snapshot.save.revision} />
    </form>
    {#if acquisitionCard}
      <AcquisitionReveal open {...acquisitionCard} ondismiss={() => acquisitionCard = null} />
    {/if}
  {/if}
</main>

<style>
  .brewery-live-page { max-width: 1600px; }
  .workflow-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .35rem .7rem; margin: 0; }
  .workflow-status div { display: flex; gap: .3rem; align-items: baseline; color: #e3cfaa; font-size: .74rem; }
  .workflow-status dt { color: #bea879; }
  .workflow-status dd { margin: 0; font-weight: 650; }
  .frame-links { display: flex; gap: .4rem; }
  .frame-links button { display: inline-flex; min-height: 40px; align-items: center; padding: .35rem .55rem; border: 1px solid #9a793c; border-radius: .4rem; background: #20170ad9; color: #f0d394; font: inherit; font-size: .72rem; cursor: pointer; }
  .frame-links button:disabled { cursor: wait; opacity: .65; }
  .ingredient-hand { padding: 0 .8rem .4rem; }
  .workflow-note, .brew-context, .brew-archive, .brew-controls { display: grid; gap: .7rem; padding: .35rem 0; color: #f0dfb8; }
  .workflow-note h2, .brew-context h2, .brew-archive h2, .brew-controls h2 { margin: 0; color: #f0dfb8; font-size: 1.15rem; }
  .workflow-note p, .brew-context p, .brew-archive p, .brew-controls p { margin: 0; line-height: 1.45; }
  .workflow-note > p:not(.eyebrow), .brew-context > p:not(.eyebrow), .brew-archive > p:not(.eyebrow) { color: #cbb894; font-size: .82rem; }
  .workflow-note .eyebrow, .brew-context .eyebrow, .brew-archive .eyebrow, .brew-controls .eyebrow { margin: 0; color: #d9b772; font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; }
  .brew-history { display: grid; gap: .5rem; margin: 0; padding: 0; list-style: none; }
  .brew-history > li { display: flex; gap: .65rem; padding: .6rem; border: 1px solid #493719; background: #100c07; }
  .brew-history > li > span { font-size: 1.4rem; }
  .brew-history strong, .brew-history small { display: block; }
  .brew-history small { color: #cbb894; font-size: .72rem; }
  .earned-card { display: grid; gap: .2rem; margin: .45rem 0 0 !important; padding: .45rem; border-left: 2px solid #c9a65b; background: #20170a; }
  .earned-card span { color: #d9b772; font-size: .62rem; text-transform: uppercase; }
  .earned-card strong { color: #f0dfb8; font-size: .78rem; }
  .earned-card small { color: #cbb894; font-size: .67rem; }
  .recent-craft { color: #e3cfaa; font-size: .8rem; }
  .close-tavern { display: grid; gap: .5rem; padding-top: .6rem; border-top: 1px solid #493719; }
  .close-tavern p { color: #cbb894; font-size: .75rem; }
  .brew-progress-heading { display: flex; justify-content: space-between; align-items: start; gap: 1rem; }
  .brew-progress-heading > strong { color: #e0c787; font-family: 'Cinzel', serif; white-space: nowrap; }
  .brew-progress { height: 8px; overflow: hidden; border: 1px solid #80602f; background: #100c07; }
  .brew-progress span { display: block; height: 100%; background: linear-gradient(90deg,#aa6d2a,#e1c56e); transition: width 120ms linear; }
  .sweet-spot-wrap { display: grid; gap: .3rem; }
  .sweet-spot-labels { display: flex; justify-content: space-between; color: #cbb894; font-size: .65rem; }
  .sweet-spot-bar { position: relative; height: 10px; border: 1px solid #80602f; background: linear-gradient(90deg,#6f271d 0 28%,#8b702d 42%,#638b43 48% 52%,#8b702d 58%,#6f271d 72% 100%); }
  .sweet-spot-bar i { position: absolute; top: -4px; width: 3px; height: 16px; background: #fff3c7; box-shadow: 0 0 8px #fff; }
  .guided-instructions { display: grid; gap: .25rem; color: #cbb894; font-size: .76rem; }
  .guided-instructions strong { color: #e0c787; }
  .zone-readout { display: grid; gap: .15rem; padding: .55rem .65rem; border: 1px solid #493719; background: #100c07; font-size: .75rem; }
  .zone-readout strong { color: #e0c787; }
  .zone-readout span { color: #cbb894; }
  .zone-readout.perfect strong { color: #a8d28a; }
  .zone-readout.good strong { color: #e0c787; }
  .form-message { margin: 0; color: #d7c7a5; font-size: .78rem; }
  .form-message.error { color: #f2aa8c; }
  .brew-controls :global(.primary-button), .close-tavern :global(.text-button) { width: 100%; }
  @media (max-width: 700px) {
    .ingredient-hand { padding: 0 .25rem .3rem; }
    .workflow-note, .brew-context, .brew-archive, .brew-controls { padding: .25rem 0; }
    .workflow-status { font-size: .7rem; }
    .frame-links button { min-height: 36px; padding-inline: .4rem; font-size: .67rem; }
  }
</style>
