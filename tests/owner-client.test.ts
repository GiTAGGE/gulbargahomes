import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { can } from "../lib/admin/permissions";
import { HttpError } from "../lib/admin/errors";
import { findContactByPhone, updateContact } from "../lib/crm/contacts";
import { addClientRequirements } from "../lib/crm/owner-client";
import { createOwnerLead, getOwnerLead, updateOwnerLead } from "../lib/crm/owner-leads";
import { getRequirement, matchableBudget, updateRequirement } from "../lib/crm/requirements";
import { getSource, parseSourceInput } from "../lib/crm/sources";
import { prepareDatabase } from "../lib/db/prepare";
import { createTestDb } from "./helpers/sqlite";

const executive = { id: "adm_exec", email: "leads@example.com", role: "lead_executive" };
const NOW = "2026-11-11T10:00:00.000Z";

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

function details(budgetMin: number, budgetMax: number, locality: string) {
  return {
    propertyTypes: ["House" as const],
    bhkMin: null,
    bhkMax: null,
    budgetMin,
    budgetMax,
    localities: [locality],
    localityFlexible: false,
    areaMin: null,
    furnishing: "Any",
    tenantProfile: "Any",
    vegetarian: "Any",
    parkingRequired: false,
    timeline: "Within 30 days" as const,
    neededBy: null,
    notes: "Near the ring road",
  };
}

async function ownerWithMeta(db: Awaited<ReturnType<typeof setup>>) {
  const lead = await createOwnerLead(
    db,
    executive,
    { name: "Akhil Ahmed Khan", phone: "9845011111" },
    { intent: "Lease", propertyType: "House", locality: "Santraswadi", locationText: "GDA layout", expectedPrice: 25000, notes: "Owner note", priority: "Warm" },
    parseSourceInput({
      channel: "meta_lead_form",
      metaLeadId: "meta-owner-1",
      metaFormId: "4571827589754551",
      metaFormName: "Gulbarga Rental Property Owner",
      metaCampaignId: "camp-owner",
      metaCampaignName: "Owner campaign",
    }),
    NOW,
  );
  await db.prepare("UPDATE lead_sources SET raw_payload_json = ?1 WHERE id = ?2").bind('{"answers":["kept"]}', lead.sourceId).run();
  return (await getOwnerLead(db, lead.id))!;
}

