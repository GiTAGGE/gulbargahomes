import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { HttpError } from "../lib/admin/errors";
import { formatInr } from "../lib/admin/format";
import { can } from "../lib/admin/permissions";
import { campaignQuality, parseQualityQuery } from "../lib/crm/quality";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig } from "../lib/meta/config";
import {
  getConnection,
  readPageToken,
  storePageConnection,
  storeUserToken,
} from "../lib/meta/connection";
import { createGraphClient } from "../lib/meta/graph";
import { addCalendarDays, eachDate, importCampaignSpend, selectMarketingAccount, spendWindow } from "../lib/meta/spend";
import { denySpendApiAction } from "../lib/meta/spend-access";
import { FakeMeta, PAGE_ID, PAGE_TOKEN, USER_TOKEN } from "./helpers/fake-meta";
import { createTestDb } from "./helpers/sqlite";

const ENV = {
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
  META_TOKEN_KEY: "k".repeat(48),
};
const { config } = readMetaConfig(ENV, "https://gulbargahomes.com");
const actor = { id: "adm_super", email: "owner@example.com", role: "super_admin" };
const NOW = "2026-11-12T06:00:00.000Z";
const ACTIVE = "120257043784730091";
const PAUSED = "120257536957600091";
const ARCHIVED = "120257785737900091";
const DELETED = "120257000000000091";
const ACCOUNT = "act_1509113601263131";
const USER_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval", "ads_read"];
const PAGE_SCOPES = USER_SCOPES.filter((scope) => scope !== "ads_read");

async function connect(options: { userScopes?: string[]; userToken?: boolean } = {}) {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  const meta = new FakeMeta();
  if (options.userToken !== false) {
    await storeUserToken(db, actor, {
      tokenKey: config.tokenKey,
      token: USER_TOKEN,
      expiresAt: "2027-01-01T00:00:00.000Z",
      userName: "Hubli Homes",
      scopes: options.userScopes ?? USER_SCOPES,
      now: NOW,
    });
  }
  await storePageConnection(db, actor, {
    tokenKey: config.tokenKey,
    pageId: PAGE_ID,
    pageName: "GulbargaHomes",
    pageToken: PAGE_TOKEN,
    pageTokenExpiresAt: null,
    dataAccessExpiresAt: null,
    scopes: PAGE_SCOPES,
    webhookSubscribed: true,
    now: NOW,
  });
  meta.adCampaigns = [
    { id: ACTIVE, name: "Rent Owners - Area Wise", effective_status: "ACTIVE" },
    { id: PAUSED, name: "GH | Agri Land Owner JV Leads", effective_status: "PAUSED" },
    { id: ARCHIVED, name: "Gulbarga Rental Property Lead", effective_status: "ARCHIVED" },
    { id: DELETED, name: "Gone", effective_status: "DELETED" },
  ];
  meta.insights = [
    { campaign_id: ACTIVE, campaign_name: "Rent Owners - Area Wise", spend: "10.50", impressions: "100", clicks: "4", account_currency: "INR", date_start: "2026-11-12" },
    { campaign_id: ACTIVE, campaign_name: "", spend: "0.00", account_currency: "INR", date_start: "2026-11-11" },
    { campaign_id: DELETED, campaign_name: "Gone", spend: "99.00", account_currency: "INR", date_start: "2026-11-12" },
  ];
  meta.insightPageSize = 1;
  return { db, meta, graph: createGraphClient(config, meta.fetch) };
}

async function spendRows(db: Awaited<ReturnType<typeof connect>>["db"]) {
  const { results } = await db
    .prepare("SELECT external_id, spend_date, spend_minor, currency FROM ad_spend_daily ORDER BY external_id, spend_date")
    .all<{ external_id: string; spend_date: string; spend_minor: number; currency: string }>();
  return results;
}

