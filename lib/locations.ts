import { getAllProperties } from "./properties";
import {
  canonicalLocalityName,
  getLocationSlug,
  localitiesMatch,
  localitySlug,
} from "./locality";
import { site } from "./site";
import type { Listing, Property, PropertyType } from "./types";

export interface LocationPage {
  slug: string;
  listing: Listing;
  propertyType: PropertyType | "Any";
  locality: string;
  title: string;
  heading: string;
  description: string;
  cityWide?: boolean;
}

export { localitySlug };

function buildSlug(
  listing: Listing,
  propertyType: PropertyType,
  locality: string,
): string {
  return getLocationSlug(listing, propertyType, locality);
}

function pageFor(
  listing: Listing,
  propertyType: PropertyType,
  locality: string,
): LocationPage {
  const canonical = canonicalLocalityName(locality);
  const verb = listing === "Rent" ? "for Rent" : "for Sale";
  const typeLabel = propertyType === "PG" ? "PG" : `${propertyType}s`;
  return {
    slug: buildSlug(listing, propertyType, canonical),
    listing,
    propertyType,
    locality: canonical,
    title: `${propertyType} ${verb} in ${canonical}, Gulbarga (Kalaburagi)`,
    heading: `${typeLabel} ${verb} in ${canonical}`,
    description: `Browse curated ${propertyType.toLowerCase()} listings ${verb.toLowerCase()} in ${canonical}, Gulbarga (Kalaburagi). Verified details on Vastu, parking, water supply, bachelor and family preferences — only on GulbargaHomes.`,
  };
}

export function getCitySeoPages(): LocationPage[] {
  const city = site.cityDisplay;
  return [
    {
      slug: "houses-for-rent-in-gulbarga",
      listing: "Rent",
      propertyType: "House",
      locality: "",
      cityWide: true,
      title: `Houses for Rent in Gulbarga (Kalaburagi)`,
      heading: "Houses for Rent in Gulbarga",
      description: `Independent houses for rent in ${city} — family homes and bachelor-friendly rentals across Sedam Road, Azadpur, Biddapur Colony, Jewargi Road and Shahbazar.`,
    },
    {
      slug: "flats-for-rent-in-kalaburagi",
      listing: "Rent",
      propertyType: "Flat",
      locality: "",
      cityWide: true,
      title: `Flats for Rent in Kalaburagi (Gulbarga)`,
      heading: "Flats for Rent in Kalaburagi",
      description: `1 BHK, 2 BHK and 3 BHK flats for rent in Kalaburagi / Gulbarga with photos, videos, parking and furnishing details. Search Super Market, Station Area, MSK Mill Road and University Area.`,
    },
    {
      slug: "plots-for-sale-in-gulbarga",
      listing: "Sale",
      propertyType: "Plot",
      locality: "",
      cityWide: true,
      title: `Plots for Sale in Gulbarga (Kalaburagi)`,
      heading: "Residential Plots for Sale in Gulbarga",
      description: `Residential plots for sale in ${city} — Sedam Road, Kusnoor, Ring Road, Kalnoor, Jewargi Road and Aland Road layouts with area, facing and connectivity details.`,
    },
    {
      slug: "houses-for-sale-in-kalaburagi",
      listing: "Sale",
      propertyType: "House",
      locality: "",
      cityWide: true,
      title: `Houses for Sale in Kalaburagi (Gulbarga)`,
      heading: "Houses for Sale in Kalaburagi",
      description: `Independent houses and family homes for sale in Kalaburagi / Gulbarga. Ready-to-move listings in Azadpur, Biddapur Colony, Sedam Road and Court Road.`,
    },
    {
      slug: "villas-for-sale-in-gulbarga",
      listing: "Sale",
      propertyType: "Villa",
      locality: "",
      cityWide: true,
      title: `Villas for Sale in Gulbarga (Kalaburagi)`,
      heading: "Villas for Sale in Gulbarga",
      description: `Premium villas for sale in ${city}. Gated homes with parking, garden space and Vastu-compliant layouts on Sedam Road and Ring Road corridors.`,
    },
  ];
}

export function getLocationPages(): LocationPage[] {
  const seen = new Map<string, LocationPage>();

  for (const page of getCitySeoPages()) {
    seen.set(page.slug, page);
  }

  for (const property of getAllProperties()) {
    const page = pageFor(property.listing, property.propertyType, property.locality);
    if (!seen.has(page.slug)) {
      seen.set(page.slug, page);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

export function getLocationPage(slug: string): LocationPage | undefined {
  return getLocationPages().find((page) => page.slug === slug);
}

export function getLocationPageProperties(page: LocationPage): Property[] {
  return getAllProperties().filter((property) =>
    propertyMatchesLocationPage(property, page),
  );
}

export function propertyMatchesLocationPage(
  property: Property,
  page: LocationPage,
): boolean {
  if (property.listing !== page.listing) return false;
  if (page.propertyType !== "Any" && property.propertyType !== page.propertyType) {
    return false;
  }
  if (page.cityWide || !page.locality) return true;
  return localitiesMatch(property.locality, page.locality);
}
