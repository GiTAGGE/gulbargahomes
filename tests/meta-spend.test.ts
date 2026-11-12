import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { HttpError } from "../lib/admin/errors";
import { can } from "../lib/admin/permissions";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig } from "../lib/meta/config";
import {
  getConnection,
  readPageToken,
  storePageConnection,
  storeUserToken,
} from "../lib/meta/connection";
import { createGraphClient } from "../lib/meta/graph";
import { importCampaignSpend, selectMarketingAccount, spendWindow } from "../lib/meta/spend";
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
