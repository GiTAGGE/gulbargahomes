import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { TrackedPhoneLink } from "@/components/analytics/tracked-contact";
import { EnquiryPrivacyNote } from "@/components/enquiry-privacy-note";
import { EnquiryLaunchButton } from "@/components/enquiry/enquiry-provider";
import { ArrowIcon } from "@/components/icons";
import type { HomeService } from "@/lib/services";
import { homeServices } from "@/lib/services";
import { site } from "@/lib/site";

export function serviceMetadata(service: HomeService): Metadata {
  return {
    title: `${service.title} in Gulbarga (Kalaburagi)`,
    description: `${service.summary} Enquire via GulbargaHomes — ${site.phonesDisplay}.`,
    alternates: { canonical: service.href },
  };
}

export function ServicePageLayout({ service }: { service: HomeService }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link
        href="/#build-renovate"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600"
      >
        <ArrowIcon className="h-4 w-4 rotate-180" /> All build services
      </Link>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-brand-700">
        Gulbarga · Kalaburagi
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        {service.title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-muted">{service.summary}</p>

      <div className="relative mt-8 aspect-[16/10] overflow-hidden rounded-2xl bg-brand-50">
        <Image
          src={service.image}
          alt={service.imageAlt}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 768px"
          priority
        />
      </div>

      <ul className="mt-8 space-y-3">
        {service.bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex gap-3 rounded-xl border border-brand-100 bg-white px-4 py-3 text-sm text-ink"
          >
            <span className="font-bold text-brand-600">·</span>
            {bullet}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <EnquiryLaunchButton launch={{ cta: "service" }} className="btn-primary">
          Send an enquiry
        </EnquiryLaunchButton>
        <Link href="/properties" className="btn-ghost justify-center">
          Browse properties
        </Link>
      </div>

      <p className="mt-10 text-sm text-ink-muted">
        Call{" "}
        {site.contacts.map((contact, index) => (
          <span key={contact.phone}>
            {index > 0 ? " · " : null}
            <TrackedPhoneLink
              href={`tel:${contact.phone}`}
              source="service"
              context={{
                contact_phone: contact.phoneDisplay,
                content_name: service.title,
                page_type: "service",
              }}
              className="font-semibold text-brand-700 hover:text-brand-800"
            >
              {contact.phoneDisplay}
            </TrackedPhoneLink>
          </span>
        ))}{" "}
        or send an enquiry with your locality, plot size and rough budget — we will outline
        the next step for {service.title.toLowerCase()} in Gulbarga (Kalaburagi).
      </p>
      <EnquiryPrivacyNote className="mt-3" />
    </div>
  );
}

export function getService(slug: string): HomeService | undefined {
  return homeServices.find((entry) => entry.slug === slug);
}
