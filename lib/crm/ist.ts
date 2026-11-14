const IST_OFFSET_MS = 330 * 60_000;

/** Last millisecond of the current day in India Standard Time, as UTC ISO. */
export function endOfIstDay(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const end = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 59, 59, 999);
  return new Date(end - IST_OFFSET_MS).toISOString();
}
