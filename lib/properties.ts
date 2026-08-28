import "server-only";

import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { canonicalLocalityName, localitiesMatch, localitySlug } from "./locality";
import { site } from "./site";
import type { Property, PropertyStatus, PropertyVideo } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content", "properties");

let cache: Property[] | null = null;

const EMPTY_NEARBY: Property["nearby"] = {
  schools: [],
  hospitals: [],
  busStop: "",
  railway: "",
};

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
        src: String(video.src ?? video.file ?? ""),
        youtubeUrl: String(video.youtubeUrl ?? video.url ?? ""),
        thumbnail: String(video.thumbnail ?? ""),
      };
    })
    .filter((video): video is PropertyVideo => Boolean(video?.src || video?.youtubeUrl));
}

function normalizeProperty(
  data: Partial<Omit<Property, "description" | "body">> & {
    videos?: unknown;
  },
  description: string,
): Property {
  const listing = data.listing ?? "Rent";
  const status: PropertyStatus =
    data.status === "Rented" || data.status === "Sold" ? data.status : "Available";
  const priceSuffix =
    data.priceSuffix?.trim() ||
    (listing === "Rent" ? "/month" : "");

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
    coverImage: data.coverImage ?? "",
    gallery: data.gallery ?? [],
    videos: normalizeVideos(data.videos),
    amenities: data.amenities ?? [],
    rules: data.rules ?? [],
    nearby: {
      schools: data.nearby?.schools ?? EMPTY_NEARBY.schools,
      hospitals: data.nearby?.hospitals ?? EMPTY_NEARBY.hospitals,
      busStop: data.nearby?.busStop ?? EMPTY_NEARBY.busStop,
      railway: data.nearby?.railway ?? EMPTY_NEARBY.railway,
    },
    faq: data.faq ?? [],
    mapQuery:
      data.mapQuery ?? `${data.locality ?? site.city}, Kalaburagi, Karnataka`,
    description,
    body: description,
  };
}

function parseProperty(file: string): Property {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
  const { data, content } = matter(raw);
  const description = content.trim();

  return normalizeProperty(
    data as Partial<Omit<Property, "description" | "body">>,
    description,
  );
}

export function getAllProperties(): Property[] {
  if (process.env.NODE_ENV === "production" && cache) return cache;

  if (!fs.existsSync(CONTENT_DIR)) return [];

  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".mdx"));

  const properties = files.map(parseProperty);

  properties.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  if (process.env.NODE_ENV === "production") {
    cache = properties;
  }
  return properties;
}

export function getPropertySlugs(): string[] {
  return getAllProperties().map((property) => property.slug);
}

export function getProperty(slug: string): Property | undefined {
  return getAllProperties().find((property) => property.slug === slug);
}

export function getFeaturedProperties(limit = 6): Property[] {
  return getAllProperties()
    .filter((property) => property.featured)
    .slice(0, limit);
}

export function getSimilarProperties(property: Property, limit = 3): Property[] {
  return getAllProperties()
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

export function getLocalities(): string[] {
  const seen = new Map<string, string>();

  for (const entry of site.localities) {
    const label = canonicalLocalityName(entry);
    seen.set(localitySlug(label), label);
  }

  for (const property of getAllProperties()) {
    const label = canonicalLocalityName(property.locality);
    const slug = localitySlug(label);
    if (!seen.has(slug)) {
      seen.set(slug, label);
    }
  }

  return Array.from(seen.values()).sort();
}

export function clearPropertyCache() {
  cache = null;
}
