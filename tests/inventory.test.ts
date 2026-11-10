import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAudit } from "../lib/admin/audit";
import { prepareDatabase } from "../lib/db/prepare";
import type { PropertyRow } from "../lib/db/property-rows";
import {
  applyPropertyLifecycle,
  createDraftProperty,
  getInventoryBySlug,
  listInventory,
  updatePropertyContent,
} from "../lib/inventory/repository";
import { emptyProperty } from "../lib/property-input";
import { loadSeedProperties } from "../lib/property-normalize";
import { createTestDb } from "./helpers/sqlite";

const actor = { id: "adm_test", email: "manager@example.com", role: "inventory_manager" };
const ALL = { includeDiscreet: true };
const NOW = "2026-11-10T10:00:00.000Z";

async function setup() {
  const db = createTestDb();
  await prepareDatabase(db, () => loadSeedProperties().slice(0, 2), NOW);
  return db;
}

function draft(slug: string) {
  return {
    ...emptyProperty(NOW),
    slug,
    title: `Test ${slug}`,
    locality: "Sedam Road",
    price: 12000,
  };
}

async function publicSlugs(db: ReturnType<typeof createTestDb>) {
  const { results } = await db.prepare("SELECT slug FROM public_properties").all<Pick<PropertyRow, "slug">>();
  return new Set(results.map((row) => row.slug));
}

describe("inventory isolation", () => {
  it("never exposes drafts, pending, rejected, discreet, withdrawn or archived inventory", async () => {
    const db = await setup();
    const make = (slug: string) => createDraftProperty(db, actor, draft(slug), { now: NOW });

    await make("only-draft");

    const pending = await make("pending-one");
    await applyPropertyLifecycle(db, actor, pending, { type: "submit_for_verification" }, { now: NOW });

    const rejected = await make("rejected-one");
    await applyPropertyLifecycle(db, actor, rejected, { type: "reject", reason: "Bad photos" }, { now: NOW });

    let discreet = await make("discreet-one");
    discreet = await applyPropertyLifecycle(db, actor, discreet, { type: "verify" }, { now: NOW });
    await applyPropertyLifecycle(db, actor, discreet, { type: "set_discreet", enabled: true }, { now: NOW });

    let withdrawn = await make("withdrawn-one");
    withdrawn = await applyPropertyLifecycle(db, actor, withdrawn, { type: "verify" }, { now: NOW });
    withdrawn = await applyPropertyLifecycle(db, actor, withdrawn, { type: "publish" }, { now: NOW });
    await applyPropertyLifecycle(db, actor, withdrawn, { type: "set_availability", status: "Withdrawn" }, { now: NOW });

    let onHold = await make("on-hold-one");
    onHold = await applyPropertyLifecycle(db, actor, onHold, { type: "verify" }, { now: NOW });
    onHold = await applyPropertyLifecycle(db, actor, onHold, { type: "publish" }, { now: NOW });
    await applyPropertyLifecycle(db, actor, onHold, { type: "set_availability", status: "On Hold" }, { now: NOW });

    let archived = await make("archived-one");
    archived = await applyPropertyLifecycle(db, actor, archived, { type: "verify" }, { now: NOW });
    archived = await applyPropertyLifecycle(db, actor, archived, { type: "publish" }, { now: NOW });
    await applyPropertyLifecycle(db, actor, archived, { type: "archive" }, { now: NOW });

    let live = await make("live-one");
    live = await applyPropertyLifecycle(db, actor, live, { type: "verify" }, { now: NOW });
    await applyPropertyLifecycle(db, actor, live, { type: "publish" }, { now: NOW });

    const visible = await publicSlugs(db);
    assert.ok(visible.has("live-one"));
    for (const hidden of [
      "only-draft",
      "pending-one",
      "rejected-one",
      "discreet-one",
      "withdrawn-one",
      "on-hold-one",
      "archived-one",
    ]) {
      assert.ok(!visible.has(hidden), hidden);
    }
    assert.equal(visible.size, 3);
  });

  it("hides discreet inventory from staff without access", async () => {
    const db = await setup();
    let property = await createDraftProperty(db, actor, draft("quiet-sale"), { now: NOW });
    property = await applyPropertyLifecycle(db, actor, property, { type: "verify" }, { now: NOW });
    await applyPropertyLifecycle(db, actor, property, { type: "set_discreet", enabled: true }, { now: NOW });

    assert.ok(await getInventoryBySlug(db, "quiet-sale", ALL));
    assert.equal(await getInventoryBySlug(db, "quiet-sale", { includeDiscreet: false }), null);
    const restricted = await listInventory(db, { includeDiscreet: false });
    assert.ok(!restricted.some((item) => item.slug === "quiet-sale"));
  });
});

