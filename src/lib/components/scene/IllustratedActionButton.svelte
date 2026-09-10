<script lang="ts">
  import type { Snippet } from 'svelte';
  let { type = 'button', disabled = false, loading = false, icon = '◆', children, onclick }: {
    type?: 'button' | 'submit';
    disabled?: boolean;
    loading?: boolean;
    icon?: string;
    children: Snippet;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<button {type} disabled={disabled || loading} aria-busy={loading} {onclick}>
  <span aria-hidden="true">{loading ? '◌' : icon}</span>
  <strong>{@render children()}</strong>
</button>

<style>
  button {
    display: inline-grid;
    width: 100%;
    grid-template-columns: auto 1fr;
    align-items: center;
    min-width: 11rem;
    min-height: 48px;
    gap: .65rem;
    padding: .65rem .9rem;
    border: 1px solid #b38737;
    color: #f0d295;
    background: linear-gradient(180deg, #243219, #11180d);
    box-shadow: inset 0 0 0 2px #0b0d07, inset 0 1px #f2cc6940;
    font-family: 'Cinzel', serif;
    cursor: pointer;
    touch-action: manipulation;
  }
  button:hover:not(:disabled) { color: #fff0b6; border-color: #e6c46d; filter: brightness(1.08); }
  button:disabled { cursor: wait; opacity: .55; }
  span { color: #e6c46d; font-size: 1.1rem; }
  button[aria-busy='true'] span { animation: spin 800ms linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { button[aria-busy='true'] span { animation: none; } }
</style>
