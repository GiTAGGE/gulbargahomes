import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TrackedWhatsAppLink } from "@/components/analytics/tracked-contact";
import { ArrowIcon, WhatsAppIcon } from "@/components/icons";
import { getAllDesigns, getDesign } from "@/lib/designs";
import { serviceWhatsAppMessage, whatsAppHref } from "@/lib/services";
import { site } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllDesigns().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const design = getDesign(slug);
  if (!design) return {};
  return {
    title: design.title,
    description: `${design.roomType} design preview for Gulbarga / Kalaburagi.`,
  };
}

export default async function DesignDetailPage({ params }: Props) {
  const { slug } = await params;
  const design = getDesign(slug);
  if (!design) notFound();

  const wa = whatsAppHref(
    serviceWhatsAppMessage(`a similar ${design.roomType.toLowerCase()} design (${design.title})`),
  );

  return (
    <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link href="/designs" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ArrowIcon className="h-4 w-4 rotate-180" /> All designs
      </Link>

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-brand-700">Design preview</p>
      <h1 className="mt-2 text-3xl font-bold text-ink">{design.title}</h1>
      <p className="mt-2 text-ink-muted">{design.roomType} · Gulbarga / Kalaburagi</p>

      <div className="relative mt-8 aspect-[4/3] overflow-hidden rounded-2xl bg-brand-50 sm:aspect-[16/10]">
        <Image src={design.image} alt="" fill className="object-cover" sizes="900px" priority />
      </div>

      <p className="mt-4 rounded-xl border border-brand-100 bg-surface px-4 py-3 text-sm text-ink-muted">
        This is a finalized design visual — finishes and dimensions are confirmed in discussion before
        construction or installation on your site.
      </p>

      {design.body && (
        <div className="prose-property mt-6 whitespace-pre-wrap">{design.body}</div>
      )}

      <TrackedWhatsAppLink
        href={wa}
        source="design"
        context={{
          contact_phone: site.contacts[0].phoneDisplay,
          content_name: design.title,
          page_type: "design",
        }}
        className="btn-primary mt-10 bg-[#25D366] hover:bg-[#1fb855]"
      >
        <WhatsAppIcon className="h-5 w-5" /> Discuss this design
      </TrackedWhatsAppLink>
    </article>
  );
}
