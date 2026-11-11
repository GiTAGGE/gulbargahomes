import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { FormRetry } from "@/components/admin/form-retry";
import { Card, Empty, Pill } from "@/components/admin/ui";
import { requirePageAdmin } from "@/lib/admin/page";
import { formDesk, type FormDeskCounts } from "@/lib/crm/form-desk";

export const dynamic = "force-dynamic";

const COUNT_LABEL: { key: keyof FormDeskCounts; label: string }[] = [
  { key: "imported", label: "Imported" },
  { key: "held", label: "Held" },
  { key: "duplicates", label: "Duplicates" },
  { key: "excluded", label: "Excluded" },
  { key: "notFetched", label: "On Meta, not fetched" },
];

export default async function FormsPage() {
  const { db, caps } = await requirePageAdmin("crm.view");
  const sections = await formDesk(db, { canViewPhone: caps.viewPhone });

  return (
    <AdminShell
      eyebrow="Operations desk"
      title="Forms"
    >
      <p className="mb-5 max-w-3xl text-sm text-ink-muted">
        Each Meta form is its own list. Today stays the call queue across forms. This page does not import leads or change how a form is classified.
      </p>
      {sections.length === 0 ? (
        <Card>
          <Empty>No Meta forms have been synced yet.</Empty>
        </Card>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <Card
              key={section.form.formId}
              title={section.form.name || "Untitled form"}
              hint={section.form.formId}
              action={
                <div className="flex flex-wrap justify-end gap-1.5">
                  {section.paused && <Pill tone="amber">Paused</Pill>}
                  <Pill tone="stone">{section.classificationLabel}</Pill>
                </div>
              }
            >
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {COUNT_LABEL.map((item) => (
                  <div key={item.key}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{item.label}</dt>
                    <dd className="text-lg font-bold text-ink">{section.counts[item.key]}</dd>
                  </div>
                ))}
              </dl>
              {section.counts.toRetry > 0 && (
                <p className="mt-3 text-xs text-ink-muted">{section.counts.toRetry} failed on this form can be retried by selecting them.</p>
              )}
              {section.counts.notFetched > 0 && (
                <p className="mt-3 text-sm text-ink">
                  {section.counts.notFetched === 1
                    ? "1 lead is prepared and still on Meta. Nothing has been fetched, and this desk does not import it."
                    : `${section.counts.notFetched} leads are prepared and still on Meta. Nothing has been fetched, and this desk does not import them.`}
                </p>
              )}
              {section.counts.excluded > 0 && (
                <p className="mt-3 text-sm text-ink">
                  {section.counts.excluded} {section.counts.excluded === 1 ? "lead is" : "leads are"} excluded and {section.counts.excluded === 1 ? "has" : "have"} not been imported.
                </p>
              )}

              <RecordList
                title="Owner leads"
                empty="No owner leads from this form."
                rows={section.ownerLeads.map((lead) => ({
                  id: lead.id,
                  href: `/admin/owner-leads/${lead.id}`,
                  label: `${lead.code} · ${lead.contactName}`,
                  detail: `${lead.intent} · ${lead.status}`,
                }))}
              />
              <RecordList
                title="Requirements"
                empty="No requirements from this form."
                rows={section.requirements.map((item) => ({
                  id: item.id,
                  href: `/admin/requirements/${item.id}`,
                  label: `${item.code} · ${item.contactName}`,
                  detail: `${item.intent} · ${item.status}`,
                }))}
              />

              {section.held.length > 0 && (
                <div className="mt-4 border-t border-brand-50 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Held for review</p>
                  <p className="mt-1 text-xs text-ink-muted">These stay held. This desk does not retry them or choose Sale, Rent or Lease.</p>
                  <ul className="mt-2 divide-y divide-brand-50">
                    {section.held.map((row) => (
                      <li key={row.id} className="py-2">
                        <p className="text-sm font-semibold text-ink">
                          {row.preview.name || "Unknown name"}
                          {row.preview.phone ? <span className="ml-2 font-normal text-ink-muted">{row.preview.phone}</span> : null}
                        </p>
                        <p className="text-xs text-ink-muted">{row.lastError}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {caps.manageIntegrations && (
                <FormRetry
                  formId={section.form.formId}
                  rows={section.retryable.map((row) => ({
                    id: row.id,
                    leadgenId: row.leadgenId,
                    name: row.preview.name,
                    phone: row.preview.phone,
                    error: row.lastError,
                  }))}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function RecordList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { id: string; href: string; label: string; detail: string }[];
}) {
  return (
    <div className="mt-4 border-t border-brand-50 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-brand-50">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={row.href} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-brand-50/50">
                <span className="truncate text-sm font-semibold text-ink">{row.label}</span>
                <span className="shrink-0 text-xs text-ink-muted">{row.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
