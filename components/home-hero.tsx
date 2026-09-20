import Image from "next/image";
import Link from "next/link";

import { getLocalities } from "@/lib/properties";
import { heroBlurDataUrl } from "@/lib/hero-blur";
import { site } from "@/lib/site";

import { SearchBar } from "@/components/search-bar";
import {
  BuildingIcon,
  HandshakeIcon,
  HomeIcon,
  PinIcon,
  PlotIcon,
} from "@/components/icons";

const heroCategories = [
  { label: "Rent", href: "/properties?listing=Rent", Icon: HomeIcon },
  { label: "Buy", href: "/properties?listing=Sale", Icon: HandshakeIcon },
  { label: "Houses", href: "/houses-for-rent-in-gulbarga", Icon: PinIcon },
  { label: "Flats", href: "/flats-for-rent-in-kalaburagi", Icon: BuildingIcon },
  { label: "Plots", href: "/plots-for-sale-in-gulbarga", Icon: PlotIcon },
];

export function HomeHero() {
  const localities = getLocalities();
  const popularLocalities = localities.slice(0, 5);

  return (
    <section className="relative isolate overflow-hidden bg-[#123d32]">
      <h1 className="sr-only">{site.tagline}</h1>

      <div className="relative aspect-[4/5] min-h-[52svh] w-full sm:aspect-[960/357] sm:min-h-0">
        <Image
          src="/images/hero/hero-mobile.webp"
          alt="Find your perfect home in Gulbarga (Kalaburagi) — rent, buy, houses, flats and plots."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="object-cover object-[left_12%] sm:hidden"
        />
        <Image
          src="/images/hero/hero-desktop.webp"
          alt="Find your perfect home in Gulbarga (Kalaburagi) — rent, buy, houses, flats and plots."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="hidden object-cover object-center sm:block"
        />
      </div>

      <div className="relative bg-[#123d32] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex gap-3 overflow-x-auto pb-1 sm:hidden">
            {heroCategories.map(({ label, href, Icon }) => (
              <Link
                key={label}
                href={href}
                className="flex min-w-[4.25rem] flex-col items-center gap-1.5 text-white"
              >
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/25">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[11px] font-semibold">{label}</span>
              </Link>
            ))}
          </div>

          <div className="mx-auto w-full max-w-4xl">
            <SearchBar localities={localities} />
          </div>

          <div className="mx-auto mt-4 flex max-w-4xl flex-wrap items-center justify-center gap-2 text-sm text-white/85">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
              <PinIcon className="h-3.5 w-3.5" />
              Gulbarga · Kalaburagi
              <span className="hidden text-white/60 sm:inline">| Places People Call Home</span>
            </span>
            <span className="hidden text-white/70 sm:inline">Popular:</span>
            {popularLocalities.map((locality) => (
              <Link
                key={locality}
                href={`/properties?locality=${encodeURIComponent(locality)}`}
                className="hidden rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20 sm:inline-flex"
              >
                {locality}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
