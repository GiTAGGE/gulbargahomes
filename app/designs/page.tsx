import type { Metadata } from "next";
import Link from "next/link";

import { DesignGrid } from "@/components/design-gallery";
import { ArrowIcon } from "@/components/icons";
import { getAllDesigns, getDesignRoomTypes } from "@/lib/designs";
import { metaDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Interior design gallery",
  description: metaDescription(
    "Finalized interior, kitchen and ceiling design previews for homes in Gulbarga and Kalaburagi.",
  ),
};

export default function DesignsIndexPage({
  searchParams,
}: {
  searchParams: { room?: string };
}) {
  const all = getAllDesigns();
  const room = searchParams.room?.trim();
  const designs = room ? all.filter((d) => d.roomType === room) : all;
  const roomTypes = getDesignRoomTypes();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ArrowIcon className="h-4 w-4 rotate-180" /> Home
      </Link>
      <h1 className="mt-6 text-3xl font-bold text-ink sm:text-4xl">Finalized design gallery</h1>
      <p className="mt-3 max-w-2xl text-ink-muted">
        Approved layout and finish previews for bedrooms, kitchens, living spaces and ceilings —
        shared before on-site work begins in Kalaburagi.
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        <FilterChip href="/designs" label="All" active={!room} />
        {roomTypes.map((type) => (
          <FilterChip
            key={type}
            href={`/designs?room=${encodeURIComponent(type)}`}
            label={type}
            active={room === type}
          />
        ))}
      </div>

      <div className="mt-8">
        <DesignGrid designs={designs} />
      </div>
    </div>
  );
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-ink text-white shadow-soft"
          : "bg-surface text-ink-muted ring-1 ring-brand-100 hover:bg-brand-50 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
