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
