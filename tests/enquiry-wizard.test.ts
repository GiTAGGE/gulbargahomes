import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET as attributionRoute } from "../app/api/enquiries/attribution/route";
import { classifyTouch } from "../lib/enquiry/attribution";
import { turnstileSiteKey } from "../lib/enquiry/site-key";
import { establishAttribution, nextAttributionCookie, openAttribution } from "../lib/enquiry/cookie";
import { preferenceQuestions, questionsFor } from "../lib/enquiry/questions";
import {
  UNVERIFIED_ATTRIBUTION_NOTICE,
  draftFromLaunch,
  emptyDraft,
  enquiryHandoff,
  finishSave,
  newIdempotencyKey,
  ownerPayload,
  requirementPayload,
  selectRequirement,
  startSave,
  stepError,
  stepsFor,
  summaryLines,
  whatsAppSummary,
  type SaveGate,
  type WizardDraft,
} from "../lib/enquiry/wizard";

const NOW = "2026-11-13T05:00:00.000Z";
const SECRET = "test-attribution-secret";

describe("enquiry wizard", () => {
  it("prefills a listing without locking the answers", () => {
    const draft = draftFromLaunch({
      cta: "property_card",
      propertySlug: "house-for-sale-sedam-road",
      propertyTitle: "House on Sedam Road",
      listing: "Sale",
      propertyType: "House",
      locality: "Sedam Road",
      bhk: 3,
    });
    assert.equal(draft.path, "buyer");
    assert.equal(draft.intent, "Buy");
    assert.equal(draft.propertyType, "House");
    assert.deepEqual(draft.localities, ["Sedam Road"]);
    draft.intent = "Rent";
    draft.propertyType = "Plot";
    const payload = requirementPayload(draft, { cta: "property_card", propertySlug: "house-for-sale-sedam-road", listing: "Sale", locality: "Sedam Road" }, "idempotency-key-1", "turnstile");
    assert.equal(payload.intent, "Rent");
    assert.equal(payload.propertyType, "Plot");
    assert.equal(payload.bhkMin, null);
    assert.equal(payload.budgetMin, null);
    assert.equal(payload.attribution.propertySlug, "house-for-sale-sedam-road");
    assert.equal(payload.attribution.listingIntent, "Buy");
    assert.equal("first" in payload.attribution, false);
    assert.equal("status" in payload, false);
    assert.equal("priority" in payload, false);
  });

  it("asks a tenant for a profile and an owner for a shorter path", () => {
    const buyer = emptyDraft();
    buyer.path = "buyer";
    buyer.intent = "Rent";
    assert.ok(stepsFor(buyer).includes("preferences"));
    const owner = emptyDraft();
    owner.path = "owner";
    assert.equal(stepsFor(owner).includes("preferences"), false);
  });

  it("keeps one idempotency key and requires the privacy acknowledgement", () => {
    const draft = emptyDraft();
    draft.path = "buyer";
    draft.intent = "Buy";
    draft.propertyType = "Flat";
    draft.localities = ["Azadpur"];
    draft.timeline = "Exploring";
    draft.name = "Asha";
    draft.mobile = "9876543210";
    assert.match(stepError(draft, "contact") ?? "", /acknowledge/);
    draft.privacyAccepted = true;
    assert.equal(stepError(draft, "contact"), null);
    const first = newIdempotencyKey();
    const second = first;
    const payload = requirementPayload(draft, { cta: "contact_page" }, second, "token");
    assert.equal(payload.idempotencyKey, first);
    assert.equal(payload.conversionChannel, "website");
    assert.equal(payload.countryCode, "91");
    assert.equal(payload.mobile, "9876543210");
  });

  it("builds an owner payload and a WhatsApp summary the visitor still has to send", () => {
    const draft = emptyDraft();
    draft.path = "owner";
    draft.ownerIntent = "Sale";
    draft.propertyType = "House";
    draft.otherLocality = "Kusnoor";
    draft.timeline = "Within 7 days";
    draft.budgetMin = "4500000";
    draft.notes = "Corner plot";
    draft.name = "Ravi";
    draft.mobile = "9876543210";
    const payload = ownerPayload(draft, { cta: "footer" }, "owner-key-1234", "token");
    assert.equal(payload.intent, "Sale");
    assert.equal(payload.expectedPrice, 4500000);
    assert.equal(payload.locality, "Kusnoor");
    assert.equal("priority" in payload, false);
    assert.equal("preferences" in payload, false);
    const summary = whatsAppSummary("GH-O0001", summaryLines(draft));
    assert.match(summary, /GH-O0001/);
    assert.match(summary, /sending this message myself/);
    assert.doesNotMatch(summary, /already sent/i);
  });

  it("shows the CRM reference in a WhatsApp link the visitor still has to open", () => {
    const draft = emptyDraft();
    draft.path = "buyer";
    draft.intent = "Buy";
    draft.propertyType = "House";
    draft.localities = ["Sedam Road"];
    draft.timeline = "Exploring";
    const handoff = enquiryHandoff("GH-D0007", draft);
    assert.equal(handoff.opensAutomatically, false);
    assert.equal(handoff.code, "GH-D0007");
    assert.match(handoff.summary, /GH-D0007/);
    assert.match(handoff.summary, /Sedam Road/);
    assert.match(handoff.summary, /Exploring/);
    assert.ok(handoff.links.length >= 1);
    for (const link of handoff.links) {
      const url = new URL(link.href);
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "wa.me");
      assert.match(decodeURIComponent(url.searchParams.get("text") ?? ""), /GH-D0007/);
      assert.match(decodeURIComponent(url.searchParams.get("text") ?? ""), /Sedam Road/);
      assert.equal(link.href.startsWith("javascript:"), false);
    }
    assert.match(UNVERIFIED_ATTRIBUTION_NOTICE, /unverified/);
  });

  it("keeps the same submission key when a save is repeated", () => {
    const gate: SaveGate = { phase: "idle", key: "repeat-key-01" };
    const first = startSave(gate);
    assert.ok(first);
    assert.equal(startSave(first), null);
    const retry = finishSave(first, false);
    assert.equal(retry.phase, "idle");
    assert.equal(retry.key, "repeat-key-01");
    const second = startSave(retry);
    assert.equal(second?.key, "repeat-key-01");
    const saved = finishSave(second!, true);
    assert.equal(saved.phase, "saved");
    assert.equal(startSave(saved), null);
  });

  it("gives the enquiry wizard the Turnstile site key from the Worker binding", async () => {
    const binding = "NEXT_PUBLIC_" + "TURNSTILE_SITE_KEY";
    const previous = process.env[binding];
    process.env[binding] = "site-key-from-worker";
    try {
      assert.equal(turnstileSiteKey(), "site-key-from-worker");
      const response = await attributionRoute(new Request("https://gulbargahomes.com/api/enquiries/attribution"));
      const body = (await response.json()) as { established?: boolean; siteKey?: string };
      assert.equal(response.status, 200);
      assert.equal(body.siteKey, "site-key-from-worker");
      assert.equal(body.established, false);
    } finally {
      if (previous === undefined) delete process.env[binding];
      else process.env[binding] = previous;
    }
    assert.equal(turnstileSiteKey(), (previous ?? "").trim());
  });

  it("establishes a signed first touch before a visitor can replace it", async () => {
    const missing = await establishAttribution(null, "", "https://gulbargahomes.com/contact", "https://www.google.com/", NOW);
    assert.equal(missing.established, false);
    assert.equal(missing.sealed, null);

    const started = await establishAttribution(
      null,
      SECRET,
      "https://gulbargahomes.com/api/enquiries/attribution",
      "https://gulbargahomes.com/properties/house-for-sale-sedam-road",
      NOW,
    );
    assert.equal(started.established, true);
    const opened = await openAttribution(started.sealed, SECRET, NOW);
    assert.ok(opened);
    assert.equal(classifyTouch(opened.first, NOW).source, "Direct");

    const known = await nextAttributionCookie(
      null,
      new URL("https://gulbargahomes.com/?gclid=click-1&utm_source=google"),
      "https://www.google.com/",
      SECRET,
      NOW,
    );
    const again = await establishAttribution(known, SECRET, "https://gulbargahomes.com/contact", "https://evil.example/replace", NOW);
    assert.equal(again.established, true);
    assert.equal(again.sealed, null);
    const preserved = await openAttribution(known, SECRET, NOW);
    assert.ok(preserved);
    assert.equal(classifyTouch(preserved.first, NOW).source, "Google Ads");
  });

  it("asks a plot renter about the plot and not about furnishing or tenants", () => {
    assert.deepEqual(
      questionsFor("Rent", "Plot").map((question) => question.key),
      ["budget", "intendedUse", "plotArea", "roadAccess", "leaseDuration", "notes"],
    );
    assert.equal(questionsFor("Rent", "Plot").some((question) => question.label === "Monthly rent budget"), true);
    const hidden = preferenceQuestions("Rent", "Plot").map((question) => question.key);
    assert.equal(hidden.includes("furnishing"), false);
    assert.equal(hidden.includes("bhk"), false);
    assert.equal(hidden.includes("tenantProfile"), false);
    assert.equal(hidden.includes("parking"), false);
    const draft = plotDraft();
    draft.furnishing = "Fully Furnished";
    draft.tenantProfile = "Family";
    draft.bhkMin = "3";
    draft.parking = "Yes";
    const payload = requirementPayload(draft, { cta: "contact_page" }, "plot-rent-key", "token");
    assert.equal(payload.furnishing, "Any");
    assert.equal(payload.tenantProfile, "Any");
    assert.equal(payload.bhkMin, null);
    assert.equal(payload.parkingRequired, false);
    assert.deepEqual(payload.preferences, {
      intendedUse: "Residential",
      plotArea: "30x40",
      roadAccess: "40 ft road",
      leaseDuration: "11 months",
    });
  });

  it("asks a plot buyer about purchase budget, access and title", () => {
    const questions = questionsFor("Buy", "Plot");
    assert.deepEqual(
      questions.map((question) => question.key),
      ["budget", "intendedUse", "plotArea", "roadAccess", "approvalPreference", "notes"],
    );
    assert.equal(questions[0]?.label, "Total purchase budget");
    assert.equal(questions.some((question) => question.key === "leaseDuration" || question.key === "furnishing"), false);
  });

  it("asks a flat renter for bedrooms, furnishing, tenant and parking", () => {
    assert.deepEqual(
      preferenceQuestions("Rent", "Flat").map((question) => question.key),
      ["bhk", "furnishing", "tenantProfile", "parking", "areaMin", "notes"],
    );
  });

  it("asks a commercial renter about use, area, floor, frontage, parking and lease", () => {
    assert.deepEqual(
      preferenceQuestions("Rent", "Commercial").map((question) => question.key),
      ["commercialUse", "areaMin", "floorPreference", "roadAccess", "parking", "leaseDuration"],
    );
    assert.equal(preferenceQuestions("Rent", "Commercial").some((question) => question.key === "furnishing"), false);
  });

  it("asks a PG seeker about occupants, sharing and facilities", () => {
    assert.deepEqual(
      preferenceQuestions("Rent", "PG").map((question) => question.key),
      ["occupantType", "sharing", "furnishing", "facilities", "notes"],
    );
    assert.equal(preferenceQuestions("Buy", "PG").some((question) => question.key === "bhk" || question.key === "tenantProfile"), false);
  });

  it("asks a house buyer for bedrooms, area, parking and furnishing", () => {
    const questions = questionsFor("Buy", "House");
    assert.equal(questions.find((question) => question.key === "budget")?.label, "Total purchase budget");
    assert.deepEqual(
      preferenceQuestions("Buy", "House").map((question) => question.key),
      ["bhk", "areaMin", "parking", "furnishing", "notes"],
    );
    assert.equal(preferenceQuestions("Buy", "House").some((question) => question.key === "tenantProfile"), false);
  });

  it("clears plot-only answers when the property type becomes a flat and keeps shared answers", () => {
    const plot = plotDraft();
    plot.notes = "Corner preferred";
    plot.budgetMin = "5000";
    plot.budgetMax = "10000";
    const flat = selectRequirement(plot, { propertyType: "Flat" });
    assert.equal(flat.propertyType, "Flat");
    assert.equal(flat.intendedUse, "");
    assert.equal(flat.plotArea, "");
    assert.equal(flat.roadAccess, "");
    assert.equal(flat.leaseDuration, "");
    assert.equal(flat.notes, "Corner preferred");
    assert.deepEqual(flat.localities, ["High Court"]);
    assert.equal(flat.budgetMax, "10000");
    assert.equal(flat.timeline, "Within 7 days");
    const backToPlot = selectRequirement(flat, { propertyType: "Plot" });
    assert.equal(backToPlot.notes, "Corner preferred");
    assert.equal(backToPlot.furnishing, "Any");
  });

  it("keeps applicable answers when the visitor goes back a step", () => {
    const draft = plotDraft();
    const steps = stepsFor(draft);
    const preferences = steps.indexOf("preferences");
    const previous = preferences - 1;
    assert.ok(previous >= 0);
    assert.equal(steps[previous], "budget");
    assert.equal(draft.intendedUse, "Residential");
    assert.equal(draft.plotArea, "30x40");
    assert.equal(draft.roadAccess, "40 ft road");
    assert.equal(selectRequirement(draft, { intent: "Rent", propertyType: "Plot" }).plotArea, "30x40");
  });
});

function plotDraft(): WizardDraft {
  const draft = selectRequirement(emptyDraft(), { intent: "Rent", propertyType: "Plot" });
  draft.path = "buyer";
  draft.localities = ["High Court"];
  draft.timeline = "Within 7 days";
  draft.intendedUse = "Residential";
  draft.plotArea = "30x40";
  draft.roadAccess = "40 ft road";
  draft.leaseDuration = "11 months";
  return draft;
}
