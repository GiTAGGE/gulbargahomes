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
  const popularLocalities = localities.slice(0, 4);

  return (
    <section className="relative isolate overflow-hidden bg-[#123d32]">
      <div className="relative min-h-[34rem] sm:min-h-[36rem] lg:min-h-[40rem] xl:min-h-[42rem]">
        <Image
          src="/images/hero/hero-mobile.webp"
          alt="Residential street and the historic fort in Gulbarga (Kalaburagi)."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="object-cover object-[left_center] sm:hidden"
        />
        <Image
          src="/images/hero/hero-desktop.webp"
          alt="Residential street and the historic fort in Gulbarga (Kalaburagi)."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="hidden object-cover object-[center_40%] sm:block"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/78 to-white/10 sm:via-white/55 sm:to-transparent lg:w-[68%]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#123d32]/35 via-transparent to-white/25 sm:from-black/20" />

        <div
          aria-hidden
          className="pointer-events-none absolute -right-[12%] -top-[22%] hidden h-[144%] w-[50%] rounded-[100%] bg-[#123d32] shadow-[-40px_0_80px_rgba(12,40,32,0.18)] lg:block"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 hidden h-full w-[28%] bg-gradient-to-l from-[#0e3329] to-transparent lg:block"
        />
        <HeroLeaves />

        <div className="relative z-10 mx-auto flex min-h-[34rem] max-w-7xl flex-col justify-between gap-8 px-4 py-8 sm:min-h-[36rem] sm:px-6 sm:py-10 lg:min-h-[40rem] lg:flex-row lg:items-stretch lg:gap-10 lg:py-12 xl:min-h-[42rem]">
          <div className="flex max-w-3xl flex-1 flex-col justify-between gap-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700">
                Gulbarga · Kalaburagi
              </p>
              <h1 className="mt-2 max-w-xl text-[2.15rem] font-semibold leading-[1.08] tracking-tight text-brand-800 sm:text-5xl lg:text-[3.35rem]">
                Find Your{" "}
                <span className="font-extrabold">Perfect Home</span>
                <span className="mt-1 block font-medium">in Gulbarga</span>
              </h1>
              <p className="mt-3 max-w-md text-sm font-medium text-ink-muted sm:text-base">
                Better Homes · Stronger Communities
              </p>

              <nav
                aria-label="Property categories"
                className="mt-6 flex flex-wrap gap-2.5 sm:gap-3"
              >
                {heroCategories.map(({ label, href, Icon }) => (
                  <Link
                    key={label}
                    href={href}
                    className="group flex items-center gap-2 rounded-full bg-white/80 px-2.5 py-1.5 ring-1 ring-brand-700/10 backdrop-blur-sm transition hover:bg-white hover:ring-brand-600/25 sm:flex-col sm:gap-1.5 sm:bg-white/70 sm:px-3 sm:py-2.5 sm:ring-0"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-brand-700 shadow-soft ring-1 ring-brand-700/10 transition group-hover:bg-brand-700 group-hover:text-white sm:h-12 sm:w-12">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-[11px] font-semibold text-brand-800 sm:text-xs">
                      {label}
                    </span>
                  </Link>
                ))}
              </nav>
            </div>

            <div className="w-full max-w-3xl">
              <SearchBar localities={localities} variant="overlay" />
              <div className="mt-3 hidden flex-wrap items-center gap-2 text-xs text-brand-800/80 sm:flex">
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

          <aside className="relative hidden w-[min(22rem,32%)] shrink-0 flex-col items-center justify-center text-center text-white lg:flex">
            <span className="grid h-[4.25rem] w-[4.25rem] place-items-center rounded-2xl bg-white/12 text-[2rem] font-bold ring-1 ring-white/25">
              G
            </span>
            <p className="mt-4 text-[1.85rem] font-semibold tracking-tight">
              {site.name}
            </p>
            <p className="mt-2 text-sm font-medium tracking-wide text-white/80">
              Rent · Buy · Houses · Flats · Plots
            </p>
            <div className="mt-8 h-px w-24 bg-white/20" />
            <p className="mt-6 max-w-[11rem] text-[11px] font-semibold uppercase leading-5 tracking-[0.18em] text-white/55">
              Homes · People
              <br />
              Community · Tomorrow
            </p>
            <p className="mt-5 font-serif text-lg italic text-white/45">Gulbarga</p>
          </aside>
        </div>
      </div>
    </section>
  );
}

function HeroLeaves() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 280"
      className="pointer-events-none absolute right-0 top-0 hidden h-[55%] w-[18%] text-white/10 lg:block"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M170 12c-28 18-46 48-40 86 22-8 48-6 70 12-10-38-8-70-30-98Z" />
        <path d="M188 48c-18 10-28 28-24 50" />
        <path d="M132 8c-22 22-28 52-18 82 16-10 36-10 54 4-14-32-16-58-36-86Z" />
        <path d="M196 96c-30 8-48 32-46 64 18-4 38 6 54 24-4-32 4-58-8-88Z" />
      </g>
    </svg>
  );
}
