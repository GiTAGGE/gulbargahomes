import type { Property } from "../types";
import { applyMigrations } from "./migrations";
import { contentColumns, insertSql } from "./property-rows";
import { formatCode, newId, nextSequence, type SqlDb } from "./sql";

export const SEED_ACTOR = "seed";

/**
 * The MDX snapshot is what the site published before the database existed, so
 * seeded rows go straight to Verified + Published. Availability is left
 * unconfirmed: they are public but not matchable until staff recheck them.
 */
export async function seedPublishedProperties(db: SqlDb, properties: Property[], now: string) {
  for (const property of properties) {
    const sequence = await nextSequence(db, "seq_property");
    const { sql, values } = insertSql("properties", {
      ...contentColumns(property),
      status: property.status,
      updated_at: now,
      id: newId("prp"),
      code: formatCode("GH-P", sequence),
      verification_status: "Verified",
      publication_status: "Published",
      verified_at: now,
      verified_by: SEED_ACTOR,
      created_at: property.publishedAt,
      created_by: SEED_ACTOR,
      updated_by: SEED_ACTOR,
      published_by: SEED_ACTOR,
      first_published_at: property.publishedAt,
    });
    await db
      .prepare(`${sql} ON CONFLICT(slug) DO NOTHING`)
      .bind(...values)
      .run();
  }
}

export async function prepareDatabase(
  db: SqlDb,
  loadSeed: () => Property[],
  now = new Date().toISOString(),
): Promise<void> {
  await applyMigrations(db, now);

  const seeded = await db
    .prepare("SELECT value FROM app_meta WHERE key = 'properties_seeded'")
    .first<{ value: string }>();
  if (seeded?.value === "1") return;

  await seedPublishedProperties(db, loadSeed(), now);
  await db
    .prepare(
      "INSERT INTO app_meta (key, value) VALUES ('properties_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
    )
    .run();
}
