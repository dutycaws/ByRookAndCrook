<script lang="ts">
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<div class="game-shell">
  <header class="game-header">
    <a class="brand" href="/garden" aria-label="By Rook and Crook garden">
      <span class="brand-mark" aria-hidden="true">♜</span>
      <span>
        <small>THE</small>
        <strong>Rook &amp; Crook</strong>
      </span>
    </a>

    <nav aria-label="Tavern areas">
      <a href="/garden" class:active={page.url.pathname === '/garden'}>Garden</a>
      <a href="/ingredients" class:active={page.url.pathname === '/ingredients'}>Ingredients</a>
    </nav>

    <div class="account">
      <span title={data.userEmail}>{data.userEmail}</span>
      <form method="POST" action="/garden?/signout">
        <button class="text-button" type="submit">Sign out</button>
      </form>
    </div>
  </header>

  {@render children()}
</div>
