import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { can } from "../lib/admin/permissions";
import { createFollowup } from "../lib/crm/activity";
import { FORM_RECORD_PAGE, formDesk, formDeskCounts } from "../lib/crm/form-desk";
import { createOwnerLead } from "../lib/crm/owner-leads";
import { createRequirement, parseRequirementInput } from "../lib/crm/requirements";
import { parseSourceInput } from "../lib/crm/sources";
import { todayQueue } from "../lib/crm/today";
import { prepareDatabase } from "../lib/db/prepare";
import type { SqlDb } from "../lib/db/sql";
import { requeueIngestions } from "../lib/meta/ingest";
import { createTestDb } from "./helpers/sqlite";

const NOW = "2026-11-10T10:00:00.000Z";
const actor = { id: "adm_test", email: "exec@example.com", role: "inventory_manager" };

const RENTAL = "4571827589754551";
const JV = "1601516668397039";
const OWNER = "2023485355008623";
const AREA = "1331233742375480";
const BUYER = "1489593689660590";
const COPY = "1071121499253613";

const FAILED_A = "mli_aaaaaaaaaaaaaaaaaaaa";
const FAILED_B = "mli_bbbbbbbbbbbbbbbbbbbb";
const HELD_JV = "mli_cccccccccccccccccccc";
const HELD_PHONE = "mli_dddddddddddddddddddd";

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

async function insertForm(
  db: SqlDb,
  form: { id: string; name: string; classification: string; ownerIntent?: string; leads: number; status?: string },
) {
  await db
    .prepare(
      `INSERT INTO meta_forms (form_id, page_id, name, status, classification, owner_intent, leads_count, discovered_at, synced_at, updated_at, updated_by)
       VALUES (?1, 'page', ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7, 'test')`,
    )
    .bind(form.id, form.name, form.status ?? "ACTIVE", form.classification, form.ownerIntent ?? "", form.leads, NOW)
    .run();
}

async function insertIngestion(db: SqlDb, id: string, formId: string, status: string, payload = "") {
  await db
    .prepare(
      `INSERT INTO meta_lead_ingestions (id, leadgen_id, form_id, origin, status, next_attempt_at, last_error, last_error_kind, payload_json, received_at, updated_at)
       VALUES (?1, ?2, ?3, 'import', ?4, ?5, '', '', ?6, ?5, ?5)`,
    )
    .bind(id, `lead-${id}`, formId, status, NOW, payload)
    .run();
}

async function statusOf(db: SqlDb, id: string) {
  const row = await db.prepare("SELECT status FROM meta_lead_ingestions WHERE id = ?1").bind(id).first<{ status: string }>();
  return row?.status ?? "";
}

