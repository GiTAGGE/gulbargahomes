import Image from "next/image";
import Link from "next/link";

import type { InteriorDesign } from "@/lib/designs";
import { getAllDesigns } from "@/lib/designs";

import { ArrowIcon } from "./icons";

export function HomeDesignGallerySection() {
  const designs = getAllDesigns();
  const featured = designs.filter((d) => d.featured);
  const preview = (featured.length ? featured : designs).slice(0, 6);

  if (!preview.length) return null;

  return (
    <section id="design-gallery" className="scroll-mt-20 border-y border-brand-100 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
              Finalized designs
            </p>
            <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl lg:text-4xl">
              Interior & kitchen previews
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Layouts, finishes and lighting planned for Gulbarga homes — review the design before
              work starts on site. These are design visuals, separate from live construction photos
              in our project portfolio.
            </p>
          </div>
          <Link
            href="/designs"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            View all designs <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {preview.map((design) => (
            <DesignCard key={design.slug} design={design} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function DesignCard({ design }: { design: InteriorDesign }) {
  return (
    <Link
      href={`/designs/${design.slug}`}
      className="group card overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="relative aspect-[4/3] bg-brand-50">
        <Image
          src={design.image}
          alt=""
          fill
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
          sizes="(max-width: 1024px) 100vw, 33vw"
        />
        <span className="absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          Design preview
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          {design.roomType}
        </p>
        <h3 className="mt-1 text-base font-bold text-ink sm:text-lg">{design.title}</h3>
      </div>
    </Link>
  );
}

export function DesignGrid({ designs }: { designs: InteriorDesign[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {designs.map((design) => (
        <DesignCard key={design.slug} design={design} />
      ))}
    </div>
  );
}
