<script lang="ts">
  import type { Patron } from '$lib/game/serving';
  import type { Journal } from '$lib/game/dialogue';

  let { patron, journal, day }: { patron: Patron; journal: Journal; day: number } = $props();
  const firstPartyScenes: Record<string, string> = {
    '18181818-1818-4181-8181-181818181818': '/assets/scenes/lira-tavern.webp',
    '28282828-2828-4282-8282-282828282828': '/assets/scenes/torvin-tavern.webp'
  };
  /** Storage keys are resolved by the local fixture/runtime asset adapter. */
  function resolveScene(storageKey: string | null, npcId: string) {
    if (firstPartyScenes[npcId]) return firstPartyScenes[npcId];
    if (!storageKey) return null;
    // Fixture media can register a browser-safe runtime URL here.  A private
    // storage key alone is deliberately not treated as a public URL.
    return storageKey.startsWith('/') || storageKey.startsWith('http') ? storageKey : null;
  }
  let latest = $derived(journal.turns.at(-1));
  let scene = $derived(resolveScene(patron.sceneStorageKey, patron.npcId));
  let imageFailed = $state(false);
  $effect(() => { patron.instanceId; imageFailed = false; });
</script>

<figure class="tavern-scene" aria-labelledby="scene-patron-name">
  {#if scene && !imageFailed}<img src={scene} alt={`${patron.name} seated in the candlelit tavern`} onerror={() => imageFailed = true} />
  {:else}<div class="scene-fallback" role="img" aria-label={`${patron.name}'s tavern scene is not available`}><span aria-hidden="true">✦</span><p>{patron.name}</p><small>Guest of the common room</small></div>{/if}
  <div class="scene-vignette" aria-hidden="true"></div>
  <p class="bar-context-line">The common room · Day {day}</p>
  <figcaption class="scene-dialogue">
    <div><strong id="scene-patron-name">{patron.name}</strong><span>{patron.title}</span><span class="scene-facts">Relationship {patron.relationship} / 100{journal.questStatus==='active'?` · ${journal.risk} risk`:''}</span></div>
    <p>{latest?.reply ?? (journal.intention ? `${journal.intention.goal} — ${journal.intention.motivation}` : patron.description)}</p>
  </figcaption>
</figure>