describe("form desk counts", () => {
  it("counts each production form without treating a repeated fetch as a skipped person", () => {
    assert.deepEqual(formDeskCounts("owner", 41, { done: 41 }), {
      imported: 41,
      held: 0,
      duplicates: 0,
      excluded: 0,
      notFetched: 0,
      toRetry: 0,
    });
    assert.deepEqual(formDeskCounts("owner", 14, { needs_review: 14 }), {
      imported: 0,
      held: 14,
      duplicates: 0,
      excluded: 0,
      notFetched: 0,
      toRetry: 0,
    });
    assert.deepEqual(formDeskCounts("owner", 82, { done: 80, needs_review: 2 }), {
      imported: 80,
      held: 2,
      duplicates: 0,
      excluded: 0,
      notFetched: 0,
      toRetry: 0,
    });
    assert.deepEqual(formDeskCounts("owner", 9, { done: 9 }), {
      imported: 9,
      held: 0,
      duplicates: 0,
      excluded: 0,
      notFetched: 0,
      toRetry: 0,
    });
    assert.deepEqual(formDeskCounts("mixed", 1, {}), {
      imported: 0,
      held: 0,
      duplicates: 0,
      excluded: 0,
      notFetched: 1,
      toRetry: 0,
    });
    assert.deepEqual(formDeskCounts("unclassified", 142, {}), {
      imported: 0,
      held: 0,
      duplicates: 0,
      excluded: 142,
      notFetched: 0,
      toRetry: 0,
    });
    const withQueueDuplicate = formDeskCounts("owner", 41, { done: 40, duplicate: 1 });
    assert.equal(withQueueDuplicate.duplicates, 1);
    assert.equal(withQueueDuplicate.excluded, 0);
    assert.equal(withQueueDuplicate.notFetched, 0);
  });

  it("keeps each form's leads, holds and excluded counts separate", async () => {
    const db = await setup();
    await insertForm(db, { id: RENTAL, name: "Gulbarga Rental Property Owner", classification: "owner", ownerIntent: "Rent", leads: 1 });
    await insertForm(db, { id: JV, name: "Agricultural Land JV | Kalaburagi", classification: "owner", leads: 1, status: "PAUSED" });
    await insertForm(db, { id: OWNER, name: "Gulbarga Property Owner", classification: "owner", leads: 2 });
    await insertForm(db, { id: AREA, name: "Rent Owners | AreaWise", classification: "owner", ownerIntent: "Rent", leads: 1 });
    await insertForm(db, { id: BUYER, name: "Gulbarga Buyer & Renter", classification: "mixed", leads: 1 });
    await insertForm(db, { id: COPY, name: "Gulbarga Buyer & Renter-copy", classification: "unclassified", leads: 142, status: "PAUSED" });

    await insertIngestion(db, "mli_10000000000000000001", RENTAL, "done");
    await insertIngestion(db, HELD_JV, JV, "needs_review");
    await insertIngestion(db, "mli_10000000000000000002", OWNER, "done");
    const phone = JSON.stringify({
      id: "phone-lead",
      fieldData: [
        { name: "full_name", values: ["Abroad seller"] },
        { name: "phone_number", values: ["+19876543210"] },
      ],
    });
    await insertIngestion(db, HELD_PHONE, OWNER, "needs_review", phone);
    await insertIngestion(db, "mli_10000000000000000003", AREA, "done");

    const lead = await createOwnerLead(
      db,
      actor,
      { name: "Ravi Patil", phone: "9845012345" },
      { intent: "Rent", propertyType: "House", locality: "Sedam Road", locationText: "", expectedPrice: 14000, notes: "", priority: "Warm" },
      parseSourceInput({ channel: "meta_lead_form", metaFormId: RENTAL, metaFormName: "Gulbarga Rental Property Owner" }),
      NOW,
    );

    const sections = await formDesk(db, { canViewPhone: false });
    const byId = Object.fromEntries(sections.map((section) => [section.form.formId, section]));

    assert.equal(byId[RENTAL].counts.imported, 1);
    assert.equal(byId[RENTAL].ownerLeads.some((item) => item.id === lead.id), true);
    assert.equal(byId[JV].ownerLeads.some((item) => item.id === lead.id), false);
    assert.equal(byId[JV].counts.held, 1);
    assert.equal(byId[JV].held.length, 1);
    assert.equal(byId[JV].retryable.length, 0);
    assert.equal(byId[JV].paused, true);
    assert.equal(byId[OWNER].counts.imported, 1);
    assert.equal(byId[OWNER].counts.held, 1);
    assert.equal(byId[OWNER].held[0]?.preview.phone.includes("9876543210"), false);
    assert.equal(byId[OWNER].held[0]?.preview.phone.endsWith("3210"), true);
    assert.equal(byId[AREA].counts.imported, 1);
    assert.deepEqual(byId[BUYER].counts, {
      imported: 0,
      held: 0,
      duplicates: 0,
      excluded: 0,
      notFetched: 1,
      toRetry: 0,
    });
    assert.equal(byId[BUYER].ownerLeads.length, 0);
    assert.equal(byId[COPY].counts.imported, 0);
    assert.equal(byId[COPY].counts.excluded, 142);
    assert.equal(byId[COPY].counts.notFetched, 0);
    assert.equal(byId[COPY].held.length, 0);
    assert.equal(byId[COPY].retryable.length, 0);

    const visible = await formDesk(db, { canViewPhone: true });
    const owner = visible.find((section) => section.form.formId === OWNER);
    assert.equal(owner?.held[0]?.preview.phone.includes("9876543210"), true);
  });

  it("pages owner leads and requirements without changing the form totals", async () => {
    const db = await setup();
    await insertForm(db, { id: RENTAL, name: "Gulbarga Rental Property Owner", classification: "owner", ownerIntent: "Rent", leads: 41 });
    await insertIngestion(db, "mli_10000000000000000011", RENTAL, "done");
    const total = FORM_RECORD_PAGE + 1;
    for (let index = 0; index < total; index += 1) {
      await createOwnerLead(
        db,
        actor,
        { name: `Owner ${index}`, phone: `9${String(index).padStart(9, "0")}` },
        { intent: "Rent", propertyType: "House", locality: "Sedam Road", locationText: "", expectedPrice: 14000, notes: "", priority: "Warm" },
        parseSourceInput({ channel: "meta_lead_form", metaFormId: RENTAL, metaFormName: "Gulbarga Rental Property Owner", metaLeadId: `rent-${index}` }),
        NOW,
      );
    }
    await createRequirement(
      db,
      actor,
      { name: "Asha K", phone: "9900011122" },
      parseRequirementInput({ intent: "Rent", propertyTypes: ["House"], budgetMin: 10000, budgetMax: 15000, localities: ["Sedam Road"], timeline: "Immediate" }),
      parseSourceInput({ channel: "meta_lead_form", metaFormId: RENTAL, metaFormName: "Gulbarga Rental Property Owner", metaLeadId: "req-1" }),
      NOW,
    );
    await createRequirement(
      db,
      actor,
      { name: "Kiran", phone: "9900011133" },
      parseRequirementInput({ intent: "Buy", propertyTypes: ["Plot"], budgetMin: 1000000, budgetMax: 2000000, localities: ["Kotnoor"], timeline: "Exploring" }),
      parseSourceInput({ channel: "meta_lead_form", metaFormId: RENTAL, metaFormName: "Gulbarga Rental Property Owner", metaLeadId: "req-2" }),
      NOW,
    );

    const first = (await formDesk(db, { canViewPhone: true, pages: { formId: RENTAL, owner: 1, requirement: 1 } })).find(
      (section) => section.form.formId === RENTAL,
    )!;
    assert.equal(first.counts.imported, 1);
    assert.equal(first.ownerLeadTotal, total);
    assert.equal(first.ownerLeads.length, FORM_RECORD_PAGE);
    assert.equal(first.requirementTotal, 2);
    assert.equal(first.requirements.length, 2);

    const second = (await formDesk(db, { canViewPhone: true, pages: { formId: RENTAL, owner: 2 } })).find(
      (section) => section.form.formId === RENTAL,
    )!;
    assert.equal(second.counts.imported, 1);
    assert.equal(second.ownerLeadTotal, total);
    assert.equal(second.ownerLeadPage, 2);
    assert.equal(second.ownerLeads.length, 1);
    assert.equal(first.ownerLeads.some((lead) => lead.id === second.ownerLeads[0]?.id), false);
    assert.equal(second.requirementTotal, 2);
  });

  it("pages held review rows and keeps the held count complete", async () => {
    const db = await setup();
    await insertForm(db, { id: JV, name: "Agricultural Land JV | Kalaburagi", classification: "owner", leads: FORM_RECORD_PAGE + 1 });
    const total = FORM_RECORD_PAGE + 1;
    for (let index = 0; index < total; index += 1) {
      await insertIngestion(db, `mli_${index.toString(16).padStart(20, "0")}`, JV, "needs_review");
    }

    const first = (await formDesk(db, { canViewPhone: false, pages: { formId: JV, held: 1 } })).find((section) => section.form.formId === JV)!;
    assert.equal(first.counts.held, total);
    assert.equal(first.held.length, FORM_RECORD_PAGE);
    assert.equal(first.heldPage, 1);
    assert.equal(first.retryable.length, 0);

    const second = (await formDesk(db, { canViewPhone: false, pages: { formId: JV, held: 2 } })).find((section) => section.form.formId === JV)!;
    assert.equal(second.counts.held, total);
    assert.equal(second.heldPage, 2);
    assert.equal(second.held.length, 1);
    assert.equal(first.held.some((row) => row.id === second.held[0]?.id), false);
  });
});

