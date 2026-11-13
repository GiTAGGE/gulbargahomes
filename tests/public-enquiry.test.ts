import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { intentScore } from "../lib/crm/intent-score";
import { createRequirement, getRequirement } from "../lib/crm/requirements";
import { normalizeContactPhone } from "../lib/crm/phone";
import type { SourceInput } from "../lib/crm/sources";
import { prepareDatabase } from "../lib/db/prepare";
import { classifyTouch } from "../lib/enquiry/attribution";
import { rememberVisit } from "../lib/enquiry/capture";
import { hashClientIp, trustedClientIp } from "../lib/enquiry/client-ip";
import { nextAttributionCookie, openAttribution, sealAttribution } from "../lib/enquiry/cookie";
import { submitLandJvEnquiry, submitOwnerEnquiry, submitRequirementEnquiry, WEBSITE_ACTOR } from "../lib/enquiry/submit";
import type { SqlDb, SqlStatement } from "../lib/db/sql";
import { verifyTurnstile } from "../lib/enquiry/turnstile";
import { createTestDb } from "./helpers/sqlite";

const NOW = "2026-11-13T06:00:00.000Z";

function db() {
  return createTestDb();
}

async function ready() {
  const database = db();
  await prepareDatabase(database, () => [], NOW);
  return database;
}

function options(key: string, extra: { humanVerified?: boolean; rateLimit?: number; ipHash?: string } = {}) {
  return {
    now: NOW,
    ipHash: extra.ipHash ?? "ip-hash-1",
    idempotencyKey: key,
    humanVerified: extra.humanVerified ?? true,
    rateLimit: extra.rateLimit,
  };
}

function buyer(extra: Record<string, unknown> = {}) {
  return {
    intent: "Buy",
    propertyType: "House",
    bhkMin: 2,
    bhkMax: 3,
    localities: ["Sedam Road"],
    localityFlexible: true,
    budgetMin: 4000000,
    budgetMax: 6000000,
    timeline: "Immediate",
    furnishing: "Semi-furnished",
    parkingRequired: true,
    name: "Amina Khan",
    countryCode: "91",
    mobile: "9845012345",
    email: "amina@example.com",
    privacyAccepted: true,
    marketingConsent: false,
    conversionChannel: "website",
    attribution: {
      enquiryPage: "/properties/house-for-sale-sedam-road",
      cta: "property_card",
      propertySlug: "house-for-sale-sedam-road",
      propertyTitle: "House on Sedam Road",
      listingIntent: "Buy",
      listingLocality: "Sedam Road",
      first: {
        utmSource: "google",
        utmMedium: "organic",
        utmCampaign: "gulbarga-homes",
        landingPage: "https://gulbargahomes.com/",
        referrer: "https://www.google.com/search?q=houses",
        seenAt: "2026-11-01T06:00:00.000Z",
      },
      last: {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "sedam-houses",
        utmCampaignId: "cmp_123",
        gclid: "gclid-abc_123",
        landingPage: "https://gulbargahomes.com/properties/house-for-sale-sedam-road",
        seenAt: "2026-11-13T05:00:00.000Z",
      },
    },
    ...extra,
  };
}

function failAttribution(database: SqlDb, mode: "rollback" | "partial"): SqlDb {
  const wrap = (sql: string, statement: SqlStatement): SqlStatement & { sql: string } => ({
    sql,
    bind(...values) {
      return wrap(sql, statement.bind(...values));
    },
    all: () => statement.all(),
    first: () => statement.first(),
    run: () => statement.run(),
  });
  return {
    prepare(sql: string) {
      return wrap(sql, database.prepare(sql));
    },
    async batch(statements) {
      const marked = statements as Array<SqlStatement & { sql?: string }>;
      if (mode === "partial") {
        for (const statement of marked) {
          if (statement.sql?.includes("acquisition_attributions")) throw new Error("attribution failed");
          await statement.run();
        }
        return [];
      }
      if (marked.some((statement) => statement.sql?.includes("acquisition_attributions"))) throw new Error("attribution failed");
      return database.batch(statements);
    },
  };
}

