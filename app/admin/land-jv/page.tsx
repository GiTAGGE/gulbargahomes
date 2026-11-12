import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill } from "@/components/admin/ui";
import { relativeTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { landJvPlace, listLandJvEnquiries } from "@/lib/crm/land-jv";
import { maskPhone } from "@/lib/crm/phone";

export const dynamic = "force-dynamic";

export default async function LandJvPage() {
  const { db, caps } = await requirePageAdmin("crm.view");
  const enquiries = await listLandJvEnquiries(db);
  const now = new Date();

  return (
    <AdminShell eyebrow="Gulbarga and Kalaburagi" title="Land JV enquiries">
      <Card title="Agricultural land joint ventures">
        <p className="mb-3 text-sm text-ink-muted">
          These are land enquiries from Meta. They are not residential owner leads and they do not create inventory. Status stays New until someone reviews the enquiry.
        </p>
        {enquiries.length === 0 ? (
          <Empty>No land JV enquiries yet. Held agricultural leads stay in Integrations until someone chooses Record as Land JV.</Empty>
        ) : (
          <ul className="divide-y divide-brand-50">
            {enquiries.map((enquiry) => (
              <li key={enquiry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <Link href={`/admin/land-jv/${enquiry.id}`} className="font-semibold text-brand-800 hover:underline">
                    {enquiry.code} · {enquiry.contactName}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {landJvPlace(enquiry)}
                    {enquiry.acreBand ? ` · ${enquiry.acreBand}` : ""}
                    {" · "}
                    {caps.viewPhone ? enquiry.contactPhone : maskPhone(enquiry.contactPhone)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone="stone">{enquiry.status}</Pill>
                  <span className="text-xs text-ink-faint">{relativeTime(enquiry.createdAt, now)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
