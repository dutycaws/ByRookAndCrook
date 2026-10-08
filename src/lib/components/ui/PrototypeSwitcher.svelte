<script lang="ts">
import { dev } from '$app/environment';
import { goto } from '$app/navigation';
import { page } from '$app/state';

type Props<T extends string> = {
  variants: readonly T[];
  current: T;
  variantNames?: Partial<Record<T, string>>;
};
let { variants, current, variantNames = {} }: Props<string> = $props();

  function select(next: string) {
    const url = new URL(page.url);
    url.searchParams.set('variant', next);
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function step(direction: number) {
    const index = variants.indexOf(current);
    const next = variants[(index + direction + variants.length) % variants.length];
    if (next) select(next);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [data-prototype-wheel]')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if dev}
  <nav class="prototype-switcher" aria-label="Prototype layout variants">
    <div class="variant-controls">
      <button type="button" aria-label="Previous layout" onclick={() => step(-1)}>←</button>
      <span aria-live="polite">{current}{variantNames[current] ? ` · ${variantNames[current]}` : ''}</span>
      <button type="button" aria-label="Next layout" onclick={() => step(1)}>→</button>
    </div>
  </nav>
{/if}

<style>
  .prototype-switcher { position: fixed; z-index: 100; left: 50%; bottom: max(.8rem, env(safe-area-inset-bottom)); display: flex; align-items: center; gap: .55rem; min-height: 2.65rem; padding: .3rem .42rem; border: 1px solid rgba(233, 196, 119, .7); border-radius: 999px; color: #f1e5c8; background: rgba(20, 15, 9, .94); box-shadow: 0 8px 28px rgba(0,0,0,.5); transform: translateX(-50%); backdrop-filter: blur(10px); }
  .variant-controls { display: flex; align-items: center; justify-content: center; gap: .55rem; }
  .variant-controls > span { min-width: 7rem; text-align: center; font-size: .72rem; font-weight: 650; }
  .variant-controls button { display: grid; width: 1.9rem; height: 1.9rem; place-items: center; border: 0; border-radius: 50%; color: #21180d; background: #dfbd76; font-size: 1rem; }
  .variant-controls button:hover { background: #f2d794; }
  .variant-controls button:focus-visible { outline: 2px solid #fff1cb; outline-offset: 2px; }
</style>
