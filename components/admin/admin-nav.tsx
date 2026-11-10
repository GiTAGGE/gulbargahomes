"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string };

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:mt-6 md:flex-1 md:flex-col md:overflow-visible md:p-0">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm ${
              active ? "bg-white/15 font-semibold text-white" : "text-[#dceee4] hover:bg-white/10"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch("/api/admin/session", { method: "DELETE" });
        window.location.href = "/admin/login";
      }}
      className={`rounded-full border border-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60 ${
        compact ? "" : "w-full"
      }`}
    >
      {pending ? "Signing out…" : "Log out"}
    </button>
  );
}
