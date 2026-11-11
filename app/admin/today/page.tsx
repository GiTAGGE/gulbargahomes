import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill, Stat } from "@/components/admin/ui";
import { bandTone, budgetLabel, formatDate, formatDateTime, ownerIntentPhrase, relativeTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import type { Followup } from "@/lib/crm/activity";
import { todayQueue } from "@/lib/crm/today";

export const dynamic = "force-dynamic";

function followupHref(item: Followup) {
  switch (item.entityType) {
    case "owner_lead":
      return `/admin/owner-leads/${item.entityId}`;
    case "requirement":
      return `/admin/requirements/${item.entityId}`;
    case "contact":
      return `/admin/contacts/${item.entityId}`;
    default:
      return "/admin/properties";
  }
}

export default async function TodayPage() {
  const { admin, db, caps } = await requirePageAdmin("crm.view");
  const now = new Date();
  const queue = await todayQueue(db, { includeDiscreet: caps.viewDiscreet }, now);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <AdminShell
      eyebrow={formatDate(now.toISOString())}
      title={admin.legacy ? greeting : `${greeting}, ${admin.name.split(" ")[0]}`}
    >
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Follow-ups due" value={queue.followups.length} />
        <Stat label="Overdue" value={queue.overdueCount} tone="alert" />
        <Stat label="New owner leads" value={queue.newOwnerLeads.length} href="/admin/owner-leads?status=New" />
        <Stat label="Urgent requirements" value={queue.urgentRequirements.length} href="/admin/requirements?status=urgent" />
        <Stat label="To verify" value={queue.pendingVerification.length} href="/admin/properties?tab=pipeline" />
        <Stat label="Reconfirm availability" value={queue.staleAvailability.length} href="/admin/properties?tab=reconfirm" tone="alert" />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card title="Follow-ups due today" hint="Overdue first. Times are India time.">
          {queue.followups.length === 0 ? (
            <Empty>Nothing due. Nice.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-brand-50">
              {queue.followups.map((item) => {
                const overdue = new Date(item.dueAt) < now;
                return (
                  <li key={item.id}>
                    <Link href={followupHref(item)} className="-mx-2 block rounded-xl px-2 py-2 hover:bg-brand-50/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{item.label ?? item.entityType}</span>
                        <span className={`shrink-0 text-xs ${overdue ? "font-semibold text-red-700" : "text-ink-muted"}`}>
                          {overdue ? relativeTime(item.dueAt, now) : formatDateTime(item.dueAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-ink-muted">{item.reason}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Urgent requirements" hint="Need a place within a week. Highest intent first.">
          {queue.urgentRequirements.length === 0 ? (
            <Empty>No urgent requirements.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-brand-50">
              {queue.urgentRequirements.slice(0, 15).map((item) => (
                <li key={item.id}>
                  <Link href={`/admin/requirements/${item.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-brand-50/50">
                    <Pill tone={bandTone(item.intentScore.band)}>{item.intentScore.score}</Pill>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {item.code} · {item.contactName}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {item.intent} · {item.propertyTypes.join(", ") || "Any"} · {budgetLabel(item.budgetMin, item.budgetMax, item.intent)} ·{" "}
                        {item.localities.join(", ") || "Any area"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{item.lastContactedAt ? item.status : "Not called"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="New owner leads" hint="Oldest first. Call them before they list elsewhere.">
          {queue.newOwnerLeads.length === 0 ? (
            <Empty>No new owner leads.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-brand-50">
              {queue.newOwnerLeads.slice(0, 15).map((lead) => (
                <li key={lead.id}>
                  <Link href={`/admin/owner-leads/${lead.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-brand-50/50">
                    <Pill tone={bandTone(lead.priority)}>{lead.priority}</Pill>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {lead.code} · {lead.contactName}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {ownerIntentPhrase(lead.intent)} · {lead.propertyType || "Type?"} · {lead.locality || lead.locationText}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{relativeTime(lead.createdAt, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="New requirements" hint="Not yet contacted, not urgent.">
          {queue.newRequirements.length === 0 ? (
            <Empty>All requirements have been contacted.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-brand-50">
              {queue.newRequirements.slice(0, 15).map((item) => (
                <li key={item.id}>
                  <Link href={`/admin/requirements/${item.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-brand-50/50">
                    <Pill tone={bandTone(item.intentScore.band)}>{item.intentScore.score}</Pill>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                      {item.code} · {item.contactName}
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{item.timeline}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Reconfirm with owner" hint="Out of matching until the owner confirms it is still available.">
          {queue.staleAvailability.length === 0 ? (
            <Empty>Every live property has a current check.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-brand-50">
              {queue.staleAvailability.slice(0, 20).map((property) => (
                <li key={property.id}>
                  <Link
                    href={`/admin/properties/${property.slug}/edit`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-brand-50/50"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">
                      {property.code} · {property.title}
                    </span>
                    <span className="shrink-0 text-xs text-amber-800">
                      {property.availabilityVerifiedAt ? `Checked ${formatDate(property.availabilityVerifiedAt)}` : "Never checked"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {queue.staleAvailability.length > 20 && (
            <Link href="/admin/properties?tab=reconfirm" className="mt-2 block text-sm font-semibold text-brand-800">
              See all {queue.staleAvailability.length}
            </Link>
          )}
        </Card>

        <Card title="Waiting for verification">
          {queue.pendingVerification.length === 0 ? (
            <Empty>Nothing waiting.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-brand-50">
              {queue.pendingVerification.map((property) => (
                <li key={property.id}>
                  <Link
                    href={`/admin/properties/${property.slug}/edit`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-brand-50/50"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">
                      {property.code} · {property.title}
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{property.locality}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
