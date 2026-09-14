/**
 * Issue #24 is intentionally captured separately from the older three-area
 * acceptance pass.  Keeping this compact contract here makes its evidence
 * repeatable without widening that legacy capture's scope.
 */
export const ISSUE_24_SCENE_CAPTURE_KIND = 'issue-24-scene-acceptance' as const;

export const ISSUE_24_SCENE_VIEWPORTS = [
  { label: '1672x941', width: 1672, height: 941 },
  { label: '1440x900', width: 1440, height: 900 },
  { label: '768x1024', width: 768, height: 1024 },
  { label: '390x844', width: 390, height: 844 }
] as const;

export type Issue24Scene = 'shop' | 'bar';

export const ISSUE_24_REQUIRED_CAPTURE_OUTPUTS = [
  ...(['shop', 'bar'] as const).flatMap((scene) => ISSUE_24_SCENE_VIEWPORTS.map((viewport) => `${scene}-${viewport.label}.png`)),
  'shop-parallax.webm',
  'bar-selection-parallax.webm',
  'issue-24-results.json'
] as const;

export function issue24ScreenshotName(scene: Issue24Scene, viewport: { label: string }) {
  return `${scene}-${viewport.label}.png`;
}
