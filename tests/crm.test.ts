import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { createFollowup, listFollowups, logActivity, parseActivityInput, updateFollowup } from "../lib/crm/activity";
import { findContactByPhone } from "../lib/crm/contacts";
import { intentScore } from "../lib/crm/intent-score";
import { convertOwnerLead, createOwnerLead, getOwnerLead, updateOwnerLead } from "../lib/crm/owner-leads";
import { createRequirement, getRequirement, parseRequirementInput } from "../lib/crm/requirements";
import { parseSourceInput } from "../lib/crm/sources";
import { endOfIstDay } from "../lib/crm/today";
import { prepareDatabase } from "../lib/db/prepare";
import { listInventoryForOwnerLead } from "../lib/inventory/repository";
import { createTestDb } from "./helpers/sqlite";

const actor = { id: "adm_test", email: "exec@example.com", role: "inventory_manager" };
const NOW = "2026-11-10T10:00:00.000Z";
const owner = { name: "Ravi Patil", phone: "98450 12345" };

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

function ownerLead(db: ReturnType<typeof createTestDb>, source: Record<string, unknown> = {}) {
  return createOwnerLead(
    db,
    actor,
    owner,
    { intent: "Rent", propertyType: "House", locality: "Sedam Road", locationText: "", expectedPrice: 14000, notes: "", priority: "Warm" },
    parseSourceInput({ channel: "meta_lead_form", ...source }),
    NOW,
  );
}

describe("owner leads", () => {
  it("dedupes the contact by mobile number and refuses a re-imported Meta lead", async () => {
    const db = await setup();
    const first = await ownerLead(db, { metaLeadId: "lead-1" });
    const second = await ownerLead(db, { metaLeadId: "lead-2" });
    assert.equal(first.contactId, second.contactId);
    assert.equal((await findContactByPhone(db, "+919845012345"))?.isOwner, true);
    await assert.rejects(ownerLead(db, { metaLeadId: "lead-1" }), /already imported/);
  });

  it("converts only by explicit action, into a hidden draft, and allows a second property", async () => {
    const db = await setup();
    const lead = await ownerLead(db);
    await assert.rejects(updateOwnerLead(db, actor, lead, { status: "Converted" }, { now: NOW }), /Convert to draft/);

    const property = await convertOwnerLead(db, actor, lead, { now: NOW });
    assert.equal(property.verificationStatus, "Draft");
    assert.equal(property.publicationStatus, "Unpublished");
    assert.equal(property.price, 14000);
    const visible = await db.prepare("SELECT COUNT(*) AS n FROM public_properties").first<{ n: number }>();
    assert.equal(visible?.n, 0);

    const converted = (await getOwnerLead(db, lead.id))!;
    assert.equal(converted.status, "Converted");
    await convertOwnerLead(db, actor, converted, { now: NOW });
    assert.equal((await listInventoryForOwnerLead(db, lead.id, { includeDiscreet: true })).length, 2);

    const actions = (await listAudit(db, { entityType: "owner_lead", entityId: lead.id })).map((entry) => entry.action);
    assert.ok(actions.includes("convert"));
    assert.ok(actions.includes("convert_additional"));
  });

  it("keeps a lease as a lease and never turns a sale into a rental listing", async () => {
    const db = await setup();
    const sale = await createOwnerLead(
      db,
      actor,
      owner,
      { intent: "Sale", propertyType: "House", locality: "Sedam Road", locationText: "", expectedPrice: 4500000, notes: "", priority: "Warm" },
      parseSourceInput({ channel: "phone" }),
      NOW,
    );
    const sold = await convertOwnerLead(db, actor, sale, { now: NOW, listing: "Rent" });
    assert.equal(sold.listing, "Sale");
    assert.equal(sold.priceSuffix, "");

    const lease = await createOwnerLead(
      db,
      actor,
      { name: "Lease Owner", phone: "98450 22222" },
      { intent: "Lease", propertyType: "Commercial", locality: "Ring Road", locationText: "", expectedPrice: 80000, notes: "", priority: "Warm" },
      parseSourceInput({ channel: "phone" }),
      NOW,
    );
    await assert.rejects(convertOwnerLead(db, actor, lease, { now: NOW }), /lease/);
    assert.equal((await getOwnerLead(db, lease.id))?.intent, "Lease");
    assert.equal((await getOwnerLead(db, lease.id))?.status, "New");
    const drafted = await convertOwnerLead(db, actor, lease, { now: NOW, listing: "Rent" });
    assert.equal(drafted.listing, "Rent");
    assert.equal(drafted.priceSuffix, "/month");
    assert.match(drafted.internalNotes, /lease/);
    assert.equal((await getOwnerLead(db, lease.id))?.intent, "Lease");
    const visible = await db.prepare("SELECT COUNT(*) AS n FROM public_properties").first<{ n: number }>();
    assert.equal(visible?.n, 0);
  });

  it("will not convert a lead marked not interested", async () => {
    const db = await setup();
    const lead = await ownerLead(db);
    const closed = await updateOwnerLead(db, actor, lead, { status: "Not interested" }, { now: NOW });
    await assert.rejects(convertOwnerLead(db, actor, closed, { now: NOW }), /Reopen/);
  });
});

