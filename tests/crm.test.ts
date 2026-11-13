import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { createFollowup, listFollowups, logActivity, parseActivityInput, updateFollowup } from "../lib/crm/activity";
import { findContactByPhone } from "../lib/crm/contacts";
import { intentScore } from "../lib/crm/intent-score";
import { convertOwnerLead, createOwnerLead, getOwnerLead, setOwnerLeadRoleReview, updateOwnerLead } from "../lib/crm/owner-leads";
import { formatHistoryChanges } from "../lib/admin/history-format";
import { createRequirement, getRequirement, parseRequirementInput, setRequirementQuality, updateRequirement } from "../lib/crm/requirements";
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

function confirmOwner(db: Awaited<ReturnType<typeof setup>>, lead: Awaited<ReturnType<typeof ownerLead>>) {
  return setOwnerLeadRoleReview(db, actor, lead, "genuine", "Confirmed owner", {
    now: NOW,
    expectedVersion: lead.rowVersion,
  });
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
    const lead = await confirmOwner(db, await ownerLead(db));
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
    const sold = await convertOwnerLead(db, actor, await confirmOwner(db, sale), { now: NOW, listing: "Rent" });
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
    const confirmedLease = await confirmOwner(db, lease);
    await assert.rejects(convertOwnerLead(db, actor, confirmedLease, { now: NOW }), /lease/);
    assert.equal((await getOwnerLead(db, lease.id))?.intent, "Lease");
    assert.equal((await getOwnerLead(db, lease.id))?.status, "New");
    const drafted = await convertOwnerLead(db, actor, confirmedLease, { now: NOW, listing: "Rent" });
    assert.equal(drafted.listing, "Rent");
    assert.equal(drafted.priceSuffix, "/month");
    assert.match(drafted.internalNotes, /lease/);
    assert.equal((await getOwnerLead(db, lease.id))?.intent, "Lease");
    const visible = await db.prepare("SELECT COUNT(*) AS n FROM public_properties").first<{ n: number }>();
    assert.equal(visible?.n, 0);
  });

  it("will not convert a lead marked not interested", async () => {
    const db = await setup();
    const lead = await confirmOwner(db, await ownerLead(db));
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

  it("assigns a follow-up to a teammate and records that person", async () => {
    const db = await setup();
    const staffId = "adm_meena0000000000001";
    await db
      .prepare(
        `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, password_iterations, active, created_at, created_by, updated_at)
         VALUES (?1, 'meena@example.com', 'Meena', 'lead_executive', 'x', 'y', 1, 1, ?2, 'adm_test', ?2)`,
      )
      .bind(staffId, NOW)
      .run();
    const lead = await ownerLead(db);
    const followup = await createFollowup(
      db,
      actor,
      { entityType: "owner_lead", entityId: lead.id, reason: "Call the owner", dueAt: "2026-11-11T05:00:00.000Z", assignedTo: staffId },
      NOW,
    );
    assert.equal(followup.assignedTo, staffId);
    const audit = await listAudit(db, { entityType: "followup", entityId: followup.id });
    assert.equal(audit[0]?.action, "create");
    assert.deepEqual(audit[0]?.changes.assigned_to, [null, staffId]);
    assert.deepEqual(audit[0]?.changes.due_at, [null, "2026-11-11T05:00:00.000Z"]);

    const own = await createFollowup(
      db,
      actor,
      { entityType: "owner_lead", entityId: lead.id, reason: "Send photos", dueAt: "2026-11-12T05:00:00.000Z" },
      NOW,
    );
    assert.equal(own.assignedTo, actor.id);

    await assert.rejects(
      createFollowup(
        db,
        actor,
        { entityType: "owner_lead", entityId: lead.id, reason: "Missing person", dueAt: "2026-11-12T05:00:00.000Z", assignedTo: "adm_missing00000000001" },
        NOW,
      ),
      /member of the team/,
    );
    const saved = await listFollowups(db, { entityType: "owner_lead", entityId: lead.id });
    assert.equal(saved.length, 2);
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
    assert.equal(intentScore(vague).factors.find((factor) => factor.label === "Engagement")?.points, 0);
    assert.equal(intentScore({ ...vague, engagementCount: 1 }).factors.find((factor) => factor.label === "Engagement")?.points, 10);
  });

  it("keeps a new requirement pending and ignores an unanswered message as engagement", async () => {
    const db = await setup();
    const input = parseRequirementInput({
      intent: "Rent",
      propertyTypes: ["Plot"],
      localities: ["Timmapuri"],
      budgetMin: 5000,
      budgetMax: 10000,
      timeline: "Within 7 days",
      notes: "Corner preferred",
    });
    input.preferenceDetails = { profile: "Rent:Plot", intendedUse: "Commercial", plotArea: "30 × 40", leaseDuration: "1 year" };
    const requirement = await createRequirement(
      db,
      actor,
      { name: "Veer", phone: "9900099000" },
      input,
      parseSourceInput({ channel: "website" }),
      NOW,
    );
    assert.equal(requirement.status, "New");
    assert.equal(requirement.qualityReview, "");
    assert.equal(requirement.intentScore.factors.find((factor) => factor.label === "Engagement")?.points, 0);

    await assert.rejects(
      updateRequirement(db, actor, requirement, { status: "Qualified" }, { now: NOW, expectedVersion: requirement.rowVersion }),
      /stays pending/,
    );
    assert.equal((await getRequirement(db, requirement.id))?.status, "New");

    await logActivity(
      db,
      actor,
      parseActivityInput({
        entityType: "requirement",
        entityId: requirement.id,
        contactId: requirement.contactId,
        kind: "whatsapp",
        outcome: "sent",
      }),
      NOW,
    );
    const afterMessage = (await getRequirement(db, requirement.id, new Date(NOW)))!;
    assert.equal(afterMessage.status, "New");
    assert.equal(afterMessage.qualityReview, "");
    assert.equal(afterMessage.attemptCount, 1);
    assert.equal(afterMessage.engagementCount, 0);
    assert.equal(afterMessage.lastMeaningfulAt, null);
    assert.equal(afterMessage.intentScore.factors.find((factor) => factor.label === "Engagement")?.points, 0);

    await logActivity(
      db,
      actor,
      parseActivityInput({
        entityType: "requirement",
        entityId: requirement.id,
        contactId: requirement.contactId,
        kind: "call",
        outcome: "connected",
      }),
      NOW,
    );
    const afterCall = (await getRequirement(db, requirement.id, new Date(NOW)))!;
    assert.equal(afterCall.status, "Contacted");
    assert.equal(afterCall.qualityReview, "");
    assert.equal(afterCall.engagementCount, 1);
    assert.equal(afterCall.intentScore.factors.find((factor) => factor.label === "Engagement")?.points, 10);

    const audit = await listAudit(db, { entityType: "requirement", entityId: requirement.id });
    const created = audit.find((entry) => entry.action === "create");
    const lines = formatHistoryChanges(created?.changes ?? {});
    assert.equal(lines.some((line) => line.text.includes("more fields")), false);
    assert.equal(lines.find((line) => line.label === "Intended use")?.text, "Commercial");
    assert.equal(lines.find((line) => line.label === "Required plot area")?.text, "30 × 40");
    assert.equal(lines.find((line) => line.label === "Lease duration")?.text, "1 year");
    assert.equal(lines.find((line) => line.label === "Additional requirements")?.text, "Corner preferred");

    const verified = await setRequirementQuality(db, actor, afterCall, "genuine", "Spoke to Veer and confirmed the plot.", {
      now: NOW,
      expectedVersion: afterCall.rowVersion,
    });
    const qualified = await updateRequirement(db, actor, verified, { status: "Qualified" }, { now: NOW, expectedVersion: verified.rowVersion });
    assert.equal(qualified.status, "Qualified");
    assert.equal(qualified.qualityReview, "genuine");
  });
});

describe("IST day boundary", () => {
  it("ends the day at 23:59:59.999 India time", () => {
    assert.equal(endOfIstDay(new Date("2026-11-10T10:00:00.000Z")), "2026-11-10T18:29:59.999Z");
    assert.equal(endOfIstDay(new Date("2026-11-10T19:00:00.000Z")), "2026-11-11T18:29:59.999Z");
  });
});
