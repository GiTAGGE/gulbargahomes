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
    <section className="bg-[#0f2a24]">
      <div className="mx-auto grid max-w-7xl lg:grid-cols-12 lg:min-h-[min(720px,calc(100svh-4rem))]">
        {/* Copy lives on solid brand panel — always readable */}
        <div className="flex flex-col justify-center px-4 py-10 sm:px-6 lg:col-span-5 lg:py-14 xl:col-span-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#b8dcc9]">
            Gulbarga · Kalaburagi
          </p>
          <h1 className="mt-4 text-[2rem] font-bold leading-[1.08] tracking-tight text-white sm:text-[2.75rem] lg:text-[3rem]">
            Find It. Build It.
            <span className="mt-1 block text-[#d4efe4]">Make It Home.</span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/85">
            Your property and home-improvement platform for Kalaburagi — search listings or plan
            construction, interiors and renovation with one local team.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link
              href="/properties"
              className="group rounded-2xl border border-white/15 bg-white/10 p-4 transition hover:border-white/25 hover:bg-white/15"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#b8dcc9]">
                Property
              </p>
              <p className="mt-2 text-lg font-bold text-white">Find a home or plot</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-white/90">
                Browse listings{" "}
                <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
            <Link
              href="/#build-renovate"
              className="group rounded-2xl border border-[#c4a574]/45 bg-[#1a3329] p-4 transition hover:border-[#c4a574]/70"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e8d5b5]">
                Build & renovate
              </p>
              <p className="mt-2 text-lg font-bold text-white">Plot to finished home</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#d4efe4]">
                Explore services{" "}
                <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {quickLinks.map(({ label, href, Icon }) => (
              <Link
                key={label}
                href={href}
                className="inline-flex items-center gap-2 rounded-full bg-[#1a3329] px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-[#234539] sm:text-sm"
              >
                <Icon className="h-4 w-4 text-[#b8dcc9]" />
                {label}
              </Link>
            ))}
          </div>

          <a
            href={buildWa}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white hover:bg-[#1fb855]"
          >
            <WhatsAppIcon className="h-4 w-4" /> Discuss your project
          </a>
        </div>

        {/* Photography column — no headline overlay */}
        <div className="relative min-h-[240px] sm:min-h-[320px] lg:col-span-7 lg:min-h-0 xl:col-span-7">
          <Image
            src="/images/hero/scene-desktop.webp"
            alt="Residential streets and homes in Gulbarga (Kalaburagi)."
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 58vw"
            placeholder="blur"
            blurDataURL={heroBlurDataUrl}
            className="hidden object-cover object-center lg:block"
          />
          <Image
            src="/images/hero/scene-mobile.webp"
            alt="Residential streets and homes in Gulbarga (Kalaburagi)."
            fill
            priority
            sizes="100vw"
            placeholder="blur"
            blurDataURL={heroBlurDataUrl}
            className="object-cover object-center lg:hidden"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f2a24] via-transparent to-transparent lg:bg-gradient-to-l lg:from-[#0f2a24] lg:via-[#0f2a24]/40 lg:to-transparent" />
        </div>
      </div>

      <div className="border-t border-white/10 bg-[#0c241f]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#b8dcc9]/80">
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
    </section>
  );
}
