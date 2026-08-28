"use client";

import { useEffect, useState } from "react";

import type { Property } from "@/lib/types";

import { PropertyCard } from "./property-card";

const KEY = "hh-recent";

export function RecentlyViewed({
  properties,
  exclude,
}: {
  properties: Property[];
  exclude?: string;
}) {
  const [slugs, setSlugs] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
      setSlugs(stored.filter((slug) => slug !== exclude));
    } catch {
      setSlugs([]);
    }
  }, [exclude]);

  const items = slugs
    .map((slug) => properties.find((property) => property.slug === slug))
    .filter((property): property is Property => Boolean(property))
    .slice(0, 3);

  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <h2 className="text-2xl font-bold">Recently viewed</h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((property) => (
          <PropertyCard key={property.slug} property={property} />
        ))}
      </div>
    </section>
  );
}
