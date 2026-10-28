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

const heroFindImage = {
  src: "/images/properties/house-sale-high-court/cover.webp",
  alt: "Independent home for sale near High Court, Gulbarga (Kalaburagi).",
};

const heroBuildImage = {
  src: "/images/properties/30x50-plot-sale-sai-nagar/cover.webp",
  alt: "Residential plot in Sai Nagar, Kalaburagi — starting point for a new build.",
};

export function HomeHero() {
  const localities = getLocalities();
  const popularLocalities = localities.slice(0, 3);
  const buildWa = whatsAppHref(serviceWhatsAppMessage("home construction or renovation"));

  return (
    <section className="relative isolate overflow-hidden bg-[#081f1a]">
      <div className="relative min-h-[calc(100svh-3.5rem)] sm:min-h-[calc(100svh-4rem)] lg:min-h-[44rem]">
        {/* Meaningful dual imagery: listings (home) + plot-to-build */}
        <div className="absolute inset-0 grid grid-cols-1 lg:grid-cols-2">
          <div className="relative min-h-[38vh] lg:min-h-0">
            <Image
              src={heroFindImage.src}
              alt={heroFindImage.alt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              placeholder="blur"
              blurDataURL={heroBlurDataUrl}
              className="object-cover object-center"
            />
            <span className="absolute left-4 top-4 rounded-full bg-ink/55 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white backdrop-blur-sm sm:left-6 sm:top-6">
              Find a home
            </span>
          </div>
          <div className="relative min-h-[32vh] lg:min-h-0">
            <Image
              src={heroBuildImage.src}
              alt={heroBuildImage.alt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              placeholder="blur"
              blurDataURL={heroBlurDataUrl}
              className="object-cover object-center"
            />
            <span className="absolute right-4 top-4 rounded-full bg-[#2a4a3e]/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#e8d5b5] backdrop-blur-sm sm:right-6 sm:top-6">
              Build on your plot
            </span>
          </div>
        </div>

        <div className="absolute inset-0 bg-gradient-to-b from-[#0a241e]/88 via-[#0c2b24]/82 to-[#081f1a]/94 lg:bg-gradient-to-r lg:from-[#0a241e]/92 lg:via-[#0c2b24]/78 lg:to-[#0a241e]/88" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(255,255,255,0.14),transparent_50%)]" />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#c4a574]/50 to-transparent lg:block" />
        <HeroPattern />

        <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end gap-6 px-4 pb-24 pt-8 sm:px-6 sm:pb-28 lg:justify-center lg:pb-16 lg:pt-12">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">
              <span className="h-px w-8 bg-[#c4a574]/70" aria-hidden />
              Gulbarga · Kalaburagi
            </p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-[3.35rem]">
              Find It. Build It.{" "}
              <span className="block font-extrabold text-[#d4efe4]">Make It Home.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              Your property and home-improvement platform for Kalaburagi — search live listings
              or plan construction, interiors and renovation with one local team.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:max-w-4xl">
            <Link
              href="/properties"
              className="group relative overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md transition hover:border-white/30 hover:bg-white/15 sm:p-6"
            >
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-500/20 blur-2xl" />
              <p className="text-xs font-semibold uppercase tracking-wider text-[#b8dcc9]">
                Property
              </p>
              <p className="mt-2 text-xl font-bold text-white sm:text-2xl">Find a home or plot</p>
              <p className="mt-2 text-sm text-white/75">
                Rent, buy, plots and commercial space across Kalaburagi.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white">
                Browse listings{" "}
                <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>

            <div className="relative overflow-hidden rounded-2xl border border-[#c4a574]/40 bg-gradient-to-br from-[#2a4a3e] to-[#1a3329] p-5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)] sm:p-6">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(196,165,116,0.12),transparent_55%)]" />
              <p className="relative text-xs font-semibold uppercase tracking-wider text-[#e8d5b5]">
                Build & renovate
              </p>
              <p className="relative mt-2 text-xl font-bold text-white sm:text-2xl">
                From plot to finished home
              </p>
              <p className="relative mt-2 text-sm text-white/75">
                Construction, kitchens, interiors and full-home upgrades.
              </p>
              <div className="relative mt-4 flex flex-wrap gap-2">
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

          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-md sm:p-5">
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
