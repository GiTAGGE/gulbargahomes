"use client";

import { useState } from "react";

import { priceBand, trackShare } from "@/lib/analytics/track";
import type { Property } from "@/lib/types";

import { ShareIcon } from "./icons";

function analyticsContext(property?: Property) {
  if (!property) {
    return { property_title: "Property" };
  }

  return {
    property_slug: property.slug,
    property_title: property.title,
    listing_type: property.listing,
    property_type: property.propertyType,
    locality: property.locality,
    bhk: property.bhk,
    price: property.price,
    price_band: priceBand(property.price),
    status: property.status,
  };
}

export function ShareButton({
  title,
  property,
}: {
  title?: string;
  property?: Property;
}) {
  const [copied, setCopied] = useState(false);
  const label = property?.title ?? title ?? "Property";

  async function share() {
    const url = window.location.href;
    trackShare(analyticsContext(property) ?? { property_title: label });

    if (navigator.share) {
      try {
        await navigator.share({ title: label, url });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <button type="button" onClick={share} className="btn-ghost">
      <ShareIcon className="h-4 w-4" />
      {copied ? "Link copied!" : "Share"}
    </button>
  );
}
