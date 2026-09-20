<script lang="ts">
  type SectionItem = {
    id: string;
    label: string;
    description?: string;
    href: string;
    count?: number | string;
    status?: string;
  };

  let {
    items,
    active,
    label
  }: {
    items: SectionItem[];
    active: string;
    label: string;
  } = $props();

  const currentItem = $derived(items.find((item) => item.id === active) ?? items[0]);
</script>

<nav class="privileged-section-nav" aria-label={label}>
  <div class="privileged-section-nav-desktop">
    <span class="privileged-section-nav-label">{label}</span>
    <div class="privileged-section-nav-list">
      {#each items as item (item.id)}
        <a href={item.href} aria-current={item.id === active ? 'page' : undefined}>
          <span class="privileged-section-nav-copy">
            <strong>{item.label}</strong>
            {#if item.description}<small>{item.description}</small>{/if}
          </span>
          {#if item.count !== undefined || item.status}
            <span class="privileged-section-nav-meta">
              {#if item.count !== undefined}<b>{item.count}</b>{/if}
              {#if item.status}<em>{item.status}</em>{/if}
            </span>
          {/if}
        </a>
      {/each}
    </div>
  </div>

  <details class="privileged-section-nav-mobile">
    <summary>
      <span>
        <small>{label}</small>
        <strong>{currentItem?.label ?? 'Choose a section'}</strong>
      </span>
      <span aria-hidden="true">Browse</span>
    </summary>
    <div class="privileged-section-nav-menu">
      {#each items as item (item.id)}
        <a href={item.href} aria-current={item.id === active ? 'page' : undefined}>
          <span class="privileged-section-nav-copy">
            <strong>{item.label}</strong>
            {#if item.description}<small>{item.description}</small>{/if}
          </span>
          {#if item.count !== undefined || item.status}
            <span class="privileged-section-nav-meta">
              {#if item.count !== undefined}<b>{item.count}</b>{/if}
              {#if item.status}<em>{item.status}</em>{/if}
            </span>
          {/if}
        </a>
      {/each}
    </div>
  </details>
</nav>

<style>
  .privileged-section-nav { min-width: 0; }
  .privileged-section-nav-label { display: block; margin: 0 0 .55rem; color: var(--gold); font-family: 'Cinzel', serif; font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; }
  .privileged-section-nav-list { display: grid; gap: .4rem; }
  a { display: flex; align-items: center; justify-content: space-between; gap: .6rem; min-height: 44px; padding: .6rem .7rem; border: 1px solid transparent; color: #c6b48b; background: rgb(10 8 5 / .4); text-decoration: none; }
  a:hover { border-color: #715426; background: rgb(71 48 15 / .25); }
  a[aria-current='page'] { border-color: #c99a3d; color: #f1d27a; background: linear-gradient(110deg, rgb(72 50 17 / .62), rgb(23 16 8 / .72)); }
  a:focus-visible, summary:focus-visible { outline: 3px solid rgb(230 196 109 / .65); outline-offset: 2px; }
  .privileged-section-nav-copy { display: grid; gap: .12rem; min-width: 0; }
  .privileged-section-nav-copy strong { font-family: 'Cinzel', serif; font-size: .86rem; }
  .privileged-section-nav-copy small { color: var(--muted); font-size: .76rem; line-height: 1.3; }
  .privileged-section-nav-meta { display: grid; justify-items: end; gap: .12rem; flex: none; }
  .privileged-section-nav-meta b { min-width: 1.5rem; color: #f0d383; font-family: 'Cinzel', serif; font-size: .82rem; text-align: center; }
  .privileged-section-nav-meta em { color: #9fca7c; font-size: .7rem; font-style: normal; text-transform: uppercase; }
  .privileged-section-nav-mobile { display: none; }

  @media (max-width: 899px) {
    .privileged-section-nav-desktop { display: none; }
    .privileged-section-nav-mobile { display: block; border: 1px solid rgb(111 82 31 / .68); background: rgb(13 10 6 / .9); }
    summary { display: flex; align-items: center; justify-content: space-between; gap: .8rem; min-height: 44px; padding: .55rem .7rem; scroll-margin-block-start: 5rem; color: #f1d27a; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary > span:first-child { display: grid; gap: .1rem; }
    summary small { color: var(--gold); font-family: 'Cinzel', serif; font-size: .66rem; letter-spacing: .09em; text-transform: uppercase; }
    summary strong { font-family: 'Cinzel', serif; font-size: .9rem; }
    summary > span:last-child { color: #d5bd78; font-size: .8rem; }
    .privileged-section-nav-menu { display: grid; gap: .35rem; padding: .35rem; border-top: 1px solid rgb(111 82 31 / .68); }
  }
</style>
