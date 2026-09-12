<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, tick } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { GardenCommandKind, GardenCommandPayload, GardenCommandPreview, GameSnapshot, GardenInventoryItem } from '$lib/game/contracts';

  type ShopCategory = 'all' | 'seeds' | 'garden' | 'apiary';
  type ShopCommand = Extract<GardenCommandKind, 'purchase' | 'expand'>;
  type ShopPayload = Extract<GardenCommandPayload, { itemKey: string } | { plotCount: 16 | 24 }>;

  let { snapshot }: { snapshot: GameSnapshot } = $props();

  let category = $state<ShopCategory>('all');
  let hydrated = $state(false);
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<ShopPayload | null>(null);
  let previewSignature = $state('');
  let pendingAction = $state<{ signature: string; actionId: string; revision: number } | null>(null);
  let pending = $state(false);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let purchaseDialog: HTMLDialogElement | undefined = $state();
  let returnFocus: HTMLElement | null = $state(null);
  let dialogTitle = $state('Purchase supplies');

  let garden = $derived(snapshot.garden);
  let goods = $derived(garden?.shop ?? []);
  let inventory = $derived(garden?.inventory ?? []);
  let nextExpansion = $derived(garden?.expansions.find((expansion) => expansion.available) ?? null);
  let capacity = $derived((garden?.plotCount ?? snapshot.cells.filter((cell) => cell.unlocked !== false).length));
  let activeGoods = $derived(goods.filter((item) => category === 'all' || itemCategory(item) === category));
  let hasCurrentPreview = $derived(!!preview && previewSignature === signature(preview?.commandKind as ShopCommand, previewPayload));

  const categoryNames: Record<ShopCategory, string> = {
    all: 'All', seeds: 'Seeds', garden: 'Garden', apiary: 'Apiary'
  };

  onMount(() => {
    hydrated = true;
  });

  function itemCategory(item: Omit<GardenInventoryItem, 'quantity'>): Exclude<ShopCategory, 'all'> {
    if (item.kind === 'seed') return 'seeds';
    if (item.kind === 'amendment') return 'garden';
    return 'apiary';
  }

  function itemIcon(item: Omit<GardenInventoryItem, 'quantity'>) {
    return ({ seed: '✿', amendment: '◒', equipment: '⌂', colony: '♚', feed: '❋', treatment: '✦' } as const)[item.kind];
  }

  function signature(kind: ShopCommand | undefined, payload: ShopPayload | null) {
    return `${kind ?? 'none'}:${JSON.stringify(payload)}`;
  }

  function displayField(key: string, value: unknown) {
    if (key === 'itemKey' && typeof value === 'string') return goods.find((item) => item.itemKey === value)?.name ?? value;
    if (typeof value === 'number' || typeof value === 'string') return String(value);
    return JSON.stringify(value);
  }

  function commandLabel(kind: ShopCommand) {
    return kind === 'expand' ? 'expand the garden' : 'buy supplies';
  }

  function purchaseSummary(payload: ShopPayload | null) {
    if (!payload || !('itemKey' in payload) || !('quantity' in payload)) return null;
    const item = goods.find((candidate) => candidate.itemKey === payload.itemKey);
    const held = inventory.find((candidate) => candidate.itemKey === payload.itemKey)?.quantity ?? 0;
    return { name: item?.name ?? payload.itemKey, quantity: payload.quantity, held, after: held + payload.quantity };
  }

  function previewEnhancer(kind: ShopCommand, payloadFor: (formData: FormData) => ShopPayload | null): SubmitFunction {
    return ({ formData, cancel, submitter }) => {
      const payload = payloadFor(formData);
      if (!payload) {
        cancel();
        message = 'Choose a valid quantity before asking Elara to prepare the order.';
        messageError = true;
        return;
      }
      formData.set('commandKind', kind);
      formData.set('payload', JSON.stringify(payload));
      returnFocus = submitter instanceof HTMLElement ? submitter : null;
      pending = true;
      message = null;
      return async ({ result }) => {
        pending = false;
        const data = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
        if (result.type === 'success' && data?.preview) {
          preview = data.preview;
          previewPayload = payload;
          previewSignature = signature(kind, payload);
          dialogTitle = kind === 'expand' ? 'Garden expansion' : 'Purchase supplies';
          messageError = false;
          await tick();
          if (purchaseDialog && !purchaseDialog.open) purchaseDialog.showModal();
        } else {
          message = data?.message ?? 'Elara cannot prepare that preview right now.';
          messageError = true;
        }
      };
    };
  }

  const commitPreview: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !hasCurrentPreview) {
      cancel();
      message = 'Ask for a fresh preview before confirming this order.';
      messageError = true;
      return;
    }
    const currentSignature = signature(preview.commandKind as ShopCommand, previewPayload);
    if (!pendingAction || pendingAction.signature !== currentSignature || pendingAction.revision !== snapshot.save.revision) {
      pendingAction = { signature: currentSignature, actionId: crypto.randomUUID(), revision: snapshot.save.revision };
    }
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', pendingAction.actionId);
    formData.set('expectedRevision', String(pendingAction.revision));
    formData.set('commandKind', preview.commandKind);
    formData.set('payload', JSON.stringify(previewPayload));
    pending = true;
    message = null;
    return async ({ result, update }) => {
      pending = false;
      const data = 'data' in result ? result.data as { message?: string; conflict?: boolean; pendingAction?: object } | undefined : undefined;
      if (result.type === 'error') {
        message = 'The order outcome is unknown. Retry to recover the same order.';
        messageError = true;
        return;
      }
      if (result.type === 'success') {
        message = data?.message ?? 'Elara has updated your supplies.';
        messageError = false;
        preview = null;
        previewPayload = null;
        previewSignature = '';
        pendingAction = null;
        purchaseDialog?.close();
      } else if (data?.pendingAction) {
        message = data.message ?? 'The order outcome is unknown. Retry to recover the same order.';
        messageError = true;
      } else {
        message = data?.message ?? 'Elara could not complete that order.';
        messageError = true;
        pendingAction = null;
      }
      await update({ reset: false, invalidateAll: result.type === 'success' || !!data?.conflict });
    };
  };

  async function clearPreview() {
    preview = null;
    previewPayload = null;
    previewSignature = '';
    if (!pending && !(pendingAction && messageError)) pendingAction = null;
    await tick();
    returnFocus?.focus();
    returnFocus = null;
  }

  function closePreview() {
    if (purchaseDialog?.open) purchaseDialog.close();
    else void clearPreview();
  }
