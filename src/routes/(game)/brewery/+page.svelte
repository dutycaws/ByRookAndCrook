<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import ContextualActionStrip from '$lib/components/scene/ContextualActionStrip.svelte';
  import CraftingSceneLayout from '$lib/components/scene/CraftingSceneLayout.svelte';
  import BreweryScene from '$lib/components/scenes/BreweryScene.svelte';
  import { qualityLabel } from '$lib/game/contracts';
  import {
    clamp,
    shortestAngleDelta,
    type GuidedStirPerformance,
    type GuidedStirTelemetry
  } from '$lib/game/scene-motion';
  import { deriveBrewVisualState } from '$lib/presentation/scene';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  let snapshot = $derived(data.snapshot!);
  let selectedIngredientId = $state('');
  let stirring = $state<GuidedStirTelemetry>({
    phase: 'countdown', inputKind: 'none', direction: null, performance: 'ready',
    remainingMs: 17_000, perfectTicks: 0, goodTicks: 0, totalTicks: 0,
    targetTicks: 60, progress: 0, paddleAngle: Math.PI / 2, guideAngle: Math.PI / 2
  });
  let startActionId = $state<string | null>(null);
  let completionActionId = $state<string | null>(null);
  let advanceActionId = $state<string | null>(null);
  let pending = $state(false);
  let transportError = $state<string | null>(null);
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
  });

  let session = $derived(data.snapshot?.brewery.activeSession ?? null);
  let latestBeverage = $derived(data.snapshot?.brewery.beverages[0] ?? null);
  let latestCard = $derived(
    data.snapshot?.brewery.intentCards.find((card) => card.sourceBeverageId === latestBeverage?.id) ?? null
  );
  let brewedToday = $derived(latestBeverage?.dayNumber === data.snapshot?.save.currentDay);
  let remainingMs = $derived(stirring.remainingMs);
  let visualError = $derived(transportError ?? (form?.message && !form?.success ? form.message : null));
  let progress = $derived(stirring.progress);
  let canBottle = $derived(Boolean(
    session && stirring.phase === 'complete' && stirring.totalTicks === stirring.targetTicks && !pending
  ));
  let visual = $derived(deriveBrewVisualState(data.snapshot ?? null, { remainingMs, pending, error: visualError }));
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

  $effect(() => {
    const ingredients = data.snapshot?.ingredients ?? [];
    if (!ingredients.some((ingredient) => ingredient.id === selectedIngredientId)) {
      selectedIngredientId = ingredients[0]?.id ?? '';
    }
  });

  function randomActionId() {
    return crypto.randomUUID();
  }

  function performanceLabel(performance: GuidedStirPerformance) {
    if (performance === 'choose-direction') return 'Choose a direction';
    if (performance === 'finding-rhythm') return 'Finding rhythm';
    if (performance === 'catch-guide') return 'Catch the guide';
    return performance[0].toUpperCase() + performance.slice(1);
  }

  const enhanceStart: SubmitFunction = ({ formData }) => {
    if (!data.snapshot || !selectedIngredientId) return;
    startActionId ??= randomActionId();
    formData.set('saveId', data.snapshot.save.id);
    formData.set('ingredientBatchId', selectedIngredientId);
    formData.set('actionId', startActionId);
    formData.set('expectedRevision', String(data.snapshot.save.revision));
    pending = true;
    transportError = null;

    return async ({ result, update }) => {
      pending = false;
      if (result.type === 'error') {
        transportError = 'The start response was lost. Retry the same brew to check its result.';
        return;
      }
      if (result.type === 'success') startActionId = null;
      await update({ reset: false, invalidateAll: true });
    };
  };

  const enhanceComplete: SubmitFunction = ({ formData }) => {
    if (!data.snapshot || !session) return;
    completionActionId ??= randomActionId();
    formData.set('saveId', data.snapshot.save.id);
    formData.set('sessionId', session.id);
    formData.set('actionId', completionActionId);
    formData.set('expectedRevision', String(data.snapshot.save.revision));
    formData.set('perfectTicks', String(stirring.perfectTicks));
    formData.set('goodTicks', String(stirring.goodTicks));
    formData.set('totalTicks', String(stirring.totalTicks));
    pending = true;
    transportError = null;

    return async ({ result, update }) => {
      pending = false;
      if (result.type === 'error') {
        transportError = 'The bottling response was lost. Retry bottling to check its result.';
        return;
      }
      if (result.type === 'success') completionActionId = null;
      await update({ reset: false, invalidateAll: true });
    };
  };

  const enhanceAdvance: SubmitFunction = ({ formData }) => {
    if (!data.snapshot) return;
    advanceActionId ??= randomActionId();
    formData.set('saveId', data.snapshot.save.id);
    formData.set('actionId', advanceActionId);
    formData.set('expectedRevision', String(data.snapshot.save.revision));
    pending = true;
    transportError = null;

    return async ({ result, update }) => {
      pending = false;
      if (result.type === 'error') {
        transportError = 'The day transition response was lost. Retry resting to check its result.';
        return;
      }
      if (result.type === 'success') advanceActionId = null;
      await update({ reset: false, invalidateAll: true });
    };
  };
