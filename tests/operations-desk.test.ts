import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listMatchDecisions } from "../lib/admin/audit";
import { can, type Role } from "../lib/admin/permissions";
import { logActivity } from "../lib/crm/activity";
import {
  decideRequirementMatch,
  listRequirementMatches,
  type StoredMatch,
} from "../lib/crm/matching";
import {
  DESK_LAYOUT,
  DESK_QUEUES,
  emptyDeskMessage,
  operationsDesk,
  paginateDesk,
  type DeskAccess,
  type DeskReason,
  type DeskRow,
} from "../lib/crm/operations-desk";
import { maskPhone } from "../lib/crm/phone";
import {
  createRequirement,
  getRequirement,
  parseRequirementInput,
  setRequirementQuality,
  updateRequirement,
  type Requirement,
} from "../lib/crm/requirements";
import { parseSourceInput } from "../lib/crm/sources";
import { extendRequirementTimeline, recordContactAttempt, reopenRequirement } from "../lib/crm/timeline";
import { prepareDatabase } from "../lib/db/prepare";
import { asListing } from "../lib/db/property-rows";
import {
  applyPropertyLifecycle,
  createDraftProperty,
  readPlotDimensions,
  savePlotDimensions,
  updatePropertyContent,
} from "../lib/inventory/repository";
import { emptyProperty } from "../lib/property-input";
import type { Property } from "../lib/types";
import { createTestDb } from "./helpers/sqlite";

const NOW = "2026-11-14T00:00:00.000Z";
const LATER = "2026-11-15T00:00:00.000Z";
const EARLY = "2026-01-01T00:00:00.000Z";
const manager: { id: string; email: string; role: Role } = { id: "adm_mgr", email: "manager@example.com", role: "inventory_manager" };
const executive: { id: string; email: string; role: Role } = { id: "adm_exec", email: "exec@example.com", role: "lead_executive" };
const viewer: { id: string; email: string; role: Role } = { id: "adm_view", email: "view@example.com", role: "viewer" };
const staff: DeskAccess = { viewPhone: true, viewDiscreet: true, viewMatches: true };
const executiveAccess: DeskAccess = { viewPhone: true, viewDiscreet: false, viewMatches: true };
const viewerAccess: DeskAccess = { viewPhone: false, viewDiscreet: false, viewMatches: true };

let phones = 9810000000;

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

function requirementInput(overrides: Record<string, unknown> = {}) {
  return parseRequirementInput({
    intent: "Rent",
    propertyTypes: ["House"],
    localities: ["Sai Nagar"],
    localityFlexible: false,
    areaMin: 1000,
    budgetMax: 100000,
    timeline: "Exploring",
    ...overrides,
  });
}

function draft(slug: string, overrides: Partial<Property> = {}): Property {
  return {
    ...emptyProperty(NOW),
    slug,
    title: slug,
    locality: "Sai Nagar",
    price: 100000,
    priceSuffix: "/month",
    area: 1200,
    listing: "Rent",
    propertyType: "House",
    ...overrides,
  };
}

async function create(
  db: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {},
  at = NOW,
) {
  phones += 1;
  return createRequirement(
    db,
    executive,
    { name: "Seeker", phone: String(phones) },
    requirementInput(overrides),
    parseSourceInput({ channel: "manual" }),
    at,
  );
}

async function live(db: Awaited<ReturnType<typeof setup>>, slug: string, overrides: Partial<Property> = {}) {
  let property = await createDraftProperty(db, manager, draft(slug, overrides), { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "verify" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "publish" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "confirm_availability" }, { now: NOW });
  return property;
}

async function discreet(db: Awaited<ReturnType<typeof setup>>, slug: string) {
  let property = await createDraftProperty(db, manager, draft(slug), { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "verify" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "confirm_availability" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "set_discreet", enabled: true }, { now: NOW });
  return property;
}

async function genuine(db: Awaited<ReturnType<typeof setup>>, requirement: Requirement) {
  return setRequirementQuality(db, executive, requirement, "genuine", "Confirmed with the client", {
    now: NOW,
    expectedVersion: requirement.rowVersion,
  });
}