</script>

<section class="shop-layout" aria-label="Elara Greenbloom's garden shop">
  <aside class="shop-status panel" aria-labelledby="shop-status-title">
    <p class="eyebrow">Shop status</p>
    <h2 id="shop-status-title">Keeper's ledger</h2>
    <dl>
      <div><dt>Gold</dt><dd>{snapshot.save.gold ?? 0}</dd></div>
      <div><dt>Garden capacity</dt><dd>{capacity} plots</dd></div>
      <div><dt>Supplies held</dt><dd>{inventory.reduce((sum, item) => sum + item.quantity, 0)}</dd></div>
    </dl>
    {#if nextExpansion}
      <div class="expansion-card">
        <p class="eyebrow">Next expansion</p>
        <strong>{nextExpansion.plotCount} plots</strong>
        <span>{nextExpansion.price} gold</span>
        <form method="POST" action="?/preview" use:enhance={previewEnhancer('expand', () => ({ plotCount: nextExpansion!.plotCount }))}>
          <button type="submit" class="secondary-button" disabled={!hydrated || pending}>Expand to {nextExpansion.plotCount} plots</button>
        </form>
      </div>
    {:else}
      <p class="shop-muted">Every available garden plot is already in your care.</p>
    {/if}
  </aside>

  <section class="shop-scene panel" aria-labelledby="shop-scene-title">
    <div class="shop-scene-art" aria-hidden="true">
      <img class="shop-environment" src="/assets/scenes/shop-environment.webp" alt="" onerror={(event) => event.currentTarget.remove()} />
      <img class="shop-merchant" src="/assets/scenes/shop/elara-merchant.webp" alt="" onerror={(event) => event.currentTarget.remove()} />
    </div>
    <div class="shop-scene-copy">
      <p class="eyebrow">Greenbloom's provisions</p>
      <h1 id="shop-scene-title">Elara's garden shop</h1>
      <p>Seeds, soil care, and apiary supplies for the next good day in the courtyard.</p>
    </div>
  </section>

  <aside class="shop-goods panel" aria-labelledby="goods-title">
    <header class="merchant-heading">
      <img src="/assets/scenes/shop/elara-portrait.webp" alt="Elara Greenbloom" onerror={(event) => event.currentTarget.remove()} />
      <div><p class="eyebrow">Shopkeeper</p><h2>Elara Greenbloom</h2><span>🌿 Druid merchant</span></div>
    </header>
    <fieldset class="shop-filters">
      <legend id="goods-title">Featured goods</legend>
      <div>
        {#each Object.entries(categoryNames) as [key, label]}
          <label><input type="radio" name="shop-category" value={key} bind:group={category} /><span>{label}</span></label>
        {/each}
      </div>
    </fieldset>
    <div class="goods-grid" aria-live="polite">
      {#each activeGoods as item (item.itemKey)}
        <article class="good-card" data-good-category={itemCategory(item)}>
          <span class="good-icon" aria-hidden="true">{itemIcon(item)}</span>
          <h3>{item.name}</h3>
          <p>{item.price} gold · Owned {inventory.find((candidate) => candidate.itemKey === item.itemKey)?.quantity ?? 0}</p>
          <form method="POST" action="?/preview" use:enhance={previewEnhancer('purchase', (formData) => {
            const quantity = Number(formData.get('quantity'));
            return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 20 ? { itemKey: item.itemKey, quantity } : null;
          })}>
            <label class="quantity-label">Quantity <input name="quantity" type="number" min="1" max="20" value="1" /></label>
            <button class="secondary-button" type="submit" disabled={!hydrated || pending}>Buy {item.name}</button>
          </form>
        </article>
      {:else}
        <p class="shop-muted">No goods are stocked in this category today.</p>
      {/each}
    </div>
  </aside>
</section>

{#if message && !preview}
  <p class="shop-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</p>
{/if}

<dialog bind:this={purchaseDialog} class="shop-preview" aria-labelledby="preview-title" aria-busy={pending} onclose={() => { if (!pending) void clearPreview(); }}>
  {#if preview && previewPayload}
    <div class="preview-heading"><p class="eyebrow">Elara's tally</p><h2 id="preview-title">{dialogTitle}</h2></div>
    {#if preview.commandKind === 'purchase' && purchaseSummary(previewPayload)}
      {@const order = purchaseSummary(previewPayload)!}
      <section class="order-summary" aria-label="Purchase summary">
        <div><span>Item</span><strong>{order.name}</strong></div>
        <div><span>Quantity</span><strong>{order.quantity}</strong></div>
        <div><span>Resulting inventory</span><strong>{order.held} → {order.after}</strong></div>
        <div><span>Total</span><strong>{preview.goldCost ?? '…'} gold</strong></div>
      </section>
    {/if}
    <dl>
      {#each Object.entries(preview).filter(([key]) => !['commandKind', 'basedOnRevision', 'rulesVersion', 'normalizedPayload', 'canCommit'].includes(key)) as [key, value]}
        <div><dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt><dd>{displayField(key, value)}</dd></div>
      {/each}
    </dl>
    {#if preview.canCommit === false}
      <p class="form-message error" role="alert">You cannot complete this order with the current gold or capacity.</p>
      <button type="button" class="secondary-button" onclick={closePreview}>Close</button>
    {:else}
      <form method="POST" action="?/command" use:enhance={commitPreview}>
        <button class="primary-button" type="submit" disabled={!hydrated || pending}>{pending ? 'Confirming…' : pendingAction && messageError ? `Retry ${commandLabel(preview.commandKind as ShopCommand)}` : preview.commandKind === 'expand' ? 'Expand garden' : `Buy — ${(preview.goldCost ?? '…')} gold`}</button>
        <button type="button" class="text-button" onclick={closePreview} disabled={pending}>Cancel</button>
      </form>
    {/if}
    {#if message}
      <p class="shop-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</p>
    {/if}
  {/if}
</dialog>

<style>
  .shop-layout { display:grid; grid-template-columns:minmax(175px,.72fr) minmax(0,1.65fr) minmax(275px,.95fr); gap:1rem; align-items:start; }
  .shop-status,.shop-goods { padding:1rem; }
  .shop-status h2,.shop-goods h2,.shop-preview h2 { margin:.2rem 0 .8rem; color:var(--gold-bright); font:600 1rem 'Cinzel',serif; }
  .shop-status dl,.shop-preview dl { display:grid; gap:.55rem; margin:0; }
  .shop-status dl div,.shop-preview dl div { display:flex; justify-content:space-between; gap:.8rem; padding-bottom:.45rem; border-bottom:1px solid #3c2d17; }
  .shop-status dt,.shop-preview dt { color:var(--muted); } .shop-status dd,.shop-preview dd { margin:0; color:var(--gold-bright); text-align:right; }
  .expansion-card { display:grid; gap:.4rem; margin-top:1rem; padding:.8rem; border:1px solid #654b24; background:#110d07; }
  .expansion-card strong { color:var(--gold-bright); font:600 .95rem 'Cinzel',serif; }.expansion-card span{color:#bca476;font-size:.8rem}
  .expansion-card form { margin-top:.25rem; }.shop-muted { margin:.4rem 0; color:var(--muted); font-size:.85rem; }
  .shop-scene { position:relative; display:grid; grid-template-rows:auto minmax(25rem,1fr); min-height:34rem; overflow:hidden; isolation:isolate; background:radial-gradient(circle at 54% 28%,#705025 0%,#281909 52%,#0d0905 100%); }
  .shop-scene-art,.shop-scene-art img { width:100%; height:100%; }.shop-scene-art { position:relative; grid-row:2; z-index:0; overflow:hidden; }.shop-scene-art img { position:absolute; inset:0; }.shop-environment { object-fit:cover; }.shop-merchant { object-fit:cover; object-position:center; }
  .shop-scene-copy { position:relative; grid-row:1; z-index:1; padding:.85rem 1rem; border-bottom:1px solid #6b4e24; background:#100b07; }
  .shop-scene-copy h1 { margin:.25rem 0 .4rem; color:var(--gold-bright); font:600 clamp(1.4rem,3vw,2.2rem) 'Cinzel',serif; }.shop-scene-copy p:last-child{margin:0;color:#d5c092;font-size:1rem;line-height:1.25}
  .merchant-heading { display:flex; align-items:center; gap:.7rem; padding-bottom:.8rem; border-bottom:1px solid #493719; }.merchant-heading img { width:64px; height:64px; border:1px solid #80602d; border-radius:50%; object-fit:cover; background:#302111; }.merchant-heading h2{margin:.1rem 0}.merchant-heading span{color:#a8c877;font-size:.8rem}
  .shop-filters { min-width:0; margin:.8rem 0; padding:0; border:0; }.shop-filters legend { margin-bottom:.5rem; color:var(--gold-bright); font:.72rem 'Cinzel',serif; text-transform:uppercase; letter-spacing:.09em; }.shop-filters>div{display:grid; grid-template-columns:repeat(4,minmax(0,1fr));gap:.25rem}.shop-filters label{position:relative;min-width:0}.shop-filters input{position:absolute;opacity:0}.shop-filters span{display:grid;min-height:2rem;place-items:center;padding:.25rem;border:1px solid #55401e;color:#aa9364;background:#100c07;font-size:.72rem;cursor:pointer}.shop-filters input:checked+span{border-color:var(--gold);color:var(--gold-bright);background:#392813}.shop-filters input:focus-visible+span{outline:3px solid #efcf75;outline-offset:2px}
  .goods-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.5rem; }.good-card { display:grid; grid-template-columns:auto 1fr; gap:.15rem .45rem; min-width:0; padding:.55rem; border:1px solid #4d391e; background:#100c07; }.good-icon { grid-row:span 2; display:grid; width:2rem;height:2rem;place-items:center;border:1px solid #795b28;color:#e0bd65;background:#26190c;font-size:1.15rem }.good-card h3,.good-card p{margin:0;min-width:0}.good-card h3{overflow:hidden;color:#e2c989;font:.7rem 'Cinzel',serif;text-overflow:ellipsis;white-space:nowrap}.good-card p{color:var(--gold);font-size:.75rem}.good-card form{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.35rem;margin-top:.25rem}.quantity-label{display:flex;align-items:center;gap:.25rem;color:var(--muted);font-size:.65rem}.quantity-label input{width:100%;min-width:0;min-height:31px;padding:.15rem .25rem;border:1px solid #624a26;color:var(--ink);background:#090704}.secondary-button{min-height:32px;padding:.3rem .45rem;border:1px solid #70552c;color:#d8bc78;background:#1a1309;font:600 .65rem 'Cinzel',serif;cursor:pointer}.secondary-button:disabled,.primary-button:disabled{cursor:not-allowed;opacity:.55}
  .shop-message { margin:1rem 0 0; padding:.65rem .8rem; border:1px solid #506d35; color:#c6d99a; background:#17200e; }.shop-message.error{border-color:#8c4939;color:#e4a28e;background:#2a110c}
  .shop-preview { width:min(28rem,calc(100% - 2rem)); padding:1.2rem; border:1px solid #87652c; color:var(--ink); background:#171007; box-shadow:0 22px 70px #000c; }.shop-preview::backdrop{background:#000a}.shop-preview form{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1rem}.shop-preview .primary-button,.shop-preview .text-button{min-height:42px;padding:.55rem .8rem;cursor:pointer}.shop-preview .text-button{color:#d8bc78;background:transparent}
  .order-summary { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem;margin:.8rem 0;padding:.7rem;border:1px solid #654b24;background:#0d0905; }.order-summary div{display:grid;gap:.1rem}.order-summary span{color:var(--muted);font-size:.7rem}.order-summary strong{color:var(--gold-bright);font-size:.85rem}
  @media(max-width:1000px){.shop-layout{grid-template-columns:minmax(170px,.7fr) minmax(0,1.3fr)}.shop-goods{grid-column:1/-1}.goods-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.shop-scene{min-height:28rem;grid-template-rows:auto minmax(21rem,1fr)}}
  @media(max-width:620px){.shop-layout{grid-template-columns:1fr;gap:.75rem}.shop-status,.shop-scene,.shop-goods{grid-column:auto}.shop-status{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.shop-status>p,.shop-status>h2{grid-column:1/-1}.shop-status dl{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem}.shop-status dl div{display:grid;gap:.15rem}.shop-status dd{text-align:left}.expansion-card{margin:0}.shop-scene{min-height:25rem;grid-template-rows:auto minmax(17rem,1fr)}.shop-merchant{object-position:52% center}.goods-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.good-card form{grid-template-columns:1fr}.good-card .secondary-button{width:100%}.merchant-heading{position:sticky;top:0;background:var(--panel);z-index:1}.shop-filters>div{grid-template-columns:repeat(4,minmax(0,1fr))}.shop-filters span{font-size:.64rem}.shop-preview{max-height:calc(100dvh - 2rem);overflow:auto}}
</style>
