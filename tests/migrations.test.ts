import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyMigrations, LATEST_SCHEMA_VERSION, MIGRATIONS } from "../lib/db/migrations";
import { prepareDatabase } from "../lib/db/prepare";
import { contentColumns, insertSql, rowToProperty, type PropertyRow } from "../lib/db/property-rows";
import { loadSeedProperties } from "../lib/property-normalize";
import { createTestDb } from "./helpers/sqlite";

const LEGACY_SCHEMA = MIGRATIONS[0].statements;

async function legacyDatabase(count: number) {
  const db = createTestDb();
  for (const sql of LEGACY_SCHEMA) await db.prepare(sql).run();
  const seed = loadSeedProperties().slice(0, count);
  for (const property of seed) {
    const { sql, values } = insertSql("properties", {
      ...contentColumns(property),
      status: property.status,
      updated_at: "2026-11-01T00:00:00.000Z",
    });
    await db.prepare(sql).bind(...values).run();
  }
  await db.prepare("INSERT INTO app_meta (key, value) VALUES ('properties_seeded', '1')").run();
  return { db, seed };
}

describe("migrations", () => {
  it("builds a fresh database and seeds every snapshot listing as public", async () => {
    const db = createTestDb();
    await prepareDatabase(db, loadSeedProperties, "2026-11-10T00:00:00.000Z");
    const total = await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>();
    const visible = await db.prepare("SELECT COUNT(*) AS n FROM public_properties").first<{ n: number }>();
    assert.equal(total?.n, loadSeedProperties().length);
    assert.equal(visible?.n, total?.n);
    const versions = await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all<{ version: number }>();
    assert.deepEqual(
      versions.results.map((row) => row.version),
      MIGRATIONS.map((migration) => migration.version),
    );
    assert.equal(MIGRATIONS.at(-1)?.version, LATEST_SCHEMA_VERSION);
    assert.equal(MIGRATIONS.some((migration) => migration.version === 7), false);
  });

  it("upgrades a production-shaped database without hiding or changing listings", async () => {
    const { db, seed } = await legacyDatabase(12);
    const before = (await db.prepare("SELECT * FROM properties ORDER BY slug").all<PropertyRow>()).results.map(
      rowToProperty,
    );

    await prepareDatabase(db, loadSeedProperties, "2026-11-10T00:00:00.000Z");

    const rows = (await db.prepare("SELECT * FROM public_properties ORDER BY slug").all<PropertyRow>()).results;
    assert.equal(rows.length, seed.length);
    assert.deepEqual(rows.map(rowToProperty), before);

    const ids = new Set(rows.map((row) => row.id));
    const codes = new Set(rows.map((row) => row.code));
    assert.equal(ids.size, rows.length);
    assert.equal(codes.size, rows.length);
    assert.ok(rows.every((row) => /^prp_[0-9a-f]{20}$/.test(row.id)));
    assert.ok(rows.every((row) => /^GH-P\d{4}$/.test(row.code)));
    assert.ok(rows.every((row) => row.availability_verified_at === null));

    const sequence = await db.prepare("SELECT value FROM app_meta WHERE key = 'seq_property'").first<{ value: string }>();
    assert.equal(Number(sequence?.value), seed.length);
  });

  it("does not reseed an already seeded database", async () => {
    const { db, seed } = await legacyDatabase(3);
    await prepareDatabase(db, loadSeedProperties);
    const total = await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>();
    assert.equal(total?.n, seed.length);
  });

  it("is idempotent", async () => {
    const db = createTestDb();
    await prepareDatabase(db, loadSeedProperties);
    assert.deepEqual(await applyMigrations(db), []);
    await prepareDatabase(db, loadSeedProperties);
    const total = await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>();
    assert.equal(total?.n, loadSeedProperties().length);
  });

  it("rolls back a failed migration completely", async () => {
    const { db } = await legacyDatabase(1);
    await db.prepare("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)").run();
    await db.prepare("INSERT INTO schema_migrations VALUES (1, 'properties_baseline', 'x')").run();
    await db.prepare("ALTER TABLE properties ADD COLUMN archived_at TEXT").run();

    await assert.rejects(applyMigrations(db));
    const columns = await db.prepare("PRAGMA table_info(properties)").all<{ name: string }>();
    assert.ok(!columns.results.some((column) => column.name === "verification_status"));
  });

  it("adds intent columns to a version 5 database and leaves existing queue rows alone", async () => {
    const db = createTestDb();
    await db
      .prepare("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
      .run();
    for (const migration of MIGRATIONS.filter((item) => item.version < 6)) {
      await db.batch([
        ...migration.statements.map((sql) => db.prepare(sql)),
        db
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)")
          .bind(migration.version, migration.name, "2026-11-10T00:00:00.000Z"),
      ]);
    }
    await db
      .prepare(
        `INSERT INTO meta_lead_ingestions (id, leadgen_id, origin, status, next_attempt_at, received_at, updated_at)
         VALUES ('mli_existing', '999', 'webhook', 'needs_review', 't', 't', 't')`,
      )
      .run();

    assert.deepEqual(await applyMigrations(db, "2026-11-11T00:00:00.000Z"), [6, 8, 9]);
    const columns = await db.prepare("PRAGMA table_info(demand_requirements)").all<{ name: string }>();
    assert.ok(columns.results.some((column) => column.name === "idempotency_key"));
    assert.ok(columns.results.some((column) => column.name === "origin_owner_lead_id"));
    const leadColumns = await db.prepare("PRAGMA table_info(owner_leads)").all<{ name: string }>();
    assert.ok(leadColumns.results.some((column) => column.name === "role_review"));
    assert.ok(leadColumns.results.some((column) => column.name === "role_review_note"));
    const row = await db
      .prepare("SELECT status, intent_override, resolved_by, resolved_at FROM meta_lead_ingestions WHERE id = 'mli_existing'")
      .first<{ status: string; intent_override: string; resolved_by: string; resolved_at: string | null }>();
    assert.deepEqual({ ...row }, { status: "needs_review", intent_override: "", resolved_by: "", resolved_at: null });
    assert.deepEqual(await applyMigrations(db), []);
  });

  it("keeps the audit log append-only", async () => {
    const db = createTestDb();
    await applyMigrations(db);
    await db
      .prepare(
        "INSERT INTO audit_log (id, occurred_at, actor_id, actor_email, actor_role, entity_type, entity_id, action) VALUES ('a', 't', 'x', 'x', 'x', 'property', 'p', 'create')",
      )
      .run();
    await assert.rejects(db.prepare("UPDATE audit_log SET action = 'edited'").run(), /append-only/);
    await assert.rejects(db.prepare("DELETE FROM audit_log").run(), /append-only/);
  });
});
