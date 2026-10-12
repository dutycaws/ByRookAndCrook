<script lang="ts">
  export type TabOption = { id: string; label: string; disabled?: boolean };

  let {
    id,
    label,
    tabs,
    value = $bindable(tabs[0]?.id ?? '')
  }: {
    id: string;
    label: string;
    tabs: TabOption[];
    value?: string;
  } = $props();

  let tabButtons = $state<HTMLButtonElement[]>([]);
  let activeId = $derived(tabs.find((tab) => tab.id === value && !tab.disabled)?.id ?? tabs.find((tab) => !tab.disabled)?.id ?? '');

  $effect(() => {
    if (value !== activeId) value = activeId;
  });

  function onKeydown(event: KeyboardEvent) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key) || tabs.length === 0) return;
    const enabled = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !tab.disabled);
    if (enabled.length === 0) return;

    const current = enabled.findIndex(({ tab }) => tab.id === activeId);
    let next = current < 0 ? 0 : current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else if (event.key === 'ArrowRight') next = (next + 1) % enabled.length;
    else next = (next - 1 + enabled.length) % enabled.length;

    event.preventDefault();
    const target = enabled[next];
    value = target.tab.id;
    tabButtons[target.index]?.focus();
  }
</script>

<div class="ui-tabs" role="tablist" aria-label={label} tabindex="-1" onkeydown={onKeydown}>
  {#each tabs as tab, index (tab.id)}
    <button
      bind:this={tabButtons[index]}
      id={`${id}-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={activeId === tab.id}
      aria-controls={`${id}-panel`}
      tabindex={activeId === tab.id ? 0 : -1}
      disabled={tab.disabled}
      onclick={() => (value = tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .ui-tabs {
    display: flex;
    gap: .25rem;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid rgb(193 159 94 / .28);
    scrollbar-width: thin;
  }

  .ui-tabs button {
    position: relative;
    flex: 0 0 auto;
    min-height: 2.75rem;
    padding: .55rem .85rem;
    border: 0;
    color: #b9aa88;
    background: transparent;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .ui-tabs button::after {
    position: absolute;
    right: .75rem;
    bottom: -1px;
    left: .75rem;
    height: 2px;
    content: '';
    background: transparent;
    transition: background-color 150ms ease;
  }

  .ui-tabs button[aria-selected='true'] { color: #f0d27a; }
  .ui-tabs button[aria-selected='true']::after { background: #d6ae55; }
  .ui-tabs button:hover:not(:disabled) { color: #f4e3b0; background: rgb(237 208 131 / .06); }
  .ui-tabs button:focus-visible { z-index: 1; outline: 2px solid #f0d27a; outline-offset: -3px; }
  .ui-tabs button:disabled { color: #776c57; cursor: not-allowed; }

  @media (prefers-reduced-motion: reduce) {
    .ui-tabs button, .ui-tabs button::after { transition: none; }
  }
</style>
