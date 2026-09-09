import { describe, expect, it } from 'vitest';
import {
  GARDEN_HEX_HEIGHT,
  GARDEN_HEX_ROW_PITCH,
  GARDEN_HEX_WIDTH,
  hexGridBounds,
  oddRHexPosition
} from '../../src/lib/game/hex';

describe('garden hex geometry', () => {
  it('places same-row and alternating-row neighbors on shared edges', () => {
    const c1 = oddRHexPosition({ col: 1, row: 0 });
    const c2 = oddRHexPosition({ col: 2, row: 0 });
    const c4 = oddRHexPosition({ col: 1, row: 1 });

    expect(c2.x - c1.x).toBeCloseTo(GARDEN_HEX_WIDTH);
    expect(c2.y).toBe(c1.y);
    expect(c4.x - c1.x).toBeCloseTo(GARDEN_HEX_WIDTH / 2);
    expect(c4.y - c1.y).toBeCloseTo(GARDEN_HEX_ROW_PITCH);

    const c2BottomLeft = { x: c2.x, y: c2.y + GARDEN_HEX_HEIGHT * 0.75 };
    const c4Top = { x: c4.x + GARDEN_HEX_WIDTH / 2, y: c4.y };
    expect(c4Top.x).toBeCloseTo(c2BottomLeft.x);
    expect(c4Top.y).toBeCloseTo(c2BottomLeft.y);
  });

  it('derives the four-row starter board bounds from its coordinates', () => {
    const cells = Array.from({ length: 12 }, (_, index) => ({
      col: index % 3,
      row: Math.floor(index / 3)
    }));

    expect(hexGridBounds(cells)).toEqual({
      width: GARDEN_HEX_WIDTH * 3.5,
      height: GARDEN_HEX_HEIGHT + GARDEN_HEX_ROW_PITCH * 3
    });
    expect(hexGridBounds([])).toEqual({ width: 0, height: 0 });
  });
});
