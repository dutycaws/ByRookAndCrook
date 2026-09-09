<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { qualityLabel } from '$lib/game/contracts';
  import type { ServeCommand } from '$lib/game/serving';
  import NpcDialogue from '$lib/components/NpcDialogue.svelte';
  import type { PatronKey } from '$lib/game/dialogue';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  let patronKey = $state('lira');
  let itemSelection = $state('');
  let legacyCardId = $state('');
  let pending = $state(false);
  let unresolved = $state<ServeCommand | null>(null);
  let localError = $state<string | null>(null);
  let hydrated = $state(false);
  let closeCommand: {actionId:string;saveId:string;revision:number}|null=$state(null);
  const enhanceClose:SubmitFunction=({formData,cancel})=>{
    if(!data.snapshot||pending){cancel();return;}
    closeCommand??={actionId:crypto.randomUUID(),saveId:data.snapshot.save.id,revision:data.snapshot.save.revision};
    for(const [key,value] of Object.entries(closeCommand))formData.set(key,String(value));
    pending=true;
    return async({result,update})=>{
      if(result.type==='error'||result.type==='failure'&&result.status>=500){localError='Closing could not be confirmed. Retry closing to recover the result.';pending=false;return;}
      closeCommand=null;
      localError=null;
      try{await update({reset:false});if(result.type==='failure')await invalidateAll();}
      catch{localError='The journal could not be refreshed. Refresh the bar to see the current day.';}finally{pending=false;}
    };
  };
  $effect(() => { hydrated = true; });
  let patron = $derived(data.snapshot?.patrons.find((p) => p.key === patronKey));
  let selectedKind = $derived(itemSelection.startsWith('food:') ? 'food' as const : 'beverage' as const);
  let selectedId = $derived(itemSelection.split(':', 2)[1] ?? '');
  let item = $derived(selectedKind === 'food'
    ? data.snapshot?.foods.find((food) => food.id === selectedId)
    : data.snapshot?.beverages.find((drink) => drink.id === selectedId));
  let legacyCard = $derived(data.snapshot?.legacyCards.find((card) => card.id === legacyCardId));

  $effect(() => {
    if (unresolved) return;
    const choices = [
      ...(data.snapshot?.beverages.map((drink) => `beverage:${drink.id}`) ?? []),
      ...(data.snapshot?.foods.map((food) => `food:${food.id}`) ?? [])
    ];
    if (!choices.includes(itemSelection)) itemSelection = choices[0] ?? '';
    if (selectedKind !== 'beverage' || !data.snapshot?.legacyCards.some((card) => card.id === legacyCardId)) legacyCardId = '';
  });

  const enhanceServe: SubmitFunction = ({ formData, cancel }) => {
    if (!data.snapshot || pending || (!unresolved && !item)) { cancel(); return; }
    unresolved ??= {
      saveId: data.snapshot.save.id, patronKey, itemKind: selectedKind, itemId: selectedId,
      legacyCardId: legacyCardId || null,
      actionId: crypto.randomUUID(), expectedRevision: data.snapshot.save.revision
    };
    const command = unresolved;
    for (const [key, value] of Object.entries(command)) formData.set(key, String(value ?? ''));
    pending = true;
    localError = null;
    return async ({ result, update }) => {
      // Unknown outcomes retain the entire command; selection cannot alter a retry.
      if (result.type === 'error' || (result.type === 'failure' && result.status >= 500)) {
        pending = false;
        localError = 'The serving outcome is unknown. Retry the same pour to check whether it was recorded.';
        return;
      }
      unresolved = null;
      try {
        await update({ reset: false, invalidateAll: true });
        // Enhanced form failures do not invalidate loads, even when requested.
        if (result.type === 'failure') await invalidateAll();
      } catch {
        localError = result.type === 'success'
          ? 'Your pour was recorded, but the latest bar could not be loaded. Refresh the bar to continue.'
          : 'The bar could not be refreshed. Refresh the bar to continue.';
      } finally { pending = false; }
    };
  };

  async function refreshBar() {
    pending = true;
    try { await invalidateAll(); localError = null; }
    catch { localError = 'The bar is still unavailable. Please try refreshing again.'; }
    finally { pending = false; }
  }

  function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
