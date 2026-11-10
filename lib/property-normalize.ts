import { canonicalLocalityName } from "./locality";
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

const EMPTY_NEARBY: Property["nearby"] = {
  schools: [],
  hospitals: [],
  busStop: "",
  railway: "",
};

export function normalizeVideos(raw: unknown): PropertyVideo[] {
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

export function normalizeProperty(
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

export function sortProperties<T extends Property>(properties: T[]): T[] {
  return [...properties].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export function loadSeedProperties(): Property[] {
  return (seedRecords as SeedRecord[]).map((record) =>
    normalizeProperty(
      record.data as Partial<Omit<Property, "description" | "body" | "videos">>,
      record.body,
      record.mtime,
    ),
  );
}

export { EMPTY_NEARBY };
