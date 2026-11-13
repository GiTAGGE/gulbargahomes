import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { can } from "../lib/admin/permissions";
import { createFollowup, listActivities, listFollowups, logActivity, parseActivityInput } from "../lib/crm/activity";
import { createRequirement, getRequirement, parseRequirementInput, setRequirementQuality, updateRequirement } from "../lib/crm/requirements";
import { parseSourceInput } from "../lib/crm/sources";
import {
  TIMELINE_PERMISSION,
  extendRequirementTimeline,
  listTimelineRevisions,
  listUrgencyCycles,
  loadRequirementTimeline,
  recordContactAttempt,
  reopenRequirement,
} from "../lib/crm/timeline";
import { urgencyFor } from "../lib/crm/urgency-policy";
import { prepareDatabase } from "../lib/db/prepare";
import { createTestDb } from "./helpers/sqlite";

const actor = { id: "adm_test", email: "exec@example.com", role: "lead_executive" };
const NOW = "2026-11-10T10:00:00.000Z";
const EARLIER = "2026-10-01T10:00:00.000Z";

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

function requirementInput(timeline = "Immediate") {
  const input = parseRequirementInput({
    intent: "Rent",
    propertyTypes: ["Plot"],
    localities: ["Timmapuri"],
    budgetMin: 5000,
    budgetMax: 10000,
    timeline,
    notes: "Corner preferred",
  });
  input.preferenceDetails = { profile: "Rent:Plot", plotArea: "30 × 40", intendedUse: "Commercial" };
  return input;
}

async function create(db: Awaited<ReturnType<typeof setup>>, timeline = "Immediate", at = NOW) {
  return createRequirement(
    db,
    actor,
    { name: "Veer", phone: "9900099001" },
    requirementInput(timeline),
    parseSourceInput({ channel: "website" }),
    at,
  );
}

const extension = {
  timeline: "Within 3 months",
  reason: "Financial arrangements pending",
  confirmationMethod: "phone",
  notes: "Family is arranging the deposit.",
};

describe("urgency policy", () => {
  const start = "2026-11-10T10:00:00.000Z";

  it("treats an unattended immediate requirement as critical and a passed deadline as overdue", () => {
    const open = urgencyFor({
      status: "New",
      timeline: "Immediate",
      cycleStart: start,
      targetDate: "2026-11-10T18:29:59.999Z",
      meaningfulSinceCycleStart: false,
      now: new Date(start),
    });
    assert.equal(open.band, "Critical");
    assert.equal(open.overdue, false);
    const answered = urgencyFor({ ...openArgs(start), meaningfulSinceCycleStart: true, now: new Date(start) });
    assert.equal(answered.band, "High");
    const overdue = urgencyFor({
      ...openArgs(start),
      meaningfulSinceCycleStart: true,
      now: new Date("2026-11-10T18:30:00.000Z"),
    });
    assert.equal(overdue.overdue, true);
    assert.equal(overdue.band, "Critical");
  });

  it("raises a seven-day requirement as the date approaches and when nobody has been reached", () => {
    const seven = {
      status: "New",
      timeline: "Within 7 days",
      cycleStart: start,
      targetDate: "2026-11-17T10:00:00.000Z",
      meaningfulSinceCycleStart: false,
    };
    const fresh = urgencyFor({ ...seven, now: new Date(start) });
    assert.equal(fresh.band, "Normal");
    const unattended = urgencyFor({ ...seven, now: new Date("2026-11-12T10:00:00.000Z") });
    assert.equal(unattended.band, "High");
    const reached = urgencyFor({ ...seven, meaningfulSinceCycleStart: true, now: new Date("2026-11-12T10:00:00.000Z") });
    assert.equal(reached.band, "Normal");
    const close = urgencyFor({
      status: "New",
      timeline: "Within 7 days",
      cycleStart: start,
      targetDate: "2026-11-17T10:00:00.000Z",
      meaningfulSinceCycleStart: true,
      now: new Date("2026-11-14T10:00:00.000Z"),
    });
    assert.equal(close.band, "High");
    assert.equal(close.overdue, false);
  });

  it("keeps one-month, three-month, six-month and flexible requirements calm until the deadline is near", () => {
    assert.equal(
      urgencyFor({
        status: "New",
        timeline: "Within 1 month",
        cycleStart: start,
        targetDate: "2026-12-10T10:00:00.000Z",
        meaningfulSinceCycleStart: false,
        now: new Date(start),
      }).band,
      "Normal",
    );
    assert.equal(
      urgencyFor({
        status: "New",
        timeline: "Within 30 days",
        cycleStart: start,
        targetDate: "2026-12-04T10:00:00.000Z",
        meaningfulSinceCycleStart: true,
        now: new Date("2026-12-03T10:00:00.000Z"),
      }).band,
      "High",
    );
    assert.equal(
      urgencyFor({
        status: "New",
        timeline: "Within 3 months",
        cycleStart: start,
        targetDate: "2027-02-08T10:00:00.000Z",
        meaningfulSinceCycleStart: true,
        now: new Date(start),
      }).band,
      "Low",
    );
    assert.equal(
      urgencyFor({
        status: "New",
        timeline: "Within 6 months",
        cycleStart: start,
        targetDate: "2027-05-09T10:00:00.000Z",
        meaningfulSinceCycleStart: false,
        now: new Date(start),
      }).band,
      "Low",
    );
    const flexible = urgencyFor({
      status: "New",
      timeline: "Flexible",
      cycleStart: start,
      targetDate: null,
      meaningfulSinceCycleStart: false,
      now: new Date("2027-11-10T10:00:00.000Z"),
    });
    assert.equal(flexible.band, "Low");
    assert.equal(flexible.overdue, false);
    assert.equal(
      urgencyFor({
        status: "Exploring",
        timeline: "Exploring",
        cycleStart: start,
        targetDate: null,
        meaningfulSinceCycleStart: false,
        now: new Date("2027-01-01T00:00:00.000Z"),
      }).band,
      "Low",
    );
  });

  it("stops escalation when a requirement is converted or postponed", () => {
    const passed = {
      status: "Converted",
      timeline: "Immediate",
      cycleStart: start,
      targetDate: start,
      meaningfulSinceCycleStart: false,
      now: new Date("2026-12-01T00:00:00.000Z"),
    };
    assert.deepEqual(urgencyFor(passed), { band: "Closed", overdue: false });
    assert.equal(urgencyFor({ ...passed, status: "Postponed" }).band, "Paused");
    assert.equal(urgencyFor({ ...passed, status: "Lost" }).band, "Closed");
  });
});

