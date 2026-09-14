<script lang="ts">
  import { publicCodexGroup, type PublicCodexEntity, type PublicCodexGroup } from '$lib/game/evolving-world';

  let { entities }: { entities: PublicCodexEntity[] } = $props();
  const groups: Array<{ key: PublicCodexGroup; label: string }> = [
    { key: 'people', label: 'People' }, { key: 'locations', label: 'Locations' },
    { key: 'factions', label: 'Factions' }, { key: 'items', label: 'Items' },
    { key: 'recipes', label: 'Recipes' }, { key: 'events', label: 'Events' }
  ];
</script>

<div class="codex-groups">
  {#each groups as group (group.key)}
    {@const entries = entities.filter((entity) => publicCodexGroup(entity.kind) === group.key)}
    <section class="codex-group" aria-labelledby={`codex-${group.key}`}>
      <div class="codex-group-heading"><h2 id={`codex-${group.key}`}>{group.label}</h2><span>{entries.length}</span></div>
      {#if entries.length === 0}
        <p class="muted codex-placeholder">No discoveries recorded yet.</p>
      {:else}
        <ul class="codex-entity-list">
          {#each entries as entity (entity.id)}
            <li>
              <article>
                <div class="codex-entity-art" aria-label={`${entity.kind} illustration`}>
                  {#if entity.art.status === 'accepted' && entity.art.previewUrl}
                    <img src={entity.art.previewUrl} alt={`${entity.title}, ${entity.kind} illustration`} />
                  {:else}
                    <span aria-hidden="true">{entity.kind}</span>
                    <span class="sr-only">Illustration for {entity.title} is not available yet.</span>
                  {/if}
                </div>
                <p class="eyebrow">Discovered day {entity.day}</p>
                <h3>{entity.title}</h3>
                <p>{entity.summary}</p>
                <small>Recorded through a public discovery.</small>
              </article>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>

<style>
  .codex-entity-art { display:grid; place-items:center; width:100%; aspect-ratio:16 / 9; margin-bottom:.75rem; overflow:hidden; border:1px solid rgba(194,148,53,.55); background:linear-gradient(135deg, rgba(90,61,22,.85), rgba(27,19,9,.95)); color:#e8cc84; text-transform:capitalize; font-family:'Cinzel', serif; }
  .codex-entity-art img { width:100%; height:100%; object-fit:cover; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
