import type { SqlDb } from "./sql";

export type Migration = {
  version: number;
  name: string;
  statements: string[];
};

const PROPERTY_LIFECYCLE_COLUMNS = [
  "id TEXT",
  "code TEXT",
  "verification_status TEXT NOT NULL DEFAULT 'Draft'",
  "publication_status TEXT NOT NULL DEFAULT 'Unpublished'",
  "discreet_matching INTEGER NOT NULL DEFAULT 0",
  "verified_at TEXT",
  "verified_by TEXT",
  "rejection_reason TEXT NOT NULL DEFAULT ''",
  "availability_verified_at TEXT",
  "availability_verified_by TEXT",
  "availability_valid_days INTEGER NOT NULL DEFAULT 0",
  "availability_expires_at TEXT",
  "owner_contact_id TEXT",
  "source_owner_lead_id TEXT",
  "internal_notes TEXT NOT NULL DEFAULT ''",
  "created_at TEXT",
  "created_by TEXT",
  "updated_by TEXT",
  "published_by TEXT",
  "first_published_at TEXT",
  "archived_at TEXT",
  "row_version INTEGER NOT NULL DEFAULT 1",
];

/**
 * The only rows the public site may read. Rented and Sold stay visible with
 * their badges, as before the CRM existed.
 */
