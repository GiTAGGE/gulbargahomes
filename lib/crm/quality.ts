import { formatInr } from "../admin/format";
import type { SqlDb, SqlValue } from "../db/sql";
import { maskPhone } from "./phone";
import { reviewLabel, type StoredReview } from "./review";
import { mergeCoverageRanges, rangeCovered, type CoverageRange } from "./spend-coverage";

const IST_OFFSET_MS = 330 * 60_000;

export const QUALITY_INTENTS = [
  "all",
  "owner",
  "buyer",
  "tenant",
  "misclassified",
  "unqualified",
  "pending",
  "genuine",
  "both",
] as const;
export type QualityIntent = (typeof QUALITY_INTENTS)[number];

export const QUALITY_SORTS = ["opportunities", "quality", "cost"] as const;
export type QualitySort = (typeof QUALITY_SORTS)[number];

export type QualityQuery = {
  from: string | null;
  to: string | null;
  fromUtc: string | null;
  toUtc: string | null;
  /** null means every campaign. "" means the unattributed bucket. */
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  formId: string | null;
  intent: QualityIntent;
  sort: QualitySort;
};

export type QualityGroup = {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  submissions: number;
  uniqueContacts: number;
  genuineOwners: number;
  misclassified: number;
  genuineBuyers: number;
  genuineTenants: number;
  unqualified: number;
  pending: number;
  genuineOpportunities: number;
  reviewedOpportunities: number;
  qualityLabel: string;
  spendImported: boolean;
  spendMinor: number | null;
  currency: string;
  spendLabel: string;
  costLabel: string;
  costMinorPerOpportunity: number | null;
};

export type QualityRecord = {
  id: string;
  href: string;
  kind: "owner" | "buyer" | "tenant";
  code: string;
  name: string;
  phone: string;
  review: StoredReview;
  reviewLabel: string;
  campaignName: string;
  formName: string;
  submittedAt: string;
};

export type QualityReport = {
  summary: {
    submissions: number;
    uniqueContacts: number;
    genuineOwners: number;
    misclassified: number;
    genuineBuyers: number;
    genuineTenants: number;
    unqualified: number;
    pending: number;
    genuineOpportunities: number;
    reviewedOpportunities: number;
    buyerAndTenant: number;
    ownerAndSeeker: number;
    qualityLabel: string;
    spendLabel: string;
    costPerLead: string;
    costPerOwner: string;
    costPerBuyer: string;
    costPerTenant: string;
    costPerOpportunity: string;
  };
  groups: QualityGroup[];
  records: QualityRecord[];
  truncated: boolean;
  campaigns: { id: string; name: string }[];
  forms: { id: string; name: string }[];
  breadcrumb: { campaign: string; adset: string; ad: string };
  groupLevel: "campaign" | "adset" | "ad" | null;
  /** Spend is for a whole campaign, ad set or ad. A form or intent filter makes cost N/A. */
  costComparable: boolean;
  /** Dates a successful campaign import fully wrote for the selected ad account. */
  spendCoverage: CoverageRange[];
};

type Spend = { imported: boolean; minor: number | null; currency: string; mixed: boolean; incomplete: boolean };

