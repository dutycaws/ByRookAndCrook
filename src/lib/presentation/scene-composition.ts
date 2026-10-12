/**
 * The scene contract is deliberately independent of runtime media URLs.  The
 * renderer receives URLs at the edge, while asset validation can consume these
 * stable keys and geometry without importing a Svelte component.
 */
export const SCENE_COMPOSITION_VERSION = 'scene-composition-v1' as const;

export type ComposedSceneId = 'shop' | 'bar';
export type SceneLayerKind = 'background' | 'actor' | 'foreground';

export interface SceneDesignPlane {
  width: number;
  height: number;
}

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneRect extends ScenePoint {
  width: number;
  height: number;
}

export interface ScenePlacement extends SceneRect {
  /** Rendering order within the fixed design plane. */
  depth: number;
  /** Placement used on compact viewports before the plane is scaled. */
  compact: SceneRect;
  entrance: ScenePoint;
  exit: ScenePoint;
}

export interface SceneDecorDefinition extends ScenePlacement {
  kind: 'background' | 'foreground';
  key: string;
  alt: string;
}

export interface SceneActorDefinition extends ScenePlacement {
  kind: 'actor';
  key: string;
  /** Human-readable fallback while the runtime asset is absent. */
  placeholder: string;
  label: string;
  hitBounds: SceneRect;
  /** Optional normalized pointer mask; visual art and keyboard focus remain unmasked. */
  hitAreaPolygon?: readonly (readonly [number, number])[];
}

export interface SceneComposition {
  version: typeof SCENE_COMPOSITION_VERSION;
  id: ComposedSceneId;
  plane: SceneDesignPlane;
  background: SceneDecorDefinition;
  actors: readonly SceneActorDefinition[];
  foreground: readonly SceneDecorDefinition[];
}

const shopPlane = { width: 1200, height: 900 } as const;
const barPlane = { width: 1672, height: 941 } as const;

export const SCENE_COMPOSITIONS: Readonly<Record<ComposedSceneId, SceneComposition>> = {
  shop: {
    version: SCENE_COMPOSITION_VERSION,
    id: 'shop',
    plane: shopPlane,
    background: {
      kind: 'background', key: 'shop-background', alt: 'A warm garden shop counter',
      x: 0, y: 0, width: 1200, height: 900, depth: 0,
      compact: { x: -125, y: 0, width: 1200, height: 900 },
      entrance: { x: 0, y: 0 }, exit: { x: 0, y: 0 }
    },
    actors: [
      {
        kind: 'actor', key: 'shop-elara', label: 'Speak with Elara', placeholder: 'Elara artwork',
        x: 54, y: 80, width: 470, height: 744, depth: 5,
        compact: { x: 8, y: 170, width: 420, height: 665 },
        hitBounds: { x: 74, y: 125, width: 400, height: 650 },
        entrance: { x: -80, y: 0 }, exit: { x: -130, y: 0 }
      }
    ],
    foreground: [
      {
        kind: 'foreground', key: 'shop-counter-occlusion', alt: '',
        x: 0, y: 648, width: 1200, height: 252, depth: 8,
        compact: { x: -125, y: 648, width: 1200, height: 252 },
        entrance: { x: 0, y: 36 }, exit: { x: 0, y: 36 }
      }
    ]
  },
  bar: {
    version: SCENE_COMPOSITION_VERSION,
    id: 'bar',
    plane: barPlane,
    background: {
      kind: 'background', key: 'bar-background', alt: 'The candlelit common room of the tavern',
      x: 0, y: 0, width: 1672, height: 941, depth: 0,
      compact: { x: -100, y: 0, width: 1672, height: 941 },
      entrance: { x: 0, y: 0 }, exit: { x: 0, y: 0 }
    },
    actors: [
      {
        kind: 'actor', key: 'bar-lira', label: 'Speak with Lira Nightwind', placeholder: 'Lira artwork',
        x: 408, y: 42, width: 690, height: 825, depth: 5,
        compact: { x: 148, y: 80, width: 610, height: 729 },
        hitBounds: { x: 569, y: 112, width: 361, height: 709 },
        entrance: { x: 85, y: 0 }, exit: { x: 150, y: 0 }
      },
      {
        kind: 'actor', key: 'bar-torvin', label: 'Speak with Torvin Ashbeard', placeholder: 'Torvin artwork',
        x: 730, y: 104, width: 590, height: 720, depth: 5,
        compact: { x: 500, y: 156, width: 510, height: 622 },
        hitBounds: { x: 785, y: 110, width: 474, height: 714 },
        // Follows the visible silhouette while leaving the transparent left
        // corridor open for Lira’s exposed arm in the overview.
        hitAreaPolygon: [
          [0.453, 0.004], [0.360, 0.065], [0.316, 0.138], [0.324, 0.155],
          [0.199, 0.200], [0.106, 0.317], [0.105, 0.373], [0.137, 0.407],
          [0.291, 0.424], [0.215, 0.541], [0.255, 0.570], [0.240, 0.614],
          [0.258, 0.637], [0.199, 0.799], [0.226, 0.855], [0.216, 0.917],
          [0.174, 0.973], [0.193, 1.000], [0.341, 1.000], [0.356, 0.984],
          [0.802, 0.979], [0.907, 0.951], [0.883, 0.917], [0.797, 0.889],
          [0.770, 0.833], [0.779, 0.715], [0.811, 0.693], [0.747, 0.502],
          [0.834, 0.418], [0.858, 0.351], [0.715, 0.216], [0.627, 0.177],
          [0.601, 0.121], [0.617, 0.059], [0.559, 0.004]
        ],
        entrance: { x: 85, y: 0 }, exit: { x: 150, y: 0 }
      }
    ],
    foreground: [
      {
        kind: 'foreground', key: 'bar-counter-occlusion', alt: '',
        x: 0, y: 665, width: 1672, height: 276, depth: 8,
        compact: { x: -100, y: 665, width: 1672, height: 276 },
        entrance: { x: 0, y: 40 }, exit: { x: 0, y: 40 }
      }
    ]
  }
};

export function getSceneComposition(id: ComposedSceneId): SceneComposition {
  return SCENE_COMPOSITIONS[id];
}

/** Static scenes deliberately omit a selection callback and therefore expose no actor tab stop. */
export function isSceneActorInteractive(onActorSelect: unknown): boolean {
  return typeof onActorSelect === 'function';
}

/** A small validator shared by CI asset checks and component-level tests. */
export function validateSceneComposition(composition: SceneComposition): string[] {
  const errors: string[] = [];
  const layers = [composition.background, ...composition.actors, ...composition.foreground];
  const seen = new Set<string>();
  if (composition.version !== SCENE_COMPOSITION_VERSION) errors.push('Unsupported scene composition version');
  if (composition.plane.width <= 0 || composition.plane.height <= 0) errors.push('Design plane must have positive dimensions');
  for (const layer of layers) {
    if (seen.has(layer.key)) errors.push(`Duplicate scene layer key: ${layer.key}`);
    seen.add(layer.key);
    if (layer.width <= 0 || layer.height <= 0) errors.push(`${layer.key} must have positive dimensions`);
    if (layer.compact.width <= 0 || layer.compact.height <= 0) errors.push(`${layer.key} must have a valid compact placement`);
    if (!Number.isFinite(layer.depth)) errors.push(`${layer.key} must have a numeric depth`);
    if (layer.kind === 'actor' && (layer.hitBounds.width <= 0 || layer.hitBounds.height <= 0)) {
      errors.push(`${layer.key} must have positive hit bounds`);
    }
  }
  return errors;
}
