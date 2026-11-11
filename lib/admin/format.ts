const IST = "Asia/Kolkata";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateOnly.format(date);
}

/** "3 days ago", "in 2 hours". */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(diff)) return "—";
  const minutes = Math.round(diff / 60_000);
  const abs = Math.abs(minutes);
  const [value, unit] =
    abs < 60 ? [minutes, "minute"] : abs < 1440 ? [Math.round(minutes / 60), "hour"] : [Math.round(minutes / 1440), "day"];
  if (value === 0) return "just now";
  const n = Math.abs(value);
  const label = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return value < 0 ? `${label} ago` : `in ${label}`;
}

/** Value for <input type="datetime-local"> in IST. */
export function toIstInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

/** Reads an IST datetime-local value back to UTC ISO. */
export function fromIstInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type Tone = "green" | "amber" | "red" | "blue" | "stone" | "violet";

export const TONE_CLASS: Record<Tone, string> = {
  green: "bg-brand-50 text-brand-800 ring-brand-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  stone: "bg-stone-100 text-stone-700 ring-stone-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function verificationTone(status: string): Tone {
  return status === "Verified" ? "green" : status === "Pending" ? "amber" : status === "Rejected" ? "red" : "stone";
}

export function publicationTone(status: string): Tone {
  return status === "Published" ? "blue" : status === "Archived" ? "stone" : "violet";
}

export function availabilityTone(status: string): Tone {
  return status === "Available" ? "green" : status === "On Hold" ? "amber" : status === "Withdrawn" ? "red" : "stone";
}

export function bandTone(band: string): Tone {
  return band === "High" || band === "Hot" ? "red" : band === "Medium" || band === "Warm" ? "amber" : "stone";
}

export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(2).replace(/\.?0+$/, "")} L`;
  return `₹${value.toLocaleString("en-IN")}`;
}

/**
 * A requirement stores one range. Buy means a purchase price. Rent means
 * monthly rent. Callers that know the intent must pass it, so a screen, a
 * filter and a future match never treat the two as the same kind of money.
 */
export function budgetLabel(min: number | null, max: number | null, intent?: "Rent" | "Buy"): string {
  const prefix = intent === "Buy" ? "Purchase " : intent === "Rent" ? "Monthly rent " : "";
  const empty = intent === "Buy" ? "Purchase budget not given" : intent === "Rent" ? "Monthly rent not given" : "Budget not given";
  if (min && max) return `${prefix}${formatInr(min)} – ${formatInr(max)}`;
  if (max) return `${prefix}up to ${formatInr(max)}`;
  if (min) return `${prefix}from ${formatInr(min)}`;
  return empty;
}
