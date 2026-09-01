"use client";

import Link from "next/link";
import { useState } from "react";

import { site } from "@/lib/site";
import { trackPhoneClick } from "@/lib/analytics/track";

import { CloseIcon, MenuIcon, PhoneIcon } from "./icons";
import { SiteSearch } from "./site-search";

const navLinks = [
  { href: "/properties?listing=Rent", label: "Rent" },
  { href: "/properties?listing=Sale", label: "Buy" },
  { href: "/plots-for-sale-in-gulbarga", label: "Plots" },
  { href: "/houses-for-sale-in-kalaburagi", label: "Houses" },
  { href: "/about", label: "About" },
  { href: "/favorites", label: "Saved" },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-700 text-base font-bold text-white sm:h-9 sm:w-9 sm:text-lg">
              G
            </span>
            <span className="text-base font-bold tracking-tight text-ink sm:text-lg">
              Gulbarga<span className="text-brand-600">Homes</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted hover:bg-brand-50 hover:text-ink transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <SiteSearch />
            </div>
            <a
              href={`tel:${site.phone}`}
              className="btn-primary hidden sm:inline-flex text-sm py-2.5"
              onClick={() => trackPhoneClick("header")}
            >
              <PhoneIcon className="h-4 w-4" /> Call Us
            </a>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid h-11 w-11 place-items-center rounded-full border border-brand-200 text-ink md:hidden touch-manipulation"
              aria-label="Open menu"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 sheet animate-slide-up pb-safe">
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
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3.5 text-base font-medium text-ink hover:bg-brand-50 transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-2 border-t border-brand-100 pt-3 px-1">
                <SiteSearch />
              </div>
              <a
                href={`tel:${site.phone}`}
                className="btn-primary mt-3 justify-center"
                onClick={() => trackPhoneClick("mobile_menu")}
              >
                <PhoneIcon className="h-5 w-5" /> Call Us
              </a>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