const OPPORTUNITIES = `WITH meta_sources AS (
  SELECT id,
    meta_campaign_id AS campaign_id,
    meta_campaign_name AS campaign_name,
    meta_adset_id AS adset_id,
    meta_adset_name AS adset_name,
    meta_ad_id AS ad_id,
    meta_ad_name AS ad_name,
    meta_form_id AS form_id,
    meta_form_name AS form_name,
    submitted_at
  FROM lead_sources
  WHERE channel = 'meta_lead_form' OR meta_lead_id IS NOT NULL
),
opportunities AS (
  SELECT l.id AS record_id, 'owner' AS kind, l.contact_id AS contact_id, l.code AS code,
    c.name AS contact_name, c.phone_e164 AS phone, s.id AS source_id,
    s.campaign_id, s.campaign_name, s.adset_id, s.adset_name, s.ad_id, s.ad_name,
    s.form_id, s.form_name, s.submitted_at,
    CASE WHEN l.role_review IN ('genuine', 'misclassified', 'unqualified') THEN l.role_review ELSE '' END AS review
  FROM owner_leads l
  JOIN contacts c ON c.id = l.contact_id
  JOIN meta_sources s ON s.id = l.source_id
  UNION ALL
  SELECT r.id,
    CASE WHEN r.intent = 'Buy' THEN 'buyer' ELSE 'tenant' END,
    r.contact_id, r.code, c.name, c.phone_e164, attr.id,
    attr.campaign_id, attr.campaign_name, attr.adset_id, attr.adset_name, attr.ad_id, attr.ad_name,
    attr.form_id, attr.form_name, attr.submitted_at,
    CASE WHEN r.quality_review IN ('genuine', 'unqualified') THEN r.quality_review ELSE '' END
  FROM demand_requirements r
  JOIN contacts c ON c.id = r.contact_id
  LEFT JOIN lead_sources own ON own.id = r.source_id
  LEFT JOIN owner_leads origin ON origin.id = r.origin_owner_lead_id
  JOIN meta_sources attr ON attr.id = CASE
    WHEN own.channel = 'meta_lead_form' OR own.meta_lead_id IS NOT NULL THEN own.id
    ELSE (SELECT source_id FROM owner_leads WHERE id = r.origin_owner_lead_id)
  END
)`;

const METRICS = `COUNT(DISTINCT contact_id) AS unique_contacts,
  SUM(CASE WHEN kind = 'owner' AND review = 'genuine' THEN 1 ELSE 0 END) AS genuine_owners,
  SUM(CASE WHEN review = 'misclassified' THEN 1 ELSE 0 END) AS misclassified,
  SUM(CASE WHEN kind = 'buyer' AND review = 'genuine' THEN 1 ELSE 0 END) AS genuine_buyers,
  SUM(CASE WHEN kind = 'tenant' AND review = 'genuine' THEN 1 ELSE 0 END) AS genuine_tenants,
  SUM(CASE WHEN review = 'unqualified' THEN 1 ELSE 0 END) AS unqualified,
  SUM(CASE WHEN review = '' THEN 1 ELSE 0 END) AS pending,
  SUM(CASE WHEN review = 'genuine' THEN 1 ELSE 0 END) AS genuine_opportunities,
  SUM(CASE WHEN review != '' THEN 1 ELSE 0 END) AS reviewed`;

function istBound(date: string, end: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const utc = Date.UTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0) - IST_OFFSET_MS;
  return new Date(utc).toISOString();
}

function scopeToken(value: string | undefined): string | null {
  if (!value) return null;
  return value === "unattributed" ? "" : value;
}

export function parseQualityQuery(input: {
  from?: string;
  to?: string;
  campaign?: string;
  adset?: string;
  ad?: string;
  form?: string;
  intent?: string;
  sort?: string;
}): QualityQuery {
  const from = input.from && istBound(input.from, false) ? input.from : null;
  const to = input.to && istBound(input.to, true) ? input.to : null;
  const intent = (QUALITY_INTENTS as readonly string[]).includes(input.intent ?? "")
    ? (input.intent as QualityIntent)
    : "all";
  const sort = (QUALITY_SORTS as readonly string[]).includes(input.sort ?? "") ? (input.sort as QualitySort) : "opportunities";
  return {
    from,
    to,
    fromUtc: from ? istBound(from, false) : null,
    toUtc: to ? istBound(to, true) : null,
    campaignId: scopeToken(input.campaign),
    adsetId: scopeToken(input.adset),
    adId: scopeToken(input.ad),
    formId: input.form?.trim() ? input.form.trim() : null,
    intent,
    sort,
  };
}

