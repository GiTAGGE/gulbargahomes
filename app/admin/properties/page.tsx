import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { PropertyTable } from "@/components/admin/property-table";
import { getAllProperties } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function AdminPropertiesPage() {
  const properties = await getAllProperties();
  const available = properties.filter((property) => property.status === "Available").length;

  return (
    <AdminShell
      eyebrow="Properties"
      title="All listings"
      action={
        <Link href="/admin/properties/new" className="btn-primary">
          Add property
        </Link>
      }
    >
      <div className="mb-5 grid grid-cols-3 gap-2 sm:max-w-lg">
        <Stat label="Total" value={properties.length} />
        <Stat label="Available" value={available} />
        <Stat label="Taken" value={properties.length - available} />
      </div>
      <PropertyTable properties={properties} />
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-white px-3 py-3">
      <p className="text-xl font-bold text-ink">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
