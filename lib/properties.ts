import "server-only";

import { cache } from "react";

import { canonicalLocalityName, localitiesMatch } from "./locality";
import { normalizeMediaUrl } from "./media-url";
import seedRecords from "./property-seed.json";
import { site } from "./site";
import type { Property, PropertyStatus, PropertyVideo } from "./types";

type SeedRecord = {
  slug: string;
  mtime: string;
  body: string;
  data: Record<string, unknown>;
};

type SqlStatement = {
  bind(...values: unknown[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
};

type SqlDb = {
  prepare(query: string): SqlStatement;
};

type DbRow = {
  slug: string;
  title: string;
  listing: Property["listing"];
  status: string;
  property_type: Property["propertyType"];
  bhk: number | null;
  price: number;
  price_suffix: string;
  area: number;
  locality: string;
  city: string;
  facing: Property["facing"];
  vastu: number;
  vegetarian: Property["vegetarian"];
  bachelors: Property["bachelors"];
  family: Property["family"];
  parking: string;
  bathrooms: number;
  furnished: Property["furnished"];
  featured: number;
  is_new: number;
  cover_image: string;
  gallery_json: string;
  videos_json: string;
  published_at: string;
  body: string;
  amenities_json: string;
  rules_json: string;
  nearby_json: string;
  faq_json: string;
  map_query: string;
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS properties (slug TEXT PRIMARY KEY, title TEXT NOT NULL, listing TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Available', property_type TEXT NOT NULL, bhk INTEGER, price INTEGER NOT NULL DEFAULT 0, price_suffix TEXT NOT NULL DEFAULT '', area INTEGER NOT NULL DEFAULT 0, locality TEXT NOT NULL, city TEXT NOT NULL DEFAULT 'Gulbarga', facing TEXT NOT NULL DEFAULT 'East', vastu INTEGER NOT NULL DEFAULT 0, vegetarian TEXT NOT NULL DEFAULT 'Not Required', bachelors TEXT NOT NULL DEFAULT 'Allowed', family TEXT NOT NULL DEFAULT 'Allowed', parking TEXT NOT NULL DEFAULT '', bathrooms INTEGER NOT NULL DEFAULT 0, furnished TEXT NOT NULL DEFAULT 'Unfurnished', featured INTEGER NOT NULL DEFAULT 0, is_new INTEGER NOT NULL DEFAULT 1, cover_image TEXT NOT NULL DEFAULT '', gallery_json TEXT NOT NULL DEFAULT '[]', videos_json TEXT NOT NULL DEFAULT '[]', published_at TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', amenities_json TEXT NOT NULL DEFAULT '[]', rules_json TEXT NOT NULL DEFAULT '[]', nearby_json TEXT NOT NULL DEFAULT '{}', faq_json TEXT NOT NULL DEFAULT '[]', map_query TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_properties_listing ON properties (listing)`,
  `CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status)`,
  `CREATE INDEX IF NOT EXISTS idx_properties_locality ON properties (locality)`,
];

const UPSERT = `
INSERT INTO properties (
  slug, title, listing, status, property_type, bhk, price, price_suffix, area,
  locality, city, facing, vastu, vegetarian, bachelors, family, parking, bathrooms,
  furnished, featured, is_new, cover_image, gallery_json, videos_json, published_at,
  body, amenities_json, rules_json, nearby_json, faq_json, map_query, updated_at
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
  ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
  ?19, ?20, ?21, ?22, ?23, ?24, ?25,
  ?26, ?27, ?28, ?29, ?30, ?31, ?32
)
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  listing = excluded.listing,
  status = excluded.status,
  property_type = excluded.property_type,
  bhk = excluded.bhk,
  price = excluded.price,
  price_suffix = excluded.price_suffix,
  area = excluded.area,
  locality = excluded.locality,
  city = excluded.city,
  facing = excluded.facing,
  vastu = excluded.vastu,
  vegetarian = excluded.vegetarian,
  bachelors = excluded.bachelors,
  family = excluded.family,
  parking = excluded.parking,
  bathrooms = excluded.bathrooms,
  furnished = excluded.furnished,
  featured = excluded.featured,
  is_new = excluded.is_new,
  cover_image = excluded.cover_image,
  gallery_json = excluded.gallery_json,
  videos_json = excluded.videos_json,
  published_at = excluded.published_at,
  body = excluded.body,
  amenities_json = excluded.amenities_json,
  rules_json = excluded.rules_json,
  nearby_json = excluded.nearby_json,
  faq_json = excluded.faq_json,
  map_query = excluded.map_query,
  updated_at = excluded.updated_at
`;

const EMPTY_NEARBY: Property["nearby"] = {
  schools: [],
  hospitals: [],
  busStop: "",
  railway: "",
};

const DEV_FILE = ".data/properties.json";

let databaseReady: Promise<void> | null = null;

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function normalizeVideos(raw: unknown): PropertyVideo[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        const value = entry.trim();
        const isYouTube = /youtu(\.be|be\.com)/i.test(value);
        return {
          title: "Property video",
          src: isYouTube ? "" : value,
          youtubeUrl: isYouTube ? value : "",
          thumbnail: "",
        };
      }

      if (!entry || typeof entry !== "object") return null;
      const video = entry as Record<string, unknown>;
      return {
        title: String(video.title ?? "Property video"),
        src: normalizeMediaUrl(String(video.src ?? video.file ?? "")),
        youtubeUrl: String(video.youtubeUrl ?? video.url ?? ""),
        thumbnail: normalizeMediaUrl(String(video.thumbnail ?? "")),
      };
    })
    .filter((video): video is PropertyVideo => Boolean(video?.src || video?.youtubeUrl));
}

function publishedTimestamp(data: Record<string, unknown>, fallbackIso: string): string {
  const raw = data.publishedAt ?? data.date ?? data.updatedAt;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString();
  }
  return fallbackIso;
}

function normalizeProperty(
  data: Partial<Omit<Property, "description" | "body" | "videos">> & {
    videos?: unknown;
    publishedAt?: unknown;
    date?: unknown;
  },
  description: string,
  fallbackPublishedAt: string,
): Property {
  const listing = data.listing ?? "Rent";
  const status: PropertyStatus =
    data.status === "Rented" || data.status === "Sold" ? data.status : "Available";
  const priceSuffix = data.priceSuffix?.trim() || (listing === "Rent" ? "/month" : "");

  return {
    slug: data.slug ?? "",
    title: data.title ?? "Untitled property",
    listing,
    status,
    propertyType: data.propertyType ?? "Flat",
    bhk: data.bhk ?? null,
    price: data.price ?? 0,
    priceSuffix,
    area: data.area ?? 0,
    locality: canonicalLocalityName(data.locality ?? site.city),
    city: data.city ?? site.city,
    facing: data.facing ?? "East",
    vastu: data.vastu ?? false,
    vegetarian: data.vegetarian ?? "Not Required",
    bachelors: data.bachelors ?? "Allowed",
    family: data.family ?? "Allowed",
    parking: data.parking ?? "",
    bathrooms: data.bathrooms ?? 0,
    furnished: data.furnished ?? "Unfurnished",
    featured: data.featured ?? false,
    isNew: data.isNew ?? true,
    coverImage: normalizeMediaUrl(String(data.coverImage ?? "")),
    gallery: Array.isArray(data.gallery)
      ? data.gallery.map((item) => normalizeMediaUrl(String(item)))
      : [],
    videos: normalizeVideos(data.videos),
    publishedAt: publishedTimestamp(data as Record<string, unknown>, fallbackPublishedAt),
    amenities: data.amenities ?? [],
    rules: data.rules ?? [],
    nearby: {
      schools: data.nearby?.schools ?? EMPTY_NEARBY.schools,
      hospitals: data.nearby?.hospitals ?? EMPTY_NEARBY.hospitals,
      busStop: data.nearby?.busStop ?? EMPTY_NEARBY.busStop,
      railway: data.nearby?.railway ?? EMPTY_NEARBY.railway,
    },
    faq: data.faq ?? [],
    mapQuery: data.mapQuery ?? `${data.locality ?? site.city}, Kalaburagi, Karnataka`,
    description,
    body: description,
  };
}

function sortProperties(properties: Property[]): Property[] {
  return [...properties].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

function loadSeed(): Property[] {
  return (seedRecords as SeedRecord[]).map((record) =>
    normalizeProperty(
      record.data as Partial<Omit<Property, "description" | "body" | "videos">>,
      record.body,
      record.mtime,
    ),
  );
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToProperty(row: DbRow): Property {
  return normalizeProperty(
    {
      slug: row.slug,
      title: row.title,
      listing: row.listing,
      status: row.status === "Rented" || row.status === "Sold" ? row.status : "Available",
      propertyType: row.property_type,
      bhk: row.bhk,
      price: row.price,
      priceSuffix: row.price_suffix,
      area: row.area,
      locality: row.locality,
      city: row.city,
      facing: row.facing,
      vastu: Boolean(row.vastu),
      vegetarian: row.vegetarian,
      bachelors: row.bachelors,
      family: row.family,
      parking: row.parking,
      bathrooms: row.bathrooms,
      furnished: row.furnished,
      featured: Boolean(row.featured),
      isNew: Boolean(row.is_new),
      coverImage: row.cover_image,
      gallery: parseJson<string[]>(row.gallery_json, []),
      videos: parseJson<unknown>(row.videos_json, []),
      publishedAt: row.published_at,
      amenities: parseJson<string[]>(row.amenities_json, []),
      rules: parseJson<string[]>(row.rules_json, []),
      nearby: parseJson<Property["nearby"]>(row.nearby_json, EMPTY_NEARBY),
      faq: parseJson<Property["faq"]>(row.faq_json, []),
      mapQuery: row.map_query,
    },
    row.body,
    row.published_at,
  );
}

function bindsFor(property: Property): unknown[] {
  return [
    property.slug,
    property.title,
    property.listing,
    property.status,
    property.propertyType,
    property.bhk,
    property.price,
    property.priceSuffix,
    property.area,
    property.locality,
    property.city,
    property.facing,
    property.vastu ? 1 : 0,
    property.vegetarian,
    property.bachelors,
    property.family,
    property.parking,
    property.bathrooms,
    property.furnished,
    property.featured ? 1 : 0,
    property.isNew ? 1 : 0,
    property.coverImage,
    JSON.stringify(property.gallery),
    JSON.stringify(property.videos),
    property.publishedAt,
    property.body,
    JSON.stringify(property.amenities),
    JSON.stringify(property.rules),
    JSON.stringify(property.nearby),
    JSON.stringify(property.faq),
    property.mapQuery,
    new Date().toISOString(),
  ];
}

async function cloudflareEnv(): Promise<{ DB?: SqlDb } | null> {
  if (isBuildPhase()) return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return env as { DB?: SqlDb };
  } catch {
    return null;
  }
}

async function database(): Promise<SqlDb | null> {
  const env = await cloudflareEnv();
  return env?.DB ?? null;
}

async function seedIfNeeded(db: SqlDb): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
  const existing = await db
    .prepare("SELECT value FROM app_meta WHERE key = 'properties_seeded'")
    .first<{ value: string }>();
  if (existing?.value === "1") return;

  for (const property of loadSeed()) {
    await db.prepare(UPSERT).bind(...bindsFor(property)).run();
  }

  await db
    .prepare(
      "INSERT INTO app_meta (key, value) VALUES ('properties_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
    )
    .run();
}

async function ensureDatabase(db: SqlDb): Promise<void> {
  if (!databaseReady) {
    databaseReady = seedIfNeeded(db).catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
}

async function readDevFile(): Promise<Property[]> {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const file = path.join(process.cwd(), DEV_FILE);

  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Property[];
    if (Array.isArray(parsed)) return sortProperties(parsed);
  } catch {
    // First local run copies the MDX snapshot into .data/properties.json.
  }

  const seeded = sortProperties(loadSeed());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(seeded, null, 2));
  return seeded;
}

async function writeDevFile(mutator: (current: Property[]) => Property[]): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const current = await readDevFile();
  const next = sortProperties(mutator(current));
  const file = path.join(process.cwd(), DEV_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2));
}

async function upsertProperty(db: SqlDb, property: Property, previousSlug?: string) {
  await ensureDatabase(db);
  if (previousSlug && previousSlug !== property.slug) {
    const taken = await db
      .prepare("SELECT slug FROM properties WHERE slug = ?1")
      .bind(property.slug)
      .first<{ slug: string }>();
    if (taken) {
      throw new Error("Another property already uses that slug.");
    }
  }

  await db.prepare(UPSERT).bind(...bindsFor(property)).run();

  if (previousSlug && previousSlug !== property.slug) {
    await db.prepare("DELETE FROM properties WHERE slug = ?1").bind(previousSlug).run();
  }
}

export const getAllProperties = cache(async (): Promise<Property[]> => {
  const db = await database();
  if (db) {
    await ensureDatabase(db);
    const result = await db.prepare("SELECT * FROM properties").all<DbRow>();
    return sortProperties(result.results.map(rowToProperty));
  }

  if (process.env.NODE_ENV === "development") {
    return readDevFile();
  }

  return sortProperties(loadSeed());
});

export async function getPropertySlugs(): Promise<string[]> {
  return (await getAllProperties()).map((property) => property.slug);
}

export async function getProperty(slug: string): Promise<Property | undefined> {
  return (await getAllProperties()).find((property) => property.slug === slug);
}

export async function getFeaturedProperties(limit = 6): Promise<Property[]> {
  return (await getAllProperties()).filter((property) => property.featured).slice(0, limit);
}

export async function getSimilarProperties(property: Property, limit = 3): Promise<Property[]> {
  return (await getAllProperties())
    .filter((candidate) => candidate.slug !== property.slug)
    .map((candidate) => {
      let score = 0;
      if (localitiesMatch(candidate.locality, property.locality)) score += 3;
      if (candidate.propertyType === property.propertyType) score += 2;
      if (candidate.listing === property.listing) score += 2;
      if (candidate.bhk === property.bhk) score += 1;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export async function getLocalities(): Promise<string[]> {
  const seen = new Map<string, string>();
  for (const property of await getAllProperties()) {
    const label = canonicalLocalityName(property.locality);
    const slug = label.toLowerCase().replace(/\s+/g, "-");
    if (!seen.has(slug)) seen.set(slug, label);
  }
  return Array.from(seen.values()).sort();
}

export async function saveProperty(property: Property, previousSlug?: string): Promise<void> {
  const db = await database();
  if (db) {
    await upsertProperty(db, property, previousSlug);
    return;
  }

  if (process.env.NODE_ENV === "development") {
    await writeDevFile((current) => {
      const withoutOld = current.filter(
        (item) => item.slug !== property.slug && item.slug !== previousSlug,
      );
      if (
        previousSlug &&
        previousSlug !== property.slug &&
        current.some((item) => item.slug === property.slug)
      ) {
        throw new Error("Another property already uses that slug.");
      }
      return [...withoutOld, property];
    });
    return;
  }

  throw new Error(
    "Property database is not available. Create the Cloudflare D1 database named gulbargahomes and bind it as DB.",
  );
}

export async function deleteProperty(slug: string): Promise<void> {
  const db = await database();
  if (db) {
    await ensureDatabase(db);
    await db.prepare("DELETE FROM properties WHERE slug = ?1").bind(slug).run();
    return;
  }

  if (process.env.NODE_ENV === "development") {
    await writeDevFile((current) => current.filter((item) => item.slug !== slug));
    return;
  }

  throw new Error(
    "Property database is not available. Create the Cloudflare D1 database named gulbargahomes and bind it as DB.",
  );
}

export function clearPropertyCache() {
  databaseReady = null;
}

export async function getMediaBucket() {
  if (isBuildPhase()) return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return (env as CloudflareEnv).MEDIA ?? null;
  } catch {
    return null;
  }
}
