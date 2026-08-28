import { site } from "./site";
import type { Listing, PropertyType } from "./types";

const TYPE_SLUGS: Record<PropertyType, string> = {
  House: "house",
  Flat: "flat",
  Villa: "villa",
  Plot: "plot",
  Commercial: "commercial",
  PG: "pg",
};

export function getLocationSlug(
  listing: Listing,
  propertyType: PropertyType,
  locality: string,
): string {
  const type = TYPE_SLUGS[propertyType];
  const loc = localitySlug(locality);
  return listing === "Rent"
    ? `rent-${type}-${loc}`
    : `${type}-for-sale-${loc}`;
}

/** Trim and collapse whitespace for consistent locality values. */
export function normalizeLocality(locality: string): string {
  return locality.trim().replace(/\s+/g, " ");
}

export function localitySlug(locality: string): string {
  return normalizeLocality(locality).toLowerCase().replace(/\s+/g, "-");
}

export function localitiesMatch(a: string, b: string): boolean {
  return localitySlug(a) === localitySlug(b);
}

/** Prefer the label from site.localities when the slug matches. */
export function canonicalLocalityName(locality: string): string {
  const normalized = normalizeLocality(locality);
  const slug = localitySlug(normalized);
  const known = site.localities.find((entry) => localitySlug(entry) === slug);
  return known ?? normalized;
}

/** Resolve a filter/query locality to a known listing label when possible. */
export function resolveLocalityFilter(
  value: string | null | undefined,
  localities: string[],
): string {
  if (!value || value === "Any") return "Any";

  const normalized = normalizeLocality(value);
  if (localities.includes(normalized)) return normalized;

  const slug = localitySlug(normalized);
  const match = localities.find((entry) => localitySlug(entry) === slug);
  return match ?? normalized;
}
