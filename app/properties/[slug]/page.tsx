import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PropertyBadges } from "@/components/badges";
import { FavoriteButton } from "@/components/favorite-button";
import { Gallery } from "@/components/gallery";
import { PropertyContactCard, PropertyStickyContactBar } from "@/components/property-contact-card";
import { PropertyViewTracker } from "@/components/property-view-tracker";
import { AreaIcon, BathIcon, BedIcon, CheckIcon, PinIcon } from "@/components/icons";
import { JsonLd } from "@/components/jsonld";
import { PropertyBody } from "@/components/property-body";
import { PropertyCard } from "@/components/property-card";
import { RecordView } from "@/components/record-view";
import { ShareButton } from "@/components/share-button";
import { bhkLabel, formatPrice } from "@/lib/format";
import { getProperty, getPropertySlugs, getSimilarProperties } from "@/lib/properties";
import { statusBannerMessage, statusLabel } from "@/lib/property-status";
import {
  breadcrumbSchema,
  faqSchema,
  listingSchema,
  metaDescription,
  videoObjectSchemas,
} from "@/lib/seo";
import { site } from "@/lib/site";
import { propertyHasVideo } from "@/lib/types";
import { absoluteUrl, propertyUrl } from "@/lib/url";

export const dynamicParams = false;

