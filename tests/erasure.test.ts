import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFollowup, logActivity, parseActivityInput } from "../lib/crm/activity";
import { findContactByPhone, getContact, listContacts } from "../lib/crm/contacts";
import { erasureStatements, retentionReviewSql } from "../lib/crm/erasure";
import { createOwnerLead, getOwnerLead } from "../lib/crm/owner-leads";
import { formatPhone, maskPhone } from "../lib/crm/phone";
import { createRequirement, getRequirement, parseRequirementInput } from "../lib/crm/requirements";
import { parseSourceInput } from "../lib/crm/sources";
import { prepareDatabase } from "../lib/db/prepare";
import { createTestDb } from "./helpers/sqlite";

const actor = { id: "adm_test", email: "exec@example.com", role: "lead_executive" };
const NOW = "2026-11-10T10:00:00.000Z";
const person = { name: "Shanta Kulkarni", phone: "98450 77777" };
const other = { name: "Ravi Patil", phone: "98450 12345" };

function tableDump(db: ReturnType<typeof createTestDb>, except: string[]): string {
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String((row as { name: string }).name))
    .filter((name) => !except.includes(name));
  return tables.map((name) => JSON.stringify(db.raw.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
}

async function seed() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  const lead = await createOwnerLead(
    db,
    actor,
    person,
    { intent: "Rent", propertyType: "House", locality: "Sedam Road", locationText: "Plot 12 behind the temple", expectedPrice: 14000, notes: "Wife Shanta answers", priority: "Warm" },
    { ...parseSourceInput({ channel: "meta_lead_form", metaLeadId: "lead-erase" }), rawPayload: { full_name: person.name, phone_number: "9845077777" } },
    NOW,
  );
  const requirement = await createRequirement(
    db,
    actor,
    person,
    parseRequirementInput({ intent: "Buy", budgetMax: 4000000, notes: "Call Shanta after 6" }),
    parseSourceInput({ channel: "manual" }),
    NOW,
  );
  await logActivity(
    db,
    actor,
    parseActivityInput({ entityType: "owner_lead", entityId: lead.id, contactId: lead.contactId, kind: "note", body: "Shanta Kulkarni prefers Kannada" }),
    NOW,
  );
  await createFollowup(db, actor, { entityType: "requirement", entityId: requirement.id, reason: "Call Shanta", dueAt: "2026-11-12T05:00:00.000Z" }, NOW);
  db.raw
    .prepare(
      `INSERT INTO meta_lead_ingestions (id, leadgen_id, origin, status, next_attempt_at, payload_json, last_error, received_at, updated_at)
       VALUES ('ing_held', 'lead-held', 'webhook', 'needs_review', ?1, ?2, 'Shanta: bad budget', ?1, ?1)`,
    )
    .run(NOW, JSON.stringify({ field_data: [{ name: "phone_number", values: ["9845077777"] }] }));
  db.raw
    .prepare(`INSERT INTO meta_ingestion_events (id, ingestion_id, occurred_at, step, outcome, message) VALUES ('evt_1', 'ing_held', ?1, 'validate', 'needs_review', 'Shanta')`)
    .run(NOW);
  const bystander = await createOwnerLead(
    db,
    actor,
    other,
    { intent: "Sell", propertyType: "Plot", locality: "Aland Road", locationText: "", expectedPrice: null, notes: "Ravi note", priority: "Warm" },
    parseSourceInput({ channel: "manual" }),
    NOW,
  );
  return { db, lead, requirement, bystander };
}

async function erase(db: ReturnType<typeof createTestDb>, code: string) {
  await db.batch(erasureStatements(code, "owner@example.com", "2026-11-11T09:00:00.000Z").map((sql) => db.prepare(sql)));
}

describe("manual erasure SQL", () => {
  it("removes the person's name, number and free text everywhere except the append-only audit history", async () => {
    const { db, lead, requirement, bystander } = await seed();
    const contact = (await getContact(db, lead.contactId))!;
    await erase(db, contact.code);

    const dump = tableDump(db, ["audit_log"]);
    for (const needle of ["Shanta", "Kulkarni", "9845077777", "behind the temple"]) {
      assert.equal(dump.includes(needle), false, `${needle} is still stored`);
    }

    const erased = (await getContact(db, lead.contactId))!;
    assert.equal(erased.name, "Erased contact");
    assert.equal(erased.doNotContact, true);
    assert.equal(formatPhone(erased.phone), "Erased");
    assert.equal(maskPhone(erased.phone), "Erased");
    assert.equal(await findContactByPhone(db, "9845077777"), null);
    assert.equal((await getOwnerLead(db, lead.id))?.status, "Not interested");
    assert.equal((await getRequirement(db, requirement.id))?.status, "Lost");
    assert.equal((await getRequirement(db, requirement.id))?.nextFollowupAt, null);
    const source = db.raw.prepare("SELECT meta_lead_id FROM lead_sources WHERE meta_lead_id = 'lead-erase'").get();
    assert.ok(source, "the Meta lead id stays so the form is not imported again");

    const after = (await getOwnerLead(db, bystander.id))!;
    assert.equal(after.notes, "Ravi note");
    assert.equal((await listContacts(db)).some((item) => item.name === "Ravi Patil"), true);

    const audit = db.raw.prepare("SELECT action, actor_email FROM audit_log WHERE action = 'erase'").all().map((row) => ({ ...row }));
    assert.deepEqual(audit, [{ action: "erase", actor_email: "owner@example.com" }]);
  });

  it("refuses anything that is not a contact code or has no super admin email", () => {
    assert.throws(() => erasureStatements("GH-C0001'; DROP TABLE contacts; --", "owner@example.com", NOW));
    assert.throws(() => erasureStatements("GH-C0001", "", NOW));
    assert.throws(() => erasureStatements("GH-C0001", "x' OR 1=1", NOW));
  });

  it("lists contacts untouched for 12 months for review and never lists erased ones", async () => {
    const { db, lead } = await seed();
    const review = () => db.raw.prepare(retentionReviewSql("2026-11-11T00:00:00.000Z")).all().map((row) => (row as { code: string }).code);
    assert.deepEqual(review(), [], "everything was touched the day before");

    db.raw.exec("UPDATE contacts SET updated_at = '2024-01-01T00:00:00.000Z'");
    db.raw.exec("UPDATE owner_leads SET updated_at = '2024-01-01T00:00:00.000Z'");
    db.raw.exec("UPDATE demand_requirements SET updated_at = '2024-01-01T00:00:00.000Z'");
    db.raw.exec("UPDATE activities SET occurred_at = '2024-01-01T00:00:00.000Z'");
    db.raw.exec("UPDATE followups SET created_at = '2024-01-01T00:00:00.000Z'");
    const code = (await getContact(db, lead.contactId))!.code;
    assert.ok(review().includes(code));

    await erase(db, code);
    assert.equal(review().includes(code), false);
  });
});