function openArgs(start: string) {
  return {
    status: "New",
    timeline: "Immediate",
    cycleStart: start,
    targetDate: "2026-11-10T18:29:59.999Z",
    meaningfulSinceCycleStart: false,
  };
}

describe("requirement timeline lifecycle", () => {
  it("opens an urgency cycle for every new requirement and leaves the original enquiry untouched", async () => {
    const db = await setup();
    const created = await create(db);
    const cycles = await listUrgencyCycles(db, created.id);
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0].closedAt, null);
    assert.equal(cycles[0].timeline, "Immediate");
    assert.equal((await listTimelineRevisions(db, created.id)).length, 0);
    const view = await loadRequirementTimeline(db, created, new Date(NOW));
    assert.equal(view.extensionCount, 0);
    assert.equal(view.originalTimeline, "Immediate");
    assert.equal(view.currentTimeline, "Immediate");
    assert.equal(view.enquiryAgeDays, 0);
    assert.equal(view.current.band, "Critical");
    assert.equal(view.current.overdue, false);
    const audit = await listAudit(db, { entityType: "requirement", entityId: created.id });
    assert.equal(audit.find((entry) => entry.action === "create")?.context.cycle_id, cycles[0].id);
  });

  it("calculates a legacy requirement without writing a cycle, then keeps that period when it is extended", async () => {
    const db = await setup();
    await db
      .prepare(
        `INSERT INTO contacts (id, code, name, phone_e164, created_at, created_by, updated_at, updated_by)
         VALUES ('con_old', 'GH-C0098', 'Old Enquiry', '+919900000098', ?1, 'a', ?1, 'a')`,
      )
      .bind(EARLIER)
      .run();
    await db
      .prepare(
        `INSERT INTO demand_requirements (
           id, code, contact_id, intent, property_types_json, localities_json, locality_flexible,
           budget_min, budget_max, timeline, notes, preference_details_json, area_min,
           created_at, created_by, updated_at, updated_by
         ) VALUES (
           'req_old', 'GH-D0098', 'con_old', 'Rent', '["Plot"]', '["Timmapuri"]', 1,
           5000, 10000, 'Within 7 days', 'Corner preferred', '{"profile":"Rent:Plot","plotArea":"30x40"}', NULL,
           ?1, 'a', ?1, 'a'
         )`,
      )
      .bind(EARLIER)
      .run();

    const legacy = (await getRequirement(db, "req_old", new Date(NOW)))!;
    assert.equal((await listUrgencyCycles(db, legacy.id)).length, 0);
    const before = await loadRequirementTimeline(db, legacy, new Date(NOW));
    assert.equal(before.current.source, "original enquiry");
    assert.equal(before.originalTimeline, "Within 7 days");
    assert.equal(before.enquiryAgeDays, 40);
    assert.equal(before.current.overdue, true);
    assert.equal(before.extensionCount, 0);

    await extendRequirementTimeline(db, actor, legacy, extension, { now: NOW, expectedVersion: legacy.rowVersion });
    const extended = (await getRequirement(db, legacy.id, new Date(NOW)))!;
    assert.equal(extended.createdAt, EARLIER);
    assert.equal(extended.timeline, "Within 7 days");
    assert.equal(extended.neededBy, null);
    assert.equal(extended.confirmedTimeline, "Within 3 months");
    assert.equal(extended.areaMin, null);
    assert.equal(extended.preferenceDetails.plotArea, "30x40");
    assert.equal(extended.notes, "Corner preferred");
    const cycles = await listUrgencyCycles(db, legacy.id);
    assert.equal(cycles.length, 2);
    assert.equal(cycles[0].cycleStart, EARLIER);
    assert.equal(cycles[0].closureReason, "Client extension");
    assert.equal(cycles[0].overdue, true);
    assert.ok(cycles[0].closedAt);
    assert.equal(cycles[1].closedAt, null);
    assert.equal(cycles[1].timeline, "Within 3 months");
    const view = await loadRequirementTimeline(db, extended, new Date(NOW));
    assert.equal(view.extensionCount, 1);
    assert.equal(view.enquiryAgeDays, 40);
    assert.equal(view.current.band, "Low");
    assert.equal(view.current.overdue, false);
    assert.equal(view.revisions[0].previousTimeline, "Within 7 days");
    assert.equal(view.revisions[0].newTimeline, "Within 3 months");
  });

  it("keeps every extension, attempt, follow-up and overdue cycle, and does not restart as critical", async () => {
    const db = await setup();
    const created = await create(db, "Immediate", EARLIER);
    const followup = await createFollowup(
      db,
      actor,
      { entityType: "requirement", entityId: created.id, contactId: created.contactId, reason: "Call back", dueAt: "2026-10-02T05:00:00.000Z" },
      EARLIER,
    );
    await recordContactAttempt(db, actor, created, { kind: "call", outcome: "no_answer", notes: "Rang once" }, EARLIER);
    await recordContactAttempt(db, actor, created, { kind: "whatsapp", outcome: "sent" }, EARLIER);

    const first = (await getRequirement(db, created.id, new Date(NOW)))!;
    assert.equal(first.engagementCount, 0);
    assert.equal(first.attemptCount, 2);
    assert.equal(first.lastMeaningfulAt, null);
    assert.equal((await loadRequirementTimeline(db, first, new Date(NOW))).current.overdue, true);

    await extendRequirementTimeline(db, actor, first, extension, { now: NOW, expectedVersion: first.rowVersion });
    const once = (await getRequirement(db, created.id, new Date(NOW)))!;
    assert.equal(once.timeline, "Immediate");
    assert.equal(once.createdAt, EARLIER);
    assert.equal(once.confirmedTimeline, "Within 3 months");
    assert.equal(once.preferenceDetails.plotArea, "30 × 40");
    assert.equal((await loadRequirementTimeline(db, once, new Date(NOW))).current.band, "Low");
    assert.equal((await listFollowups(db, { entityType: "requirement", entityId: created.id }))[0].id, followup.id);

    const secondAt = "2026-11-20T10:00:00.000Z";
    await extendRequirementTimeline(
      db,
      actor,
      once,
      { timeline: "Within 6 months", reason: "Family decision pending", confirmationMethod: "whatsapp", notes: "They asked for June." },
      { now: secondAt, expectedVersion: once.rowVersion },
    );
    const twice = (await getRequirement(db, created.id, new Date(secondAt)))!;
    await recordContactAttempt(db, actor, twice, { kind: "whatsapp", outcome: "sent", notes: "Reminder only" }, secondAt);
    const afterAttempt = (await getRequirement(db, created.id, new Date(secondAt)))!;
    assert.equal(afterAttempt.confirmedTimeline, "Within 6 months");
    assert.equal((await listTimelineRevisions(db, created.id)).length, 2);
    assert.equal(afterAttempt.lastMeaningfulAt, secondAt);

    const thirdAt = "2026-12-01T10:00:00.000Z";
    await extendRequirementTimeline(
      db,
      actor,
      afterAttempt,
      { timeline: "Flexible", reason: "Other", confirmationMethod: "in_person", notes: "No date until the family meets." },
      { now: thirdAt, expectedVersion: afterAttempt.rowVersion },
    );
    const thrice = (await getRequirement(db, created.id, new Date(thirdAt)))!;
    const revisions = await listTimelineRevisions(db, created.id);
    const cycles = await listUrgencyCycles(db, created.id);
    assert.equal(revisions.length, 3);
    assert.equal(cycles.length, 4);
    assert.equal(cycles.filter((cycle) => cycle.closureReason === "Client extension").length, 3);
    assert.equal(cycles.filter((cycle) => !cycle.closedAt).length, 1);
    assert.equal(cycles[0].overdue, true);
    assert.equal(thrice.createdAt, EARLIER);
    assert.equal(thrice.timeline, "Immediate");
    assert.equal(thrice.confirmedTimeline, "Flexible");
    const view = await loadRequirementTimeline(db, thrice, new Date(thirdAt));
    assert.equal(view.extensionCount, 3);
    assert.equal(view.enquiryAgeDays, 61);
    assert.equal(view.current.band, "Low");
    assert.equal(view.current.overdue, false);
    assert.equal(view.attemptCount, 3);
    assert.equal((await listActivities(db, { entityType: "requirement", entityId: created.id })).length, 6);
    assert.equal((await listFollowups(db, { entityType: "requirement", entityId: created.id }))[0].reason, "Call back");
    const audits = await listAudit(db, { entityType: "requirement", entityId: created.id });
    assert.equal(audits.filter((entry) => entry.action === "timeline_extend").length, 3);
    await assert.rejects(db.prepare("UPDATE requirement_timeline_revisions SET notes = 'changed'").run(), /append-only/);
    await assert.rejects(db.prepare("DELETE FROM requirement_urgency_cycles").run(), /cannot be deleted/);
  });

  it("does not treat a contact attempt as an extension or as meaningful engagement", async () => {
    const db = await setup();
    const created = await create(db, "Within 7 days");
    await assert.rejects(
      recordContactAttempt(db, actor, created, { kind: "call", outcome: "connected" }, NOW),
      /unanswered call/,
    );
    await recordContactAttempt(db, actor, created, { kind: "call", outcome: "no_answer" }, NOW);
    await recordContactAttempt(db, actor, created, { kind: "whatsapp", outcome: "sent" }, NOW);
    const after = (await getRequirement(db, created.id, new Date(NOW)))!;
    assert.equal(after.status, "New");
    assert.equal(after.confirmedTimeline, "");
    assert.equal(after.engagementCount, 0);
    assert.equal(after.attemptCount, 2);
    assert.equal(after.lastMeaningfulAt, null);
    assert.equal(after.lastContactedAt, null);
    assert.equal((await listTimelineRevisions(db, created.id)).length, 0);
    assert.equal((await listUrgencyCycles(db, created.id)).length, 1);
    assert.equal((await listUrgencyCycles(db, created.id))[0].closedAt, null);
    assert.equal(after.intentScore.factors.find((factor) => factor.label === "Engagement")?.points, 0);
  });

  it("reopens a lost requirement on the same record and refuses a converted one", async () => {
    const db = await setup();
    const created = await create(db, "Within 7 days");
    await logActivity(
      db,
      actor,
      parseActivityInput({ entityType: "requirement", entityId: created.id, contactId: created.contactId, kind: "call", outcome: "connected" }),
      NOW,
    );
    const contacted = (await getRequirement(db, created.id, new Date(NOW)))!;
    const lost = await updateRequirement(
      db,
      actor,
      contacted,
      { status: "Lost", outcome: "Paused the search" },
      { now: "2026-11-12T10:00:00.000Z", expectedVersion: contacted.rowVersion },
    );
    assert.equal(lost.status, "Lost");
    assert.equal((await loadRequirementTimeline(db, lost, new Date("2026-11-12T10:00:00.000Z"))).current.band, "Closed");
    const stored = await listUrgencyCycles(db, created.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].closureReason, "Requirement lost");
    await assert.rejects(
      updateRequirement(db, actor, lost, { status: "Contacted" }, { now: NOW, expectedVersion: lost.rowVersion }),
      /Reopen/,
    );

    const returnAt = "2026-12-01T10:00:00.000Z";
    await reopenRequirement(
      db,
      actor,
      lost,
      { timeline: "Within 1 month", confirmationMethod: "phone", notes: "They are looking again in December." },
      { now: returnAt, expectedVersion: lost.rowVersion },
    );
    const reopened = (await getRequirement(db, created.id, new Date(returnAt)))!;
    assert.equal(reopened.status, "Contacted");
    assert.equal(reopened.closedAt, null);
    assert.equal(reopened.createdAt, NOW);
    assert.equal(reopened.timeline, "Within 7 days");
    assert.equal(reopened.confirmedTimeline, "Within 1 month");
    assert.equal(reopened.outcome, "Paused the search");
    const cycles = await listUrgencyCycles(db, created.id);
    assert.equal(cycles.length, 2);
    assert.equal(cycles[0].closureReason, "Requirement lost");
    assert.equal(cycles[1].closedAt, null);
    assert.equal((await listActivities(db, { entityType: "requirement", entityId: created.id })).length, 2);
    const view = await loadRequirementTimeline(db, reopened, new Date(returnAt));
    assert.equal(view.current.band, "Normal");
    assert.equal(view.current.overdue, false);
    assert.equal(view.revisions[0].kind, "reopen");
    const audits = (await listAudit(db, { entityType: "requirement", entityId: created.id })).map((entry) => entry.action);
    assert.ok(audits.includes("reopen"));
    assert.ok(audits.includes("urgency_cycle_close"));

    const genuine = await setRequirementQuality(db, actor, reopened, "genuine", "Confirmed they still want the plot.", {
      now: returnAt,
      expectedVersion: reopened.rowVersion,
    });
    const lostAgain = await updateRequirement(
      db,
      actor,
      genuine,
      { status: "Lost", outcome: "Not this month" },
      { now: "2026-12-02T10:00:00.000Z", expectedVersion: genuine.rowVersion },
    );
    await reopenRequirement(
      db,
      actor,
      lostAgain,
      { timeline: "Within 7 days", confirmationMethod: "in_person", notes: "Back and ready to visit." },
      { now: "2026-12-03T10:00:00.000Z", expectedVersion: lostAgain.rowVersion },
    );
    assert.equal((await getRequirement(db, created.id))?.status, "Verified");

    const other = await createRequirement(
      db,
      actor,
      { name: "Buyer Two", phone: "9900099002" },
      parseRequirementInput({ intent: "Buy", propertyTypes: ["House"], localities: ["Sedam Road"], budgetMax: 5000000, timeline: "Exploring" }),
      parseSourceInput({}),
      NOW,
    );
    const reviewed = await setRequirementQuality(db, actor, other, "genuine", "Ready to buy.", { now: NOW, expectedVersion: other.rowVersion });
    const converted = await updateRequirement(
      db,
      actor,
      reviewed,
      { status: "Converted", outcome: "Agreed GH-P0001" },
      { now: NOW, expectedVersion: reviewed.rowVersion },
    );
    assert.equal((await loadRequirementTimeline(db, converted, new Date("2027-01-01T00:00:00.000Z"))).current.band, "Closed");
    await assert.rejects(
      reopenRequirement(db, actor, converted, { timeline: "Immediate", confirmationMethod: "phone", notes: "They called again." }, { now: NOW }),
      /stays closed/,
    );
    assert.equal((await getRequirement(db, converted.id))?.status, "Converted");
    await assert.rejects(
      extendRequirementTimeline(db, actor, converted, extension, { now: NOW, expectedVersion: converted.rowVersion }),
      /stays closed/,
    );
  });

  it("lets a lead executive extend and record attempts, and keeps both out of a viewer's role", () => {
    assert.equal(can("lead_executive", TIMELINE_PERMISSION.extend), true);
    assert.equal(can("lead_executive", TIMELINE_PERMISSION.reopen), true);
    assert.equal(can("lead_executive", TIMELINE_PERMISSION.attempt), true);
    assert.equal(can("inventory_manager", TIMELINE_PERMISSION.extend), true);
    assert.equal(can("super_admin", TIMELINE_PERMISSION.reopen), true);
    assert.equal(can("viewer", TIMELINE_PERMISSION.extend), false);
    assert.equal(can("viewer", TIMELINE_PERMISSION.reopen), false);
    assert.equal(can("viewer", TIMELINE_PERMISSION.attempt), false);
  });
});
