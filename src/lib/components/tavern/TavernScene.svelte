<script lang="ts">
  import type { Patron } from '$lib/game/serving';
  import type { Journal } from '$lib/game/dialogue';

  let { patron, journal, day }: { patron: Patron; journal: Journal; day: number } = $props();
  const sceneByPatron: Record<string, string> = {
    lira: '/assets/scenes/lira-tavern.webp',
    torvin: '/assets/scenes/torvin-tavern.webp'
  };
  let latest = $derived(journal.turns.at(-1));
</script>

<figure class="tavern-scene" aria-labelledby="scene-patron-name">
  <img src={sceneByPatron[patron.key] ?? sceneByPatron.lira} alt={`${patron.name} seated in the candlelit tavern`} />
  <div class="scene-vignette" aria-hidden="true"></div>
  <p class="bar-context-line">The common room · Day {day}</p>
  <figcaption class="scene-dialogue">
    <div><strong id="scene-patron-name">{patron.name}</strong><span>{patron.title}</span><span class="scene-facts">Relationship {patron.relationship} / 100{journal.questStatus==='active'?` · ${journal.risk} risk`:''}</span></div>
    <p>{latest?.reply ?? (journal.intention ? `${journal.intention.goal} — ${journal.intention.motivation}` : patron.story)}</p>
  </figcaption>
</figure>
