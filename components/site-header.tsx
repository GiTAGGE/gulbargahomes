"use client";

import Link from "next/link";
import { useState } from "react";

import { site } from "@/lib/site";
import { trackPhoneClick } from "@/lib/analytics/track";

import { CloseIcon, MenuIcon, PhoneIcon } from "./icons";
import { SiteSearch } from "./site-search";

const propertyLinks = [
  { href: "/properties?listing=Rent", label: "Rent" },
  { href: "/properties?listing=Sale", label: "Buy" },
  { href: "/plots-for-sale-in-gulbarga", label: "Plots" },
  { href: "/houses-for-sale-in-kalaburagi", label: "Houses" },
];

const buildLinks = [
  { href: "/house-construction", label: "House construction" },
  { href: "/interior-design", label: "Interior design" },
  { href: "/modular-kitchens", label: "Modular kitchens" },
  { href: "/home-renovation", label: "Home renovation" },
];

const projectLinks = [
  { href: "/projects", label: "Projects" },
  { href: "/projects/completed", label: "Completed" },
  { href: "/projects/ongoing", label: "Ongoing" },
];

const otherLinks = [
  { href: "/about", label: "About" },
  { href: "/favorites", label: "Saved" },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);

  return (
    <>
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-700 text-base font-bold text-white sm:h-9 sm:w-9 sm:text-lg">
              G
            </span>
            <span className="truncate text-base font-bold tracking-tight text-ink sm:text-lg">
              Gulbarga<span className="text-brand-600">Homes</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex">
            {propertyLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-muted hover:bg-brand-50 hover:text-ink transition-colors"
              >
                {link.label}
              </Link>
            ))}

            <div
              className="relative"
              onMouseEnter={() => setBuildOpen(true)}
              onMouseLeave={() => setBuildOpen(false)}
            >
              <button
                type="button"
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-muted hover:bg-brand-50 hover:text-ink"
                aria-expanded={buildOpen}
              >
                Build ▾
              </button>
              {buildOpen && (
                <div className="absolute left-0 top-full z-50 w-56 rounded-2xl border border-brand-100 bg-white p-2 shadow-lift">
                  {buildLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="block rounded-xl px-3 py-2.5 text-sm font-medium text-ink hover:bg-brand-50"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <Link
                    href="/projects/completed"
                    className="mt-1 block rounded-xl border-t border-brand-100 px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    View projects
                  </Link>
                </div>
              )}
            </div>

            {projectLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-muted hover:bg-brand-50 hover:text-ink transition-colors"
              >
                {link.label}
              </Link>
            ))}

            {otherLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-muted hover:bg-brand-50 hover:text-ink transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden sm:block">
              <SiteSearch />
            </div>
            <div className="hidden items-center gap-1.5 xl:flex">
              {site.contacts.map((contact) => (
                <a
                  key={contact.phone}
                  href={`tel:${contact.phone}`}
                  className="btn-primary text-xs py-2 px-3"
                  onClick={() => trackPhoneClick("header")}
                >
                  <PhoneIcon className="h-4 w-4" /> {contact.phoneDisplay}
                </a>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid h-11 w-11 place-items-center rounded-full border border-brand-200 text-ink lg:hidden touch-manipulation"
              aria-label="Open menu"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto sheet animate-slide-up pb-safe">
            <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4">
              <span className="font-bold text-ink">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-full p-2 hover:bg-brand-50"
                aria-label="Close menu"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col p-3">
              <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Properties
              </p>
              {propertyLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-ink hover:bg-brand-50"
                >
                  {link.label}
                </Link>
              ))}
              <p className="mt-3 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Build & projects
              </p>
              {buildLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-ink hover:bg-brand-50"
                >
                  {link.label}
                </Link>
              ))}
              {projectLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-ink hover:bg-brand-50"
                >
                  Projects · {link.label}
                </Link>
              ))}
              {otherLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-ink hover:bg-brand-50"
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-2 border-t border-brand-100 pt-3 px-1">
                <SiteSearch />
              </div>
              {site.contacts.map((contact) => (
                <a
                  key={contact.phone}
                  href={`tel:${contact.phone}`}
                  className="btn-primary mt-3 justify-center"
                  onClick={() => trackPhoneClick("mobile_menu")}
                >
                  <PhoneIcon className="h-5 w-5" /> Call {contact.phoneDisplay}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
