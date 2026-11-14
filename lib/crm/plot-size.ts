export type PlotSize = { width: number; depth: number; label: string };

const DIMENSIONS = /^(\d+(?:\.\d+)?)\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)$/i;

/**
 * Reads a plot size such as `30x40` or `30 × 40`. The two sides are the same
 * plot either way around. Square feet are not derived from the sides.
 */
export function parsePlotDimensions(value: string): PlotSize | null {
  const match = value.trim().match(DIMENSIONS);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) return null;
  const width = Math.min(first, second);
  const depth = Math.max(first, second);
  return { width, depth, label: `${trimNumber(width)} × ${trimNumber(depth)}` };
}

export function samePlotSize(left: PlotSize, right: PlotSize): boolean {
  return left.width === right.width && left.depth === right.depth;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
