import "server-only";

import { cache } from "react";

import { getDatabase, getMediaBucket as getBoundMediaBucket, resetDatabaseReady } from "./db/database";
import { rowToProperty, type PropertyRow } from "./db/property-rows";
import { canonicalLocalityName, localitiesMatch } from "./locality";
import { loadSeedProperties, sortProperties } from "./property-normalize";
import type { Property } from "./types";

const DEV_FILE = ".data/properties.json";

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

  const seeded = sortProperties(loadSeedProperties());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(seeded, null, 2));
  return seeded;
}

/**
 * Every property the public site may show. Reads the `public_properties` view,
 * which only returns Verified + Published listings. Drafts, rejected, archived,
 * discreet and withdrawn inventory never leave the admin.
 */
export const getAllProperties = cache(async (): Promise<Property[]> => {
  const db = await getDatabase();
  if (db) {
    const result = await db.prepare("SELECT * FROM public_properties").all<PropertyRow>();
    return sortProperties(result.results.map(rowToProperty));
  }

  if (process.env.NODE_ENV === "development") {
    return readDevFile();
  }

  return sortProperties(loadSeedProperties());
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

export function clearPropertyCache() {
  resetDatabaseReady();
}

export async function getMediaBucket() {
  return getBoundMediaBucket();
}
