import { describe, expect, it } from 'vitest';
import {
  calculateSceneParallax,
  MAX_SCENE_PARALLAX_PX,
  SETTLED_SCENE_PARALLAX
} from '$lib/game/scene-parallax';

const active = {
  bounds: { left: 100, top: 50, width: 200, height: 100 },
  finePointer: true,
  hovering: true,
  reducedMotion: false,
  documentVisible: true
};

describe('scene parallax', () => {
  it('uses a small fine-pointer-only offset and caps it at eight CSS pixels', () => {
    expect(calculateSceneParallax({ ...active, clientX: 200, clientY: 100 })).toEqual({ x: 0, y: 0 });
    expect(calculateSceneParallax({ ...active, clientX: 1_000, clientY: -1_000 })).toEqual({
      x: MAX_SCENE_PARALLAX_PX, y: -MAX_SCENE_PARALLAX_PX
    });
  });

  it('settles without motion for touch, reduced motion, a hidden tab, or an unhovered scene', () => {
    for (const condition of [
      { finePointer: false }, { reducedMotion: true }, { documentVisible: false }, { hovering: false }
    ]) {
      expect(calculateSceneParallax({ ...active, clientX: 100, clientY: 50, ...condition })).toEqual(SETTLED_SCENE_PARALLAX);
    }
  });
});
