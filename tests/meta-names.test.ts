import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { HttpError } from "../lib/admin/errors";
import { createOwnerLead, getOwnerLead } from "../lib/crm/owner-leads";
import { getSource, parseSourceInput } from "../lib/crm/sources";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig, requestedScopes } from "../lib/meta/config";
import { getConnection, storePageConnection } from "../lib/meta/connection";
import { createGraphClient } from "../lib/meta/graph";
import { syncCampaignNames } from "../lib/meta/names";
import { FakeMeta, PAGE_ID, PAGE_TOKEN } from "./helpers/fake-meta";
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

async function connect(scopes = SCOPES) {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  const meta = new FakeMeta();
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
    assert.ok(meta.requests.some((request) => request.url.includes("fields=id%2Cname") || request.url.includes("fields=id,name")));
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
});
