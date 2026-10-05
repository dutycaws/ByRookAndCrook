/**
 * Client-side selection state for the Bar scene.  The scene is a presentation
 * surface, so it never decides who is actually available; the server passes
 * only authoritative, present patrons into it.
 */
export interface BarSceneSelection {
  selectedKey: string | null;
  focusedKey: string | null;
}

/** Five columns by five rows retain a 48px target at the phone scene scale. */
export const BAR_SCENE_TOUCH_TARGET_CAPACITY = 25;

/**
 * A placement on Bar's 1672 × 941 design plane. The first 25 hit boxes are at
 * least 160 design pixels, or 48 CSS pixels at the phone scene scale.
 */
export interface BarScenePatronPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  compact: { x: number; y: number; width: number; height: number };
  hitBounds: { x: number; y: number; width: number; height: number };
}

export interface BarSceneCameraTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarSceneCameraTransform {
  scale: number;
  x: number;
  y: number;
}

export interface BarSceneCameraInput {
  viewportWidth: number;
  viewportHeight: number;
  designWidth: number;
  designHeight: number;
  mobile: boolean;
  target: BarSceneCameraTarget | null;
}

function stablePatronIds(instanceIds: readonly string[]): string[] {
  return [...new Set(instanceIds)].sort((left, right) => left.localeCompare(right));
}

/**
 * Assigns every resident a unique alcove across however many roster pages the
 * server returns. The first five rows retain full touch targets; larger crowds
 * stay safely rendered and keyboard reachable instead of crashing the room.
 */
export function barScenePatronPlacements(instanceIds: readonly string[]): ReadonlyMap<string, BarScenePatronPlacement> {
  const ids = stablePatronIds(instanceIds);
  const rows = Math.max(4, Math.ceil(ids.length / 5));
  const rowStride = Math.min(230, 880 / rows);
  const hitSize = Math.min(160, rowStride);

  const placements = new Map<string, BarScenePatronPlacement>();
  for (const [slot, instanceId] of ids.entries()) {
    const column = slot % 5;
    const row = Math.floor(slot / 5);
    const x = 20 + column * 330;
    const y = 20 + row * rowStride;
    const compactX = 220 + column * 240;
    const compactY = 18 + row * rowStride;
    const hitInsetY = (rowStride - hitSize) / 2;
    placements.set(instanceId, {
      x, y, width: 290, height: 220,
      // Keep the compact artwork width equal to desktop so ComposedScene's
      // proportional hit target remains 160 × 160 design pixels.
      compact: { x: compactX, y: compactY, width: 290, height: 220 },
      hitBounds: { x: x + 65, y: y + hitInsetY, width: 160, height: hitSize }
    });
  }
  return placements;
}

export function reconcileBarSceneSelection(
  patrons: readonly { instanceId: string }[],
  previous: BarSceneSelection
): BarSceneSelection {
  const keys = patrons.map((patron) => patron.instanceId);
  if (keys.length === 0) return { selectedKey: null, focusedKey: null };

  return {
    selectedKey: previous.selectedKey && keys.includes(previous.selectedKey)
      ? previous.selectedKey
      : null,
    focusedKey: previous.focusedKey && keys.includes(previous.focusedKey)
      ? previous.focusedKey
      : keys[0]
  };
}

/**
 * Focuses a resident without exposing empty space beyond the scene plane.
 * Translation stays in design-plane coordinates, then composes with the
 * responsive AreaScene crop and shared parallax transform.
 */
export function barSceneCameraForFocus(input: BarSceneCameraInput): BarSceneCameraTransform {
  const { viewportWidth, viewportHeight, designWidth, designHeight, mobile, target } = input;
  if (!target || viewportWidth <= 0 || viewportHeight <= 0 || designWidth <= 0 || designHeight <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }

  const fitScale = mobile ? viewportHeight / designHeight : viewportWidth / designWidth;
  if (!Number.isFinite(fitScale) || fitScale <= 0) return { scale: 1, x: 0, y: 0 };

  const zoom = mobile ? 1.42 : 1.6;
  const areaOffsetX = mobile ? (viewportWidth - designWidth * fitScale) / 2 : 0;
  const visibleLeft = Math.max(0, -areaOffsetX / fitScale);
  const visibleTop = 0;
  const visibleWidth = viewportWidth / fitScale;
  const visibleHeight = viewportHeight / fitScale;
  const focusX = target.x + target.width / 2;
  const focusY = target.y + target.height * 0.32;
  const destinationX = visibleLeft + visibleWidth * 0.46;
  const destinationY = visibleTop + visibleHeight * (mobile ? 0.3 : 0.32);
  const desiredX = destinationX - focusX * zoom;
  const desiredY = destinationY - focusY * zoom;
  // Keep the whole scene plane over the frame so camera motion never reveals
  // the black stage around it, including when the target is near an edge.
  const minX = visibleLeft + visibleWidth - designWidth * zoom;
  const maxX = visibleLeft;
  const minY = visibleTop + visibleHeight - designHeight * zoom;
  const maxY = visibleTop;
  const clamp = (value: number, min: number, max: number) => min <= max
    ? Math.max(min, Math.min(max, value))
    : (min + max) / 2;

  return {
    scale: zoom,
    x: clamp(desiredX, minX, maxX),
    y: clamp(desiredY, minY, maxY)
  };
}

export function selectedBarPatron<T extends { instanceId: string }>(
  patrons: readonly T[],
  selectedKey: string | null
): T | null {
  return patrons.find((patron) => patron.instanceId === selectedKey) ?? null;
}

/** Server-owned availability is projected into the illustrated room here. */
export function presentBarPatrons<T extends { instanceId: string }>(
  roster: readonly T[],
  journals: Readonly<Record<string, { availability: string } | undefined>>
): T[] {
  return roster.filter((patron) => journals[patron.instanceId]?.availability === 'present');
}
