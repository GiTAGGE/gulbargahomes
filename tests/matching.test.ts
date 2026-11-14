import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOwnerLead, parseOwnerLeadInput } from "../lib/crm/owner-leads";
import {
  listRequirementMatches,
  recordMatchDecision,
  safeRequirementMatch,
  type StoredMatch,
} from "../lib/crm/matching";
import { noMatching } from "../lib/crm/matching-hook";
import { areNeighbouringLocalities, reviewedNeighbourPairs } from "../lib/crm/locality-neighbours";
import { MATCH_WEIGHTS, scoreMatch, stretchLimit, type MatchListing, type MatchRequest } from "../lib/crm/match-score";
import { parsePlotDimensions } from "../lib/crm/plot-size";
import { createRequirement, getRequirement, parseRequirementInput, updateRequirement } from "../lib/crm/requirements";
import { parseSourceInput } from "../lib/crm/sources";
import { extendRequirementTimeline, reopenRequirement } from "../lib/crm/timeline";
import { prepareDatabase } from "../lib/db/prepare";
import type { SqlStatement } from "../lib/db/sql";
import type { InventoryProperty } from "../lib/db/property-rows";
import {
  applyPropertyLifecycle,
  createDraftProperty,
  savePlotDimensions,
  updatePropertyContent,
} from "../lib/inventory/repository";
import { emptyProperty } from "../lib/property-input";
import { site } from "../lib/site";
import type { Property } from "../lib/types";
import { createTestDb } from "./helpers/sqlite";

const NOW = "2026-11-14T00:00:00.000Z";
const manager = { id: "adm_mgr", email: "manager@example.com", role: "inventory_manager" };
const executive = { id: "adm_exec", email: "exec@example.com", role: "lead_executive" };
const viewer = { id: "adm_view", email: "view@example.com", role: "viewer" };

let phones = 9800000000;

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => [], NOW);
  return db;
}

function request(overrides: Partial<MatchRequest> = {}): MatchRequest {
  return {
    intent: "Rent",
    propertyTypes: ["House"],
    localities: ["Sai Nagar"],
    localityFlexible: false,
    areaMin: 1000,
    plotArea: null,
    budgetMin: null,
    budgetMax: 100000,
    bhkMin: null,
    bhkMax: null,
    furnishing: "Any",
    vegetarian: "Any",
    parkingRequired: false,
    ...overrides,
  };
}

