import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { mergeCoverageRanges } from "../crm/spend-coverage";
import type { SqlDb, SqlStatement } from "../db/sql";
import {
  CONNECTION_ID,
  getConnection,
  MARKETING_TOKEN_EXPIRED,
  MARKETING_TOKEN_INVALID,
  MARKETING_TOKEN_MISSING,
  markUserTokenRejected,
  readUserToken,
  saveAdAccount,
  type MetaConnectionView,
} from "./connection";
import { MetaApiError, redactTokens, type GraphClient, type MetaAdAccount } from "./graph";

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type SpendWindow = { since: string; until: string };

export type SpendImportResult = {
  adAccountId: string;
  adAccountName: string;
  since: string;
  until: string;
  campaigns: number;
  spendRows: number;
  zeroRows: number;
  message: string;
};

function istDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The later of 90 days before today (India time) and the earliest stored Meta
 * submission. The first import never reaches further back than 90 days.
 */
export function spendWindow(nowIso: string, earliestSubmissionIso: string | null): SpendWindow {
  const until = istDate(nowIso);
  const earliest = earliestSubmissionIso ? istDate(earliestSubmissionIso) : "";
  const bound = addCalendarDays(until, -90);
  const since = earliest && earliest > bound ? earliest : bound;
  return { since: since > until ? until : since, until };
}

function inclusiveDays(since: string, until: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || since > until) return -1;
  const start = Date.parse(`${since}T00:00:00.000Z`);
  const end = Date.parse(`${until}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return -1;
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * Every calendar day from `since` through `until`, inclusive.
 * A range that cannot be covered throws. It never returns a shorter list.
 */
export function eachDate(since: string, until: string): string[] {
  const expected = inclusiveDays(since, until);
  if (expected < 1) {
    throw new HttpError(400, "The spend date range is not valid. Nothing was stored.");
  }
  const dates: string[] = [];
  let cursor = since;
  while (cursor <= until && dates.length < expected) {
    dates.push(cursor);
    const next = addCalendarDays(cursor, 1);
    if (next <= cursor) break;
    cursor = next;
  }
  if (dates.length !== expected || dates[0] !== since || dates[dates.length - 1] !== until) {
    throw new HttpError(400, "The spend date range could not be covered. Nothing was stored.");
  }
  return dates;
}

/** Rupees from Insights, as integer paise. Only call this after the account currency is INR. */
export function rupeesToPaise(amount: string): number {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) {
    throw new HttpError(400, "Meta returned a spend amount that is not a number. Nothing was stored.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const digits = `${fraction}000`.slice(0, 3);
  const paise = Number(whole) * 100 + Number(digits.slice(0, 2));
  return paise + (Number(digits[2]) >= 5 ? 1 : 0);
}

export function foreignCurrencyMessage(currency: string): string {
  const label = currency || "an unknown currency";
  return `This ad account uses ${label}, not INR. Spend was not imported, and no amounts were stored. Lead Ads on this Page stay connected.`;
}

const CHOOSE_ACCOUNT = "Choose the ad account on the Meta page before importing spend. Lead Ads on this Page stay connected.";
const INCOMPLETE_READ = "Meta did not finish the spend report. Nothing was stored. Lead Ads on this Page stay connected.";

async function earliestSubmission(db: SqlDb): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(submitted_at) AS submitted_at FROM lead_sources
       WHERE channel = 'meta_lead_form' AND submitted_at != ''`,
    )
    .first<{ submitted_at: string | null }>();
  return row?.submitted_at ?? null;
}

async function marketingUser(db: SqlDb, tokenKey: string, now: string): Promise<{ connection: MetaConnectionView; token: string }> {
  const connection = await getConnection(db);
  if (connection.status !== "connected") {
    throw new HttpError(400, "Connect a Facebook Page before importing spend.");
  }
  if (connection.userTokenError) throw new HttpError(401, MARKETING_TOKEN_INVALID);
  if (!connection.hasUserToken) throw new HttpError(400, MARKETING_TOKEN_MISSING);
  if (connection.userTokenExpiresAt && connection.userTokenExpiresAt <= now) throw new HttpError(401, MARKETING_TOKEN_EXPIRED);
  if (!connection.userTokenScopes.includes("ads_read")) {
    throw new HttpError(
      400,
      "Campaign spend needs the optional ads_read permission. Tick ads_read under Optional on next connect, then reconnect. This does not use ads_management, and Lead Ads on this Page stay connected.",
    );
  }
  const token = await readUserToken(db, tokenKey, now);
  if (!token) throw new HttpError(400, MARKETING_TOKEN_MISSING);
  return { connection, token };
}

