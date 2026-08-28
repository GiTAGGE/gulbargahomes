import type { Metadata } from "next";
import Link from "next/link";

import { metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About GulbargaHomes — Real Estate in Gulbarga (Kalaburagi)",
  description: metaDescription(
    "GulbargaHomes lists houses for rent, flats, independent homes and residential plots in Gulbarga / Kalaburagi — with photos, video walkthroughs and verified local details.",
  ),
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-pagefind-body>
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
        About
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Real estate, built only for Gulbarga
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">
        GulbargaHomes is a curated portal for houses, flats and plots in Gulbarga
        (officially Kalaburagi). Listings stay on this city — Sedam Road, Azadpur,
        Biddapur Colony, Kusnoor, Jewargi Road, Shahbazar, Station Area and the
        neighbourhoods people actually search.
      </p>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">
        Every home comes with clear photos, and many include a short video
        walkthrough, so you can shortlist from your phone before you travel across
        town. We publish the details that matter in Kalaburagi — Vastu, parking,
        water supply, furnishing, and family or bachelor rules — then help you
        book a visit on WhatsApp.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-100 bg-white p-5">
          <h2 className="font-bold text-ink">What we list</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
            <li>Houses and flats for rent</li>
            <li>Independent houses for sale</li>
            <li>Residential plots and layouts</li>
            <li>Villas and PG stays near the university</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-5">
          <h2 className="font-bold text-ink">How to reach us</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Call or WhatsApp {site.phoneDisplay}. Owners in Gulbarga can list a
            house, flat or plot with photos and a video — we will show it to
            buyers and tenants in the city.
          </p>
          <Link href="/contact" className="mt-3 inline-block text-sm font-semibold text-brand-700">
            Contact page →
          </Link>
        </div>
      </div>
    </div>
  );
}