</script>

<svelte:head>
  <title>The bar · By Rook and Crook</title>
  <meta name="description" content="Welcome the regulars, pour your finest mead, and follow their stories." />
</svelte:head>

<main class="page-shell">
  <div class="page-title-row">
    <div>
      <p class="eyebrow">The common room · Day {data.snapshot?.save.currentDay ?? '—'}</p>
      <h1>The bar</h1>
      <p>A familiar face. A carefully made drink. A story waiting to unfold.</p>
    </div>
    {#if data.snapshot}<div class="gold-purse" aria-label="Tavern gold">🪙 <strong>{data.snapshot.save.gold} gold</strong></div>{/if}
  </div>

  {#if !data.snapshot}
    <section class="empty-state panel">
      <h2>Open the doors</h2><p>Start your tavern in the garden, then bring your first brew to the bar.</p>
      <a class="primary-button inline-button" href="/garden">Start your tavern</a>
    </section>
  {:else}
    <div class="bar-layout">
      <section class="panel patron-panel" aria-labelledby="regulars-title">
        <p class="eyebrow">A seat by the fire</p><h2 id="regulars-title">Tonight's regulars</h2>
        <div class="patron-picker" role="group" aria-label="Choose a patron">
          {#each data.snapshot.patrons as guest (guest.key)}
            <button type="button" class:selected={patronKey === guest.key} aria-pressed={patronKey === guest.key}
              disabled={!hydrated || pending || !!unresolved} onclick={() => patronKey = guest.key}>
              <span class="patron-icon" aria-hidden="true">{guest.icon}</span>
              <span><strong>{guest.name}</strong><small>{guest.title}</small></span>
            </button>
          {/each}
        </div>
        {#if patron}
          <article class="patron-story">
            <p class="eyebrow">{patron.title}</p><h2>{patron.name}</h2>
            <p>{patron.description}</p>
            <label class="relationship-meter">Relationship <strong>{patron.relationship} / 100</strong>
              <meter min="0" max="100" value={patron.relationship}>{patron.relationship}</meter>
            </label>
            <div class="story-chapter">
              <p class="eyebrow">{patron.arcProgress === patron.arcTotal ? 'Previously resolved' : patron.arcProgress ? `Legacy chapter ${patron.arcProgress} of ${patron.arcTotal}` : 'Where their story began'}</p>
              <h3>{patron.arcTitle}</h3><p>{patron.story}</p>
              <p class="muted">The journal below follows current intentions. Hospitality affects trust and overnight readiness.</p>
            </div>
          </article>
        {/if}
      </section>

      <section class="panel serving-panel" aria-labelledby="pour-title">
        <p class="eyebrow">From your cellar</p><h2 id="pour-title">Make a little hospitality</h2>
        {#if data.snapshot.beverages.length === 0 && data.snapshot.foods.length === 0 && !unresolved}
          <div class="empty-state"><span aria-hidden="true">🍽️</span><h3>No hospitality ready to serve</h3>
            <p>Brew a drink or bake some food before offering it at the bar.</p>
            <a class="primary-button inline-button" href="/brewery">Visit the brewery</a>
          </div>
        {:else}
          <form method="POST" action="?/serve" use:enhance={enhanceServe}>
            <fieldset disabled={!hydrated || pending || !!unresolved}>
              <legend>Choose food or drink</legend>
              <div class="pour-options">
                {#each data.snapshot.beverages as drink (drink.id)}
                  <label class:selected={itemSelection === `beverage:${drink.id}`}>
                    <input type="radio" value={`beverage:${drink.id}`} bind:group={itemSelection} />
                    <span><strong>{drink.name}</strong><small>{qualityLabel(drink.qualityIndex)}</small></span>
                  </label>
                {/each}
                {#each data.snapshot.foods as food (food.id)}
                  <label class:selected={itemSelection === `food:${food.id}`}>
                    <input type="radio" value={`food:${food.id}`} bind:group={itemSelection} />
                    <span><strong>{food.name}</strong><small>{qualityLabel(food.qualityIndex)}</small></span>
                  </label>
                {/each}
              </div>
              {#if selectedKind === 'beverage' && data.snapshot.legacyCards.length}
                <label class="card-choice">Legacy Pour Ale entitlement <span class="muted">Optional · usable once with a drink</span>
                  <select bind:value={legacyCardId}>
                    <option value="">Save legacy entitlement</option>
                    {#each data.snapshot.legacyCards as reward (reward.id)}
                    <option value={reward.id}>{reward.displayName} · {reward.tier} · +{reward.relationshipGain} relationship · ×{reward.goldMultiplier} gold</option>
                    {/each}
                  </select>
                </label>
              {/if}
            </fieldset>
            {#if item && patron}
              <div class="pour-summary">
                <p>{patron.name} pays <strong>{patron.prices[item.qualityIndex]} gold</strong> for this quality.</p>
                {#if legacyCard}<p>{legacyCard.displayName}: payment ×{legacyCard.goldMultiplier}, relationship +{legacyCard.relationshipGain}. This legacy entitlement is used with the drink.</p>{/if}
              </div>
            {/if}
            <button class="primary-button full-button" disabled={!hydrated || pending || (!item && !unresolved) || data.journals[patronKey]?.availability!=='present'}>
              {pending ? 'Serving…' : unresolved ? 'Retry the same serving' : `Serve to ${patron?.name ?? 'patron'}`}
            </button>
          </form>
        {/if}
        {#if localError}
          <p class="form-message error" role="alert">{localError}</p>
          {#if !unresolved}<button class="text-button" disabled={pending} onclick={refreshBar}>Refresh bar</button>{/if}
        {:else if form?.message}
          <div class="form-message" class:error={!('success' in form && form.success)} role={'success' in form ? 'status' : 'alert'}>
            <p>{form.message}</p>
            {#if 'receipt' in form && form.receipt}<p>{form.receipt.storyEvent}</p>{/if}
          </div>
        {/if}
      </section>
    </div>

    {#if patron && data.journals[patron.key]}
      {#key patron.key}<NpcDialogue patronKey={patron.key as PatronKey} name={patron.name} journal={data.journals[patron.key]} stock={data.snapshot} unavailable={data.dialogueUnavailable}/>{/key}
    {/if}
    <section class="panel close-tavern">
      <h2>Close the tavern</h2><p>Your regulars will follow their intentions overnight. You can close without crafting today.</p>
      <form method="POST" action="?/close" use:enhance={enhanceClose}><button class="primary-button" disabled={!hydrated||pending}>{pending?'Closing…':'Close and begin next day'}</button></form>
    </section>
    <section class="panel serving-history" aria-labelledby="history-title">
      <p class="eyebrow">The keeper's journal</p><h2 id="history-title">Recent hospitality</h2>
      {#if data.snapshot.history.length === 0}<p class="muted">Your first pour will begin the journal.</p>
      {:else}<ol>
        {#each data.snapshot.history as event (event.actionId)}
          <li>
            <div><strong>{event.itemName ?? event.beverageName} → {event.patronName}</strong><small>Day {event.dayNumber} · {qualityLabel(event.qualityIndex)}{event.cardId ? ' · Legacy entitlement used' : ''}</small></div>
            <p class="serve-effects">+{event.goldEarned} gold · Relationship {signed(event.relationshipChange)} · Story {signed(event.arcChange)}</p>
            <p>{event.storyEvent}</p>
          </li>
        {/each}
      </ol>{/if}
    </section>
  {/if}
</main>
