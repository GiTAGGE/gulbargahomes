import { canonicalLocalityName } from "./locality";
import { site } from "./site";
import type {
  Facing,
  Faq,
  Furnishing,
  Listing,
  Nearby,
  Property,
  PropertyStatus,
  PropertyType,
  PropertyVideo,
} from "./types";

const LISTINGS: Listing[] = ["Rent", "Sale"];
const STATUSES: PropertyStatus[] = ["Available", "Rented", "Sold"];
const TYPES: PropertyType[] = ["House", "Flat", "Villa", "Plot", "Commercial", "PG"];
const FACINGS: Facing[] = ["East", "West", "North", "South"];
const FURNISHING: Furnishing[] = ["Fully Furnished", "Semi Furnished", "Unfurnished"];
const VEGETARIAN = ["Yes", "Preferred", "Not Required"] as const;
const BACHELORS = ["Allowed", "Not Allowed"] as const;
const FAMILY = ["Preferred", "Allowed"] as const;

const SLUG_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function emptyProperty(now = new Date().toISOString()): Property {
  return {
    slug: "",
    title: "",
    listing: "Rent",
    status: "Available",
    propertyType: "House",
    bhk: 2,
    price: 0,
    priceSuffix: "/month",
    area: 0,
    locality: "",
    city: site.city,
    facing: "East",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: false,
    isNew: true,
    coverImage: "",
    gallery: [],
    videos: [],
    publishedAt: now,
    description: "",
    body: "",
    amenities: [],
    rules: [],
    nearby: { schools: [], hospitals: [], busStop: "", railway: "" },
    faq: [],
    mapQuery: "",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function integer(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.round(number));
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function mediaPath(value: unknown): string {
  const raw = text(value, 500);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/")) return raw;
  return `/${raw.replace(/^\/+/, "")}`;
}

function videosFrom(value: unknown): PropertyVideo[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const video = asRecord(entry);
      if (!video) return null;
      const src = mediaPath(video.src);
      const youtubeUrl = text(video.youtubeUrl, 300);
      if (!src && !youtubeUrl) return null;
      return {
        title: text(video.title, 160) || "Property video",
        src,
        youtubeUrl,
        thumbnail: mediaPath(video.thumbnail),
      };
    })
    .filter((video): video is PropertyVideo => Boolean(video))
    .slice(0, 8);
}

function faqsFrom(value: unknown): Faq[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const faq = asRecord(entry);
      if (!faq) return null;
      const question = text(faq.question, 240);
      const answer = text(faq.answer, 1000);
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter((faq): faq is Faq => Boolean(faq))
    .slice(0, 20);
}

function nearbyFrom(value: unknown): Nearby {
  const nearby = asRecord(value) ?? {};
  return {
    schools: stringList(nearby.schools, 12, 160),
    hospitals: stringList(nearby.hospitals, 12, 160),
    busStop: text(nearby.busStop, 200),
    railway: text(nearby.railway, 200),
  };
}

export function parsePropertyDraft(
  input: unknown,
): { ok: true; property: Property } | { ok: false; error: string } {
  const data = asRecord(input);
  if (!data) return { ok: false, error: "Property details were missing." };

  const title = text(data.title, 180);
  if (title.length < 3) {
    return { ok: false, error: "Add a title of at least 3 characters." };
  }

  const requestedSlug = text(data.slug, 80) || slugifyTitle(title);
  if (!SLUG_PATTERN.test(requestedSlug)) {
    return {
      ok: false,
      error: "Slug can use letters, numbers, and hyphens only.",
    };
  }

  const locality = canonicalLocalityName(text(data.locality, 80));
  if (!locality) return { ok: false, error: "Add the locality in Gulbarga / Kalaburagi." };

  const listing = oneOf(data.listing, LISTINGS, "Rent");
  const description = text(data.description ?? data.body, 20000);
  const publishedRaw = text(data.publishedAt, 40);
  const published = new Date(publishedRaw);
  const publishedAt = Number.isNaN(published.getTime())
    ? new Date().toISOString()
    : published.toISOString();

  const gallery = (Array.isArray(data.gallery) ? data.gallery : [])
    .map((item) => mediaPath(item))
    .filter(Boolean)
    .slice(0, 40);
  let coverImage = mediaPath(data.coverImage);
  if (!coverImage && gallery[0]) coverImage = gallery[0];

  const priceSuffix =
    text(data.priceSuffix, 24) || (listing === "Rent" ? "/month" : "");
  const mapQuery =
    text(data.mapQuery, 200) || `${locality}, Kalaburagi, Karnataka`;

  const property: Property = {
    slug: requestedSlug,
    title,
    listing,
    status: oneOf(data.status, STATUSES, "Available"),
    propertyType: oneOf(data.propertyType, TYPES, "House"),
    bhk: optionalInteger(data.bhk),
    price: integer(data.price),
    priceSuffix,
    area: integer(data.area),
    locality,
    city: text(data.city, 40) || site.city,
    facing: oneOf(data.facing, FACINGS, "East"),
    vastu: Boolean(data.vastu),
    vegetarian: oneOf(data.vegetarian, VEGETARIAN, "Not Required"),
    bachelors: oneOf(data.bachelors, BACHELORS, "Allowed"),
    family: oneOf(data.family, FAMILY, "Allowed"),
    parking: text(data.parking, 80),
    bathrooms: integer(data.bathrooms),
    furnished: oneOf(data.furnished, FURNISHING, "Unfurnished"),
    featured: Boolean(data.featured),
    isNew: Boolean(data.isNew),
    coverImage,
    gallery,
    videos: videosFrom(data.videos),
    publishedAt,
    description,
    body: description,
    amenities: stringList(data.amenities, 40, 80),
    rules: stringList(data.rules, 30, 120),
    nearby: nearbyFrom(data.nearby),
    faq: faqsFrom(data.faq),
    mapQuery,
  };

  return { ok: true, property };
}
