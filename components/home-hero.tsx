import Image from "next/image";
import Link from "next/link";

import { getLocalities } from "@/lib/properties";
import { heroBlurDataUrl } from "@/lib/hero-blur";
import { serviceWhatsAppMessage, whatsAppHref } from "@/lib/services";

import { SearchBar } from "@/components/search-bar";
import {
  ArrowIcon,
  BuildingIcon,
  HandshakeIcon,
  HomeIcon,
  PlotIcon,
  WhatsAppIcon,
} from "@/components/icons";

const quickLinks = [
  { label: "Rent", href: "/properties?listing=Rent", Icon: HomeIcon },
  { label: "Buy", href: "/properties?listing=Sale", Icon: HandshakeIcon },
  { label: "Plots", href: "/plots-for-sale-in-gulbarga", Icon: PlotIcon },
  { label: "Build", href: "/#build-renovate", Icon: BuildingIcon },
];

export function HomeHero() {
  const localities = getLocalities();
  const popularLocalities = localities.slice(0, 3);
  const buildWa = whatsAppHref(serviceWhatsAppMessage("home construction or renovation"));

  return (
    <section className="relative isolate overflow-hidden bg-[#0c2b24]">
      <div className="relative min-h-[calc(100svh-3.5rem)] sm:min-h-[calc(100svh-4rem)] lg:min-h-[42rem]">
        <Image
          src="/images/hero/scene-mobile.webp"
          alt="Homes and neighbourhoods in Gulbarga (Kalaburagi)."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="object-cover object-[center_30%] sm:hidden"
        />
        <Image
          src="/images/hero/scene-desktop.webp"
          alt="Homes and neighbourhoods in Gulbarga (Kalaburagi)."
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="hidden object-cover object-[30%_center] sm:block"
        />

        <div className="absolute inset-0 bg-gradient-to-b from-[#0a241e]/85 via-[#0c2b24]/78 to-[#081f1a]/92" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(255,255,255,0.12),transparent_55%)]" />
        <HeroPattern />

        <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end gap-6 px-4 pb-24 pt-8 sm:px-6 sm:pb-28 lg:justify-center lg:pb-16 lg:pt-12">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">
              Gulbarga · Kalaburagi
            </p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-[3.35rem]">
              Find It. Build It.{" "}
              <span className="block font-extrabold text-[#d4efe4]">Make It Home.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              Your property and home-improvement platform for Kalaburagi — search verified
              listings or plan construction, interiors and renovation with one local team.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:max-w-4xl">
            <Link
              href="/properties"
              className="group relative overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md transition hover:border-white/30 hover:bg-white/15 sm:p-6"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-[#b8dcc9]">
                Property
              </p>
              <p className="mt-2 text-xl font-bold text-white sm:text-2xl">Find a home or plot</p>
              <p className="mt-2 text-sm text-white/75">
                Rent, buy, plots and commercial space across Kalaburagi.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white">
                Browse listings <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>

            <div className="relative overflow-hidden rounded-2xl border border-[#c4a574]/40 bg-gradient-to-br from-[#2a4a3e] to-[#1a3329] p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#e8d5b5]">
                Build & renovate
              </p>
              <p className="mt-2 text-xl font-bold text-white sm:text-2xl">
                From plot to finished home
              </p>
              <p className="mt-2 text-sm text-white/75">
                Construction, kitchens, interiors and full-home upgrades.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/#build-renovate" className="btn-primary text-xs sm:text-sm">
                  Explore services
                </Link>
                <a
                  href={buildWa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"
                >
                  <WhatsAppIcon className="h-4 w-4" /> Discuss your project
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickLinks.map(({ label, href, Icon }) => (
              <Link
                key={label}
                href={href}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur-sm hover:bg-white/15 sm:text-sm"
              >
                <Icon className="h-4 w-4 text-[#b8dcc9]" />
                {label}
              </Link>
            ))}
          </div>

          <div className="w-full max-w-3xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">
              Search listings
            </p>
            <SearchBar localities={localities} variant="overlay" />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/70">
              <span className="font-medium text-white/90">Popular</span>
              {popularLocalities.map((locality) => (
                <Link
                  key={locality}
                  href={`/properties?locality=${encodeURIComponent(locality)}`}
                  className="rounded-full bg-white/10 px-2.5 py-1 font-medium ring-1 ring-white/10 hover:bg-white/15"
                >
                  {locality}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroPattern() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.07]"
      viewBox="0 0 400 800"
      preserveAspectRatio="xMaxYMid slice"
    >
      <defs>
        <pattern id="hero-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="400" height="800" fill="url(#hero-grid)" />
      <path
        d="M320 80 L380 200 L340 380 L400 520 L360 720"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeDasharray="8 12"
      />
    </svg>
  );
}
