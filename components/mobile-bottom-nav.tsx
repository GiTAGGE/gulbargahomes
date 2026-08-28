"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { site } from "@/lib/site";
import { trackPhoneClick } from "@/lib/analytics/track";

import { HeartIcon, HomeIcon, PhoneIcon, SearchIcon } from "./icons";
import { SiteSearch } from "./site-search";

const tabs = [
  { href: "/", label: "Home", icon: HomeIcon, match: (path: string) => path === "/" },
  {
    href: "/properties",
    label: "Browse",
    icon: SearchIcon,
    match: (path: string) => path.startsWith("/properties") || path.match(/^\/[a-z-]+$/),
  },
  {
    href: "/favorites",
    label: "Saved",
    icon: HeartIcon,
    match: (path: string) => path === "/favorites",
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-100 bg-white/95 backdrop-blur-xl pb-safe md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-4 items-stretch">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                active ? "text-brand-700" : "text-ink-faint"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-brand-600" : ""}`} />
              {tab.label}
            </Link>
          );
        })}
        <a
          href={`tel:${site.phone}`}
          className="flex flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium text-ink-faint"
          onClick={() => trackPhoneClick("mobile_nav")}
        >
          <PhoneIcon className="h-5 w-5" />
          Call Us
        </a>
      </div>
      <SiteSearch variant="hidden-trigger" />
    </nav>
  );
}
