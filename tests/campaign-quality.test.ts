import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { HttpError } from "../lib/admin/errors";
import { can } from "../lib/admin/permissions";
import { findContactByPhone } from "../lib/crm/contacts";
import { addClientRequirements } from "../lib/crm/owner-client";
import { convertOwnerLead, createOwnerLead, getOwnerLead, listOwnerLeads, setOwnerLeadRoleReview } from "../lib/crm/owner-leads";
import { maskPhone } from "../lib/crm/phone";
import { campaignQuality, parseQualityQuery, qualityLabel } from "../lib/crm/quality";
import { createRequirement, getRequirement, parseRequirementInput, setRequirementQuality } from "../lib/crm/requirements";
import { mergeCoverageRanges, rangeCovered } from "../lib/crm/spend-coverage";
import { getSource, parseSourceInput } from "../lib/crm/sources";
import { todayQueue } from "../lib/crm/today";
import { prepareDatabase } from "../lib/db/prepare";
import { saveAdAccount } from "../lib/meta/connection";
import { createTestDb } from "./helpers/sqlite";

const executive = { id: "adm_exec", email: "leads@example.com", role: "lead_executive" };
const NOW = "2026-11-11T16:00:00.000Z";
const NOV = "2026-11-02T06:00:00.000Z";
const OCT = "2026-10-15T06:00:00.000Z";

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

function ownerInput(intent: "Rent" | "Sale" = "Rent") {
  return {
    intent,
    propertyType: "House" as const,
    locality: "Sedam Road",
    locationText: "",
    expectedPrice: 20000,
    notes: "",
    priority: "Warm" as const,
  };
}

async function metaOwner(
  db: Awaited<ReturnType<typeof setup>>,
  person: { name: string; phone: string },
  meta: Record<string, string>,
  submittedAt = NOV,
) {
  return createOwnerLead(
    db,
    executive,
    person,
    ownerInput(),
    parseSourceInput({ channel: "meta_lead_form", submittedAt, ...meta }),
    NOW,
  );
}