export function generateStaticParams() {
  return getPropertySlugs().map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const property = getProperty(params.slug);
  if (!property) return {};

  const tags: string[] = [];
  if (property.family === "Preferred") tags.push("Family");
  if (property.vegetarian === "Yes") tags.push("Vegetarian");
  if (property.vastu) tags.push("Vastu");
  const tagLabel = tags.length ? ` | ${tags.join(" & ")}` : "";

  const title = `${property.title}, Gulbarga${tagLabel}`;
  const description = metaDescription(
    `${formatPrice(property)} · ${bhkLabel(property)} · ${property.area} sqft · ${property.facing} facing in ${property.locality}, Gulbarga (Kalaburagi). ${property.description}`,
  );
  const url = propertyUrl(property.slug);
  const cover = absoluteUrl(property.coverImage);
  const hasVideo = propertyHasVideo(property);

  return {
    title,
    description,
    alternates: { canonical: `/properties/${property.slug}` },
    openGraph: {
      title,
      description,
      url,
      type: hasVideo ? "video.other" : "website",
      images: [{ url: cover, alt: property.title }],
      ...(hasVideo
        ? {
            videos: property.videos
              .filter((video) => video.src)
              .map((video) => ({
                url: absoluteUrl(video.src),
                type: "video/mp4" as const,
              })),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [cover],
    },
  };
}

function Highlight({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-brand-100 bg-surface-muted/50 p-3 sm:p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 sm:h-10 sm:w-10 sm:rounded-xl">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] text-ink-faint sm:text-xs">{label}</p>
          <p className="truncate text-sm font-semibold text-ink sm:text-base">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function PropertyPage({ params }: { params: { slug: string } }) {
  const property = getProperty(params.slug);
  if (!property) notFound();

  const similar = getSimilarProperties(property, 3);
  const statusMessage = statusBannerMessage(property.status);

  const breadcrumb = [
    { name: "Home", url: site.url },
    { name: "Properties", url: `${site.url}/properties` },
    { name: property.title, url: `${site.url}/properties/${property.slug}` },
  ];

  return (
    <div className="mx-auto max-w-7xl overflow-x-clip px-4 py-5 pb-28 sm:px-6 sm:py-8 lg:pb-8">
      <PropertyViewTracker property={property} />
      <RecordView slug={property.slug} />
      <JsonLd data={listingSchema(property)} />
      {videoObjectSchemas(property).map((schema) => (
        <JsonLd key={String(schema["@id"])} data={schema} />
      ))}
      <JsonLd data={breadcrumbSchema(breadcrumb)} />
      {property.faq.length > 0 && <JsonLd data={faqSchema(property.faq)} />}

      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-ink-faint">
        <Link href="/" className="hover:text-brand-600">Home</Link>
        <span>/</span>
        <Link href="/properties" className="hover:text-brand-600">Properties</Link>
        <span>/</span>
        <span className="text-ink">{property.locality}</span>
      </nav>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_340px] lg:gap-8" data-pagefind-body>
        <div className="min-w-0">
          {statusMessage && (
            <div className="mb-4 rounded-2xl border border-brand-200 bg-surface-muted px-4 py-3 text-sm text-ink-muted">
              <p className="font-semibold text-ink">{statusLabel(property.status)}</p>
              <p className="mt-1">{statusMessage}</p>
            </div>
          )}
          <Gallery property={property} />

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 sm:mt-6">
            <div className="min-w-0 flex-1">
              <PropertyBadges property={property} />
              <h1 className="mt-2 text-xl font-bold tracking-tight text-ink sm:text-3xl">
                {property.title}
              </h1>
              <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
                <PinIcon className="h-4 w-4 shrink-0" />
                {property.locality}, Gulbarga (Kalaburagi)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <FavoriteButton property={property} className="h-10 w-10 sm:h-11 sm:w-11" />
              <ShareButton property={property} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3 sm:grid-cols-4">
            <Highlight icon={<BedIcon className="h-4 w-4 sm:h-5 sm:w-5" />} label="Configuration" value={bhkLabel(property)} />
            <Highlight icon={<BathIcon className="h-4 w-4 sm:h-5 sm:w-5" />} label="Bathrooms" value={property.bathrooms ? `${property.bathrooms}` : "—"} />
            <Highlight icon={<AreaIcon className="h-4 w-4 sm:h-5 sm:w-5" />} label="Built-up area" value={`${property.area} sqft`} />
            <Highlight icon={<CheckIcon className="h-4 w-4 sm:h-5 sm:w-5" />} label="Facing" value={property.facing} />
          </div>

          <div className="mt-4 lg:hidden">
            <PropertyContactCard property={property} />
          </div>

          <section className="mt-6 sm:mt-8">
            <h2 className="text-lg font-bold text-ink sm:text-xl">Overview</h2>
            <div className="mt-2">
              <PropertyBody content={property.body} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <KeyValue label="Status" value={statusLabel(property.status)} />
              <KeyValue label="Listing" value={property.listing === "Rent" ? "For Rent" : "For Sale"} />
              <KeyValue label="Furnishing" value={property.furnished} />
              <KeyValue label="Parking" value={property.parking} />
              <KeyValue label="Vastu" value={property.vastu ? "Compliant" : "Not specified"} />
              <KeyValue label="Vegetarian" value={property.vegetarian} />
              <KeyValue label="Bachelors" value={property.bachelors} />
            </div>
          </section>

          <section className="mt-6 sm:mt-8">
            <h2 className="text-lg font-bold text-ink sm:text-xl">Amenities</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {property.amenities.map((amenity) => (
                <span key={amenity} className="flex items-center gap-2 rounded-xl bg-brand-50/60 px-3 py-2.5 text-sm text-ink">
                  <CheckIcon className="h-4 w-4 shrink-0 text-brand-600" /> {amenity}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-6 sm:mt-8">
            <h2 className="text-lg font-bold text-ink sm:text-xl">Rules &amp; preferences</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {property.rules.map((rule) => (
                <span key={rule} className="chip bg-surface-muted text-ink-muted">
                  {rule}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-6 sm:mt-8">
            <h2 className="text-lg font-bold text-ink sm:text-xl">What&apos;s nearby</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NearbyCard title="Schools" items={property.nearby.schools} />
              <NearbyCard title="Hospitals" items={property.nearby.hospitals} />
              <NearbyCard title="Bus stop" items={[property.nearby.busStop]} />
              <NearbyCard title="Railway station" items={[property.nearby.railway]} />
            </div>
          </section>

          <section className="mt-6 sm:mt-8">
            <h2 className="text-lg font-bold text-ink sm:text-xl">Location</h2>
            <iframe
              title="Map"
              className="mt-3 h-48 w-full rounded-2xl border border-brand-100 sm:h-64"
              loading="lazy"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(property.mapQuery)}&output=embed`}
            />
          </section>

          {property.faq.length > 0 && (
            <section className="mt-6 sm:mt-8">
              <h2 className="text-lg font-bold text-ink sm:text-xl">Frequently asked questions</h2>
              <div className="mt-3 divide-y divide-brand-100 rounded-2xl border border-brand-100">
                {property.faq.map((entry) => (
                  <details key={entry.question} className="group p-4">
                    <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden">
                      {entry.question}
                    </summary>
                    <p className="mt-2 text-sm text-ink-muted">{entry.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="hidden lg:sticky lg:top-20 lg:block lg:h-fit">
          <PropertyContactCard property={property} />
        </aside>
      </div>

      {similar.length > 0 && (
        <section className="mt-10 sm:mt-14">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Similar properties</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {similar.map((item) => (
              <PropertyCard key={item.slug} property={item} />
            ))}
          </div>
        </section>
      )}

      <PropertyStickyContactBar property={property} />
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-b border-brand-50 py-2">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="min-w-0 text-right font-medium text-ink break-words">{value}</span>
    </div>
  );
}

function NearbyCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-white p-4">
      <p className="text-sm font-bold text-ink">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-ink-muted">
        {items.map((item) => (
          <li key={item} className="flex min-w-0 items-start gap-2 break-words">
            <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