describe("scoped retry", () => {
  async function queue() {
    const db = await setup();
    await insertForm(db, { id: RENTAL, name: "Gulbarga Rental Property Owner", classification: "owner", ownerIntent: "Rent", leads: 1 });
    await insertForm(db, { id: JV, name: "Agricultural Land JV | Kalaburagi", classification: "owner", leads: 1 });
    await insertForm(db, { id: OWNER, name: "Gulbarga Property Owner", classification: "owner", leads: 1 });
    await insertIngestion(db, FAILED_A, RENTAL, "failed");
    await insertIngestion(db, FAILED_B, OWNER, "failed");
    await insertIngestion(db, HELD_JV, JV, "needs_review");
    await insertIngestion(db, HELD_PHONE, OWNER, "needs_review");
    return db;
  }

  it("rejects an empty selection and does not retry another form or a held lead", async () => {
    const db = await queue();
    await assert.rejects(requeueIngestions(db, { ids: [], formId: RENTAL }, NOW), /Choose the leads/);
    await assert.rejects(requeueIngestions(db, { ids: [FAILED_A], formId: "" }, NOW), /Choose one form/);
    await assert.rejects(requeueIngestions(db, { ids: [FAILED_A, FAILED_B], formId: RENTAL }, NOW), /Nothing was retried/);
    await assert.rejects(requeueIngestions(db, { ids: [HELD_JV], formId: JV }, NOW), /Nothing was retried/);
    await assert.rejects(requeueIngestions(db, { ids: [HELD_PHONE], formId: OWNER }, NOW), /Nothing was retried/);
    await assert.rejects(requeueIngestions(db, { ids: [FAILED_B, HELD_PHONE], formId: OWNER }, NOW), /Nothing was retried/);

    assert.equal(await statusOf(db, FAILED_A), "failed");
    assert.equal(await statusOf(db, FAILED_B), "failed");
    assert.equal(await statusOf(db, HELD_JV), "needs_review");
    assert.equal(await statusOf(db, HELD_PHONE), "needs_review");

    const retried = await requeueIngestions(db, { ids: [FAILED_A], formId: RENTAL }, NOW);
    assert.equal(retried, 1);
    assert.equal(await statusOf(db, FAILED_A), "pending");
    assert.equal(await statusOf(db, FAILED_B), "failed");
    assert.equal(await statusOf(db, HELD_JV), "needs_review");
    assert.equal(await statusOf(db, HELD_PHONE), "needs_review");
  });
});

