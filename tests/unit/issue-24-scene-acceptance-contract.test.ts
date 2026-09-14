import { describe, expect, it } from 'vitest';
import {
  ISSUE_24_REQUIRED_CAPTURE_OUTPUTS,
  ISSUE_24_SCENE_CAPTURE_KIND,
  ISSUE_24_SCENE_VIEWPORTS,
  issue24ScreenshotName
} from '../../scripts/issue-24-scene-acceptance-contract';

describe('Issue #24 focused scene capture contract', () => {
  it('keeps the Shop and Bar acceptance matrix narrow and complete', () => {
    expect(ISSUE_24_SCENE_CAPTURE_KIND).toBe('issue-24-scene-acceptance');
    expect(ISSUE_24_SCENE_VIEWPORTS.map((viewport) => viewport.label)).toEqual(['1672x941', '1440x900', '768x1024', '390x844']);
    expect(ISSUE_24_REQUIRED_CAPTURE_OUTPUTS).toHaveLength(11);
    expect(issue24ScreenshotName('shop', ISSUE_24_SCENE_VIEWPORTS[0])).toBe('shop-1672x941.png');
    expect(issue24ScreenshotName('bar', ISSUE_24_SCENE_VIEWPORTS.at(-1)!)).toBe('bar-390x844.png');
  });
});
