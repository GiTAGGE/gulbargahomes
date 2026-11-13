import { classifyTouch, type ClassifiedTouch, type TouchEvidence } from "./attribution";

export type AttributionMemory = {
  first: TouchEvidence;
  last: TouchEvidence;
};

/**
 * Remember the first identified visit and replace only the latest one.
 * A later Direct or Unknown visit does not replace a known first touch.
 * Retention for the cookie that will hold this payload is 90 days.
 */
export function rememberVisit(current: AttributionMemory | null, visit: TouchEvidence, now: string): AttributionMemory {
  const last = visit;
  if (!current) return { first: last, last };
  const firstSource = classifyTouch(current.first, now).source;
  const incoming = classifyTouch(visit, now).source;
  if (firstSource === "Unknown" && incoming !== "Unknown") return { first: last, last };
  return { first: current.first, last };
}

export function classifiedPair(memory: AttributionMemory, now: string): { first: ClassifiedTouch; last: ClassifiedTouch } {
  return { first: classifyTouch(memory.first, now), last: classifyTouch(memory.last, now) };
}