describe("campaign quality", () => {
  it("counts a confirmed owner as genuine and leaves a blank review pending", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "Akhil Ahmed Khan", phone: "9845011111" }, {
      metaLeadId: "meta-genuine",
      metaCampaignId: "camp-a",
      metaCampaignName: "Owner campaign",
      metaFormId: "form-owner",
      metaFormName: "Owner form",
    });
    const before = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(before.summary.submissions, 1);
    assert.equal(before.summary.genuineOwners, 0);
    assert.equal(before.summary.pending, 1);
    assert.equal(before.summary.qualityLabel, qualityLabel(0, 0, 1));
    assert.equal(before.groups[0]?.qualityLabel, "0 reviewed, 1 pending");

    const confirmed = await setOwnerLeadRoleReview(db, executive, lead, "genuine", "He has a house to let", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });
    assert.equal(confirmed.roleReview, "genuine");
    assert.equal(confirmed.status, "New");
    const report = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(report.summary.genuineOwners, 1);
    assert.equal(report.summary.pending, 0);
    assert.equal(report.summary.qualityLabel, "1/1 reviewed (100%), 0 pending");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);
  });

  it("keeps a misclassified owner out of genuine opportunities and out of the open queue", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "Akhil Ahmed Khan", phone: "9845011111" }, {
      metaLeadId: "meta-mis",
      metaCampaignId: "camp-a",
      metaCampaignName: "Owner campaign",
    });
    const marked = await setOwnerLeadRoleReview(db, executive, lead, "misclassified", "He wants a rental house", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });
    const report = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(report.summary.genuineOwners, 0);
    assert.equal(report.summary.misclassified, 1);
    assert.equal(report.summary.reviewedOpportunities, 1);
    assert.equal(report.summary.qualityLabel, "0/1 reviewed (0%), 0 pending");
    assert.equal((await listOwnerLeads(db, {})).some((item) => item.id === lead.id), false);
    assert.equal((await todayQueue(db, { includeDiscreet: false }, new Date(NOW))).newOwnerLeads.some((item) => item.id === lead.id), false);
    await assert.rejects(convertOwnerLead(db, executive, marked, { now: NOW }), /not an owner/);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);
  });

  it("counts buyer and tenant requirements separately, including two for one person", async () => {
    const db = await setup();
    const buyer = await createRequirement(
      db,
      executive,
      { name: "Meher Banu", phone: "9845033333" },
      parseRequirementInput({ intent: "Buy", budgetMax: 4000000, localities: ["Sedam Road"] }),
      parseSourceInput({
        channel: "meta_lead_form",
        metaLeadId: "meta-buy",
        metaCampaignId: "camp-buy",
        metaCampaignName: "Buyer campaign",
        submittedAt: NOV,
      }),
      NOW,
    );
    const tenant = await createRequirement(
      db,
      executive,
      { name: "Meher Banu", phone: "9845033333" },
      parseRequirementInput({ intent: "Rent", budgetMax: 15000, localities: ["Sedam Road"] }),
      parseSourceInput({
        channel: "meta_lead_form",
        metaLeadId: "meta-rent",
        metaCampaignId: "camp-buy",
        metaCampaignName: "Buyer campaign",
        submittedAt: NOV,
      }),
      NOW,
    );
    await setRequirementQuality(db, executive, buyer, "genuine", "Ready to buy", { now: NOW, expectedVersion: buyer.rowVersion });
    await setRequirementQuality(db, executive, tenant, "genuine", "Also needs a rental", {
      now: NOW,
      expectedVersion: tenant.rowVersion,
    });
    const report = await campaignQuality(db, parseQualityQuery({ campaign: "camp-buy" }));
    assert.equal(report.summary.submissions, 2);
    assert.equal(report.summary.uniqueContacts, 1);
    assert.equal(report.summary.genuineBuyers, 1);
    assert.equal(report.summary.genuineTenants, 1);
    assert.equal(report.summary.genuineOpportunities, 2);
    assert.equal(report.summary.buyerAndTenant, 1);
    assert.equal(report.summary.qualityLabel, "2/2 reviewed (100%), 0 pending");
  });

  it("attributes a requirement added from an owner lead without a second submission or a changed Meta source", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "Akhil Ahmed Khan", phone: "9845011111" }, {
      metaLeadId: "meta-origin",
      metaCampaignId: "camp-owner",
      metaCampaignName: "Owner campaign",
      metaAdsetId: "set-1",
      metaAdsetName: "Sedam",
      metaAdId: "ad-1",
      metaAdName: "House ad",
    }, OCT);
    const sourceBefore = await getSource(db, lead.sourceId);
    const added = await addClientRequirements(
      db,
      executive,
      lead.id,
      {
        idempotencyKey: "tenant-from-owner",
        requirements: [
          parseRequirementInput({ intent: "Rent", budgetMax: 15000, localities: ["Sedam Road"], notes: "Looking for a house" }),
        ],
      },
      NOW,
    );
    const requirement = added.requirements[0];
    assert.equal(requirement.originOwnerLeadId, lead.id);
    assert.equal((await getSource(db, requirement.sourceId))?.metaCampaignId, "");
    await setOwnerLeadRoleReview(db, executive, lead, "misclassified", "He is the tenant", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });
    const reviewed = await getRequirement(db, requirement.id);
    await setRequirementQuality(db, executive, reviewed!, "genuine", "Confirmed tenant", {
      now: NOW,
      expectedVersion: reviewed!.rowVersion,
    });

    const october = await campaignQuality(db, parseQualityQuery({ from: "2026-10-01", to: "2026-10-31" }));
    assert.equal(october.summary.submissions, 1);
    assert.equal(october.summary.genuineTenants, 1);
    assert.equal(october.summary.misclassified, 1);
    assert.equal(october.summary.uniqueContacts, 1);
    assert.equal(october.groups[0]?.id, "camp-owner");
    const november = await campaignQuality(db, parseQualityQuery({ from: "2026-11-01", to: "2026-11-30" }));
    assert.equal(november.summary.submissions, 0);
    assert.equal(november.summary.genuineTenants, 0);
    assert.deepEqual(await getSource(db, lead.sourceId), sourceBefore);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lead_sources WHERE meta_lead_id IS NOT NULL").first<{ n: number }>())?.n, 1);
  });

  it("counts one person as one contact when they have an owner lead and a seeker requirement", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "Akhil Ahmed Khan", phone: "9845011111" }, {
      metaLeadId: "meta-both-roles",
      metaCampaignId: "camp-owner",
      metaCampaignName: "Owner campaign",
    });
    const confirmed = await setOwnerLeadRoleReview(db, executive, lead, "genuine", "He owns one house", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });
    const added = await addClientRequirements(
      db,
      executive,
      lead.id,
      {
        idempotencyKey: "seeker-too",
        requirements: [parseRequirementInput({ intent: "Buy", budgetMax: 5000000, localities: ["Alang Road"] })],
      },
      NOW,
    );
    const requirement = await setRequirementQuality(db, executive, added.requirements[0], "genuine", "He also wants to buy", {
      now: NOW,
      expectedVersion: added.requirements[0].rowVersion,
    });
    const report = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(report.summary.submissions, 1);
    assert.equal(report.summary.uniqueContacts, 1);
    assert.equal(report.summary.genuineOwners, 1);
    assert.equal(report.summary.genuineBuyers, 1);
    assert.equal(report.summary.genuineOpportunities, 2);
    assert.equal(report.summary.ownerAndSeeker, 1);
    assert.equal(confirmed.roleReview, "genuine");
    assert.equal(requirement.qualityReview, "genuine");
    assert.equal((await findContactByPhone(db, "9845011111"))?.isOwner, true);
    assert.equal((await findContactByPhone(db, "9845011111"))?.isSeeker, true);
  });

  it("counts several Meta leads for one person as several submissions and one contact", async () => {
    const db = await setup();
    const first = await metaOwner(db, { name: "Akhil Ahmed Khan", phone: "9845011111" }, {
      metaLeadId: "meta-1",
      metaCampaignId: "camp-a",
      metaCampaignName: "A",
    });
    const second = await metaOwner(db, { name: "Akhil Ahmed Khan", phone: "9845011111" }, {
      metaLeadId: "meta-2",
      metaCampaignId: "camp-a",
      metaCampaignName: "A",
    });
    await setOwnerLeadRoleReview(db, executive, first, "genuine", "First house", { now: NOW, expectedVersion: first.rowVersion });
    await setOwnerLeadRoleReview(db, executive, second, "pending", "Second form is the same person", {
      now: NOW,
      expectedVersion: second.rowVersion,
    });
    const report = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(report.summary.submissions, 2);
    assert.equal(report.summary.uniqueContacts, 1);
    assert.equal(report.summary.genuineOwners, 1);
    assert.equal(report.summary.pending, 1);
    assert.equal(report.summary.qualityLabel, "1/1 reviewed (100%), 1 pending");
  });

  it("puts a lead with no campaign id in Unattributed and does not invent spend", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "No Campaign", phone: "9845044444" }, {
      metaLeadId: "meta-blank",
      metaCampaignId: "",
      metaFormId: "form-x",
      metaFormName: "Loose form",
    });
    await setOwnerLeadRoleReview(db, executive, lead, "genuine", "Confirmed on the phone", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });
    const report = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(report.groups[0]?.id, "");
    assert.equal(report.groups[0]?.name, "Unattributed");
    assert.equal(report.groups[0]?.spendLabel, "Not imported");
    assert.equal(report.groups[0]?.costLabel, "N/A");
    assert.equal(report.summary.spendLabel, "Not imported");
    assert.equal(report.summary.costPerOpportunity, "N/A");
    const drilled = await campaignQuality(db, parseQualityQuery({ campaign: "unattributed" }));
    assert.equal(drilled.records.length, 1);
    assert.equal(drilled.records[0]?.name, "No Campaign");
  });

  it("shows ₹0 when imported spend is zero, N/A when spend is missing, and a rupee cost when spend is imported", async () => {
    const db = await setup();
    const paid = await metaOwner(db, { name: "Paid Lead", phone: "9845055555" }, {
      metaLeadId: "meta-paid",
      metaCampaignId: "camp-paid",
      metaCampaignName: "Paid",
    });
    const free = await metaOwner(db, { name: "Zero Lead", phone: "9845066666" }, {
      metaLeadId: "meta-zero",
      metaCampaignId: "camp-zero",
      metaCampaignName: "Zero",
    });
    await setOwnerLeadRoleReview(db, executive, paid, "genuine", "Real owner", { now: NOW, expectedVersion: paid.rowVersion });
    await setOwnerLeadRoleReview(db, executive, free, "genuine", "Also real", { now: NOW, expectedVersion: free.rowVersion });
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'camp-paid', '2026-11-02', 'INR', 250000, 'test', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'camp-zero', '2026-11-02', 'INR', 0, 'test', ?1, 'x')`,
      )
      .bind(NOW)
      .run();

    const paidReport = await campaignQuality(db, parseQualityQuery({ campaign: "camp-paid" }));
    assert.equal(paidReport.summary.spendLabel, "₹2,500");
    assert.equal(paidReport.summary.costPerOpportunity, "₹2,500");
    assert.equal(paidReport.summary.costPerOwner, "₹2,500");
    const zero = await campaignQuality(db, parseQualityQuery({ campaign: "camp-zero" }));
    assert.equal(zero.summary.spendLabel, "₹0");
    assert.equal(zero.summary.costPerOpportunity, "₹0");
    assert.equal(zero.summary.costPerOwner, "₹0");
    const missing = await campaignQuality(db, parseQualityQuery({ campaign: "camp-missing" }));
    assert.equal(missing.summary.spendLabel, "Not imported");
    assert.equal(missing.summary.costPerLead, "N/A");
  });

  it("does not count a repeated Meta delivery as another lead", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "Once", phone: "9845077777" }, {
      metaLeadId: "meta-once",
      metaCampaignId: "camp-once",
      metaCampaignName: "Once",
    });
    await assert.rejects(
      metaOwner(db, { name: "Once", phone: "9845077777" }, { metaLeadId: "meta-once", metaCampaignId: "camp-once" }),
      (error: unknown) => error instanceof HttpError && error.status === 409,
    );
    await db
      .prepare(
        `INSERT INTO meta_lead_ingestions (id, leadgen_id, origin, status, next_attempt_at, deliveries, received_at, updated_at)
         VALUES ('ing_repeat', 'meta-once-delivery', 'webhook', 'duplicate', ?1, 4, ?1, ?1)`,
      )
      .bind(NOW)
      .run();
    const report = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(report.summary.submissions, 1);
    assert.equal(report.summary.uniqueContacts, 1);
    assert.equal((await getOwnerLead(db, lead.id))?.status, "New");
  });

  it("leaves pending reviews out of the quality rate", async () => {
    const db = await setup();
    const genuine = await metaOwner(db, { name: "Genuine", phone: "9845088881" }, { metaLeadId: "g", metaCampaignId: "camp-q", metaCampaignName: "Q" });
    const wrong = await metaOwner(db, { name: "Wrong", phone: "9845088882" }, { metaLeadId: "w", metaCampaignId: "camp-q", metaCampaignName: "Q" });
    await metaOwner(db, { name: "Waiting one", phone: "9845088883" }, { metaLeadId: "p1", metaCampaignId: "camp-q", metaCampaignName: "Q" });
    await metaOwner(db, { name: "Waiting two", phone: "9845088884" }, { metaLeadId: "p2", metaCampaignId: "camp-q", metaCampaignName: "Q" });
    await setOwnerLeadRoleReview(db, executive, genuine, "genuine", "Confirmed", { now: NOW, expectedVersion: genuine.rowVersion });
    await setOwnerLeadRoleReview(db, executive, wrong, "misclassified", "Not an owner", { now: NOW, expectedVersion: wrong.rowVersion });
    const report = await campaignQuality(db, parseQualityQuery({ campaign: "camp-q" }));
    assert.equal(report.summary.pending, 2);
    assert.equal(report.summary.reviewedOpportunities, 2);
    assert.equal(report.summary.genuineOpportunities, 1);
    assert.equal(report.summary.qualityLabel, "1/2 reviewed (50%), 2 pending");
  });

  it("masks phone numbers unless the caller can see them", async () => {
    const db = await setup();
    await metaOwner(db, { name: "Private Person", phone: "9845099999" }, {
      metaLeadId: "meta-phone",
      metaCampaignId: "camp-phone",
      metaCampaignName: "Phone",
    });
    const hidden = await campaignQuality(db, parseQualityQuery({ campaign: "camp-phone" }), { includePhone: false });
    const shown = await campaignQuality(db, parseQualityQuery({ campaign: "camp-phone" }), { includePhone: true });
    assert.equal(hidden.records[0]?.phone, maskPhone(shown.records[0]?.phone ?? ""));
    assert.equal(hidden.records[0]?.phone.includes("98450"), false);
    assert.equal(shown.records[0]?.phone.includes("9999"), true);
    assert.equal(can("viewer", "contact.view_phone"), false);
    assert.equal(can("viewer", "crm.view"), true);
    assert.equal(can("lead_executive", "crm.edit"), true);
  });

  it("filters by date and campaign and sorts genuine opportunities ahead of volume", async () => {
    const db = await setup();
    const noisy = await metaOwner(db, { name: "Noisy", phone: "9845010101" }, {
      metaLeadId: "noisy",
      metaCampaignId: "camp-noisy",
      metaCampaignName: "Noisy",
      metaFormId: "form-noisy",
    }, NOV);
    const quiet = await metaOwner(db, { name: "Quiet", phone: "9845010102" }, {
      metaLeadId: "quiet",
      metaCampaignId: "camp-quiet",
      metaCampaignName: "Quiet",
      metaFormId: "form-quiet",
    }, NOV);
    await metaOwner(db, { name: "Old", phone: "9845010103" }, {
      metaLeadId: "old",
      metaCampaignId: "camp-quiet",
      metaCampaignName: "Quiet",
    }, OCT);
    await setOwnerLeadRoleReview(db, executive, noisy, "unqualified", "Wrong number", { now: NOW, expectedVersion: noisy.rowVersion });
    await setOwnerLeadRoleReview(db, executive, quiet, "genuine", "Real owner", { now: NOW, expectedVersion: quiet.rowVersion });
    const november = await campaignQuality(db, parseQualityQuery({ from: "2026-11-01", to: "2026-11-30", sort: "opportunities" }));
    assert.deepEqual(
      november.groups.map((group) => group.id),
      ["camp-quiet", "camp-noisy"],
    );
    assert.equal(november.summary.submissions, 2);
    const quietOnly = await campaignQuality(db, parseQualityQuery({ campaign: "camp-quiet", form: "form-quiet" }));
    assert.equal(quietOnly.summary.submissions, 1);
    assert.equal(quietOnly.summary.costPerOpportunity, "N/A");
    assert.equal((await listOwnerLeads(db, { status: "open" })).some((item) => item.id === noisy.id), false);
  });

  it("drills from campaign to ad set to ad without changing the stored source", async () => {
    const db = await setup();
    const lead = await metaOwner(db, { name: "Drill", phone: "9845012121" }, {
      metaLeadId: "meta-drill",
      metaCampaignId: "camp-d",
      metaCampaignName: "Drill campaign",
      metaAdsetId: "set-d",
      metaAdsetName: "Set D",
      metaAdId: "ad-d",
      metaAdName: "Ad D",
    });
    const before = await getSource(db, lead.sourceId);
    const sets = await campaignQuality(db, parseQualityQuery({ campaign: "camp-d" }));
    assert.equal(sets.groupLevel, "adset");
    assert.equal(sets.groups[0]?.id, "set-d");
    assert.equal(sets.groups[0]?.name, "Set D");
    const ads = await campaignQuality(db, parseQualityQuery({ campaign: "camp-d", adset: "set-d" }));
    assert.equal(ads.groupLevel, "ad");
    assert.equal(ads.groups[0]?.name, "Ad D");
    const records = await campaignQuality(db, parseQualityQuery({ campaign: "camp-d", adset: "set-d", ad: "ad-d" }));
    assert.equal(records.groupLevel, null);
    assert.equal(records.records[0]?.code, lead.code);
    assert.deepEqual(await getSource(db, lead.sourceId), before);
  });

  it("keeps every earlier classification in the audit log and can return a requirement to pending", async () => {
    const db = await setup();
    const requirement = await createRequirement(
      db,
      executive,
      { name: "Reversible", phone: "9845013131" },
      parseRequirementInput({ intent: "Rent", budgetMax: 12000, localities: ["Sedam Road"] }),
      parseSourceInput({ channel: "meta_lead_form", metaLeadId: "meta-rev", metaCampaignId: "camp-rev", submittedAt: NOV }),
      NOW,
    );
    const genuine = await setRequirementQuality(db, executive, requirement, "genuine", "Wants a rental", {
      now: "2026-11-11T16:01:00.000Z",
      expectedVersion: requirement.rowVersion,
    });
    assert.equal(genuine.status, "New");
    const unqualified = await setRequirementQuality(db, executive, genuine, "unqualified", "Number does not connect", {
      now: "2026-11-11T16:02:00.000Z",
      expectedVersion: genuine.rowVersion,
    });
    const pending = await setRequirementQuality(db, executive, unqualified, "pending", "Try the number once more", {
      now: "2026-11-11T16:03:00.000Z",
      expectedVersion: unqualified.rowVersion,
    });
    assert.equal(pending.qualityReview, "");
    assert.equal(pending.status, "New");
    assert.equal(pending.intent, "Rent");
    const actions = (await listAudit(db, { entityType: "requirement", entityId: requirement.id })).map((entry) => entry.action);
    assert.deepEqual(actions.filter((action) => action.startsWith("confirm") || action.startsWith("mark_requirement")), [
      "mark_requirement_pending",
      "mark_requirement_unqualified",
      "confirm_tenant",
    ]);
    const source = await getSource(db, requirement.sourceId);
    assert.equal(source?.metaLeadId, "meta-rev");
    assert.equal(source?.metaCampaignId, "camp-rev");
  });

  it("creates a property draft only after the lead is confirmed as a genuine owner", async () => {
    const db = await setup();
    const pending = await metaOwner(db, { name: "Still Pending", phone: "9845014141" }, { metaLeadId: "meta-pending", metaCampaignId: "camp-draft" });
    const wrong = await metaOwner(db, { name: "Not Owner", phone: "9845014142" }, { metaLeadId: "meta-wrong", metaCampaignId: "camp-draft" });
    const junk = await metaOwner(db, { name: "Junk", phone: "9845014143" }, { metaLeadId: "meta-junk", metaCampaignId: "camp-draft" });
    const real = await metaOwner(db, { name: "Real Owner", phone: "9845014144" }, { metaLeadId: "meta-real", metaCampaignId: "camp-draft" });
    const misclassified = await setOwnerLeadRoleReview(db, executive, wrong, "misclassified", "He wants a rental house", {
      now: NOW,
      expectedVersion: wrong.rowVersion,
    });
    const unqualified = await setOwnerLeadRoleReview(db, executive, junk, "unqualified", "Spam", {
      now: NOW,
      expectedVersion: junk.rowVersion,
    });
    const genuine = await setOwnerLeadRoleReview(db, executive, real, "genuine", "He has a house to let", {
      now: NOW,
      expectedVersion: real.rowVersion,
    });
    const before = await db.prepare("SELECT id, title, publication_status, updated_at FROM properties").all<{
      id: string;
      title: string;
      publication_status: string;
      updated_at: string;
    }>();

    await assert.rejects(convertOwnerLead(db, executive, pending, { now: NOW }), /pending review/);
    await assert.rejects(convertOwnerLead(db, executive, misclassified, { now: NOW }), /not an owner/);
    await assert.rejects(convertOwnerLead(db, executive, unqualified, { now: NOW }), /not a genuine enquiry/);

    const afterRejects = await db.prepare("SELECT id, title, publication_status, updated_at FROM properties").all();
    assert.deepEqual(afterRejects.results, before.results);
    assert.equal((await getOwnerLead(db, pending.id))?.status, "New");
    assert.equal((await getOwnerLead(db, wrong.id))?.status, "New");
    assert.equal((await getOwnerLead(db, junk.id))?.status, "New");
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM properties WHERE source_owner_lead_id IN (?1, ?2, ?3)")
          .bind(pending.id, wrong.id, junk.id)
          .first<{ n: number }>()
      )?.n,
      0,
    );

    const draft = await convertOwnerLead(db, executive, genuine, { now: NOW });
    assert.equal(draft.publicationStatus, "Unpublished");
    assert.equal(draft.verificationStatus, "Draft");
    assert.equal((await getOwnerLead(db, real.id))?.status, "Converted");
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM properties WHERE source_owner_lead_id = ?1").bind(real.id).first<{ n: number }>())?.n,
      1,
    );
    const untouched = await db.prepare("SELECT id, title, publication_status, updated_at FROM properties WHERE id != ?1").bind(draft.id).all();
    assert.deepEqual(untouched.results, before.results);
  });

  it("keeps the Meta submission count when the intent filter changes and when a delivery has no CRM record", async () => {
    const db = await setup();
    await metaOwner(db, { name: "Owner Form", phone: "9845015151" }, {
      metaLeadId: "meta-sub-owner",
      metaCampaignId: "camp-sub",
      metaCampaignName: "Submissions",
      metaFormId: "form-sub",
      metaFormName: "Shared form",
    });
    await createRequirement(
      db,
      executive,
      { name: "Buyer Form", phone: "9845015152" },
      parseRequirementInput({ intent: "Buy", budgetMax: 4000000, localities: ["Sedam Road"] }),
      parseSourceInput({
        channel: "meta_lead_form",
        metaLeadId: "meta-sub-buyer",
        metaCampaignId: "camp-sub",
        metaCampaignName: "Submissions",
        metaFormId: "form-sub",
        metaFormName: "Shared form",
        submittedAt: NOV,
      }),
      NOW,
    );
    await db
      .prepare(
        `INSERT INTO lead_sources (id, channel, meta_lead_id, meta_campaign_id, meta_campaign_name, meta_form_id, meta_form_name, submitted_at, created_at, created_by)
         VALUES ('src_orphan', 'meta_lead_form', 'meta-sub-orphan', 'camp-sub', 'Submissions', 'form-sub', 'Shared form', ?1, ?2, 'x')`,
      )
      .bind(NOV, NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO lead_sources (id, channel, meta_lead_id, meta_campaign_id, meta_campaign_name, meta_form_id, submitted_at, created_at, created_by)
         VALUES ('src_other', 'meta_lead_form', 'meta-sub-other', 'camp-other', 'Other', 'form-other', ?1, ?2, 'x')`,
      )
      .bind(NOV, NOW)
      .run();

    const all = await campaignQuality(db, parseQualityQuery({ campaign: "camp-sub" }));
    const buyers = await campaignQuality(db, parseQualityQuery({ campaign: "camp-sub", intent: "buyer" }));
    const owners = await campaignQuality(db, parseQualityQuery({ campaign: "camp-sub", intent: "owner" }));
    assert.equal(all.summary.submissions, 3);
    assert.equal(buyers.summary.submissions, 3);
    assert.equal(owners.summary.submissions, 3);
    assert.equal(all.groups[0]?.submissions, 3);
    assert.equal(buyers.groups[0]?.submissions, 3);
    assert.equal(buyers.summary.genuineBuyers, 0);
    assert.equal(buyers.summary.pending, 1);
    assert.equal(owners.summary.pending, 1);
    const form = await campaignQuality(db, parseQualityQuery({ form: "form-sub" }));
    assert.equal(form.summary.submissions, 3);
    const otherForm = await campaignQuality(db, parseQualityQuery({ form: "form-other" }));
    assert.equal(otherForm.summary.submissions, 1);
    const everywhere = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(everywhere.summary.submissions, 4);
  });

  it("does not show a partial ad set or ad spend as the campaign total", async () => {
    const db = await setup();
    await metaOwner(db, { name: "Ad One", phone: "9845016161" }, {
      metaLeadId: "meta-ad-1",
      metaCampaignId: "camp-part",
      metaCampaignName: "Partial",
      metaAdsetId: "set-a",
      metaAdsetName: "Set A",
      metaAdId: "ad-1",
      metaAdName: "Ad 1",
    });
    await metaOwner(db, { name: "Ad Two", phone: "9845016162" }, {
      metaLeadId: "meta-ad-2",
      metaCampaignId: "camp-part",
      metaCampaignName: "Partial",
      metaAdsetId: "set-a",
      metaAdsetName: "Set A",
      metaAdId: "ad-2",
      metaAdName: "Ad 2",
    });
    await metaOwner(db, { name: "Ad Three", phone: "9845016163" }, {
      metaLeadId: "meta-ad-3",
      metaCampaignId: "camp-part",
      metaCampaignName: "Partial",
      metaAdsetId: "set-b",
      metaAdsetName: "Set B",
      metaAdId: "ad-3",
      metaAdName: "Ad 3",
    });
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'ad', 'ad-1', '2026-11-02', 'INR', 50000, 'test', ?1, 'x')`,
      )
      .bind(NOW)
      .run();

    const campaign = await campaignQuality(db, parseQualityQuery({ campaign: "camp-part" }));
    assert.equal(campaign.summary.spendLabel, "Incomplete");
    assert.equal(campaign.summary.costPerLead, "N/A");
    assert.equal(campaign.summary.costPerOpportunity, "N/A");
    const setA = campaign.groups.find((group) => group.id === "set-a");
    const setB = campaign.groups.find((group) => group.id === "set-b");
    assert.equal(setA?.spendLabel, "Incomplete");
    assert.equal(setA?.spendMinor, null);
    assert.equal(setB?.spendLabel, "Not imported");
    assert.notEqual(campaign.summary.spendLabel, "₹500");

    const ads = await campaignQuality(db, parseQualityQuery({ campaign: "camp-part", adset: "set-a" }));
    assert.equal(ads.summary.spendLabel, "Incomplete");
    assert.equal(ads.groups.find((group) => group.id === "ad-1")?.spendLabel, "₹500");
    assert.equal(ads.groups.find((group) => group.id === "ad-1")?.spendMinor, 50000);
    assert.equal(ads.groups.find((group) => group.id === "ad-2")?.spendLabel, "Not imported");

    const all = await campaignQuality(db, parseQualityQuery({}));
    const row = all.groups.find((group) => group.id === "camp-part");
    assert.equal(row?.spendLabel, "Incomplete");
    assert.equal(row?.spendMinor, null);
    assert.equal(all.summary.spendLabel, "Incomplete");
    assert.equal(all.summary.costPerLead, "N/A");

    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES
           ('meta', 'ad', 'ad-2', '2026-11-02', 'INR', 50000, 'test', ?1, 'x'),
           ('meta', 'adset', 'set-b', '2026-11-02', 'INR', 50000, 'test', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    const stillPartial = await campaignQuality(db, parseQualityQuery({ campaign: "camp-part" }));
    assert.equal(stillPartial.summary.spendLabel, "Incomplete");
    assert.equal(stillPartial.groups.find((group) => group.id === "set-a")?.spendMinor, null);
    assert.equal(stillPartial.groups.find((group) => group.id === "set-b")?.spendLabel, "₹500");
    assert.notEqual(stillPartial.summary.spendLabel, "₹1,000");
    assert.notEqual(stillPartial.summary.spendLabel, "₹1,500");
  });

  it("lists a discovered campaign that has no submissions", async () => {
    const db = await setup();
    await db
      .prepare(
        `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
         VALUES ('meta', 'campaign', '120257536957600091', 'GH | Agri Land Owner JV Leads', '', ?1, ?1)`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'campaign', '120257536957600091', '2026-11-02', 'INR', 0, 'meta_insights', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    const report = await campaignQuality(db, parseQualityQuery({}));
    const campaign = report.groups.find((group) => group.id === "120257536957600091");
    assert.equal(campaign?.name, "GH | Agri Land Owner JV Leads");
    assert.equal(campaign?.submissions, 0);
    assert.equal(campaign?.genuineOpportunities, 0);
    assert.equal(campaign?.spendLabel, "₹0");
    assert.equal(campaign?.costLabel, "N/A");
    assert.equal(report.campaigns.some((item) => item.id === "120257536957600091"), true);
  });

  it("marks spend Incomplete when the selected dates extend outside a successful import", async () => {
    const db = await setup();
    const paid = await metaOwner(db, { name: "Paid Lead", phone: "9845020202" }, {
      metaLeadId: "meta-window",
      metaCampaignId: "camp-window",
      metaCampaignName: "Window",
    });
    await setOwnerLeadRoleReview(db, executive, paid, "genuine", "Real owner", { now: NOW, expectedVersion: paid.rowVersion });
    await db
      .prepare(
        `INSERT INTO meta_connection (id, status, updated_at, ad_account_id, ad_account_name)
         VALUES ('primary', 'connected', ?1, 'act_1509113601263131', 'GulbargaHomes')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_coverage (platform, level, ad_account_id, covered_since, covered_until, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'act_1509113601263131', '2026-08-14', '2026-11-12', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'camp-window', '2026-11-02', 'INR', 250000, 'meta_insights', ?1, 'x')`,
      )
      .bind(NOW)
      .run();

    const inside = await campaignQuality(db, parseQualityQuery({ from: "2026-11-01", to: "2026-11-12" }));
    assert.equal(inside.summary.spendLabel, "₹2,500");
    assert.equal(inside.summary.costPerOpportunity, "₹2,500");
    assert.equal(inside.groups.find((group) => group.id === "camp-window")?.spendMinor, 250000);

    const sixMonths = await campaignQuality(db, parseQualityQuery({ from: "2026-05-12", to: "2026-11-12" }));
    assert.equal(sixMonths.summary.spendLabel, "Incomplete");
    assert.equal(sixMonths.summary.costPerLead, "N/A");
    assert.equal(sixMonths.summary.costPerOpportunity, "N/A");
    assert.equal(sixMonths.groups.find((group) => group.id === "camp-window")?.spendLabel, "Incomplete");
    assert.equal(sixMonths.groups.find((group) => group.id === "camp-window")?.spendMinor, null);
    assert.notEqual(sixMonths.summary.spendLabel, "₹2,500");

    const open = await campaignQuality(db, parseQualityQuery({}));
    assert.equal(open.summary.spendLabel, "Incomplete");
    assert.equal(open.summary.costPerOpportunity, "N/A");
    assert.deepEqual(open.spendCoverage, [{ since: "2026-08-14", until: "2026-11-12" }]);

    await db
      .prepare(
        `INSERT INTO ad_spend_coverage (platform, level, ad_account_id, covered_since, covered_until, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'act_1509113601263131', '2026-05-01', '2026-05-20', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    const gap = await campaignQuality(db, parseQualityQuery({ from: "2026-05-12", to: "2026-11-12" }));
    assert.equal(gap.summary.spendLabel, "Incomplete");
    assert.notEqual(gap.summary.spendLabel, "₹2,500");
    const early = await campaignQuality(db, parseQualityQuery({ from: "2026-05-12", to: "2026-05-20" }));
    assert.equal(early.summary.spendLabel, "Not imported");
  });

  it("marks a report Incomplete when it crosses a gap between two saved coverage windows", async () => {
    const db = await setup();
    await db
      .prepare(
        `INSERT INTO meta_connection (id, status, updated_at, ad_account_id, ad_account_name)
         VALUES ('primary', 'connected', ?1, 'act_1509113601263131', 'GulbargaHomes')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
         VALUES ('meta', 'campaign', 'camp-gap', 'Gapped', '', ?1, ?1)`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_coverage (platform, level, ad_account_id, covered_since, covered_until, imported_at, imported_by)
         VALUES
           ('meta', 'campaign', 'act_1509113601263131', '2026-05-01', '2026-05-20', ?1, 'x'),
           ('meta', 'campaign', 'act_1509113601263131', '2026-08-14', '2026-11-12', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES
           ('meta', 'campaign', 'camp-gap', '2026-05-15', 'INR', 10000, 'meta_insights', ?1, 'x'),
           ('meta', 'campaign', 'camp-gap', '2026-11-02', 'INR', 250000, 'meta_insights', ?1, 'x')`,
      )
      .bind(NOW)
      .run();

    const may = await campaignQuality(db, parseQualityQuery({ from: "2026-05-01", to: "2026-05-20" }));
    assert.equal(may.summary.spendLabel, "₹100");
    assert.equal(may.groups.find((group) => group.id === "camp-gap")?.spendMinor, 10000);
    const november = await campaignQuality(db, parseQualityQuery({ from: "2026-08-14", to: "2026-11-12" }));
    assert.equal(november.summary.spendLabel, "₹2,500");
    assert.equal(november.groups.find((group) => group.id === "camp-gap")?.spendMinor, 250000);

    const crossing = await campaignQuality(db, parseQualityQuery({ from: "2026-05-01", to: "2026-11-12" }));
    assert.deepEqual(crossing.spendCoverage, [
      { since: "2026-05-01", until: "2026-05-20" },
      { since: "2026-08-14", until: "2026-11-12" },
    ]);
    assert.equal(crossing.summary.spendLabel, "Incomplete");
    assert.equal(crossing.summary.costPerLead, "N/A");
    assert.equal(crossing.groups.find((group) => group.id === "camp-gap")?.spendLabel, "Incomplete");
    assert.equal(crossing.groups.find((group) => group.id === "camp-gap")?.spendMinor, null);
    assert.notEqual(crossing.summary.spendLabel, "₹2,600");
    assert.notEqual(crossing.summary.spendLabel, "₹2,500");
    assert.notEqual(crossing.summary.spendLabel, "₹100");
  });

  it("does not reuse coverage after the selected ad account changes", async () => {
    const db = await setup();
    await db
      .prepare(
        `INSERT INTO meta_connection (id, status, updated_at, ad_account_id, ad_account_name)
         VALUES ('primary', 'connected', ?1, 'act_1509113601263131', 'GulbargaHomes')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
         VALUES ('meta', 'campaign', 'camp-switch', 'Switched', '', ?1, ?1)`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_coverage (platform, level, ad_account_id, covered_since, covered_until, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'act_1509113601263131', '2026-08-14', '2026-11-12', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'camp-switch', '2026-11-02', 'INR', 250000, 'meta_insights', ?1, 'x')`,
      )
      .bind(NOW)
      .run();

    const first = await campaignQuality(db, parseQualityQuery({ from: "2026-08-14", to: "2026-11-12" }));
    assert.equal(first.summary.spendLabel, "₹2,500");
    assert.deepEqual(first.spendCoverage, [{ since: "2026-08-14", until: "2026-11-12" }]);

    await saveAdAccount(db, executive, { id: "act_9990000000001", name: "Other", now: NOW });
    const switched = await campaignQuality(db, parseQualityQuery({ from: "2026-08-14", to: "2026-11-12" }));
    assert.deepEqual(switched.spendCoverage, []);
    assert.equal(switched.summary.spendLabel, "Incomplete");
    assert.equal(switched.summary.costPerOpportunity, "N/A");
    assert.equal(switched.groups.find((group) => group.id === "camp-switch")?.spendMinor, null);
    assert.notEqual(switched.summary.spendLabel, "₹2,500");
    const previous = await db
      .prepare("SELECT COUNT(*) AS n FROM ad_spend_coverage WHERE ad_account_id = 'act_1509113601263131'")
      .first<{ n: number }>();
    assert.equal(previous?.n, 1);

    await db
      .prepare(
        `INSERT INTO ad_spend_coverage (platform, level, ad_account_id, covered_since, covered_until, imported_at, imported_by)
         VALUES ('meta', 'campaign', 'act_9990000000001', '2026-11-01', '2026-11-05', ?1, 'x')`,
      )
      .bind(NOW)
      .run();
    const outsideNew = await campaignQuality(db, parseQualityQuery({ from: "2026-08-14", to: "2026-11-12" }));
    assert.deepEqual(outsideNew.spendCoverage, [{ since: "2026-11-01", until: "2026-11-05" }]);
    assert.equal(outsideNew.summary.spendLabel, "Incomplete");
    assert.notEqual(outsideNew.summary.spendLabel, "₹2,500");
    const insideNew = await campaignQuality(db, parseQualityQuery({ from: "2026-11-01", to: "2026-11-05" }));
    assert.equal(insideNew.summary.spendLabel, "₹2,500");
    assert.equal(insideNew.groups.find((group) => group.id === "camp-switch")?.spendMinor, 250000);
  });

  it("merges adjacent import windows and rejects a gap", () => {
    assert.deepEqual(
      mergeCoverageRanges([
        { since: "2026-08-15", until: "2026-11-13" },
        { since: "2026-08-14", until: "2026-11-12" },
      ]),
      [{ since: "2026-08-14", until: "2026-11-13" }],
    );
    const gapped = [
      { since: "2026-05-01", until: "2026-05-20" },
      { since: "2026-08-14", until: "2026-11-12" },
    ];
    assert.equal(rangeCovered("2026-08-14", "2026-11-12", gapped), true);
    assert.equal(rangeCovered("2026-05-12", "2026-11-12", gapped), false);
    assert.equal(rangeCovered(null, "2026-11-12", gapped), false);
    assert.equal(rangeCovered("2026-08-14", null, gapped), false);
  });
});
