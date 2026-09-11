<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    x,
    y,
    width,
    height,
    selected = false,
    disabled = false,
    children,
    onactivate
  }: {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    selected?: boolean;
    disabled?: boolean;
    children?: Snippet;
    onactivate: () => void;
  } = $props();
</script>

<button
  type="button"
  class:selected
  {disabled}
  aria-label={label}
  aria-pressed={selected}
  style={`left:${x}px;top:${y}px;width:${width}px;height:${height}px`}
  onclick={onactivate}
>
  {#if children}{@render children()}{/if}
</button>

<style>
  button {
    position: absolute;
    z-index: 30;
    display: grid;
    min-width: 44px;
    min-height: 44px;
    place-items: center;
    padding: 0;
    border: 2px solid transparent;
    color: inherit;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
  }
  button:hover,
  button.selected { border-color: #e6c46d; background: #c894351a; }
  button:focus-visible { outline: 4px solid #fff0ad; outline-offset: 3px; }
  button:disabled { cursor: wait; opacity: .6; }
</style>