describe("owner to client requirements", () => {
  it("adds a buyer requirement on the same contact and leaves the owner lead unchanged", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const before = await getSource(db, lead.sourceId);
    const result = await addClientRequirements(
      db,
      executive,
      lead.id,
      { idempotencyKey: "buyer-key-01", requirements: [{ ...details(4_000_000, 6_000_000, "Sedam Road"), intent: "Buy" }] },
      NOW,
    );
    assert.equal(result.created, true);
    assert.equal(result.requirements.length, 1);
    const requirement = (await getRequirement(db, result.requirements[0].id))!;
    assert.equal(requirement.intent, "Buy");
    assert.equal(requirement.status, "New");
    assert.equal(requirement.contactId, lead.contactId);
    assert.equal(requirement.originOwnerLeadId, lead.id);
    assert.deepEqual(matchableBudget(requirement), { basis: "purchase", unit: "inr_total", min: 4_000_000, max: 6_000_000 });

    const owner = (await getOwnerLead(db, lead.id))!;
    assert.equal(owner.intent, "Lease");
    assert.equal(owner.status, "New");
    assert.equal(owner.sourceId, lead.sourceId);
    assert.deepEqual(await getSource(db, lead.sourceId), before);
    const contact = await findContactByPhone(db, "9845011111");
    assert.equal(contact?.isOwner, true);
    assert.equal(contact?.isSeeker, true);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM contacts").first<{ n: number }>())?.n, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);

    const manual = await db
      .prepare("SELECT meta_lead_id, meta_campaign_id, channel FROM lead_sources WHERE id = ?1")
      .bind(requirement.sourceId)
      .first<{ meta_lead_id: string | null; meta_campaign_id: string; channel: string }>();
    assert.equal(manual?.meta_lead_id, null);
    assert.equal(manual?.meta_campaign_id, "");
    assert.equal(manual?.channel, "manual");
    const funnel = await db
      .prepare("SELECT leads, owner_leads, requirements FROM campaign_lead_funnel WHERE campaign_id = 'camp-owner'")
      .first<{ leads: number; owner_leads: number; requirements: number }>();
    assert.equal(funnel?.leads, 1);
    assert.equal(funnel?.owner_leads, 1);
    assert.equal(funnel?.requirements, 0);

    const ownerAudit = await listAudit(db, { entityType: "owner_lead", entityId: lead.id });
    const added = ownerAudit.find((entry) => entry.action === "add_client_requirement");
    assert.equal(added?.actorId, executive.id);
    assert.equal(added?.actorEmail, executive.email);
    const requirementAudit = await listAudit(db, { entityType: "requirement", entityId: requirement.id });
    assert.equal(requirementAudit[0]?.actorId, executive.id);
    assert.equal(requirementAudit[0]?.context.owner_lead_id, lead.id);
  });

  it("adds a tenant requirement with a monthly budget", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const result = await addClientRequirements(
      db,
      executive,
      lead.id,
      { idempotencyKey: "tenant-key-1", requirements: [{ ...details(10_000, 15_000, "Jewargi Road"), intent: "Rent" }] },
      NOW,
    );
    const requirement = result.requirements[0];
    assert.equal(requirement.intent, "Rent");
    assert.deepEqual(matchableBudget(requirement), { basis: "monthly", unit: "inr_per_month", min: 10_000, max: 15_000 });
    assert.equal((await getOwnerLead(db, lead.id))?.intent, "Lease");
  });

  it("adds both requirements atomically and a failed batch leaves nothing behind", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const originalBatch = db.batch.bind(db);
    db.batch = (statements) => originalBatch([...statements, db.prepare("INSERT INTO demand_requirements (id) VALUES (NULL)")]);
    await assert.rejects(
      addClientRequirements(
        db,
        executive,
        lead.id,
        {
          idempotencyKey: "both-key-001",
          requirements: [
            { ...details(4_000_000, 6_000_000, "Sedam Road"), intent: "Buy" },
            { ...details(12_000, 18_000, "Alang Road"), intent: "Rent" },
          ],
        },
        NOW,
      ),
    );
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lead_sources WHERE channel = 'manual'").first<{ n: number }>())?.n, 0);
    assert.equal((await findContactByPhone(db, "9845011111"))?.isSeeker, false);
    assert.equal((await listAudit(db, { entityType: "owner_lead", entityId: lead.id })).some((entry) => entry.action === "add_client_requirement"), false);
    assert.equal((await getOwnerLead(db, lead.id))?.status, "New");

    db.batch = originalBatch;
    const result = await addClientRequirements(
      db,
      executive,
      lead.id,
      {
        idempotencyKey: "both-key-001",
        requirements: [
          { ...details(4_000_000, 6_000_000, "Sedam Road"), intent: "Buy" },
          { ...details(12_000, 18_000, "Alang Road"), intent: "Rent" },
        ],
      },
      NOW,
    );
    assert.equal(result.created, true);
    assert.deepEqual(
      result.requirements.map((item) => item.intent),
      ["Buy", "Rent"],
    );
    assert.deepEqual(matchableBudget(result.requirements[0]), { basis: "purchase", unit: "inr_total", min: 4_000_000, max: 6_000_000 });
    assert.deepEqual(matchableBudget(result.requirements[1]), { basis: "monthly", unit: "inr_per_month", min: 12_000, max: 18_000 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>())?.n, 2);
    assert.equal((await findContactByPhone(db, "9845011111"))?.isSeeker, true);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);
  });

  it("returns the original requirements for a repeated key, including two requests at once", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const input = {
      idempotencyKey: "repeat-key-01",
      requirements: [{ ...details(5_000_000, 7_000_000, "Sedam Road"), intent: "Buy" as const }],
    };
    const [first, second] = await Promise.all([
      addClientRequirements(db, executive, lead.id, input, NOW),
      addClientRequirements(db, executive, lead.id, input, NOW),
    ]);
    assert.equal(first.requirements[0].id, second.requirements[0].id);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
    const again = await addClientRequirements(db, executive, lead.id, input, NOW);
    assert.equal(again.created, false);
    assert.equal(again.requirements[0].id, first.requirements[0].id);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>())?.n, 1);

    const later = await addClientRequirements(
      db,
      executive,
      lead.id,
      { idempotencyKey: "later-key-001", requirements: [{ ...details(8_000, 12_000, "Jewargi Road"), intent: "Rent" }] },
      NOW,
    );
    assert.equal(later.created, true);
    assert.notEqual(later.requirements[0].id, first.requirements[0].id);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>())?.n, 2);
  });

  it("rejects a repeated key used for another owner lead or a different payload", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const input = {
      idempotencyKey: "bound-key-01",
      requirements: [{ ...details(5_000_000, 7_000_000, "Sedam Road"), intent: "Buy" as const }],
    };
    const first = await addClientRequirements(db, executive, lead.id, input, NOW);

    const other = await createOwnerLead(
      db,
      executive,
      { name: "Other Owner", phone: "9845022222" },
      { intent: "Sale", propertyType: "Plot", locality: "Alang Road", locationText: "", expectedPrice: 2000000, notes: "", priority: "Warm" },
      parseSourceInput({ channel: "phone" }),
      NOW,
    );
    await assert.rejects(addClientRequirements(db, executive, other.id, input, NOW), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      return true;
    });
    assert.equal((await findContactByPhone(db, "9845022222"))?.isSeeker, false);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements WHERE origin_owner_lead_id = ?1").bind(other.id).first<{ n: number }>())?.n, 0);

    const changedBudget = {
      ...input,
      requirements: [{ ...details(5_000_000, 9_000_000, "Sedam Road"), intent: "Buy" as const }],
    };
    await assert.rejects(addClientRequirements(db, executive, lead.id, changedBudget, NOW), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      return true;
    });
    const both = {
      idempotencyKey: input.idempotencyKey,
      requirements: [input.requirements[0], { ...details(12_000, 18_000, "Alang Road"), intent: "Rent" as const }],
    };
    await assert.rejects(addClientRequirements(db, executive, lead.id, both, NOW), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      return true;
    });

    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>())?.n, 1);
    assert.equal((await getRequirement(db, first.requirements[0].id))?.budgetMax, 7_000_000);
    assert.equal((await getRequirement(db, first.requirements[0].id))?.originOwnerLeadId, lead.id);

    const [kept, rejected] = await Promise.allSettled([
      addClientRequirements(db, executive, lead.id, input, NOW),
      addClientRequirements(db, executive, lead.id, changedBudget, NOW),
    ]);
    assert.equal(kept.status, "fulfilled");
    assert.equal(rejected.status, "rejected");
    if (kept.status === "fulfilled") {
      assert.equal(kept.value.created, false);
      assert.equal(kept.value.requirements[0].id, first.requirements[0].id);
    }
    if (rejected.status === "rejected") {
      assert.ok(rejected.reason instanceof HttpError);
      assert.equal(rejected.reason.status, 409);
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>())?.n, 1);

    const left = {
      idempotencyKey: "race-key-001",
      requirements: [{ ...details(1_000_000, 2_000_000, "Sedam Road"), intent: "Buy" as const }],
    };
    const right = {
      idempotencyKey: "race-key-001",
      requirements: [{ ...details(3_000_000, 4_000_000, "Jewargi Road"), intent: "Buy" as const }],
    };
    const raced = await Promise.allSettled([
      addClientRequirements(db, executive, lead.id, left, NOW),
      addClientRequirements(db, executive, lead.id, right, NOW),
    ]);
    assert.equal(raced.filter((item) => item.status === "fulfilled").length, 1);
    const raceRefusal = raced.find((item) => item.status === "rejected");
    assert.ok(raceRefusal && raceRefusal.status === "rejected" && raceRefusal.reason instanceof HttpError);
    assert.equal(raceRefusal.reason.status, 409);
    const raceRow = await db
      .prepare("SELECT budget_max, origin_owner_lead_id FROM demand_requirements WHERE idempotency_key = 'race-key-001:Buy'")
      .first<{ budget_max: number; origin_owner_lead_id: string }>();
    const raceWinner = raced.find((item) => item.status === "fulfilled");
    assert.ok(raceWinner && raceWinner.status === "fulfilled");
    assert.equal(raceRow?.budget_max, raceWinner.value.requirements[0].budgetMax);
    assert.equal(raceRow?.origin_owner_lead_id, lead.id);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements WHERE idempotency_key LIKE 'race-key-001:%'").first<{ n: number }>())?.n, 1);

    const shared = {
      idempotencyKey: "race-owner-1",
      requirements: [{ ...details(8_000, 12_000, "Alang Road"), intent: "Rent" as const }],
    };
    const racedOwners = await Promise.allSettled([
      addClientRequirements(db, executive, lead.id, shared, NOW),
      addClientRequirements(db, executive, other.id, shared, NOW),
    ]);
    assert.equal(racedOwners.filter((item) => item.status === "fulfilled").length, 1);
    const ownerRefusal = racedOwners.find((item) => item.status === "rejected");
    assert.ok(ownerRefusal && ownerRefusal.status === "rejected" && ownerRefusal.reason instanceof HttpError);
    assert.equal(ownerRefusal.reason.status, 409);
    const ownerWinner = racedOwners.find((item) => item.status === "fulfilled");
    assert.ok(ownerWinner && ownerWinner.status === "fulfilled");
    assert.equal(
      (await db.prepare("SELECT origin_owner_lead_id FROM demand_requirements WHERE idempotency_key = 'race-owner-1:Rent'").first<{ origin_owner_lead_id: string }>())
        ?.origin_owner_lead_id,
      ownerWinner.value.requirements[0].originOwnerLeadId,
    );
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demand_requirements WHERE idempotency_key LIKE 'race-owner-1:%'").first<{ n: number }>())?.n, 1);
  });

  it("keeps the owner flag and contact details when an edit lands during requirement creation", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const contact = (await findContactByPhone(db, "9845011111"))!;
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.batch = originalBatch;
      await updateContact(
        db,
        executive,
        contact,
        { name: "Akhil A. Khan", notes: "Call after 6", email: "akhil@example.com", doNotContact: true, doNotContactReason: "Asked later" },
        { now: NOW, expectedVersion: contact.rowVersion },
      );
      return originalBatch(statements);
    };
    const result = await addClientRequirements(
      db,
      executive,
      lead.id,
      { idempotencyKey: "contact-key1", requirements: [{ ...details(4_000_000, 6_000_000, "Sedam Road"), intent: "Buy" }] },
      NOW,
    );
    const saved = (await findContactByPhone(db, "9845011111"))!;
    assert.equal(saved.id, contact.id);
    assert.equal(saved.isOwner, true);
    assert.equal(saved.isSeeker, true);
    assert.equal(saved.name, "Akhil A. Khan");
    assert.equal(saved.phone, contact.phone);
    assert.equal(saved.notes, "Call after 6");
    assert.equal(saved.email, "akhil@example.com");
    assert.equal(saved.doNotContact, true);
    assert.equal(saved.doNotContactReason, "Asked later");
    assert.equal(result.requirements[0].contactId, contact.id);
    assert.equal((await getOwnerLead(db, lead.id))?.intent, "Lease");
    assert.equal((await getOwnerLead(db, lead.id))?.status, "New");

    await assert.rejects(
      updateContact(db, executive, contact, { notes: "This write used the old version" }, { now: NOW, expectedVersion: contact.rowVersion }),
      /changed this contact/,
    );
    const edited = await updateContact(
      db,
      executive,
      saved,
      { notes: "Morning calls only" },
      { now: NOW, expectedVersion: saved.rowVersion },
    );
    assert.equal(edited.isOwner, true);
    assert.equal(edited.isSeeker, true);
    assert.equal(edited.name, "Akhil A. Khan");
    assert.equal(edited.phone, contact.phone);
    assert.equal(edited.email, "akhil@example.com");
    assert.equal(edited.notes, "Morning calls only");
    assert.equal((await getRequirement(db, result.requirements[0].id))?.status, "New");
  });

  it("keeps owner and requirement lifecycles independent", async () => {
    const db = await setup();
    const lead = await ownerWithMeta(db);
    const result = await addClientRequirements(
      db,
      executive,
      lead.id,
      { idempotencyKey: "life-key-001", requirements: [{ ...details(10_000, 20_000, "Sedam Road"), intent: "Rent" }] },
      NOW,
    );
    const closedOwner = await updateOwnerLead(db, executive, lead, { status: "Not interested", statusReason: "Called" }, { now: NOW });
    assert.equal((await getRequirement(db, result.requirements[0].id))?.status, "New");
    await updateRequirement(db, executive, result.requirements[0], { status: "Lost", statusReason: "Budget", outcome: "Found elsewhere" }, { now: NOW });
    assert.equal((await getOwnerLead(db, lead.id))?.status, closedOwner.status);
    assert.equal((await getOwnerLead(db, lead.id))?.intent, "Lease");
  });

  it("lets lead staff add a requirement and keeps viewers from editing the CRM", () => {
    assert.equal(can("viewer", "crm.edit"), false);
    assert.equal(can("viewer", "crm.view"), true);
    assert.equal(can("lead_executive", "crm.edit"), true);
    assert.equal(can("inventory_manager", "crm.edit"), true);
    assert.equal(can("super_admin", "crm.edit"), true);
    assert.equal(can("viewer", "contact.view_phone"), false);
    assert.equal(can("lead_executive", "contact.view_phone"), true);
  });
});
