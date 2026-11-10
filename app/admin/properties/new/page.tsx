import { AdminShell } from "@/components/admin/admin-shell";
import { PropertyEditor } from "@/components/admin/property-editor";
import { requirePageAdmin } from "@/lib/admin/page";
import { emptyProperty } from "@/lib/property-input";
import { getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage() {
  const { caps } = await requirePageAdmin("property.create");
  const localities = Array.from(new Set([...(await getLocalities()), ...site.localities])).sort();

  return (
    <AdminShell eyebrow="New property" title="Add a property">
      <p className="mb-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
        New properties start as an internal draft. They reach the website only after verification and publishing.
      </p>
      <PropertyEditor
        initial={emptyProperty()}
        mode="create"
        localities={localities}
        permissions={{ editPrice: true, archive: false, changeAvailability: caps.changeAvailability }}
      />
    </AdminShell>
  );
}
