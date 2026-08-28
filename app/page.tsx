import type { Metadata } from "next";
import Link from "next/link";

import { HomeHero } from "@/components/home-hero";
import { JsonLd } from "@/components/jsonld";
import { PropertyCard } from "@/components/property-card";
import { RecentlyViewed } from "@/components/recently-viewed";
import { ArrowIcon, CheckIcon, PinIcon } from "@/components/icons";
import { faqSchema, homeFaqs, itemListSchema, metaDescription } from "@/lib/seo";
import { getAllProperties, getFeaturedProperties, getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const revalidate = 60;

export const metadata: Metadata = {
  title: site.homeSeoTitle,
  alternates: { canonical: "/" },
  description: metaDescription(site.description),
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
  { label: "PG / Hostels", href: "/properties?type=PG" },
];

const reasons = [
  {
    title: "Gulbarga-only inventory",
    body: "Every listing is in Kalaburagi — Sedam Road, Azadpur, Biddapur, Kusnoor and more. No Bangalore spam, no pan-India dumps.",
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

export default function HomePage() {
  const featured = getFeaturedProperties(6);
  const allProperties = getAllProperties();
  const localities = getLocalities();
  const rentCount = allProperties.filter((item) => item.listing === "Rent").length;
  const saleCount = allProperties.filter((item) => item.listing === "Sale").length;
  const plotCount = allProperties.filter((item) => item.propertyType === "Plot").length;

  return (
    <div data-pagefind-body>
      <JsonLd data={itemListSchema("Featured properties in Gulbarga", featured)} />
      <JsonLd data={faqSchema(homeFaqs)} />
      <HomeHero />

      <section className="border-b border-brand-100 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-brand-100 sm:grid-cols-4">
          {[
            { value: `${allProperties.length}+`, label: "Live listings" },
            { value: `${localities.length}`, label: "Kalaburagi areas" },
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
        <h2 className="text-xl font-bold text-ink sm:text-2xl">Browse by category</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Rentals, house sales and residential plots across Gulbarga and Kalaburagi.
        </p>
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

      <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink sm:text-2xl">Featured properties</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Handpicked homes and plots across Gulbarga&apos;s most-searched localities.
            </p>
          </div>
          <Link
            href="/properties"
            className="hidden items-center gap-1 text-sm font-semibold text-brand-600 sm:inline-flex"
          >
            View all <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-5 grid gap-4 sm:mt-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {featured.map((property) => (
            <PropertyCard key={property.slug} property={property} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-ink sm:text-2xl">Popular localities</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Search houses, flats and plots by Kalaburagi neighbourhood.
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {localities.map((locality) => (
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

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">
            Why GulbargaHomes
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            A faster, more professional way to rent, buy or sell in Gulbarga — built for this city, not copied from a metro portal.
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
        <h2 className="text-xl font-bold text-ink sm:text-2xl">
          Frequently asked questions
        </h2>
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
