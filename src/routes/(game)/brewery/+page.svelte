<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  import ContextualActionStrip from '$lib/components/scene/ContextualActionStrip.svelte';
  import CraftingSceneLayout from '$lib/components/scene/CraftingSceneLayout.svelte';
  import BreweryScene from '$lib/components/scenes/BreweryScene.svelte';
  import { qualityLabel } from '$lib/game/contracts';
  import { classifyStirRpm, stirRpmPercent, STIR_MAX_RPM } from '$lib/game/scene-motion';
  import { deriveBrewVisualState } from '$lib/presentation/scene';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  let snapshot = $derived(data.snapshot!);
  let selectedIngredientId = $state('');
  let speed = $state(0);
  let perfectTicks = $state(0);
  let goodTicks = $state(0);
  let totalTicks = $state(0);
  let remainingMs = $state(30_000);
  let trackedSessionId = $state<string | null>(null);
  let startActionId = $state<string | null>(null);
  let completionActionId = $state<string | null>(null);
  let advanceActionId = $state<string | null>(null);
  let pending = $state(false);
  let transportError = $state<string | null>(null);
  let inputMode = $state<'physical' | 'assisted'>('physical');
  let hydrated = $state(false);
  const classifySpeed = classifyStirRpm;

  onMount(() => {
    hydrated = true;
  });

  let session = $derived(data.snapshot?.brewery.activeSession ?? null);
  let latestBeverage = $derived(data.snapshot?.brewery.beverages[0] ?? null);
  let latestCard = $derived(
    data.snapshot?.brewery.intentCards.find((card) => card.sourceBeverageId === latestBeverage?.id) ?? null
  );
  let brewedToday = $derived(latestBeverage?.dayNumber === data.snapshot?.save.currentDay);
  let zone = $derived(classifySpeed(speed));
  let visualError = $derived(transportError ?? (form?.message && !form?.success ? form.message : null));
  let progress = $derived(
    session ? Math.min(100, Math.max(0, 100 - (remainingMs / (session.durationSeconds * 1000)) * 100)) : 0
  );
  let canBottle = $derived(Boolean(session && remainingMs <= 0 && !pending));
  let visual = $derived(deriveBrewVisualState(data.snapshot ?? null, { speed, zone, remainingMs, pending, error: visualError }));

  $effect(() => {
    const ingredients = data.snapshot?.ingredients ?? [];
    if (!ingredients.some((ingredient) => ingredient.id === selectedIngredientId)) {
      selectedIngredientId = ingredients[0]?.id ?? '';
    }
  });

  function randomActionId() {
    return crypto.randomUUID();
  }

  $effect(() => {
    const active = session;
    if (!active) return;

    return untrack(() => {
      if (trackedSessionId !== active.id) {
        trackedSessionId = active.id;
        speed = 0;
        perfectTicks = 0;
        goodTicks = 0;
        totalTicks = 0;
        completionActionId = null;
      }

      const sample = () => {
        const finishAt = Date.parse(active.startedAt) + active.durationSeconds * 1000;
        remainingMs = Math.max(0, finishAt - Date.now());
        if (remainingMs <= 0 || totalTicks >= 160 || document.visibilityState !== 'visible') return;

        totalTicks += 1;
        const currentZone = classifySpeed(speed);
        if (currentZone === 'perfect') perfectTicks += 1;
        if (currentZone === 'good') goodTicks += 1;
      };

      sample();
      const timer = window.setInterval(sample, 250);
      return () => window.clearInterval(timer);
    });
  });

  function selectInputMode(mode: 'physical' | 'assisted') {
    inputMode = mode;
    speed = 0;
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
    formData.set('perfectTicks', String(perfectTicks));
    formData.set('goodTicks', String(goodTicks));
    formData.set('totalTicks', String(totalTicks));
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
      <p>Stir the wort for thirty seconds. Ingredient quality and a steady hand shape the result.</p>
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
      <section class="brew-panel panel" aria-labelledby="brew-title" data-brew-sample-ticks={totalTicks}>
        <BreweryScene {visual} mode={inputMode} disabled={pending} onspeed={(value) => (speed = value)} />
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
            <strong>{Math.ceil(remainingMs / 1000)}s</strong>
          </div>

          <div class="brew-progress" aria-label="Brewing progress">
            <span style={`width: ${progress}%`}></span>
          </div>

          <div class="sweet-spot-wrap">
            <div class="sweet-spot-labels" aria-hidden="true">
              <span>Too slow</span><span>Sweet spot</span><span>Too fast</span>
            </div>
            <div class="sweet-spot-bar">
              <i style={`left: calc(${stirRpmPercent(speed)}% - 2px)`}></i>
            </div>
          </div>

          <fieldset class="stir-mode">
            <legend>Stirring input</legend>
            <label class:active={inputMode === 'physical'}>
              <input type="radio" name="stir-mode" checked={inputMode === 'physical'} onchange={() => selectInputMode('physical')} />
              <span><strong>Physical stirring</strong><small>Circle the paddle through the wort</small></span>
            </label>
            <label class:active={inputMode === 'assisted'}>
              <input type="radio" name="stir-mode" checked={inputMode === 'assisted'} onchange={() => selectInputMode('assisted')} />
              <span><strong>Assisted control</strong><small>Hold a selected pace with the slider</small></span>
            </label>
          </fieldset>

          <label class="speed-control">
            <span>Stirring speed <small>Assisted control holds this pace · {Math.round(speed)} RPM</small></span>
            <input aria-label="Stirring speed in RPM" type="range" min="0" max={STIR_MAX_RPM} step="1" bind:value={speed} disabled={inputMode !== 'assisted'} />
          </label>

          <div class="zone-readout {zone}" role="status" aria-live="polite">
            <strong>{zone === 'perfect' ? 'Perfect' : zone === 'good' ? 'Good' : zone === 'slow' ? 'Too slow' : 'Too fast'}</strong>
            <span>{Math.round(speed)} RPM · {zone === 'perfect' ? 'Keep it between 10 and 20 RPM' : zone === 'good' ? 'Close to the sweet spot' : 'Move toward the green band'}</span>
          </div>

          <form method="POST" action="?/complete" use:enhance={enhanceComplete}>
            <button class="primary-button full-button" type="submit" disabled={!hydrated || !canBottle}>
              {pending ? 'Bottling…' : remainingMs > 0 ? `Stir for ${Math.ceil(remainingMs / 1000)}s` : 'Bottle this brew'}
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
                {pending ? 'Preparing the wort…' : 'Begin 30-second brew'}
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
          description={visual.phase === 'active' || visual.phase === 'ready' ? 'Use physical circular input or the assisted slider; both feed the same live speed.' : visual.phase === 'blocked' ? 'The Bakery has an active loaf.' : 'Select a pantry ingredient in the scene panel.'}
          status={pending ? 'Updating…' : visual.error ?? (session ? `${Math.ceil(remainingMs / 1000)} seconds remain` : `${snapshot.brewery.beverages.length} bottled`)}
        >
          <a class="secondary-link compact-link" href="/ingredients">Pantry overview <span aria-hidden="true">→</span></a>
        </ContextualActionStrip>
      {/snippet}
    </CraftingSceneLayout>
  {/if}
</main>
