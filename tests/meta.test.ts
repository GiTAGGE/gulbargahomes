import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findContactByPhone, getContact } from "../lib/crm/contacts";
import { getOwnerLead } from "../lib/crm/owner-leads";
import { getRequirement, matchableBudget } from "../lib/crm/requirements";
import { getSource } from "../lib/crm/sources";
import { prepareDatabase } from "../lib/db/prepare";
import { readMetaConfig, REQUIRED_SCOPES, requestedScopes } from "../lib/meta/config";
import { getConnection, readPageToken, storePageConnection } from "../lib/meta/connection";
import { decryptToken, encryptToken, hmacSha256Hex, sweepToken } from "../lib/meta/crypto";
import { getStoredForm, parseFormSettings, updateFormSettings, upsertDiscoveredForms } from "../lib/meta/forms";
import { classifyMetaError, createGraphClient } from "../lib/meta/graph";
import { createImportJob, getImportJob, parseImportInput, reconcileRecentLeads, runImportStep, runSweep } from "../lib/meta/imports";
import {
  dismissIngestions,
  enqueueLead,
  processDue,
  processIngestion,
  purgeExpiredQueueData,
  resolveIngestionIntent,
  type MetaRuntime,
} from "../lib/meta/ingest";
import { alignBudgetTargets, mapLead, suggestMapping, suggestOwnerIntent, type FormClassification } from "../lib/meta/mapping";
import { getIngestionDetail, ingestionStats } from "../lib/meta/overview";
import { selectPage, testConnection } from "../lib/meta/setup";
import { parseBhk, parseDemandIntent, parseMoney, parseOwnerIntent, parseTimeline, splitLocalities } from "../lib/meta/values";
import { receiveWebhook, verifySubscription } from "../lib/meta/webhook";
import {
  attribution,
  BUYER_FORM,
  FakeMeta,
  leadId,
  OWNER_FORM,
  PAGE_ID,
  PAGE_TOKEN,
  TENANT_FORM,
  USER_TOKEN,
  type FakeForm,
} from "./helpers/fake-meta";
import { createTestDb } from "./helpers/sqlite";

const ENV = {
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_WEBHOOK_VERIFY_TOKEN: "verify-me",
  META_TOKEN_KEY: "k".repeat(48),
};
const { config } = readMetaConfig(ENV, "https://gulbargahomes.com");
const admin = { id: "adm_super", email: "owner@example.com", role: "super_admin" };

class Clock {
  constructor(public current = new Date("2026-11-10T10:00:00.000Z")) {}
  now = () => this.current;
  iso = () => this.current.toISOString();
  advance(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

async function setup(options: { classify?: Partial<Record<string, FormClassification>>; connect?: boolean } = {}) {
  const db = createTestDb();
  await prepareDatabase(db, () => [], "2026-11-10T00:00:00.000Z");
  const meta = new FakeMeta();
  meta.forms = [OWNER_FORM, TENANT_FORM, BUYER_FORM];
  const clock = new Clock();
  const graph = createGraphClient(config, meta.fetch);
  if (options.connect !== false) {
    await storePageConnection(db, admin, {
      tokenKey: config.tokenKey,
      pageId: PAGE_ID,
      pageName: "GulbargaHomes",
      pageToken: PAGE_TOKEN,
      pageTokenExpiresAt: null,
      dataAccessExpiresAt: null,
      scopes: meta.scopes,
      webhookSubscribed: true,
      now: clock.iso(),
    });
    await upsertDiscoveredForms(db, admin.id, PAGE_ID, await graph.listForms(PAGE_ID, PAGE_TOKEN), clock.iso());
  }
  const classify = options.classify ?? { [OWNER_FORM.id]: "owner", [TENANT_FORM.id]: "tenant", [BUYER_FORM.id]: "buyer" };
  for (const [formId, classification] of Object.entries(classify)) {
    const form = (await getStoredForm(db, formId))!;
    await updateFormSettings(db, admin, form, parseFormSettings({ classification }, form), { now: clock.iso() });
  }
  const runtime: MetaRuntime = { db, graph, tokenKey: config.tokenKey, pageId: PAGE_ID, adNames: meta.scopes.includes("ads_read"), now: clock.now };
  return { db, meta, clock, graph, runtime };
}

function addLead(meta: FakeMeta, form: FakeForm, answers: Record<string, string>, extra: Partial<{ created_time: string; campaign: string }> = {}) {
  const lead = {
    id: leadId(),
    form_id: form.id,
    created_time: extra.created_time ?? "2026-11-10T09:30:00+0000",
    ...attribution(extra.campaign),
    field_data: Object.entries(answers).map(([name, value]) => ({ name, values: [value] })),
  };
  meta.leads.push(lead);
  return lead;
}

function webhookBody(lead: { id: string; form_id: string }) {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        id: PAGE_ID,
        time: 1_794_300_000,
        changes: [
          { field: "leadgen", value: { leadgen_id: lead.id, form_id: lead.form_id, page_id: PAGE_ID, ad_id: "601", created_time: 1_794_299_400 } },
        ],
      },
    ],
  });
}

async function deliver(ctx: Awaited<ReturnType<typeof setup>>, body: string, secret = ENV.META_APP_SECRET) {
  const signature = `sha256=${await hmacSha256Hex(secret, body)}`;
  const result = await receiveWebhook(ctx.db, config, { rawBody: body, signature, now: ctx.clock.iso() });
  if (result.status === 200 && result.ids.length) await processDue(ctx.runtime, { ids: result.ids });
  return result;
}

async function ingestion(db: ReturnType<typeof createTestDb>, leadgenId: string) {
  return db
    .prepare("SELECT * FROM meta_lead_ingestions WHERE leadgen_id = ?1")
    .bind(leadgenId)
    .first<{
      id: string;
      status: string;
      attempts: number;
      deliveries: number;
      next_attempt_at: string;
      entity_type: string;
      entity_id: string;
      last_error: string;
      last_error_kind: string;
      payload_json: string;
      contact_existing: number;
      intent_override: string;
      resolved_by: string;
      resolved_at: string | null;
    }>();
}

const OWNER_ANSWERS = {
  full_name: "Ravi Patil",
  phone_number: "+919845012345",
  "do_you_want_to_rent_or_sell?": "rent_it_out",
  property_type: "Independent house",
  location_of_property: "Sedam Road",
  expected_rent_or_price: "₹14,000 per month",
};

describe("Meta webhook security", () => {
  it("answers the verification handshake only with the right token", () => {
    const params = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" });
    assert.equal(verifySubscription(config, params("verify-me")), "1158201444");
    assert.equal(verifySubscription(config, params("wrong")), null);
    assert.equal(verifySubscription({ ...config, verifyToken: "" }, params("")), null);
  });

  it("rejects invalid and missing signatures without queueing anything", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const body = webhookBody(lead);
    assert.equal((await deliver(ctx, body, "not-the-secret")).status, 401);
    assert.equal((await receiveWebhook(ctx.db, config, { rawBody: body, signature: null, now: ctx.clock.iso() })).status, 401);
    const tampered = await receiveWebhook(ctx.db, config, {
      rawBody: body.replace(lead.id, "4999999999999999"),
      signature: `sha256=${await hmacSha256Hex(ENV.META_APP_SECRET, body)}`,
      now: ctx.clock.iso(),
    });
    assert.equal(tampered.status, 401);
    const queued = await ctx.db.prepare("SELECT COUNT(*) AS n FROM meta_lead_ingestions").first<{ n: number }>();
    assert.equal(queued?.n, 0);
    const rejected = await ctx.db.prepare("SELECT COUNT(*) AS n FROM meta_webhook_deliveries WHERE signature_valid = 0").first<{ n: number }>();
    assert.equal(rejected?.n, 3);
  });

  it("refuses to accept events when the app secret is not configured", async () => {
    const ctx = await setup();
    const result = await receiveWebhook(ctx.db, { ...config, appSecret: "" }, { rawBody: "{}", signature: "sha256=00", now: ctx.clock.iso() });
    assert.equal(result.status, 503);
  });

  it("keeps tokens encrypted at rest and out of the connection view", async () => {
    const ctx = await setup();
    const stored = await ctx.db.prepare("SELECT page_token_enc FROM meta_connection").first<{ page_token_enc: string }>();
    assert.ok(stored?.page_token_enc.startsWith("v1."));
    assert.ok(!stored?.page_token_enc.includes(PAGE_TOKEN));
    assert.equal(await readPageToken(ctx.db, config.tokenKey), PAGE_TOKEN);
    assert.equal(await readPageToken(ctx.db, "x".repeat(48)), null);
    assert.equal(await decryptToken(config.tokenKey, stored!.page_token_enc, "meta_connection.user_token"), null);
    const view = JSON.stringify(await getConnection(ctx.db));
    assert.ok(!view.includes(PAGE_TOKEN) && !view.includes(stored!.page_token_enc));
    const sealed = await encryptToken("key", "secret", "purpose");
    assert.notEqual(sealed, await encryptToken("key", "secret", "purpose"));
  });

  it("never puts tokens in Graph URLs and signs them with appsecret_proof", async () => {
    const ctx = await setup();
    const seen: string[] = [];
    const graph = createGraphClient(config, async (url, init) => {
      seen.push(url);
      return ctx.meta.fetch(url, init);
    });
    await graph.getLead(addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS).id, PAGE_TOKEN);
    assert.ok(seen.every((url) => !url.includes(PAGE_TOKEN)));
    assert.ok(seen[0].includes(`appsecret_proof=${await hmacSha256Hex(ENV.META_APP_SECRET, PAGE_TOKEN)}`));
  });

  it("derives a sweep token that differs from the app secret", async () => {
    const token = await sweepToken(ENV.META_APP_SECRET);
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.notEqual(token, ENV.META_APP_SECRET);
  });
});

