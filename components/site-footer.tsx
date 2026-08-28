import Link from "next/link";

import { getLocationPages } from "@/lib/locations";
import { site } from "@/lib/site";

export function SiteFooter() {
  const locationPages = getLocationPages().slice(0, 8);

  return (
    <footer className="mt-16 border-t border-brand-100 bg-white sm:mt-20">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <span className="text-lg font-bold tracking-tight text-ink">
            Gulbarga<span className="text-brand-600">Homes</span>
          </span>
          <p className="mt-3 max-w-xs text-sm text-ink-muted">
            Curated rentals, plots and house sales across Gulbarga (Kalaburagi) — with photos, videos and the details that matter.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide text-ink-faint">
            Explore
          </h4>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/houses-for-rent-in-gulbarga" className="text-ink-muted hover:text-brand-600">Houses for Rent</Link></li>
            <li><Link href="/flats-for-rent-in-kalaburagi" className="text-ink-muted hover:text-brand-600">Flats for Rent</Link></li>
            <li><Link href="/plots-for-sale-in-gulbarga" className="text-ink-muted hover:text-brand-600">Plots for Sale</Link></li>
            <li><Link href="/houses-for-sale-in-kalaburagi" className="text-ink-muted hover:text-brand-600">Houses for Sale</Link></li>
            <li><Link href="/about" className="text-ink-muted hover:text-brand-600">About</Link></li>
            <li><Link href="/contact" className="text-ink-muted hover:text-brand-600">Contact</Link></li>
            <li><Link href="/favorites" className="text-ink-muted hover:text-brand-600">Saved Favorites</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide text-ink-faint">
            Popular Searches
          </h4>
          <ul className="mt-4 space-y-2 text-sm">
            {locationPages.map((page) => (
              <li key={page.slug}>
                <Link href={`/${page.slug}`} className="text-ink-muted hover:text-brand-600">
                  {page.heading}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide text-ink-faint">
            Contact
          </h4>
          <ul className="mt-4 space-y-2 text-sm text-ink-muted">
            <li>
              <a href={`tel:${site.phone}`} className="hover:text-brand-600">{site.phone}</a>
            </li>
            <li>
              <a href={`mailto:${site.email}`} className="hover:text-brand-600">{site.email}</a>
            </li>
            <li>Gulbarga (Kalaburagi), Karnataka, India</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-brand-100 py-5 text-center text-sm text-ink-faint">
        © {new Date().getFullYear()} {site.name}. Curated real estate for Gulbarga &amp; Kalaburagi.
      </div>
    </footer>
  );
}
