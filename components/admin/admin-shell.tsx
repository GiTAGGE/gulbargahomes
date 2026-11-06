"use client";

import Link from "next/link";
import { useState } from "react";

export function AdminShell({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex items-center justify-between gap-4 bg-[#0f2a24] px-4 py-3 text-white md:w-60 md:flex-col md:items-stretch md:justify-between md:px-5 md:py-6">
        <div>
          <Link href="/admin/properties" className="text-lg font-bold tracking-tight">
            Gulbarga<span className="text-[#86c2a6]">Homes</span>
          </Link>
          <p className="mt-1 hidden text-xs text-[#b8dcc9] md:block">Listing desk</p>
          <nav className="mt-4 hidden flex-col gap-1 md:flex">
            <Link
              href="/admin/properties"
              className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold"
            >
              Properties
            </Link>
            <Link href="/" className="rounded-xl px-3 py-2 text-sm text-[#dceee4] hover:bg-white/10">
              View website
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 md:flex-col md:items-stretch">
          <Link href="/" className="text-sm text-[#dceee4] md:hidden">
            Website
          </Link>
          <LogoutButton />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-brand-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">
                {eyebrow}
              </p>
            )}
            <h1 className="truncate text-lg font-bold text-ink sm:text-xl">{title}</h1>
          </div>
          {action}
        </header>
        <div className="px-4 py-5 sm:px-6 sm:py-6">{children}</div>
      </div>
    </div>
  );
}

function LogoutButton() {
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
      className="rounded-full border border-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Log out"}
    </button>
  );
}
