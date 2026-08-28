import { getLocationSlug, resolveLocalityFilter } from "./locality";
import type { Listing, PropertyType } from "./types";

export interface ExplorerFilters {
  listing: string;
  status: string;
  type: string;
  locality: string;
  bhk: string;
  budget: number;
  furnished: string;
  facing: string;
  vastu: boolean;
  veg: boolean;
  bachelors: boolean;
  family: boolean;
  parking: boolean;
}

export const EXPLORER_FILTER_DEFAULTS: ExplorerFilters = {
  listing: "Any",
  status: "Any",
  type: "Any",
  locality: "Any",
  bhk: "Any",
  budget: 0,
  furnished: "Any",
  facing: "Any",
  vastu: false,
  veg: false,
  bachelors: false,
  family: false,
  parking: false,
};

const LISTING_OPTIONS = ["Any", "Rent", "Sale"] as const;
const STATUS_OPTIONS = ["Any", "Available", "Rented", "Sold"] as const;
const TYPE_OPTIONS = [
  "Any",
  "House",
  "Flat",
  "Villa",
  "Plot",
  "PG",
  "Commercial",
] as const;
const BHK_OPTIONS = ["Any", "1", "2", "3", "4+"] as const;
const FURNISHED_OPTIONS = [
  "Any",
  "Fully Furnished",
  "Semi Furnished",
  "Unfurnished",
] as const;
const FACING_OPTIONS = ["Any", "East", "West", "North", "South"] as const;

const FILTER_KEYS = [
  "listing",
  "status",
  "type",
  "locality",
  "bhk",
  "budget",
  "furnished",
  "facing",
  "vastu",
  "veg",
  "bachelors",
  "family",
  "parking",
] as const;

const MAX_BUDGET = 20_000_000;

type ParamSource = {
  get(name: string): string | null;
};

function pickOption(
  value: string | null | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  if (!value) return fallback;
  return allowed.includes(value) ? value : fallback;
}

function parseBudget(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MAX_BUDGET);
}

export function parseExplorerFilters(
  params: ParamSource,
  localities: string[],
): ExplorerFilters {
  return {
    listing: pickOption(params.get("listing"), LISTING_OPTIONS, "Any"),
    status: pickOption(params.get("status"), STATUS_OPTIONS, "Any"),
    type: pickOption(params.get("type"), TYPE_OPTIONS, "Any"),
    locality: resolveLocalityFilter(params.get("locality"), localities),
    bhk: pickOption(params.get("bhk"), BHK_OPTIONS, "Any"),
    budget: parseBudget(params.get("budget")),
    furnished: pickOption(params.get("furnished"), FURNISHED_OPTIONS, "Any"),
    facing: pickOption(params.get("facing"), FACING_OPTIONS, "Any"),
    vastu: params.get("vastu") === "true",
    veg: params.get("veg") === "Yes",
    bachelors: params.get("bachelors") === "Allowed",
    family: params.get("family") === "Preferred",
    parking: params.get("parking") === "true",
  };
}

export function explorerFiltersToQuery(filters: ExplorerFilters): string {
  const params = new URLSearchParams();
  if (filters.listing !== "Any") params.set("listing", filters.listing);
  if (filters.status !== "Any") params.set("status", filters.status);
  if (filters.type !== "Any") params.set("type", filters.type);
  if (filters.locality !== "Any") params.set("locality", filters.locality);
  if (filters.bhk !== "Any") params.set("bhk", filters.bhk);
  if (filters.budget > 0) params.set("budget", String(filters.budget));
  if (filters.furnished !== "Any") params.set("furnished", filters.furnished);
  if (filters.facing !== "Any") params.set("facing", filters.facing);
  if (filters.vastu) params.set("vastu", "true");
  if (filters.veg) params.set("veg", "Yes");
  if (filters.bachelors) params.set("bachelors", "Allowed");
  if (filters.family) params.set("family", "Preferred");
  if (filters.parking) params.set("parking", "true");
  return params.toString();
}

export function searchParamsRecordToURLSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = searchParams[key];
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized) params.set(key, normalized);
  }
  return params;
}

export function countActiveExplorerFilters(filters: ExplorerFilters): number {
  let count = 0;
  if (filters.listing !== "Any") count++;
  if (filters.status !== "Any") count++;
  if (filters.type !== "Any") count++;
  if (filters.locality !== "Any") count++;
  if (filters.bhk !== "Any") count++;
  if (filters.budget > 0) count++;
  if (filters.furnished !== "Any") count++;
  if (filters.facing !== "Any") count++;
  if (filters.vastu) count++;
  if (filters.veg) count++;
  if (filters.bachelors) count++;
  if (filters.family) count++;
  if (filters.parking) count++;
  return count;
}

export function hasActiveExplorerFilters(filters: ExplorerFilters): boolean {
  return countActiveExplorerFilters(filters) > 0;
}

function normalizedKnownQuery(params: URLSearchParams): string {
  const normalized = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) normalized.set(key, value);
  }
  return normalized.toString();
}

export function shouldNormalizeExplorerQuery(
  params: URLSearchParams,
  localities: string[],
): boolean {
  const sanitized = explorerFiltersToQuery(parseExplorerFilters(params, localities));
  return sanitized !== normalizedKnownQuery(params);
}

export function normalizedExplorerPath(
  params: URLSearchParams,
  localities: string[],
): string {
  const query = explorerFiltersToQuery(parseExplorerFilters(params, localities));
  return query ? `/properties?${query}` : "/properties";
}

export const BROWSE_DEFAULT_DESCRIPTION =
  "Search and filter curated houses, flats, villas, plots and PGs for rent and sale across Gulbarga (Kalaburagi) with rich filters for Vastu, vegetarian, bachelor and family preferences.";

