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
  {
    version: 5,
    name: "meta_lead_ads",
    statements: [
      `ALTER TABLE lead_sources ADD COLUMN meta_page_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE lead_sources ADD COLUMN meta_is_organic INTEGER`,
      `ALTER TABLE lead_sources ADD COLUMN ingestion_origin TEXT NOT NULL DEFAULT 'manual'`,
      `ALTER TABLE lead_sources ADD COLUMN received_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_lead_sources_form ON lead_sources (meta_form_id)`,
      `CREATE INDEX IF NOT EXISTS idx_lead_sources_ad ON lead_sources (meta_ad_id)`,
      // One row ('primary'). Tokens are AES-GCM ciphertext; the key is the META_TOKEN_KEY secret.
      `CREATE TABLE IF NOT EXISTS meta_connection (
         id TEXT PRIMARY KEY,
         status TEXT NOT NULL DEFAULT 'disconnected',
         page_id TEXT NOT NULL DEFAULT '',
         page_name TEXT NOT NULL DEFAULT '',
         meta_user_name TEXT NOT NULL DEFAULT '',
         user_token_enc TEXT NOT NULL DEFAULT '',
         user_token_expires_at TEXT,
         page_token_enc TEXT NOT NULL DEFAULT '',
         page_token_expires_at TEXT,
         data_access_expires_at TEXT,
         scopes_json TEXT NOT NULL DEFAULT '[]',
         webhook_subscribed INTEGER NOT NULL DEFAULT 0,
         connected_by TEXT,
         connected_at TEXT,
         last_checked_at TEXT,
         last_error TEXT NOT NULL DEFAULT '',
         last_webhook_at TEXT,
         last_success_at TEXT,
         updated_at TEXT NOT NULL,
         row_version INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE TABLE IF NOT EXISTS meta_forms (
         form_id TEXT PRIMARY KEY,
         page_id TEXT NOT NULL,
         name TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT '',
         locale TEXT NOT NULL DEFAULT '',
         questions_json TEXT NOT NULL DEFAULT '[]',
         classification TEXT NOT NULL DEFAULT 'unclassified',
         owner_intent TEXT NOT NULL DEFAULT '',
         mapping_json TEXT NOT NULL DEFAULT '{}',
         leads_count INTEGER,
         form_created_at TEXT,
         discovered_at TEXT NOT NULL,
         synced_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         updated_by TEXT NOT NULL,
         row_version INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE TABLE IF NOT EXISTS meta_webhook_deliveries (
         id TEXT PRIMARY KEY,
         received_at TEXT NOT NULL,
         signature_valid INTEGER NOT NULL,
         object TEXT NOT NULL DEFAULT '',
         leadgen_count INTEGER NOT NULL DEFAULT 0,
         new_count INTEGER NOT NULL DEFAULT 0,
         repeat_count INTEGER NOT NULL DEFAULT 0,
         note TEXT NOT NULL DEFAULT ''
       )`,
      `CREATE INDEX IF NOT EXISTS idx_meta_deliveries_received ON meta_webhook_deliveries (received_at)`,
      // The durable queue shared by webhook and historical imports. leadgen_id is the idempotency key.
      `CREATE TABLE IF NOT EXISTS meta_lead_ingestions (
         id TEXT PRIMARY KEY,
         leadgen_id TEXT NOT NULL UNIQUE,
         page_id TEXT NOT NULL DEFAULT '',
         form_id TEXT NOT NULL DEFAULT '',
         ad_id TEXT NOT NULL DEFAULT '',
         origin TEXT NOT NULL,
         import_job_id TEXT,
         status TEXT NOT NULL DEFAULT 'pending',
         attempts INTEGER NOT NULL DEFAULT 0,
         next_attempt_at TEXT NOT NULL,
         locked_until TEXT,
         last_error TEXT NOT NULL DEFAULT '',
         last_error_kind TEXT NOT NULL DEFAULT '',
         deliveries INTEGER NOT NULL DEFAULT 1,
         lead_created_at TEXT,
         payload_json TEXT NOT NULL DEFAULT '',
         entity_type TEXT,
         entity_id TEXT,
         contact_id TEXT,
         contact_existing INTEGER,
         received_at TEXT NOT NULL,
         processed_at TEXT,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_meta_ingestions_due ON meta_lead_ingestions (status, next_attempt_at)`,
      `CREATE INDEX IF NOT EXISTS idx_meta_ingestions_form ON meta_lead_ingestions (form_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_meta_ingestions_job ON meta_lead_ingestions (import_job_id, status)`,
      `CREATE TABLE IF NOT EXISTS meta_ingestion_events (
         id TEXT PRIMARY KEY,
         ingestion_id TEXT NOT NULL,
         occurred_at TEXT NOT NULL,
         step TEXT NOT NULL,
         outcome TEXT NOT NULL,
         message TEXT NOT NULL DEFAULT ''
       )`,
      `CREATE INDEX IF NOT EXISTS idx_meta_ingestion_events ON meta_ingestion_events (ingestion_id, occurred_at)`,
      `CREATE TABLE IF NOT EXISTS meta_import_jobs (
         id TEXT PRIMARY KEY,
         form_ids_json TEXT NOT NULL,
         since TEXT NOT NULL,
         until TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'scanning',
         cursor_json TEXT NOT NULL DEFAULT '{}',
         found INTEGER NOT NULL DEFAULT 0,
         queued INTEGER NOT NULL DEFAULT 0,
         duplicates INTEGER NOT NULL DEFAULT 0,
         last_error TEXT NOT NULL DEFAULT '',
         created_by TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         finished_at TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_meta_import_jobs_status ON meta_import_jobs (status, created_at)`,
      `CREATE TABLE IF NOT EXISTS ad_entities (
         platform TEXT NOT NULL,
         level TEXT NOT NULL,
         external_id TEXT NOT NULL,
         name TEXT NOT NULL DEFAULT '',
         parent_id TEXT NOT NULL DEFAULT '',
         first_seen_at TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         PRIMARY KEY (platform, level, external_id)
       )`,
      // Filled only from real spend reports. No row means spend is unknown, never zero.
      `CREATE TABLE IF NOT EXISTS ad_spend_daily (
         platform TEXT NOT NULL,
         level TEXT NOT NULL,
         external_id TEXT NOT NULL,
         spend_date TEXT NOT NULL,
         currency TEXT NOT NULL,
         spend_minor INTEGER NOT NULL,
         impressions INTEGER,
         clicks INTEGER,
         source TEXT NOT NULL,
         imported_at TEXT NOT NULL,
         imported_by TEXT NOT NULL,
         PRIMARY KEY (platform, level, external_id, spend_date)
       )`,
      // Current-state funnel per Meta campaign. Cost metrics divide spend_minor by these counts
      // and stay NULL while spend_minor is NULL.
      `CREATE VIEW IF NOT EXISTS campaign_lead_funnel AS
       SELECT s.meta_campaign_id AS campaign_id,
         MAX(s.meta_campaign_name) AS campaign_name,
         COUNT(*) AS leads,
         SUM(CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END) AS owner_leads,
         SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END) AS requirements,
         SUM(CASE WHEN r.status IN ('Qualified', 'Matched', 'Property shared', 'Visit scheduled', 'Visited', 'Negotiation', 'Converted')
                    OR o.status = 'Converted' THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN r.status IN ('Visited', 'Negotiation', 'Converted') THEN 1 ELSE 0 END) AS visited,
         SUM(CASE WHEN r.status = 'Converted' AND r.intent = 'Rent' THEN 1 ELSE 0 END) AS rentals,
         SUM(CASE WHEN r.status = 'Converted' AND r.intent = 'Buy' THEN 1 ELSE 0 END) AS sales,
         (SELECT SUM(d.spend_minor) FROM ad_spend_daily d
           WHERE d.platform = 'meta' AND d.level = 'campaign' AND d.external_id = s.meta_campaign_id) AS spend_minor,
         (SELECT MAX(d.currency) FROM ad_spend_daily d
           WHERE d.platform = 'meta' AND d.level = 'campaign' AND d.external_id = s.meta_campaign_id) AS currency
       FROM lead_sources s
       LEFT JOIN owner_leads o ON o.source_id = s.id
       LEFT JOIN demand_requirements r ON r.source_id = s.id
       WHERE s.meta_campaign_id != ''
       GROUP BY s.meta_campaign_id`,
    ],
  },
  {
    version: 6,
    name: "meta_intent_decision",
    statements: [
      // Staff choice for a mixed or ambiguous lead. Empty until someone clicks Import as Buy / Rent / Sale / Lease.
      `ALTER TABLE meta_lead_ingestions ADD COLUMN intent_override TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE meta_lead_ingestions ADD COLUMN resolved_by TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE meta_lead_ingestions ADD COLUMN resolved_at TEXT`,
    ],
  },
  {
    // Version 7 is reserved for another feature and is intentionally unused.
    // Production is on version 6. Do not renumber this or edit versions 1–6.
    version: 8,
    name: "owner_client_requirements",
    statements: [
      `ALTER TABLE demand_requirements ADD COLUMN idempotency_key TEXT`,
      `ALTER TABLE demand_requirements ADD COLUMN origin_owner_lead_id TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_requirements_idempotency ON demand_requirements (idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_requirements_origin_owner ON demand_requirements (origin_owner_lead_id)`,
    ],
  },
  {
    // Version 7 stays unused. Production is on version 8. Do not renumber this or edit versions 1–8.
    version: 9,
    name: "owner_lead_role_review",
    statements: [
      `ALTER TABLE owner_leads ADD COLUMN role_review TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE owner_leads ADD COLUMN role_review_note TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    // Version 7 stays unused. Production is on version 9. Do not renumber this or edit versions 1–9.
    // Empty quality_review means pending. It is never backfilled to genuine.
    version: 10,
    name: "lead_quality_review",
    statements: [
      `ALTER TABLE demand_requirements ADD COLUMN quality_review TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE demand_requirements ADD COLUMN quality_review_note TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    // Version 7 stays unused. Production is on version 10. Do not renumber versions 1–10.
    // A Marketing API rejection is stored here and must not expire the Page token.
    version: 11,
    name: "meta_user_token_error",
    statements: [`ALTER TABLE meta_connection ADD COLUMN user_token_error TEXT NOT NULL DEFAULT ''`],
  },
  {
    // Version 7 stays unused. Production is on version 10 until 11 and 12 deploy. Do not renumber versions 1–11.
    // scopes_json remains the Page token's permissions. Campaign-name reads check this list instead.
    version: 12,
    name: "meta_user_token_scopes",
    statements: [`ALTER TABLE meta_connection ADD COLUMN user_token_scopes_json TEXT NOT NULL DEFAULT '[]'`],
  },
  {
    // Version 7 stays unused. Do not renumber versions 1–12.
    // Which ad account Sync spend reads. Empty until a super admin selects one.
    version: 13,
    name: "meta_ad_account",
    statements: [
      `ALTER TABLE meta_connection ADD COLUMN ad_account_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE meta_connection ADD COLUMN ad_account_name TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    // Version 7 stays unused. Do not renumber versions 1–13.
    // A successful campaign import records the dates it fully wrote. The quality report uses this
    // instead of treating whatever spend rows fall inside a filter as the whole selected period.
    version: 14,
    name: "ad_spend_coverage",
    statements: [
      `CREATE TABLE IF NOT EXISTS ad_spend_coverage (
         platform TEXT NOT NULL,
         level TEXT NOT NULL,
         ad_account_id TEXT NOT NULL,
         covered_since TEXT NOT NULL,
         covered_until TEXT NOT NULL,
         imported_at TEXT NOT NULL,
         imported_by TEXT NOT NULL,
         PRIMARY KEY (platform, level, ad_account_id, covered_since)
       )`,
    ],
  },
  {
    // Version 7 stays unused. Do not renumber versions 1–14.
    // Agricultural land JV is its own enquiry. It is not an owner lead and it does not create a property.
    version: 15,
    name: "land_jv_enquiries",
    statements: [
      `ALTER TABLE contacts ADD COLUMN is_land_jv INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS land_jv_enquiries (
         id TEXT PRIMARY KEY,
         code TEXT NOT NULL UNIQUE,
         contact_id TEXT NOT NULL REFERENCES contacts (id),
         source_id TEXT NOT NULL UNIQUE REFERENCES lead_sources (id),
         taluk TEXT NOT NULL DEFAULT '',
         village TEXT NOT NULL DEFAULT '',
         acre_band TEXT NOT NULL DEFAULT '',
         ownership TEXT NOT NULL DEFAULT '',
         rtc_available TEXT NOT NULL DEFAULT '',
         road_access TEXT NOT NULL DEFAULT '',
         owners_agree TEXT NOT NULL DEFAULT '',
         answers_json TEXT NOT NULL DEFAULT '[]',
         notes TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'New',
         status_reason TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         created_by TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         updated_by TEXT NOT NULL,
         row_version INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE INDEX IF NOT EXISTS idx_land_jv_contact ON land_jv_enquiries (contact_id)`,
      `CREATE INDEX IF NOT EXISTS idx_land_jv_status ON land_jv_enquiries (status, created_at)`,
    ],
  },
  {
    // Version 7 stays unused. Do not renumber versions 1–15.
    // Verified village is staff-entered. The original Meta village answer stays in `village` and answers_json.
    // Buyer recovery runs are a separate audit from historical import jobs.
    version: 16,
    name: "verified_village_and_buyer_recovery",
    statements: [
      `ALTER TABLE land_jv_enquiries ADD COLUMN verified_village TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE land_jv_enquiries ADD COLUMN additional_phone_e164 TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE meta_lead_ingestions ADD COLUMN recovery_run_id TEXT NOT NULL DEFAULT ''`,
      `CREATE INDEX IF NOT EXISTS idx_meta_ingestions_recovery ON meta_lead_ingestions (recovery_run_id, status)`,
      `CREATE TABLE IF NOT EXISTS meta_buyer_recovery_runs (
         id TEXT PRIMARY KEY,
         status TEXT NOT NULL,
         form_ids_json TEXT NOT NULL,
         preview_json TEXT NOT NULL DEFAULT '{}',
         created_by TEXT NOT NULL,
         created_at TEXT NOT NULL,
         confirmed_at TEXT,
         finished_at TEXT,
         enqueue_duplicates INTEGER NOT NULL DEFAULT 0,
         imported INTEGER NOT NULL DEFAULT 0,
         duplicates INTEGER NOT NULL DEFAULT 0,
         held INTEGER NOT NULL DEFAULT 0,
         failed INTEGER NOT NULL DEFAULT 0,
         last_error TEXT NOT NULL DEFAULT '',
         updated_at TEXT NOT NULL
       )`,
    ],
  },
  {
    // Website enquiries keep acquisition separate from the Meta lead source row.
    version: 17,
    name: "website_enquiry_attribution",
    statements: [
      `CREATE TABLE IF NOT EXISTS acquisition_attributions (
         id TEXT PRIMARY KEY,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         first_source TEXT NOT NULL,
         first_medium TEXT NOT NULL DEFAULT '',
         first_campaign TEXT NOT NULL DEFAULT '',
         first_campaign_id TEXT NOT NULL DEFAULT '',
         first_term TEXT NOT NULL DEFAULT '',
         first_content TEXT NOT NULL DEFAULT '',
         first_landing_page TEXT NOT NULL DEFAULT '',
         first_referrer TEXT NOT NULL DEFAULT '',
         first_referrer_domain TEXT NOT NULL DEFAULT '',
         first_seen_at TEXT NOT NULL,
         last_source TEXT NOT NULL,
         last_medium TEXT NOT NULL DEFAULT '',
         last_campaign TEXT NOT NULL DEFAULT '',
         last_campaign_id TEXT NOT NULL DEFAULT '',
         last_term TEXT NOT NULL DEFAULT '',
         last_content TEXT NOT NULL DEFAULT '',
         last_landing_page TEXT NOT NULL DEFAULT '',
         last_referrer TEXT NOT NULL DEFAULT '',
         last_referrer_domain TEXT NOT NULL DEFAULT '',
         last_seen_at TEXT NOT NULL,
         referrer_domain TEXT NOT NULL DEFAULT '',
         enquiry_page TEXT NOT NULL DEFAULT '',
         conversion_channel TEXT NOT NULL,
         cta_placement TEXT NOT NULL DEFAULT '',
         property_slug TEXT NOT NULL DEFAULT '',
         property_title TEXT NOT NULL DEFAULT '',
         listing_intent TEXT NOT NULL DEFAULT '',
         listing_locality TEXT NOT NULL DEFAULT '',
         gclid TEXT NOT NULL DEFAULT '',
         gbraid TEXT NOT NULL DEFAULT '',
         wbraid TEXT NOT NULL DEFAULT '',
         fbclid TEXT NOT NULL DEFAULT '',
         fbp TEXT NOT NULL DEFAULT '',
         fbc TEXT NOT NULL DEFAULT '',
         marketing_consent INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_acquisition_entity ON acquisition_attributions (entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_acquisition_last_source ON acquisition_attributions (last_source, created_at)`,
      `CREATE TABLE IF NOT EXISTS public_enquiry_keys (
         id TEXT PRIMARY KEY,
         idempotency_key TEXT NOT NULL UNIQUE,
         kind TEXT NOT NULL,
         entity_type TEXT NOT NULL DEFAULT '',
         entity_id TEXT NOT NULL DEFAULT '',
         entity_code TEXT NOT NULL DEFAULT '',
         planned_entity_id TEXT NOT NULL DEFAULT '',
         planned_entity_code TEXT NOT NULL DEFAULT '',
         claim_token TEXT NOT NULL DEFAULT '',
         claim_expires TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS public_enquiry_attempts (
         id TEXT PRIMARY KEY,
         ip_hash TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_enquiry_attempts_ip ON public_enquiry_attempts (ip_hash, created_at)`,
    ],
  },
  {
    // A first touch is verified only when the signed attribution cookie was present.
    version: 18,
    name: "enquiry_first_touch_verified",
    statements: [
      `ALTER TABLE acquisition_attributions ADD COLUMN first_touch_verified INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    // Optional answers that depend on intent and property type. Existing rows stay {}.
    version: 19,
    name: "requirement_preference_details",
    statements: [
      `ALTER TABLE demand_requirements ADD COLUMN preference_details_json TEXT NOT NULL DEFAULT '{}'`,
    ],
  },
  {
    // Urgency cycles and client timeline revisions. Existing requirements are not backfilled.
    version: 20,
    name: "requirement_timeline_urgency",
    statements: [
      `ALTER TABLE demand_requirements ADD COLUMN confirmed_timeline TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE demand_requirements ADD COLUMN confirmed_needed_by TEXT`,
      `CREATE TABLE IF NOT EXISTS requirement_timeline_revisions (
         id TEXT PRIMARY KEY,
         requirement_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         previous_timeline TEXT NOT NULL,
         new_timeline TEXT NOT NULL,
         previous_needed_by TEXT,
         new_needed_by TEXT,
         reason TEXT NOT NULL,
         notes TEXT NOT NULL DEFAULT '',
         confirmation_method TEXT NOT NULL,
         actor_id TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_revisions_requirement ON requirement_timeline_revisions (requirement_id, created_at)`,
      `CREATE TRIGGER IF NOT EXISTS requirement_timeline_revisions_no_update BEFORE UPDATE ON requirement_timeline_revisions
       BEGIN SELECT RAISE(ABORT, 'requirement_timeline_revisions is append-only'); END`,
      `CREATE TRIGGER IF NOT EXISTS requirement_timeline_revisions_no_delete BEFORE DELETE ON requirement_timeline_revisions
       BEGIN SELECT RAISE(ABORT, 'requirement_timeline_revisions is append-only'); END`,
      `CREATE TABLE IF NOT EXISTS requirement_urgency_cycles (
         id TEXT PRIMARY KEY,
         requirement_id TEXT NOT NULL,
         revision_id TEXT,
         cycle_start TEXT NOT NULL,
         timeline TEXT NOT NULL,
         target_date TEXT,
         closed_at TEXT,
         closure_reason TEXT NOT NULL DEFAULT '',
         urgency_band TEXT NOT NULL DEFAULT '',
         overdue INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_urgency_cycles_requirement ON requirement_urgency_cycles (requirement_id, cycle_start)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_urgency_cycles_open ON requirement_urgency_cycles (requirement_id) WHERE closed_at IS NULL`,
      `CREATE TRIGGER IF NOT EXISTS requirement_urgency_cycles_no_delete BEFORE DELETE ON requirement_urgency_cycles
       BEGIN SELECT RAISE(ABORT, 'requirement_urgency_cycles cannot be deleted'); END`,
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
