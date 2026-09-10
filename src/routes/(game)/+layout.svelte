<script lang="ts">
  import TavernHeader from '$lib/components/tavern/TavernHeader.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<div class="game-shell">
  <TavernHeader userEmail={data.userEmail} />

  {@render children()}
</div>
