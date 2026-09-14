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
      : keys[0],
    focusedKey: previous.focusedKey && keys.includes(previous.focusedKey)
      ? previous.focusedKey
      : keys[0]
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