describe("Meta lead ingestion", () => {
  it("turns an owner enquiry into an owner lead, never a property, with full attribution", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const result = await deliver(ctx, webhookBody(lead));
    assert.equal(result.status, 200);

    const row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.status, "done");
    assert.equal(row.entity_type, "owner_lead");
    assert.equal(row.payload_json, "");
    const owner = (await getOwnerLead(ctx.db, row.entity_id))!;
    assert.equal(owner.status, "New");
    assert.equal(owner.intent, "Rent");
    assert.equal(owner.propertyType, "House");
    assert.equal(owner.locality, "Sedam Road");
    assert.equal(owner.expectedPrice, 14000);
    assert.equal(owner.createdBy, "meta_lead_ads");

    const source = (await getSource(ctx.db, owner.sourceId))!;
    assert.equal(source.metaLeadId, lead.id);
    assert.equal(source.metaFormId, OWNER_FORM.id);
    assert.equal(source.metaFormName, OWNER_FORM.name);
    assert.equal(source.metaCampaignId, "401");
    assert.equal(source.metaAdsetId, "501");
    assert.equal(source.metaAdId, "601");
    assert.equal(source.metaPageId, PAGE_ID);
    assert.equal(source.platform, "facebook");
    assert.equal(source.metaIsOrganic, false);
    assert.equal(source.ingestionOrigin, "webhook");
    assert.equal(source.submittedAt, "2026-11-10T09:30:00.000Z");
    assert.ok(Array.isArray(source.rawPayload.answers));

    const properties = await ctx.db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>();
    assert.equal(properties?.n, 0);
    const campaign = await ctx.db.prepare("SELECT name FROM ad_entities WHERE level = 'campaign' AND external_id = '401'").first<{ name: string }>();
    assert.equal(campaign?.name, "Campaign 1");
  });

  it("turns tenant and buyer forms into rental and purchase requirements, unqualified", async () => {
    const ctx = await setup();
    const tenant = addLead(ctx.meta, TENANT_FORM, {
      full_name: "Asha K",
      phone_number: "9900112233",
      email: "Asha@Example.com",
      bhk_needed: "2_bhk",
      monthly_budget: "10k - 15k",
      preferred_location: "Jewargi Road, Aland Road",
      "when_do_you_want_to_move?": "within_a_week",
      any_other_preferences: "Family, vegetarian",
    });
    const buyer = addLead(ctx.meta, BUYER_FORM, {
      full_name: "Imran S",
      phone_number: "+91 98860 11223",
      type_of_property: "Residential plot",
      budget: "40 - 60 lakh",
      preferred_area: "Ring Road",
      timeline: "2-3 months",
    });
    await deliver(ctx, webhookBody(tenant));
    await deliver(ctx, webhookBody(buyer));

    const rental = (await getRequirement(ctx.db, (await ingestion(ctx.db, tenant.id))!.entity_id))!;
    assert.equal(rental.intent, "Rent");
    assert.equal(rental.status, "New");
    assert.deepEqual([rental.bhkMin, rental.bhkMax], [2, 2]);
    assert.deepEqual([rental.budgetMin, rental.budgetMax], [10_000, 15_000]);
    assert.deepEqual(rental.localities, ["Jewargi Road", "Aland Road"]);
    assert.equal(rental.timeline, "Within 7 days");
    assert.match(rental.notes, /Any other preferences: Family, vegetarian/);
    assert.equal((await getContact(ctx.db, rental.contactId))?.email, "asha@example.com");

    const purchase = (await getRequirement(ctx.db, (await ingestion(ctx.db, buyer.id))!.entity_id))!;
    assert.equal(purchase.intent, "Buy");
    assert.equal(purchase.status, "New");
    assert.deepEqual(purchase.propertyTypes, ["Plot"]);
    assert.deepEqual([purchase.budgetMin, purchase.budgetMax], [4_000_000, 6_000_000]);
    assert.equal(purchase.timeline, "Within 3 months");
  });

  it("does not duplicate leads or contacts when Meta retries a webhook", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const body = webhookBody(lead);
    const first = await deliver(ctx, body);
    const second = await deliver(ctx, body);
    const third = await deliver(ctx, body);
    assert.equal(first.status === 200 && first.created, 1);
    assert.equal(second.status === 200 && second.repeats, 1);
    assert.equal(third.status === 200 && third.repeats, 1);

    const counts = await ctx.db
      .prepare("SELECT (SELECT COUNT(*) FROM owner_leads) AS leads, (SELECT COUNT(*) FROM contacts) AS contacts, (SELECT COUNT(*) FROM lead_sources) AS sources")
      .first<{ leads: number; contacts: number; sources: number }>();
    assert.deepEqual({ ...counts }, { leads: 1, contacts: 1, sources: 1 });
    assert.equal((await ingestion(ctx.db, lead.id))!.deliveries, 3);
    assert.equal(ctx.meta.calls.filter((call) => call === `GET /${lead.id}`).length, 1);
    const stats = await ingestionStats(ctx.db);
    assert.equal(stats.webhookRedeliveries, 2);
    assert.equal(stats.imported, 1);
  });

  it("lets only one of two parallel processors claim a lead", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const { id } = await enqueueLead(ctx.db, { leadgenId: lead.id, formId: lead.form_id, pageId: PAGE_ID, origin: "webhook" }, ctx.clock.iso());
    const outcomes = await Promise.all([processIngestion(ctx.runtime, id), processIngestion(ctx.runtime, id)]);
    assert.deepEqual(outcomes.sort(), ["done", "skipped"]);
    const leads = await ctx.db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>();
    assert.equal(leads?.n, 1);
  });

  it("marks a lead already entered by hand (same Meta lead id) as a duplicate", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    await ctx.db
      .prepare("INSERT INTO lead_sources (id, channel, meta_lead_id, submitted_at, created_at, created_by) VALUES ('src_manual', 'meta_lead_form', ?1, 't', 't', 'x')")
      .bind(lead.id)
      .run();
    await deliver(ctx, webhookBody(lead));
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "duplicate");
    const leads = await ctx.db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>();
    assert.equal(leads?.n, 0);
  });

  it("reuses the existing contact for the same mobile across forms", async () => {
    const ctx = await setup();
    const owner = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const tenant = addLead(ctx.meta, TENANT_FORM, { full_name: "Ravi P.", phone_number: "098450 12345" });
    await deliver(ctx, webhookBody(owner));
    await deliver(ctx, webhookBody(tenant));
    const contact = (await findContactByPhone(ctx.db, "9845012345"))!;
    assert.equal(contact.name, "Ravi Patil");
    assert.equal(contact.isOwner && contact.isSeeker, true);
    assert.equal((await ingestion(ctx.db, tenant.id))!.contact_existing, 1);
    const contacts = await ctx.db.prepare("SELECT COUNT(*) AS n FROM contacts").first<{ n: number }>();
    assert.equal(contacts?.n, 1);
  });

  it("holds leads without a valid mobile for review and keeps unexpected answers", async () => {
    const ctx = await setup();
    const noPhone = addLead(ctx.meta, TENANT_FORM, { full_name: "No Phone", monthly_budget: "8000" });
    const foreign = addLead(ctx.meta, TENANT_FORM, { full_name: "Abroad", phone_number: "+1 415 555 0100" });
    const extra = addLead(ctx.meta, TENANT_FORM, {
      phone_number: "9123456780",
      surprise_question: "Need it near a school",
      monthly_budget: "about fifteen thousand",
    });
    await deliver(ctx, webhookBody(noPhone));
    await deliver(ctx, webhookBody(foreign));
    await deliver(ctx, webhookBody(extra));

    const held = (await ingestion(ctx.db, noPhone.id))!;
    assert.equal(held.status, "needs_review");
    assert.match(held.last_error, /mobile/);
    assert.ok(held.payload_json.includes("No Phone"));
    assert.equal((await ingestion(ctx.db, foreign.id))!.status, "needs_review");

    const requirement = (await getRequirement(ctx.db, (await ingestion(ctx.db, extra.id))!.entity_id))!;
    assert.equal(requirement.contactName, "Meta lead");
    assert.match(requirement.notes, /Other answers:\n- surprise question: Need it near a school/);
    assert.match(requirement.notes, /Monthly rent \(as answered\): about fifteen thousand/);
    assert.equal(requirement.budgetMax, null);
    const source = (await getSource(ctx.db, requirement.sourceId))!;
    const answers = source.rawPayload.answers as { key: string; target: string }[];
    assert.deepEqual(
      answers.find((answer) => answer.key === "surprise_question"),
      { key: "surprise_question", label: "surprise question", value: "Need it near a school", target: "" },
    );
  });

  it("waits for classification, then imports once the form is mapped", async () => {
    const ctx = await setup({ classify: {} });
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    await deliver(ctx, webhookBody(lead));
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "needs_mapping");

    const form = (await getStoredForm(ctx.db, OWNER_FORM.id))!;
    const result = await updateFormSettings(ctx.db, admin, form, parseFormSettings({ classification: "owner" }, form), { now: ctx.clock.iso() });
    assert.equal(result.requeued, 1);
    await processDue(ctx.runtime);
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "done");
    assert.equal(ctx.meta.calls.filter((call) => call === `GET /${lead.id}`).length, 1);
  });

  it("discovers an unknown form from the lead and holds it for classification", async () => {
    const ctx = await setup({ connect: true, classify: {} });
    const newForm: FakeForm = { id: "900000000000009", name: "Festival offer form", questions: OWNER_FORM.questions };
    ctx.meta.forms.push(newForm);
    const lead = addLead(ctx.meta, newForm, OWNER_ANSWERS);
    await deliver(ctx, webhookBody(lead));
    assert.equal((await getStoredForm(ctx.db, newForm.id))?.name, "Festival offer form");
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "needs_mapping");
  });

  it("retries with backoff while Meta is down, then succeeds", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    ctx.meta.mode = "down";
    const result = await deliver(ctx, webhookBody(lead));
    assert.equal(result.status, 200);
    let row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.status, "retry");
    assert.equal(row.next_attempt_at, "2026-11-10T10:01:00.000Z");

    assert.deepEqual(await processDue(ctx.runtime), {});
    ctx.clock.advance(1);
    await processDue(ctx.runtime);
    row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.attempts, 2);
    assert.equal(row.next_attempt_at, "2026-11-10T10:06:00.000Z");

    ctx.meta.mode = "ok";
    ctx.clock.advance(5);
    await processDue(ctx.runtime);
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "done");
    const detail = (await getIngestionDetail(ctx.db, row.id, true))!;
    assert.deepEqual(
      detail.events.map((event) => event.outcome),
      ["queued", "retry", "retry", "ok", "done"],
    );
  });

  it("gives up after the last retry and reports the failure", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    ctx.meta.mode = "down";
    await deliver(ctx, webhookBody(lead));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      ctx.clock.advance(24 * 60);
      await processDue(ctx.runtime);
    }
    const row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 8);
    assert.match(row.last_error, /Gave up after 8 attempts/);
    assert.equal((await ingestionStats(ctx.db)).attention, 1);
  });

  it("backs off for at least 15 minutes and stops the batch when rate limited", async () => {
    const ctx = await setup();
    const first = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const second = addLead(ctx.meta, OWNER_FORM, { ...OWNER_ANSWERS, phone_number: "9845000001" });
    ctx.meta.mode = "rate_limited";
    for (const lead of [first, second]) {
      await receiveWebhook(ctx.db, config, {
        rawBody: webhookBody(lead),
        signature: `sha256=${await hmacSha256Hex(ENV.META_APP_SECRET, webhookBody(lead))}`,
        now: ctx.clock.iso(),
      });
    }
    const tally = await processDue(ctx.runtime);
    assert.deepEqual(tally, { rate_limited: 1 });
    assert.equal((await ingestion(ctx.db, first.id))!.next_attempt_at, "2026-11-10T10:15:00.000Z");
    assert.equal((await ingestion(ctx.db, second.id))!.status, "pending");
  });

  it("pauses on an expired token and resumes after reconnecting", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    ctx.meta.mode = "expired";
    await deliver(ctx, webhookBody(lead));
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "waiting_token");
    const connection = await getConnection(ctx.db);
    assert.equal(connection.status, "expired");
    assert.match(connection.lastError, /Session has expired/);

    const later = addLead(ctx.meta, OWNER_FORM, { ...OWNER_ANSWERS, phone_number: "9845000002" });
    await deliver(ctx, webhookBody(later));
    assert.equal((await ingestion(ctx.db, later.id))!.status, "waiting_token");
    assert.equal(ctx.meta.calls.filter((call) => call === `GET /${later.id}`).length, 0);

    ctx.meta.mode = "ok";
    await ctx.db.prepare("UPDATE meta_connection SET user_token_enc = ?1").bind(await encryptToken(config.tokenKey, "EAAG-user-token-secret", "meta_connection.user_token")).run();
    await selectPage(ctx.db, admin, config, ctx.graph, PAGE_ID, ctx.clock.iso());
    assert.equal((await getConnection(ctx.db)).status, "connected");
    await processDue(ctx.runtime);
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "done");
    assert.equal((await ingestion(ctx.db, later.id))!.status, "done");
  });

  it("test connection reports each check and re-enables an expired connection that works again", async () => {
    const ctx = await setup();
    ctx.meta.subscribed = false;
    await ctx.db.prepare("UPDATE meta_connection SET status = 'expired'").run();
    const result = await testConnection(ctx.db, admin, config, [], ctx.graph, ctx.clock.iso());
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.equal(ctx.meta.subscribed, true);
    assert.equal((await getConnection(ctx.db)).status, "connected");

    ctx.meta.mode = "expired";
    const failed = await testConnection(ctx.db, admin, config, [], ctx.graph, ctx.clock.iso());
    assert.equal(failed.ok, false);
    assert.equal((await getConnection(ctx.db)).status, "expired");
  });

  it("ignores leads for a Page other than the connected one", async () => {
    const ctx = await setup();
    const body = webhookBody({ id: "4111111111111111", form_id: OWNER_FORM.id }).replaceAll(PAGE_ID, "999999999");
    const result = await deliver(ctx, body);
    assert.equal(result.status === 200 && result.ignored, 1);
    const queued = await ctx.db.prepare("SELECT COUNT(*) AS n FROM meta_lead_ingestions").first<{ n: number }>();
    assert.equal(queued?.n, 0);
  });
});

