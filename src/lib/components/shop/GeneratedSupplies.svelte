<script lang="ts">
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import CardBurnSurface from '$lib/components/ui/CardBurnSurface.svelte';
  import { resolveBurnAction, type BurnStyle, type ResolvedBurnAction } from '$lib/card-effects';
  import type {
    GeneratedSupplies,
    GeneratedSupplyCatalogItem
  } from '$lib/server/evolving-world/generated-supplies';

  type PurchaseCommand = {
    actionId: string;
    saveId: string;
    expectedRevision: number;
    itemKey: string;
    item: GeneratedSupplyCatalogItem;
    burn: ResolvedBurnAction;
  };

  type BurningSupply = {
    id: number;
    item: GeneratedSupplyCatalogItem;
    treatment: ResolvedBurnAction['treatment'];
    durationMs: number;
  };

  type Props = {
    supplies: GeneratedSupplies;
    saveId: string;
    revision: number;
    burnStyle?: BurnStyle;
    form?: { message?: string; error?: boolean } | null;
    onbusychange?: (busy: boolean) => void;
  };

  let {
    supplies,
    saveId,
    revision,
    burnStyle = 'drip',
    form,
    onbusychange
  }: Props = $props();

  let pendingCommand = $state<PurchaseCommand | null>(null);
  let pending = $state(false);
  let burningSupply = $state<BurningSupply | null>(null);
  let message = $state('');
  let messageError = $state(false);
  let burnSequence = 0;

  beforeNavigate(({ cancel }) => {
    if (pending || pendingCommand !== null) cancel();
  });

  onDestroy(() => onbusychange?.(false));

  $effect(() => {
    onbusychange?.(pending || pendingCommand !== null);
  });

  $effect(() => {
    if (form?.message) {
      message = form.message;
      messageError = Boolean(form.error);
    }
  });

  function finishBurn(id: number) {
    if (burningSupply?.id === id) burningSupply = null;
  }

  function purchaseEnhancer(item: GeneratedSupplyCatalogItem): SubmitFunction {
    return ({ formData, cancel }) => {
      if (pending || burningSupply || (pendingCommand && pendingCommand.itemKey !== item.itemKey)) {
        cancel();
        return;
      }

      const command = pendingCommand ?? {
        actionId: crypto.randomUUID(),
        saveId,
        expectedRevision: revision,
        itemKey: item.itemKey,
        item: { ...item },
        burn: resolveBurnAction(burnStyle)
      };

      pendingCommand = command;
      pending = true;
      message = '';
      messageError = false;
      formData.set('saveId', command.saveId);
      formData.set('expectedRevision', String(command.expectedRevision));
      formData.set('actionId', command.actionId);
      formData.set('itemKey', command.itemKey);
      formData.set('quantity', '1');

      return async ({ result, update }) => {
        try {
          if (result.type === 'success') {
            let refreshError = false;
            try {
              await update({ reset: false, invalidateAll: true });
            } catch {
              refreshError = true;
            }

            if (pendingCommand?.actionId === command.actionId) pendingCommand = null;
            message = refreshError
              ? 'Provision purchased, but the updated stock could not be loaded. Refresh the shop to continue.'
              : result.data?.message ?? 'Provision purchased.';
            messageError = refreshError;
            burningSupply = {
              id: ++burnSequence,
              item: command.item,
              treatment: command.burn.treatment,
              durationMs: command.burn.durationMs
            };
            return;
          }

          if (result.type === 'failure') {
            if (pendingCommand?.actionId === command.actionId) pendingCommand = null;
            await update({ reset: false, invalidateAll: false });
            message = result.data?.message ?? 'The provision could not be purchased.';
            messageError = Boolean(result.data?.error);
            return;
          }

          if (result.type === 'error') {
            message = 'The purchase result is unknown. Retry the same purchase to safely check whether it went through.';
            messageError = true;
            return;
          }

          await update({ reset: false, invalidateAll: true });
          if (pendingCommand?.actionId === command.actionId) pendingCommand = null;
        } catch {
          if (result.type !== 'success' && result.type !== 'failure') {
            message = 'The purchase result is unknown. Retry the same purchase to safely check whether it went through.';
            messageError = true;
          }
        } finally {
          pending = false;
        }
      };
    };
  }
</script>

