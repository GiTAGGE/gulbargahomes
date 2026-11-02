import type { Metadata } from "next";
import Link from "next/link";

import { JvRegistrationForm } from "@/components/jv-registration-form";
import { JsonLd } from "@/components/jsonld";
import { breadcrumbSchema, metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Agricultural land joint venture in Gulbarga (Kalaburagi)",
  description: metaDescription(
    "Landowners in Gulbarga (Kalaburagi) and nearby taluks can send a joint-venture enquiry. GulbargaHomes may introduce suitable investors or developers. No return is promised.",
  ),
  alternates: { canonical: "/agricultural-land-joint-venture" },
};

const areas = [
  "Kalaburagi",
  "Afzalpur",
  "Kamalapur",
  "Sedam",
  "Kalagi",
  "Jewargi",
  "Nelogi",
  "Shahabad",
  "Chincholi",
  "surrounding villages",
];

export default function AgriculturalLandJvPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-pagefind-body>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", url: site.url },
          {
            name: "Agricultural land joint venture",
            url: `${site.url}/agricultural-land-joint-venture`,
          },
        ])}
      />
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
        Gulbarga · Kalaburagi
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Agricultural land joint venture
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">
        If you own agricultural land around Gulbarga (Kalaburagi), you can ask GulbargaHomes to
        review a joint-venture enquiry. We connect landowners with people who may want to discuss
        development. We do not promise an investor, a project, a profit, or a signed agreement.
      </p>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">
        Areas we are speaking with landowners about: {areas.join(", ")}.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-ink-muted">
        <li>The form does not upload documents and does not create a website account.</li>
        <li>Sending it opens WhatsApp to {site.contacts[0].phoneDisplay} with your answers.</li>
        <li>
          Read the{" "}
          <Link href="/privacy-policy" className="font-semibold text-brand-700 hover:underline">
            Privacy Policy
          </Link>{" "}
          and the{" "}
          <Link href="/terms-and-conditions" className="font-semibold text-brand-700 hover:underline">
            terms
          </Link>{" "}
          before you submit.
        </li>
      </ul>
      <JvRegistrationForm />
    </div>
  );
}