describe("historical import and reconciliation", () => {
  it("imports a date range page by page through the same pipeline and counts duplicates", async () => {
    const ctx = await setup();
    const inRange = Array.from({ length: 120 }, (_, index) =>
      addLead(ctx.meta, TENANT_FORM, { full_name: `Tenant ${index}`, phone_number: `98000${String(index).padStart(5, "0")}` }, { created_time: "2026-10-20T08:00:00+0000" }),
    );
    addLead(ctx.meta, TENANT_FORM, { full_name: "Too old", phone_number: "9811111111" }, { created_time: "2026-09-01T08:00:00+0000" });
    const broken = addLead(ctx.meta, OWNER_FORM, { full_name: "No number" }, { created_time: "2026-10-21T08:00:00+0000" });
    await deliver(ctx, webhookBody(inRange[0]));

    const input = parseImportInput({ formIds: [TENANT_FORM.id, OWNER_FORM.id], since: "2026-10-01", until: "2026-10-31" }, ctx.clock.now());
    const job = await createImportJob(ctx.db, admin, input, ctx.clock.iso());
    await assert.rejects(createImportJob(ctx.db, admin, input, ctx.clock.iso()), /already running/);

    let current = job;
    for (let step = 0; step < 20 && current.status !== "completed"; step += 1) {
      current = (await runImportStep(ctx.runtime, job.id))!;
    }
    assert.equal(current.status, "completed");
    assert.equal(current.found, 121);
    assert.equal(current.duplicates, 1);
    assert.equal(current.queued, 120);
    assert.equal(current.progress.byStatus.done, 119);
    assert.equal(current.progress.byStatus.needs_review, 1);
    assert.equal((await ingestion(ctx.db, broken.id))!.status, "needs_review");

    const requirements = await ctx.db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>();
    assert.equal(requirements?.n, 120);
    const origins = await ctx.db.prepare("SELECT ingestion_origin, COUNT(*) AS n FROM lead_sources GROUP BY ingestion_origin ORDER BY 1").all<{ ingestion_origin: string; n: number }>();
    assert.deepEqual(origins.results.map((row) => [row.ingestion_origin, row.n]), [["historical_import", 119], ["webhook", 1]]);

    const again = await createImportJob(ctx.db, admin, input, ctx.clock.iso());
    let rerun = again;
    for (let step = 0; step < 10 && rerun.status !== "completed"; step += 1) rerun = (await runImportStep(ctx.runtime, again.id))!;
    assert.equal(rerun.duplicates, 121);
    assert.equal(rerun.queued, 0);
  });

  it("pauses an import when the token expires and refuses unclassified forms", async () => {
    const ctx = await setup({ classify: { [TENANT_FORM.id]: "tenant" } });
    await assert.rejects(
      createImportJob(ctx.db, admin, { formIds: [OWNER_FORM.id], since: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" }, ctx.clock.iso()),
      /Classify/,
    );
    addLead(ctx.meta, TENANT_FORM, { phone_number: "9822222222" }, { created_time: "2026-10-05T08:00:00+0000" });
    const job = await createImportJob(ctx.db, admin, { formIds: [TENANT_FORM.id], since: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" }, ctx.clock.iso());
    ctx.meta.mode = "expired";
    const paused = (await runImportStep(ctx.runtime, job.id))!;
    assert.equal(paused.status, "paused");
    assert.equal((await getConnection(ctx.db)).status, "expired");
  });

  it("validates import date ranges", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    assert.throws(() => parseImportInput({ formIds: [], since: "2026-10-01" }, now), /at least one form/);
    assert.throws(() => parseImportInput({ formIds: ["900000000000001"], since: "2026-11-20" }, now), /before the end/);
    const range = parseImportInput({ formIds: ["900000000000001"], since: "2026-10-01", until: "2026-12-31" }, now);
    assert.equal(range.until, now.toISOString());
  });

  it("reconciliation queues leads whose webhook never arrived", async () => {
    const ctx = await setup();
    const missed = addLead(ctx.meta, BUYER_FORM, { full_name: "Missed", phone_number: "9833333333" }, { created_time: "2026-11-10T06:00:00+0000" });
    const result = await reconcileRecentLeads(ctx.runtime, { force: true });
    assert.deepEqual(result, { checked: 1, queued: 1 });
    await processDue(ctx.runtime);
    assert.equal((await ingestion(ctx.db, missed.id))!.status, "done");
    assert.equal(await reconcileRecentLeads(ctx.runtime), null);
  });
});

describe("form mapping and value parsing", () => {
  it("suggests mappings from Meta question types and wording", () => {
    assert.deepEqual(suggestMapping(TENANT_FORM.questions, "tenant"), {
      full_name: "name",
      phone_number: "phone",
      email: "email",
      bhk_needed: "bhk",
      monthly_budget: "budget",
      preferred_location: "locality",
      "when_do_you_want_to_move?": "timeline",
      any_other_preferences: "preferences",
    });
    assert.equal(suggestMapping(OWNER_FORM.questions, "owner")["expected_rent_or_price"], "expected_price");
    assert.equal(suggestMapping(OWNER_FORM.questions, "owner")["do_you_want_to_rent_or_sell?"], "intent");
  });

  it("separates purchase and monthly budgets, and does not turn an owner's rent into a buyer budget", () => {
    const question = (key: string, label: string, options: { key: string; value: string }[] = []) => ({ key, label, type: "CUSTOM", options });
    const mixed = suggestMapping(
      [
        question("nimge_yen_beku?", "Nimge yen beku?", [
          { key: "buy_madbeku", value: "Buy madbeku" },
          { key: "rent_ge_beku", value: "Rent ge beku" },
        ]),
        question("buy_budget", "Buymadbekadre nimma budget eshtu?"),
        question("rent_budget", "Rent ge monthly budget eshtu?"),
        question("yava_type_property_beku?", "Yava type property beku?", [
          { key: "house", value: "House" },
          { key: "flat", value: "Flat" },
        ]),
        question("yavaga_property_beku?", "Yavaga property beku?"),
        question("yava_area_alli_property_beku?", "Yava area alli property beku?"),
      ],
      "mixed",
    );
    assert.equal(mixed["nimge_yen_beku?"], "intent");
    assert.equal(mixed.buy_budget, "purchase_budget");
    assert.equal(mixed.rent_budget, "rent_budget");
    assert.equal(mixed["yava_type_property_beku?"], "property_type");
    assert.equal(mixed["yavaga_property_beku?"], "timeline");
    assert.equal(mixed["yava_area_alli_property_beku?"], "locality");
    assert.deepEqual(
      alignBudgetTargets(
        [question("buy_budget", "Buymadbekadre nimma budget eshtu?"), question("rent_budget", "Rent ge monthly budget eshtu?")],
        "mixed",
        { buy_budget: "budget", rent_budget: "budget" },
      ),
      { buy_budget: "purchase_budget", rent_budget: "rent_budget" },
    );

    const areaWise = suggestMapping(
      [
        question("which_property", "Nimma yaava property rent-ge kodalu ide?"),
        question("where", "Nimma property yaava area dalli ide?"),
        question("rent", "Tingala rent eshtu expect maadtira?"),
        question("available", "Property eega rent-ge available ideya?"),
      ],
      "owner",
    );
    assert.equal(areaWise.which_property, "");
    assert.equal(areaWise.where, "locality");
    assert.equal(areaWise.rent, "expected_price");
    assert.equal(areaWise.available, "");
    assert.equal(suggestOwnerIntent([question("rent", "Tingala rent eshtu expect maadtira?")]), "Rent");

    const choice = [
      question("intent", "Nimma property yen madbeku?", [
        { key: "sell", value: "Sell madbeku" },
        { key: "rent", value: "Rent ge kodbeku" },
        { key: "lease", value: "Lease ge kodbeku" },
      ]),
      question("type", "Property type", [
        { key: "house", value: "House" },
        { key: "plot", value: "Plot" },
      ]),
      question("where", "Property location"),
      question("condition", "Property condition"),
    ];
    const owner = suggestMapping(choice, "owner");
    assert.equal(owner.intent, "intent");
    assert.equal(owner.type, "property_type");
    assert.equal(owner.where, "locality");
    assert.equal(owner.condition, "preferences");
    assert.equal(suggestOwnerIntent(choice), "");
  });

  it("requires a mobile mapping before a form can import", async () => {
    const ctx = await setup({ classify: {} });
    const form = (await getStoredForm(ctx.db, OWNER_FORM.id))!;
    assert.throws(() => parseFormSettings({ classification: "owner", mapping: { full_name: "name", phone_number: "ignore" } }, form), /Mobile/);
  });

  it("parses Indian budgets, BHK, timelines and locality lists", () => {
    assert.deepEqual(parseMoney("₹10,000 - ₹15,000"), { min: 10_000, max: 15_000 });
    assert.deepEqual(parseMoney("10-15k"), { min: 10_000, max: 15_000 });
    assert.deepEqual(parseMoney("50 lakh"), { min: null, max: 5_000_000 });
    assert.deepEqual(parseMoney("1.2 Cr"), { min: null, max: 12_000_000 });
    assert.deepEqual(parseMoney("above 1 crore"), { min: 10_000_000, max: null });
    assert.deepEqual(parseMoney("below_20k"), { min: null, max: 20_000 });
    assert.deepEqual(parseMoney("negotiable"), { min: null, max: null });
    assert.deepEqual(parseBhk("2_bhk"), { min: 2, max: 2 });
    assert.deepEqual(parseBhk("2 or 3 BHK"), { min: 2, max: 3 });
    assert.deepEqual(parseBhk("3+ BHK"), { min: 3, max: null });
    assert.deepEqual(parseBhk("1 RK"), { min: 1, max: 1 });
    assert.equal(parseTimeline("Immediately"), "Immediate");
    assert.equal(parseTimeline("within_a_week"), "Within 7 days");
    assert.equal(parseTimeline("Within 1 month"), "Within 30 days");
    assert.equal(parseTimeline("Just exploring"), "Exploring");
    assert.deepEqual(splitLocalities("Sedam Road / Jewargi Road and Kalaburagi"), ["Sedam Road", "Jewargi Road"]);
  });

  it("classifies Graph errors", () => {
    assert.equal(classifyMetaError(401, { error: { code: 190, type: "OAuthException", message: "x" } }).kind, "auth");
    assert.equal(classifyMetaError(400, { error: { code: 17, message: "x" } }).kind, "rate_limit");
    assert.equal(classifyMetaError(429, {}).kind, "rate_limit");
    assert.equal(classifyMetaError(403, { error: { code: 200, message: "x" } }).kind, "permission");
    assert.equal(classifyMetaError(500, {}).kind, "transient");
    assert.equal(classifyMetaError(400, { error: { code: 100, message: "x" } }).kind, "permanent");
    const headers = new Headers({ "x-business-use-case-usage": JSON.stringify({ "1": [{ estimated_time_to_regain_access: 30 }] }) });
    assert.equal(classifyMetaError(400, { error: { code: 80001, message: "x" } }, headers).retryAfterSeconds, 1800);
  });

  it("strips tokens that Meta echoes back in error messages", () => {
    const echoed = classifyMetaError(400, { error: { code: 190, message: "Malformed access token EAAGm0PX4ZCpsBAKZBj1ZBc2fXyz" } });
    assert.equal(echoed.message, "Malformed access token [token]");
    const keyed = classifyMetaError(400, { error: { code: 190, message: "Bad access_token=abcdefghijklmnopqrstuvwxyz0123" } });
    assert.equal(keyed.message, "Bad access_token=[token]");
    assert.equal(
      classifyMetaError(401, { error: { code: 190, message: "Error validating access token: Session has expired" } }).message,
      "Error validating access token: Session has expired",
    );
  });
});

describe("attribution reporting", () => {
  it("builds a campaign funnel without inventing spend", async () => {
    const ctx = await setup();
    await deliver(ctx, webhookBody(addLead(ctx.meta, TENANT_FORM, { phone_number: "9844444444" }, { campaign: "7" })));
    await deliver(ctx, webhookBody(addLead(ctx.meta, OWNER_FORM, { ...OWNER_ANSWERS, phone_number: "9855555555" }, { campaign: "7" })));
    const funnel = await ctx.db.prepare("SELECT * FROM campaign_lead_funnel WHERE campaign_id = '407'").first<Record<string, unknown>>();
    assert.equal(funnel?.leads, 2);
    assert.equal(funnel?.owner_leads, 1);
    assert.equal(funnel?.requirements, 1);
    assert.equal(funnel?.qualified, 0);
    assert.equal(funnel?.spend_minor, null);

    await ctx.db
      .prepare("INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by) VALUES ('meta', 'campaign', '407', '2026-11-10', 'INR', 150000, 'test', 't', 'x')")
      .run();
    const withSpend = await ctx.db.prepare("SELECT spend_minor, currency FROM campaign_lead_funnel WHERE campaign_id = '407'").first<Record<string, unknown>>();
    assert.deepEqual({ ...withSpend }, { spend_minor: 150000, currency: "INR" });
  });
});

describe("least-privilege permissions", () => {
  it("treats an App Secret that is not 32 hex characters as missing, so Connect stays disabled", () => {
    assert.deepEqual(readMetaConfig(ENV).missing, []);
    assert.deepEqual(readMetaConfig({ ...ENV, META_APP_SECRET: "gulbarga-home" }).missing, ["META_APP_SECRET"]);
    assert.deepEqual(readMetaConfig({ ...ENV, META_APP_SECRET: "2327104601371140" }).missing, ["META_APP_SECRET"]);
  });

  it("asks only for what lead ingestion needs unless optional scopes are ticked", () => {
    assert.deepEqual(requestedScopes(), ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval"]);
    for (const scope of ["ads_management", "business_management", "ads_read"]) assert.ok(!requestedScopes().includes(scope));
    assert.deepEqual(requestedScopes(["ads_read", "ads_management", "business_management"]), [...REQUIRED_SCOPES, "ads_read", "business_management"]);
    const dialog = new URL(createGraphClient(config).oauthDialogUrl("state123", requestedScopes()));
    assert.equal(dialog.searchParams.get("scope"), REQUIRED_SCOPES.join(","));
    assert.equal(dialog.searchParams.get("redirect_uri"), "https://gulbargahomes.com/api/admin/integrations/meta/callback");
  });

  it("does not request campaign names without ads_read and keeps ids from the webhook", async () => {
    const ctx = await setup();
    ctx.runtime.adNames = false;
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    await deliver(ctx, webhookBody(lead));
    const fetched = ctx.meta.requests.find((request) => request.url.includes(`/${lead.id}?`))!;
    const fields = new URL(fetched.url).searchParams.get("fields")!;
    assert.ok(fields.includes("field_data") && fields.includes("campaign_id"));
    assert.ok(!fields.includes("campaign_name"));
    const row = (await ingestion(ctx.db, lead.id))!;
    const source = (await getSource(ctx.db, (await getOwnerLead(ctx.db, row.entity_id))!.sourceId))!;
    assert.equal(source.metaCampaignId, "401");
    assert.equal(source.metaCampaignName, "");
  });

  it("still imports the answers when Meta refuses ad-level fields", async () => {
    const ctx = await setup();
    ctx.meta.refuseAdFields = true;
    const lead = addLead(ctx.meta, TENANT_FORM, { full_name: "Asha", phone_number: "9900112244" });
    await deliver(ctx, webhookBody(lead));
    const row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.status, "done");
    const requirement = (await getRequirement(ctx.db, row.entity_id))!;
    assert.equal(requirement.contactName, "Asha");
    const source = (await getSource(ctx.db, requirement.sourceId))!;
    assert.equal(source.metaAdId, "601", "ad id from the webhook is kept");
    assert.equal(source.metaCampaignId, "");
    assert.equal((await getConnection(ctx.db)).status, "connected");
  });
});

describe("OAuth token handling", () => {
  it("exchanges the code with the app secret in a POST body, never in a URL", async () => {
    const ctx = await setup({ connect: false, classify: {} });
    const result = await ctx.graph.exchangeCode("oauth-code-XYZ");
    assert.equal(result.accessToken, USER_TOKEN);
    const exchanges = ctx.meta.requests.filter((request) => request.url.includes("/oauth/access_token"));
    assert.equal(exchanges.length, 2);
    for (const request of exchanges) {
      assert.equal(request.method, "POST");
      for (const secret of [ENV.META_APP_SECRET, "oauth-code-XYZ", USER_TOKEN]) assert.ok(!request.url.includes(secret));
    }
    assert.ok(new URLSearchParams(exchanges[0].body).get("client_secret") === ENV.META_APP_SECRET);
    assert.ok(new URLSearchParams(exchanges[1].body).get("fb_exchange_token") === USER_TOKEN);
  });
});

describe("Page and form ownership", () => {
  it("ignores webhooks while disconnected but keeps queueing while the token is expired", async () => {
    const ctx = await setup();
    await ctx.db.prepare("UPDATE meta_connection SET status = 'disconnected'").run();
    const first = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const ignored = await receiveWebhook(ctx.db, config, {
      rawBody: webhookBody(first),
      signature: `sha256=${await hmacSha256Hex(ENV.META_APP_SECRET, webhookBody(first))}`,
      now: ctx.clock.iso(),
    });
    assert.equal(ignored.status === 200 && ignored.ignored, 1);
    assert.equal(await ingestion(ctx.db, first.id), null);

    await ctx.db.prepare("UPDATE meta_connection SET status = 'expired'").run();
    const queued = await receiveWebhook(ctx.db, config, {
      rawBody: webhookBody(first),
      signature: `sha256=${await hmacSha256Hex(ENV.META_APP_SECRET, webhookBody(first))}`,
      now: ctx.clock.iso(),
    });
    assert.equal(queued.status === 200 && queued.created, 1);
  });

  it("refuses leads whose form belongs to another Page", async () => {
    const ctx = await setup();
    const foreignForm = { ...OWNER_FORM, id: "900000000000099", name: "Someone else's form" };
    ctx.meta.foreignForms = [foreignForm];
    const discovered = addLead(ctx.meta, foreignForm, OWNER_ANSWERS);
    await deliver(ctx, webhookBody(discovered));
    const row = (await ingestion(ctx.db, discovered.id))!;
    assert.equal(row.status, "ignored");
    assert.match(row.last_error, /another Page/);
    assert.equal(await getStoredForm(ctx.db, foreignForm.id), null);

    const storedForeign = { ...OWNER_FORM, id: "900000000000098", name: "Old Page form" };
    await upsertDiscoveredForms(ctx.db, admin.id, "8888888888", [{ ...storedForeign, status: "ACTIVE", locale: "en_US", createdTime: null, leadsCount: null }], ctx.clock.iso());
    const stored = (await getStoredForm(ctx.db, storedForeign.id))!;
    await updateFormSettings(ctx.db, admin, stored, parseFormSettings({ classification: "owner" }, stored), { now: ctx.clock.iso() });
    const lead = addLead(ctx.meta, storedForeign, { ...OWNER_ANSWERS, phone_number: "9845000099" });
    await deliver(ctx, webhookBody(lead));
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "ignored");
    const owners = await ctx.db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>();
    assert.equal(owners?.n, 0);
  });
});

describe("Worker reliability", () => {
  it("a lead acknowledged but never processed is picked up by the sweep", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, BUYER_FORM, { full_name: "Late", phone_number: "9844444444" });
    const body = webhookBody(lead);
    const ack = await receiveWebhook(ctx.db, config, { rawBody: body, signature: `sha256=${await hmacSha256Hex(ENV.META_APP_SECRET, body)}`, now: ctx.clock.iso() });
    assert.equal(ack.status, 200);
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "pending");
    await runSweep(ctx.runtime);
    assert.equal((await ingestion(ctx.db, lead.id))!.status, "done");
  });

  it("a run stopped after creating the lead is recovered as done, not duplicated", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    await deliver(ctx, webhookBody(lead));
    const before = (await ingestion(ctx.db, lead.id))!;
    await ctx.db
      .prepare("UPDATE meta_lead_ingestions SET status = 'processing', locked_until = ?1 WHERE id = ?2")
      .bind(new Date(ctx.clock.now().getTime() - 60_000).toISOString(), before.id)
      .run();
    ctx.clock.advance(1);
    await runSweep(ctx.runtime);
    const after = (await ingestion(ctx.db, lead.id))!;
    assert.equal(after.status, "done");
    assert.equal(after.entity_id, before.entity_id);
    assert.match(after.last_error, /Recovered/);
    const owners = await ctx.db.prepare("SELECT COUNT(*) AS n FROM owner_leads").first<{ n: number }>();
    assert.equal(owners?.n, 1);
    assert.equal((await ingestionStats(ctx.db)).duplicateLeads, 0);
  });

  it("a locked row is not processed twice before its lock expires", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const queued = await enqueueLead(ctx.db, { leadgenId: lead.id, pageId: PAGE_ID, origin: "webhook" }, ctx.clock.iso());
    await ctx.db
      .prepare("UPDATE meta_lead_ingestions SET status = 'processing', locked_until = ?1 WHERE id = ?2")
      .bind(new Date(ctx.clock.now().getTime() + 4 * 60_000).toISOString(), queued.id)
      .run();
    assert.equal(await processIngestion(ctx.runtime, queued.id), "skipped");
    ctx.clock.advance(5);
    assert.equal(await processIngestion(ctx.runtime, queued.id), "done");
  });

  it("a database failure while queueing surfaces so the route answers 500 and Meta retries", async () => {
    const ctx = await setup();
    const failing = {
      ...ctx.db,
      prepare(sql: string) {
        if (sql.includes("INSERT INTO meta_lead_ingestions")) throw new Error("D1_ERROR: database is locked");
        return ctx.db.prepare(sql);
      },
    };
    const lead = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    const body = webhookBody(lead);
    await assert.rejects(
      receiveWebhook(failing, config, { rawBody: body, signature: `sha256=${await hmacSha256Hex(ENV.META_APP_SECRET, body)}`, now: ctx.clock.iso() }),
      /database is locked/,
    );
    const retried = await deliver(ctx, body);
    assert.equal(retried.status === 200 && retried.created, 1);
  });

  it("test connection resumes an import that paused when the token expired", async () => {
    const ctx = await setup();
    addLead(ctx.meta, TENANT_FORM, { phone_number: "9822222299" }, { created_time: "2026-10-05T08:00:00+0000" });
    const job = await createImportJob(ctx.db, admin, { formIds: [TENANT_FORM.id], since: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" }, ctx.clock.iso());
    ctx.meta.mode = "expired";
    assert.equal((await runImportStep(ctx.runtime, job.id))!.status, "paused");
    ctx.meta.mode = "ok";
    await testConnection(ctx.db, admin, config, [], ctx.graph, ctx.clock.iso());
    assert.equal((await getImportJob(ctx.db, job.id))!.status, "scanning");
    let current = (await runImportStep(ctx.runtime, job.id))!;
    for (let step = 0; step < 5 && current.status !== "completed"; step += 1) current = (await runImportStep(ctx.runtime, job.id))!;
    assert.equal(current.status, "completed");
  });
});

