import type { DemandIntent, OwnerIntent, Timeline } from "../crm/options";
import type { PropertyType } from "../types";

/** Meta option values can arrive as keys (`2_bhk`, `within_a_week`). */
export function cleanAnswer(value: string): string {
  return value.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parsePropertyType(value: string): PropertyType | null {
  const text = cleanAnswer(value).toLowerCase();
  if (!text) return null;
  if (/\b(pg|paying guest|hostel)\b/.test(text)) return "PG";
  if (/\b(plot|site|land|layout)\b/.test(text)) return "Plot";
  if (/\bvilla/.test(text)) return "Villa";
  if (/\b(flat|apartment|apt)\b/.test(text)) return "Flat";
  if (/\b(shop|office|commercial|godown|warehouse|showroom)\b/.test(text)) return "Commercial";
  if (/\b(house|home|independent|duplex|bungalow)\b/.test(text)) return "House";
  return null;
}

export function parseBhk(value: string): { min: number | null; max: number | null } {
  const text = cleanAnswer(value).toLowerCase();
  if (/\b1\s*rk\b/.test(text)) return { min: 1, max: 1 };
  const numbers = [...text.matchAll(/(\d+)(?:\s*(?:\+|plus))?/g)].map((match) => Number(match[1])).filter((n) => n > 0 && n <= 10);
  if (numbers.length === 0) return { min: null, max: null };
  const plus = /\d\s*(\+|plus|or more|and above)/.test(text);
  const min = Math.min(...numbers);
  const max = plus ? null : Math.max(...numbers);
  return { min, max };
}

const UNIT: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  l: 100_000,
  lac: 100_000,
  lacs: 100_000,
  lakh: 100_000,
  lakhs: 100_000,
  cr: 10_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
};

/** "₹10,000 - 15,000", "10-15k", "50 lakh", "1.2 Cr", "below 20k", "above 1 crore". */
export function parseMoney(value: string): { min: number | null; max: number | null } {
  const text = cleanAnswer(value).toLowerCase().replace(/₹|rs\.?|inr|\/-|per month|\/month|monthly|pm\b/g, " ");
  const matches = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b/g)];
  if (matches.length === 0) return { min: null, max: null };
  const lastUnit = [...matches].reverse().find((match) => match[2])?.[2];
  const amounts = matches
    .map((match) => {
      const number = Number(match[1].replace(/,/g, ""));
      const unit = match[2] ?? (matches.length > 1 ? lastUnit : undefined);
      return Math.round(number * (unit ? UNIT[unit] : 1));
    })
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  if (amounts.length === 0) return { min: null, max: null };
  if (amounts.length >= 2) return { min: Math.min(...amounts), max: Math.max(...amounts) };
  const [amount] = amounts;
  if (/\b(above|more than|over|min(imum)?|from|at least|\+)/.test(text) || /\d\s*\+/.test(text)) return { min: amount, max: null };
  return { min: null, max: amount };
}

export function parseTimeline(value: string): Timeline | null {
  const text = cleanAnswer(value).toLowerCase();
  if (!text) return null;
  if (/(immediate|asap|right now|urgent|today|tomorrow|\bnow\b)/.test(text)) return "Immediate";
  if (/(week|7 days|few days|within days)/.test(text)) return "Within 7 days";
  if (/(1 month|one month|this month|30 days|15 days|fortnight|next month|within a month)/.test(text)) return "Within 30 days";
  if (/(2|3|two|three)\s*months?|quarter|1\s*-\s*3 months|60 days|90 days/.test(text)) return "Within 3 months";
  if (/(explor|just looking|not sure|later|6 months|year)/.test(text)) return "Exploring";
  return null;
}

export function parseOwnerIntent(value: string): OwnerIntent | null {
  const text = cleanAnswer(value).toLowerCase();
  if (/\b(sell|sale|selling)\b/.test(text)) return "Sale";
  if (/\b(rent|lease|let|tenant|renting)\b/.test(text)) return "Rent";
  return null;
}

export function parseDemandIntent(value: string): DemandIntent | null {
  const text = cleanAnswer(value).toLowerCase();
  if (/\b(buy|purchase|buying|own)\b/.test(text)) return "Buy";
  if (/\b(rent|lease|tenant|renting)\b/.test(text)) return "Rent";
  return null;
}

/** "Sedam Road, Jewargi Road / Aland Road" → three localities. */
export function splitLocalities(value: string): string[] {
  return cleanAnswer(value)
    .split(/\s*(?:,|\/|;|&|\band\b|\bor\b)\s*/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^(gulbarga|kalaburagi|any|anywhere)$/i.test(item))
    .slice(0, 8);
}
