import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill, Stat } from "@/components/admin/ui";
import { bandTone, formatDate, formatDateTime, ownerIntentPhrase, relativeTime, urgencyTone } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import type { Followup } from "@/lib/crm/activity";
import {
  DESK_LAYOUT,
  DESK_QUEUES,
  emptyDeskMessage,
  operationsDesk,
  type DeskPage,
} from "@/lib/crm/operations-desk";
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

function deskHref(queue: string, page = 1) {
  const params = new URLSearchParams();
  if (queue !== "all") params.set("queue", queue);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/today?${query}` : "/admin/today";
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ queue?: string; page?: string }> }) {
  const { admin, db, caps } = await requirePageAdmin("crm.view");
  const query = await searchParams;
  const now = new Date();
  const queue = await todayQueue(db, { includeDiscreet: caps.viewDiscreet }, now);
  let desk: DeskPage | null = null;
  let deskError = "";
  try {
    desk = await operationsDesk(
      db,
      { viewPhone: caps.viewPhone, viewDiscreet: caps.viewDiscreet, viewMatches: caps.viewMatches },
      { now, queue: query.queue, page: Number(query.page) || 1 },
    );
  } catch (error) {
    console.error("operations desk failed", error);
    deskError = "The operations desk could not be loaded. Follow-ups below are still available.";
  }
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
        <Stat label="Desk" value={desk?.counts.all ?? "—"} href="/admin/today" tone={desk && desk.counts.critical ? "alert" : undefined} />
        <Stat label="To verify" value={queue.pendingVerification.length} href="/admin/properties?tab=pipeline" />
        <Stat label="Reconfirm availability" value={queue.staleAvailability.length} href="/admin/properties?tab=reconfirm" tone="alert" />
      </div>

      <Card
        className="mb-5"
        title="Operations desk"
        hint="One row per requirement. The labels are why it is here. Urgency follows the confirmed timeline, not the intent score."
      >
        {deskError && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{deskError}</p>}
        {desk && (
          <>
            <div className={DESK_LAYOUT.filters}>
              {DESK_QUEUES.map((item) => {
                const active = desk.queue === item.id;
                return (
                  <Link
                    key={item.id}
                    href={deskHref(item.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      active ? "bg-brand-800 text-white" : "bg-brand-50 text-brand-900"
                    }`}
                  >
                    {item.label} {desk.counts[item.id]}
                  </Link>
                );
              })}
            </div>
            {desk.rows.length === 0 ? (
              <Empty>{emptyDeskMessage(desk.queue)}</Empty>
            ) : (
              <ol className="mt-4 divide-y divide-brand-50">
                {desk.rows.map((item) => (
                  <li key={item.id} className={`${DESK_LAYOUT.row} py-3`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/admin/requirements/${item.id}`} className="text-sm font-semibold text-ink hover:underline">
                          {item.contactName}
                        </Link>
                        <p className="break-all text-xs text-ink-faint">{item.contactPhone}</p>
                      </div>
                      <div className="flex max-w-full flex-wrap gap-1">
                        <Pill tone={urgencyTone(item.urgency)}>{item.urgency}</Pill>
                        {item.overdue && <Pill tone="red">Overdue</Pill>}
                        {item.reasonLabels.map((label) => (
                          <Pill key={label}>{label}</Pill>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-ink">{item.nextAction}</p>
                    <p className="mt-1 text-sm text-ink">
                      {item.code} · {item.intent} · {item.propertyTypes.join(", ") || "Any type"} ·{" "}
                      {item.localities.join(", ") || "Any locality"}
                    </p>
                    <p className="text-sm text-ink">{item.budget}</p>
                    <p className="text-xs text-ink-muted">
                      Original timeline {item.originalTimeline}. Confirmed timeline {item.confirmedTimeline}.
                    </p>
                    <p className="text-xs text-ink-muted">
                      Last meaningful contact: {item.lastMeaningfulAt ? formatDateTime(item.lastMeaningfulAt) : "None yet"}.
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {desk.pages > 1 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                {desk.page > 1 ? (
                  <Link href={deskHref(desk.queue, desk.page - 1)} className="font-semibold text-brand-800">
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-ink-muted">
                  Page {desk.page} of {desk.pages}
                </span>
                {desk.page < desk.pages ? (
                  <Link href={deskHref(desk.queue, desk.page + 1)} className="font-semibold text-brand-800">
                    Next
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}
      </Card>

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
                      {item.formName ? <p className="truncate text-[11px] font-medium text-brand-800">{item.formName}</p> : null}
                    </Link>
                  </li>
                );
              })}
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
                        {lead.formName ? `${lead.formName} · ` : ""}
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
