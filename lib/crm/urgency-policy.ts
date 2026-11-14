import { endOfIstDay } from "./ist";

/**
 * One place for how quickly a requirement needs attention.
 * Intent score and match score do not read these thresholds.
 */
export const URGENCY_POLICY = {
  sevenDayHighWhenDaysRemaining: 3,
  sevenDayUnattendedAfterDays: 2,
  oneMonthHighWhenDaysRemaining: 7,
  threeMonthHighWhenDaysRemaining: 14,
  sixMonthHighWhenDaysRemaining: 21,
  flexibleHighWhenDaysRemaining: 7,
  windowDays: {
    seven_days: 7,
    one_month: 30,
    three_months: 90,
    six_months: 180,
  },
} as const;

const DAY_MS = 86_400_000;

export type UrgencyBand = "Critical" | "High" | "Normal" | "Low" | "Paused" | "Closed";

export type TimelineKind = "immediate" | "seven_days" | "one_month" | "three_months" | "six_months" | "flexible";

const PAUSED_STATUSES = new Set(["Converted", "Lost", "Duplicate", "Invalid", "Postponed"]);

/** Original enquiry values and the later confirmed labels share one clock. */
export function timelineKind(timeline: string): TimelineKind {
  switch (timeline) {
    case "Immediate":
      return "immediate";
    case "Within 7 days":
      return "seven_days";
    case "Within 30 days":
    case "Within 1 month":
      return "one_month";
    case "Within 3 months":
      return "three_months";
    case "Within 6 months":
      return "six_months";
    default:
      return "flexible";
  }
}

/** The deadline implied by a timeline when the client did not name a date. Flexible has none. */
export function defaultTarget(timeline: string, cycleStart: Date): string | null {
  const kind = timelineKind(timeline);
  if (kind === "immediate") return endOfIstDay(cycleStart);
  if (kind === "flexible") return null;
  return new Date(cycleStart.getTime() + URGENCY_POLICY.windowDays[kind] * DAY_MS).toISOString();
}

function stepUp(band: UrgencyBand): UrgencyBand {
  if (band === "Low") return "Normal";
  if (band === "Normal") return "High";
  if (band === "High") return "Critical";
  return band;
}

export type UrgencyInput = {
  status: string;
  timeline: string;
  cycleStart: string;
  targetDate: string | null;
  /** A real conversation since this cycle began. A sent message does not count. */
  meaningfulSinceCycleStart: boolean;
  now: Date;
};

/**
 * Live urgency for one cycle. Closed and converted requirements do not escalate.
 * An extension is not itself a reason to become Critical: pass the new timeline
 * and whether the client has actually engaged on this cycle.
 */
export function urgencyFor(input: UrgencyInput): { band: UrgencyBand; overdue: boolean } {
  if (input.status === "Postponed") return { band: "Paused", overdue: false };
  if (PAUSED_STATUSES.has(input.status)) return { band: "Closed", overdue: false };

  const kind = timelineKind(input.timeline);
  const start = new Date(input.cycleStart).getTime();
  const now = input.now.getTime();
  const target = input.targetDate ? new Date(input.targetDate).getTime() : null;
  if (target !== null && now >= target) return { band: "Critical", overdue: true };

  const remainingDays = target === null ? null : (target - now) / DAY_MS;
  let band: UrgencyBand = "Low";
  if (kind === "immediate") {
    band = input.meaningfulSinceCycleStart ? "High" : "Critical";
  } else if (kind === "seven_days") {
    band = remainingDays !== null && remainingDays <= URGENCY_POLICY.sevenDayHighWhenDaysRemaining ? "High" : "Normal";
  } else if (kind === "one_month") {
    band = remainingDays !== null && remainingDays <= URGENCY_POLICY.oneMonthHighWhenDaysRemaining ? "High" : "Normal";
  } else if (kind === "three_months") {
    band = remainingDays !== null && remainingDays <= URGENCY_POLICY.threeMonthHighWhenDaysRemaining ? "High" : "Low";
  } else if (kind === "six_months") {
    band = remainingDays !== null && remainingDays <= URGENCY_POLICY.sixMonthHighWhenDaysRemaining ? "High" : "Low";
  } else if (remainingDays !== null && remainingDays <= URGENCY_POLICY.flexibleHighWhenDaysRemaining) {
    band = "High";
  }

  const unattended = !input.meaningfulSinceCycleStart;
  const ageDays = (now - start) / DAY_MS;
  const approach =
    (kind === "seven_days" && ageDays >= URGENCY_POLICY.sevenDayUnattendedAfterDays) ||
    (kind === "one_month" && remainingDays !== null && remainingDays <= URGENCY_POLICY.oneMonthHighWhenDaysRemaining) ||
    (kind === "three_months" &&
      remainingDays !== null &&
      remainingDays <= URGENCY_POLICY.threeMonthHighWhenDaysRemaining) ||
    (kind === "six_months" && remainingDays !== null && remainingDays <= URGENCY_POLICY.sixMonthHighWhenDaysRemaining) ||
    (kind === "flexible" && remainingDays !== null && remainingDays <= URGENCY_POLICY.flexibleHighWhenDaysRemaining);
  if (unattended && kind !== "immediate" && approach) band = stepUp(band);
  return { band, overdue: false };
}
