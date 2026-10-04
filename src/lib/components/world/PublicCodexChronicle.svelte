<script lang="ts">
  import type { PublicCodexDisposition, PublicCodexEvent } from '$lib/game/evolving-world';

  let { events, dispositions }: { events: PublicCodexEvent[]; dispositions: PublicCodexDisposition[] } = $props();
</script>

<section class="panel codex-chronicle" aria-labelledby="world-chronicle-title">
  <p class="eyebrow">Shared record</p><h2 id="world-chronicle-title">Recent changes</h2>
  {#if events.length === 0 && dispositions.length === 0}
    <p class="muted">The chronicle will fill as the tavern’s world changes.</p>
  {:else}
    <ol>
      {#each events as event (`event-${event.id}-${event.day}`)}
        <li><p class="eyebrow">Day {event.day} · Public event</p><h3>{event.title}</h3><p>{event.summary}</p><small>Recorded through the public event register.</small></li>
      {/each}
      {#each dispositions as disposition (`resident-${disposition.instanceId}-${disposition.day}-${disposition.provenance.profileRevision}`)}
        <li><p class="eyebrow">Day {disposition.day} · {disposition.name}</p><h3>{disposition.state}</h3><p>{disposition.summary}</p><small>Attributed to {disposition.name}{disposition.title ? `, ${disposition.title}` : ''}.</small></li>
      {/each}
    </ol>
  {/if}
</section>
