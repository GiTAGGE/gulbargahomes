import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyTouch } from "../lib/enquiry/attribution";
import { establishAttribution, nextAttributionCookie, openAttribution } from "../lib/enquiry/cookie";
import {
  UNVERIFIED_ATTRIBUTION_NOTICE,
  draftFromLaunch,
  emptyDraft,
  enquiryHandoff,
  finishSave,
  newIdempotencyKey,
  ownerPayload,
  requirementPayload,
  startSave,
  stepError,
  stepsFor,
  summaryLines,
  whatsAppSummary,
  type SaveGate,
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
});
