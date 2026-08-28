"use client";

import { useEffect, useState } from "react";

import { priceBand, trackAddToWishlist } from "@/lib/analytics/track";
import type { Property } from "@/lib/types";

import { HeartIcon } from "./icons";

const KEY = "hh-favorites";

function readFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function analyticsContext(property?: Property) {
  if (!property) return undefined;
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

export function FavoriteButton({
  slug,
  property,
  className = "",
}: {
  slug?: string;
  property?: Property;
  className?: string;
}) {
  const propertySlug = slug ?? property?.slug;
  const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    if (!propertySlug) return;
    setFavorite(readFavorites().includes(propertySlug));
  }, [propertySlug]);

  function toggle(event: React.MouseEvent) {
    if (!propertySlug) return;
    event.preventDefault();
    event.stopPropagation();
    const current = readFavorites();
    const isRemoving = current.includes(propertySlug);
    const next = isRemoving
      ? current.filter((item) => item !== propertySlug)
      : [...current, propertySlug];
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("hh-favorites-changed"));
    setFavorite(next.includes(propertySlug));

    if (!isRemoving) {
      trackAddToWishlist(analyticsContext(property) ?? { property_slug: propertySlug });
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={favorite}
      className={`grid h-9 w-9 place-items-center rounded-full bg-white/85 text-rose-500 shadow-md backdrop-blur transition-transform hover:scale-110 ${className}`}
    >
      <HeartIcon className="h-5 w-5" filled={favorite} />
    </button>
  );
}
