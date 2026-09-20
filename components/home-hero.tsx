import Image from "next/image";
import Link from "next/link";

import { getLocalities } from "@/lib/properties";
import { heroBlurDataUrl } from "@/lib/hero-blur";

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
  const popularLocalities = localities.slice(0, 4);

  return (
    <section className="relative isolate overflow-hidden bg-[#123d32]">
      <div className="relative flex h-[calc(100svh-3.5rem)] flex-col sm:h-[calc(100svh-4rem)] lg:h-auto lg:min-h-[36rem] xl:min-h-[38rem]">
        <Image
          src="/images/hero/scene-mobile.webp"
          alt="Residential street and the historic fort in Gulbarga (Kalaburagi)."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="object-cover object-[left_center] sm:hidden"
        />
        <Image
          src="/images/hero/scene-desktop.webp"
          alt="Residential street and the historic fort in Gulbarga (Kalaburagi)."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="hidden object-cover object-[28%_center] sm:block"
        />

        {/* Mobile: green atmosphere over the photograph so type and form read on one screen. */}
        <div className="absolute inset-0 bg-[#123d32]/55 lg:hidden" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0e3329]/30 via-[#123d32]/50 to-[#0c2b24]/90 lg:hidden" />

        {/* Desktop: light wash only on the scenic side. */}
        <div className="absolute inset-0 hidden bg-gradient-to-r from-white/94 via-white/55 to-transparent lg:block lg:w-[58%]" />

        <HeroGreenSlash />
        <HeroLeaves />
        <HeroSkyline />

        <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-1 flex-col justify-between gap-5 px-4 py-5 pb-[4.75rem] sm:px-6 sm:py-7 sm:pb-[4.75rem] lg:min-h-[36rem] lg:flex-row lg:items-stretch lg:gap-6 lg:py-10 lg:pb-10 xl:min-h-[38rem]">
          <div className="flex min-h-0 flex-1 flex-col justify-between gap-5 lg:max-w-3xl">
            <div className="lg:flex lg:items-start lg:justify-between lg:gap-6">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80 lg:text-[11px] lg:text-brand-700">
                  Gulbarga · Kalaburagi
                </p>
                <h1 className="mt-1.5 max-w-xl text-[1.85rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl lg:mt-2 lg:text-[3.15rem] lg:text-brand-800">
                  Find Your{" "}
                  <span className="font-extrabold">Perfect Home</span>
                  <span className="mt-0.5 block font-medium lg:mt-1">in Gulbarga</span>
                </h1>
                <p className="mt-2 max-w-md text-sm font-medium text-white/75 lg:mt-3 lg:text-base lg:text-ink-muted">
                  Better Homes · Stronger Communities
                </p>
              </div>

              <nav
                aria-label="Property categories"
                className="mt-5 grid grid-cols-5 gap-1 lg:mt-3 lg:flex lg:shrink-0 lg:gap-3"
              >
                {heroCategories.map(({ label, href, Icon }) => (
                  <Link
                    key={label}
                    href={href}
                    className="group flex flex-col items-center gap-1 lg:rounded-full lg:bg-white/70 lg:px-3 lg:py-2.5 lg:backdrop-blur-sm"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/25 transition group-hover:bg-white group-hover:text-brand-700 lg:h-12 lg:w-12 lg:bg-white lg:text-brand-700 lg:shadow-soft lg:ring-brand-700/10 lg:group-hover:bg-brand-700 lg:group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-[11px] font-semibold text-white lg:text-xs lg:text-brand-800">
                      {label}
                    </span>
                  </Link>
                ))}
              </nav>
            </div>

            <div className="w-full max-w-3xl">
              <SearchBar localities={localities} variant="overlay" />
              <div className="mt-3 hidden flex-wrap items-center gap-2 text-xs text-brand-800/80 lg:flex">
                <span className="font-medium text-brand-700">Popular</span>
                {popularLocalities.map((locality) => (
                  <Link
                    key={locality}
                    href={`/properties?locality=${encodeURIComponent(locality)}`}
                    className="rounded-full bg-white/70 px-2.5 py-1 font-medium text-brand-800 ring-1 ring-brand-800/10 backdrop-blur-sm hover:bg-white"
                  >
                    {locality}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <aside className="relative hidden w-[min(22rem,34%)] shrink-0 flex-col items-center justify-center text-center text-white lg:flex">
            <span className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-[1.35rem] bg-white/12 text-[2.05rem] font-bold tracking-tight ring-1 ring-white/30">
              G
            </span>
            <p className="mt-5 text-[2rem] font-semibold tracking-tight">
              Gulbarga<span className="font-medium">Homes</span>
            </p>
            <p className="mt-2.5 text-sm font-medium tracking-[0.12em] text-white/80">
              Rent · Buy · Houses · Flats · Plots
            </p>
            <p className="mt-10 max-w-[9.5rem] text-right text-[10px] font-semibold uppercase leading-4 tracking-[0.2em] text-white/45 self-end pr-2">
              Homes
              <br />
              People
              <br />
              Community
              <br />
              Tomorrow
            </p>
            <p className="mt-6 font-serif text-xl italic text-white/40">Gulbarga</p>
          </aside>
        </div>
      </div>
    </section>
  );
}

function HeroGreenSlash() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
    >
      {/* Traced from the shared banner: 75% at the top → ~51% at the bottom. */}
      <path
        d="M75 0 C 73.8 18 72 34 70 42 C 66.8 58 60.5 84 50.8 100 H 100 V 0 Z"
        fill="#123d32"
      />
      <path
        d="M78 0 C 76.5 20 74 40 72 50 C 69 68 64 86 56 100 H 100 V 0 Z"
        fill="#0e3329"
        opacity="0.35"
      />
    </svg>
  );
}

function HeroLeaves() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 260"
      className="pointer-events-none absolute right-0 top-0 hidden h-[58%] w-[22%] text-white/[0.14] lg:block"
    >
      <g fill="currentColor">
        <path d="M198 8c-32 22-48 58-38 98 26-10 54-4 74 22-12-46-8-84-36-120Z" />
        <path d="M156 4c-26 24-30 60-16 94 18-12 40-10 58 8C184 66 178 32 156 4Z" />
        <path d="M210 88c-34 10-52 40-48 74 22-6 44 8 60 28-2-38 6-70-12-102Z" />
      </g>
    </svg>
  );
}

function HeroSkyline() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 280 80"
      className="pointer-events-none absolute bottom-5 left-[52%] hidden w-[14rem] text-white/10 lg:block"
    >
      <g fill="currentColor">
        <rect x="8" y="42" width="18" height="38" rx="1" />
        <rect x="32" y="28" width="14" height="52" rx="1" />
        <path d="M64 78V36l16-12 16 12v42Z" />
        <rect x="118" y="48" width="22" height="32" rx="1" />
        <path d="M160 78V40c8-18 24-18 32 0v38Z" />
        <rect x="200" y="34" width="12" height="44" rx="1" />
        <rect x="218" y="52" width="28" height="26" rx="1" />
        <circle cx="72" cy="22" r="5" />
        <rect x="70" y="8" width="4" height="12" />
      </g>
    </svg>
  );
}
