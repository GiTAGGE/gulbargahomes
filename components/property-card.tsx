import Link from "next/link";

import { bhkLabel, formatPrice } from "@/lib/format";
import { isUnavailableStatus } from "@/lib/property-status";
import type { Property } from "@/lib/types";

import { PropertyBadges } from "./badges";
import { FavoriteButton } from "./favorite-button";
import { AreaIcon, BathIcon, BedIcon, PinIcon } from "./icons";
import { PropertyImage } from "./property-image";

export function PropertyCard({ property }: { property: Property }) {
  const unavailable = isUnavailableStatus(property.status);

  return (
    <Link
      href={`/properties/${property.slug}`}
      className={`card group flex flex-col overflow-hidden fade-up ${unavailable ? "opacity-95" : ""}`}
    >
      <div className="relative">
        <PropertyImage
          property={property}
          className={`h-44 w-full transition-transform duration-500 group-hover:scale-[1.02] sm:h-52 ${unavailable ? "grayscale-[35%]" : ""}`}
        />
        <div className="absolute left-3 top-3">
          <PropertyBadges property={property} />
        </div>
        <div className="absolute right-3 top-3">
          <FavoriteButton slug={property.slug} />
        </div>
        <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1 text-sm font-bold text-ink shadow-soft">
          {formatPrice(property)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5 sm:gap-3 sm:p-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">
            {property.listing === "Rent" ? "For Rent" : "For Sale"} ·{" "}
            {property.propertyType}
          </span>
          <h3 className="mt-0.5 line-clamp-2 text-sm font-bold text-ink sm:line-clamp-1 sm:text-base">
            {property.title}
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
            <PinIcon className="h-4 w-4 shrink-0" />
            {property.locality}, Gulbarga
          </p>
        </div>

        <div className="mt-auto flex items-center gap-3 border-t border-brand-50 pt-2.5 text-xs text-ink-muted sm:gap-4 sm:pt-3 sm:text-sm">
          {property.bhk !== null && (
            <span className="flex items-center gap-1">
              <BedIcon className="h-4 w-4" /> {bhkLabel(property)}
            </span>
          )}
          {property.bathrooms > 0 && (
            <span className="flex items-center gap-1">
              <BathIcon className="h-4 w-4" /> {property.bathrooms} Bath
            </span>
          )}
          <span className="flex items-center gap-1">
            <AreaIcon className="h-4 w-4" /> {property.area} sqft
          </span>
        </div>
      </div>
    </Link>
  );
}
