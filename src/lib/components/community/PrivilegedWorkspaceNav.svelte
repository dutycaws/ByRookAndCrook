<script lang="ts">
  let {
    capabilities,
    current
  }: {
    capabilities: string[];
    current: 'authoring' | 'review' | 'prompts';
  } = $props();

  const can = (capability: string) => capabilities.includes(capability) || capabilities.includes('admin');
  const destinations = [
    { id: 'authoring', label: 'Creator studio', description: 'Author and submit NPCs', href: '/authoring/npcs', capability: 'npc_author' },
    { id: 'review', label: 'Review desk', description: 'Review and govern NPCs', href: '/admin/npcs', capability: 'npc_reviewer' },
    { id: 'prompts', label: 'Prompt registry', description: 'Inspect and release prompts', href: '/admin/prompts', capability: 'prompt_manager' }
  ] as const;
</script>

<nav class="privileged-workspace-nav" aria-label="Privileged workspaces">
  <span class="privileged-workspace-label">Workspace</span>
  <div>
    {#each destinations as destination}
      {#if can(destination.capability)}
        <a href={destination.href} aria-current={current === destination.id ? 'page' : undefined}>
          <strong>{destination.label}</strong>
          <small>{destination.description}</small>
        </a>
      {/if}
    {/each}
  </div>
</nav>