async function count(database: Awaited<ReturnType<typeof ready>>, table: string) {
  const row = await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("website enquiry attribution", () => {
  it("keeps a known first touch when a later visit is direct", () => {
    const first = { utmSource: "google", utmMedium: "cpc", utmCampaign: "sedam", gclid: "click1", landingPage: "/properties" };
    const memory = rememberVisit(null, first, NOW);
    const next = rememberVisit(memory, { landingPage: "/contact" }, NOW);
    assert.equal(classifyTouch(next.first, NOW).source, "Google Ads");
    assert.equal(classifyTouch(next.first, NOW).campaign, "sedam");
    assert.equal(classifyTouch(next.last, NOW).source, "Direct");
  });

  it("keeps a direct first visit when a later visit has a campaign", () => {
    const memory = rememberVisit(null, { landingPage: "/" }, NOW);
    const next = rememberVisit(memory, { gclid: "later-click", landingPage: "/properties" }, NOW);
    assert.equal(classifyTouch(next.first, NOW).source, "Direct");
    assert.equal(classifyTouch(next.last, NOW).source, "Google Ads");
  });

  it("keeps UTM details while the visitor moves between pages", () => {
    const memory = rememberVisit(null, { utmSource: "instagram", utmMedium: "paid", utmCampaign: "plots", fbclid: "fb.1", landingPage: "/?utm_campaign=plots" }, NOW);
    const next = rememberVisit(memory, { landingPage: "/agricultural-land-joint-venture" }, NOW);
    assert.equal(next.first.utmCampaign, "plots");
    assert.equal(classifyTouch(next.last, NOW).source, "Direct");
  });

  it("uses click ids and referrers only when the browser supplied them", () => {
    assert.equal(classifyTouch({ gclid: "abc" }, NOW).source, "Google Ads");
    assert.equal(classifyTouch({ gbraid: "abc" }, NOW).source, "Google Ads");
    assert.equal(classifyTouch({ fbclid: "abc", referrer: "https://l.instagram.com/" }, NOW).source, "Instagram Ads");
    assert.equal(classifyTouch({ fbclid: "abc", referrer: "https://facebook.com/" }, NOW).source, "Facebook Ads");
    assert.equal(classifyTouch({ referrer: "https://chatgpt.com/c/123" }, NOW).source, "ChatGPT");
    assert.equal(classifyTouch({ referrer: "https://www.perplexity.ai/" }, NOW).source, "Other AI");
    assert.equal(classifyTouch({ landingPage: "/" }, NOW).source, "Direct");
    assert.equal(classifyTouch({}, NOW).source, "Unknown");
    assert.equal(classifyTouch({ utmSource: "not-a-network" }, NOW).source, "Referral");
  });

  it("does not call every Google tag organic search", () => {
    assert.equal(classifyTouch({ utmSource: "google", utmMedium: "organic", utmCampaign: "gulbarga" }, NOW).source, "Google Organic");
    assert.equal(classifyTouch({ utmSource: "google", utmMedium: "cpc", utmCampaign: "sedam" }, NOW).source, "Google Ads");
    assert.equal(classifyTouch({ utmSource: "google", utmMedium: "email", utmCampaign: "newsletter" }, NOW).source, "Referral");
    assert.equal(classifyTouch({ utmSource: "google", utmMedium: "email", utmCampaign: "newsletter" }, NOW).campaign, "newsletter");
    assert.equal(classifyTouch({ utmSource: "google", utmMedium: "display" }, NOW).source, "Referral");
    assert.equal(classifyTouch({ utmSource: "google" }, NOW).source, "Referral");
    assert.equal(classifyTouch({ referrer: "https://mail.google.com/mail/u/0/" }, NOW).source, "Referral");
    assert.equal(classifyTouch({ referrer: "https://www.google.co.in/search?q=house" }, NOW).source, "Google Organic");
    assert.equal(classifyTouch({ utmSource: "facebook", utmMedium: "social", utmCampaign: "page" }, NOW).source, "Referral");
    assert.equal(classifyTouch({ utmSource: "facebook", utmMedium: "organic" }, NOW).source, "Facebook Organic");
  });

  it("does not treat a claimed ChatGPT label as evidence", () => {
    const touch = classifyTouch({ landingPage: "/" }, NOW);
    assert.equal(touch.source, "Direct");
    assert.equal(classifyTouch({ utmSource: "chatgpt", utmCampaign: "assistant" }, NOW).source, "ChatGPT");
  });
});

describe("public website enquiries", () => {
  it("creates a new buyer requirement and keeps both touches", async () => {
    const database = await ready();
    const result = await submitRequirementEnquiry(database, buyer(), options("buyer-key-1"));
    const requirement = await database.prepare("SELECT * FROM demand_requirements WHERE id = ?1").bind(result.id).first<Record<string, unknown>>();
    const attribution = await database
      .prepare("SELECT * FROM acquisition_attributions WHERE entity_id = ?1")
      .bind(result.id)
      .first<Record<string, unknown>>();
    assert.equal(result.replayed, false);
    assert.match(result.code, /^GH-D/);
    assert.equal(requirement?.status, "New");
    assert.equal(requirement?.intent, "Buy");
    assert.equal(requirement?.timeline, "Immediate");
    const loaded = await getRequirement(database, result.id);
    assert.equal(loaded?.intentScore.factors.find((factor) => factor.label === "Urgency")?.points, 30);
    assert.equal(loaded?.intentScore.score, intentScore(loaded!).score);
    assert.equal(requirement?.quality_review ?? "", "");
    assert.equal(requirement?.created_by, WEBSITE_ACTOR.id);
    assert.equal(attribution?.first_source, "Google Organic");
    assert.equal(attribution?.last_source, "Google Ads");
    assert.equal(attribution?.last_campaign, "sedam-houses");
    assert.equal(attribution?.gclid, "gclid-abc_123");
    assert.equal(attribution?.conversion_channel, "website");
    assert.equal(attribution?.cta_placement, "property_card");
    assert.equal(attribution?.property_slug, "house-for-sale-sedam-road");
    assert.equal(attribution?.marketing_consent, 0);
    assert.equal(attribution?.first_touch_verified, 0);
    assert.equal(await count(database, "properties"), 0);
    assert.equal(await count(database, "owner_leads"), 0);
    assert.equal("gclid" in result, false);
  });

  it("creates a tenant requirement without an owner lead", async () => {
    const database = await ready();
    const result = await submitRequirementEnquiry(
      database,
      buyer({ intent: "Rent", propertyType: "Flat", budgetMin: 10000, budgetMax: 15000, timeline: "Within 30 days", tenantProfile: "Family" }),
      options("tenant-key-1"),
    );
    const requirement = await database.prepare("SELECT intent, status, budget_max FROM demand_requirements WHERE id = ?1").bind(result.id).first<{ intent: string; status: string; budget_max: number }>();
    assert.equal(requirement?.intent, "Rent");
    assert.equal(requirement?.status, "New");
    assert.equal(requirement?.budget_max, 15000);
    assert.equal(await count(database, "owner_leads"), 0);
  });

  it("ignores BHK for a plot and rejects a missing privacy acknowledgement", async () => {
    const database = await ready();
    const plot = await submitRequirementEnquiry(database, buyer({ propertyType: "Plot", bhkMin: 4, bhkMax: 5 }), options("plot-key-01"));
    const row = await database.prepare("SELECT bhk_min, bhk_max FROM demand_requirements WHERE id = ?1").bind(plot.id).first<{ bhk_min: number | null; bhk_max: number | null }>();
    assert.equal(row?.bhk_min, null);
    await assert.rejects(() => submitRequirementEnquiry(database, buyer({ privacyAccepted: false }), options("plot-key-02")), /Privacy Policy/);
    assert.equal(await count(database, "demand_requirements"), 1);
  });

  it("creates an owner lead with timeline priority and no property", async () => {
    const database = await ready();
    const hot = await submitOwnerEnquiry(
      database,
      {
        intent: "Sale",
        propertyType: "House",
        locality: "Jewargi Road",
        locationText: "Near the ring road",
        expectedPrice: 7500000,
        timeline: "Within 7 days",
        notes: "Corner plot facing.",
        name: "Ravi Patil",
        countryCode: "91",
        mobile: "9845098765",
        privacyAccepted: true,
        status: "Converted",
        priority: "Cold",
        attribution: { last: { landingPage: "/sell" } },
      },
      options("owner-key-01"),
    );
    const lead = await database.prepare("SELECT status, priority, notes FROM owner_leads WHERE id = ?1").bind(hot.id).first<{ status: string; priority: string; notes: string }>();
    assert.equal(lead?.status, "New");
    assert.equal(lead?.priority, "Hot");
    assert.match(lead?.notes ?? "", /Availability: Within 7 days/);
    assert.equal(await count(database, "properties"), 0);
    assert.equal(await count(database, "demand_requirements"), 0);

    const cold = await submitOwnerEnquiry(
      database,
      {
        intent: "Rent",
        propertyType: "Commercial",
        locality: "Super Market",
        timeline: "Exploring",
        name: "Ravi Patil",
        countryCode: "91",
        mobile: "9845098765",
        privacyAccepted: true,
        priority: "Hot",
      },
      options("owner-key-02"),
    );
    const later = await database.prepare("SELECT priority, status FROM owner_leads WHERE id = ?1").bind(cold.id).first<{ priority: string; status: string }>();
    assert.equal(later?.priority, "Cold");
    assert.equal(later?.status, "New");
    assert.equal(await count(database, "contacts"), 1);
  });

  it("stores a land JV enquiry without a requirement, owner lead, or property", async () => {
    const database = await ready();
    const result = await submitLandJvEnquiry(
      database,
      {
        name: "Shankar",
        countryCode: "91",
        mobile: "9845011111",
        village: "Kamalapur village",
        taluk: "Kalaburagi",
        district: "Kalaburagi",
        extent: "4",
        unit: "acres",
        ownership: "Self",
        rtc: "Yes",
        road: "Yes",
        coOwners: "Unsure",
        partnership: "Yes",
        notes: "Call after 6 pm",
        privacyAccepted: true,
        marketingConsent: true,
        attribution: { first: { referrer: "https://chatgpt.com/" }, last: { referrer: "https://chatgpt.com/" } },
      },
      options("land-key-001"),
    );
    const row = await database.prepare("SELECT status, village, answers_json FROM land_jv_enquiries WHERE id = ?1").bind(result.id).first<{ status: string; village: string; answers_json: string }>();
    const attribution = await database.prepare("SELECT first_source, marketing_consent FROM acquisition_attributions WHERE entity_id = ?1").bind(result.id).first<{ first_source: string; marketing_consent: number }>();
    assert.match(result.code, /^GH-L/);
    assert.equal(row?.status, "New");
    assert.equal(row?.village, "Kamalapur village");
    assert.match(row?.answers_json ?? "", /Kamalapur village/);
    assert.equal(attribution?.first_source, "ChatGPT");
    assert.equal(attribution?.marketing_consent, 1);
    assert.equal(await count(database, "owner_leads"), 0);
    assert.equal(await count(database, "demand_requirements"), 0);
    assert.equal(await count(database, "properties"), 0);
  });

  it("deduplicates an Indian contact and accepts an international number", async () => {
    const database = await ready();
    await submitRequirementEnquiry(database, buyer(), options("phone-key-01"));
    await submitRequirementEnquiry(database, buyer({ intent: "Rent", budgetMin: 8000, budgetMax: 12000 }), options("phone-key-02"));
    assert.equal(await count(database, "contacts"), 1);
    assert.equal(await count(database, "demand_requirements"), 2);

    const abroad = await submitRequirementEnquiry(
      database,
      buyer({ name: "John Smith", countryCode: "44", mobile: "7911123456", email: "" }),
      options("phone-key-03"),
    );
    const contact = await database.prepare("SELECT phone_e164 FROM contacts WHERE id = (SELECT contact_id FROM demand_requirements WHERE id = ?1)").bind(abroad.id).first<{ phone_e164: string }>();
    assert.equal(contact?.phone_e164, "+447911123456");
    assert.equal(normalizeContactPhone("+91 12345"), null);
    await assert.rejects(() => submitRequirementEnquiry(database, buyer({ countryCode: "91", mobile: "12345" }), options("phone-key-04")), /Indian mobile/);
  });

  it("rejects invalid input, a honeypot, and a failed human check without writing a lead", async () => {
    const database = await ready();
    await assert.rejects(() => submitRequirementEnquiry(database, buyer({ intent: "Lease" }), options("bad-key-0001")), /rent or buy/);
    await assert.rejects(() => submitRequirementEnquiry(database, buyer({ localities: [] }), options("bad-key-0002")), /locality/);
    await assert.rejects(() => submitRequirementEnquiry(database, buyer({ company: "bot" }), options("bad-key-0003")), /could not be submitted/);
    await assert.rejects(() => submitRequirementEnquiry(database, buyer(), options("bad-key-0004", { humanVerified: false })), /enquiry check failed/);
    assert.equal(await count(database, "demand_requirements"), 0);
  });

  it("returns the same record for a repeated submission key and limits the rate", async () => {
    const database = await ready();
    const first = await submitRequirementEnquiry(database, buyer(), options("same-key-01", { rateLimit: 2 }));
    const second = await submitRequirementEnquiry(database, buyer({ name: "Someone Else" }), options("same-key-01", { rateLimit: 2 }));
    assert.equal(second.id, first.id);
    assert.equal(second.replayed, true);
    assert.equal(await count(database, "demand_requirements"), 1);
    await submitRequirementEnquiry(database, buyer({ mobile: "9845022222", name: "Second Person" }), options("same-key-02", { rateLimit: 2 }));
    await assert.rejects(
      () => submitRequirementEnquiry(database, buyer({ mobile: "9845033333", name: "Third Person" }), options("same-key-03", { rateLimit: 2 })),
      /Too many enquiries/,
    );
    assert.equal(await count(database, "demand_requirements"), 2);
  });

  it("leaves an existing Meta lead source unchanged", async () => {
    const database = await ready();
    const source: SourceInput = {
      channel: "meta_lead_form",
      platform: "facebook",
      metaLeadId: "860000000000001",
      metaFormId: "1071121499253613",
      metaFormName: "Buyer form",
      metaCampaignId: "120257140076410091",
      metaCampaignName: "Buyer campaign",
      metaAdsetId: "adset1",
      metaAdsetName: "Ad set",
      metaAdId: "ad1",
      metaAdName: "Ad",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmContent: "",
      utmTerm: "",
      submittedAt: NOW,
      ingestionOrigin: "webhook",
    };
    const existing = await createRequirement(
      database,
      { id: "meta_lead_ads", email: "meta-lead-ads", role: "system" },
      { name: "Amina Khan", phone: "+919845012345" },
      { intent: "Buy", propertyTypes: ["House"], bhkMin: null, bhkMax: null, budgetMin: null, budgetMax: null, localities: ["Sedam Road"], localityFlexible: false, areaMin: null, furnishing: "Any", tenantProfile: "Any", vegetarian: "Any", parkingRequired: false, timeline: "Exploring", neededBy: null, notes: "" },
      source,
      NOW,
    );
    await submitRequirementEnquiry(database, buyer({ intent: "Rent", budgetMin: 9000, budgetMax: 11000 }), options("meta-safe-01"));
    const meta = await database.prepare("SELECT channel, meta_campaign_id, meta_form_id, meta_lead_id FROM lead_sources WHERE meta_lead_id = '860000000000001'").first<{ channel: string; meta_campaign_id: string; meta_form_id: string; meta_lead_id: string }>();
    assert.equal(meta?.channel, "meta_lead_form");
    assert.equal(meta?.meta_campaign_id, "120257140076410091");
    assert.equal(meta?.meta_form_id, "1071121499253613");
    const website = await database.prepare("SELECT channel, meta_lead_id FROM lead_sources WHERE id = (SELECT source_id FROM demand_requirements WHERE id != ?1)").bind(existing.id).first<{ channel: string; meta_lead_id: string | null }>();
    assert.equal(website?.channel, "website");
    assert.equal(website?.meta_lead_id, null);
    assert.equal(await count(database, "contacts"), 1);
  });

  it("fails closed when Turnstile does not confirm a person", async () => {
    assert.equal(await verifyTurnstile("", "secret", ""), false);
    assert.equal(await verifyTurnstile("token", "", ""), false);
    assert.equal(
      await verifyTurnstile("token", "secret", "203.0.113.8", async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
      true,
    );
    assert.equal(
      await verifyTurnstile("token", "secret", "", async () => new Response(JSON.stringify({ success: false }), { status: 200 })),
      false,
    );
  });

  it("returns the original requirement when attribution fails and the same key is retried", async () => {
    const database = await ready();
    const key = "atomic-key-01";
    await assert.rejects(() => submitRequirementEnquiry(failAttribution(database, "rollback"), buyer(), options(key)), /attribution failed/);
    const reserved = await database
      .prepare("SELECT planned_entity_id, entity_id FROM public_enquiry_keys WHERE idempotency_key = ?1")
      .bind(key)
      .first<{ planned_entity_id: string; entity_id: string }>();
    assert.ok(reserved?.planned_entity_id);
    assert.equal(reserved?.entity_id, "");
    assert.equal(await count(database, "demand_requirements"), 0);
    assert.equal(await count(database, "public_enquiry_keys"), 1);

    const retry = await submitRequirementEnquiry(database, buyer({ name: "Another Name" }), options(key));
    assert.equal(retry.id, reserved?.planned_entity_id);
    assert.equal(retry.replayed, false);
    assert.equal(await count(database, "demand_requirements"), 1);
    const again = await submitRequirementEnquiry(database, buyer(), options(key));
    assert.equal(again.id, retry.id);
    assert.equal(again.replayed, true);
    assert.equal(await count(database, "demand_requirements"), 1);
    assert.equal(await count(database, "acquisition_attributions"), 1);
  });

  it("keeps the created requirement when attribution is committed separately and the retry finishes it", async () => {
    const database = await ready();
    const key = "partial-key-1";
    await assert.rejects(() => submitRequirementEnquiry(failAttribution(database, "partial"), buyer(), options(key)), /attribution failed/);
    assert.equal(await count(database, "demand_requirements"), 1);
    assert.equal(await count(database, "public_enquiry_keys"), 1);
    const reserved = await database
      .prepare("SELECT planned_entity_id, entity_id FROM public_enquiry_keys WHERE idempotency_key = ?1")
      .bind(key)
      .first<{ planned_entity_id: string; entity_id: string }>();
    const retry = await submitRequirementEnquiry(database, buyer(), options(key));
    assert.equal(retry.replayed, true);
    assert.equal(retry.id, reserved?.planned_entity_id);
    assert.equal(await count(database, "demand_requirements"), 1);
    assert.equal(await count(database, "acquisition_attributions"), 1);
    const saved = await database.prepare("SELECT entity_id FROM public_enquiry_keys WHERE idempotency_key = ?1").bind(key).first<{ entity_id: string }>();
    assert.equal(saved?.entity_id, retry.id);
  });

  it("allows only one requirement when two submissions share an idempotency key", async () => {
    const database = await ready();
    const results = await Promise.allSettled([
      submitRequirementEnquiry(database, buyer(), options("race-key-001")),
      submitRequirementEnquiry(database, buyer({ name: "Second Click" }), options("race-key-001")),
    ]);
    assert.equal(await count(database, "demand_requirements"), 1);
    const ids = results.flatMap((result) => (result.status === "fulfilled" ? [result.value.id] : []));
    assert.ok(ids.length >= 1);
    assert.ok(ids.every((id) => id === ids[0]));
    const rejected = results.filter((result) => result.status === "rejected");
    assert.ok(rejected.every((result) => result.reason instanceof Error && /already being submitted|already used/.test(result.reason.message)));
  });

  it("trusts only a Cloudflare client IP", async () => {
    const normal = new Headers({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.9" });
    assert.equal(trustedClientIp(normal), "203.0.113.8");
    assert.equal(trustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.8" })), null);
    assert.equal(trustedClientIp(new Headers()), null);
    assert.equal(trustedClientIp(new Headers({ "cf-connecting-ip": "unknown" })), null);
    assert.equal(trustedClientIp(new Headers({ "cf-connecting-ip": "203.0.113.8, 198.51.100.9" })), null);
    assert.equal(trustedClientIp(new Headers({ "cf-connecting-ip": "999.1.1.1" })), null);
    assert.equal(trustedClientIp(new Headers({ "cf-connecting-ip": "203.0.113" })), null);
    assert.equal(trustedClientIp(new Headers({ "cf-connecting-ip": "::" })), null);
    assert.equal(trustedClientIp(new Headers({ "cf-connecting-ip": "2001:db8::1" })), "2001:db8::1");
    assert.notEqual(await hashClientIp("203.0.113.8"), await hashClientIp("198.51.100.9"));
  });

  it("keeps a signed first touch when a later visit and a submitted form disagree", async () => {
    const secret = "attribution-test-secret";
    const first = await nextAttributionCookie(
      null,
      new URL("https://gulbargahomes.com/?utm_source=google&utm_medium=cpc&utm_campaign=sedam&gclid=click-1"),
      "https://www.google.com/search?q=house",
      secret,
      NOW,
    );
    const second = await nextAttributionCookie(first, new URL("https://gulbargahomes.com/contact"), null, secret, NOW);
    const opened = await openAttribution(second, secret, NOW);
    assert.equal(classifyTouch(opened?.first, NOW).source, "Google Ads");
    assert.equal(classifyTouch(opened?.first, NOW).campaign, "sedam");
    assert.equal(opened?.first.gclid, "click-1");
    assert.equal(classifyTouch(opened?.last, NOW).source, "Direct");
    assert.equal(await openAttribution(second, secret, "2027-03-01T00:00:00.000Z"), null);
    assert.equal(await openAttribution(`${second?.slice(0, -1)}${second?.endsWith("a") ? "b" : "a"}`, secret, NOW), null);
    assert.equal(await openAttribution("v1.not-json.sig", secret, NOW), null);

    const database = await ready();
    const result = await submitRequirementEnquiry(
      database,
      buyer({
        attribution: {
          first: { referrer: "https://chatgpt.com/c/1", landingPage: "/" },
          last: { landingPage: "/contact" },
          enquiryPage: "/contact",
          cta: "footer",
        },
      }),
      { ...options("cookie-key-1"), attributionCookie: second, attributionSecret: secret },
    );
    const attribution = await database
      .prepare("SELECT first_source, last_source, first_campaign, gclid, conversion_channel, first_touch_verified FROM acquisition_attributions WHERE entity_id = ?1")
      .bind(result.id)
      .first<{ first_source: string; last_source: string; first_campaign: string; gclid: string; conversion_channel: string; first_touch_verified: number }>();
    assert.equal(attribution?.first_source, "Google Ads");
    assert.equal(attribution?.first_touch_verified, 1);
    assert.equal(attribution?.first_campaign, "sedam");
    assert.equal(attribution?.gclid, "click-1");
    assert.equal(attribution?.last_source, "Direct");
    assert.equal(attribution?.conversion_channel, "website");
  });

  it("keeps admin creation routes behind a sign-in", () => {
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-test-module-mocks", "--import", "tsx", "tests/helpers/admin-lock-check.ts"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
