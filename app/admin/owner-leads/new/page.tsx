import { AdminShell } from "@/components/admin/admin-shell";
import { OwnerLeadForm } from "@/components/admin/owner-lead-form";
import { requirePageAdmin } from "@/lib/admin/page";
import { getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function NewOwnerLeadPage() {
  await requirePageAdmin("crm.edit");
  const localities = Array.from(new Set([...(await getLocalities()), ...site.localities])).sort();
  return (
    <AdminShell eyebrow="Supply" title="Add an owner lead">
      <OwnerLeadForm localities={localities} />
    </AdminShell>
  );
}