describe("inventory writes", () => {
  it("creates drafts with codes and an audit row", async () => {
    const db = await setup();
    const created = await createDraftProperty(db, actor, draft("new-one"), { now: NOW });
    assert.equal(created.verificationStatus, "Draft");
    assert.equal(created.publicationStatus, "Unpublished");
    assert.equal(created.code, "GH-P0003");
    const audit = await listAudit(db, { entityType: "property", entityId: created.id });
    assert.equal(audit[0].action, "create");
    assert.equal(audit[0].actorId, actor.id);
  });

  it("keeps id and history through a slug rename", async () => {
    const db = await setup();
    const created = await createDraftProperty(db, actor, draft("old-slug"), { now: NOW });
    const renamed = await updatePropertyContent(
      db,
      actor,
      created,
      { ...draft("new-slug"), title: created.title },
      { now: NOW, allowPriceChange: true },
    );
    assert.equal(renamed.id, created.id);
    assert.equal(renamed.slug, "new-slug");
    assert.equal(await getInventoryBySlug(db, "old-slug", ALL), null);
    const audit = await listAudit(db, { entityType: "property", entityId: created.id });
    assert.deepEqual(audit[0].changes.slug, ["old-slug", "new-slug"]);
  });

  it("records price changes and blocks them without permission", async () => {
    const db = await setup();
    const created = await createDraftProperty(db, actor, draft("priced"), { now: NOW });
    await assert.rejects(
      updatePropertyContent(db, actor, created, { ...draft("priced"), price: 15000 }, { now: NOW, allowPriceChange: false }),
      /cannot change prices/,
    );
    const updated = await updatePropertyContent(
      db,
      actor,
      created,
      { ...draft("priced"), price: 15000 },
      { now: NOW, allowPriceChange: true },
    );
    assert.equal(updated.price, 15000);
    const audit = await listAudit(db, { entityType: "property", entityId: created.id });
    assert.equal(audit[0].action, "update_with_price_change");
    assert.deepEqual(audit[0].changes.price, [12000, 15000]);
  });

  it("rejects stale writes without writing audit rows", async () => {
    const db = await setup();
    const created = await createDraftProperty(db, actor, draft("contended"), { now: NOW });
    await applyPropertyLifecycle(db, actor, created, { type: "verify" }, { now: NOW });
    await assert.rejects(
      applyPropertyLifecycle(db, actor, created, { type: "reject", reason: "x" }, { now: NOW }),
      /Someone else changed/,
    );
    const audit = await listAudit(db, { entityType: "property", entityId: created.id });
    assert.deepEqual(
      audit.map((entry) => entry.action).sort(),
      ["create", "verify"],
    );
  });

  it("refuses edits to archived properties", async () => {
    const db = await setup();
    let created = await createDraftProperty(db, actor, draft("boxed"), { now: NOW });
    created = await applyPropertyLifecycle(db, actor, created, { type: "archive" }, { now: NOW });
    await assert.rejects(
      updatePropertyContent(db, actor, created, { ...draft("boxed"), title: "Changed" }, { now: NOW, allowPriceChange: true }),
      /Restore/,
    );
  });
});
