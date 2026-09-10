export const GARDEN_HEX_WIDTH = 92;
export const GARDEN_HEX_HEIGHT = (GARDEN_HEX_WIDTH * 2) / Math.sqrt(3);
export const GARDEN_HEX_ROW_PITCH = (GARDEN_HEX_HEIGHT * 3) / 4;

export interface HexOffsetCoordinate {
  col: number;
  row: number;
}

export interface PixelCoordinate {
  x: number;
  y: number;
}

export function oddRHexPosition({ col, row }: HexOffsetCoordinate): PixelCoordinate {
  return {
    x: col * GARDEN_HEX_WIDTH + (Math.abs(row) % 2 === 1 ? GARDEN_HEX_WIDTH / 2 : 0),
    y: row * GARDEN_HEX_ROW_PITCH
  };
}

export function hexGridBounds(cells: HexOffsetCoordinate[]): { width: number; height: number } {
  if (cells.length === 0) return { width: 0, height: 0 };

  const positions = cells.map(oddRHexPosition);
  const left = Math.min(...positions.map(({ x }) => x));
  const top = Math.min(...positions.map(({ y }) => y));
  const right = Math.max(...positions.map(({ x }) => x + GARDEN_HEX_WIDTH));
  const bottom = Math.max(...positions.map(({ y }) => y + GARDEN_HEX_HEIGHT));

  return { width: right - left, height: bottom - top };
}
