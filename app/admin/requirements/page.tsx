import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill, Tabs } from "@/components/admin/ui";
import { bandTone, budgetLabel, relativeTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { listRequirements } from "@/lib/crm/requirements";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Open" },
  { key: "urgent", label: "Urgent" },
  { key: "New", label: "New" },
  { key: "Qualified", label: "Qualified" },
  { key: "Visit scheduled", label: "Visits" },
  { key: "Negotiation", label: "Negotiation" },
  { key: "Postponed", label: "Postponed" },
  { key: "closed", label: "Closed" },
];

export default async function RequirementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; intent?: string }>;
}) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const params = await searchParams;
  const active = TABS.some((tab) => tab.key === params.status) ? params.status! : "open";
  const now = new Date();
  let requirements = await listRequirements(
    db,
    { status: active === "urgent" ? "open" : active, q: params.q, intent: params.intent, limit: 500 },
    now,
  );
  if (active === "urgent") {
    requirements = requirements.filter(
      (item) => (item.timeline === "Immediate" || item.timeline === "Within 7 days") && item.status !== "Postponed",
    );
  }
  const query = params.q ? `&q=${encodeURIComponent(params.q)}` : "";

  return (
    <AdminShell
      eyebrow="Demand"
      title="Tenant and buyer requirements"
      action={
        caps.editCrm ? (
          <Link href="/admin/requirements/new" className="btn-primary">
            Add requirement
          </Link>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs active={active} tabs={TABS.map((tab) => ({ ...tab, href: `/admin/requirements?status=${encodeURIComponent(tab.key)}${query}` }))} />
        <form className="flex gap-2" action="/admin/requirements">
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
      <p className="mb-3 text-xs text-ink-muted">
        Sorted by intent: how ready the person is to rent or buy (urgency, budget, detail, engagement). Inventory fit is
        scored separately once matching is switched on.
      </p>
      <Card>
        {requirements.length === 0 ? (
          <Empty>No requirements here.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-brand-50">
            {requirements.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/admin/requirements/${item.id}`}
                  className="-mx-2 flex flex-col gap-1 rounded-xl px-2 py-3 hover:bg-brand-50/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="w-12 shrink-0 text-center">
                    <p className="text-lg font-bold text-ink">{item.intentScore.score}</p>
                    <Pill tone={bandTone(item.intentScore.band)}>{item.intentScore.band}</Pill>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink-faint">{item.code}</span>
                      <span className="truncate font-semibold text-ink">{item.contactName}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">
                      {item.intent === "Rent" ? "Rent" : "Buy"} · {item.propertyTypes.join(", ") || "Any type"}
                      {item.bhkMin ? ` · ${item.bhkMin}${item.bhkMax && item.bhkMax !== item.bhkMin ? `–${item.bhkMax}` : ""} BHK` : ""} ·{" "}
                      {budgetLabel(item.budgetMin, item.budgetMax, item.intent)} · {item.localities.join(", ") || "Any area"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted sm:justify-end">
                    <Pill tone={item.status === "New" ? "amber" : "stone"}>{item.status}</Pill>
                    <span>{item.timeline}</span>
                    <span>
                      {item.nextFollowupAt ? `Follow up ${relativeTime(item.nextFollowupAt, now)}` : `Added ${relativeTime(item.createdAt, now)}`}
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
