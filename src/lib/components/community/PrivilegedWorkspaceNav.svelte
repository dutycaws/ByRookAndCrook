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
  const availableDestinations = $derived(destinations.filter((destination) => can(destination.capability)));
  const currentDestination = $derived(availableDestinations.find((destination) => destination.id === current) ?? availableDestinations[0]);
</script>

<nav class="privileged-workspace-nav" aria-label="Privileged workspaces">
  <span class="privileged-workspace-label">Workspace</span>
  <div class="privileged-workspace-links privileged-workspace-links-desktop">
    {#each availableDestinations as destination}
      <a href={destination.href} aria-current={current === destination.id ? 'page' : undefined}>
        <strong>{destination.label}</strong>
        <small>{destination.description}</small>
      </a>
    {/each}
  </div>
  <details class="privileged-workspace-switcher">
    <summary><span>{currentDestination?.label ?? 'Choose workspace'}</span><span aria-hidden="true">Switch</span></summary>
    <div>
      {#each availableDestinations as destination}
        <a href={destination.href} aria-current={current === destination.id ? 'page' : undefined}>
          <strong>{destination.label}</strong>
          <small>{destination.description}</small>
        </a>
      {/each}
    </div>
  </details>
</nav>
