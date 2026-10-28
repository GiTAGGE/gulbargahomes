import type { Metadata } from "next";
import Link from "next/link";

import { HomeHero } from "@/components/home-hero";
import {
  HomeBuildRenovateSection,
  HomeProjectsShowcase,
  HomeTrustSection,
} from "@/components/home-platform-sections";
import { HomeDesignGallerySection } from "@/components/design-gallery";
import { JsonLd } from "@/components/jsonld";
import { PropertyCard } from "@/components/property-card";
import { RecentlyViewed } from "@/components/recently-viewed";
import { ArrowIcon, CheckIcon, PinIcon } from "@/components/icons";
import { faqSchema, homeFaqs, itemListSchema, metaDescription } from "@/lib/seo";
import { getAllProperties } from "@/lib/properties";
import { site } from "@/lib/site";

export const revalidate = 60;

export const metadata: Metadata = {
  title: site.homeSeoTitle,
  alternates: { canonical: "/" },
  description: metaDescription(
    `${site.description} Also explore house construction, interiors, modular kitchens and renovation in Kalaburagi.`,
  ),
  openGraph: {
    url: site.url,
    title: site.homeSeoTitle,
    description: metaDescription(site.description),
  },
};

const categories = [
  { label: "Houses for Rent", href: "/houses-for-rent-in-gulbarga" },
  { label: "Flats for Rent", href: "/flats-for-rent-in-kalaburagi" },
  { label: "Plots for Sale", href: "/plots-for-sale-in-gulbarga" },
  { label: "Houses for Sale", href: "/houses-for-sale-in-kalaburagi" },
  { label: "Family Homes", href: "/properties?listing=Rent&family=Preferred" },
  { label: "Bachelor Friendly", href: "/properties?listing=Rent&bachelors=Allowed" },
  { label: "Villas", href: "/villas-for-sale-in-gulbarga" },
  { label: "Commercial Rent", href: "/commercial-for-rent-in-gulbarga" },
  { label: "PG / Hostels", href: "/properties?type=PG" },
];

const reasons = [
  {
    title: "Property + build under one roof",
    body: "Search rentals and sales across Kalaburagi, or discuss construction, kitchens, interiors and renovation with the same local team.",
  },
  {
    title: "Photos and video tours",
    body: "Walkthrough videos sit next to stills so you can shortlist faster before you travel across town.",
  },
  {
    title: "Details that actually matter",
    body: "Vastu, parking, water, furnishing, bachelor and family rules — the filters generic portals skip for this city.",
  },
];

