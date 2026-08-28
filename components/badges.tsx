import type { Property } from "@/lib/types";
import { propertyHasVideo } from "@/lib/types";
import { isUnavailableStatus, statusLabel } from "@/lib/property-status";

const STYLES: Record<string, string> = {
  Featured: "bg-brand-600/90 text-white",
  New: "bg-emerald-600/90 text-white",
  Video: "bg-ink/80 text-white",
  Vastu: "bg-violet-500/90 text-white",
  Bachelor: "bg-sky-600/90 text-white",
  Veg: "bg-green-600/90 text-white",
  Rented: "bg-ink/75 text-white",
  Sold: "bg-rose-700/90 text-white",
};

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
        STYLES[kind] ?? "bg-ink/80 text-white"
      }`}
    >
      {children}
    </span>
  );
}

export function PropertyBadges({ property }: { property: Property }) {
  const statusKind =
    property.status === "Rented"
      ? "Rented"
      : property.status === "Sold"
        ? "Sold"
        : null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {statusKind && <Pill kind={statusKind}>{statusLabel(property.status)}</Pill>}
      {property.featured && <Pill kind="Featured">Featured</Pill>}
      {property.isNew && <Pill kind="New">New Listing</Pill>}
      {propertyHasVideo(property) && <Pill kind="Video">Video</Pill>}
      {property.vastu && <Pill kind="Vastu">Vastu</Pill>}
      {property.bachelors === "Allowed" && (
        <Pill kind="Bachelor">Bachelor Friendly</Pill>
      )}
      {property.vegetarian === "Yes" && <Pill kind="Veg">Vegetarian</Pill>}
    </div>
  );
}
