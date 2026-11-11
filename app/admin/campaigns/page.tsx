import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card, Empty, Pill, Stat } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { campaignQuality, parseQualityQuery, type QualityGroup, type QualityQuery } from "@/lib/crm/quality";

export const dynamic = "force-dynamic";

const INTENTS: { value: string; label: string }[] = [
  { value: "all", label: "All intents" },
  { value: "owner", label: "Owner leads" },
  { value: "buyer", label: "Buyers" },
  { value: "tenant", label: "Tenants" },
  { value: "genuine", label: "Genuine only" },
  { value: "misclassified", label: "Not an owner" },
  { value: "unqualified", label: "Not genuine" },
  { value: "pending", label: "Pending review" },
  { value: "both", label: "Buyer and tenant" },
];

function token(id: string): string {
  return id === "" ? "unattributed" : id;
}

function href(current: URLSearchParams, updates: Record<string, string | undefined>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (!value) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/admin/campaigns?${query}` : "/admin/campaigns";
}

function levelLabel(level: QualityGroup["level"]): string {
  if (level === "adset") return "Ad set";
  if (level === "ad") return "Ad";
  return "Campaign";
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const params = await searchParams;
  const query = parseQualityQuery(params);
  const report = await campaignQuality(db, query, { includePhone: caps.viewPhone });
  const current = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) current.set(key, value);
  }
  const sortLink = (sort: QualityQuery["sort"]) => href(current, { sort });

  return (
    <AdminShell eyebrow="Gulbarga (Kalaburagi)" title="Campaign quality">
      <p className="mb-4 max-w-3xl text-sm text-ink-muted">
        Which Meta campaigns produce genuine owners, buyers and tenants. A form submission stays pending until someone
        confirms it. Spend is shown only when it has been imported.
      </p>

      <form action="/admin/campaigns" className="mb-4 grid gap-3 rounded-2xl border border-brand-100 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-semibold text-ink">
          From
          <input type="date" name="from" defaultValue={query.from ?? ""} className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-ink">
          To
          <input type="date" name="to" defaultValue={query.to ?? ""} className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-ink">
          Campaign
          <select name="campaign" defaultValue={query.campaignId === null ? "" : token(query.campaignId)} className="mt-1 w-full rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm">
            <option value="">All campaigns</option>
            {report.campaigns.map((campaign) => (
              <option key={campaign.id || "unattributed"} value={token(campaign.id)}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink">
          Form
          <select name="form" defaultValue={query.formId ?? ""} className="mt-1 w-full rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm">
            <option value="">All forms</option>
            {report.forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink">
          Intent
          <select name="intent" defaultValue={query.intent} className="mt-1 w-full rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm">
            {INTENTS.map((intent) => (
              <option key={intent.value} value={intent.value}>
                {intent.label}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="sort" value={query.sort} />
        <div className="flex items-end gap-2">
          <button className="btn-primary">Apply</button>
          <Link href="/admin/campaigns" className="btn-ghost">
            Clear
          </Link>
        </div>
      </form>

      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        <Stat label="Meta submissions" value={report.summary.submissions} />
        <Stat label="Genuine owners" value={report.summary.genuineOwners} />
        <Stat label="Genuine buyers" value={report.summary.genuineBuyers} />
        <Stat label="Genuine tenants" value={report.summary.genuineTenants} />
        <Stat label="Not an owner" value={report.summary.misclassified} />
        <Stat label="Not genuine" value={report.summary.unqualified} />
        <Stat label="Pending review" value={report.summary.pending} />
        <Stat label="Buyer and tenant" value={report.summary.buyerAndTenant} />
      </div>
      <p className="mb-4 text-xs text-ink-muted">
        Meta submissions are every original form delivery in the selected dates, campaign and form. An intent filter does
        not change this count, and a delivery with no CRM record is still included.
      </p>

      <Card
        className="mb-4"
        title={report.summary.qualityLabel}
        hint={`${report.summary.uniqueContacts} unique contacts · ${report.summary.genuineOpportunities} genuine opportunities · ${report.summary.ownerAndSeeker} people who are a genuine owner and a genuine seeker`}
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Spend</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">{report.summary.spendLabel}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Cost per lead</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">{report.summary.costPerLead}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Cost per genuine owner</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">{report.summary.costPerOwner}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Cost per genuine buyer</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">{report.summary.costPerBuyer}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Cost per genuine tenant</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">{report.summary.costPerTenant}</dd>
          </div>
        </dl>
        {!report.costComparable && (
          <p className="mt-3 text-xs text-ink-muted">
            Spend and cost are N/A while a form or intent filter is on. Imported spend covers the whole campaign, ad set or ad.
          </p>
        )}
        {report.costComparable && report.summary.spendLabel === "Incomplete" && (
          <p className="mt-3 text-xs text-ink-muted">
            Spend is incomplete. A partial ad set or ad import is not shown as the campaign, ad set or overall total.
          </p>
        )}
      </Card>

      {(query.campaignId !== null || query.adsetId !== null || query.adId !== null) && (
        <nav className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Drill down">
          <Link href={href(current, { campaign: undefined, adset: undefined, ad: undefined })} className="font-semibold text-brand-800 hover:underline">
            All campaigns
          </Link>
          {query.campaignId !== null && (
            <>
              <span className="text-ink-faint">/</span>
              <Link href={href(current, { adset: undefined, ad: undefined })} className="font-semibold text-brand-800 hover:underline">
                {report.breadcrumb.campaign}
              </Link>
            </>
          )}
          {query.adsetId !== null && (
            <>
              <span className="text-ink-faint">/</span>
              <Link href={href(current, { ad: undefined })} className="font-semibold text-brand-800 hover:underline">
                {report.breadcrumb.adset}
              </Link>
            </>
          )}
          {query.adId !== null && (
            <>
              <span className="text-ink-faint">/</span>
              <span className="font-semibold text-ink">{report.breadcrumb.ad}</span>
            </>
          )}
        </nav>
      )}

      {report.groupLevel && (
        <Card className="mb-4" title={report.groupLevel === "campaign" ? "Campaigns" : report.groupLevel === "adset" ? "Ad sets" : "Ads"}>
          {report.groups.length === 0 ? (
            <Empty>No Meta leads in this view.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">{levelLabel(report.groupLevel)}</th>
                    <th className="py-2 pr-3 font-semibold">Submissions</th>
                    <th className="py-2 pr-3 font-semibold">
                      <Link href={sortLink("opportunities")} className="hover:text-brand-800">
                        Genuine opportunities
                      </Link>
                    </th>
                    <th className="py-2 pr-3 font-semibold">
                      <Link href={sortLink("quality")} className="hover:text-brand-800">
                        Quality
                      </Link>
                    </th>
                    <th className="py-2 pr-3 font-semibold">Spend</th>
                    <th className="py-2 font-semibold">
                      <Link href={sortLink("cost")} className="hover:text-brand-800">
                        Cost per genuine opportunity
                      </Link>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {report.groups.map((group) => {
                    const drill =
                      report.groupLevel === "campaign"
                        ? href(current, { campaign: token(group.id), adset: undefined, ad: undefined })
                        : report.groupLevel === "adset"
                          ? href(current, { adset: token(group.id), ad: undefined })
                          : href(current, { ad: token(group.id) });
                    return (
                      <tr key={`${group.level}:${group.id}`}>
                        <td className="py-3 pr-3">
                          <Link href={drill} className="font-semibold text-brand-800 hover:underline">
                            {group.name}
                          </Link>
                          {group.id && <p className="font-mono text-[11px] text-ink-faint">{group.id}</p>}
                          <p className="text-xs text-ink-muted">{group.uniqueContacts} contacts</p>
                        </td>
                        <td className="py-3 pr-3">{group.submissions}</td>
                        <td className="py-3 pr-3">{group.genuineOpportunities}</td>
                        <td className="py-3 pr-3 text-xs text-ink">{group.qualityLabel}</td>
                        <td className="py-3 pr-3">{group.spendLabel}</td>
                        <td className="py-3">{group.costLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {report.records.length > 0 && (
        <Card className="mb-4" title="CRM records" hint={report.truncated ? "Showing the latest 200." : "The leads and requirements behind this view."}>
          <ul className="-my-2 divide-y divide-brand-50">
            {report.records.map((record) => (
              <li key={record.id}>
                <Link href={record.href} className="-mx-2 flex flex-col gap-1 rounded-xl px-2 py-3 hover:bg-brand-50/50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">
                      <span className="mr-2 font-mono text-xs text-ink-faint">{record.code}</span>
                      {record.name}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {record.kind === "owner" ? "Owner lead" : record.kind === "buyer" ? "Buyer" : "Tenant"} · {record.campaignName}
                      {record.formName ? ` · ${record.formName}` : ""} · {formatDateTime(record.submittedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>{record.phone}</span>
                    <Pill tone={record.review === "genuine" ? "green" : record.review === "" ? "amber" : "stone"}>{record.reviewLabel}</Pill>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="How these numbers are counted">
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-ink-muted">
          <li>A genuine owner is an owner lead a person confirmed. A blank review is pending, never genuine.</li>
          <li>Not an owner is the existing misclassified mark. The Meta submission is kept.</li>
          <li>A genuine buyer or tenant is a requirement a person confirmed. Buy and rent stay separate.</li>
          <li>Not a genuine enquiry is an explicit mark. It is not guessed from a missing call or an old status.</li>
          <li>Quality is genuine opportunities divided by reviewed opportunities. Pending is written beside the rate and left out of it.</li>
          <li>One person can have several opportunities. Contacts are counted once. Leads and requirements are counted on their own.</li>
          <li>
            Meta submissions are original form deliveries in the selected dates, campaign and form. They are not counted
            from CRM rows. A delivery with no linked lead or requirement is still included. Filtering by intent does not
            change this count.
          </li>
          <li>A requirement added from an owner lead keeps that lead’s campaign and does not add another submission.</li>
          <li>
            Cost uses imported spend, in paise for INR. Zero spend, missing spend, or no genuine opportunities is N/A.
            A campaign total uses only campaign-level spend. If spend is imported for only some ad sets or ads, the total
            stays Incomplete rather than a partial sum. Nothing is estimated.
          </li>
          <li>A lead with no campaign id is Unattributed. It is not given another campaign.</li>
          <li>Dates are the original Meta submission time in India Standard Time.</li>
          <li>Buyer and tenant, and owner and seeker, follow the date, campaign and form. The other cards also follow the intent filter.</li>
        </ul>
      </Card>
    </AdminShell>
  );
}
