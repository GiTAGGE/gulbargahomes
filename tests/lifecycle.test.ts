import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyLifecycleAction,
  availabilityExpiresAt,
  availableActions,
  isAvailabilityStale,
  isPubliclyVisible,
  matchingBlockers,
  matchingMode,
  type LifecycleState,
} from "../lib/inventory/lifecycle";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const RECENT = "2026-11-05T12:00:00.000Z";

function state(overrides: Partial<LifecycleState> = {}): LifecycleState {
  return {
    listing: "Rent",
    verification: "Verified",
    publication: "Published",
    availability: "Available",
    discreetMatching: false,
    availabilityVerifiedAt: RECENT,
    availabilityValidDays: 0,
    ...overrides,
  };
}

const ctx = { actorId: "adm_1", now: NOW.toISOString() };

describe("public visibility", () => {
  it("shows verified published listings, including rented and sold", () => {
    assert.equal(isPubliclyVisible(state()), true);
    assert.equal(isPubliclyVisible(state({ availability: "Rented" })), true);
    assert.equal(isPubliclyVisible(state({ availability: "Sold" })), true);
  });

  it("hides every other combination", () => {
    for (const verification of ["Draft", "Pending", "Rejected"] as const) {
      assert.equal(isPubliclyVisible(state({ verification })), false, verification);
    }
    for (const publication of ["Unpublished", "Archived"] as const) {
      assert.equal(isPubliclyVisible(state({ publication })), false, publication);
    }
    for (const availability of ["On Hold", "Withdrawn"] as const) {
      assert.equal(isPubliclyVisible(state({ availability })), false, availability);
    }
    assert.equal(isPubliclyVisible(state({ publication: "Unpublished", discreetMatching: true })), false);
  });
});

describe("matching eligibility", () => {
  it("public mode needs Verified + Available + Published + a current check", () => {
    assert.equal(matchingMode(state(), NOW), "public");
  });

  it("internal mode needs Unpublished + discreet", () => {
    assert.equal(matchingMode(state({ publication: "Unpublished", discreetMatching: true }), NOW), "internal");
    assert.equal(matchingMode(state({ publication: "Unpublished" }), NOW), null);
  });

  it("never matches draft, pending, rejected, archived, rented or sold", () => {
    const blocked: Partial<LifecycleState>[] = [
      { verification: "Draft" },
      { verification: "Pending" },
      { verification: "Rejected" },
      { publication: "Archived" },
      { availability: "Rented" },
      { availability: "Sold" },
      { availability: "On Hold" },
      { availability: "Withdrawn" },
      { verification: "Draft", publication: "Unpublished", discreetMatching: true },
      { publication: "Archived", discreetMatching: true },
    ];
    for (const overrides of blocked) {
      assert.equal(matchingMode(state(overrides), NOW), null, JSON.stringify(overrides));
      assert.ok(matchingBlockers(state(overrides), NOW).length > 0);
    }
  });

  it("drops stale and never-checked properties until reconfirmed", () => {
    assert.equal(matchingMode(state({ availabilityVerifiedAt: null }), NOW), null);
    assert.equal(matchingMode(state({ availabilityVerifiedAt: "2026-10-01T00:00:00.000Z" }), NOW), null);
    assert.match(matchingBlockers(state({ availabilityVerifiedAt: null }), NOW).join(), /never confirmed/);
  });
});

describe("availability expiry", () => {
  it("defaults to 14 days for rent and 30 for sale", () => {
    assert.equal(
      availabilityExpiresAt(state({ availabilityVerifiedAt: "2026-11-01T00:00:00.000Z" })),
      "2026-11-15T00:00:00.000Z",
    );
    assert.equal(
      availabilityExpiresAt(state({ listing: "Sale", availabilityVerifiedAt: "2026-11-01T00:00:00.000Z" })),
      "2026-12-01T00:00:00.000Z",
    );
  });

  it("is stale exactly at expiry and honours per-property windows", () => {
    const checked = state({ availabilityVerifiedAt: "2026-11-01T00:00:00.000Z" });
    assert.equal(isAvailabilityStale(checked, new Date("2026-11-14T23:59:59.999Z")), false);
    assert.equal(isAvailabilityStale(checked, new Date("2026-11-15T00:00:00.000Z")), true);
    assert.equal(
      isAvailabilityStale({ ...checked, availabilityValidDays: 3 }, new Date("2026-11-04T00:00:00.000Z")),
      true,
    );
  });
});

