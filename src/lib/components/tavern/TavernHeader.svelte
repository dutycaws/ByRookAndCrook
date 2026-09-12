<script lang="ts">
  import { page } from '$app/state';

  let { userEmail }: { userEmail: string } = $props();
  const primary = [
    { href: '/garden', label: 'Garden', icon: 'leaf' },
    { href: '/bar', label: 'Bar', icon: 'mug' },
    { href: '/brewery', label: 'Brewery', icon: 'barrel' },
    { href: '/bakery', label: 'Bakery', icon: 'bread' },
    { href: '/shop', label: 'Shop', icon: 'satchel' }
  ] as const;
</script>

<header class="game-header">
  <a class="brand" href="/garden" aria-label="By Rook and Crook garden">
    <span class="brand-mark" aria-hidden="true">
      <img src="/raven.svg" alt="" width="34" height="34" />
    </span>
    <span class="brand-name"><small>THE</small><strong>Rook &amp; Crook</strong></span>
  </a>

  <nav aria-label="Tavern areas">
    {#each primary as item}
      <a href={item.href} class:active={page.url.pathname === item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {#if item.icon === 'leaf'}
            <path d="M19.5 3.5C12 4 7.5 7.5 6.5 14.5M5 21c1-6.5 5.5-11 12-13M7 15c-2.5 0-4.5-1.2-5-3.5 3.5-.7 6 .2 7.5 2.5M12 10c-.3-3.4 1.1-6 4-7.5 1.4 3.3.7 6.1-2 8.5" />
          {:else if item.icon === 'mug'}
            <path d="M5 5h11v13H5zM16 8h2.5a2.5 2.5 0 0 1 0 5H16M7.5 2.5v2M11 2.5v2M14.5 2.5v2M3 20.5h15" />
          {:else if item.icon === 'barrel'}
            <path d="M6 4c3-1.3 9-1.3 12 0v16c-3 1.3-9 1.3-12 0zM6 8h12M6 16h12M9 3.2l-1 17.6M15 3.2l1 17.6" />
          {:else if item.icon === 'satchel'}
            <path d="M5 8.5h14v11H5zM8.5 8.5V6.7A3.5 3.5 0 0 1 12 3.2a3.5 3.5 0 0 1 3.5 3.5v1.8M5 12.5h14M10 12.5v1.8h4v-1.8" />
          {:else}
            <path d="M4 13c0-3 2.2-5 5-5 .8-3 5.7-3.2 7 0 2.3.3 4 2.2 4 4.5V19H4zM8 12v4M12 10v6M16 12v4" />
          {/if}
        </svg>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="account">
    <a class="pantry-link" href="/ingredients" aria-label="Pantry" class:active={page.url.pathname === '/ingredients'} aria-current={page.url.pathname === '/ingredients' ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v12H4zM7 4h10l2 4H5zM8 12h3M13 12h3M8 16h3" /></svg>
      <span>Pantry</span>
    </a>
    <details class="account-menu">
      <summary aria-label="Keeper menu"><span aria-hidden="true">K</span></summary>
      <div><small>{userEmail}</small><a class="account-pantry-link" href="/ingredients">Open pantry</a><form method="POST" action="/garden?/signout"><button class="text-button" type="submit">Sign out</button></form></div>
    </details>
  </div>
</header>
