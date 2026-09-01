import type { Metadata } from "next";

import { JsonLd } from "@/components/jsonld";
import { breadcrumbSchema, metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact GulbargaHomes — WhatsApp & Call in Kalaburagi",
  description: metaDescription(
    "Talk to GulbargaHomes for houses on rent, flats, plots and house sale in Gulbarga / Kalaburagi. Call or WhatsApp for site visits across Sedam Road, Azadpur, Kusnoor and more.",
  ),
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  const waText = encodeURIComponent(
    "Hi GulbargaHomes, I want help finding a property in Gulbarga / Kalaburagi.",
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-pagefind-body>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", url: site.url },
          { name: "Contact", url: `${site.url}/contact` },
        ])}
      />
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
        Contact
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Talk to us about a home in Gulbarga
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">
        Whether you need a 2 BHK on rent, a family house for sale, or a plot on
        Sedam Road / Kusnoor, message us with the locality and budget. We reply on
        WhatsApp and phone.
      </p>

      <div className="mt-8 grid gap-3">
        <a href={`tel:${site.phone}`} className="btn-primary justify-center">
          Call {site.phoneDisplay}
        </a>
        <a
          href={`https://wa.me/${site.whatsapp}?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white shadow-soft"
        >
          WhatsApp GulbargaHomes
        </a>
        <a href={`mailto:${site.email}`} className="btn-ghost justify-center">
          {site.email}
        </a>
      </div>

      <p className="mt-8 text-sm text-ink-muted">
        GulbargaHomes · Kalaburagi, Karnataka 585101 · Serving Gulbarga city and nearby layouts.
      </p>
    </div>
  );
}