function listing(overrides: Partial<MatchListing> = {}): MatchListing {
  return {
    listing: "Rent",
    propertyType: "House",
    locality: "Sai Nagar",
    area: 1200,
    plotDimensions: "",
    price: 100000,
    bhk: null,
    furnished: "Unfurnished",
    vegetarian: "Not Required",
    parking: "",
    mode: "public",
    ...overrides,
  };
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

async function create(db: Awaited<ReturnType<typeof setup>>, input: ReturnType<typeof parseRequirementInput>) {
  phones += 1;
  return createRequirement(
    db,
    executive,
    { name: "Seeker", phone: String(phones) },
    input,
    parseSourceInput({ channel: "manual" }),
    NOW,
  );
}

async function live(db: Awaited<ReturnType<typeof setup>>, slug: string, overrides: Partial<Property> = {}) {
  let property = await createDraftProperty(db, manager, draft(slug, overrides), { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "verify" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "publish" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "confirm_availability" }, { now: NOW });
  return property;
}

async function discreet(db: Awaited<ReturnType<typeof setup>>, slug: string, overrides: Partial<Property> = {}) {
  let property = await createDraftProperty(db, manager, draft(slug, overrides), { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "verify" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "confirm_availability" }, { now: NOW });
  property = await applyPropertyLifecycle(db, manager, property, { type: "set_discreet", enabled: true }, { now: NOW });
  return property;
}

function requirementInput(overrides: Record<string, unknown> = {}) {
  return parseRequirementInput({
    intent: "Rent",
    propertyTypes: ["House"],
    localities: ["Sai Nagar"],
    localityFlexible: false,
    areaMin: 1000,
    budgetMax: 100000,
    timeline: "Within 30 days",
    ...overrides,
  });
}

async function runs(db: Awaited<ReturnType<typeof setup>>, requirementId: string) {
  const { results } = await db
    .prepare("SELECT trigger, result, error, match_count FROM match_runs WHERE requirement_id = ?1 ORDER BY started_at")
    .bind(requirementId)
    .all<{ trigger: string; result: string; error: string; match_count: number }>();
  return results;
}

function byProperty(matches: StoredMatch[], property: InventoryProperty) {
  const match = matches.find((item) => item.propertyId === property.id);
  assert.ok(match, property.slug);
  return match;
}

describe("match scoring", () => {
  it("keeps rent with rent, buy with sale, and the requested property type", () => {
    assert.equal(scoreMatch(request(), listing({ listing: "Sale" })).eligible, false);
    assert.equal(scoreMatch(request({ intent: "Buy" }), listing()).eligible, false);
    assert.equal(scoreMatch(request({ intent: "Buy" }), listing({ listing: "Sale" })).eligible, true);
    assert.equal(scoreMatch(request({ propertyTypes: [] }), listing()).eligible, false);
    assert.equal(scoreMatch(request({ propertyTypes: ["Flat"] }), listing()).eligible, false);
    const house = scoreMatch(request(), listing());
    assert.equal(house.eligible, true);
    if (house.eligible) assert.equal(house.score, MATCH_WEIGHTS.locality + MATCH_WEIGHTS.area + MATCH_WEIGHTS.budget);
  });

  it("scores an exact locality above a flexible neighbour and refuses other localities", () => {
    const exact = scoreMatch(request(), listing());
    const nearby = scoreMatch(
      request({ localityFlexible: true }),
      listing({ locality: "Shahabad Road", price: 110000 }),
    );
    const blocked = scoreMatch(request(), listing({ locality: "Shahabad Road" }));
    const unknown = scoreMatch(
      request({ localities: ["Farmers Layout"], localityFlexible: true }),
      listing({ locality: "Sai Nagar" }),
    );
    assert.equal(exact.eligible && nearby.eligible, true);
    if (exact.eligible && nearby.eligible) {
      assert.ok(exact.score > nearby.score);
      assert.equal(exact.localityScore, MATCH_WEIGHTS.locality);
      assert.equal(nearby.localityScore, MATCH_WEIGHTS.nearbyLocality);
      assert.match(nearby.explanation, /neighbouring locality of Sai Nagar/);
      assert.match(nearby.explanation, /₹10,000 above/);
      assert.match(nearby.explanation, /15% stretch of ₹1,15,000/);
    }
    assert.equal(blocked.eligible, false);
    assert.equal(unknown.eligible, false);
    assert.equal(stretchLimit(100000), 115000);
  });

  it("compares square feet with square feet and plot sizes with plot sizes", () => {
    assert.deepEqual(parsePlotDimensions("30 × 40"), parsePlotDimensions("40x30"));
    assert.equal(parsePlotDimensions("1200 sq ft"), null);
    const feet = scoreMatch(request({ areaMin: 1000 }), listing({ area: 1200 }));
    const short = scoreMatch(request({ areaMin: 1000 }), listing({ area: 800 }));
    const dimensions = scoreMatch(
      request({ areaMin: null, plotArea: "30x40" }),
      listing({ area: 0, plotDimensions: "30 × 40" }),
    );
    const otherShape = scoreMatch(
      request({ areaMin: null, plotArea: "30x40" }),
      listing({ area: 0, plotDimensions: "30x50" }),
    );
    const mixed = scoreMatch(request({ areaMin: null, plotArea: "30x40" }), listing({ area: 1200, plotDimensions: "" }));
    assert.equal(feet.eligible && feet.areaScore, MATCH_WEIGHTS.area);
    assert.equal(short.eligible && short.areaScore, MATCH_WEIGHTS.areaShort);
    assert.equal(dimensions.eligible && dimensions.areaScore, MATCH_WEIGHTS.area);
    assert.match(dimensions.eligible ? dimensions.explanation : "", /30 × 40/);
    assert.equal(otherShape.eligible && otherShape.areaScore, MATCH_WEIGHTS.areaShape);
    assert.equal(mixed.eligible, true);
    if (mixed.eligible) {
      assert.equal(mixed.areaScore, 0);
      assert.match(mixed.explanation, /not treated as a mismatch/);
      assert.match(mixed.explanation, /not converted into square feet/);
    }
  });

  it("keeps an over-budget property visible and explains the gap", () => {
    const within = scoreMatch(request(), listing({ price: 90000 }));
    const stretch = scoreMatch(request(), listing({ price: 115000 }));
    const over = scoreMatch(request(), listing({ price: 150000 }));
    const unpriced = scoreMatch(request(), listing({ price: 0 }));
    assert.equal(within.eligible && within.budgetScore, MATCH_WEIGHTS.budget);
    assert.equal(stretch.eligible && stretch.budgetScore, MATCH_WEIGHTS.budgetStretch);
    assert.equal(over.eligible && over.budgetScore, MATCH_WEIGHTS.budgetOver);
    if (over.eligible) assert.match(over.explanation, /₹50,000 above/);
    assert.equal(unpriced.eligible && unpriced.budgetScore, 0);
    if (unpriced.eligible) assert.match(unpriced.explanation, /no price/);
  });

  it("does not award a preference the property does not record", () => {
    const scored = scoreMatch(
      request({ bhkMin: 2, bhkMax: 3, furnishing: "Fully Furnished", parkingRequired: true, vegetarian: "Yes" }),
      listing({ bhk: null, furnished: "", parking: "", vegetarian: "" }),
    );
    assert.equal(scored.eligible, true);
    if (scored.eligible) {
      assert.equal(scored.score, MATCH_WEIGHTS.locality + MATCH_WEIGHTS.area + MATCH_WEIGHTS.budget);
      assert.match(scored.explanation, /BHK: not scored/);
      assert.match(scored.explanation, /Furnishing: not scored/);
      assert.match(scored.explanation, /Parking: not scored/);
    }
  });
});

describe("locality neighbours", () => {
  it("only links reviewed website localities, in both directions", () => {
    for (const [left, right] of reviewedNeighbourPairs()) {
      assert.ok((site.localities as readonly string[]).includes(left), left);
      assert.ok((site.localities as readonly string[]).includes(right), right);
      assert.equal(areNeighbouringLocalities(left, right), true);
      assert.equal(areNeighbouringLocalities(right, left), true);
    }
    assert.equal(areNeighbouringLocalities("Sai Nagar", "Shahabad Road"), true);
    assert.equal(areNeighbouringLocalities("Azadpur", "Biddapur Colony"), false);
    assert.equal(areNeighbouringLocalities("Sedam Road", "Ring Road"), false);
    assert.equal(areNeighbouringLocalities("Super Market", "Shahbazar"), false);
    assert.equal(areNeighbouringLocalities("Farmers Layout", "Sai Nagar"), false);
    assert.equal(areNeighbouringLocalities("Sai Nagar", "sai nagar"), false);
  });
});

describe("matching runs", () => {
  it("ranks an exact within-budget house above a neighbouring stretch and explains both", async () => {
    const db = await setup();
    const exact = await live(db, "exact-house", { locality: "Sai Nagar", price: 100000, area: 1200 });
    const nearby = await live(db, "nearby-house", { locality: "Shahabad Road", price: 110000, area: 1200 });
    const far = await live(db, "far-house", { locality: "Jewargi Road", price: 90000, area: 1200 });
    const requirement = await create(db, requirementInput({ localities: ["Sai Nagar"], localityFlexible: true }));
    const matches = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    assert.deepEqual(matches.map((match) => match.propertyId), [exact.id, nearby.id]);
    assert.equal(matches[0].rank, 1);
    assert.equal(matches[1].rank, 2);
    assert.ok(matches[0].score > matches[1].score);
    assert.match(matches[0].explanation, /locality 40/);
    assert.match(matches[1].explanation, /neighbouring locality/);
    assert.match(matches[1].explanation, /₹10,000 above/);
    assert.equal(matches.some((match) => match.propertyId === far.id), false);
    assert.equal(matches[0].status, "Suggested");
    assert.equal(matches[0].matchingMode, "public");
    const created = await runs(db, requirement.id);
    assert.equal(created.at(-1)?.trigger, "requirement_created");
    assert.equal(created.at(-1)?.result, "completed");
  });

  it("matches a verified available property and skips drafts, pending, sold and stale confirmations", async () => {
    const db = await setup();
    const ready = await live(db, "ready");
    await createDraftProperty(db, manager, draft("still-draft"), { now: NOW });
    let pending = await createDraftProperty(db, manager, draft("pending"), { now: NOW });
    pending = await applyPropertyLifecycle(db, manager, pending, { type: "submit_for_verification" }, { now: NOW });
    let sold = await live(db, "sold-house");
    sold = await applyPropertyLifecycle(db, manager, sold, { type: "set_availability", status: "Sold" }, { now: NOW });
    let rented = await live(db, "rented-house");
    rented = await applyPropertyLifecycle(db, manager, rented, { type: "set_availability", status: "Rented" }, { now: NOW });
    let withdrawn = await live(db, "withdrawn-house");
    withdrawn = await applyPropertyLifecycle(db, manager, withdrawn, { type: "set_availability", status: "Withdrawn" }, { now: NOW });
    let stale = await live(db, "stale-house");
    await db
      .prepare("UPDATE properties SET availability_verified_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1")
      .bind(stale.id)
      .run();
    const requirement = await create(db, requirementInput());
    const matches = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    assert.deepEqual(matches.map((match) => match.propertyId), [ready.id]);
    assert.equal(pending.verificationStatus, "Pending");
    assert.equal(sold.status, "Sold");
    assert.equal(rented.status, "Rented");
    assert.equal(withdrawn.status, "Withdrawn");
  });

  it("keeps public and discreet inventory apart", async () => {
    const db = await setup();
    const published = await live(db, "public-house", { title: "Public house", price: 80000 });
    const hidden = await discreet(db, "quiet-house", { title: "Quiet house", locality: "Sai Nagar", price: 90000 });
    const later = await live(db, "later-house", { title: "Later house", price: 95000 });
    const requirement = await create(db, requirementInput());
    const privileged = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    const staff = await listRequirementMatches(db, requirement.id, { viewDiscreet: false });
    assert.deepEqual(privileged.map((match) => match.propertyId), [published.id, hidden.id, later.id]);
    assert.deepEqual(staff.map((match) => match.propertyId), [published.id, later.id]);
    assert.deepEqual(staff.map((match) => match.rank), [1, 2]);
    assert.equal(JSON.stringify(staff).includes(hidden.id), false);
    assert.equal(JSON.stringify(staff).includes("Quiet house"), false);
    assert.equal(staff.every((match) => match.matchingMode === "public"), true);
    await assert.rejects(
      recordMatchDecision(db, executive, byProperty(privileged, hidden).id, "Shortlisted", "Hold it", NOW),
      /not found/,
    );
    const decided = await recordMatchDecision(db, manager, byProperty(privileged, hidden).id, "Shortlisted", "Hold it", NOW);
    assert.equal(decided.status, "Shortlisted");
    await assert.rejects(recordMatchDecision(db, viewer, decided.id, "Rejected", "No", NOW), /cannot decide/);
  });

  it("stores plot dimensions separately and uses them only against plot dimensions", async () => {
    const db = await setup();
    const sized = await live(db, "sized-plot", { propertyType: "Plot", listing: "Sale", priceSuffix: "", area: 0, price: 900000 });
    await savePlotDimensions(db, manager, sized, "30x40", NOW);
    const feetOnly = await live(db, "feet-plot", { propertyType: "Plot", listing: "Sale", priceSuffix: "", area: 1200, price: 900000 });
    const input = requirementInput({
      intent: "Buy",
      propertyTypes: ["Plot"],
      budgetMax: 1000000,
      areaMin: null,
    });
    input.preferenceDetails = { plotArea: "30 × 40" };
    const requirement = await create(db, input);
    const matches = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    const dimensions = byProperty(matches, sized);
    const feet = byProperty(matches, feetOnly);
    assert.equal(dimensions.plotDimensions, "30x40");
    assert.equal(dimensions.areaScore, MATCH_WEIGHTS.area);
    assert.equal(feet.areaScore, 0);
    assert.match(feet.explanation, /not treated as a mismatch|could not be compared/);
    const storedArea = await db.prepare("SELECT area FROM properties WHERE id = ?1").bind(sized.id).first<{ area: number }>();
    assert.equal(Number(storedArea?.area), 0);
  });

  it("repeats safely, keeps staff decisions, and expires a suggestion that no longer qualifies", async () => {
    const db = await setup();
    const property = await live(db, "repeat-house");
    const requirement = await create(db, requirementInput());
    const first = (await listRequirementMatches(db, requirement.id, { viewDiscreet: true }))[0];
    await safeRequirementMatch(db, requirement.id, "requirement_created");
    const second = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    assert.equal(second.length, 1);
    assert.equal(second[0].id, first.id);
    const decided = await recordMatchDecision(db, executive, first.id, "Shortlisted", "Client liked the road", NOW);
    const refreshed = await getRequirement(db, requirement.id);
    await updatePropertyContent(
      db,
      manager,
      property,
      draft("repeat-house", { price: 150000 }),
      { now: NOW, expectedVersion: property.rowVersion, allowPriceChange: true },
    );
    const afterPrice = byProperty(await listRequirementMatches(db, requirement.id, { viewDiscreet: true }), property);
    assert.equal(afterPrice.id, decided.id);
    assert.equal(afterPrice.status, "Shortlisted");
    assert.equal(afterPrice.decisionReason, "Client liked the road");
    assert.equal(afterPrice.eligible, true);
    assert.ok(afterPrice.budgetScore < decided.budgetScore);
    assert.equal(refreshed?.status, "New");
    assert.equal(afterPrice.status, "Shortlisted");

    let current = await db
      .prepare("SELECT row_version FROM properties WHERE id = ?1")
      .bind(property.id)
      .first<{ row_version: number }>();
    const latest = { ...property, rowVersion: Number(current?.row_version) };
    await applyPropertyLifecycle(db, manager, latest, { type: "set_availability", status: "Rented" }, { now: NOW });
    const retired = byProperty(await listRequirementMatches(db, requirement.id, { viewDiscreet: true }), property);
    assert.equal(retired.status, "Shortlisted");
    assert.equal(retired.eligible, false);
    assert.match(retired.explanation, /No longer eligible/);
    assert.match(retired.explanation, /Client liked the road/);

    const other = await live(db, "other-house");
    const open = await create(db, requirementInput());
    await applyPropertyLifecycle(
      db,
      manager,
      other,
      { type: "set_availability", status: "Withdrawn" },
      { now: NOW, expectedVersion: other.rowVersion },
    );
    const expired = byProperty(await listRequirementMatches(db, open.id, { viewDiscreet: true }), other);
    assert.equal(expired.status, "Expired");
    assert.equal(expired.decision, "");
  });

  it("refreshes from timeline changes without erasing a decision or the requirement", async () => {
    const db = await setup();
    const property = await live(db, "timeline-house");
    const requirement = await create(db, requirementInput());
    const match = (await listRequirementMatches(db, requirement.id, { viewDiscreet: true }))[0];
    await recordMatchDecision(db, executive, match.id, "Rejected", "Too far inside the lane", NOW);
    const extended = await getRequirement(db, requirement.id);
    await extendRequirementTimeline(
      db,
      executive,
      extended!,
      { timeline: "Within 3 months", reason: "Client needs more time", confirmationMethod: "phone", notes: "Next summer." },
      { now: NOW, expectedVersion: extended!.rowVersion },
    );
    const afterExtend = byProperty(await listRequirementMatches(db, requirement.id, { viewDiscreet: true }), property);
    assert.equal(afterExtend.status, "Rejected");
    assert.equal(afterExtend.decisionReason, "Too far inside the lane");
    assert.equal((await getRequirement(db, requirement.id))?.confirmedTimeline, "Within 3 months");
    let lost = await getRequirement(db, requirement.id);
    lost = await updateRequirement(db, executive, lost!, { status: "Lost", outcome: "Paused the search" }, { now: NOW, expectedVersion: lost!.rowVersion });
    await reopenRequirement(
      db,
      executive,
      lost,
      { timeline: "Within 1 month", confirmationMethod: "whatsapp", notes: "They are looking again." },
      { now: NOW, expectedVersion: lost.rowVersion },
    );
    const afterReopen = byProperty(await listRequirementMatches(db, requirement.id, { viewDiscreet: true }), property);
    assert.equal(afterReopen.status, "Rejected");
    assert.equal((await getRequirement(db, requirement.id))?.status, "Contacted");
    const triggers = (await runs(db, requirement.id)).map((run) => run.trigger);
    assert.ok(triggers.includes("timeline_extended"));
    assert.ok(triggers.includes("requirement_reopened"));
  });

  it("does not match an owner lead, and matches it only once it is verified stock", async () => {
    const db = await setup();
    const lead = await createOwnerLead(
      db,
      executive,
      { name: "Owner", phone: "9900099111" },
      parseOwnerLeadInput({ intent: "Rent", propertyType: "House", locality: "Sai Nagar", expectedPrice: 100000 }),
      parseSourceInput({ channel: "manual" }),
      NOW,
    );
    await noMatching.onCaptured(db, { kind: "owner_lead", id: lead.id, contactId: lead.contactId, origin: "manual" });
    const requirement = await create(db, requirementInput());
    assert.equal((await listRequirementMatches(db, requirement.id, { viewDiscreet: true })).length, 0);
    const property = await createDraftProperty(
      db,
      manager,
      draft("from-lead"),
      { now: NOW, sourceOwnerLeadId: lead.id },
    );
    await safeRequirementMatch(db, requirement.id, "property_verified");
    assert.equal((await listRequirementMatches(db, requirement.id, { viewDiscreet: true })).some((match) => match.propertyId === property.id), false);
    await live(db, "from-lead-live");
    const matches = await listRequirementMatches(db, requirement.id, { viewDiscreet: true });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].propertyId === lead.id, false);
  });

  it("records a matching failure without undoing the requirement or property change", async () => {
    const db = await setup();
    const property = await live(db, "failure-house");
    const requirement = await create(db, requirementInput());
    await db.prepare("DROP TABLE matches").run();
    const updated = await updateRequirement(
      db,
      executive,
      requirement,
      {
        details: {
          intent: "Rent",
          propertyTypes: ["House"],
          localities: ["Sai Nagar"],
          localityFlexible: false,
          areaMin: 1000,
          budgetMax: 80000,
          timeline: "Within 30 days",
        },
      },
      { now: NOW, expectedVersion: requirement.rowVersion },
    );
    assert.equal(updated.budgetMax, 80000);
    const failed = await runs(db, requirement.id);
    assert.equal(failed.at(-1)?.result, "failed");
    const priced = await updatePropertyContent(
      db,
      manager,
      property,
      draft("failure-house", { price: 80000 }),
      { now: NOW, expectedVersion: property.rowVersion, allowPriceChange: true },
    );
    assert.equal(priced.price, 80000);
    await extendRequirementTimeline(
      db,
      executive,
      updated,
      { timeline: "Within 6 months", reason: "Family decision pending", confirmationMethod: "in_person", notes: "They will decide later." },
      { now: NOW, expectedVersion: updated.rowVersion },
    );
    assert.equal((await getRequirement(db, updated.id))?.confirmedTimeline, "Within 6 months");
  });

  it("runs one follow-up so a trigger during a match sees the latest saved requirement", async () => {
    const db = await setup();
    const property = await live(db, "coalesce-house");
    const requirement = await create(db, requirementInput());
    const original = (await listRequirementMatches(db, requirement.id, { viewDiscreet: true }))[0];
    await recordMatchDecision(db, executive, original.id, "Shortlisted", "Keep this one", NOW);

    let held = 0;
    let releaseHold = () => {};
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string): SqlStatement => {
      const statement = prepare(sql);
      if (sql !== "SELECT * FROM matches WHERE requirement_id = ?1") return statement;
      const paused: SqlStatement = {
        bind(...values) {
          const bound = statement.bind(...values);
          const heldRead: SqlStatement = {
            bind: (...next) => bound.bind(...next),
            all: async () => {
              held += 1;
              if (held === 1) await hold;
              return bound.all();
            },
            first: () => bound.first(),
            run: () => bound.run(),
          };
          return heldRead;
        },
        all: () => statement.all(),
        first: () => statement.first(),
        run: () => statement.run(),
      };
      return paused;
    };

    const first = safeRequirementMatch(db, requirement.id, "property_content_changed");
    for (let attempt = 0; attempt < 20 && held === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(held, 1);

    await db.prepare("UPDATE demand_requirements SET budget_max = ?1 WHERE id = ?2").bind(50000, requirement.id).run();
    const updated = safeRequirementMatch(db, requirement.id, "requirement_updated");
    const extended = safeRequirementMatch(db, requirement.id, "timeline_extended");
    releaseHold();
    await Promise.all([first, updated, extended]);

    const match = byProperty(await listRequirementMatches(db, requirement.id, { viewDiscreet: true }), property);
    assert.equal(match.id, original.id);
    assert.equal(match.status, "Shortlisted");
    assert.equal(match.decisionReason, "Keep this one");
    assert.equal(match.eligible, true);
    assert.equal(match.budgetScore, MATCH_WEIGHTS.budgetOver);
    assert.match(match.explanation, /₹50,000 maximum/);
    const logged = await runs(db, requirement.id);
    assert.deepEqual(logged.map((run) => run.trigger), ["requirement_created", "property_content_changed", "timeline_extended"]);
    assert.equal(logged.every((run) => run.result === "completed"), true);
  });
});
