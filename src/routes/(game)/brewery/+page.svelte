<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import { qualityLabel } from '$lib/game/contracts';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
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
  let stirring = $state(false);

  let session = $derived(data.snapshot?.brewery.activeSession ?? null);
  let latestBeverage = $derived(data.snapshot?.brewery.beverages[0] ?? null);
  let latestCard = $derived(
    data.snapshot?.brewery.socialCards.find((card) => card.sourceBeverageId === latestBeverage?.id) ?? null
  );
  let zone = $derived(classifySpeed(speed));
  let progress = $derived(
    session ? Math.min(100, Math.max(0, 100 - (remainingMs / (session.durationSeconds * 1000)) * 100)) : 0
  );
  let canBottle = $derived(Boolean(session && remainingMs <= 0 && !pending));

  $effect(() => {
    const ingredients = data.snapshot?.ingredients ?? [];
    if (!ingredients.some((ingredient) => ingredient.id === selectedIngredientId)) {
      selectedIngredientId = ingredients[0]?.id ?? '';
    }
  });

  function classifySpeed(value: number): 'slow' | 'good' | 'perfect' | 'fast' {
    if (value >= 42 && value <= 58) return 'perfect';
    if (value >= 30 && value <= 70) return 'good';
    return value < 30 ? 'slow' : 'fast';
  }

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
        if (remainingMs <= 0 || totalTicks >= 160) return;

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

  function setSpeedFromPointer(event: PointerEvent) {
    if (!stirring) return;
    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    speed = Math.round(Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)));
  }

  function beginStirring(event: PointerEvent) {
    stirring = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setSpeedFromPointer(event);
  }

  function stopStirring() {
    stirring = false;
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
        transportError = 'The start response was lost. Retry to check the same ledger entry.';
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
        transportError = 'The bottling response was lost. Retry to check the same ledger entry.';
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
        transportError = 'The day transition response was lost. Retry the same ledger entry.';
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

<main class="page-shell">
  <div class="page-title-row">
    <div>
      <p class="eyebrow">Tavern day {data.snapshot?.save.currentDay ?? '—'} · Daily craft</p>
      <h1>The brewery</h1>
      <p>Stir the wort for thirty seconds. Ingredient quality and a steady hand shape the result.</p>
    </div>
    {#if data.snapshot}
      <div class="revision-badge">Ledger {data.snapshot.save.revision}</div>
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
    <div class="brewery-layout">
      <section class="brew-panel panel" aria-labelledby="brew-title">
        {#if data.snapshot.save.dayMinigameCompleted}
          <div class="brew-result" aria-live="polite">
            <span class="large-icon" aria-hidden="true">🍺</span>
            <p class="eyebrow">Day {data.snapshot.save.currentDay} craft complete</p>
            <h2 id="brew-title">{latestBeverage?.name ?? 'Brew bottled'}</h2>
            {#if latestBeverage}
              <p class="quality-display">{qualityLabel(latestBeverage.qualityIndex)}</p>
            {/if}
            {#if latestCard}
              <div class="card-reward">
                <span aria-hidden="true">🃏</span>
                <div>
                  <p class="eyebrow">Social card earned · {latestCard.tier}</p>
                  <strong>{latestCard.displayName}</strong>
                  <small>Relationship +{latestCard.relationshipGain} · Gold ×{latestCard.goldMultiplier}</small>
                </div>
              </div>
            {/if}
            <form method="POST" action="?/advance" use:enhance={enhanceAdvance}>
              <button class="primary-button" type="submit" disabled={pending}>
                {pending ? 'Closing the ledger…' : 'Rest and begin next day'}
              </button>
            </form>
            <a class="secondary-link" href="/bar">Serve a drink at the bar →</a>
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
              <i style={`left: calc(${speed}% - 2px)`}></i>
            </div>
          </div>

          <div
            class="cauldron-control"
            role="presentation"
            onpointerdown={beginStirring}
            onpointermove={setSpeedFromPointer}
            onpointerup={stopStirring}
            onpointercancel={stopStirring}
          >
            <div class="cauldron">
              <span class:stirring={speed > 0} style={`transform: rotate(${speed * 2}deg)`}>🥄</span>
            </div>
            <div class="fire" aria-hidden="true">🔥 🔥 🔥</div>
          </div>

          <label class="speed-control">
            <span>Stirring speed</span>
            <input type="range" min="0" max="100" step="1" bind:value={speed} />
          </label>

          <div class="zone-readout {zone}" role="status" aria-live="polite">
            <strong>{zone === 'perfect' ? 'Perfect' : zone === 'good' ? 'Good' : zone === 'slow' ? 'Too slow' : 'Too fast'}</strong>
            <span>{zone === 'perfect' ? 'Keep it here' : zone === 'good' ? 'Close to the sweet spot' : 'Move toward the green band'}</span>
          </div>

          <form method="POST" action="?/complete" use:enhance={enhanceComplete}>
            <button class="primary-button full-button" type="submit" disabled={!canBottle}>
              {pending ? 'Bottling…' : remainingMs > 0 ? `Stir for ${Math.ceil(remainingMs / 1000)}s` : 'Bottle this brew'}
            </button>
          </form>
        {:else if data.snapshot.ingredients.length === 0}
          <div class="empty-state">
            <span aria-hidden="true">🧺</span>
            <h2 id="brew-title">The ingredient shelf is empty</h2>
            <p>Harvest a mature crop before beginning today's brew.</p>
            <a class="primary-button inline-button" href="/garden">Visit the garden</a>
          </div>
        {:else}
          <div class="brew-setup">
            <p class="eyebrow">Choose one unit</p>
            <h2 id="brew-title">Prepare today's infusion</h2>
            <p>Higher ingredient quality raises the starting potential. Your stirring determines the finish.</p>

            <form method="POST" action="?/start" use:enhance={enhanceStart}>
              <fieldset class="ingredient-picker">
                <legend>Available ingredients</legend>
                {#each data.snapshot.ingredients as ingredient (ingredient.id)}
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
              <button class="primary-button full-button" type="submit" disabled={!selectedIngredientId || pending}>
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

      <aside class="brew-ledger">
        <section class="detail-card">
          <p class="eyebrow">Cellar ledger</p>
          <h2>Bottled mead</h2>
          {#if data.snapshot.brewery.beverages.length === 0}
            <p class="muted">No finished batches yet.</p>
          {:else}
            <ul class="brew-history">
              {#each data.snapshot.brewery.beverages as beverage (beverage.id)}
                <li>
                  <span aria-hidden="true">🍺</span>
                  <div><strong>{beverage.name}</strong><small>{qualityLabel(beverage.qualityIndex)} · Day {beverage.dayNumber}</small></div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <a class="secondary-link" href="/ingredients">Choose from the pantry <span aria-hidden="true">→</span></a>
      </aside>
    </div>
  {/if}
</main>
