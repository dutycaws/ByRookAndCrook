/**
 * Pure geometry for the garden's clipped board. Pan coordinates are expressed
 * in viewport pixels, before the board transform is applied.
 */
export interface GardenCameraViewport {
  width: number;
  height: number;
}

export interface GardenCameraContent {
  width: number;
  height: number;
}

export interface GardenCameraState {
  /** Scale which makes the complete board visible in the viewport. */
  fitScale: number;
  /** A multiplier of fitScale, constrained to [1, 3]. */
  zoom: number;
  panX: number;
  panY: number;
}

export const GARDEN_CAMERA_MIN_ZOOM = 1;
export const GARDEN_CAMERA_MAX_ZOOM = 3;

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function gardenFitScale(viewport: GardenCameraViewport, content: GardenCameraContent): number {
  return Math.min(
    finitePositive(viewport.width) / finitePositive(content.width),
    finitePositive(viewport.height) / finitePositive(content.height)
  );
}

export function clampGardenZoom(zoom: number): number {
  return Math.max(GARDEN_CAMERA_MIN_ZOOM, Math.min(GARDEN_CAMERA_MAX_ZOOM, zoom));
}

export function gardenCameraScale(camera: GardenCameraState): number {
  return camera.fitScale * camera.zoom;
}

/** Centers small boards and prevents a larger board from exposing blank space. */
export function clampGardenPan(
  pan: Pick<GardenCameraState, 'panX' | 'panY' | 'fitScale' | 'zoom'>,
  viewport: GardenCameraViewport,
  content: GardenCameraContent
): Pick<GardenCameraState, 'panX' | 'panY'> {
  const scale = gardenCameraScale(pan);
  const clampAxis = (value: number, viewportSize: number, contentSize: number) => {
    const scaledSize = contentSize * scale;
    if (scaledSize <= viewportSize) return (viewportSize - scaledSize) / 2;
    return Math.max(viewportSize - scaledSize, Math.min(0, value));
  };
  return {
    panX: clampAxis(pan.panX, viewport.width, content.width),
    panY: clampAxis(pan.panY, viewport.height, content.height)
  };
}

export function createGardenCamera(
  viewport: GardenCameraViewport,
  content: GardenCameraContent,
  zoom = GARDEN_CAMERA_MIN_ZOOM
): GardenCameraState {
  const fitScale = gardenFitScale(viewport, content);
  const state = { fitScale, zoom: clampGardenZoom(zoom), panX: 0, panY: 0 };
  return { ...state, ...clampGardenPan(state, viewport, content) };
}

export function panGardenCamera(
  camera: GardenCameraState,
  viewport: GardenCameraViewport,
  content: GardenCameraContent,
  deltaX: number,
  deltaY: number
): GardenCameraState {
  const next = { ...camera, panX: camera.panX + deltaX, panY: camera.panY + deltaY };
  return { ...next, ...clampGardenPan(next, viewport, content) };
}

/** Zoom around a viewport point so wheel and pinch input do not jump the board. */
export function zoomGardenCameraAt(
  camera: GardenCameraState,
  viewport: GardenCameraViewport,
  content: GardenCameraContent,
  zoom: number,
  anchorX = viewport.width / 2,
  anchorY = viewport.height / 2
): GardenCameraState {
  const nextZoom = clampGardenZoom(zoom);
  const oldScale = gardenCameraScale(camera);
  const nextScale = camera.fitScale * nextZoom;
  const contentX = (anchorX - camera.panX) / oldScale;
  const contentY = (anchorY - camera.panY) / oldScale;
  const next = {
    ...camera,
    zoom: nextZoom,
    panX: anchorX - contentX * nextScale,
    panY: anchorY - contentY * nextScale
  };
  return { ...next, ...clampGardenPan(next, viewport, content) };
}

/** Moves a plot's centre inside the clipped frame for keyboard navigation. */
export function focusGardenPoint(
  camera: GardenCameraState,
  viewport: GardenCameraViewport,
  content: GardenCameraContent,
  point: { x: number; y: number }
): GardenCameraState {
  const scale = gardenCameraScale(camera);
  const next = {
    ...camera,
    panX: viewport.width / 2 - point.x * scale,
    panY: viewport.height / 2 - point.y * scale
  };
  return { ...next, ...clampGardenPan(next, viewport, content) };
}
