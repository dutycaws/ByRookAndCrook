<script lang="ts">
  import { setContext } from 'svelte';
  import { SETTLEMENT_USER_ID_CONTEXT } from '$lib/game/settlement-context';
  import TavernHeader from '$lib/components/tavern/TavernHeader.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  setContext(SETTLEMENT_USER_ID_CONTEXT, () => data.userId);
</script>

<div class="game-shell">
  <TavernHeader userEmail={data.userEmail} capabilities={data.community.capabilities} />

  {@render children()}
</div>