async function markContacted(db: Awaited<ReturnType<typeof setup>>, requirement: Requirement) {
  return updateRequirement(db, executive, requirement, { status: "Contacted" }, { now: NOW, expectedVersion: requirement.rowVersion });
}

async function desk(db: Awaited<ReturnType<typeof setup>>, access: DeskAccess = staff, now = NOW) {
  return operationsDesk(db, access, { now: new Date(now) });
}

function row(rows: DeskRow[], id: string) {
  const found = rows.filter((item) => item.id === id);
  assert.equal(found.length, 1);
  return found[0];
}

function has(item: DeskRow, reason: DeskReason) {
  assert.equal(item.reasons.includes(reason), true, item.reasons.join(","));
}

describe("match decisions", () => {
  it("enforces permission, requires a rejection reason, and keeps every decision in the audit", async () => {
    const db = await setup();
    const property = await live(db, "lane-house");
    const requirement = await genuine(db, await create(db));
    const matches = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    const match = matches.find((item) => item.propertyId === property.id);
    assert.ok(match);

    assert.equal(can(viewer.role, "match.manage"), false);
    assert.equal(can(executive.role, "match.manage"), true);
    assert.equal(can(viewer.role, "contact.view_phone"), false);
    assert.equal(can(executive.role, "property.view_discreet"), false);
    await assert.rejects(decideRequirementMatch(db, viewer, requirement.id, match.id, "Shortlisted", "", NOW), /cannot decide/);
    await assert.rejects(decideRequirementMatch(db, executive, requirement.id, match.id, "Rejected", "", NOW), /rejected/);
    await assert.rejects(decideRequirementMatch(db, executive, requirement.id, match.id, "Rejected", "N", NOW), /rejected/);

    const shortlisted = await decideRequirementMatch(db, executive, requirement.id, match.id, "Shortlisted", "", NOW);
    assert.equal(shortlisted.status, "Shortlisted");
    assert.equal(shortlisted.eligible, true);
    assert.equal(shortlisted.decisionReason, "");

    const rejected = await decideRequirementMatch(db, executive, requirement.id, match.id, "Rejected", "Too far inside the lane", NOW);
    assert.equal(rejected.status, "Rejected");
    const history = await listMatchDecisions(db, requirement.id);
    assert.equal(history.length, 2);
    assert.deepEqual(
      history.map((entry) => entry.actorId),
      [executive.id, executive.id],
    );
    assert.equal(history[0].occurredAt, NOW);
    assert.equal(history[0].action, "match_decision");
    const notes = history.map((entry) => JSON.stringify(entry.changes));
    assert.match(notes.join("\n"), /Too far inside the lane/);
    assert.match(notes.join("\n"), /Shortlisted/);

    const lost = await updateRequirement(
      db,
      executive,
      await getRequirement(db, requirement.id, new Date(NOW)) as Requirement,
      { status: "Lost", outcome: "Client bought elsewhere" },
      { now: NOW },
    );
    await assert.rejects(
      decideRequirementMatch(db, executive, lost.id, match.id, "Converted", "", NOW),
      /Reopen this requirement/,
    );
  });

  it("hides discreet property data from roles without property.view_discreet", async () => {
    const db = await setup();
    const hidden = await discreet(db, "quiet-house");
    const requirement = await markContacted(db, await genuine(db, await create(db)));
    const visible = await listRequirementMatches(db, requirement.id, { viewDiscreet: false });
    const privileged = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    assert.equal(visible.length, 0);
    assert.equal(JSON.stringify(visible).includes(hidden.title), false);
    assert.equal(JSON.stringify(visible).includes(hidden.id), false);
    assert.equal(privileged.some((item) => item.propertyId === hidden.id), true);
    await assert.rejects(
      decideRequirementMatch(db, executive, requirement.id, privileged[0].id, "Shortlisted", "", NOW),
      /not found/,
    );

    const executiveDesk = await desk(db, executiveAccess);
    const managerDesk = await desk(db, staff);
    assert.equal(JSON.stringify(executiveDesk).includes(hidden.title), false);
    assert.equal(JSON.stringify(executiveDesk).includes(hidden.id), false);
    assert.equal(JSON.stringify(managerDesk).includes(hidden.title), false);
    assert.equal(executiveDesk.rows.some((item) => item.reasons.includes("no_match")), false);
    assert.equal(managerDesk.rows.some((item) => item.reasons.includes("no_match")), false);
  });

  it("keeps a staff decision when the property is no longer eligible", async () => {
    const db = await setup();
    let property = await live(db, "visit-house");
    const requirement = await create(db);
    const match = (await listRequirementMatches(db, requirement.id, { viewDiscreet: true })).find(
      (item) => item.propertyId === property.id,
    ) as StoredMatch;
    await decideRequirementMatch(db, executive, requirement.id, match.id, "Visited", "Saw the house", NOW);
    property = await applyPropertyLifecycle(db, manager, property, { type: "set_availability", status: "Rented" }, { now: NOW });
    const after = (await listRequirementMatches(db, requirement.id, { viewDiscreet: true })).find((item) => item.id === match.id);
    assert.ok(after);
    assert.equal(after.status, "Visited");
    assert.equal(after.eligible, false);
    assert.equal(property.status, "Rented");
  });
});

