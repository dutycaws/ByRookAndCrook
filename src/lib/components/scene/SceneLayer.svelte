<script lang="ts">
  let {
    src,
    alt = '',
    name,
    x = 0,
    y = 0,
    width = 1672,
    height = 941,
    z = 0,
    essential = false,
    class: className = ''
  }: {
    src: string;
    alt?: string;
    name: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    z?: number;
    essential?: boolean;
    class?: string;
  } = $props();
  let failed = $state(false);
</script>

{#if !failed}
  <img
    class="scene-layer {className}"
    {src}
    {alt}
    draggable="false"
    data-scene-layer={name}
    style={`left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${z}`}
    onerror={() => (failed = true)}
  />
{:else if essential}
  <div
    class="missing-layer"
    role="img"
    aria-label={`${name} artwork could not be loaded`}
    style={`left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${z}`}
  >
    <span>{name} artwork unavailable. Reload to try again.</span>
  </div>
{/if}

<style>
  .scene-layer,
  .missing-layer { position: absolute; display: block; max-width: none; pointer-events: none; }
  .missing-layer {
    display: grid;
    place-content: center;
    padding: 2rem;
    border: 2px dashed #c89435;
    color: #ead8a6;
    background: #171006e8;
    text-align: center;
  }
</style>
