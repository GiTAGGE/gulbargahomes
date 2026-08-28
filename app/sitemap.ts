import type { MetadataRoute } from "next";

import { getLocationPages } from "@/lib/locations";
import { getAllProperties } from "@/lib/properties";
import { site } from "@/lib/site";

/** XML requires & in URLs to be written as &amp; inside <loc> elements. */
function escapeSitemapUrl(url: string): string {
  return url.replace(/&/g, "&amp;");
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: escapeSitemapUrl(site.url),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: escapeSitemapUrl(`${site.url}/properties`),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: escapeSitemapUrl(`${site.url}/about`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: escapeSitemapUrl(`${site.url}/contact`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  const propertyRoutes = getAllProperties().map((property) => ({
    url: escapeSitemapUrl(`${site.url}/properties/${property.slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  const locationRoutes = getLocationPages().map((page) => ({
    url: escapeSitemapUrl(`${site.url}/${page.slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  return [...staticRoutes, ...propertyRoutes, ...locationRoutes];
}