export const PUBLIC_PROPERTIES_VIEW = `CREATE VIEW IF NOT EXISTS public_properties AS
  SELECT * FROM properties
  WHERE verification_status = 'Verified'
    AND publication_status = 'Published'
    AND status IN ('Available', 'Rented', 'Sold')`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "properties_baseline",
    statements: [
      `CREATE TABLE IF NOT EXISTS properties (slug TEXT PRIMARY KEY, title TEXT NOT NULL, listing TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Available', property_type TEXT NOT NULL, bhk INTEGER, price INTEGER NOT NULL DEFAULT 0, price_suffix TEXT NOT NULL DEFAULT '', area INTEGER NOT NULL DEFAULT 0, locality TEXT NOT NULL, city TEXT NOT NULL DEFAULT 'Gulbarga', facing TEXT NOT NULL DEFAULT 'East', vastu INTEGER NOT NULL DEFAULT 0, vegetarian TEXT NOT NULL DEFAULT 'Not Required', bachelors TEXT NOT NULL DEFAULT 'Allowed', family TEXT NOT NULL DEFAULT 'Allowed', parking TEXT NOT NULL DEFAULT '', bathrooms INTEGER NOT NULL DEFAULT 0, furnished TEXT NOT NULL DEFAULT 'Unfurnished', featured INTEGER NOT NULL DEFAULT 0, is_new INTEGER NOT NULL DEFAULT 1, cover_image TEXT NOT NULL DEFAULT '', gallery_json TEXT NOT NULL DEFAULT '[]', videos_json TEXT NOT NULL DEFAULT '[]', published_at TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', amenities_json TEXT NOT NULL DEFAULT '[]', rules_json TEXT NOT NULL DEFAULT '[]', nearby_json TEXT NOT NULL DEFAULT '{}', faq_json TEXT NOT NULL DEFAULT '[]', map_query TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_listing ON properties (listing)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_locality ON properties (locality)`,
    ],
  },
  {
    version: 2,
    name: "property_lifecycle",
    statements: [
      ...PROPERTY_LIFECYCLE_COLUMNS.map(
        (column) => `ALTER TABLE properties ADD COLUMN ${column}`,
      ),
      // Listings that were live before the CRM stay live. Availability is left
      // unconfirmed, so they are public but not matchable until rechecked.
      `UPDATE properties SET
         id = 'prp_' || lower(hex(randomblob(10))),
         code = 'GH-P' || printf('%04d', (SELECT COUNT(*) FROM properties AS earlier WHERE earlier.slug <= properties.slug)),
         verification_status = 'Verified',
         publication_status = 'Published',
         verified_at = updated_at,
         verified_by = 'migration',
         created_at = COALESCE(published_at, updated_at),
         created_by = 'migration',
         updated_by = 'migration',
         published_by = 'migration',
         first_published_at = published_at
       WHERE id IS NULL`,
      `INSERT INTO app_meta (key, value) VALUES ('seq_property', (SELECT CAST(COUNT(*) AS TEXT) FROM properties))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_id ON properties (id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_code ON properties (code)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_verification ON properties (verification_status)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_publication ON properties (publication_status)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_availability_expiry ON properties (availability_expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties (owner_contact_id)`,
      PUBLIC_PROPERTIES_VIEW,
    ],
  },
  {
    version: 3,
    name: "admin_and_audit",
    statements: [
      `CREATE TABLE IF NOT EXISTS admin_users (
         id TEXT PRIMARY KEY,
         email TEXT NOT NULL COLLATE NOCASE UNIQUE,
         name TEXT NOT NULL,
         role TEXT NOT NULL,
         password_hash TEXT NOT NULL,
         password_salt TEXT NOT NULL,
         password_iterations INTEGER NOT NULL,
         active INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         last_login_at TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS audit_log (
         id TEXT PRIMARY KEY,
         occurred_at TEXT NOT NULL,
         actor_id TEXT NOT NULL,
         actor_email TEXT NOT NULL,
         actor_role TEXT NOT NULL,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         entity_label TEXT NOT NULL DEFAULT '',
         action TEXT NOT NULL,
         changes_json TEXT NOT NULL DEFAULT '{}',
         context_json TEXT NOT NULL DEFAULT '{}'
       )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id, occurred_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id, occurred_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_log (occurred_at)`,
      `CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
       BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
      `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
       BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
    ],
  },
  {
    version: 4,
    name: "crm_core",
    statements: [
      `CREATE TABLE IF NOT EXISTS lead_sources (
         id TEXT PRIMARY KEY,
         channel TEXT NOT NULL,
         platform TEXT NOT NULL DEFAULT '',
         meta_lead_id TEXT,
         meta_form_id TEXT NOT NULL DEFAULT '',
         meta_form_name TEXT NOT NULL DEFAULT '',
         meta_campaign_id TEXT NOT NULL DEFAULT '',
         meta_campaign_name TEXT NOT NULL DEFAULT '',
         meta_adset_id TEXT NOT NULL DEFAULT '',
         meta_adset_name TEXT NOT NULL DEFAULT '',
         meta_ad_id TEXT NOT NULL DEFAULT '',
         meta_ad_name TEXT NOT NULL DEFAULT '',
         utm_source TEXT NOT NULL DEFAULT '',
         utm_medium TEXT NOT NULL DEFAULT '',
         utm_campaign TEXT NOT NULL DEFAULT '',
         utm_content TEXT NOT NULL DEFAULT '',
         utm_term TEXT NOT NULL DEFAULT '',
         submitted_at TEXT NOT NULL,
         raw_payload_json TEXT NOT NULL DEFAULT '{}',
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_sources_meta_lead ON lead_sources (meta_lead_id) WHERE meta_lead_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_lead_sources_campaign ON lead_sources (meta_campaign_id)`,
      `CREATE TABLE IF NOT EXISTS contacts (
         id TEXT PRIMARY KEY,
         code TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         phone_e164 TEXT NOT NULL UNIQUE,
         alt_phone_e164 TEXT NOT NULL DEFAULT '',
         whatsapp_e164 TEXT NOT NULL DEFAULT '',
         email TEXT NOT NULL DEFAULT '',
         language TEXT NOT NULL DEFAULT '',
         is_owner INTEGER NOT NULL DEFAULT 0,
         is_seeker INTEGER NOT NULL DEFAULT 0,
         do_not_contact INTEGER NOT NULL DEFAULT 0,
         do_not_contact_reason TEXT NOT NULL DEFAULT '',
         notes TEXT NOT NULL DEFAULT '',
         merged_into_id TEXT,
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         updated_by TEXT NOT NULL,
         row_version INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name)`,
      `CREATE TABLE IF NOT EXISTS owner_leads (
         id TEXT PRIMARY KEY,
         code TEXT NOT NULL UNIQUE,
         contact_id TEXT NOT NULL REFERENCES contacts (id),
         source_id TEXT REFERENCES lead_sources (id),
         intent TEXT NOT NULL,
         property_type TEXT NOT NULL DEFAULT '',
         locality TEXT NOT NULL DEFAULT '',
         location_text TEXT NOT NULL DEFAULT '',
         expected_price INTEGER,
         notes TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'New',
         status_reason TEXT NOT NULL DEFAULT '',
         priority TEXT NOT NULL DEFAULT 'Warm',
         assigned_to TEXT,
         next_followup_at TEXT,
         last_contacted_at TEXT,
         converted_at TEXT,
         converted_by TEXT,
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         updated_by TEXT NOT NULL,
         row_version INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE INDEX IF NOT EXISTS idx_owner_leads_status ON owner_leads (status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_owner_leads_contact ON owner_leads (contact_id)`,
      `CREATE TABLE IF NOT EXISTS demand_requirements (
         id TEXT PRIMARY KEY,
         code TEXT NOT NULL UNIQUE,
         contact_id TEXT NOT NULL REFERENCES contacts (id),
         source_id TEXT REFERENCES lead_sources (id),
         intent TEXT NOT NULL,
         property_types_json TEXT NOT NULL DEFAULT '[]',
         bhk_min INTEGER,
         bhk_max INTEGER,
         budget_min INTEGER,
         budget_max INTEGER,
         localities_json TEXT NOT NULL DEFAULT '[]',
         locality_flexible INTEGER NOT NULL DEFAULT 0,
         area_min INTEGER,
         furnishing TEXT NOT NULL DEFAULT 'Any',
         tenant_profile TEXT NOT NULL DEFAULT 'Any',
         vegetarian TEXT NOT NULL DEFAULT 'Any',
         parking_required INTEGER NOT NULL DEFAULT 0,
         timeline TEXT NOT NULL DEFAULT 'Exploring',
         needed_by TEXT,
         notes TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'New',
         status_reason TEXT NOT NULL DEFAULT '',
         priority_override TEXT NOT NULL DEFAULT '',
         assigned_to TEXT,
         next_followup_at TEXT,
         last_contacted_at TEXT,
         outcome TEXT NOT NULL DEFAULT '',
         closed_at TEXT,
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         updated_by TEXT NOT NULL,
         row_version INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE INDEX IF NOT EXISTS idx_requirements_status ON demand_requirements (status, timeline)`,
      `CREATE INDEX IF NOT EXISTS idx_requirements_contact ON demand_requirements (contact_id)`,
      `CREATE TABLE IF NOT EXISTS activities (
         id TEXT PRIMARY KEY,
         occurred_at TEXT NOT NULL,
         actor_id TEXT NOT NULL,
         contact_id TEXT,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         direction TEXT NOT NULL DEFAULT 'outbound',
         outcome TEXT NOT NULL DEFAULT '',
         body TEXT NOT NULL DEFAULT '',
         duration_seconds INTEGER,
         channel TEXT NOT NULL DEFAULT 'manual',
         external_id TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities (entity_type, entity_id, occurred_at)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities (contact_id, occurred_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external ON activities (external_id) WHERE external_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS followups (
         id TEXT PRIMARY KEY,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         contact_id TEXT,
         due_at TEXT NOT NULL,
         reason TEXT NOT NULL,
         priority TEXT NOT NULL DEFAULT 'Normal',
         assigned_to TEXT,
         status TEXT NOT NULL DEFAULT 'Open',
         completed_at TEXT,
         completed_by TEXT,
         outcome_note TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_followups_due ON followups (status, due_at)`,
      `CREATE INDEX IF NOT EXISTS idx_followups_entity ON followups (entity_type, entity_id)`,
    ],
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

async function appliedVersions(db: SqlDb): Promise<Set<number>> {
  const { results } = await db
    .prepare("SELECT version FROM schema_migrations")
    .all<{ version: number }>();
  return new Set(results.map((row) => Number(row.version)));
}

/**
 * Apply pending migrations in order. Each migration runs as a single batch, so
 * it lands completely or not at all. When two Worker isolates race, the loser's
 * batch fails (duplicate column or version) and is ignored once the winner's
 * version is recorded.
 */
export async function applyMigrations(db: SqlDb, now = new Date().toISOString()): Promise<number[]> {
  await db.prepare(MIGRATIONS_TABLE).run();
  const done = await appliedVersions(db);
  const applied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue;
    const statements = [
      ...migration.statements.map((sql) => db.prepare(sql)),
      db
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)")
        .bind(migration.version, migration.name, now),
    ];
    try {
      await db.batch(statements);
      applied.push(migration.version);
    } catch (error) {
      const after = await appliedVersions(db);
      if (!after.has(migration.version)) throw error;
    }
  }

  return applied;
}