describe("operations desk", () => {
  it("queues each urgency and follow-up condition once, with its reason", async () => {
    const db = await setup();
    await live(db, "sai-house");

    const critical = await markContacted(db, await genuine(db, await create(db, { timeline: "Immediate" }, EARLY)));
    const high = await markContacted(
      db,
      await genuine(db, await create(db, { timeline: "Within 7 days", neededBy: "2026-11-16" })),
    );
    const first = await genuine(db, await create(db));
    const review = await markContacted(db, await create(db));
    const extendedSource = await genuine(db, await create(db));
    await extendRequirementTimeline(
      db,
      executive,
      extendedSource,
      { timeline: "Within 3 months", reason: "Financial arrangements pending", confirmationMethod: "whatsapp", notes: "Family is arranging funds." },
      { now: NOW, expectedVersion: extendedSource.rowVersion },
    );
    const reopenedSource = await updateRequirement(
      db,
      executive,
      await genuine(db, await create(db)),
      { status: "Lost", outcome: "Paused the search" },
      { now: NOW },
    );
    await reopenRequirement(
      db,
      executive,
      reopenedSource,
      { timeline: "Within 3 months", confirmationMethod: "whatsapp", notes: "They are looking again" },
      { now: NOW, expectedVersion: reopenedSource.rowVersion },
    );
    const retry = await genuine(db, await create(db));
    await recordContactAttempt(db, executive, retry, { kind: "call", outcome: "no_answer", notes: "Rang out" }, NOW);
    const sent = await genuine(db, await create(db));
    await recordContactAttempt(db, executive, sent, { kind: "whatsapp", outcome: "sent", notes: "Staff sent a message" }, NOW);

    const page = await desk(db);
    const criticalRow = row(page.rows, critical.id);
    has(criticalRow, "critical");
    has(criticalRow, "overdue");
    assert.equal(criticalRow.customerEngaged, false);

    const highRow = row(page.rows, high.id);
    has(highRow, "high");
    assert.equal(highRow.reasons.includes("critical"), false);
    assert.equal(highRow.overdue, false);

    const firstRow = row(page.rows, first.id);
    has(firstRow, "first_contact");
    assert.equal(firstRow.lastMeaningfulAt, null);

    has(row(page.rows, review.id), "review");
    const extended = row(page.rows, extendedSource.id);
    has(extended, "extended");
    assert.equal(extended.customerEngaged, false);
    assert.equal(extended.lastMeaningfulAt, null);
    assert.doesNotMatch(extended.nextAction, /replied|customer reply/i);

    const reopened = row(page.rows, reopenedSource.id);
    has(reopened, "reopened");
    assert.equal(reopened.customerEngaged, false);

    const missed = row(page.rows, retry.id);
    has(missed, "reattempt");
    assert.equal(missed.customerEngaged, false);
    assert.equal(missed.reasons.includes("first_contact"), false);
    assert.match(missed.nextAction, /did not reach/);

    const handoff = row(page.rows, sent.id);
    has(handoff, "reattempt");
    assert.equal(handoff.customerEngaged, false);
    assert.equal(page.rows.filter((item) => item.id === sent.id).length, 1);
  });

  it("does not treat an unanswered call or a staff WhatsApp confirmation as a customer reply", async () => {
    const db = await setup();
    await live(db, "reply-house");
    const called = await genuine(db, await create(db, { timeline: "Immediate" }));
    await recordContactAttempt(db, executive, called, { kind: "call", outcome: "no_answer" }, NOW);
    const confirmed = await genuine(db, await create(db, { timeline: "Immediate" }));
    await extendRequirementTimeline(
      db,
      executive,
      confirmed,
      { timeline: "Within 1 month", reason: "Client needs more time", confirmationMethod: "whatsapp", notes: "Asked for a month." },
      { now: NOW, expectedVersion: confirmed.rowVersion },
    );
    const page = await desk(db);
    const missed = row(page.rows, called.id);
    assert.equal(missed.customerEngaged, false);
    has(missed, "reattempt");
    const staffNote = row(page.rows, confirmed.id);
    assert.equal(staffNote.customerEngaged, false);
    has(staffNote, "extended");
    assert.equal(staffNote.reasons.includes("reattempt"), false);
  });

  it("leaves closed requirements out, including postponed, until an explicit reopen", async () => {
    const db = await setup();
    await live(db, "closed-house");
    const lost = await updateRequirement(
      db,
      executive,
      await create(db, { timeline: "Immediate" }),
      { status: "Lost", outcome: "Not proceeding" },
      { now: NOW },
    );
    const converted = await updateRequirement(
      db,
      executive,
      await genuine(db, await create(db, { timeline: "Immediate" })),
      { status: "Converted", outcome: "Took the Sai Nagar house" },
      { now: NOW },
    );
    const duplicate = await updateRequirement(
      db,
      executive,
      await create(db, { timeline: "Immediate" }),
      { status: "Duplicate" },
      { now: NOW },
    );
    const invalid = await updateRequirement(
      db,
      executive,
      await create(db, { timeline: "Immediate" }),
      { status: "Invalid" },
      { now: NOW },
    );
    const postponed = await updateRequirement(
      db,
      executive,
      await create(db, { timeline: "Immediate" }),
      { status: "Postponed" },
      { now: NOW },
    );
    const before = await desk(db, staff, LATER);
    for (const requirement of [lost, converted, duplicate, invalid, postponed]) {
      assert.equal(before.rows.some((item) => item.id === requirement.id), false);
    }
    await reopenRequirement(
      db,
      executive,
      postponed,
      { timeline: "Within 3 months", confirmationMethod: "phone", notes: "They asked to start again" },
      { now: LATER, expectedVersion: postponed.rowVersion },
    );
    const after = await desk(db, staff, LATER);
    has(row(after.rows, postponed.id), "reopened");
  });

  it("groups several reasons onto one requirement and ignores a high intent score on its own", async () => {
    const db = await setup();
    await live(db, "grouped-house");
    const busy = await create(db, { timeline: "Immediate" });
    await recordContactAttempt(db, executive, busy, { kind: "call", outcome: "busy" }, NOW);
    const talked = await genuine(db, await create(db));
    await logActivity(
      db,
      executive,
      {
        entityType: "requirement",
        entityId: talked.id,
        contactId: talked.contactId,
        kind: "call",
        direction: "outbound",
        outcome: "connected",
        body: "Talked through the house",
        durationSeconds: 60,
        occurredAt: NOW,
        channel: "manual",
        externalId: null,
      },
      NOW,
    );
    const quiet = await updateRequirement(
      db,
      executive,
      (await getRequirement(db, talked.id, new Date(NOW))) as Requirement,
      { priorityOverride: "High" },
      { now: NOW },
    );
    const unmatched = await markContacted(db, await genuine(db, await create(db, { propertyTypes: ["Plot"], localities: ["Timmapuri"] })));
    const page = await desk(db);
    const grouped = row(page.rows, busy.id);
    has(grouped, "critical");
    has(grouped, "review");
    has(grouped, "reattempt");
    assert.equal(page.rows.filter((item) => item.id === busy.id).length, 1);

    assert.equal(quiet.priorityOverride, "High");
    assert.equal(quiet.intentScore.band, "High");
    assert.equal(page.rows.some((item) => item.id === quiet.id), false);

    const none = row(page.rows, unmatched.id);
    has(none, "no_match");
    assert.equal(none.reasons.includes("shortlisted"), false);
  });

  it("follows shortlisted and shared matches without sending anything", async () => {
    const db = await setup();
    const first = await live(db, "short-house");
    const second = await live(db, "shared-house", { price: 90000 });
    const requirement = await markContacted(db, await genuine(db, await create(db)));
    const matches = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    const short = matches.find((item) => item.propertyId === first.id) as StoredMatch;
    const shared = matches.find((item) => item.propertyId === second.id) as StoredMatch;
    await decideRequirementMatch(db, executive, requirement.id, short.id, "Shortlisted", "", NOW);
    await decideRequirementMatch(db, executive, requirement.id, shared.id, "Shared", "Handed over in the office", NOW);
    const page = await desk(db);
    const item = row(page.rows, requirement.id);
    has(item, "shortlisted");
    has(item, "shared");
    assert.equal(page.rows.filter((entry) => entry.id === requirement.id).length, 1);
    assert.equal(JSON.stringify(page).includes("Handed over"), false);
  });

  it("masks phone numbers for viewers and defines an empty state for every queue", async () => {
    const db = await setup();
    const requirement = await create(db);
    const hidden = await desk(db, viewerAccess);
    const shown = await desk(db, staff);
    const masked = row(hidden.rows, requirement.id);
    const open = row(shown.rows, requirement.id);
    assert.equal(masked.contactPhone, maskPhone(requirement.contactPhone));
    assert.notEqual(masked.contactPhone, requirement.contactPhone);
    assert.equal(open.contactPhone, requirement.contactPhone);
    assert.match(DESK_LAYOUT.filters, /flex-wrap/);
    assert.match(DESK_LAYOUT.row, /break-words/);
    assert.doesNotMatch(`${DESK_LAYOUT.filters} ${DESK_LAYOUT.row}`, /min-w-\[|overflow-x/);
    for (const queue of DESK_QUEUES) {
      assert.ok(emptyDeskMessage(queue.id).length > 10);
    }
    const empty = await operationsDesk(await setup(), staff, { now: new Date(NOW) });
    assert.equal(empty.total, 0);
    assert.equal(empty.rows.length, 0);
    const paged = paginateDesk([1, 2, 3], 2, 2);
    assert.deepEqual(paged.rows, [3]);
    assert.equal(paged.pages, 2);
  });
});

describe("plot dimensions", () => {
  it("stores dimensions as typed text and leaves area alone", async () => {
    const db = await setup();
    let property = await live(db, "plot-house", { area: 1200 });
    assert.equal(readPlotDimensions("  30x40  "), "30x40");
    assert.equal(readPlotDimensions(undefined), undefined);
    assert.throws(() => readPlotDimensions(1200), /text/);
    assert.equal(can(executive.role, "property.edit"), false);
    assert.equal(can(viewer.role, "property.edit"), false);
    assert.equal(can(manager.role, "property.edit"), true);

    property = await savePlotDimensions(db, manager, property, readPlotDimensions("30x40") ?? "", NOW);
    assert.equal(property.plotDimensions, "30x40");
    assert.equal(property.area, 1200);
    const next = asListing(property);
    next.area = 1800;
    property = await updatePropertyContent(db, manager, property, next, {
      now: NOW,
      allowPriceChange: true,
      expectedVersion: property.rowVersion,
    });
    assert.equal(property.area, 1800);
    assert.equal(property.plotDimensions, "30x40");
    property = await savePlotDimensions(db, manager, property, "40x60", NOW);
    assert.equal(property.plotDimensions, "40x60");
    assert.equal(property.area, 1800);
  });
});
