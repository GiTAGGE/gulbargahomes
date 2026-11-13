"use client";

import { EnquiryPrivacyNote } from "@/components/enquiry-privacy-note";
import { EnquiryLaunchButton } from "@/components/enquiry/enquiry-provider";
import { PhoneIcon } from "@/components/icons";
import { priceBand, trackPhoneClick } from "@/lib/analytics/track";
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

function listingLaunch(property: Property, cta: "property_card" | "property_sticky") {
  return {
    cta,
    path: "buyer" as const,
    propertySlug: property.slug,
    propertyTitle: property.title,
    listing: property.listing,
    propertyType: property.propertyType,
    locality: property.locality,
    bhk: property.bhk,
  };
}

export function PropertyContactCard({ property }: { property: Property }) {
  const context = analyticsContext(property);

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
            onClick={() =>
              trackPhoneClick("property_card", {
                ...context,
                contact_phone: contact.phoneDisplay,
              })
            }
          >
            <PhoneIcon className="h-5 w-5" /> Call {contact.phoneDisplay}
          </a>
        ))}
        <EnquiryLaunchButton launch={listingLaunch(property, "property_card")} className="btn-ghost w-full justify-center">
          Enquire about this home
        </EnquiryLaunchButton>
      </div>

      <EnquiryPrivacyNote className="mt-4 text-center" />
    </div>
  );
}

export function PropertyStickyContactBar({ property }: { property: Property }) {
  const context = analyticsContext(property);

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
              onClick={() =>
                trackPhoneClick("property_sticky", {
                  ...context,
                  contact_phone: contact.phoneDisplay,
                })
              }
            >
              <PhoneIcon className="h-3.5 w-3.5" /> {contact.phoneDisplay.replace("+91 ", "")}
            </a>
          ))}
        </div>
        <EnquiryLaunchButton
          launch={listingLaunch(property, "property_sticky")}
          className="btn-ghost shrink-0 px-3 py-2 text-xs"
          ariaLabel={`Enquire about ${property.title}`}
        >
          Enquire
        </EnquiryLaunchButton>
      </div>
    </div>
  );
}
