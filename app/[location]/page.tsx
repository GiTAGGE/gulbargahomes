import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PropertyCard } from "@/components/property-card";
import { JsonLd } from "@/components/jsonld";
import {
  getLocationPage,
  getLocationPageProperties,
  getLocationPages,
} from "@/lib/locations";
import { breadcrumbSchema, metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

export const dynamicParams = true;

export function generateStaticParams() {
  return getLocationPages().map((page) => ({ location: page.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { location: string };
}): Metadata {
  const page = getLocationPage(params.location);
  if (!page) return {};

  const properties = getLocationPageProperties(page);
  const heroProperty = properties.find((property) => property.featured) ?? properties[0];
  const description = metaDescription(page.description);

  return {
    title: page.title,
    description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: {
      title: page.title,
      description,
      url: `${site.url}/${page.slug}`,
      ...(heroProperty
        ? {
            images: [{ url: heroProperty.coverImage, alt: heroProperty.title }],
          }
        : {}),
    },
  };
}

export default function LocationPage({
  params,
}: {
  params: { location: string };
}) {
  const page = getLocationPage(params.location);
  if (!page) notFound();

  const properties = getLocationPageProperties(page);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10" data-pagefind-body>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", url: site.url },
          { name: page.heading, url: `${site.url}/${page.slug}` },
        ])}
      />
      <nav className="mb-3 text-sm text-ink-faint">
        <Link href="/" className="hover:text-brand-600">Home</Link>
        <span className="px-1.5">/</span>
        <span className="text-ink">{page.heading}</span>
      </nav>
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{page.heading}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted sm:text-base">
        {page.description}
      </p>
      <p className="mt-3 max-w-2xl text-sm text-ink-muted">
        Gulbarga is officially Kalaburagi — these listings cover the same city.
        Filter on the{" "}
        <Link href="/properties" className="font-semibold text-brand-700">
          properties page
        </Link>{" "}
        by BHK, budget, Vastu and parking, or WhatsApp us from any card for a visit.
      </p>

      <div className="mt-6 grid gap-4 sm:mt-8 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {properties.map((property) => (
          <PropertyCard key={property.slug} property={property} />
        ))}
      </div>

      <div className="mt-8 sm:mt-10">
        <Link href="/properties" className="btn-ghost">
          Browse all properties
        </Link>
      </div>
    </div>
  );
}
