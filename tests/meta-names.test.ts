import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { HttpError } from "../lib/admin/errors";
import { createOwnerLead, getOwnerLead } from "../lib/crm/owner-leads";
import { getSource, parseSourceInput } from "../lib/crm/sources";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig, requestedScopes } from "../lib/meta/config";
import { MARKETING_TOKEN_EXPIRED, MARKETING_TOKEN_INVALID, MARKETING_TOKEN_MISSING, getConnection, readPageToken, readUserToken, storePageConnection, storeUserToken } from "../lib/meta/connection";
import { decryptToken } from "../lib/meta/crypto";
import { createGraphClient } from "../lib/meta/graph";
import { enqueueLead, processIngestion } from "../lib/meta/ingest";
import { syncCampaignNames } from "../lib/meta/names";
import { selectPage } from "../lib/meta/setup";
import { FakeMeta, PAGE_ID, PAGE_TOKEN, USER_TOKEN } from "./helpers/fake-meta";
import { createTestDb } from "./helpers/sqlite";

const ENV = {
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
  META_TOKEN_KEY: "k".repeat(48),
};
const { config } = readMetaConfig(ENV, "https://gulbargahomes.com");
const actor = { id: "adm_super", email: "owner@example.com", role: "super_admin" };
const NOW = "2026-11-11T18:00:00.000Z";
const CAMPAIGN = "120257043784730091";
const ADSET = "120257043784740091";
const AD = "120257043784750091";
const OTHER = "120257536957600091";
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval", "ads_read"];