describe("lifecycle transitions", () => {
  const draft = state({ verification: "Draft", publication: "Unpublished", availabilityVerifiedAt: null });

  it("walks draft → pending → verified → published", () => {
    const pending = applyLifecycleAction(draft, { type: "submit_for_verification" }, ctx);
    assert.ok(pending.ok);
    const verified = applyLifecycleAction(pending.next, { type: "verify" }, ctx);
    assert.ok(verified.ok);
    assert.equal(verified.patch.verified_by, "adm_1");
    const published = applyLifecycleAction(verified.next, { type: "publish" }, ctx);
    assert.ok(published.ok);
    assert.equal(published.patch.first_published_at, ctx.now);
    assert.equal(isPubliclyVisible(published.next), true);
  });

  it("refuses to publish an unverified property", () => {
    const result = applyLifecycleAction(draft, { type: "publish" }, ctx);
    assert.equal(result.ok, false);
  });

  it("requires a reason to reject and unpublishes on rejection", () => {
    assert.equal(applyLifecycleAction(state(), { type: "reject", reason: " " }, ctx).ok, false);
    const rejected = applyLifecycleAction(state(), { type: "reject", reason: "Owner sold it privately" }, ctx);
    assert.ok(rejected.ok);
    assert.equal(rejected.next.publication, "Unpublished");
    assert.equal(isPubliclyVisible(rejected.next), false);
  });

  it("archives without deleting and restores to unpublished", () => {
    const archived = applyLifecycleAction(state(), { type: "archive" }, ctx);
    assert.ok(archived.ok);
    assert.equal(archived.next.publication, "Archived");
    assert.equal(applyLifecycleAction(archived.next, { type: "publish" }, ctx).ok, false);
    const restored = applyLifecycleAction(archived.next, { type: "restore" }, ctx);
    assert.ok(restored.ok);
    assert.equal(restored.next.publication, "Unpublished");
  });

  it("withdrawing a published property unpublishes it", () => {
    const result = applyLifecycleAction(state(), { type: "set_availability", status: "Withdrawn" }, ctx);
    assert.ok(result.ok);
    assert.equal(result.next.publication, "Unpublished");
  });

  it("discreet matching is only for unpublished properties", () => {
    assert.equal(applyLifecycleAction(state(), { type: "set_discreet", enabled: true }, ctx).ok, false);
    const result = applyLifecycleAction(
      state({ publication: "Unpublished" }),
      { type: "set_discreet", enabled: true },
      ctx,
    );
    assert.ok(result.ok);
    assert.equal(matchingMode(result.next, NOW), "internal");
  });

  it("publishing clears the discreet flag", () => {
    const result = applyLifecycleAction(
      state({ publication: "Unpublished", discreetMatching: true }),
      { type: "publish" },
      ctx,
    );
    assert.ok(result.ok);
    assert.equal(result.next.discreetMatching, false);
  });

  it("confirms availability with a bounded window", () => {
    const stale = state({ availabilityVerifiedAt: null });
    const confirmed = applyLifecycleAction(stale, { type: "confirm_availability", validDays: 7 }, ctx);
    assert.ok(confirmed.ok);
    assert.equal(confirmed.patch.availability_expires_at, "2026-11-17T12:00:00.000Z");
    assert.equal(matchingMode(confirmed.next, NOW), "public");
    assert.equal(applyLifecycleAction(stale, { type: "confirm_availability", validDays: 0 }, ctx).ok, false);
    assert.equal(
      applyLifecycleAction(state({ availability: "Rented" }), { type: "confirm_availability" }, ctx).ok,
      false,
    );
  });

  it("lists only actions that would succeed", () => {
    const actions = availableActions(draft);
    assert.ok(actions.includes("verify"));
    assert.ok(!actions.includes("publish"));
    assert.ok(!actions.includes("restore"));
  });
});