<section class="generated-supplies panel" aria-labelledby="generated-supplies-title">
  <header class="supplies-heading">
    <p class="eyebrow">Settlement discoveries</p>
    <h2 id="generated-supplies-title">New provisions</h2>
    <p>These supplies were discovered by your tavern’s evolving world.</p>
  </header>
  <p class="muted">Settlement provisions are ordinary pantry goods. Food and drinks served to a guest contribute to quest readiness.</p>

  <div class="supply-grid" aria-label="Available settlement provisions">
    {#each supplies.catalog as item (item.entityId)}
      {@const isBurning = burningSupply?.item.entityId === item.entityId}
      {@const burnId = isBurning ? burningSupply?.id ?? 0 : 0}
      {@const cardFace = isBurning ? burningSupply?.item ?? item : item}
      <CardBurnSurface
        active={isBurning}
        treatment={isBurning ? burningSupply?.treatment ?? 'drip' : 'drip'}
        durationMs={isBurning ? burningSupply?.durationMs ?? 0 : 0}
        oncomplete={() => finishBurn(burnId)}
      >
        <article class="supply-card">
          <p class="card-eyebrow">Provisions</p>
          <h3>{cardFace.name}</h3>
          <p class="supply-details">{cardFace.price} gold · {cardFace.remainingStock} of {cardFace.dailyStock} stocked</p>
          <form method="POST" action="?/purchaseGeneratedSupply" use:enhance={purchaseEnhancer(item)}>
            <input type="hidden" name="saveId" value={pendingCommand?.itemKey === item.itemKey ? pendingCommand.saveId : saveId} />
            <input type="hidden" name="expectedRevision" value={pendingCommand?.itemKey === item.itemKey ? pendingCommand.expectedRevision : revision} />
            <input type="hidden" name="actionId" value={pendingCommand?.itemKey === item.itemKey ? pendingCommand.actionId : ''} />
            <input type="hidden" name="itemKey" value={pendingCommand?.itemKey === item.itemKey ? pendingCommand.itemKey : item.itemKey} />
            <input type="hidden" name="quantity" value="1" />
            {#if pendingCommand?.itemKey === item.itemKey && !pending}
              <button class="secondary-button retry-button" type="submit" disabled={burningSupply !== null}>
                Retry the same purchase
              </button>
            {:else}
              <button
                class="secondary-button"
                type="submit"
                disabled={pending || pendingCommand !== null || burningSupply !== null || cardFace.remainingStock === 0}
              >
                {pending && pendingCommand?.itemKey === item.itemKey ? 'Purchasing…' : 'Buy provision'}
              </button>
            {/if}
          </form>
        </article>
      </CardBurnSurface>
    {:else}
      <p class="muted">No settlement provisions are available yet.</p>
    {/each}
  </div>

  {#if supplies.inventory.length}
    <section class="provision-inventory" aria-label="Your provisions">
      <h3>Your provisions</h3>
      <ul>
        {#each supplies.inventory as item (item.entityId)}
          <li><span>{item.quantity} × {item.name}</span></li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if message}
    <p class:error={messageError} class="message" role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</p>
  {/if}
</section>

<style>
  .generated-supplies { margin: 1rem auto; max-width: 1100px; padding: 1rem; }
  .supplies-heading p { margin: .25rem 0; }
  .muted { color: var(--muted); }
  .supply-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: .8rem; }
  .supply-card { display: grid; align-content: start; gap: .45rem; height: 100%; min-height: 12rem; padding: .85rem; border: 1px solid #73552a; border-radius: .35rem; background: linear-gradient(160deg, rgb(67 48 20 / .48), rgb(13 10 6 / .94)); box-shadow: inset 0 1px 0 rgb(255 230 170 / .06); }
  .card-eyebrow { margin: 0; color: #b89b5c; font: 600 .65rem 'Cinzel', Georgia, serif; letter-spacing: .08em; text-transform: uppercase; }
  .supply-card h3 { margin: 0; color: #e7c871; font: 600 1rem 'Cinzel', Georgia, serif; }
  .supply-details { margin: 0; color: #c9bb9b; font-size: .85rem; }
  .supply-card form { align-self: end; margin-top: auto; }
  .supply-card button { min-height: 2.75rem; }
  .supply-card button:disabled { opacity: .55; cursor: not-allowed; }
  .retry-button { border-color: #c5913d; }
  .provision-inventory h3 { margin: 1rem 0 .35rem; color: #d7c596; font-family: 'Cinzel', Georgia, serif; }
  .provision-inventory ul { padding: 0; list-style: none; }
  .provision-inventory li { display: flex; justify-content: space-between; align-items: center; gap: .7rem; padding: .5rem 0; border-bottom: 1px solid #3b2a15; }
  .message { margin: .8rem 0 0; color: #c6d99a; }
  .message.error { color: #e4a28e; }
</style>