async function connect(scopes = SCOPES, options: { userToken?: boolean; userExpiresAt?: string | null } = {}) {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  const meta = new FakeMeta();
  if (options.userToken !== false) {
    await storeUserToken(db, actor, {
      tokenKey: config.tokenKey,
      token: USER_TOKEN,
      expiresAt: options.userExpiresAt === undefined ? "2027-01-01T00:00:00.000Z" : options.userExpiresAt,
      userName: "Hubli Homes",
      scopes,
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
    scopes,
    webhookSubscribed: true,
    now: NOW,
  });
  return { db, meta, graph: createGraphClient(config, meta.fetch) };
}

function ownerInput() {
  return {
    intent: "Rent" as const,
    propertyType: "House" as const,
    locality: "Sedam Road",
    locationText: "",
    expectedPrice: 14000,
    notes: "Keep this note",
    priority: "Warm" as const,
  };
}

async function historicalLead(
  db: Awaited<ReturnType<typeof connect>>["db"],
  ids: { campaign?: string; adset?: string; ad?: string; campaignName?: string; phone?: string; leadId?: string } = {},
) {
  const lead = await createOwnerLead(
    db,
    actor,
    { name: "Historical Owner", phone: ids.phone ?? "9845011111" },
    ownerInput(),
    parseSourceInput({
      channel: "meta_lead_form",
      metaLeadId: ids.leadId ?? "910000000000001",
      metaFormId: "2023485355008623",
      metaFormName: "Gulbarga Property Owner",
      metaCampaignId: ids.campaign ?? CAMPAIGN,
      metaCampaignName: ids.campaignName ?? "",
      metaAdsetId: ids.adset ?? ADSET,
      metaAdsetName: "",
      metaAdId: ids.ad ?? AD,
      metaAdName: "",
      submittedAt: NOW,
    }),
    NOW,
  );
  const payload = JSON.stringify({ meta: { leadgen_id: ids.leadId ?? "910000000000001", campaign_id: ids.campaign ?? CAMPAIGN } });
  await db.prepare("UPDATE lead_sources SET raw_payload_json = ?1, ingestion_origin = 'historical_import' WHERE id = ?2").bind(payload, lead.sourceId).run();
  await db
    .prepare(
      `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
       VALUES ('meta', 'campaign', ?1, ?2, '', ?3, ?3)
       ON CONFLICT(platform, level, external_id) DO NOTHING`,
    )
    .bind(ids.campaign ?? CAMPAIGN, ids.campaignName ?? "", NOW)
    .run();
  return lead;
}

describe("campaign name sync", () => {
  it("does not request ads_management", () => {
    assert.ok(!requestedScopes().includes("ads_management"));
    assert.ok(!requestedScopes(["ads_read"]).includes("ads_management"));
  });

  it("backfills blank names on existing leads and entities without touching the CRM record", async () => {
    const { db, meta, graph } = await connect();
    const lead = await historicalLead(db);
    const before = await getSource(db, lead.sourceId);
    meta.objects = [
      { id: CAMPAIGN, name: "Owner campaign Gulbarga" },
      { id: ADSET, name: "Sedam Road" },
      { id: AD, name: "House owners" },
    ];

    const result = await syncCampaignNames(db, actor, config.tokenKey, graph, NOW);
    const source = await getSource(db, lead.sourceId);
    const owner = await getOwnerLead(db, lead.id);
    const entity = await db.prepare("SELECT name FROM ad_entities WHERE level = 'campaign' AND external_id = ?1").bind(CAMPAIGN).first<{ name: string }>();

    assert.equal(result.namesFound, 3);
    assert.equal(result.sourcesUpdated, 3);
    assert.equal(source?.metaCampaignName, "Owner campaign Gulbarga");
    assert.equal(source?.metaAdsetName, "Sedam Road");
    assert.equal(source?.metaAdName, "House owners");
    assert.equal(entity?.name, "Owner campaign Gulbarga");
    assert.equal(source?.metaLeadId, before?.metaLeadId);
    assert.equal(source?.metaFormId, before?.metaFormId);
    assert.equal(source?.metaCampaignId, before?.metaCampaignId);
    assert.equal(source?.metaAdsetId, before?.metaAdsetId);
    assert.equal(source?.metaAdId, before?.metaAdId);
    assert.deepEqual(source?.rawPayload, before?.rawPayload);
    assert.equal(source?.ingestionOrigin, "historical_import");
    assert.equal(owner?.status, "New");
    assert.equal(owner?.notes, "Keep this note");
    assert.equal(meta.requests.some((request) => request.url.includes("ads_management")), false);
    const nameReads = meta.requests.filter((request) => request.url.includes("fields=id%2Cname") || request.url.includes("fields=id,name"));
    assert.ok(nameReads.length > 0);
    assert.ok(nameReads.every((request) => request.authorization.endsWith(USER_TOKEN)));
    assert.equal(await readUserToken(db, config.tokenKey, NOW), USER_TOKEN);
    const audit = await listAudit(db, { entityType: "integration", entityId: "meta" });
    assert.ok(audit.some((entry) => entry.action === "sync_campaign_names"));
  });

  it("keeps a stored name when Meta returns an empty name", async () => {
    const { db, meta, graph } = await connect();
    const lead = await historicalLead(db, { campaignName: "Already named" });
    meta.objects = [
      { id: CAMPAIGN, name: "" },
      { id: ADSET, name: "Sedam Road" },
      { id: AD, name: "House owners" },
    ];

    const result = await syncCampaignNames(db, actor, config.tokenKey, graph, NOW);
    const source = await getSource(db, lead.sourceId);
    const entity = await db.prepare("SELECT name FROM ad_entities WHERE level = 'campaign' AND external_id = ?1").bind(CAMPAIGN).first<{ name: string }>();
    assert.equal(result.keptExisting, 1);
    assert.equal(source?.metaCampaignName, "Already named");
    assert.equal(entity?.name, "Already named");
    assert.equal(source?.metaAdsetName, "Sedam Road");
  });

  it("applies a partial response and can be retried without duplicating updates", async () => {
    const { db, meta, graph } = await connect();
    const first = await historicalLead(db);
    const second = await historicalLead(db, {
      campaign: OTHER,
      adset: "",
      ad: "",
      phone: "9845022222",
      leadId: "910000000000002",
    });
    meta.objects = [
      { id: CAMPAIGN, name: "Owner campaign Gulbarga" },
      { id: ADSET, name: "" },
      { id: OTHER, name: "Rental owners Gulbarga" },
    ];

    const partial = await syncCampaignNames(db, actor, config.tokenKey, graph, NOW);
    assert.equal(partial.incomplete, true);
    assert.equal(partial.unresolved, 1);
    assert.equal(partial.emptyResponses, 1);
    assert.equal((await getSource(db, first.sourceId))?.metaCampaignName, "Owner campaign Gulbarga");
    assert.equal((await getSource(db, first.sourceId))?.metaAdsetName, "");
    assert.equal((await getSource(db, first.sourceId))?.metaAdName, "");
    assert.equal((await getSource(db, second.sourceId))?.metaCampaignName, "Rental owners Gulbarga");

    meta.objects = [
      ...meta.objects.filter((item) => item.id !== ADSET),
      { id: ADSET, name: "Sedam Road" },
      { id: AD, name: "House owners" },
    ];
    const again = await syncCampaignNames(db, actor, config.tokenKey, graph, "2026-11-11T18:05:00.000Z");
    assert.equal((await getSource(db, first.sourceId))?.metaCampaignName, "Owner campaign Gulbarga");
    assert.equal((await getSource(db, first.sourceId))?.metaAdsetName, "Sedam Road");
    assert.equal((await getSource(db, first.sourceId))?.metaAdName, "House owners");
    assert.equal(again.sourcesUpdated, 2);
    const third = await syncCampaignNames(db, actor, config.tokenKey, graph, "2026-11-11T18:06:00.000Z");
    assert.equal(third.sourcesUpdated, 0);
    assert.equal(third.entitiesUpdated, 0);
    const audits = (await listAudit(db, { entityType: "integration", entityId: "meta" })).filter((entry) => entry.action === "sync_campaign_names");
    assert.equal(audits.length, 3);
  });

  it("keeps names saved before a rate limit and finishes them on retry", async () => {
    const { db, meta, graph } = await connect();
    const first = await historicalLead(db, { adset: "", ad: "" });
    const second = await historicalLead(db, { campaign: OTHER, adset: "", ad: "", phone: "9845033333", leadId: "910000000000003" });
    meta.objects = [
      { id: CAMPAIGN, name: "First campaign" },
      { id: OTHER, name: "Second campaign" },
    ];
    meta.rateLimitIds.add(OTHER);

    const stopped = await syncCampaignNames(db, actor, config.tokenKey, graph, NOW);
    assert.equal(stopped.incomplete, true);
    assert.equal((await getSource(db, first.sourceId))?.metaCampaignName, "First campaign");
    assert.equal((await getSource(db, second.sourceId))?.metaCampaignName, "");

    meta.rateLimitIds.clear();
    const finished = await syncCampaignNames(db, actor, config.tokenKey, graph, "2026-11-11T18:07:00.000Z");
    assert.equal(finished.sourcesUpdated, 1);
    assert.equal((await getSource(db, first.sourceId))?.metaCampaignName, "First campaign");
    assert.equal((await getSource(db, second.sourceId))?.metaCampaignName, "Second campaign");
  });

  it("refuses to sync without ads_read and does not call the Marketing API", async () => {
    const { db, meta, graph } = await connect(SCOPES.filter((scope) => scope !== "ads_read"));
    const lead = await historicalLead(db);
    meta.objects = [{ id: CAMPAIGN, name: "Should not be fetched" }];
    await assert.rejects(syncCampaignNames(db, actor, config.tokenKey, graph, NOW), (error: unknown) => {
      return (
        error instanceof HttpError &&
        error.status === 400 &&
        /ads_read/.test(error.message) &&
        /does not use ads_management/.test(error.message)
      );
    });
    assert.equal(meta.requests.some((request) => request.url.includes("fields=id")), false);
    assert.equal((await getSource(db, lead.sourceId))?.metaCampaignName, "");
    assert.equal((await getConnection(db)).status, "connected");
  });

  it("leaves the Page connection in place when Meta refuses campaign metadata", async () => {
    const { db, meta, graph } = await connect();
    const lead = await historicalLead(db, { campaignName: "Keep me" });
    meta.objects = [{ id: CAMPAIGN, name: "Replacement" }];
    meta.refuseMarketingRead = true;
    await assert.rejects(syncCampaignNames(db, actor, config.tokenKey, graph, NOW), /ads_read/);
    assert.equal((await getConnection(db)).status, "connected");
    assert.equal((await getSource(db, lead.sourceId))?.metaCampaignName, "Keep me");
    const audit = await listAudit(db, { entityType: "integration", entityId: "meta" });
    assert.ok(audit.some((entry) => entry.action === "sync_campaign_names"));
  });

  it("does not call the Marketing API when the user token was not kept", async () => {
    const { db, meta, graph } = await connect(SCOPES, { userToken: false });
    await historicalLead(db);
    await assert.rejects(syncCampaignNames(db, actor, config.tokenKey, graph, NOW), (error: unknown) => {
      return error instanceof HttpError && error.status === 400 && error.message === MARKETING_TOKEN_MISSING;
    });
    assert.equal(meta.requests.length, 0);
    assert.equal((await getConnection(db)).status, "connected");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
  });

  it("does not call the Marketing API when the user token has expired", async () => {
    const { db, meta, graph } = await connect(SCOPES, { userExpiresAt: "2026-11-01T00:00:00.000Z" });
    await historicalLead(db);
    await assert.rejects(syncCampaignNames(db, actor, config.tokenKey, graph, NOW), (error: unknown) => {
      return error instanceof HttpError && error.status === 401 && error.message === MARKETING_TOKEN_EXPIRED;
    });
    assert.equal(meta.requests.length, 0);
    const connection = await getConnection(db);
    assert.equal(connection.status, "connected");
    assert.equal(connection.userTokenError, "");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
  });

  it("keeps the Page token connected when Meta rejects the user token, and still ingests a lead", async () => {
    const { db, meta, graph } = await connect();
    await historicalLead(db);
    meta.objects = [{ id: CAMPAIGN, name: "Should stay unread" }];
    meta.invalidUserToken = true;
    await assert.rejects(syncCampaignNames(db, actor, config.tokenKey, graph, NOW), (error: unknown) => {
      return error instanceof HttpError && error.status === 401 && error.message === MARKETING_TOKEN_INVALID;
    });
    const connection = await getConnection(db);
    assert.equal(connection.status, "connected");
    assert.match(connection.userTokenError, /user token/);
    assert.equal(connection.lastError, "");
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
    assert.equal(await readUserToken(db, config.tokenKey, NOW), null);
    assert.ok(meta.requests.every((request) => !request.authorization.endsWith(PAGE_TOKEN)));

    meta.forms = [{ id: "2023485355008623", name: "Gulbarga Property Owner", questions: [] }];
    meta.leads.push({
      id: "910000000000099",
      form_id: "2023485355008623",
      created_time: "2026-11-11T12:00:00+0000",
      field_data: [{ name: "full_name", values: ["New owner"] }, { name: "phone_number", values: ["9845022222"] }],
    });
    const queued = await enqueueLead(db, { leadgenId: "910000000000099", pageId: PAGE_ID, formId: "2023485355008623", origin: "webhook" }, NOW);
    const outcome = await processIngestion(
      { db, graph, tokenKey: config.tokenKey, pageId: PAGE_ID, adNames: true, now: () => new Date(NOW) },
      queued.id,
    );
    assert.equal(outcome, "needs_mapping");
    const leadFetch = meta.requests.find((request) => request.url.includes("/910000000000099"));
    assert.ok(leadFetch?.authorization.endsWith(PAGE_TOKEN));
  });

  it("refreshes both tokens on reconnect without subscribing the Page twice or reopening a finished lead", async () => {
    const db = createTestDb();
    await prepareDatabase(db, () => [], NOW);
    const meta = new FakeMeta();
    meta.forms = [{ id: "2023485355008623", name: "Gulbarga Property Owner", questions: [] }];
    const graph = createGraphClient(config, meta.fetch);
    await storeUserToken(db, actor, {
      tokenKey: config.tokenKey,
      token: USER_TOKEN,
      expiresAt: "2027-01-01T00:00:00.000Z",
      userName: "Hubli Homes",
      scopes: SCOPES,
      now: NOW,
    });
    await selectPage(db, actor, config, graph, PAGE_ID, NOW);
    assert.equal(meta.calls.filter((call) => call === `POST /${PAGE_ID}/subscribed_apps`).length, 1);
    await db
      .prepare(
        `INSERT INTO meta_lead_ingestions (id, leadgen_id, page_id, form_id, origin, status, next_attempt_at, received_at, updated_at)
         VALUES ('mli_done', '910000000000088', ?1, '2023485355008623', 'webhook', 'done', ?2, ?2, ?2)`,
      )
      .bind(PAGE_ID, NOW)
      .run();

    await db.prepare("UPDATE meta_connection SET user_token_error = 'Meta rejected the Facebook user token: old'").run();
    await storeUserToken(db, actor, {
      tokenKey: config.tokenKey,
      token: USER_TOKEN,
      expiresAt: "2027-06-01T00:00:00.000Z",
      userName: "Hubli Homes",
      scopes: SCOPES,
      now: "2026-11-12T00:00:00.000Z",
    });
    await selectPage(db, actor, config, graph, PAGE_ID, "2026-11-12T00:00:00.000Z");

    assert.equal(meta.calls.filter((call) => call === `POST /${PAGE_ID}/subscribed_apps`).length, 1);
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);
    assert.equal(await decryptToken(config.tokenKey, (await db.prepare("SELECT user_token_enc FROM meta_connection").first<{ user_token_enc: string }>())!.user_token_enc, "meta_connection.user_token"), USER_TOKEN);
    const connection = await getConnection(db);
    assert.equal(connection.status, "connected");
    assert.deepEqual(connection.userTokenScopes, SCOPES);
    assert.equal(connection.userTokenError, "");
    assert.equal(connection.userTokenExpiresAt, "2027-06-01T00:00:00.000Z");
    assert.equal(connection.pageTokenExpiresAt, null);
    assert.equal(connection.awaitingPageChoice, false);
    const view = JSON.stringify(connection);
    assert.equal(view.includes(USER_TOKEN), false);
    assert.equal(view.includes(PAGE_TOKEN), false);
    const done = await db.prepare("SELECT status FROM meta_lead_ingestions WHERE id = 'mli_done'").first<{ status: string }>();
    assert.equal(done?.status, "done");
  });

  it("checks ads_read on the user token when the Page token permission list differs", async () => {
    const pageScopes = SCOPES.filter((scope) => scope !== "ads_read");
    const db = createTestDb();
    await prepareDatabase(db, () => [], NOW);
    const meta = new FakeMeta();
    meta.pageScopes = pageScopes;
    const graph = createGraphClient(config, meta.fetch);
    await storeUserToken(db, actor, {
      tokenKey: config.tokenKey,
      token: USER_TOKEN,
      expiresAt: "2027-01-01T00:00:00.000Z",
      userName: "Hubli Homes",
      scopes: SCOPES,
      now: NOW,
    });
    await selectPage(db, actor, config, graph, PAGE_ID, NOW);
    await historicalLead(db);
    meta.objects = [
      { id: CAMPAIGN, name: "Rent Owners - Area Wise" },
      { id: ADSET, name: "Area wise | Ad set" },
      { id: AD, name: "AreaWise | Ad" },
    ];

    const result = await syncCampaignNames(db, actor, config.tokenKey, graph, NOW);
    const saved = await getConnection(db);
    assert.equal(result.namesFound, 3);
    assert.equal(saved.scopes.includes("ads_read"), false);
    assert.equal(saved.userTokenScopes.includes("ads_read"), true);
    const nameReads = meta.requests.filter((request) => [CAMPAIGN, ADSET, AD].some((id) => request.url.includes(`/${id}`)));
    assert.equal(nameReads.length, 3);
    assert.ok(nameReads.every((request) => request.authorization.endsWith(USER_TOKEN)));
    assert.equal(await readPageToken(db, config.tokenKey), PAGE_TOKEN);

    const other = createTestDb();
    await prepareDatabase(other, () => [], NOW);
    const otherMeta = new FakeMeta();
    otherMeta.pageScopes = SCOPES;
    const otherGraph = createGraphClient(config, otherMeta.fetch);
    await storeUserToken(other, actor, {
      tokenKey: config.tokenKey,
      token: USER_TOKEN,
      expiresAt: "2027-01-01T00:00:00.000Z",
      userName: "Hubli Homes",
      scopes: pageScopes,
      now: NOW,
    });
    await selectPage(other, actor, config, otherGraph, PAGE_ID, NOW);
    const callsBeforeSync = otherMeta.requests.length;
    await assert.rejects(syncCampaignNames(other, actor, config.tokenKey, otherGraph, NOW), (error: unknown) => {
      return error instanceof HttpError && error.status === 400 && error.message.includes("ads_read");
    });
    const refused = await getConnection(other);
    assert.equal(refused.status, "connected");
    assert.equal(refused.scopes.includes("ads_read"), true);
    assert.equal(refused.userTokenScopes.includes("ads_read"), false);
    assert.equal(otherMeta.requests.slice(callsBeforeSync).some((request) => request.url.includes("fields=id")), false);
    assert.equal(await readPageToken(other, config.tokenKey), PAGE_TOKEN);
  });
});
