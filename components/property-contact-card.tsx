"use client";

import { PhoneIcon, WhatsAppIcon } from "@/components/icons";
import { priceBand, trackPhoneClick, trackWhatsAppClick } from "@/lib/analytics/track";
import { formatPrice } from "@/lib/format";
import { site } from "@/lib/site";
import type { Property } from "@/lib/types";

function analyticsContext(property: Property) {
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

export function PropertyContactCard({ property }: { property: Property }) {
  const context = analyticsContext(property);
  const waText = encodeURIComponent(
    `Hi, I'm interested in "${property.title}" (${formatPrice(property)}) listed on GulbargaHomes.`,
  );

  return (
    <div className="card p-5 sm:p-6">
      <p className="text-sm text-ink-muted">
        {property.listing === "Rent" ? "Monthly rent" : "Sale price"}
      </p>
      <p className="text-2xl font-bold text-brand-700 sm:text-3xl">{formatPrice(property)}</p>
      <p className="mt-1 text-sm text-ink-muted">Listed by GulbargaHomes</p>

      <div className="mt-5 grid gap-2">
        {site.contacts.map((contact) => (
          <a
            key={contact.phone}
            href={`tel:${contact.phone}`}
            className="btn-primary w-full justify-center"
            onClick={() => trackPhoneClick("property_card", context)}
          >
            <PhoneIcon className="h-5 w-5" /> Call {contact.phoneDisplay}
          </a>
        ))}
        {site.contacts.map((contact) => (
          <a
            key={`wa-${contact.whatsapp}`}
            href={`https://wa.me/${contact.whatsapp}?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white shadow-soft transition-colors hover:brightness-95"
            onClick={() => trackWhatsAppClick("property_card", context)}
          >
            <WhatsAppIcon className="h-5 w-5" /> WhatsApp {contact.phoneDisplay}
          </a>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-ink-faint">
        Curated listing — reach out to us for details and visits.
      </p>
    </div>
  );
}

export function PropertyStickyContactBar({ property }: { property: Property }) {
  const context = analyticsContext(property);
  const waText = encodeURIComponent(
    `Hi, I'm interested in "${property.title}" on GulbargaHomes.`,
  );

  return (
    <div className="fixed inset-x-0 bottom-16 z-30 border-t border-brand-100 bg-white/95 p-3 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-ink-faint">Listed by GulbargaHomes</p>
          <p className="text-xs text-ink-faint">{property.listing === "Rent" ? "Rent" : "Price"}</p>
          <p className="truncate text-lg font-bold text-brand-700">{formatPrice(property)}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {site.contacts.map((contact) => (
            <a
              key={contact.phone}
              href={`tel:${contact.phone}`}
              className="btn-primary px-3 py-1.5 text-xs"
              onClick={() => trackPhoneClick("property_sticky", context)}
            >
              <PhoneIcon className="h-3.5 w-3.5" /> {contact.phoneDisplay.replace("+91 ", "")}
            </a>
          ))}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {site.contacts.map((contact) => (
            <a
              key={`wa-${contact.whatsapp}`}
              href={`https://wa.me/${contact.whatsapp}?text=${waText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="grid h-8 w-8 place-items-center rounded-full bg-[#25D366] text-white"
              aria-label={`WhatsApp ${contact.phoneDisplay}`}
              onClick={() => trackWhatsAppClick("property_sticky", context)}
            >
              <WhatsAppIcon className="h-4 w-4" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
