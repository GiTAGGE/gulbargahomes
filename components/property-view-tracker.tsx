"use client";

import { useEffect, useRef } from "react";

import { priceBand, trackPropertyView } from "@/lib/analytics/track";
import type { Property } from "@/lib/types";

export function PropertyViewTracker({ property }: { property: Property }) {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;

    trackPropertyView({
      property_slug: property.slug,
      property_title: property.title,
      listing_type: property.listing,
      property_type: property.propertyType,
      locality: property.locality,
      bhk: property.bhk,
      price: property.price,
      price_band: priceBand(property.price),
      status: property.status,
    });
  }, [property]);

  return null;
}
