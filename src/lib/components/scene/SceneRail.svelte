<script lang="ts">
  import type { Snippet } from 'svelte';
  let { eyebrow, title, kind = 'status', children }: {
    eyebrow: string;
    title: string;
    kind?: 'status' | 'inspector';
    children: Snippet;
  } = $props();
</script>

<aside class="scene-rail {kind}" data-scene-rail={kind} aria-label={title}>
  <header><p>{eyebrow}</p><h2>{title}</h2></header>
  <div class="rail-content">{@render children()}</div>
</aside>

<style>
  .scene-rail {
    min-width: 0;
    border: 1px solid #493719;
    color: #ead8a6;
    background: linear-gradient(145deg, #ffffff08, transparent 35%), #151008;
    box-shadow: 0 22px 60px #00000047;
  }
  header { padding: 1rem 1.1rem; border-bottom: 1px solid #493719; }
  header p { margin: 0; color: #c89435; font: 600 .62rem 'Cinzel', serif; letter-spacing: .16em; text-transform: uppercase; }
  h2 { margin: .25rem 0 0; color: #e6c46d; font: 600 1rem 'Cinzel', serif; }
  .rail-content { min-width: 0; padding: 1rem; }
</style>
