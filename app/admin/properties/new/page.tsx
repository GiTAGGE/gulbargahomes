import { AdminShell } from "@/components/admin/admin-shell";
import { PropertyEditor } from "@/components/admin/property-editor";
import { emptyProperty } from "@/lib/property-input";
import { getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage() {
  const localities = Array.from(new Set([...(await getLocalities()), ...site.localities])).sort();

  return (
    <AdminShell eyebrow="New listing" title="Add a property">
      <PropertyEditor initial={emptyProperty()} mode="create" localities={localities} />
    </AdminShell>
  );
}
