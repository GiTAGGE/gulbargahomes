import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { can } from "../lib/admin/permissions";
import { findContactByPhone, updateContact } from "../lib/crm/contacts";
import { addClientRequirements } from "../lib/crm/owner-client";
import { convertOwnerLead, createOwnerLead, getOwnerLead, listOwnerLeads, setOwnerLeadRoleReview, updateOwnerLead } from "../lib/crm/owner-leads";
import { getRequirement } from "../lib/crm/requirements";
import { getSource, parseSourceInput } from "../lib/crm/sources";
import { todayQueue } from "../lib/crm/today";
import { prepareDatabase } from "../lib/db/prepare";
import { HttpError } from "../lib/admin/errors";
import { createTestDb } from "./helpers/sqlite";

const executive = { id: "adm_exec", email: "leads@example.com", role: "lead_executive" };
const NOW = "2026-11-11T16:00:00.000Z";

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

async function ownerWithRequirement(db: Awaited<ReturnType<typeof setup>>) {
  const lead = await createOwnerLead(
    db,
    executive,
    { name: "Akhil Ahmed Khan", phone: "9845011111" },
    { intent: "Rent", propertyType: "House", locality: "Santraswadi", locationText: "GDA layout", expectedPrice: 25000, notes: "Owner note", priority: "Warm" },
    parseSourceInput({
      channel: "meta_lead_form",
      metaLeadId: "meta-owner-role",
      metaFormId: "4571827589754551",
      metaFormName: "Gulbarga Rental Property Owner",
      metaCampaignId: "camp-owner",
      metaCampaignName: "Owner campaign",
    }),
    NOW,
  );
  await db.prepare("UPDATE lead_sources SET raw_payload_json = ?1 WHERE id = ?2").bind('{"answers":["kept"]}', lead.sourceId).run();
  const requirement = await addClientRequirements(
    db,
    executive,
    lead.id,
    {
      idempotencyKey: "tenant-role-1",
      requirements: [
        {
          intent: "Rent",
          propertyTypes: ["House"],
          bhkMin: null,
          bhkMax: null,
          budgetMin: 10000,
          budgetMax: 15000,
          localities: ["Sedam Road"],
          localityFlexible: false,
          areaMin: null,
          furnishing: "Any",
          tenantProfile: "Any",
          vegetarian: "Any",
          parkingRequired: false,
          timeline: "Within 30 days",
          neededBy: null,
          notes: "Looking for a rental house",
        },
      ],
    },
    NOW,
  );
  return { lead: (await getOwnerLead(db, lead.id))!, requirementId: requirement.requirements[0].id };
}

