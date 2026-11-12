import Link from "next/link";

import { getCurrentAdmin } from "@/lib/admin/identity";
import { can, ROLE_LABEL } from "@/lib/admin/permissions";

import { AdminNav, LogoutButton, type NavItem } from "./admin-nav";

export async function AdminShell({
  title,
  eyebrow,
  action,
  children,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const admin = await getCurrentAdmin();
  const items: NavItem[] = [
    { href: "/admin/today", label: "Today" },
    { href: "/admin/forms", label: "Forms" },
    { href: "/admin/campaigns", label: "Campaigns" },
    { href: "/admin/owner-leads", label: "Owner leads" },
    { href: "/admin/land-jv", label: "Land JV" },
    { href: "/admin/requirements", label: "Requirements" },
    { href: "/admin/properties", label: "Inventory" },
    { href: "/admin/contacts", label: "Contacts" },
    ...(admin && can(admin.role, "integrations.view") ? [{ href: "/admin/integrations", label: "Integrations" }] : []),
    ...(admin && can(admin.role, "users.manage") ? [{ href: "/admin/team", label: "Team" }] : []),
  ];

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="bg-[#0f2a24] text-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:justify-between md:px-5 md:py-6">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:p-0">
          <div>
            <Link href="/admin/today" className="text-lg font-bold tracking-tight">
              Gulbarga<span className="text-[#86c2a6]">Homes</span>
            </Link>
            <p className="mt-0.5 hidden text-xs text-[#b8dcc9] md:block">Operations desk</p>
          </div>
          <div className="md:hidden">
            <LogoutButton compact />
          </div>
        </div>
        <AdminNav items={items} />
        <div className="hidden md:block">
          {admin && (
            <div className="mb-3 rounded-xl bg-white/5 px-3 py-2">
              <p className="truncate text-sm font-semibold">{admin.name}</p>
              <p className="text-xs text-[#b8dcc9]">{ROLE_LABEL[admin.role]}</p>
            </div>
          )}
          <Link href="/" className="mb-2 block rounded-xl px-3 py-2 text-sm text-[#dceee4] hover:bg-white/10">
            View website
          </Link>
          <LogoutButton />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-brand-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>
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
