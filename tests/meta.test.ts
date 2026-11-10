import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findContactByPhone, getContact } from "../lib/crm/contacts";
import { getOwnerLead } from "../lib/crm/owner-leads";
import { getRequirement } from "../lib/crm/requirements";
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
  type MetaRuntime,
} from "../lib/meta/ingest";
import { suggestMapping, type FormClassification } from "../lib/meta/mapping";
import { getIngestionDetail, ingestionStats } from "../lib/meta/overview";
import { selectPage, testConnection } from "../lib/meta/setup";
import { parseBhk, parseMoney, parseTimeline, splitLocalities } from "../lib/meta/values";
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
    .first<{ id: string; status: string; attempts: number; deliveries: number; next_attempt_at: string; entity_type: string; entity_id: string; last_error: string; payload_json: string; contact_existing: number }>();
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
    assert.match(requirement.notes, /Budget \(as answered\): about fifteen thousand/);
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