describe("desk permissions", () => {
  it("lets lead staff open the desk and keeps retry with the super admin", () => {
    for (const role of ["super_admin", "inventory_manager", "lead_executive", "viewer"] as const) {
      assert.equal(can(role, "crm.view"), true);
    }
    assert.equal(can("lead_executive", "integrations.manage"), false);
    assert.equal(can("lead_executive", "integrations.view"), false);
    assert.equal(can("lead_executive", "followup.manage"), true);
    assert.equal(can("lead_executive", "contact.view_phone"), true);
    assert.equal(can("inventory_manager", "integrations.manage"), false);
    assert.equal(can("viewer", "integrations.manage"), false);
    assert.equal(can("viewer", "contact.view_phone"), false);
    assert.equal(can("viewer", "crm.edit"), false);
    assert.equal(can("super_admin", "integrations.manage"), true);
  });
});

describe("today form labels", () => {
  it("shows the Meta form on the call queue", async () => {
    const db = await setup();
    const lead = await createOwnerLead(
      db,
      actor,
      { name: "Ravi Patil", phone: "9845012345" },
      { intent: "Sale", propertyType: "House", locality: "Kotnoor", locationText: "", expectedPrice: 4500000, notes: "", priority: "Warm" },
      parseSourceInput({ channel: "meta_lead_form", metaFormId: OWNER, metaFormName: "Gulbarga Property Owner" }),
      NOW,
    );
    await createFollowup(
      db,
      actor,
      { entityType: "owner_lead", entityId: lead.id, reason: "Call the owner", dueAt: "2026-11-10T12:00:00.000Z" },
      NOW,
    );
    await createRequirement(
      db,
      actor,
      { name: "Asha K", phone: "9900011122" },
      parseRequirementInput({
        intent: "Rent",
        propertyTypes: ["House"],
        budgetMin: 10000,
        budgetMax: 15000,
        localities: ["Sedam Road"],
        timeline: "Immediate",
      }),
      parseSourceInput({ channel: "meta_lead_form", metaFormId: BUYER, metaFormName: "Gulbarga Buyer & Renter" }),
      NOW,
    );

    const queue = await todayQueue(db, { includeDiscreet: false }, new Date(NOW));
    assert.equal(queue.newOwnerLeads[0]?.formName, "Gulbarga Property Owner");
    assert.equal(queue.followups[0]?.formName, "Gulbarga Property Owner");
    assert.equal(queue.urgentRequirements[0]?.formName, "Gulbarga Buyer & Renter");
  });
});
