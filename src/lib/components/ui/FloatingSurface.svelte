<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type SurfaceElement = 'div' | 'section' | 'aside';
  type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
    as?: SurfaceElement;
    children: Snippet;
  };

  let { as = 'div', children, class: className = '', ...attributes }: Props = $props();
</script>

<svelte:element this={as} class="floating-surface {className}" {...attributes}>
  {@render children()}
</svelte:element>

<style>
  .floating-surface {
    color: #eee2c3;
    background: rgb(18 12 8 / .6);
    border: 1px solid rgb(193 159 94 / .38);
    border-radius: .65rem;
    box-shadow: 0 12px 32px rgb(0 0 0 / .28), inset 0 1px 0 rgb(255 230 170 / .035);
    scrollbar-color: #72562c transparent;
    scrollbar-width: thin;
    -webkit-backdrop-filter: blur(7px);
    backdrop-filter: blur(7px);
    animation: floating-surface-enter 180ms ease-out both;
  }

  @keyframes floating-surface-enter {
    from { opacity: 0; translate: 0 4px; }
    to { opacity: 1; translate: 0 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .floating-surface { animation: none; }
  }
</style>
