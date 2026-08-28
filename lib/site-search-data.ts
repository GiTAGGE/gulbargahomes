import { getLocationPages } from "./locations";
import { getAllProperties } from "./properties";

export type SiteSearchResult = {
  url: string;
  meta: { title?: string };
  excerpt: string;
};

function matches(query: string, ...values: Array<string | null | undefined>) {
  const normalized = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

export function searchSite(query: string, limit = 8): SiteSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const propertyResults = getAllProperties()
    .filter((property) =>
      matches(
        trimmed,
        property.title,
        property.locality,
        property.city,
        "Gulbarga",
        "Kalaburagi",
        property.propertyType,
        property.description,
        property.listing === "Rent" ? "rent" : "sale",
        property.status,
        property.status === "Rented" ? "rented out" : undefined,
        property.status === "Sold" ? "sold" : undefined,
      ),
    )
    .map((property) => ({
      url: `/properties/${property.slug}`,
      meta: { title: property.title },
      excerpt: `${property.propertyType} in ${property.locality} · ${
        property.listing === "Rent" ? "For rent" : "For sale"
      }`,
    }));

  const locationResults = getLocationPages()
    .filter((page) =>
      matches(trimmed, page.heading, page.locality, page.title, page.description),
    )
    .map((page) => ({
      url: `/${page.slug}`,
      meta: { title: page.heading },
      excerpt: page.description,
    }));

  const seen = new Set<string>();
  const combined = [...propertyResults, ...locationResults].filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });

  return combined.slice(0, limit);
}
