<script lang="ts">
  import { onMount } from 'svelte';
  import GardenGrid from '$lib/components/garden/GardenGrid.svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import SceneLayer from '$lib/components/scene/SceneLayer.svelte';
  import {
    createGardenCamera,
    focusGardenPoint,
    panGardenCamera,
    zoomGardenCameraAt,
    type GardenCameraContent,
    type GardenCameraState,
    type GardenCameraViewport
  } from '$lib/game/garden-camera';
  import { GARDEN_HEX_HEIGHT, GARDEN_HEX_WIDTH, oddRHexPosition } from '$lib/game/hex';
  import type { GardenVisualState } from '$lib/presentation/scene';

  let {
    visual,
    onselect,
    onnavigate = onselect,
    batchMode = null,
    batchTargetIds = new Set<string>(),
    harvestEffect = null
  }: {
    visual: GardenVisualState;
    onselect: (cellId: string) => void;
    onnavigate?: (cellId: string) => void;
    batchMode?: 'water' | 'amend' | null;
    batchTargetIds?: Set<string>;
    harvestEffect?: { token: number; cellId: string; plantKey: string; stage: number } | null;
  } = $props();

  const boardScale = 1.85;
  const boardOrigin = { x: 335, y: 150 };
  const worldSize = { width: 1672, height: 941 };
  const clickDragThreshold = 8;
  let viewportElement = $state<HTMLDivElement>();
  let viewport = $state<GardenCameraViewport>({ width: 1002, height: 610 });
  let camera = $state<GardenCameraState>({ fitScale: 1, zoom: 1, panX: 0, panY: 0 });
  let cameraMessage = $state('Garden fitted to view.');
  let cameraTransition = $state(false);
  let suppressPlotClick = $state(false);
  let geometryKey = '';

  // The camera owns the complete illustrated world. The board is one child of
  // this surface so every plot, its artwork, and the surrounding scenery use
  // exactly the same matrix.
  const content: GardenCameraContent = worldSize;
  let zoomPercent = $derived(Math.round(camera.zoom * 100));

  type PointerPosition = { x: number; y: number };
  let pointers = new Map<number, PointerPosition>();
  let dragStart: PointerPosition | null = null;
  let previousPointer: PointerPosition | null = null;
  let panning = false;
  let pinch: { distance: number; zoom: number } | null = null;

  function resetCamera(announce = true) {
    camera = createGardenCamera(viewport, content);
    cameraTransition = true;
    if (announce) cameraMessage = 'Garden reset to fit view, 100%.';
  }

  function updateViewport() {
    if (!viewportElement) return;
    viewport = { width: viewportElement.clientWidth, height: viewportElement.clientHeight };
  }

  onMount(() => {
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    if (viewportElement) observer.observe(viewportElement);
    return () => observer.disconnect();
  });

  $effect(() => {
    const nextGeometryKey = `${viewport.width}x${viewport.height}:${content.width}x${content.height}`;
    if (nextGeometryKey !== geometryKey) {
      geometryKey = nextGeometryKey;
      resetCamera(false);
    }
  });

  function boardPoint(cellId: string): PointerPosition | null {
    const cell = visual.plots.find((plot) => plot.id === cellId);
    if (!cell) return null;
    const position = oddRHexPosition(cell);
    return {
      x: boardOrigin.x + (position.x + GARDEN_HEX_WIDTH / 2) * boardScale,
      y: boardOrigin.y + (position.y + GARDEN_HEX_HEIGHT / 2) * boardScale
    };
  }

  /**
   * Floating menus can anchor to [data-garden-anchor=<cell id>]. The camera
   * keeps that element in one transformed coordinate space with its hex.
   */
  function bringPlotIntoView(cellId: string) {
    const point = boardPoint(cellId);
    if (!point) return;
    camera = focusGardenPoint(camera, viewport, content, point);
    cameraTransition = true;
  }

  function viewportPoint(event: PointerEvent | WheelEvent): PointerPosition {
    const rect = viewportElement?.getBoundingClientRect();
    if (!rect || !viewportElement) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) * (viewportElement.clientWidth / rect.width),
      y: (event.clientY - rect.top) * (viewportElement.clientHeight / rect.height)
    };
  }

  function pointerDistance(a: PointerPosition, b: PointerPosition) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a: PointerPosition, b: PointerPosition): PointerPosition {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function beginPinch() {
    const [first, second] = [...pointers.values()];
    if (!first || !second) return;
    pinch = { distance: Math.max(1, pointerDistance(first, second)), zoom: camera.zoom };
    panning = true;
    suppressPlotClick = true;
    // Pointer capture changes the click target, so it begins only after this
    // gesture is definitely a pinch. Plain plot taps retain their native click.
    for (const pointerId of pointers.keys()) viewportElement?.setPointerCapture(pointerId);
  }

  function handlePointerDown(event: PointerEvent) {
    if ((event.target as HTMLElement).closest('[data-garden-camera-controls]')) return;
    cameraTransition = false;
    const point = viewportPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      dragStart = point;
      previousPointer = point;
      panning = false;
    } else if (pointers.size === 2) beginPinch();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const point = viewportPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2 && pinch) {
      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      const anchor = midpoint(first, second);
      camera = zoomGardenCameraAt(camera, viewport, content, pinch.zoom * (pointerDistance(first, second) / pinch.distance), anchor.x, anchor.y);
      suppressPlotClick = true;
      return;
    }
    if (!dragStart || !previousPointer) return;
    if (!panning && pointerDistance(dragStart, point) >= clickDragThreshold) {
      panning = true;
      suppressPlotClick = true;
      // Do not capture pointer-down: doing so redirects a normal tap's
      // pointer-up/click away from the hex. Capture only confirmed drags.
      viewportElement?.setPointerCapture(event.pointerId);
    }
    if (panning) camera = panGardenCamera(camera, viewport, content, point.x - previousPointer.x, point.y - previousPointer.y);
    previousPointer = point;
  }

  function endPointer(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (panning) {
      suppressPlotClick = true;
      setTimeout(() => (suppressPlotClick = false), 0);
    }
    if (pointers.size === 1) {
      previousPointer = [...pointers.values()][0] ?? null;
      dragStart = previousPointer;
    } else {
      previousPointer = null;
      dragStart = null;
      panning = false;
    }
  }

  function blockDragClick(event: MouseEvent) {
    if (!suppressPlotClick) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const point = viewportPoint(event);
    camera = zoomGardenCameraAt(camera, viewport, content, camera.zoom * Math.exp(-event.deltaY * 0.002), point.x, point.y);
    cameraTransition = false;
    cameraMessage = `Garden zoom ${Math.round(camera.zoom * 100)}% of fit view.`;
  }

  function changeZoom(delta: number) {
    camera = zoomGardenCameraAt(camera, viewport, content, camera.zoom + delta);
    cameraTransition = true;
    cameraMessage = `Garden zoom ${Math.round(camera.zoom * 100)}% of fit view.`;
  }
