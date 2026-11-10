import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { PropertyTable } from "@/components/admin/property-table";
import { Stat, Tabs } from "@/components/admin/ui";
import { requirePageAdmin } from "@/lib/admin/page";
import { listInventory } from "@/lib/inventory/repository";
import { INVENTORY_TABS, toInventoryRow, type InventoryTab } from "@/lib/inventory/views";

export const dynamic = "force-dynamic";

export default async function AdminPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { db, caps } = await requirePageAdmin("property.view");
  const { tab: tabParam } = await searchParams;
  const now = new Date();
  const rows = (await listInventory(db, { includeDiscreet: caps.viewDiscreet })).map((property) =>
    toInventoryRow(property, now),
  );
  const tabs = INVENTORY_TABS.filter((tab) => tab.key !== "discreet" || caps.viewDiscreet);
  const active: InventoryTab = tabs.some((tab) => tab.key === tabParam) ? (tabParam as InventoryTab) : "live";
  const count = (key: InventoryTab) => rows.filter((row) => row.tabs.includes(key)).length;

  return (
    <AdminShell
      eyebrow="Inventory"
      title="Properties"
      action={
        caps.createProperty ? (
          <Link href="/admin/properties/new" className="btn-primary">
            Add property
          </Link>
        ) : undefined
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-3xl">
        <Stat label="On website" value={count("live")} href="/admin/properties?tab=live" />
        <Stat label="Matchable now" value={rows.filter((row) => row.matchMode).length} />
        <Stat label="Pipeline" value={count("pipeline")} href="/admin/properties?tab=pipeline" />
        <Stat
          label="Needs reconfirmation"
          value={count("reconfirm")}
          href="/admin/properties?tab=reconfirm"
          tone="alert"
        />
      </div>
      <div className="mb-4">
        <Tabs
          active={active}
          tabs={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            href: `/admin/properties?tab=${tab.key}`,
            count: count(tab.key),
          }))}
        />
      </div>
      <PropertyTable key={active} properties={rows.filter((row) => row.tabs.includes(active))} />
    </AdminShell>
  );
}