describe("activities and follow-ups", () => {
  it("moves a new lead to Contacted only when the person was reached", async () => {
    const db = await setup();
    const lead = await ownerLead(db);
    const log = (outcome: string) =>
      logActivity(
        db,
        actor,
        parseActivityInput({ entityType: "owner_lead", entityId: lead.id, contactId: lead.contactId, kind: "call", outcome }),
        NOW,
      );

    await log("no_answer");
    assert.equal((await getOwnerLead(db, lead.id))?.status, "New");
    await log("connected");
    const reached = (await getOwnerLead(db, lead.id))!;
    assert.equal(reached.status, "Contacted");
    assert.equal(reached.lastContactedAt, NOW);
    const audit = await listAudit(db, { entityType: "owner_lead", entityId: lead.id });
    assert.equal(audit.filter((entry) => entry.action === "status_change").length, 1);
  });

  it("refuses the same WhatsApp message twice", async () => {
    const db = await setup();
    const lead = await ownerLead(db);
    const input = parseActivityInput({
      entityType: "owner_lead",
      entityId: lead.id,
      kind: "whatsapp",
      direction: "inbound",
      channel: "wa_cloud_api",
      externalId: "wamid.ABC",
    });
    await logActivity(db, actor, input, NOW);
    await assert.rejects(logActivity(db, actor, input, NOW), /already in the timeline/);
  });

  it("keeps next_followup_at in sync with the earliest open follow-up", async () => {
    const db = await setup();
    const lead = await ownerLead(db);
    const base = { entityType: "owner_lead", entityId: lead.id, reason: "Call back" };
    const later = await createFollowup(db, actor, { ...base, dueAt: "2026-11-12T05:00:00.000Z" }, NOW);
    const sooner = await createFollowup(db, actor, { ...base, dueAt: "2026-11-11T05:00:00.000Z" }, NOW);
    assert.equal((await getOwnerLead(db, lead.id))?.nextFollowupAt, sooner.dueAt);

    await updateFollowup(db, actor, sooner, { status: "Done" }, NOW);
    assert.equal((await getOwnerLead(db, lead.id))?.nextFollowupAt, later.dueAt);
    await updateFollowup(db, actor, later, { status: "Cancelled" }, NOW);
    assert.equal((await getOwnerLead(db, lead.id))?.nextFollowupAt, null);

    const due = await listFollowups(db, { openDueBefore: "2026-12-01T00:00:00.000Z" });
    assert.equal(due.length, 0);
  });
});

describe("requirements", () => {
  it("validates ranges and scores intent separately from inventory", async () => {
    assert.throws(() => parseRequirementInput({ intent: "Rent", budgetMin: 20000, budgetMax: 10000 }), /budget/);

    const db = await setup();
    const requirement = await createRequirement(
      db,
      actor,
      { name: "Asha K", phone: "9900011122" },
      parseRequirementInput({
        intent: "Rent",
        propertyTypes: ["House"],
        bhkMin: 2,
        budgetMin: 10000,
        budgetMax: 15000,
        localities: ["Sedam Road"],
        timeline: "Immediate",
      }),
      parseSourceInput({}),
      NOW,
    );
    const loaded = (await getRequirement(db, requirement.id, new Date(NOW)))!;
    assert.equal(loaded.code, "GH-D0001");
    assert.equal(loaded.intentScore.score, 75);
    assert.equal(loaded.intentScore.band, "High");

    const vague = {
      timeline: "Exploring" as const,
      budgetMin: null,
      budgetMax: null,
      propertyTypes: [],
      localities: [],
      bhkMin: null,
      status: "New",
      lastContactedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      priorityOverride: "",
    };
    assert.equal(intentScore(vague).band, "Low");
    assert.equal(intentScore({ ...vague, priorityOverride: "High" }).band, "High");
  });
});

describe("IST day boundary", () => {
  it("ends the day at 23:59:59.999 India time", () => {
    assert.equal(endOfIstDay(new Date("2026-11-10T10:00:00.000Z")), "2026-11-10T18:29:59.999Z");
    assert.equal(endOfIstDay(new Date("2026-11-10T19:00:00.000Z")), "2026-11-11T18:29:59.999Z");
  });
});