describe("retention of integration data", () => {
  it("dismissing drops the queue copy of the answers", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, TENANT_FORM, { full_name: "No Phone Again", monthly_budget: "9000" });
    await deliver(ctx, webhookBody(lead));
    const held = (await ingestion(ctx.db, lead.id))!;
    assert.equal(held.status, "needs_review");
    assert.equal(await dismissIngestions(ctx.db, admin, [held.id], ctx.clock.iso()), 1);
    const dismissed = (await ingestion(ctx.db, lead.id))!;
    assert.equal(dismissed.status, "ignored");
    assert.equal(dismissed.payload_json, "");
    const audit = await ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dismiss_ingestion'").first<{ n: number }>();
    assert.equal(audit?.n, 1);
  });

  it("keeps phone numbers out of error text and history", async () => {
    const ctx = await setup();
    const lead = addLead(ctx.meta, TENANT_FORM, { full_name: "Abroad", phone_number: "+1 415 555 0100" });
    await deliver(ctx, webhookBody(lead));
    const row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.status, "needs_review");
    assert.ok(!row.last_error.includes("415"));
    const events = await ctx.db.prepare("SELECT message FROM meta_ingestion_events WHERE ingestion_id = ?1").bind(row.id).all<{ message: string }>();
    assert.ok(events.results.every((event) => !event.message.includes("415")));
  });

  it("purges old queue copies and delivery logs but never CRM records", async () => {
    const ctx = await setup();
    const imported = addLead(ctx.meta, OWNER_FORM, OWNER_ANSWERS);
    await deliver(ctx, webhookBody(imported));
    const failed = addLead(ctx.meta, TENANT_FORM, { full_name: "Gone" });
    await deliver(ctx, webhookBody(failed));
    await ctx.db.prepare("UPDATE meta_lead_ingestions SET status = 'failed' WHERE leadgen_id = ?1").bind(failed.id).run();
    ctx.clock.advance(31 * 24 * 60);
    const result = await purgeExpiredQueueData(ctx.db, ctx.clock.now());
    assert.equal(result.payloadsCleared, 1);
    assert.equal((await ingestion(ctx.db, failed.id))!.payload_json, "");
    const lead = (await getOwnerLead(ctx.db, (await ingestion(ctx.db, imported.id))!.entity_id))!;
    const source = (await getSource(ctx.db, lead.sourceId))!;
    assert.ok(Array.isArray(source.rawPayload.answers) && source.rawPayload.answers.length > 0);

    ctx.clock.advance(60 * 24 * 60);
    assert.ok((await purgeExpiredQueueData(ctx.db, ctx.clock.now())).deliveriesDeleted >= 2);
  });
});

