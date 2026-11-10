import { AdminShell } from "@/components/admin/admin-shell";
import { RequirementForm } from "@/components/admin/requirement-form";
import { requirePageAdmin } from "@/lib/admin/page";
import { getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function NewRequirementPage() {
  await requirePageAdmin("crm.edit");
  const localities = Array.from(new Set([...(await getLocalities()), ...site.localities])).sort();
  return (
    <AdminShell eyebrow="Demand" title="Add a requirement">
      <RequirementForm localities={localities} />
    </AdminShell>
  );
}