function inrAccount(account: MetaAdAccount): boolean {
  return account.currency === "INR";
}

export async function listMarketingAccounts(db: SqlDb, tokenKey: string, graph: GraphClient, now: string): Promise<MetaAdAccount[]> {
  const { token } = await marketingUser(db, tokenKey, now);
  try {
    return await graph.listAdAccounts(token);
  } catch (error) {
    throw await asImportError(db, error, now);
  }
}

export async function selectMarketingAccount(
  db: SqlDb,
  actor: AuditActor,
  tokenKey: string,
  graph: GraphClient,
  accountId: string,
  now: string,
): Promise<{ id: string; name: string }> {
  const accounts = await listMarketingAccounts(db, tokenKey, graph, now);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new HttpError(400, "That ad account is not available to the Facebook user you connected.");
  if (!inrAccount(account)) throw new HttpError(400, foreignCurrencyMessage(account.currency));
  await saveAdAccount(db, actor, { id: account.id, name: account.name, now });
  return { id: account.id, name: account.name };
}

async function record(
  db: SqlDb,
  actor: AuditActor,
  now: string,
  input: {
    adAccountId: string;
    adAccountName: string;
    since: string;
    until: string;
    campaigns: number;
    spendRows: number;
    zeroRows: number;
    errors: string;
  },
) {
  await auditStatement(db, {
    actor,
    entityType: "integration",
    entityId: "meta",
    entityLabel: "Meta Lead Ads",
    action: "import_campaign_spend",
    context: {
      ad_account_id: input.adAccountId,
      ad_account_name: input.adAccountName,
      since: input.since,
      until: input.until,
      campaigns: input.campaigns,
      spend_rows: input.spendRows,
      zero_rows: input.zeroRows,
      errors: redactTokens(input.errors).slice(0, 500),
    },
    at: now,
  }).run();
}

async function asImportError(db: SqlDb, error: unknown, now: string): Promise<HttpError> {
  if (error instanceof HttpError) return error;
  if (error instanceof MetaApiError && error.kind === "auth") {
    await markUserTokenRejected(db, error.message, now);
    return new HttpError(401, MARKETING_TOKEN_INVALID);
  }
  if (error instanceof MetaApiError && error.kind === "permission") {
    return new HttpError(
      400,
      "Meta refused to read campaign spend. Reconnect with ads_read and a Facebook user who can see this ad account. ads_management is not required, and this Page connection was left in place.",
    );
  }
  if (error instanceof MetaApiError && error.kind === "rate_limit") {
    return new HttpError(429, "Meta rate-limited the spend import. Wait and run it again. Nothing was stored.");
  }
  return new HttpError(502, INCOMPLETE_READ);
}