</script>

<svelte:head>
  <title>Brewery · By Rook and Crook</title>
  <meta name="description" content="Stir garden ingredients into a tavern mead." />
</svelte:head>

<main class="page-shell crafting-page">
  <div class="page-title-row">
    <div>
      <p class="eyebrow">Tavern day {data.snapshot?.save.currentDay ?? '—'} · Daily craft</p>
      <h1>The brewery</h1>
      <p>Follow the 15 RPM guide for fifteen seconds. Ingredient quality and steady rhythm shape the result.</p>
    </div>
    {#if data.snapshot}
      <div class="revision-badge">{data.snapshot.ingredients.length} pantry batch{data.snapshot.ingredients.length === 1 ? '' : 'es'}</div>
    {/if}
  </div>

  {#if !data.snapshot}
    <section class="empty-state panel">
      <span aria-hidden="true">🍺</span>
      <h2>No tavern cellar yet</h2>
      <p>Start the tavern and harvest an ingredient before brewing.</p>
      <a class="primary-button inline-button" href="/garden">Start in the garden</a>
    </section>
  {:else}
    <CraftingSceneLayout area="brewery" statusTitle="Brewery ledger" inspectorTitle="Cellar inventory">
      {#snippet status()}
        <dl class="craft-status-list">
          <div><dt>Day</dt><dd>{snapshot.save.currentDay}</dd></div>
          <div><dt>Phase</dt><dd>{visual.phase}</dd></div>
          <div><dt>Pantry</dt><dd>{snapshot.ingredients.length}</dd></div>
          <div><dt>Bottled</dt><dd>{snapshot.brewery.beverages.length}</dd></div>
        </dl>
      {/snippet}
      {#snippet scene()}
      <section class="brew-panel panel" aria-labelledby="brew-title" data-brew-sample-ticks={stirring.totalTicks}>
        <BreweryScene
          {visual}
          saveId={snapshot.save.id}
          disabled={pending}
          ontelemetry={(value) => (stirring = value)}
        />
        {#if snapshot.save.dailyCraftKind === 'bake'}
          <div class="empty-state">
            <span aria-hidden="true">🥖</span>
            <h2 id="brew-title">A loaf is active in the bakery</h2>
            <p>Finish the current loaf before starting another craft.</p>
            <a class="primary-button inline-button" href="/bakery">Return to the bakery</a>
          </div>
        {:else if session}
          <div class="brew-progress-heading">
            <div>
              <p class="eyebrow">{session.icon} {session.plantName} infusion</p>
              <h2 id="brew-title">Stir the wort</h2>
            </div>
            <strong>{stirring.phase === 'countdown' ? `${countdownRemaining}s ready` : `${Math.ceil(remainingMs / 1000)}s`}</strong>
          </div>

          <div class="brew-progress" aria-label="Brewing progress">
            <span style={`width: ${progress}%`}></span>
          </div>

          <div class="sweet-spot-wrap">
            <div class="sweet-spot-labels" aria-hidden="true">
              <span>Behind</span><span>With the guide</span><span>Ahead</span>
            </div>
            <div class="sweet-spot-bar guide-relative">
              <i style={`left: calc(${guideMeterPercent}% - 2px)`}></i>
            </div>
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
              {pending ? 'Bottling…' : stirring.phase === 'countdown' ? `Ready in ${countdownRemaining}s` : remainingMs > 0 ? `Follow the guide for ${Math.ceil(remainingMs / 1000)}s` : 'Bottle this brew'}
            </button>
          </form>
        {:else if snapshot.ingredients.length === 0}
          <div class="empty-state">
            <span aria-hidden="true">🧺</span>
            <h2 id="brew-title">The ingredient shelf is empty</h2>
            <p>Harvest a mature crop before beginning today's brew.</p>
            {#if brewedToday && latestBeverage}
              <p class="recent-craft" aria-live="polite">
                Latest: <strong>{latestBeverage.name}</strong> · {qualityLabel(latestBeverage.qualityIndex)}
                <a href="/bar">Serve it at the bar →</a>
              </p>
            {/if}
            <a class="primary-button inline-button" href="/garden">Visit the garden</a>
          </div>
        {:else}
          <div class="brew-setup">
            {#if brewedToday && latestBeverage}
              <div class="recent-craft" aria-live="polite">
                <div>
                  <p class="eyebrow">Latest batch · Day {snapshot.save.currentDay}</p>
                  <h2>{latestBeverage.name}</h2>
                  <span>{qualityLabel(latestBeverage.qualityIndex)}</span>
                  {#if latestCard}
                    <p class="recent-card">
                      <span>Intent card earned · {latestCard.tier}</span>
                      <strong>{latestCard.displayName}</strong>
                      <small>{latestCard.description}</small>
                    </p>
                  {/if}
                </div>
                <a href="/bar">Serve a drink at the bar →</a>
              </div>
            {/if}
            <p class="eyebrow">Choose one unit</p>
            <h2 id="brew-title">Prepare today's infusion</h2>
            <p>Higher ingredient quality raises the starting potential. Your stirring determines the finish.</p>

            <form method="POST" action="?/start" use:enhance={enhanceStart}>
              <fieldset class="ingredient-picker">
                <legend>Available ingredients</legend>
                {#each snapshot.ingredients as ingredient (ingredient.id)}
                  <label class:selected={selectedIngredientId === ingredient.id}>
                    <input type="radio" name="ingredient" value={ingredient.id} bind:group={selectedIngredientId} />
                    <span class="ingredient-icon" aria-hidden="true">{ingredient.icon}</span>
                    <span>
                      <strong>{ingredient.plantName}</strong>
                      <small>{qualityLabel(ingredient.qualityIndex)} · {ingredient.quantity} unit{ingredient.quantity === 1 ? '' : 's'} · Brew +{ingredient.brewBonus}</small>
                    </span>
                  </label>
                {/each}
              </fieldset>
              <button class="primary-button full-button" type="submit" disabled={!hydrated || !selectedIngredientId || pending}>
                {pending ? 'Preparing the wort…' : 'Begin guided brew'}
              </button>
            </form>
          </div>
        {/if}

        {#if transportError}
          <div class="form-message error brew-message" role="alert">{transportError}</div>
        {:else if form?.message}
          <div class="form-message brew-message" class:error={!form?.success} role={form?.success ? 'status' : 'alert'}>
            {form.message}
            {#if 'conflict' in form && form.conflict}<span>The latest tavern state has been loaded.</span>{/if}
          </div>
        {/if}
      </section>
      {/snippet}
      {#snippet inspector()}
      <div class="brew-ledger">
        <section class="detail-card">
          <p class="eyebrow">Cellar inventory</p>
          <h2>Bottled mead</h2>
          {#if snapshot.brewery.beverages.length === 0}
            <p class="muted">No finished batches yet.</p>
          {:else}
            <ul class="brew-history">
              {#each snapshot.brewery.beverages as beverage (beverage.id)}
                <li>
                  <span aria-hidden="true">🍺</span>
                  <div><strong>{beverage.name}</strong><small>{qualityLabel(beverage.qualityIndex)} · Day {beverage.dayNumber}</small></div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        {#if !session && snapshot.save.dailyCraftKind === null}
          <form method="POST" action="?/advance" use:enhance={enhanceAdvance} class="close-tavern">
            <p>{snapshot.save.dayMinigameCompleted ? 'Craft another batch or close the tavern for today.' : 'Crafting is optional. The tavern may close now.'}</p>
            <button class="text-button full-button" type="submit" disabled={!hydrated || pending}>
              {pending ? 'Closing the tavern…' : snapshot.save.dayMinigameCompleted ? 'Rest and begin next day' : 'Rest without crafting'}
            </button>
          </form>
        {/if}
        <a class="secondary-link" href="/ingredients">Choose from the pantry <span aria-hidden="true">→</span></a>
      </div>
      {/snippet}
      {#snippet action()}
        <ContextualActionStrip
          eyebrow="Brewery action"
          title={visual.phase === 'active' || visual.phase === 'ready' ? 'Keep the paddle moving' : visual.phase === 'result' ? 'Batch bottled · prepare another' : 'Prepare the next infusion'}
          description={visual.phase === 'active' || visual.phase === 'ready' ? 'Hold and drag the paddle with the marker, or use the keyboard rhythm control.' : visual.phase === 'blocked' ? 'The Bakery has an active loaf.' : 'Select a pantry ingredient in the scene panel.'}
          status={pending ? 'Updating…' : visual.error ?? (session ? `${performanceLabel(stirring.performance)} · ${Math.ceil(remainingMs / 1000)} seconds remain` : `${snapshot.brewery.beverages.length} bottled`)}
        >
          <a class="secondary-link compact-link" href="/ingredients">Pantry overview <span aria-hidden="true">→</span></a>
        </ContextualActionStrip>
      {/snippet}
    </CraftingSceneLayout>
  {/if}
</main>
