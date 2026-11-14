import { canonicalLocalityName } from "../locality";
import { site } from "../site";

/**
 * Neighbouring localities among the names the website already lists.
 * A pair is included only when published site copy places one inside the other.
 * Every other website locality, and every free-text locality, matches exactly
 * after normalization. This map does not infer junctions or city geography.
 */
const REVIEWED_PAIRS: readonly (readonly [string, string])[] = [
  // Plot and location copy: "Sai Nagar at Bankur Cross on Shahabad Road".
  ["Sai Nagar", "Shahabad Road"],
];

const NEIGHBOURS: ReadonlyMap<string, readonly string[]> = buildNeighbours(REVIEWED_PAIRS);

function buildNeighbours(pairs: readonly (readonly [string, string])[]): ReadonlyMap<string, readonly string[]> {
  const known = new Set<string>(site.localities);
  const map = new Map<string, Set<string>>();
  for (const [left, right] of pairs) {
    if (!known.has(left) || !known.has(right) || left === right) continue;
    const fromLeft = map.get(left) ?? new Set<string>();
    fromLeft.add(right);
    map.set(left, fromLeft);
    const fromRight = map.get(right) ?? new Set<string>();
    fromRight.add(left);
    map.set(right, fromRight);
  }
  return new Map([...map].map(([name, neighbours]) => [name, [...neighbours]]));
}

export function reviewedNeighbourPairs(): readonly (readonly [string, string])[] {
  return REVIEWED_PAIRS;
}

/** True only for a reviewed pair of website localities. Unknown text is never neighbouring. */
export function areNeighbouringLocalities(left: string, right: string): boolean {
  const a = canonicalLocalityName(left);
  const b = canonicalLocalityName(right);
  if (a === b) return false;
  return (NEIGHBOURS.get(a) ?? []).includes(b);
}
