<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  type BarPrototypeVariant = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

  const variants: { key: BarPrototypeVariant; name: string }[] = [
    { key: 'B', name: 'Top ledger' },
    { key: 'E', name: 'Right folio' },
    { key: 'F', name: 'Left folio' }
  ];

  let {
    current,
    state,
    onreset,
    onvariantchange
  }: {
    current: BarPrototypeVariant;
    state: () => Record<string, unknown>;
    onreset: () => void;
    onvariantchange: (variant: BarPrototypeVariant | null) => void;
  } = $props();

  let stateText = $derived(JSON.stringify(state(), null, 2));

  function updateUrl(variant: BarPrototypeVariant | null) {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (variant) params.set('variant', variant);
    else params.delete('variant');
    replaceState(url, page.state);
  }

  function change(direction: number) {
    const currentIndex = variants.findIndex((variant) => variant.key === current);
    const next = variants[(currentIndex + direction + variants.length) % variants.length];
    console.log('[bar prototype] variant switched', { ...state(), variant: next.key });
    updateUrl(next.key);
    onvariantchange(next.key);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable="true"], [data-prototype-cardrail], [role="listbox"]')
    ) return;
    event.preventDefault();
    change(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function exitPrototype() {
    updateUrl(null);
    onvariantchange(null);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if import.meta.env.DEV}
  <nav class="prototype-switcher" aria-label="Bar prototype variants">
    <button type="button" aria-label="Previous variant" onclick={() => change(-1)}>←</button>
    <span class="variant-name"><strong>{current}{variants.some((variant) => variant.key === current) ? ' · B foundation' : ''}</strong><span>{variants.find((variant) => variant.key === current)?.name ?? 'Earlier comparison'}</span></span>
    <button type="button" aria-label="Next variant" onclick={() => change(1)}>→</button>
    <details class="prototype-tools">
      <summary aria-label="Show prototype state and controls">⋯</summary>
      <div class="tools-content">
        <p class="prototype-label">PROTOTYPE · LOCAL ONLY</p>
        <pre>{stateText}</pre>
        <div class="tool-actions">
          <button type="button" onclick={onreset}>Reset demo</button>
          <button type="button" onclick={exitPrototype}>Clear prototype</button>
        </div>
      </div>
    </details>
  </nav>
{/if}

<style>
  .prototype-switcher { position: fixed; z-index: 80; right: 50%; bottom: max(.75rem, env(safe-area-inset-bottom)); display: flex; min-height: 3rem; align-items: center; gap: .65rem; padding: .35rem .45rem; border: 1px solid #b48a3d; border-radius: 999px; color: #f8edcf; background: rgb(18 13 7 / .97); box-shadow: 0 8px 28px rgb(0 0 0 / .55); transform: translateX(50%); }
  .prototype-switcher > button { display: grid; width: 2.25rem; height: 2.25rem; place-items: center; border: 1px solid #6c5427; border-radius: 50%; color: inherit; background: #32230f; font: 1.1rem Georgia, serif; cursor: pointer; }
  .prototype-switcher button:hover { border-color: #e0bd69; background: #493414; }
  .prototype-switcher button:focus-visible, .prototype-tools summary:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .variant-name { display: grid; min-width: 10rem; text-align: center; line-height: 1.15; }
  .variant-name strong { color: #f0d27a; font: 700 .72rem 'Cinzel', Georgia, serif; }
  .variant-name span { font-size: .72rem; }
  .prototype-tools { position: relative; margin-right: .15rem; }
  .prototype-tools summary { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: 50%; color: #d7c391; cursor: pointer; list-style: none; }
  .prototype-tools summary::-webkit-details-marker { display: none; }
  .tools-content { position: absolute; right: -.35rem; bottom: calc(100% + .7rem); width: min(27rem, calc(100vw - 1.25rem)); max-height: min(60vh, 34rem); padding: .75rem; overflow: auto; border: 1px solid #92703a; border-radius: .8rem; background: #151008; box-shadow: 0 8px 28px rgb(0 0 0 / .55); }
  .prototype-label { margin: 0 0 .5rem; color: #e1c475; font: 700 .68rem 'Cinzel', Georgia, serif; letter-spacing: .08em; }
  .tools-content pre { max-height: 42vh; margin: 0; overflow: auto; color: #e4dac1; font: .68rem/1.4 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .tool-actions { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .7rem; }
  .tool-actions button { min-height: 2.25rem; padding: .4rem .7rem; border: 1px solid #806631; border-radius: .35rem; color: #f2e6c6; background: #34240f; font: inherit; cursor: pointer; }
  @media (max-width: 440px) {
    .prototype-switcher { gap: .35rem; padding-inline: .35rem; }
    .variant-name { min-width: 8rem; }
    .variant-name span { max-width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
</style>
