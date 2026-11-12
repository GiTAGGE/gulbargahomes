import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Pill } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { getLandJvEnquiry } from "@/lib/crm/land-jv";
import { maskPhone } from "@/lib/crm/phone";

export const dynamic = "force-dynamic";

const FIELDS: { label: string; key: "taluk" | "village" | "acreBand" | "ownership" | "rtcAvailable" | "roadAccess" | "ownersAgree" }[] = [
  { label: "Taluk", key: "taluk" },
  { label: "Village", key: "village" },
  { label: "Acres", key: "acreBand" },
  { label: "Ownership", key: "ownership" },
  { label: "RTC / Pahani", key: "rtcAvailable" },
  { label: "Road access", key: "roadAccess" },
  { label: "Owners agree", key: "ownersAgree" },
];

export default async function LandJvDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const { id } = await params;
  const enquiry = await getLandJvEnquiry(db, id);
  if (!enquiry) notFound();
  const phone = caps.viewPhone ? enquiry.contactPhone : maskPhone(enquiry.contactPhone);

  return (
    <AdminShell eyebrow={`${enquiry.code} · Land JV`} title={enquiry.contactName}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/admin/land-jv" className="btn-ghost">
          All land JV
        </Link>
        <Link href={`/admin/contacts/${enquiry.contactId}`} className="btn-ghost">
          {enquiry.contactCode}
        </Link>
        <Pill tone="stone">{enquiry.status}</Pill>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Enquiry">
          <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-y-2 text-sm">
            <dt className="text-ink-faint">Phone</dt>
            <dd>{phone}</dd>
            {FIELDS.map((field) => (
              <div key={field.key} className="contents">
                <dt className="text-ink-faint">{field.label}</dt>
                <dd>{enquiry[field.key] || "Not answered"}</dd>
              </div>
            ))}
            <dt className="text-ink-faint">Received</dt>
            <dd>{formatDateTime(enquiry.submittedAt)}</dd>
          </dl>
          <p className="mt-3 text-xs text-ink-muted">This enquiry does not create a residential property. It is not marked Qualified.</p>
        </Card>
        <Card title="Meta source">
          <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-y-2 text-sm">
            <dt className="text-ink-faint">Campaign</dt>
            <dd>{enquiry.campaignName || enquiry.campaignId || "Not on the lead"}</dd>
            <dt className="text-ink-faint">Form</dt>
            <dd>{enquiry.formName || enquiry.formId}</dd>
            <dt className="text-ink-faint">Lead id</dt>
            <dd className="font-mono text-xs">{enquiry.metaLeadId}</dd>
          </dl>
        </Card>
        <Card title="Original answers">
          <ul className="space-y-2 text-sm">
            {enquiry.answers.map((answer) => (
              <li key={answer.key}>
                <span className="text-ink-faint">{answer.label || answer.key}</span>
                <span className="mt-0.5 block text-ink">{answer.value || "Blank"}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}
