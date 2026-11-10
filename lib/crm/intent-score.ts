import type { Timeline } from "./options";

export type IntentInput = {
  timeline: Timeline;
  budgetMin: number | null;
  budgetMax: number | null;
  propertyTypes: string[];
  localities: string[];
  bhkMin: number | null;
  status: string;
  lastContactedAt: string | null;
  createdAt: string;
  priorityOverride: string;
};

export type IntentScore = {
  score: number;
  band: "High" | "Medium" | "Low";
  factors: { label: string; points: number; max: number }[];
  overridden: boolean;
};

const URGENCY: Record<Timeline, number> = {
  Immediate: 30,
  "Within 7 days": 26,
  "Within 30 days": 18,
  "Within 3 months": 8,
  Exploring: 2,
};

const ENGAGED_STATUSES = new Set([
  "Verified",
  "Qualified",
  "Matched",
  "Property shared",
  "Visit scheduled",
  "Visited",
  "Negotiation",
]);

/**
 * How likely this person is to transact, independent of our inventory.
 * Inventory fit is a separate match score (Phase 2), so a serious buyer with no
 * current match still ranks high.
 */
export function intentScore(input: IntentInput, now: Date = new Date()): IntentScore {
  const factors: IntentScore["factors"] = [];

  factors.push({ label: "Urgency", points: URGENCY[input.timeline] ?? 0, max: 30 });

  let budget = 0;
  if (input.budgetMax) budget += 14;
  if (input.budgetMin && input.budgetMax && input.budgetMin <= input.budgetMax) budget += 6;
  factors.push({ label: "Budget clarity", points: budget, max: 20 });

  let completeness = 0;
  if (input.propertyTypes.length) completeness += 7;
  if (input.localities.length) completeness += 8;
  if (input.bhkMin !== null || input.propertyTypes.every((type) => type === "Plot" || type === "Commercial")) {
    completeness += 5;
  }
  factors.push({ label: "Requirement completeness", points: completeness, max: 20 });

  let engagement = 0;
  if (input.lastContactedAt) engagement += 10;
  if (ENGAGED_STATUSES.has(input.status)) engagement += 15;
  factors.push({ label: "Engagement", points: Math.min(engagement, 25), max: 25 });

  const ageDays = (now.getTime() - new Date(input.createdAt).getTime()) / 86_400_000;
  const freshness = ageDays <= 2 ? 5 : ageDays <= 7 ? 4 : ageDays <= 30 ? 2 : 0;
  factors.push({ label: "Freshness", points: freshness, max: 5 });

  const score = Math.max(0, Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0)));
  let band: IntentScore["band"] = score >= 70 ? "High" : score >= 45 ? "Medium" : "Low";
  const overridden = input.priorityOverride === "High" || input.priorityOverride === "Medium" || input.priorityOverride === "Low";
  if (overridden) band = input.priorityOverride as IntentScore["band"];
  return { score, band, factors, overridden };
}
