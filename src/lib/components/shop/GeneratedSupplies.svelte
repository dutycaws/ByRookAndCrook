<script lang="ts">
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { onDestroy, tick } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import WorkflowInspection from '$lib/components/ui/WorkflowInspection.svelte';
  import type { WorkflowChoice } from '$lib/components/ui/workflow';
  import { resolveBurnAction, waitForBurn, type BurnStyle, type ResolvedBurnAction } from '$lib/card-effects';
  import type { GeneratedSupplies, GeneratedSupplyCatalogItem } from '$lib/server/evolving-world/generated-supplies';

  type PurchaseCommand = {
    saveId: string;
    actionId: string;
    expectedRevision: number;
    itemKey: string;
    item: GeneratedSupplyCatalogItem;
    burn: ResolvedBurnAction;
  };
  type BurningSupply = { id: number; item: GeneratedSupplyCatalogItem };
  type Props = {
    supplies: GeneratedSupplies;
    item: GeneratedSupplyCatalogItem;
    saveId: string;
    revision: number;
    burnStyle?: BurnStyle;
    form?: { message?: string; error?: boolean } | null;
    oncancel?: () => void;
    onbusychange?: (busy: boolean) => void;
  };

  let { supplies, item, saveId, revision, burnStyle = 'drip', form, oncancel, onbusychange }: Props = $props();
  let purchaseForm: HTMLFormElement | undefined = $state();
  let pendingCommand = $state<PurchaseCommand | null>(null);
  let pending = $state(false);
  let burningSupply = $state<BurningSupply | null>(null);
  let burnAction = $state<ResolvedBurnAction | null>(null);
  let message = $state('');
  let messageError = $state(false);
  let burnSequence = 0;

  let inspectionItem = $derived<WorkflowChoice>({
    id: `provision:${item.itemKey}`,
    title: item.name,
    description: 'A settlement provision for your tavern pantry.',
    eyebrow: 'Settlement provision',
    icon: '✧',
    meta: `${item.price} gold · ${item.remainingStock} of ${item.dailyStock} in stock`,
    actionLabel: pendingCommand?.itemKey === item.itemKey && !pending ? 'Retry the same purchase' : 'Buy provision',
    disabled: pending || (item.remainingStock === 0 && pendingCommand?.itemKey !== item.itemKey)
  });
  let isBurning = $derived(burningSupply?.item.entityId === item.entityId);

  beforeNavigate(({ cancel }) => {
    if (pending || pendingCommand !== null) cancel();
  });
  onDestroy(() => {
    burnSequence += 1;
    onbusychange?.(false);
  });

  $effect(() => {
    onbusychange?.(pending || pendingCommand !== null || burningSupply !== null);
  });

  $effect(() => {
    if (form?.message) {
      message = form.message;
      messageError = Boolean(form.error);
    }
  });

  function submitPurchase() {
    if (pending || burningSupply || (pendingCommand && pendingCommand.itemKey !== item.itemKey)) return;
    purchaseForm?.requestSubmit();
  }

  async function startSuccessBurn(command: PurchaseCommand) {
    const id = ++burnSequence;
    burnAction = command.burn;
    burningSupply = { id, item: command.item };
    await tick();
    await waitForBurn(command.burn.durationMs);
    if (burningSupply?.id === id) burningSupply = null;
  }

  function purchaseEnhancer(): SubmitFunction {
    return ({ formData, cancel }) => {
      if (pending || burningSupply || (pendingCommand && pendingCommand.itemKey !== item.itemKey)) {
        cancel();
        return;
      }

      const command = pendingCommand?.itemKey === item.itemKey ? pendingCommand : {
        saveId,
        actionId: crypto.randomUUID(),
        expectedRevision: revision,
        itemKey: item.itemKey,
        item,
        burn: resolveBurnAction(burnStyle)
      };
      pendingCommand = command;
      formData.set('saveId', command.saveId);
      formData.set('expectedRevision', String(command.expectedRevision));
      formData.set('actionId', command.actionId);
      formData.set('itemKey', command.itemKey);
      formData.set('quantity', '1');
      pending = true;
      message = '';
      messageError = false;

      return async ({ result, update }) => {
        try {
          if (result.type === 'success' && 'data' in result) {
            const resultData = result.data as { message?: string; error?: boolean } | undefined;
            message = resultData?.error
              ? resultData.message ?? 'The provision could not be purchased.'
              : resultData?.message ?? 'Provision purchased.';
            messageError = Boolean(resultData?.error);
            if (!messageError) {
              try { await update({ reset: false, invalidateAll: true }); }
              catch { message = 'Provision purchased, but updated stock could not be loaded. Refresh the shop to check your pantry.'; messageError = true; }
              if (pendingCommand?.actionId === command.actionId) pendingCommand = null;
              void startSuccessBurn(command);
            } else if (pendingCommand?.actionId === command.actionId) {
              pendingCommand = null;
            }
          } else if (result.type === 'failure' && 'data' in result) {
            const resultData = result.data as { message?: string; error?: boolean } | undefined;
            message = resultData?.message ?? 'The provision could not be purchased.';
            messageError = Boolean(resultData?.error ?? true);
            if (pendingCommand?.actionId === command.actionId) pendingCommand = null;
          } else {
            message = 'The purchase result is unknown. Retry the same purchase to safely check whether it went through.';
            messageError = true;
          }
        } catch {
          message = 'The purchase result is unknown. Retry the same purchase to safely check whether it went through.';
          messageError = true;
        } finally {
          pending = false;
        }
      };
    };
  }
