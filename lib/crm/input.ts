import { HttpError } from "../admin/errors";

export function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function optionalInt(value: unknown, { min = 0, max = 10_000_000_000 } = {}): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(Math.round(number), min), max);
}

export function optionalIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function stringArray(value: unknown, allowed?: readonly string[], maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => text(item, 80))
    .filter(Boolean)
    .filter((item) => !allowed || allowed.includes(item));
  return Array.from(new Set(items)).slice(0, maxItems);
}

export function expectedVersion(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined;
}

export function assertVersion(expected: number | undefined, current: number) {
  if (expected !== undefined && expected !== current) {
    throw new HttpError(409, "Someone else changed this record. Reload to see the latest version.");
  }
}