describe("campaign spend import", () => {
  it("starts at the later of 90 days ago and the earliest Meta submission", () => {
    assert.deepEqual(spendWindow("2026-11-12T06:00:00.000Z", null), { since: "2026-08-14", until: "2026-11-12" });
    assert.deepEqual(spendWindow("2026-11-12T06:00:00.000Z", "2026-01-01T00:00:00.000Z"), { since: "2026-08-14", until: "2026-11-12" });
    assert.deepEqual(spendWindow("2026-11-12T06:00:00.000Z", "2026-11-01T00:00:00.000Z"), { since: "2026-11-01", until: "2026-11-12" });
  });

  it("only a super admin can manage the integration that selects an account and imports spend", () => {
    assert.equal(can("super_admin", "integrations.manage"), true);
    assert.equal(can("lead_executive", "integrations.manage"), false);
    assert.equal(can("inventory_manager", "integrations.manage"), false);
    assert.equal(can("viewer", "integrations.manage"), false);
    for (const role of ["inventory_manager", "lead_executive", "viewer"] as const) {
      for (const action of ["list_ad_accounts", "select_ad_account", "import_spend"] as const) {
        assert.equal(denySpendApiAction(role, action)?.status, 403);
      }
    }
    assert.equal(denySpendApiAction("super_admin", "import_spend"), null);
    assert.equal(denySpendApiAction("viewer", "sync_names"), null);
    assert.equal(denySpendApiAction("inventory_manager", "sync_forms"), null);
  });

  it("returns every date in a range longer than 120 days, or refuses the range", () => {
    const dates = eachDate("2026-01-01", "2026-06-30");
    assert.ok(dates.length > 120);
    assert.equal(dates[0], "2026-01-01");
    assert.equal(dates[dates.length - 1], "2026-06-30");
    for (let index = 1; index < dates.length; index += 1) {
      assert.equal(dates[index], addCalendarDays(dates[index - 1], 1));
    }
    assert.throws(() => eachDate("2026-11-12", "2026-08-14"), /Nothing was stored/);
  });

  it("imports INR spend for active, paused and archived campaigns, replaces it on the next run, and leaves lead attribution alone", async () => {
    const { db, meta, graph } = await connect();
    await db
      .prepare(
        `INSERT INTO lead_sources (id, channel, meta_lead_id, meta_campaign_id, meta_campaign_name, submitted_at, created_at, created_by)
         VALUES ('src_keep', 'meta_lead_form', 'lead-keep', ?1, 'Rent Owners - Area Wise', '2026-11-01T00:00:00.000Z', ?2, 'x')`,
      )
      .bind(ACTIVE, NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
         VALUES ('meta', 'campaign', ?1, 'Rent Owners - Area Wise', '', ?2, ?2)`,
      )
      .bind(ACTIVE, NOW)
      .run();

    const first = await importCampaignSpend(db, actor, config.tokenKey, graph, NOW);
    assert.equal(first.since, "2026-11-01");
    assert.equal(first.until, "2026-11-12");
    assert.equal(first.campaigns, 3);
    const rows = await spendRows(db);
    assert.equal(rows.length, 36);
    assert.ok(rows.every((row) => row.currency === "INR"));
    assert.equal(rows.find((row) => row.external_id === ACTIVE && row.spend_date === "2026-11-12")?.spend_minor, 1050);
    assert.equal(rows.find((row) => row.external_id === ACTIVE && row.spend_date === "2026-11-11")?.spend_minor, 0);
    assert.equal(rows.some((row) => row.external_id === DELETED), false);
    assert.equal(rows.filter((row) => row.external_id === PAUSED).every((row) => row.spend_minor === 0), true);
    const marketing = meta.requests.filter((request) => /\/(adaccounts|campaigns|insights)/.test(request.url));
    assert.ok(marketing.length >= 3);
    assert.ok(marketing.every((request) => request.authorization.endsWith(USER_TOKEN)));
    assert.ok(meta.requests.every((request) => !request.url.includes("daily_budget")));
    assert.equal((await getConnection(db)).status, "connected");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);

    meta.adCampaigns = meta.adCampaigns.map((campaign) => (campaign.id === ACTIVE ? { ...campaign, name: "" } : campaign));
    meta.insights = meta.insights.map((row) => (row.campaign_id === ACTIVE && row.date_start === "2026-11-12" ? { ...row, spend: "20.00" } : row));
    const before = rows.length;
    await importCampaignSpend(db, actor, config.tokenKey, graph, "2026-11-12T07:00:00.000Z");
    const again = await spendRows(db);
    assert.equal(again.length, before);
    assert.equal(again.find((row) => row.external_id === ACTIVE && row.spend_date === "2026-11-12")?.spend_minor, 2000);
    const named = await db.prepare("SELECT name FROM ad_entities WHERE level = 'campaign' AND external_id = ?1").bind(ACTIVE).first<{ name: string }>();
    assert.equal(named?.name, "Rent Owners - Area Wise");
    const source = await db.prepare("SELECT meta_campaign_name FROM lead_sources WHERE id = 'src_keep'").first<{ meta_campaign_name: string }>();
    assert.equal(source?.meta_campaign_name, "Rent Owners - Area Wise");
    const audit = await listAudit(db, { entityType: "integration", entityId: "meta" });
    const entry = audit.find((item) => item.action === "import_campaign_spend");
    assert.equal(entry?.context.ad_account_id, ACCOUNT);
    assert.equal(entry?.context.since, "2026-11-01");
    const coverage = await db
      .prepare("SELECT ad_account_id, covered_since, covered_until FROM ad_spend_coverage")
      .all<{ ad_account_id: string; covered_since: string; covered_until: string }>();
    assert.equal(coverage.results.length, 1);
    assert.equal(coverage.results[0]?.ad_account_id, ACCOUNT);
    assert.equal(coverage.results[0]?.covered_since, "2026-11-01");
    assert.equal(coverage.results[0]?.covered_until, "2026-11-12");
    assert.equal(JSON.stringify(entry?.context).includes(USER_TOKEN), false);
    assert.equal(JSON.stringify(entry?.context).includes(PAGE_TOKEN), false);
  });

  it("does not write spend or zero rows when Insights pagination stops", async () => {
    const { db, meta, graph } = await connect();
    meta.insightFailAt = 1;
    await assert.rejects(importCampaignSpend(db, actor, config.tokenKey, graph, NOW), /Nothing was stored/);
    assert.equal((await spendRows(db)).length, 0);
    const entities = await db.prepare("SELECT COUNT(*) AS n FROM ad_entities").first<{ n: number }>();
    assert.equal(entities?.n, 0);
    const coverage = await db.prepare("SELECT COUNT(*) AS n FROM ad_spend_coverage").first<{ n: number }>();
    assert.equal(coverage?.n, 0);
    assert.equal((await getConnection(db)).status, "connected");
    assert.equal((await getConnection(db)).lastError, "");

    const dropped = await connect();
    dropped.meta.insightDropCursor = true;
    await assert.rejects(importCampaignSpend(dropped.db, actor, config.tokenKey, dropped.graph, NOW), /Nothing was stored/);
    assert.equal((await spendRows(dropped.db)).length, 0);
  });

  it("refuses a non-INR account and does not store those amounts as rupees", async () => {
    const { db, meta, graph } = await connect();
    meta.adAccounts = [{ id: ACCOUNT, name: "GulbargaHomes", currency: "USD" }];
    await assert.rejects(importCampaignSpend(db, actor, config.tokenKey, graph, NOW), /not INR/);
    assert.equal((await spendRows(db)).length, 0);
    assert.equal((await getConnection(db)).adAccountId, "");
    assert.equal((await getConnection(db)).status, "connected");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
  });

  it("asks for a choice when several accounts are visible, and saves only an INR account", async () => {
    const { db, meta, graph } = await connect();
    meta.adAccounts = [
      { id: ACCOUNT, name: "GulbargaHomes", currency: "INR" },
      { id: "act_9990000000001", name: "Other", currency: "USD" },
    ];
    await assert.rejects(importCampaignSpend(db, actor, config.tokenKey, graph, NOW), /Choose the ad account/);
    assert.equal((await spendRows(db)).length, 0);
    await assert.rejects(selectMarketingAccount(db, actor, config.tokenKey, graph, "act_9990000000001", NOW), /not INR/);
    assert.equal((await getConnection(db)).adAccountId, "");
    await selectMarketingAccount(db, actor, config.tokenKey, graph, ACCOUNT, NOW);
    assert.equal((await getConnection(db)).adAccountId, ACCOUNT);
    const callsBefore = meta.requests.length;
    await importCampaignSpend(db, actor, config.tokenKey, graph, NOW);
    const called = meta.requests.slice(callsBefore).map((request) => request.url);
    assert.ok(called.some((url) => url.includes(`/${ACCOUNT}/insights`)));
    assert.equal(called.some((url) => url.includes("/act_9990000000001/")), false);
  });

  it("keeps the Page connected when Meta rejects the user token", async () => {
    const { db, meta, graph } = await connect();
    meta.invalidUserToken = true;
    await assert.rejects(importCampaignSpend(db, actor, config.tokenKey, graph, NOW), /user token/);
    const connection = await getConnection(db);
    assert.equal(connection.status, "connected");
    assert.match(connection.userTokenError, /user token/);
    assert.equal(connection.lastError, "");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
    assert.equal((await spendRows(db)).length, 0);
  });

  it("stores every day of the window when the earliest submission is more than 120 days ago", async () => {
    const { db, meta, graph } = await connect();
    await db
      .prepare(
        `INSERT INTO lead_sources (id, channel, meta_lead_id, meta_campaign_id, meta_campaign_name, submitted_at, created_at, created_by)
         VALUES ('src_old', 'meta_lead_form', 'lead-old', ?1, 'Rent Owners - Area Wise', '2026-03-01T00:00:00.000Z', ?2, 'x')`,
      )
      .bind(ACTIVE, NOW)
      .run();
    meta.adCampaigns = [{ id: ACTIVE, name: "Rent Owners - Area Wise", effective_status: "ACTIVE" }];
    meta.insights = [];
    const result = await importCampaignSpend(db, actor, config.tokenKey, graph, NOW);
    const expected: string[] = [];
    let cursor = "2026-08-14";
    while (cursor <= "2026-11-12") {
      expected.push(cursor);
      cursor = addCalendarDays(cursor, 1);
    }
    const submissionSpan = eachDate("2026-03-01", "2026-11-12").length;
    assert.ok(submissionSpan > 120);
    assert.equal(result.since, "2026-08-14");
    assert.equal(result.until, "2026-11-12");
    assert.equal(result.spendRows, expected.length);
    assert.ok(expected.length < 120);
    const rows = await spendRows(db);
    assert.deepEqual(
      rows.map((row) => row.spend_date),
      expected,
    );
    assert.equal(rows.every((row) => row.external_id === ACTIVE && row.currency === "INR" && row.spend_minor === 0), true);
    assert.equal(meta.requests.some((request) => request.url.includes("/insights")), true);
    assert.equal((await getConnection(db)).status, "connected");
    const coverage = await db
      .prepare("SELECT covered_since, covered_until FROM ad_spend_coverage")
      .first<{ covered_since: string; covered_until: string }>();
    assert.equal(coverage?.covered_since, "2026-08-14");
    assert.equal(coverage?.covered_until, "2026-11-12");

    const { campaignQuality, parseQualityQuery } = await import("../lib/crm/quality");
    const wide = await campaignQuality(db, parseQualityQuery({ from: "2026-05-12", to: "2026-11-12" }));
    assert.equal(wide.summary.spendLabel, "Incomplete");
    assert.equal(wide.groups.every((group) => group.spendLabel === "Incomplete" && group.spendMinor === null), true);
    const inside = await campaignQuality(db, parseQualityQuery({ from: "2026-08-14", to: "2026-11-12" }));
    assert.equal(inside.summary.spendLabel, "₹0");
    assert.equal(inside.groups.every((group) => group.spendMinor === 0), true);
  });

  it("marks a blank From and a blank To Incomplete after a successful import", async () => {
    const { db, graph } = await connect();
    await db
      .prepare(
        `INSERT INTO lead_sources (id, channel, meta_lead_id, meta_campaign_id, meta_campaign_name, submitted_at, created_at, created_by)
         VALUES ('src_blank', 'meta_lead_form', 'lead-blank', ?1, 'Rent Owners - Area Wise', '2026-11-01T00:00:00.000Z', ?2, 'x')`,
      )
      .bind(ACTIVE, NOW)
      .run();
    const imported = await importCampaignSpend(db, actor, config.tokenKey, graph, NOW);
    assert.equal(imported.since, "2026-11-01");
    assert.equal(imported.until, "2026-11-12");

    const openQuery = parseQualityQuery({});
    assert.equal(openQuery.from, null);
    assert.equal(openQuery.to, null);
    const bothBlank = await campaignQuality(db, openQuery);
    assert.equal(bothBlank.summary.spendLabel, "Incomplete");
    assert.equal(bothBlank.summary.costPerLead, "N/A");
    assert.equal(bothBlank.groups.every((group) => group.spendLabel === "Incomplete" && group.spendMinor === null), true);

    const fromBlankQuery = parseQualityQuery({ to: "2026-11-12" });
    assert.equal(fromBlankQuery.from, null);
    assert.equal(fromBlankQuery.to, "2026-11-12");
    const fromBlank = await campaignQuality(db, fromBlankQuery);
    assert.equal(fromBlank.summary.spendLabel, "Incomplete");
    assert.equal(fromBlank.groups.every((group) => group.spendMinor === null), true);

    const toBlankQuery = parseQualityQuery({ from: "2026-11-01" });
    assert.equal(toBlankQuery.from, "2026-11-01");
    assert.equal(toBlankQuery.to, null);
    const toBlank = await campaignQuality(db, toBlankQuery);
    assert.equal(toBlank.summary.spendLabel, "Incomplete");
    assert.equal(toBlank.groups.every((group) => group.spendMinor === null), true);

    const inside = await campaignQuality(db, parseQualityQuery({ from: "2026-11-01", to: "2026-11-12" }));
    assert.equal(inside.summary.spendLabel, formatInr(10.5));
    assert.notEqual(bothBlank.summary.spendLabel, inside.summary.spendLabel);
    assert.notEqual(fromBlank.summary.spendLabel, inside.summary.spendLabel);
    assert.notEqual(toBlank.summary.spendLabel, inside.summary.spendLabel);
  });

  it("does not call the Marketing API when the user token lacks ads_read, even if the Page token list has it", async () => {
    const { db, meta, graph } = await connect({ userScopes: PAGE_SCOPES });
    await db
      .prepare("UPDATE meta_connection SET scopes_json = ?1")
      .bind(JSON.stringify(USER_SCOPES))
      .run();
    await assert.rejects(importCampaignSpend(db, actor, config.tokenKey, graph, NOW), /ads_read/);
    assert.equal(meta.requests.some((request) => request.url.includes("/insights")), false);
    assert.equal((await getConnection(db)).status, "connected");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
  });
});