</script>

<AreaScene area="garden" label={`Illustrated tavern courtyard with ${visual.plots.length} selectable garden plots`} class="garden-scene-frame">
  <div
    bind:this={viewportElement}
    class="garden-plane-viewport"
    role="region"
    aria-label="Pan and zoom garden board"
    data-garden-viewport
    data-garden-camera-viewport
    data-garden-camera-zoom={zoomPercent}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={endPointer}
    onpointercancel={endPointer}
    onclickcapture={blockDragClick}
    onwheel={handleWheel}
  >
    <div
      class:camera-transition={cameraTransition}
      class="garden-camera-content garden-world"
      data-garden-camera-content
      data-garden-world
      style={`width:${content.width}px;height:${content.height}px;transform:translate(${camera.panX}px,${camera.panY}px) scale(${camera.fitScale * camera.zoom})`}
    >
      <SceneLayer src="/assets/scenes/garden-environment.webp" name="garden environment" z={0} essential />
      <div class="garden-light" aria-hidden="true"></div>
      <div class="garden-board" style={`left:${boardOrigin.x}px;top:${boardOrigin.y}px`}>
        <GardenGrid
          plots={visual.plots}
          selectedId={visual.selectedCellId}
          scale={boardScale}
          {harvestEffect}
          {onselect}
          {onnavigate}
          onplotfocus={bringPlotIntoView}
          {batchMode}
          {batchTargetIds}
        />
      </div>
      <SceneLayer src="/assets/scenes/garden/garden-atmosphere.webp" name="garden bees and leaves" x={922} y={180} width={620} height={330} z={4} class="garden-atmosphere" />
      <SceneLayer src="/assets/scenes/garden/garden-foreground.webp" name="garden foreground foliage" x={0} y={611} width={960} height={330} z={5} class="garden-foreground" />
    </div>
    <div class="garden-camera-controls" data-garden-camera-controls role="group" aria-label="Garden camera controls">
      <button type="button" aria-label="Zoom out garden" onclick={() => changeZoom(-0.25)} disabled={camera.zoom <= 1}>−</button>
      <button type="button" aria-label="Reset garden view" onclick={() => resetCamera()}>Reset</button>
      <button type="button" aria-label="Zoom in garden" onclick={() => changeZoom(0.25)} disabled={camera.zoom >= 3}>+</button>
    </div>
    <div class="garden-camera-status" aria-live="polite" aria-atomic="true">{cameraMessage}</div>
  </div>
  {#if visual.status === 'pending'}
    <div class="scene-status pending" aria-hidden="true">Gathering the selected crop…</div>
  {:else if visual.status === 'error'}
    <div class="scene-status error" aria-hidden="true">The harvest result is unresolved. Use the inspector to retry.</div>
  {/if}
</AreaScene>

<style>
  :global(.garden-scene-frame) { margin-top: 1rem; border: 1px solid #725426; box-shadow: inset 0 0 0 1px #120b04; }
  .garden-light { position: absolute; inset: 0; z-index: 1; background: linear-gradient(120deg,#fff1a714,transparent 35%),radial-gradient(ellipse at 51% 49%,transparent 20%,#06100640 86%); pointer-events: none; }
  .garden-plane-viewport { position: absolute; inset: 0; z-index: 2; overflow: hidden; touch-action: none; cursor: grab; }
  .garden-plane-viewport:active { cursor: grabbing; }
  .garden-camera-content { position: absolute; top: 0; left: 0; transform-origin: top left; will-change: transform; }
  .garden-board { position: absolute; z-index: 2; }
  .garden-camera-content.camera-transition { transition: transform 180ms ease-out; }
  .garden-camera-controls { position: absolute; right: 12px; bottom: 12px; z-index: 20; display: flex; overflow: hidden; border: 1px solid #b68a3d; border-radius: 3px; background: #170e08e8; box-shadow: 0 3px 10px #000a; }
  .garden-camera-controls button { min-width: 38px; min-height: 34px; border: 0; border-right: 1px solid #785524; color: #f4d985; background: transparent; font-family: 'Cinzel',serif; font-size: 16px; cursor: pointer; }
  .garden-camera-controls button:nth-child(2) { min-width: 56px; font-size: 11px; }
  .garden-camera-controls button:last-child { border-right: 0; }
  .garden-camera-controls button:hover:not(:disabled), .garden-camera-controls button:focus-visible { color: #fff4c6; background: #6d4d1c; outline: 1px solid #fff0a9; outline-offset: -3px; }
  .garden-camera-controls button:disabled { color: #806d4d; cursor: default; }
  .garden-camera-status { position: absolute; right: 12px; bottom: 52px; z-index: 20; max-width: 190px; padding: .25rem .4rem; border: 1px solid #76522299; color: #e8cf90; background: #120b07d9; font-family: 'Cinzel',serif; font-size: 11px; text-align: right; pointer-events: none; }
  :global(.garden-atmosphere) { animation: garden-drift 6s ease-in-out infinite alternate; opacity: .78; }
  :global(.garden-foreground) { filter: drop-shadow(0 -12px 18px #020401a8); }
  :global([data-area-scene='garden'][data-scene-visible='false'] .garden-atmosphere) { animation-play-state: paused; }
  .scene-status { position: absolute; top: 24px; left: 50%; z-index: 20; transform: translateX(-50%); padding: .55rem .9rem; border: 1px solid #98733b; border-radius: 4px; color: #f3ddb0; background: #151007e8; box-shadow: 0 8px 20px #0008; font-family: 'Cinzel',serif; font-size: 13px; }
  .scene-status.error { border-color: #a8543c; color: #ffd0bd; }
  @keyframes garden-drift { from { transform: translate3d(-4px,2px,0); } to { transform: translate3d(7px,-4px,0); } }
  @media (prefers-reduced-motion: reduce) { :global(.garden-atmosphere) { animation: none; } .garden-camera-content.camera-transition { transition: none; } }
</style>
