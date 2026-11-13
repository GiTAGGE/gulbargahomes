import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyMigrations, LATEST_SCHEMA_VERSION, MIGRATIONS } from "../lib/db/migrations";
import { prepareDatabase } from "../lib/db/prepare";
import { getRequirement } from "../lib/crm/requirements";
import { requirementDetailFields } from "../lib/enquiry/questions";
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

    assert.deepEqual(await applyMigrations(db, "2026-11-11T00:00:00.000Z"), [6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const connectionColumns = await db.prepare("PRAGMA table_info(meta_connection)").all<{ name: string }>();
    assert.ok(connectionColumns.results.some((column) => column.name === "user_token_error"));
    assert.ok(connectionColumns.results.some((column) => column.name === "user_token_scopes_json"));
    assert.ok(connectionColumns.results.some((column) => column.name === "ad_account_id"));
    assert.ok(connectionColumns.results.some((column) => column.name === "ad_account_name"));
    const land = await db.prepare("PRAGMA table_info(land_jv_enquiries)").all<{ name: string }>();
    assert.ok(land.results.some((column) => column.name === "acre_band"));
    assert.ok(land.results.some((column) => column.name === "answers_json"));
    assert.ok(land.results.some((column) => column.name === "verified_village"));
    assert.ok(land.results.some((column) => column.name === "additional_phone_e164"));
    const recovery = await db.prepare("PRAGMA table_info(meta_buyer_recovery_runs)").all<{ name: string }>();
    assert.ok(recovery.results.some((column) => column.name === "preview_json"));
    const ingestionColumns = await db.prepare("PRAGMA table_info(meta_lead_ingestions)").all<{ name: string }>();
    assert.ok(ingestionColumns.results.some((column) => column.name === "recovery_run_id"));
    const contactColumns = await db.prepare("PRAGMA table_info(contacts)").all<{ name: string }>();
    assert.ok(contactColumns.results.some((column) => column.name === "is_land_jv"));
    const coverage = await db.prepare("PRAGMA table_info(ad_spend_coverage)").all<{ name: string }>();
    assert.ok(coverage.results.some((column) => column.name === "covered_since"));
    assert.ok(coverage.results.some((column) => column.name === "covered_until"));
    const columns = await db.prepare("PRAGMA table_info(demand_requirements)").all<{ name: string }>();
    assert.ok(columns.results.some((column) => column.name === "idempotency_key"));
    assert.ok(columns.results.some((column) => column.name === "origin_owner_lead_id"));
    const leadColumns = await db.prepare("PRAGMA table_info(owner_leads)").all<{ name: string }>();
    assert.ok(leadColumns.results.some((column) => column.name === "role_review"));
    assert.ok(leadColumns.results.some((column) => column.name === "role_review_note"));
    assert.ok(columns.results.some((column) => column.name === "quality_review"));
    assert.ok(columns.results.some((column) => column.name === "quality_review_note"));
    assert.ok(columns.results.some((column) => column.name === "preference_details_json"));
    const row = await db
      .prepare("SELECT status, intent_override, resolved_by, resolved_at FROM meta_lead_ingestions WHERE id = 'mli_existing'")
      .first<{ status: string; intent_override: string; resolved_by: string; resolved_at: string | null }>();
    assert.deepEqual({ ...row }, { status: "needs_review", intent_override: "", resolved_by: "", resolved_at: null });
    assert.deepEqual(await applyMigrations(db), []);
  });

  it("migration 16 adds empty staff fields and leaves land answers, owner leads and spend unchanged", async () => {
    const db = createTestDb();
    await db
      .prepare("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
      .run();
    for (const migration of MIGRATIONS.filter((item) => item.version < 16)) {
      await db.batch([
        ...migration.statements.map((sql) => db.prepare(sql)),
        db
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)")
          .bind(migration.version, migration.name, "2026-11-12T00:00:00.000Z"),
      ]);
    }
    await db
      .prepare(
        `INSERT INTO contacts (id, code, name, phone_e164, created_at, created_by, updated_at, updated_by)
         VALUES ('con_land', 'GH-C1', 'Existing Land', '+919111111111', 't', 'a', 't', 'a'),
                ('con_owner', 'GH-C2', 'Existing Owner', '+919000000001', 't', 'a', 't', 'a')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO lead_sources (id, channel, submitted_at, created_at, created_by)
         VALUES ('src_land', 'meta_lead_form', 't', 't', 'a'),
                ('src_owner', 'meta_lead_form', 't', 't', 'a')`,
      )
      .run();
    const village = "Subhash village near the tank, call 9845012347";
    const answers = JSON.stringify([{ key: "village", label: "Village", value: village }]);
    await db
      .prepare(
        `INSERT INTO land_jv_enquiries (id, code, contact_id, source_id, taluk, village, answers_json, notes, created_at, created_by, updated_at, updated_by)
         VALUES ('ljv_existing', 'GH-L1', 'con_land', 'src_land', 'Aland', ?1, ?2, 'keep', 't', 'a', 't', 'a')`,
      )
      .bind(village, answers)
      .run();
    await db
      .prepare(
        `INSERT INTO owner_leads (id, code, contact_id, intent, notes, status, created_at, created_by, updated_at, updated_by)
         VALUES ('own_existing', 'GH-O1', 'con_owner', 'Rent', 'owner-note', 'New', 't', 'a', 't', 'a')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO ad_spend_daily (platform, level, external_id, spend_date, currency, spend_minor, source, imported_at, imported_by)
         VALUES ('meta', 'campaign', '120257140076410091', '2026-11-01', 'INR', 373046, 'meta_insights', 't', 'a')`,
      )
      .run();
    const propertiesBefore = Number((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n);

    assert.deepEqual(await applyMigrations(db, "2026-11-12T01:00:00.000Z"), [16, 17, 18, 19, 20]);

    const land = await db
      .prepare("SELECT village, answers_json, notes, verified_village, additional_phone_e164 FROM land_jv_enquiries WHERE id = 'ljv_existing'")
      .first<{ village: string; answers_json: string; notes: string; verified_village: string; additional_phone_e164: string }>();
    assert.equal(land?.village, village);
    assert.equal(land?.answers_json, answers);
    assert.equal(land?.notes, "keep");
    assert.equal(land?.verified_village, "");
    assert.equal(land?.additional_phone_e164, "");
    const owner = await db.prepare("SELECT intent, notes, status FROM owner_leads WHERE id = 'own_existing'").first<{ intent: string; notes: string; status: string }>();
    assert.equal(owner?.intent, "Rent");
    assert.equal(owner?.notes, "owner-note");
    assert.equal(owner?.status, "New");
    const spend = await db.prepare("SELECT spend_minor, currency FROM ad_spend_daily").first<{ spend_minor: number; currency: string }>();
    assert.equal(Number(spend?.spend_minor), 373046);
    assert.equal(spend?.currency, "INR");
    const propertiesAfter = Number((await db.prepare("SELECT COUNT(*) AS n FROM properties").first<{ n: number }>())?.n);
    assert.equal(propertiesAfter, propertiesBefore);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM acquisition_attributions").first<{ n: number }>())?.n), 0);
  });

  it("migration 19 adds preference details without changing an existing requirement", async () => {
    const db = createTestDb();
    await db
      .prepare("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
      .run();
    for (const migration of MIGRATIONS.filter((item) => item.version < 19)) {
      await db.batch([
        ...migration.statements.map((sql) => db.prepare(sql)),
        db
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)")
          .bind(migration.version, migration.name, "2026-11-13T00:00:00.000Z"),
      ]);
    }
    await db
      .prepare(
        `INSERT INTO contacts (id, code, name, phone_e164, created_at, created_by, updated_at, updated_by)
         VALUES ('con_before', 'GH-C0099', 'Before Nineteen', '+919845012196', 't', 'a', 't', 'a')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO demand_requirements (
           id, code, contact_id, intent, property_types_json, bhk_min, bhk_max, localities_json,
           furnishing, tenant_profile, vegetarian, parking_required, area_min, timeline, notes,
           created_at, created_by, updated_at, updated_by
         ) VALUES (
           'req_before', 'GH-D0099', 'con_before', 'Rent', '["Flat"]', 2, 3, '["High Court"]',
           'Fully Furnished', 'Family', 'Yes', 1, 900, 'Within 7 days', 'Needs a puja room',
           't', 'a', 't', 'a'
         )`,
      )
      .run();

    assert.deepEqual(await applyMigrations(db, "2026-11-13T01:00:00.000Z"), [19, 20]);
    const row = await db
      .prepare(
        `SELECT vegetarian, furnishing, tenant_profile, notes, bhk_min, area_min, parking_required, preference_details_json
         FROM demand_requirements WHERE id = 'req_before'`,
      )
      .first<{
        vegetarian: string;
        furnishing: string;
        tenant_profile: string;
        notes: string;
        bhk_min: number;
        area_min: number;
        parking_required: number;
        preference_details_json: string;
      }>();
    assert.equal(row?.vegetarian, "Yes");
    assert.equal(row?.furnishing, "Fully Furnished");
    assert.equal(row?.tenant_profile, "Family");
    assert.equal(row?.notes, "Needs a puja room");
    assert.equal(row?.bhk_min, 2);
    assert.equal(row?.area_min, 900);
    assert.equal(row?.parking_required, 1);
    assert.equal(row?.preference_details_json, "{}");
    assert.deepEqual(await applyMigrations(db), []);

    const loaded = await getRequirement(db, "req_before");
    const fields = requirementDetailFields({ ...loaded!, budgetText: "rent", neededByText: "—", lastContactedText: "—" });
    assert.equal(fields.find((field) => field.label === "Vegetarian")?.value, "Yes");
    assert.equal(fields.find((field) => field.label === "Furnishing")?.value, "Fully Furnished");
    assert.equal(fields.find((field) => field.label === "Tenant profile")?.value, "Family");
    assert.equal(fields.find((field) => field.label === "Parking")?.value, "Required");
    assert.equal(fields.find((field) => field.label === "Min area")?.value, "900 sqft");
    assert.equal(fields.find((field) => field.label === "BHK")?.value, "2–3");
    assert.equal(loaded?.notes, "Needs a puja room");
  });

  it("migration 20 adds timeline tables without writing cycles for an existing requirement", async () => {
    const db = createTestDb();
    await db
      .prepare("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
      .run();
    for (const migration of MIGRATIONS.filter((item) => item.version < 20)) {
      await db.batch([
        ...migration.statements.map((sql) => db.prepare(sql)),
        db
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)")
          .bind(migration.version, migration.name, "2026-11-13T00:00:00.000Z"),
      ]);
    }
    await db
      .prepare(
        `INSERT INTO contacts (id, code, name, phone_e164, created_at, created_by, updated_at, updated_by)
         VALUES ('con_cycle', 'GH-C0097', 'Before Cycles', '+919845012197', '2026-10-01T00:00:00.000Z', 'a', '2026-10-01T00:00:00.000Z', 'a')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO demand_requirements (
           id, code, contact_id, intent, timeline, needed_by, notes, created_at, created_by, updated_at, updated_by
         ) VALUES (
           'req_cycle', 'GH-D0097', 'con_cycle', 'Rent', 'Within 30 days', '2026-10-20T18:29:59.999Z', 'Keep me',
           '2026-10-01T00:00:00.000Z', 'a', '2026-10-01T00:00:00.000Z', 'a'
         )`,
      )
      .run();

    assert.deepEqual(await applyMigrations(db, "2026-11-13T01:00:00.000Z"), [20]);
    const row = await db
      .prepare(
        `SELECT timeline, needed_by, notes, created_at, confirmed_timeline, confirmed_needed_by
         FROM demand_requirements WHERE id = 'req_cycle'`,
      )
      .first<{
        timeline: string;
        needed_by: string;
        notes: string;
        created_at: string;
        confirmed_timeline: string;
        confirmed_needed_by: string | null;
      }>();
    assert.equal(row?.timeline, "Within 30 days");
    assert.equal(row?.needed_by, "2026-10-20T18:29:59.999Z");
    assert.equal(row?.notes, "Keep me");
    assert.equal(row?.created_at, "2026-10-01T00:00:00.000Z");
    assert.equal(row?.confirmed_timeline, "");
    assert.equal(row?.confirmed_needed_by, null);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM requirement_urgency_cycles").first<{ n: number }>())?.n), 0);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM requirement_timeline_revisions").first<{ n: number }>())?.n), 0);
    assert.deepEqual(await applyMigrations(db), []);

    const loaded = await getRequirement(db, "req_cycle", new Date("2026-11-13T01:00:00.000Z"));
    assert.equal(loaded?.timeline, "Within 30 days");
    assert.equal(loaded?.neededBy, "2026-10-20T18:29:59.999Z");
    assert.equal(loaded?.createdAt, "2026-10-01T00:00:00.000Z");
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
