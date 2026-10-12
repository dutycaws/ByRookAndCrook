<script lang="ts">
  import type { Journal } from '$lib/game/dialogue';

  let { name, turn }: { name: string; turn: Journal['turns'][number] } = $props();
</script>

<article class="resident-exchange" aria-label={`Latest exchange with ${name}`}>
  <p class="keeper-message" title={turn.message}><strong>You</strong> {turn.message}</p>
  <p class="resident-reply"><strong>{name}</strong> {turn.reply}</p>
</article>

<style>
  .resident-exchange { display: grid; gap: .45rem; min-width: 0; }
  p { margin: 0; overflow-wrap: anywhere; line-height: 1.5; }
  strong { color: #dfc27b; font-weight: 600; }
  .keeper-message { color: #c1b293; font-size: .78rem; }
  .resident-reply { color: #eee2c3; font-size: .9rem; }
  @media (max-width: 520px) {
    .keeper-message { display: -webkit-box; -webkit-box-orient: vertical; line-clamp: 2; -webkit-line-clamp: 2; overflow: hidden; }
  }
</style>