/** Genuine / reviewed, with pending beside it. Pending is not part of the rate. */
export function qualityLabel(genuine: number, reviewed: number, pending: number): string {
  const waiting = `${pending} pending`;
  if (reviewed <= 0) return `0 reviewed, ${waiting}`;
  const percent = Math.round((genuine / reviewed) * 100);
  return `${genuine}/${reviewed} reviewed (${percent}%), ${waiting}`;
}

function money(minor: number, currency: string): string {
  const major = minor / 100;
  if (!currency || currency === "INR") return formatInr(major);
  return `${major.toLocaleString("en-IN")} ${currency}`;
}

export function spendLabel(spend: Spend, comparable: boolean): string {
  if (!comparable) return "N/A";
  if (spend.incomplete) return "Incomplete";
  if (!spend.imported || spend.minor === null) return "Not imported";
  if (spend.mixed || spend.minor < 0) return "N/A";
  return money(spend.minor, spend.currency);
}

export function costLabel(spend: Spend, comparable: boolean, opportunities: number): string {
  if (
    !comparable ||
    spend.incomplete ||
    !spend.imported ||
    spend.mixed ||
    spend.minor === null ||
    spend.minor < 0 ||
    opportunities <= 0
  ) {
    return "N/A";
  }
  return money(Math.round(spend.minor / opportunities), spend.currency);
}

function addStructural(query: QualityQuery, values: SqlValue[], prefix: string): string[] {
  const parts: string[] = [];
  const add = (sql: string, value: SqlValue) => {
    values.push(value);
    parts.push(sql.replace("?", `?${values.length}`));
  };
  if (query.fromUtc) add(`${prefix}submitted_at >= ?`, query.fromUtc);
  if (query.toUtc) add(`${prefix}submitted_at <= ?`, query.toUtc);
  if (query.formId) add(`${prefix}form_id = ?`, query.formId);
  if (query.campaignId !== null) add(`${prefix}campaign_id = ?`, query.campaignId);
  if (query.adsetId !== null) add(`${prefix}adset_id = ?`, query.adsetId);
  if (query.adId !== null) add(`${prefix}ad_id = ?`, query.adId);
  return parts;
}

function intentClause(query: QualityQuery, values: SqlValue[]): string {
  if (query.intent === "owner") return "kind = 'owner'";
  if (query.intent === "buyer") return "kind = 'buyer'";
  if (query.intent === "tenant") return "kind = 'tenant'";
  if (query.intent === "misclassified") return "review = 'misclassified'";
  if (query.intent === "unqualified") return "review = 'unqualified'";
  if (query.intent === "pending") return "review = ''";
  if (query.intent === "genuine") return "review = 'genuine'";
  if (query.intent === "both") {
    const buyers = addStructural(query, values, "");
    const tenants = addStructural(query, values, "");
    const buyerWhere = buyers.length ? ` AND ${buyers.join(" AND ")}` : "";
    const tenantWhere = tenants.length ? ` AND ${tenants.join(" AND ")}` : "";
    return `kind IN ('buyer', 'tenant') AND review = 'genuine' AND contact_id IN (
      SELECT contact_id FROM opportunities WHERE kind = 'buyer' AND review = 'genuine'${buyerWhere}
      INTERSECT
      SELECT contact_id FROM opportunities WHERE kind = 'tenant' AND review = 'genuine'${tenantWhere}
    )`;
  }
  return "1 = 1";
}

function whereClause(query: QualityQuery, values: SqlValue[], prefix = ""): string {
  const structural = addStructural(query, values, prefix);
  const intent = prefix ? "1 = 1" : intentClause(query, values);
  const parts = [...structural];
  if (!prefix && query.intent !== "all") parts.push(intent);
  return parts.length ? parts.join(" AND ") : "1 = 1";
}

const GROUP_COLUMNS = {
  campaign: { id: "campaign_id", name: "campaign_name" },
  adset: { id: "adset_id", name: "adset_name" },
  ad: { id: "ad_id", name: "ad_name" },
} as const;

