import Link from "next/link";
import type { ReactNode } from "react";

import { JsonLd } from "@/components/jsonld";
import { breadcrumbSchema } from "@/lib/seo";
import { site } from "@/lib/site";

export const POLICY_UPDATED = "2026-11-02";
export const POLICY_UPDATED_LABEL = "2 November 2026";

export function LegalDocument({
  eyebrow,
  title,
  description,
  path,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-pagefind-body>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", url: site.url },
          { name: title, url: `${site.url}${path}` },
        ])}
      />
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
      <p className="mt-4 text-base leading-relaxed text-ink-muted">{description}</p>
      <p className="mt-3 text-sm text-ink-faint">
        Last updated{" "}
        <time dateTime={POLICY_UPDATED}>{POLICY_UPDATED_LABEL}</time>
      </p>
      <div className="mt-8 space-y-10 text-sm leading-relaxed text-ink-muted sm:text-base">
        {children}
      </div>
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function LegalToc({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="rounded-2xl border border-brand-100 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">On this page</p>
      <ol className="mt-3 space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="font-medium text-brand-700 hover:underline">
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalLinks() {
  return (
    <p>
      Related pages:{" "}
      <Link href="/privacy-policy" className="font-semibold text-brand-700 hover:underline">
        Privacy Policy
      </Link>
      {" · "}
      <Link href="/terms-and-conditions" className="font-semibold text-brand-700 hover:underline">
        Terms
      </Link>
      {" · "}
      <Link href="/data-deletion" className="font-semibold text-brand-700 hover:underline">
        Data deletion
      </Link>
      {" · "}
      <Link
        href="/agricultural-land-joint-venture"
        className="font-semibold text-brand-700 hover:underline"
      >
        Agricultural land JV
      </Link>
    </p>
  );
}
