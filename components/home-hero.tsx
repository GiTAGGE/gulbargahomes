import Image from "next/image";
import Link from "next/link";

import { getLocalities } from "@/lib/properties";
import { heroBlurDataUrl } from "@/lib/hero-blur";
import { site } from "@/lib/site";

import { SearchBar } from "@/components/search-bar";

export function HomeHero() {
  const localities = getLocalities();
  const popularLocalities = localities.slice(0, 5);
  return (
    <section className="relative isolate min-h-[88svh] overflow-hidden sm:min-h-[78vh]">
      <div className="absolute inset-0 -z-20">
        <Image
          src="/images/hero/hero-mobile.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="object-cover object-[center_30%] sm:hidden"
        />
        <Image
          src="/images/hero/hero-desktop.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          blurDataURL={heroBlurDataUrl}
          className="hidden object-cover object-center sm:block"
        />
      </div>

      <div className="absolute inset-0 -z-10 bg-brand-900/45 mix-blend-multiply" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-900/75 via-brand-800/55 to-brand-900/85" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-900/70 via-transparent to-brand-900/25" />
      <div className="absolute inset-0 -z-10 [background-image:radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.14),transparent_42%),radial-gradient(circle_at_85%_10%,rgba(255,255,255,0.08),transparent_35%)]" />

      <div className="mx-auto flex min-h-[88svh] max-w-7xl flex-col justify-center px-4 py-20 text-center text-white sm:min-h-[78vh] sm:px-6 sm:py-24">
        <span className="fade-up inline-block rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium backdrop-blur-md">
          Curated · Verified · Gulbarga &amp; Kalaburagi only
        </span>
        <h1 className="fade-up mx-auto mt-5 max-w-3xl text-[2rem] font-bold leading-[1.15] tracking-tight [animation-delay:80ms] sm:mt-6 sm:text-5xl lg:text-6xl">
          {site.tagline}
        </h1>
        <p className="fade-up mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/90 sm:text-lg [animation-delay:140ms]">
          Rent · Buy · Houses · Flats · Plots in Gulbarga (Kalaburagi) — with Vastu, parking, water supply and video tours.
        </p>
        <div className="fade-up mt-8 sm:mt-10 [animation-delay:200ms]">
          <SearchBar localities={localities} />
        </div>
        <div className="fade-up mt-6 flex flex-wrap justify-center gap-2 sm:mt-8 [animation-delay:260ms]">
          <span className="text-sm text-white/75">Popular:</span>
          {popularLocalities.map((locality) => (
            <Link
              key={locality}
              href={`/properties?locality=${encodeURIComponent(locality)}`}
              className="chip border border-white/15 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
            >
              {locality}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
