import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill, Tabs } from "@/components/admin/ui";
import { bandTone, formatInr, ownerIntentPhrase, ownerPriceLabel, relativeTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { LEAD_CHANNEL_LABEL, type LeadChannel } from "@/lib/crm/options";
import { listOwnerLeads } from "@/lib/crm/owner-leads";
import { formatPhone, maskPhone } from "@/lib/crm/phone";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Open" },
  { key: "New", label: "New" },
  { key: "Details pending", label: "Details pending" },
  { key: "Converted", label: "Converted" },
  { key: "closed", label: "Closed" },
  { key: "not_owner", label: "Not an owner" },
  { key: "all", label: "All" },
];

export default async function OwnerLeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const params = await searchParams;
  const active = TABS.some((tab) => tab.key === params.status) ? params.status! : "open";
  const leads = await listOwnerLeads(db, {
    status: active === "all" || active === "not_owner" ? undefined : active,
    roleReview: active === "all" ? "any" : active === "not_owner" ? "misclassified" : undefined,
    q: params.q,
    limit: 500,
  });
  const now = new Date();
  const query = params.q ? `&q=${encodeURIComponent(params.q)}` : "";

  return (
    <AdminShell
      eyebrow="Supply"
      title="Owner leads"
      action={
        caps.editCrm ? (
          <Link href="/admin/owner-leads/new" className="btn-primary">
            Add owner lead
          </Link>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs active={active} tabs={TABS.map((tab) => ({ ...tab, href: `/admin/owner-leads?status=${encodeURIComponent(tab.key)}${query}` }))} />
        <form className="flex gap-2" action="/admin/owner-leads">
          <input type="hidden" name="status" value={active} />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Name, number, code or area"
            className="w-full rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm lg:w-64"
          />
          <button className="btn-ghost">Search</button>
        </form>
      </div>
      <Card>
        {leads.length === 0 ? (
          <Empty>No owner leads here.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-brand-50">
            {leads.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/admin/owner-leads/${lead.id}`}
                  className="-mx-2 flex flex-col gap-1 rounded-xl px-2 py-3 hover:bg-brand-50/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink-faint">{lead.code}</span>
                      <span className="truncate font-semibold text-ink">{lead.contactName}</span>
                      <Pill tone={bandTone(lead.priority)}>{lead.priority}</Pill>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">
                      {ownerIntentPhrase(lead.intent)} · {lead.propertyType || "Type not known"} ·{" "}
                      {lead.locality || lead.locationText} · {ownerPriceLabel(lead.intent)} {formatInr(lead.expectedPrice)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted sm:justify-end">
                    <span>{caps.viewPhone ? formatPhone(lead.contactPhone) : maskPhone(lead.contactPhone)}</span>
                    <Pill tone={lead.status === "New" ? "amber" : lead.status === "Converted" ? "green" : "stone"}>{lead.status}</Pill>
                    {lead.roleReview === "misclassified" && <Pill tone="stone">Not an owner</Pill>}
                    <span>{LEAD_CHANNEL_LABEL[lead.channel as LeadChannel] ?? lead.channel}</span>
                    <span>
                      {lead.nextFollowupAt ? `Follow up ${relativeTime(lead.nextFollowupAt, now)}` : `Added ${relativeTime(lead.createdAt, now)}`}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
