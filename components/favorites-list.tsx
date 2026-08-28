"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Property } from "@/lib/types";

import { PropertyCard } from "./property-card";

const KEY = "hh-favorites";

export function FavoritesList({ properties }: { properties: Property[] }) {
  const [slugs, setSlugs] = useState<string[]>([]);

  useEffect(() => {
    function load() {
      try {
        setSlugs(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
      } catch {
        setSlugs([]);
      }
    }
    load();
    window.addEventListener("hh-favorites-changed", load);
    return () => window.removeEventListener("hh-favorites-changed", load);
  }, []);

  const items = properties.filter((property) => slugs.includes(property.slug));

  if (items.length === 0) {
    return (
      <div className="card grid place-items-center p-16 text-center">
        <p className="text-lg font-semibold">No favorites yet</p>
        <p className="mt-1 text-ink-muted">
          Tap the heart on any property to save it here.
        </p>
        <Link href="/properties" className="btn-primary mt-5">
          Browse properties
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((property) => (
        <PropertyCard key={property.slug} property={property} />
      ))}
    </div>
  );
}
