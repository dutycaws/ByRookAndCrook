<script lang="ts">
  import DeveloperInspectorPanels from '$lib/components/world/DeveloperInspectorPanels.svelte';
  import type { PageData } from './$types';
  let { data, form }: { data:PageData; form:{message?:string}|null } = $props();
</script>
<svelte:head><title>Local world inspector · By Rook and Crook</title></svelte:head>
<main class="inspector-page"><header class="panel"><p class="eyebrow">Development only</p><h1>World inspector</h1><p>Operational metadata and narrowly audited local recovery actions. This view intentionally omits model inputs, private cognition, payloads, and storage access.</p></header>{#if form?.message}<p class="form-message" role="status">{form.message}</p>{/if}<DeveloperInspectorPanels inspector={data.inspector}/></main>
<style>.inspector-page{width:min(1120px,calc(100% - 2rem));margin:2rem auto 4rem}.inspector-page header{padding:1.25rem}.inspector-page h1{margin:.2rem 0}.inspector-page header p:last-child{max-width:54rem;color:var(--ink-muted,#cdbd96)}</style>
