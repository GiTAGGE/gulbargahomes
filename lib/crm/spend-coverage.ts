export type CoverageRange = { since: string; until: string };

function nextDay(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(Date.UTC(year, month - 1, day) + 86_400_000).toISOString().slice(0, 10);
}

function valid(range: CoverageRange): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(range.since) && /^\d{4}-\d{2}-\d{2}$/.test(range.until) && range.since <= range.until;
}

/** Join overlapping and adjacent successful-import windows into the shortest list. */
export function mergeCoverageRanges(ranges: CoverageRange[]): CoverageRange[] {
  const sorted = ranges
    .filter(valid)
    .map((range) => ({ since: range.since, until: range.until }))
    .sort((a, b) => a.since.localeCompare(b.since) || a.until.localeCompare(b.until));
  const merged: CoverageRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.since > nextDay(last.until)) merged.push({ ...range });
    else if (range.until > last.until) last.until = range.until;
  }
  return merged;
}

/**
 * True when every day from `from` through `to` was part of a successful import.
 * A missing start or end is not covered: an open report is wider than any saved window.
 */
export function rangeCovered(from: string | null, to: string | null, ranges: CoverageRange[]): boolean {
  if (!from || !to || from > to) return false;
  let cursor = from;
  for (const range of mergeCoverageRanges(ranges)) {
    if (range.until < cursor) continue;
    if (range.since > cursor) return false;
    if (range.until >= to) return true;
    cursor = nextDay(range.until);
  }
  return false;
}