function pluralTypeLabel(type: string): string {
  if (type === "Any") return "Properties";
  if (type === "PG") return "PG";
  return `${type}s`;
}

function listingPhrase(listing: string): string | null {
  if (listing === "Rent") return "for Rent";
  if (listing === "Sale") return "for Sale";
  return null;
}

function bhkPhrase(bhk: string): string | null {
  if (bhk === "Any") return null;
  return bhk === "4+" ? "4+ BHK" : `${bhk} BHK`;
}

export function hasSecondaryExplorerFilters(filters: ExplorerFilters): boolean {
  return (
    filters.budget > 0 ||
    filters.furnished !== "Any" ||
    filters.facing !== "Any" ||
    filters.vastu ||
    filters.veg ||
    filters.bachelors ||
    filters.family ||
    filters.parking
  );
}

export function getPrimaryExplorerFilters(filters: ExplorerFilters): ExplorerFilters {
  return {
    ...filters,
    budget: 0,
    furnished: "Any",
    facing: "Any",
    vastu: false,
    veg: false,
    bachelors: false,
    family: false,
    parking: false,
  };
}

const LISTING_VALUES = ["Rent", "Sale"] as const;
const TYPE_VALUES = [
  "House",
  "Flat",
  "Villa",
  "Plot",
  "PG",
  "Commercial",
] as const;

function matchesLocationPageFilters(filters: ExplorerFilters): boolean {
  if (hasSecondaryExplorerFilters(filters)) return false;
  if (filters.status !== "Any" || filters.bhk !== "Any") return false;
  if (filters.listing === "Any" || filters.type === "Any" || filters.locality === "Any") {
    return false;
  }

  return (
    LISTING_VALUES.includes(filters.listing as (typeof LISTING_VALUES)[number]) &&
    TYPE_VALUES.includes(filters.type as (typeof TYPE_VALUES)[number])
  );
}

export function shouldNoindexExplorerFilters(filters: ExplorerFilters): boolean {
  return hasActiveExplorerFilters(filters);
}

function buildExplorerDescription(filters: ExplorerFilters, heading: string): string {
  const lead = `Browse curated ${heading.charAt(0).toLowerCase()}${heading.slice(1)} on GulbargaHomes.`;

  const extras: string[] = [];
  if (filters.furnished !== "Any") extras.push(filters.furnished.toLowerCase());
  if (filters.facing !== "Any") extras.push(`${filters.facing.toLowerCase()}-facing`);
  if (filters.budget > 0) {
    extras.push(`within \u20B9${filters.budget.toLocaleString("en-IN")} budget`);
  }
  if (filters.vastu) extras.push("Vastu compliant");
  if (filters.veg) extras.push("vegetarian-friendly");
  if (filters.bachelors) extras.push("bachelor friendly");
  if (filters.family) extras.push("family preferred");
  if (filters.parking) extras.push("with parking");

  const tail =
    "Verified details on parking, water supply, bachelor and family preferences.";

  if (extras.length === 0) return `${lead} ${tail}`;

  return `${lead} Filtered for ${extras.join(", ")}. ${tail}`;
}

export function getExplorerPageCopy(filters: ExplorerFilters): {
  title: string;
  heading: string;
  description: string;
} {
  const metadataFilters = hasSecondaryExplorerFilters(filters)
    ? getPrimaryExplorerFilters(filters)
    : filters;

  if (!hasActiveExplorerFilters(metadataFilters)) {
    return {
      title: "Browse Properties in Gulbarga (Kalaburagi)",
      heading: "Properties in Gulbarga",
      description: BROWSE_DEFAULT_DESCRIPTION,
    };
  }

  const typeLabel = pluralTypeLabel(metadataFilters.type);
  const listing = listingPhrase(metadataFilters.listing);
  const status =
    metadataFilters.status !== "Any" ? metadataFilters.status : null;
  const locality =
    metadataFilters.locality !== "Any" ? metadataFilters.locality : null;
  const bhk = bhkPhrase(metadataFilters.bhk);

  let subject = typeLabel;
  if (metadataFilters.type !== "Any") {
    subject = bhk ? `${bhk} ${typeLabel}` : typeLabel;
  } else if (bhk) {
    subject = `${bhk} Properties`;
  } else {
    subject = "Properties";
  }

  let heading: string;
  const statusSuffix =
    status === "Rented"
      ? " (Rented out)"
      : status === "Sold"
        ? " (Sold)"
        : status === "Available"
          ? " (Available)"
          : "";

  if (locality && listing) {
    heading = `${subject} ${listing} in ${locality}${statusSuffix}`;
  } else if (locality) {
    heading = `${subject} in ${locality}${statusSuffix}`;
  } else if (listing) {
    heading = `${subject} ${listing} in Gulbarga${statusSuffix}`;
  } else if (status) {
    heading =
      status === "Rented"
        ? `${subject} rented out in Gulbarga`
        : status === "Sold"
          ? `${subject} sold in Gulbarga`
          : `Available ${subject.toLowerCase()} in Gulbarga`;
  } else {
    heading = `${subject} in Gulbarga`;
  }

  const title = locality ? `${heading}, Gulbarga` : heading;

  return {
    title,
    heading,
    description: buildExplorerDescription(filters, heading),
  };
}

export function getExplorerCanonicalPath(filters: ExplorerFilters): string {
  if (!hasActiveExplorerFilters(filters)) {
    return "/properties";
  }

  if (matchesLocationPageFilters(filters)) {
    return `/${getLocationSlug(
      filters.listing as Listing,
      filters.type as PropertyType,
      filters.locality,
    )}`;
  }

  return "/properties";
}
