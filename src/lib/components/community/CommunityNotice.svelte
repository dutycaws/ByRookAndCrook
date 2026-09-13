<script lang="ts">let { tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: import('svelte').Snippet } = $props();</script>
<div class:community-error={tone === 'error'} class:community-success={tone === 'success'} class="community-notice" role={tone === 'error' ? 'alert' : 'status'}>{@render children()}</div>
