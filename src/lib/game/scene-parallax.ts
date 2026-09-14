export interface SceneParallaxBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SceneParallaxInput {
  clientX: number;
  clientY: number;
  bounds: SceneParallaxBounds;
  finePointer: boolean;
  hovering: boolean;
  reducedMotion: boolean;
  documentVisible: boolean;
}

export interface SceneParallaxOffset {
  x: number;
  y: number;
}

export const MAX_SCENE_PARALLAX_PX = 8;
export const SETTLED_SCENE_PARALLAX: SceneParallaxOffset = { x: 0, y: 0 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Decorative pointer offset only. Input gating lives here so touch, reduced
 * motion and hidden tabs always settle at rest instead of preserving stale UI.
 */
export function calculateSceneParallax(input: SceneParallaxInput): SceneParallaxOffset {
  if (!input.finePointer || !input.hovering || input.reducedMotion || !input.documentVisible
    || input.bounds.width <= 0 || input.bounds.height <= 0) return SETTLED_SCENE_PARALLAX;
  const x = (input.clientX - input.bounds.left) / input.bounds.width - .5;
  const y = (input.clientY - input.bounds.top) / input.bounds.height - .5;
  return {
    x: clamp(x * MAX_SCENE_PARALLAX_PX * 2, -MAX_SCENE_PARALLAX_PX, MAX_SCENE_PARALLAX_PX),
    y: clamp(y * MAX_SCENE_PARALLAX_PX * 2, -MAX_SCENE_PARALLAX_PX, MAX_SCENE_PARALLAX_PX)
  };
}