function groupLevel(query: QualityQuery): "campaign" | "adset" | "ad" | null {
  if (query.adId !== null) return null;
  if (query.adsetId !== null) return "ad";
  if (query.campaignId !== null) return "adset";
  return "campaign";
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupName(level: "campaign" | "adset" | "ad", id: string, stored: string, entities: Map<string, string>): string {
  const named = stored.trim() || entities.get(`${level}:${id}`) || "";
  if (named) return named;
  if (!id) return level === "campaign" ? "Unattributed" : level === "adset" ? "No ad set" : "No ad";
  return `Name unavailable (${id})`;
}

type MetricRow = {
  group_id?: string;
  group_name?: string;
  submissions?: number;
  unique_contacts?: number;
  genuine_owners?: number;
  misclassified?: number;
  genuine_buyers?: number;
  genuine_tenants?: number;
  unqualified?: number;
  pending?: number;
  genuine_opportunities?: number;
  reviewed?: number;
};

async function spendMap(db: SqlDb, level: "campaign" | "adset" | "ad", query: QualityQuery): Promise<Map<string, Spend>> {
  const { results } = await db
    .prepare(
      `SELECT external_id, SUM(spend_minor) AS spend_minor, COUNT(*) AS rows,
         MIN(currency) AS currency, COUNT(DISTINCT currency) AS currencies
       FROM ad_spend_daily
       WHERE platform = 'meta' AND level = ?1
         AND (?2 IS NULL OR spend_date >= ?2)
         AND (?3 IS NULL OR spend_date <= ?3)
       GROUP BY external_id`,
    )
    .bind(level, query.from, query.to)
    .all<{ external_id: string; spend_minor: number; rows: number; currency: string; currencies: number }>();
  return new Map(
    results.map((row) => [
      row.external_id,
      {
        imported: Number(row.rows) > 0,
        minor: Number(row.spend_minor),
        currency: row.currency || "INR",
        mixed: Number(row.currencies) > 1,
        incomplete: false,
      },
    ]),
  );
}

const UNKNOWN_SPEND: Spend = { imported: false, minor: null, currency: "INR", mixed: false, incomplete: false };
const INCOMPLETE_SPEND: Spend = { imported: false, minor: null, currency: "INR", mixed: false, incomplete: true };

type ScopeNode = { campaignId: string; adsetId: string; adId: string };

/** A parent total is only a parent-level import. Child rows are never added up. */
function resolveSpend(
  level: "campaign" | "adset" | "ad",
  id: string,
  nodes: ScopeNode[],
  maps: { campaign: Map<string, Spend>; adset: Map<string, Spend>; ad: Map<string, Spend> },
  uncovered: boolean,
): Spend {
  if (uncovered) return INCOMPLETE_SPEND;
  const own = (map: Map<string, Spend>) => (id ? map.get(id) : undefined);
  if (level === "ad") return own(maps.ad) ?? UNKNOWN_SPEND;
  if (level === "adset") {
    const known = own(maps.adset);
    if (known) return known;
    const ads = nodes.filter((node) => node.adsetId === id).map((node) => node.adId);
    return ads.some((adId) => adId && maps.ad.has(adId)) ? INCOMPLETE_SPEND : UNKNOWN_SPEND;
  }
  const known = own(maps.campaign);
  if (known) return known;
  const related = nodes.filter((node) => node.campaignId === id);
  const partial =
    related.some((node) => node.adsetId && maps.adset.has(node.adsetId)) ||
    related.some((node) => node.adId && maps.ad.has(node.adId));
  return partial ? INCOMPLETE_SPEND : UNKNOWN_SPEND;
}

function combineSpend(spends: Spend[]): Spend {
  if (spends.length === 0) return UNKNOWN_SPEND;
  if (spends.some((item) => item.incomplete)) return INCOMPLETE_SPEND;
  const known = spends.filter((item) => item.imported && item.minor !== null);
  if (known.length !== spends.length) return known.length > 0 ? INCOMPLETE_SPEND : UNKNOWN_SPEND;
  const currencies = new Set(known.map((item) => item.currency));
  return {
    imported: true,
    minor: known.reduce((sum, item) => sum + (item.minor ?? 0), 0),
    currency: known[0]?.currency || "INR",
    mixed: currencies.size > 1 || known.some((item) => item.mixed),
    incomplete: false,
  };
}

/**
 * Meta lead quality for Gulbarga (Kalaburagi).
 * Submissions are original Meta deliveries in the date, campaign and form scope. They are not
 * derived from CRM opportunities, so a delivery with no linked lead is still counted, and an
 * intent filter does not change the count.
 * A requirement created from an owner lead uses that lead's campaign and is not a second submission.
 * Repeated webhook rows are ignored because only lead_sources are counted, and meta_lead_id is unique.
 * Campaign spend is the campaign-level import only. A partial ad set or ad import stays Incomplete.
 */
export async function campaignQuality(db: SqlDb, query: QualityQuery, options: { includePhone?: boolean } = {}): Promise<QualityReport> {
  const includePhone = options.includePhone === true;
  const comparable = query.intent === "all" && !query.formId;
  const level = groupLevel(query);
  const values: SqlValue[] = [];
  const where = whereClause(query, values);
  const grouped = level
    ? await db
        .prepare(
          `${OPPORTUNITIES}
           SELECT ${GROUP_COLUMNS[level].id} AS group_id, MAX(${GROUP_COLUMNS[level].name}) AS group_name, ${METRICS}
           FROM opportunities
           WHERE ${where}
           GROUP BY ${GROUP_COLUMNS[level].id}`,
        )
        .bind(...values)
        .all<MetricRow>()
    : { results: [] as MetricRow[] };

  const submissionValues: SqlValue[] = [];
  const submissionWhere = whereClause({ ...query, intent: "all" }, submissionValues, "s.");
  const submissionRows = (
    await db
      .prepare(
        `${OPPORTUNITIES}
         SELECT ${level ? `${GROUP_COLUMNS[level].id} AS group_id, MAX(${GROUP_COLUMNS[level].name}) AS group_name,` : ""} COUNT(*) AS submissions
         FROM meta_sources s
         WHERE ${submissionWhere}
         ${level ? `GROUP BY ${GROUP_COLUMNS[level].id}` : ""}`,
      )
      .bind(...submissionValues)
      .all<MetricRow>()
  ).results;

  const scopeValues: SqlValue[] = [];
  const scopeWhere = whereClause({ ...query, intent: "all" }, scopeValues, "s.");
  const scopeRows = await db
    .prepare(
      `${OPPORTUNITIES}
       SELECT DISTINCT campaign_id, adset_id, ad_id
       FROM meta_sources s
       WHERE ${scopeWhere}`,
    )
    .bind(...scopeValues)
    .all<{ campaign_id: string; adset_id: string; ad_id: string }>();
  const nodes: ScopeNode[] = scopeRows.results.map((row) => ({
    campaignId: row.campaign_id ?? "",
    adsetId: row.adset_id ?? "",
    adId: row.ad_id ?? "",
  }));

  const summaryValues: SqlValue[] = [];
  const summaryWhere = whereClause(query, summaryValues);
  const summaryRow = await db
    .prepare(`${OPPORTUNITIES} SELECT ${METRICS} FROM opportunities WHERE ${summaryWhere}`)
    .bind(...summaryValues)
    .first<MetricRow>();

  const bothValues: SqlValue[] = [];
  const bothStructural = addStructural(query, bothValues, "");
  const bothWhere = bothStructural.length ? ` AND ${bothStructural.join(" AND ")}` : "";
  const tenantStructural = addStructural(query, bothValues, "");
  const tenantWhere = tenantStructural.length ? ` AND ${tenantStructural.join(" AND ")}` : "";
  const bothRow = await db
    .prepare(
      `${OPPORTUNITIES}
       SELECT COUNT(*) AS n FROM (
         SELECT contact_id FROM opportunities WHERE kind = 'buyer' AND review = 'genuine'${bothWhere}
         INTERSECT
         SELECT contact_id FROM opportunities WHERE kind = 'tenant' AND review = 'genuine'${tenantWhere}
       )`,
    )
    .bind(...bothValues)
    .first<{ n: number }>();

  const seekerValues: SqlValue[] = [];
  const ownerStructural = addStructural(query, seekerValues, "");
  const ownerWhere = ownerStructural.length ? ` AND ${ownerStructural.join(" AND ")}` : "";
  const seekerStructural = addStructural(query, seekerValues, "");
  const seekerWhere = seekerStructural.length ? ` AND ${seekerStructural.join(" AND ")}` : "";
  const seekerRow = await db
    .prepare(
      `${OPPORTUNITIES}
       SELECT COUNT(*) AS n FROM (
         SELECT contact_id FROM opportunities WHERE kind = 'owner' AND review = 'genuine'${ownerWhere}
         INTERSECT
         SELECT contact_id FROM opportunities WHERE kind IN ('buyer', 'tenant') AND review = 'genuine'${seekerWhere}
       )`,
    )
    .bind(...seekerValues)
    .first<{ n: number }>();

  const entityRows = await db
    .prepare("SELECT level, external_id, name FROM ad_entities WHERE platform = 'meta' AND name != ''")
    .all<{ level: string; external_id: string; name: string }>();
  const entities = new Map(entityRows.results.map((row) => [`${row.level}:${row.external_id}`, row.name]));

  const spendMaps = {
    campaign: await spendMap(db, "campaign", query),
    adset: await spendMap(db, "adset", query),
    ad: await spendMap(db, "ad", query),
  };
  const selectedAccount = await selectedAdAccount(db);
  const spendCoverage = await campaignCoverage(db, selectedAccount);
  // A selected account uses only its own saved windows. Another account's coverage is not a substitute.
  const spendUncovered = selectedAccount !== "" && !rangeCovered(query.from, query.to, spendCoverage);

  const submissionById = new Map(submissionRows.map((row) => [row.group_id ?? "", row]));
  const discoveredCampaigns = (
    await db
      .prepare(
        "SELECT external_id AS id, name FROM ad_entities WHERE platform = 'meta' AND level = 'campaign' AND external_id != ''",
      )
      .all<{ id: string; name: string }>()
  ).results;
  const ids = new Set<string>([
    ...grouped.results.map((row) => row.group_id ?? ""),
    ...submissionRows.map((row) => row.group_id ?? ""),
  ]);
  if (level === "campaign" && !query.formId) {
    for (const campaign of discoveredCampaigns) ids.add(campaign.id);
  }

  const groups: QualityGroup[] = level
    ? [...ids].map((id) => {
        const metrics = grouped.results.find((row) => (row.group_id ?? "") === id);
        const submitted = submissionById.get(id);
        const submissions = num(submitted?.submissions);
        const genuine = num(metrics?.genuine_opportunities);
        const reviewed = num(metrics?.reviewed);
        const pending = num(metrics?.pending);
        const rowSpendValue = resolveSpend(level, id, nodes, spendMaps, spendUncovered);
        const costMinor =
          comparable &&
          rowSpendValue.imported &&
          !rowSpendValue.incomplete &&
          !rowSpendValue.mixed &&
          rowSpendValue.minor !== null &&
          rowSpendValue.minor >= 0 &&
          genuine > 0
            ? Math.round(rowSpendValue.minor / genuine)
            : null;
        return {
          id,
          name: groupName(level, id, metrics?.group_name || submitted?.group_name || "", entities),
          level,
          submissions,
          uniqueContacts: num(metrics?.unique_contacts),
          genuineOwners: num(metrics?.genuine_owners),
          misclassified: num(metrics?.misclassified),
          genuineBuyers: num(metrics?.genuine_buyers),
          genuineTenants: num(metrics?.genuine_tenants),
          unqualified: num(metrics?.unqualified),
          pending,
          genuineOpportunities: genuine,
          reviewedOpportunities: reviewed,
          qualityLabel: qualityLabel(genuine, reviewed, pending),
          spendImported: rowSpendValue.imported,
          spendMinor: rowSpendValue.minor,
          currency: rowSpendValue.currency,
          spendLabel: spendLabel(rowSpendValue, comparable),
          costLabel: costLabel(rowSpendValue, comparable, genuine),
          costMinorPerOpportunity: costMinor,
        };
      })
    : [];

  groups.sort((a, b) => {
    if (query.sort === "quality") {
      const left = a.reviewedOpportunities === 0 ? -1 : a.genuineOpportunities / a.reviewedOpportunities;
      const right = b.reviewedOpportunities === 0 ? -1 : b.genuineOpportunities / b.reviewedOpportunities;
      return right - left || b.genuineOpportunities - a.genuineOpportunities || a.name.localeCompare(b.name);
    }
    if (query.sort === "cost") {
      const left = a.costMinorPerOpportunity ?? Number.POSITIVE_INFINITY;
      const right = b.costMinorPerOpportunity ?? Number.POSITIVE_INFINITY;
      return left - right || b.genuineOpportunities - a.genuineOpportunities || a.name.localeCompare(b.name);
    }
    return b.genuineOpportunities - a.genuineOpportunities || b.submissions - a.submissions || a.name.localeCompare(b.name);
  });

  const summaryLevel: "campaign" | "adset" | "ad" =
    query.adId !== null ? "ad" : query.adsetId !== null ? "adset" : "campaign";
  const summarySpendId = query.adId ?? query.adsetId ?? query.campaignId;
  const summarySpend =
    summarySpendId !== null
      ? resolveSpend(summaryLevel, summarySpendId, nodes, spendMaps, spendUncovered)
      : combineSpend(groups.map((group) => resolveSpend("campaign", group.id, nodes, spendMaps, spendUncovered)));
  const genuine = num(summaryRow?.genuine_opportunities);
  const reviewed = num(summaryRow?.reviewed);
  const pending = num(summaryRow?.pending);
  const submissions = num(submissionRows.reduce((sum, row) => sum + num(row.submissions), 0));

  const drilled = query.campaignId !== null || query.adsetId !== null || query.adId !== null;
  const recordValues: SqlValue[] = [];
  const recordWhere = whereClause(query, recordValues);
  const recordRows = drilled
    ? (
        await db
          .prepare(
            `${OPPORTUNITIES}
             SELECT record_id, kind, code, contact_name, phone, review, campaign_name, form_name, submitted_at
             FROM opportunities
             WHERE ${recordWhere}
             ORDER BY submitted_at DESC, code
             LIMIT 201`,
          )
          .bind(...recordValues)
          .all<{
            record_id: string;
            kind: "owner" | "buyer" | "tenant";
            code: string;
            contact_name: string;
            phone: string;
            review: string;
            campaign_name: string;
            form_name: string;
            submitted_at: string;
          }>()
      ).results
    : [];

  const campaignOptions = await db
    .prepare(
      `${OPPORTUNITIES}
       SELECT campaign_id AS id, MAX(campaign_name) AS name FROM meta_sources GROUP BY campaign_id ORDER BY name, id`,
    )
    .all<{ id: string; name: string }>();
  const formOptions = await db
    .prepare(
      `${OPPORTUNITIES}
       SELECT form_id AS id, MAX(form_name) AS name FROM meta_sources WHERE form_id != '' GROUP BY form_id ORDER BY name, id`,
    )
    .all<{ id: string; name: string }>();

  const scopeName = async (levelName: "campaign" | "adset" | "ad", id: string | null) => {
    if (id === null) return "";
    const column = GROUP_COLUMNS[levelName];
    const row = await db
      .prepare(`${OPPORTUNITIES} SELECT MAX(${column.name}) AS name FROM meta_sources WHERE ${column.id} = ?1`)
      .bind(id)
      .first<{ name: string | null }>();
    return groupName(levelName, id, row?.name ?? "", entities);
  };

  return {
    summary: {
      submissions,
      uniqueContacts: num(summaryRow?.unique_contacts),
      genuineOwners: num(summaryRow?.genuine_owners),
      misclassified: num(summaryRow?.misclassified),
      genuineBuyers: num(summaryRow?.genuine_buyers),
      genuineTenants: num(summaryRow?.genuine_tenants),
      unqualified: num(summaryRow?.unqualified),
      pending,
      genuineOpportunities: genuine,
      reviewedOpportunities: reviewed,
      buyerAndTenant: num(bothRow?.n),
      ownerAndSeeker: num(seekerRow?.n),
      qualityLabel: qualityLabel(genuine, reviewed, pending),
      spendLabel: spendLabel(summarySpend, comparable),
      costPerLead: costLabel(summarySpend, comparable, submissions),
      costPerOwner: costLabel(summarySpend, comparable, num(summaryRow?.genuine_owners)),
      costPerBuyer: costLabel(summarySpend, comparable, num(summaryRow?.genuine_buyers)),
      costPerTenant: costLabel(summarySpend, comparable, num(summaryRow?.genuine_tenants)),
      costPerOpportunity: costLabel(summarySpend, comparable, genuine),
    },
    groups,
    records: recordRows.slice(0, 200).map((row) => {
      const review = row.review === "genuine" || row.review === "misclassified" || row.review === "unqualified" ? row.review : "";
      return {
        id: row.record_id,
        href: row.kind === "owner" ? `/admin/owner-leads/${row.record_id}` : `/admin/requirements/${row.record_id}`,
        kind: row.kind,
        code: row.code,
        name: row.contact_name,
        phone: includePhone ? row.phone : maskPhone(row.phone),
        review,
        reviewLabel: reviewLabel(row.kind, review),
        campaignName: row.campaign_name || "Unattributed",
        formName: row.form_name,
        submittedAt: row.submitted_at,
      };
    }),
    truncated: recordRows.length > 200,
    campaigns: [...campaignOptions.results, ...discoveredCampaigns.filter((campaign) => !campaignOptions.results.some((item) => item.id === campaign.id))]
      .map((item) => ({
        id: item.id,
        name: groupName("campaign", item.id, item.name ?? "", entities),
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    forms: formOptions.results.map((item) => ({ id: item.id, name: item.name || item.id })),
    breadcrumb: {
      campaign: await scopeName("campaign", query.campaignId),
      adset: await scopeName("adset", query.adsetId),
      ad: await scopeName("ad", query.adId),
    },
    groupLevel: level,
    costComparable: comparable,
    spendCoverage,
  };
}

async function selectedAdAccount(db: SqlDb): Promise<string> {
  const account = await db
    .prepare("SELECT ad_account_id FROM meta_connection WHERE id = 'primary'")
    .first<{ ad_account_id: string }>();
  return account?.ad_account_id ?? "";
}

/** Windows a successful campaign import fully wrote for the ad account currently selected. */
async function campaignCoverage(db: SqlDb, accountId: string): Promise<CoverageRange[]> {
  if (!accountId) return [];
  const { results } = await db
    .prepare(
      `SELECT covered_since AS since, covered_until AS until FROM ad_spend_coverage
       WHERE platform = 'meta' AND level = 'campaign' AND ad_account_id = ?1
       ORDER BY covered_since`,
    )
    .bind(accountId)
    .all<CoverageRange>();
  return mergeCoverageRanges(results);
}