describe("owner lead role review", () => {
  it("marks a lead as not an owner without changing its status, source, or tenant requirement", async () => {
    const db = await setup();
    const { lead, requirementId } = await ownerWithRequirement(db);
    const before = await getSource(db, lead.sourceId);
    const marked = await setOwnerLeadRoleReview(db, executive, lead, "misclassified", "He confirmed he wants a rental house", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });

    assert.equal(marked.roleReview, "misclassified");
    assert.equal(marked.status, "New");
    assert.equal(marked.intent, "Rent");
    assert.equal(marked.sourceId, lead.sourceId);
    assert.deepEqual(await getSource(db, lead.sourceId), before);
    assert.equal((await getRequirement(db, requirementId))?.status, "New");
    assert.equal((await getRequirement(db, requirementId))?.intent, "Rent");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);
    const contact = await findContactByPhone(db, "9845011111");
    assert.equal(contact?.isOwner, false);
    assert.equal(contact?.isSeeker, true);

    const funnel = await db
      .prepare("SELECT leads, owner_leads, requirements FROM campaign_lead_funnel WHERE campaign_id = 'camp-owner'")
      .first<{ leads: number; owner_leads: number; requirements: number }>();
    assert.equal(funnel?.leads, 1);
    assert.equal(funnel?.owner_leads, 1);
    assert.equal(funnel?.requirements, 0);

    const audit = (await listAudit(db, { entityType: "owner_lead", entityId: lead.id })).find((entry) => entry.action === "mark_not_owner");
    assert.equal(audit?.actorId, executive.id);
    assert.equal(audit?.actorEmail, executive.email);
    assert.equal(audit?.changes.role_review?.[1], "misclassified");
    assert.equal("status" in (audit?.changes ?? {}), false);
    const contactAudit = (await listAudit(db, { entityType: "contact", entityId: lead.contactId })).find(
      (entry) => entry.action === "update" && Array.isArray(entry.changes.is_owner),
    );
    assert.equal(contactAudit?.actorId, executive.id);
    assert.deepEqual(contactAudit?.changes.is_owner, [1, 0]);

    await assert.rejects(convertOwnerLead(db, executive, marked, { now: NOW }), /not an owner/);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);
    assert.equal((await todayQueue(db, { includeDiscreet: false }, new Date(NOW))).newOwnerLeads.some((item) => item.id === lead.id), false);
    assert.equal((await listOwnerLeads(db, { status: "open" })).some((item) => item.id === lead.id), false);
    assert.equal((await listOwnerLeads(db, {})).some((item) => item.id === lead.id), true);

    const again = await setOwnerLeadRoleReview(db, executive, marked, "misclassified", marked.roleReviewNote, {
      now: NOW,
      expectedVersion: marked.rowVersion,
    });
    assert.equal(again.rowVersion, marked.rowVersion);
    assert.equal((await listAudit(db, { entityType: "owner_lead", entityId: lead.id })).filter((entry) => entry.action === "mark_not_owner").length, 1);

    const contacted = await updateOwnerLead(db, executive, again, { status: "Contacted", statusReason: "Called" }, { now: NOW });
    assert.equal(contacted.status, "Contacted");
    assert.equal(contacted.roleReview, "misclassified");
    const restored = await setOwnerLeadRoleReview(db, executive, contacted, "owner", "He does have a house to let", {
      now: NOW,
      expectedVersion: contacted.rowVersion,
    });
    assert.equal(restored.roleReview, "");
    assert.equal(restored.status, "Contacted");
    assert.equal((await findContactByPhone(db, "9845011111"))?.isOwner, true);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n, 0);
    const restoredAudit = (await listAudit(db, { entityType: "owner_lead", entityId: lead.id })).find((entry) => entry.action === "restore_owner_role");
    assert.equal(restoredAudit?.actorId, executive.id);
  });

  it("keeps the owner badge while another owner lead for the same person remains", async () => {
    const db = await setup();
    const { lead } = await ownerWithRequirement(db);
    const second = await createOwnerLead(
      db,
      executive,
      { name: "Akhil Ahmed Khan", phone: "9845011111" },
      { intent: "Sale", propertyType: "Plot", locality: "Alang Road", locationText: "", expectedPrice: 2000000, notes: "", priority: "Warm" },
      parseSourceInput({ channel: "meta_lead_form", metaLeadId: "meta-owner-role-2" }),
      NOW,
    );
    await setOwnerLeadRoleReview(db, executive, lead, "misclassified", "The rental form was his own search", {
      now: NOW,
      expectedVersion: lead.rowVersion,
    });
    assert.equal((await findContactByPhone(db, "9845011111"))?.isOwner, true);
    assert.equal((await getOwnerLead(db, second.id))?.status, "New");
    await setOwnerLeadRoleReview(db, executive, second, "misclassified", "Neither form is an owner enquiry", {
      now: NOW,
      expectedVersion: second.rowVersion,
    });
    assert.equal((await findContactByPhone(db, "9845011111"))?.isOwner, false);
    assert.equal((await findContactByPhone(db, "9845011111"))?.isSeeker, true);
  });

  it("rolls back the classification and keeps contact edits that land in the same moment", async () => {
    const db = await setup();
    const { lead } = await ownerWithRequirement(db);
    const contact = (await findContactByPhone(db, "9845011111"))!;
    const originalBatch = db.batch.bind(db);
    db.batch = (statements) => originalBatch([...statements, db.prepare("INSERT INTO owner_leads (id) VALUES (NULL)")]);
    await assert.rejects(
      setOwnerLeadRoleReview(db, executive, lead, "misclassified", "Confirmed on the call", { now: NOW, expectedVersion: lead.rowVersion }),
    );
    assert.equal((await getOwnerLead(db, lead.id))?.roleReview, "");
    assert.equal((await getOwnerLead(db, lead.id))?.status, "New");
    assert.equal((await findContactByPhone(db, "9845011111"))?.isOwner, true);
    assert.equal((await listAudit(db, { entityType: "owner_lead", entityId: lead.id })).some((entry) => entry.action === "mark_not_owner"), false);

    db.batch = async (statements) => {
      db.batch = originalBatch;
      await updateContact(
        db,
        executive,
        contact,
        { name: "Akhil A. Khan", notes: "Call after 6" },
        { now: NOW, expectedVersion: contact.rowVersion },
      );
      return originalBatch(statements);
    };
    await setOwnerLeadRoleReview(db, executive, lead, "misclassified", "Confirmed on the call", { now: NOW, expectedVersion: lead.rowVersion });
    const saved = (await findContactByPhone(db, "9845011111"))!;
    assert.equal(saved.name, "Akhil A. Khan");
    assert.equal(saved.notes, "Call after 6");
    assert.equal(saved.phone, contact.phone);
    assert.equal(saved.isOwner, false);
    assert.equal(saved.isSeeker, true);
  });

  it("requires a reason and keeps viewers from editing the CRM", async () => {
    const db = await setup();
    const { lead } = await ownerWithRequirement(db);
    await assert.rejects(
      setOwnerLeadRoleReview(db, executive, lead, "misclassified", " ", { now: NOW, expectedVersion: lead.rowVersion }),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
    assert.equal(can("viewer", "crm.edit"), false);
    assert.equal(can("lead_executive", "crm.edit"), true);
    assert.equal(can("inventory_manager", "crm.edit"), true);
    assert.equal(can("super_admin", "crm.edit"), true);
  });
});
