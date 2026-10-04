<script lang="ts">
  let { capabilities, unread = 0 }: { capabilities: string[]; unread?: number } = $props();
  const can = (value: string) => capabilities.includes('admin') || capabilities.includes(value);
</script>
<div class="community-links">
  {#if can('npc_author')}<a href="/authoring/npcs">Creator studio</a>{/if}
  {#if can('npc_reviewer')}<a href="/admin/npcs">Review desk</a>{/if}
  {#if can('prompt_manager')}<a href="/admin/prompts">Prompt registry</a>{/if}
  <a href="/inbox">Inbox{#if unread}<b>{unread}</b>{/if}</a><a href="/settings/profile">Profile</a>
</div>