export async function importCampaignSpend(
  db: SqlDb,
  actor: AuditActor,
  tokenKey: string,
  graph: GraphClient,
  now: string,
): Promise<SpendImportResult> {
  const connection = await getConnection(db);
  const window = spendWindow(now, await earliestSubmission(db));
  let account: MetaAdAccount | null = null;
  try {
    const ready = await marketingUser(db, tokenKey, now);
    const token = ready.token;
    const accounts = await graph.listAdAccounts(token);
    account = connection.adAccountId ? (accounts.find((item) => item.id === connection.adAccountId) ?? null) : null;
    if (connection.adAccountId && !account) {
      throw new HttpError(400, "The selected ad account is no longer available to this Facebook user. Choose it again. Nothing was stored.");
    }
    if (!account) {
      if (accounts.length === 1) account = accounts[0];
      else if (accounts.length === 0) throw new HttpError(400, "Meta returned no ad accounts for this Facebook user. Nothing was stored.");
      else throw new HttpError(400, CHOOSE_ACCOUNT);
    }
    if (!inrAccount(account)) throw new HttpError(400, foreignCurrencyMessage(account.currency));

    // Cover the whole window before Insights. A short date list must not become a partial batch.
    const dates = eachDate(window.since, window.until);
    const discovered = (await graph.listAdCampaigns(account.id, token)).filter((campaign) => campaign.effectiveStatus !== "DELETED");
    const insights = await graph.campaignInsights(account.id, token, window.since, window.until);
    for (const row of insights) {
      if (row.currency && row.currency !== "INR") throw new HttpError(400, foreignCurrencyMessage(row.currency));
    }
    const byKey = new Map<string, { spend: string; impressions: number | null; clicks: number | null }>();
    for (const row of insights) {
      if (!/^\d{3,32}$/.test(row.campaignId) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
      if (row.date < window.since || row.date > window.until) continue;
      if (!discovered.some((campaign) => campaign.id === row.campaignId)) continue;
      byKey.set(`${row.campaignId}|${row.date}`, {
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
      });
    }

    const statements: SqlStatement[] = [
      db
        .prepare(
          `UPDATE meta_connection SET ad_account_id = ?1, ad_account_name = ?2, updated_at = ?3,
             row_version = row_version + 1 WHERE id = ?4`,
        )
        .bind(account.id, account.name, now, CONNECTION_ID),
    ];
    for (const campaign of discovered) {
      statements.push(
        db
          .prepare(
            `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
             VALUES ('meta', 'campaign', ?1, ?2, '', ?3, ?3)
             ON CONFLICT(platform, level, external_id) DO UPDATE SET
               name = CASE WHEN excluded.name != '' THEN excluded.name ELSE ad_entities.name END,
               last_seen_at = excluded.last_seen_at`,
          )
          .bind(campaign.id, campaign.name, now),
      );
    }

    let zeroRows = 0;
    for (const campaign of discovered) {
      for (const date of dates) {
        const hit = byKey.get(`${campaign.id}|${date}`);
        const minor = hit ? rupeesToPaise(hit.spend) : 0;
        if (!hit) zeroRows += 1;
        statements.push(
          db
            .prepare(
              `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, impressions, clicks, source, imported_at, imported_by)
               VALUES ('meta', 'campaign', ?1, ?2, 'INR', ?3, ?4, ?5, 'meta_insights', ?6, ?7)
               ON CONFLICT(platform, level, external_id, spend_date) DO UPDATE SET
                 currency = 'INR',
                 spend_minor = excluded.spend_minor,
                 impressions = excluded.impressions,
                 clicks = excluded.clicks,
                 source = 'meta_insights',
                 imported_at = excluded.imported_at,
                 imported_by = excluded.imported_by`,
            )
            .bind(campaign.id, date, minor, hit?.impressions ?? null, hit?.clicks ?? null, now, actor.id),
        );
      }
    }

    const spendRows = discovered.length * dates.length;
    const covered = await db
      .prepare(
        `SELECT covered_since AS since, covered_until AS until FROM ad_spend_coverage
         WHERE platform = 'meta' AND level = 'campaign' AND ad_account_id = ?1`,
      )
      .bind(account.id)
      .all<{ since: string; until: string }>();
    const ranges = mergeCoverageRanges([...covered.results, { since: window.since, until: window.until }]);
    statements.push(
      db
        .prepare("DELETE FROM ad_spend_coverage WHERE platform = 'meta' AND level = 'campaign' AND ad_account_id = ?1")
        .bind(account.id),
    );
    for (const range of ranges) {
      statements.push(
        db
          .prepare(
            `INSERT INTO ad_spend_coverage (platform, level, ad_account_id, covered_since, covered_until, imported_at, imported_by)
             VALUES ('meta', 'campaign', ?1, ?2, ?3, ?4, ?5)`,
          )
          .bind(account.id, range.since, range.until, now, actor.id),
      );
    }
    statements.push(
      auditStatement(db, {
        actor,
        entityType: "integration",
        entityId: "meta",
        entityLabel: "Meta Lead Ads",
        action: "import_campaign_spend",
        context: {
          ad_account_id: account.id,
          ad_account_name: account.name,
          since: window.since,
          until: window.until,
          campaigns: discovered.length,
          spend_rows: spendRows,
          zero_rows: zeroRows,
          errors: "",
        },
        at: now,
      }),
    );
    await db.batch(statements);
    const message =
      discovered.length === 0
        ? `No Active, Paused or Archived campaigns were on ${account.name}. Nothing was added to lead records.`
        : `Imported spend for ${discovered.length} campaigns from ${window.since} to ${window.until}. ${spendRows - zeroRows} days had spend and ${zeroRows} days were zero. Lead records were not changed.`;
    return {
      adAccountId: account.id,
      adAccountName: account.name,
      since: window.since,
      until: window.until,
      campaigns: discovered.length,
      spendRows,
      zeroRows,
      message,
    };
  } catch (error) {
    const wrapped = await asImportError(db, error, now);
    await record(db, actor, now, {
      adAccountId: account?.id ?? connection.adAccountId,
      adAccountName: account?.name ?? connection.adAccountName,
      since: window.since,
      until: window.until,
      campaigns: 0,
      spendRows: 0,
      zeroRows: 0,
      errors: wrapped.message,
    });
    throw wrapped;
  }
}