function PropertyStrip({
  title,
  description,
  href,
  items,
}: {
  title: string;
  description: string;
  href: string;
  items: ReturnType<typeof getAllProperties>;
}) {
  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ink sm:text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>
        <Link
          href={href}
          className="hidden items-center gap-1 text-sm font-semibold text-brand-600 sm:inline-flex"
        >
          View all <ArrowIcon className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {items.slice(0, 6).map((property) => (
          <PropertyCard key={property.slug} property={property} />
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const allProperties = getAllProperties();
  const listingLocalities = Array.from(
    new Set(allProperties.map((property) => property.locality)),
  ).sort();
  const rentCount = allProperties.filter((item) => item.listing === "Rent").length;
  const saleCount = allProperties.filter((item) => item.listing === "Sale").length;
  const plotCount = allProperties.filter((item) => item.propertyType === "Plot").length;

  const featured = [...allProperties]
    .sort((a, b) => Number(b.featured) - Number(a.featured))
    .slice(0, 6);
  const rentHomes = allProperties.filter(
    (p) => p.listing === "Rent" && (p.propertyType === "House" || p.propertyType === "Flat"),
  );
  const saleHomes = allProperties.filter(
    (p) => p.listing === "Sale" && p.propertyType !== "Plot" && p.propertyType !== "Commercial",
  );
  const plots = allProperties.filter((p) => p.propertyType === "Plot");
  const commercial = allProperties.filter((p) => p.propertyType === "Commercial");
  const latest = [...allProperties]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, 6);

  return (
    <div data-pagefind-body>
      <JsonLd data={itemListSchema("Current listings in Gulbarga", allProperties.slice(0, 20))} />
      <JsonLd data={faqSchema(homeFaqs)} />
      <HomeHero />

      <section className="border-b border-brand-100 bg-gradient-to-b from-white to-surface/80">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-brand-100 sm:grid-cols-4">
          {[
            { value: `${allProperties.length}`, label: "Live listings" },
            { value: `${listingLocalities.length}`, label: "Kalaburagi areas" },
            { value: `${rentCount}`, label: "Homes for rent" },
            { value: `${plotCount || saleCount}`, label: "Plots & sales" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white px-4 py-6 text-center sm:py-8">
              <p className="text-2xl font-bold tracking-tight text-brand-700 sm:text-3xl">
                {stat.value}
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-faint sm:text-sm">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
              Property search
            </p>
            <h2 className="mt-1 text-xl font-bold text-ink sm:text-2xl">Browse by category</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Rentals, house sales and residential plots across Gulbarga and Kalaburagi.
            </p>
          </div>
          <Link
            href="/properties"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            All listings <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-6 sm:grid-cols-4 sm:gap-3">
          {categories.map((category) => (
            <Link
              key={category.label}
              href={category.href}
              className="card flex items-center justify-between p-3.5 text-sm font-semibold text-ink sm:p-4"
            >
              {category.label}
              <ArrowIcon className="h-4 w-4 shrink-0 text-brand-600" />
            </Link>
          ))}
        </div>
      </section>

      <HomeBuildRenovateSection />
      <HomeDesignGallerySection />
      <HomeProjectsShowcase />

      <div className="border-t border-brand-100 bg-surface/50">
        <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
          <h2 className="text-2xl font-bold text-ink sm:text-3xl">Properties in Kalaburagi</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted sm:text-base">
            Your existing listings stay easy to reach — rent, buy, plots and commercial space on
            GulbargaHomes.
          </p>
        </div>

        <PropertyStrip
          title="Featured & latest picks"
          description="Highlighted homes and plots on the platform right now."
          href="/properties"
          items={featured}
        />
        <PropertyStrip
          title="Houses & flats for rent"
          description="1–3 BHK and independent homes for rent across localities."
          href="/properties?listing=Rent"
          items={rentHomes}
        />
        <PropertyStrip
          title="Homes for sale"
          description="Independent houses, flats and villas listed for purchase."
          href="/properties?listing=Sale"
          items={saleHomes}
        />
        <PropertyStrip
          title="Plots & land"
          description="Residential and agriculture plots when listed on GulbargaHomes."
          href="/plots-for-sale-in-gulbarga"
          items={plots}
        />
        <PropertyStrip
          title="Commercial properties"
          description="Shops, offices and commercial rentals in Kalaburagi."
          href="/commercial-for-rent-in-gulbarga"
          items={commercial}
        />
        <PropertyStrip
          title="Recently added"
          description="Newest owner and agent listings published on the site."
          href="/properties"
          items={latest}
        />
      </div>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <h2 className="text-xl font-bold text-ink sm:text-2xl">Popular localities</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Search houses, flats and plots by Kalaburagi neighbourhood.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {listingLocalities.map((locality) => (
            <Link
              key={locality}
              href={`/properties?locality=${encodeURIComponent(locality)}`}
              className="card flex items-center gap-2 p-3 text-sm font-semibold text-ink"
            >
              <PinIcon className="h-4 w-4 shrink-0 text-brand-600" />
              <span className="truncate">{locality}</span>
            </Link>
          ))}
        </div>
      </section>

      <HomeTrustSection />

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Why GulbargaHomes</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Property search and home services for Gulbarga — built for this city, not copied from a
            metro portal.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {reasons.map((reason) => (
              <div key={reason.title} className="rounded-2xl border border-brand-100 bg-surface p-5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
                  <CheckIcon className="h-4 w-4" />
                </span>
                <h3 className="mt-3 text-base font-bold text-ink">{reason.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{reason.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <h2 className="text-xl font-bold text-ink sm:text-2xl">Frequently asked questions</h2>
        <div className="mt-5 divide-y divide-brand-100 rounded-2xl border border-brand-100 bg-white">
          {homeFaqs.map((entry) => (
            <details key={entry.question} className="group p-4 sm:p-5">
              <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden">
                {entry.question}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{entry.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <RecentlyViewed properties={allProperties} />
    </div>
  );
}