const MIXED_FORM: FakeForm = {
  id: "900000000000010",
  name: "Gulbarga Buyer & Renter",
  questions: [
    {
      key: "nimge_yen_beku?",
      label: "Nimge yen beku?",
      type: "CUSTOM",
      options: [
        { key: "buy_madbeku", value: "Buy madbeku" },
        { key: "rent_ge_beku", value: "Rent ge beku" },
      ],
    },
    {
      key: "buy_madbekadre_nimma_budget_eshtu?",
      label: "Buy madbekadre nimma budget eshtu?",
      type: "CUSTOM",
      options: [
        { key: "40_60_lakh", value: "40-60 lakh" },
        { key: "budget_decide_madilla", value: "Budget decide madilla" },
      ],
    },
    {
      key: "rent_ge_monthly_budget_eshtu?",
      label: "Rent ge monthly budget eshtu?",
      type: "CUSTOM",
      options: [{ key: "10_20_thousand", value: "10-20 thousand" }],
    },
    {
      key: "yava_type_property_beku?",
      label: "Yava type property beku?",
      type: "CUSTOM",
      options: [
        { key: "house", value: "House" },
        { key: "land", value: "Land" },
        { key: "flat", value: "Flat" },
      ],
    },
    {
      key: "yavaga_property_beku?",
      label: "Yavaga property beku?",
      type: "CUSTOM",
      options: [
        { key: "immediately", value: "Immediately" },
        { key: "just_looking", value: "Just looking" },
      ],
    },
    { key: "yava_area_alli_property_beku?", label: "Yava area alli property beku?", type: "CUSTOM", options: [] },
    { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
    { key: "phone", label: "Phone number", type: "PHONE", options: [] },
  ],
};

const OWNER_CHOICE_FORM: FakeForm = {
  id: "900000000000011",
  name: "Gulbarga Property Owner",
  questions: [
    { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
    { key: "phone_number", label: "Phone number", type: "PHONE", options: [] },
    {
      key: "nimma_property_yen_madbeku?",
      label: "Nimma property yen madbeku?",
      type: "CUSTOM",
      options: [
        { key: "sell_madbeku", value: "Sell madbeku" },
        { key: "rent_ge_kodbeku", value: "Rent ge kodbeku" },
        { key: "lease_ge_kodbeku", value: "Lease ge kodbeku" },
      ],
    },
    { key: "property_location", label: "Property ellide?", type: "CUSTOM", options: [] },
  ],
};

async function classifyForm(ctx: Awaited<ReturnType<typeof setup>>, form: FakeForm, classification: FormClassification) {
  ctx.meta.forms.push(form);
  await upsertDiscoveredForms(ctx.db, admin.id, PAGE_ID, await ctx.graph.listForms(PAGE_ID, PAGE_TOKEN), ctx.clock.iso());
  const stored = (await getStoredForm(ctx.db, form.id))!;
  await updateFormSettings(ctx.db, admin, stored, parseFormSettings({ classification }, stored), { now: ctx.clock.iso() });
}

describe("mixed buyer and renter forms", () => {
  it("suggests separate budgets and refuses a single Budget target", async () => {
    const ctx = await setup({ classify: {} });
    await classifyForm(ctx, MIXED_FORM, "unclassified");
    const stored = (await getStoredForm(ctx.db, MIXED_FORM.id))!;
    const suggested = suggestMapping(stored.questions, "mixed");
    assert.equal(suggested["nimge_yen_beku?"], "intent");
    assert.equal(suggested["buy_madbekadre_nimma_budget_eshtu?"], "purchase_budget");
    assert.equal(suggested["rent_ge_monthly_budget_eshtu?"], "rent_budget");
    assert.equal(suggested["yava_type_property_beku?"], "property_type");
    assert.equal(suggested["yavaga_property_beku?"], "timeline");
    assert.equal(suggested["yava_area_alli_property_beku?"], "locality");
    assert.equal(suggested.phone, "phone");
    assert.throws(
      () => parseFormSettings({ classification: "mixed", mapping: { ...suggested, "buy_madbekadre_nimma_budget_eshtu?": "budget" } }, stored),
      /Purchase budget/,
    );
  });

  it("stores a purchase budget for a buyer and a monthly rent for a tenant, and nothing for the other", async () => {
    const ctx = await setup({ classify: {} });
    await classifyForm(ctx, MIXED_FORM, "mixed");
    const buyer = addLead(ctx.meta, MIXED_FORM, {
      full_name: "Buyer One",
      phone: "9811111111",
      "nimge_yen_beku?": "Buy madbeku",
      "buy_madbekadre_nimma_budget_eshtu?": "40-60 lakh",
      "rent_ge_monthly_budget_eshtu?": "10-20 thousand",
      "yava_type_property_beku?": "Land",
      "yavaga_property_beku?": "Immediately",
      "yava_area_alli_property_beku?": "Sedam Road",
    });
    const tenant = addLead(ctx.meta, MIXED_FORM, {
      full_name: "Tenant One",
      phone: "9822222222",
      "nimge_yen_beku?": "Rent ge beku",
      "buy_madbekadre_nimma_budget_eshtu?": "40-60 lakh",
      "rent_ge_monthly_budget_eshtu?": "10-20 thousand",
      "yava_type_property_beku?": "Flat",
    });
    const buyerNone = addLead(ctx.meta, MIXED_FORM, {
      full_name: "Buyer None",
      phone: "9833333333",
      "nimge_yen_beku?": "buy_madbeku",
    });
    const tenantNone = addLead(ctx.meta, MIXED_FORM, {
      full_name: "Tenant None",
      phone: "9844444444",
      "nimge_yen_beku?": "rent_ge_beku",
      "rent_ge_monthly_budget_eshtu?": "Budget decide madilla",
    });
    await deliver(ctx, webhookBody(buyer));
    await deliver(ctx, webhookBody(tenant));
    await deliver(ctx, webhookBody(buyerNone));
    await deliver(ctx, webhookBody(tenantNone));

    const purchase = (await getRequirement(ctx.db, (await ingestion(ctx.db, buyer.id))!.entity_id))!;
    assert.equal(purchase.intent, "Buy");
    assert.equal(purchase.status, "New");
    assert.deepEqual([purchase.budgetMin, purchase.budgetMax], [4_000_000, 6_000_000]);
    assert.deepEqual(purchase.propertyTypes, ["Plot"]);
    assert.equal(purchase.timeline, "Immediate");
    assert.deepEqual(purchase.localities, ["Sedam Road"]);
    assert.match(purchase.notes, /Land/);
    assert.deepEqual(matchableBudget(purchase), { basis: "purchase", unit: "inr_total", min: 4_000_000, max: 6_000_000 });
    const buyerSource = (await getSource(ctx.db, purchase.sourceId))!;
    const buyerAnswers = buyerSource.rawPayload.answers as { key: string; value: string }[];
    assert.equal(buyerAnswers.find((answer) => answer.key.startsWith("rent_ge_monthly"))?.value, "10-20 thousand");
    assert.equal((buyerSource.rawPayload.decision as { budgetBasis: string }).budgetBasis, "purchase");

    const rental = (await getRequirement(ctx.db, (await ingestion(ctx.db, tenant.id))!.entity_id))!;
    assert.equal(rental.intent, "Rent");
    assert.deepEqual([rental.budgetMin, rental.budgetMax], [10_000, 20_000]);
    assert.deepEqual(matchableBudget(rental), { basis: "monthly", unit: "inr_per_month", min: 10_000, max: 20_000 });
    assert.match(rental.notes, /Purchase answer/);

    const openBuyer = (await getRequirement(ctx.db, (await ingestion(ctx.db, buyerNone.id))!.entity_id))!;
    assert.equal(openBuyer.intent, "Buy");
    assert.equal(openBuyer.budgetMin, null);
    assert.equal(openBuyer.budgetMax, null);
    const openTenant = (await getRequirement(ctx.db, (await ingestion(ctx.db, tenantNone.id))!.entity_id))!;
    assert.equal(openTenant.intent, "Rent");
    assert.equal(openTenant.budgetMax, null);
    assert.match(openTenant.notes, /Monthly rent \(as answered\): Budget decide madilla/);
  });

  it("does not create a requirement until buy or rent is reliable, and a second click does not duplicate", async () => {
    const ctx = await setup({ classify: {} });
    await classifyForm(ctx, MIXED_FORM, "mixed");
    const missing = addLead(ctx.meta, MIXED_FORM, { full_name: "No Intent", phone: "9855555555", "yava_type_property_beku?": "House" });
    const both = addLead(ctx.meta, MIXED_FORM, { full_name: "Both", phone: "9866666666", "nimge_yen_beku?": "buy or rent" });
    const unknown = addLead(ctx.meta, MIXED_FORM, { full_name: "Unknown", phone: "9877777777", "nimge_yen_beku?": "maybe later" });
    await deliver(ctx, webhookBody(missing));
    await deliver(ctx, webhookBody(missing));
    await deliver(ctx, webhookBody(both));
    await deliver(ctx, webhookBody(unknown));

    for (const lead of [missing, both, unknown]) {
      const row = (await ingestion(ctx.db, lead.id))!;
      assert.equal(row.status, "needs_review");
      assert.equal(row.last_error_kind, "intent_demand");
      assert.equal(row.entity_id, null);
    }
    assert.equal(missing && (await ingestion(ctx.db, missing.id))!.deliveries, 2);
    const created = await ctx.db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>();
    assert.equal(created?.n, 0);
    assert.equal(parseDemandIntent("buy or rent"), null);

    const held = (await ingestion(ctx.db, both.id))!;
    const [first, second] = await Promise.all([
      resolveIngestionIntent(ctx.db, admin, held.id, "Buy", ctx.clock.iso()),
      resolveIngestionIntent(ctx.db, admin, held.id, "Rent", ctx.clock.iso()),
    ]);
    assert.equal([first, second].filter((item) => item.ready).length, 1);
    await processIngestion(ctx.runtime, held.id);
    await processIngestion(ctx.runtime, held.id);
    const again = await resolveIngestionIntent(ctx.db, admin, held.id, "Rent", ctx.clock.iso());
    assert.equal(again.ready, false);
    const requirements = await ctx.db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>();
    assert.equal(requirements?.n, 1);
    const imported = (await getRequirement(ctx.db, (await ingestion(ctx.db, both.id))!.entity_id))!;
    assert.equal(imported.status, "New");
    const source = (await getSource(ctx.db, imported.sourceId))!;
    assert.equal((source.rawPayload.answers as { value: string }[]).some((answer) => answer.value === "buy or rent"), true);
    assert.equal((source.rawPayload.decision as { basis: string; decidedBy: string }).basis, "staff");
    assert.equal((source.rawPayload.decision as { decidedBy: string }).decidedBy, admin.id);
    assert.equal((await ingestion(ctx.db, both.id))!.resolved_by, admin.id);
    const decision = await ctx.db
      .prepare("SELECT actor_id FROM audit_log WHERE action = 'resolve_intent' AND entity_id = 'meta'")
      .all<{ actor_id: string }>();
    assert.equal(decision.results.some((entry) => entry.actor_id === admin.id), true);
  });

  it("adds another requirement on an existing contact without a second contact", async () => {
    const ctx = await setup();
    await classifyForm(ctx, MIXED_FORM, "mixed");
    const first = addLead(ctx.meta, BUYER_FORM, { full_name: "Same Person", phone_number: "9888888888", budget: "50 lakh" });
    const second = addLead(ctx.meta, MIXED_FORM, {
      full_name: "Same Person",
      phone: "9888888888",
      "nimge_yen_beku?": "Rent ge beku",
      "rent_ge_monthly_budget_eshtu?": "15000",
    });
    await deliver(ctx, webhookBody(first));
    await deliver(ctx, webhookBody(second));
    assert.equal((await ingestion(ctx.db, second.id))!.contact_existing, 1);
    const contacts = await ctx.db.prepare("SELECT COUNT(*) AS n FROM contacts").first<{ n: number }>();
    const requirements = await ctx.db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>();
    assert.equal(contacts?.n, 1);
    assert.equal(requirements?.n, 2);
  });
});

describe("owner sell, rent and lease", () => {
  it("does not file a sale as a rent, and holds an answer that names more than one", async () => {
    assert.equal(parseOwnerIntent("Sell madbeku"), "Sale");
    assert.equal(parseOwnerIntent("Rent ge kodbeku"), "Rent");
    assert.equal(parseOwnerIntent("Lease ge kodbeku"), "Lease");
    assert.equal(parseOwnerIntent("sell or rent"), null);

    const ctx = await setup({ classify: {} });
    ctx.meta.forms.push(OWNER_CHOICE_FORM);
    await upsertDiscoveredForms(ctx.db, admin.id, PAGE_ID, await ctx.graph.listForms(PAGE_ID, PAGE_TOKEN), ctx.clock.iso());
    const stored = (await getStoredForm(ctx.db, OWNER_CHOICE_FORM.id))!;
    assert.throws(
      () =>
        parseFormSettings(
          { classification: "owner", ownerIntent: "Rent", mapping: { full_name: "name", phone_number: "phone" } },
          stored,
        ),
      /sell, rent or lease/,
    );
    const mapping = suggestMapping(stored.questions, "owner");
    assert.equal(mapping["nimma_property_yen_madbeku?"], "intent");
    await updateFormSettings(ctx.db, admin, stored, parseFormSettings({ classification: "owner", mapping }, stored), { now: ctx.clock.iso() });

    const seller = addLead(ctx.meta, OWNER_CHOICE_FORM, {
      full_name: "Seller",
      phone_number: "9899999991",
      "nimma_property_yen_madbeku?": "Sell madbeku",
      property_location: "Jewargi Road",
    });
    const landlord = addLead(ctx.meta, OWNER_CHOICE_FORM, {
      full_name: "Landlord",
      phone_number: "9899999992",
      "nimma_property_yen_madbeku?": "Rent ge kodbeku",
    });
    const lessor = addLead(ctx.meta, OWNER_CHOICE_FORM, {
      full_name: "Lessor",
      phone_number: "9899999993",
      "nimma_property_yen_madbeku?": "Lease ge kodbeku",
    });
    const unclear = addLead(ctx.meta, OWNER_CHOICE_FORM, {
      full_name: "Unclear",
      phone_number: "9899999994",
      "nimma_property_yen_madbeku?": "sell or rent",
    });
    await deliver(ctx, webhookBody(seller));
    await deliver(ctx, webhookBody(landlord));
    await deliver(ctx, webhookBody(lessor));
    await deliver(ctx, webhookBody(unclear));

    assert.equal((await getOwnerLead(ctx.db, (await ingestion(ctx.db, seller.id))!.entity_id))!.intent, "Sale");
    assert.equal((await getOwnerLead(ctx.db, (await ingestion(ctx.db, landlord.id))!.entity_id))!.intent, "Rent");
    const lease = (await getOwnerLead(ctx.db, (await ingestion(ctx.db, lessor.id))!.entity_id))!;
    assert.equal(lease.intent, "Lease");
    assert.equal(lease.status, "New");
    const properties = await ctx.db.prepare("SELECT COUNT(*) AS n FROM properties WHERE source_owner_lead_id = ?1").bind(lease.id).first<{ n: number }>();
    assert.equal(properties?.n, 0);
    const held = (await ingestion(ctx.db, unclear.id))!;
    assert.equal(held.status, "needs_review");
    assert.equal(held.last_error_kind, "intent_owner");
    assert.equal(held.entity_id, null);

    const decided = await resolveIngestionIntent(ctx.db, admin, held.id, "Sale", ctx.clock.iso());
    assert.equal(decided.ready, true);
    assert.equal(await processIngestion(ctx.runtime, held.id), "done");
    assert.equal((await getOwnerLead(ctx.db, (await ingestion(ctx.db, unclear.id))!.entity_id))!.intent, "Sale");
    assert.equal(await processIngestion(ctx.runtime, held.id), "skipped");
  });

  it("does not let an unmapped sell answer fall through to the form default", () => {
    const mapped = mapLead(
      {
        formId: OWNER_CHOICE_FORM.id,
        name: OWNER_CHOICE_FORM.name,
        classification: "owner",
        ownerIntent: "Rent",
        mapping: { full_name: "name", phone_number: "phone" },
        questions: OWNER_CHOICE_FORM.questions,
      },
      {
        id: "1",
        formId: OWNER_CHOICE_FORM.id,
        createdTime: "2026-11-10T09:30:00.000Z",
        adId: "",
        adName: "",
        adsetId: "",
        adsetName: "",
        campaignId: "",
        campaignName: "",
        platform: "fb",
        isOrganic: false,
        fieldData: [
          { name: "full_name", values: ["Seller"] },
          { name: "phone_number", values: ["9899999991"] },
          { name: "nimma_property_yen_madbeku?", values: ["Sell madbeku"] },
        ],
      },
    );
    assert.equal(mapped.kind, "owner");
    if (mapped.kind === "owner") assert.equal(mapped.owner.intent, "Sale");
  });

  it("does not let a free-text mention of sale override an assume-Rent form", () => {
    const mapped = mapLead(
      {
        formId: "rent-only",
        name: "Rent only",
        classification: "owner",
        ownerIntent: "Rent",
        mapping: { full_name: "name", phone_number: "phone", note: "preferences" },
        questions: [
          { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
          { key: "phone_number", label: "Phone", type: "PHONE", options: [] },
          { key: "note", label: "Anything else", type: "CUSTOM", options: [] },
        ],
      },
      {
        id: "2",
        formId: "rent-only",
        createdTime: "2026-11-10T09:30:00.000Z",
        adId: "",
        adName: "",
        adsetId: "",
        adsetName: "",
        campaignId: "",
        campaignName: "",
        platform: "fb",
        isOrganic: false,
        fieldData: [
          { name: "full_name", values: ["Landlord"] },
          { name: "phone_number", values: ["9899999995"] },
          { name: "note", values: ["not for sale"] },
        ],
      },
    );
    assert.equal(mapped.kind, "owner");
    if (mapped.kind === "owner") assert.equal(mapped.owner.intent, "Rent");
  });

  it("keeps the staff decision when a later attempt finishes the import", async () => {
    const ctx = await setup({ classify: {} });
    await classifyForm(ctx, MIXED_FORM, "mixed");
    const lead = addLead(ctx.meta, MIXED_FORM, { full_name: "Retry", phone: "9800000001", "nimge_yen_beku?": "buy or rent" });
    await deliver(ctx, webhookBody(lead));
    const held = (await ingestion(ctx.db, lead.id))!;
    const decision = await resolveIngestionIntent(ctx.db, admin, held.id, "Buy", ctx.clock.iso());
    assert.equal(decision.ready, true);
    await ctx.db
      .prepare("UPDATE meta_lead_ingestions SET status = 'retry', attempts = 4, last_error = 'Meta was down' WHERE id = ?1")
      .bind(held.id)
      .run();
    assert.equal(await processIngestion(ctx.runtime, held.id), "done");
    assert.equal(await processIngestion(ctx.runtime, held.id), "skipped");
    const row = (await ingestion(ctx.db, lead.id))!;
    assert.equal(row.intent_override, "Buy");
    assert.equal(row.resolved_by, admin.id);
    assert.ok(row.resolved_at);
    const requirement = (await getRequirement(ctx.db, row.entity_id))!;
    assert.equal(requirement.intent, "Buy");
    const requirements = await ctx.db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>();
    assert.equal(requirements?.n, 1);
    const audit = await ctx.db
      .prepare("SELECT actor_id, context_json FROM audit_log WHERE action = 'decide_intent' AND entity_id = ?1")
      .bind(requirement.id)
      .first<{ actor_id: string; context_json: string }>();
    assert.equal(audit?.actor_id, admin.id);
    assert.match(audit?.context_json ?? "", /resolved_at/);
  });
});