</script>

<section class="generated-supply-inspection" aria-label="Settlement provision inspection">
  <WorkflowInspection
    item={inspectionItem}
    onconfirm={submitPurchase}
    oncancel={pendingCommand ? undefined : oncancel}
    confirmLabel={inspectionItem.actionLabel}
    consequence={`${item.price} gold. ${item.remainingStock} of ${item.dailyStock} stocked today.`}
    {pending}
    burning={isBurning}
    burnAction={burnAction ?? undefined}
    error={messageError ? message : null}
  />
  {#if message && !messageError}<p class="supply-message" role="status" aria-live="polite">{message}</p>{/if}
  {#if supplies.inventory.length}
    <details class="provision-inventory"><summary>Your provisions · {supplies.inventory.length}</summary><ul>{#each supplies.inventory as inventoryItem (inventoryItem.entityId)}<li>{inventoryItem.quantity} × {inventoryItem.name}</li>{/each}</ul></details>
  {/if}
  <form bind:this={purchaseForm} class="hidden-purchase-form" method="POST" action="?/purchaseGeneratedSupply" use:enhance={purchaseEnhancer()}>
    <input type="hidden" name="saveId" value={pendingCommand?.saveId ?? saveId} />
    <input type="hidden" name="expectedRevision" value={pendingCommand?.expectedRevision ?? revision} />
    <input type="hidden" name="actionId" value={pendingCommand?.actionId ?? ''} />
    <input type="hidden" name="itemKey" value={pendingCommand?.itemKey ?? item.itemKey} />
    <input type="hidden" name="quantity" value="1" />
  </form>
</section>

<style>
  .generated-supply-inspection { display: grid; gap: .55rem; justify-items: center; }
  .supply-message { margin: 0; color: #c6d99a; font-size: .78rem; text-align: center; }
  .provision-inventory { max-width: min(100%, 22rem); padding: .4rem .6rem; border: 1px solid #92723f77; border-radius: .4rem; color: #ddcca6; background: #171109dc; font-size: .75rem; }
  .provision-inventory summary { cursor: pointer; }
  .provision-inventory ul { display: grid; gap: .2rem; margin: .4rem 0 0; padding-left: 1rem; }
  .hidden-purchase-form { display: none; }
</style>
