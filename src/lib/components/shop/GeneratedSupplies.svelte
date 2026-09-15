<script lang="ts">
  import type { GeneratedSupplies } from '$lib/server/evolving-world/generated-supplies';
  let { supplies, saveId, revision, form }: { supplies: GeneratedSupplies; saveId: string; revision: number; form?: { message?: string; error?: boolean } | null } = $props();
  function prepareAction(event: SubmitEvent) {
    const actionId = (event.currentTarget as HTMLFormElement).elements.namedItem('actionId');
    if (actionId instanceof HTMLInputElement) actionId.value = crypto.randomUUID();
  }
</script>

<section class="generated-supplies panel" aria-labelledby="generated-supplies-title">
  <header><p class="eyebrow">Settlement discoveries</p><h2 id="generated-supplies-title">New provisions</h2><p>These supplies were discovered by your tavern’s evolving world.</p></header>
  {#if supplies.successorQuest}
    <aside class="quest" aria-label="Active successor quest"><strong>Successor quest</strong><span>{supplies.successorQuest.summary}</span><small>{supplies.successorQuest.suppliesUsed} provisions prepared</small></aside>
  {:else}<p class="muted">A provision becomes useful when a successor quest is active.</p>{/if}
  <div class="supply-grid">
    {#each supplies.catalog as item (item.entityId)}
      <article><h3>{item.name}</h3><p>{item.price} gold · {item.remainingStock} of {item.dailyStock} stocked</p>
        <form method="POST" action="?/purchaseGeneratedSupply" onsubmit={prepareAction}>
          <input type="hidden" name="saveId" value={saveId} /><input type="hidden" name="expectedRevision" value={revision} /><input type="hidden" name="actionId" /><input type="hidden" name="itemKey" value={item.itemKey} />
          <button class="secondary-button" type="submit" disabled={item.remainingStock === 0}>Buy provision</button>
        </form>
      </article>
    {:else}<p class="muted">No settlement provisions are available yet.</p>{/each}
  </div>
  {#if supplies.inventory.length}
    <h3>Your provisions</h3>
    <ul>{#each supplies.inventory as item (item.entityId)}<li><span>{item.quantity} × {item.name}</span>
      {#if supplies.successorQuest}<form method="POST" action="?/useGeneratedSupply" onsubmit={prepareAction}><input type="hidden" name="saveId" value={saveId} /><input type="hidden" name="expectedRevision" value={revision} /><input type="hidden" name="actionId" /><input type="hidden" name="itemKey" value={item.itemKey} /><input type="hidden" name="questId" value={supplies.successorQuest.questId} /><button class="text-button" type="submit">Prepare for quest</button></form>{/if}
    </li>{/each}</ul>
  {/if}
  {#if form?.message}<p class:error={form.error} class="message" role={form.error ? 'alert' : 'status'}>{form.message}</p>{/if}
</section>
<style>
  .generated-supplies { margin:1rem auto; max-width:1100px; padding:1rem; } header p { margin:.25rem 0; } .quest { display:grid; gap:.2rem; margin:.8rem 0; padding:.7rem; border:1px solid #506d35; background:#17200e; } .quest small,.muted { color:var(--muted); } .supply-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:.7rem; } article { padding:.75rem; border:1px solid #55401e; background:#100c07; } article h3 { margin:0; } ul { padding:0; list-style:none; } li { display:flex; justify-content:space-between; align-items:center; gap:.7rem; padding:.5rem 0; border-bottom:1px solid #3b2a15; } .message { margin:.8rem 0 0; color:#c6d99a; } .message.error { color:#e4a28e; }
</style>
