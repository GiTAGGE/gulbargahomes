/**
 * Manual erasure, run by a super admin outside the app (there is no erasure
 * screen yet). `npm run erasure:sql -- GH-C0001 --by owner@example.com` prints
 * SQL for `wrangler d1 execute`; see docs/data-erasure-runbook.md.
 *
 * Keeps the record skeleton (ids, codes, statuses, the Meta lead id that stops
 * the same form being imported again) and removes what identifies the person.
 * audit_log is append-only by trigger, so earlier entries keep the name and
 * number as first recorded; a new entry records that the erasure happened.
 */

export const RETENTION_MONTHS = 12;
export const ERASURE_ACTOR = "erasure";

const CONTACT_CODE = /^GH-C\d{4,}$/;
const EMAIL = /^[^\s@']+@[^\s@']+\.[^\s@']+$/;
const ERASED_REASON = "Personal data erased on request";

export function isContactCode(value: string): boolean {
  return CONTACT_CODE.test(value);
}

/** SQL statements, in order, that anonymise one contact and anything merged into it. */
export function erasureStatements(code: string, by: string, at: string): string[] {
  if (!isContactCode(code)) throw new Error(`Not a contact code: ${code}`);
  if (!EMAIL.test(by)) throw new Error("Pass the super admin's email with --by.");
  if (Number.isNaN(Date.parse(at))) throw new Error("Bad timestamp");

  const target = `(SELECT id FROM contacts WHERE code = '${code}' OR merged_into_id IN (SELECT id FROM contacts WHERE code = '${code}'))`;
  const owned = `(SELECT id FROM owner_leads WHERE contact_id IN ${target} UNION SELECT id FROM demand_requirements WHERE contact_id IN ${target})`;
  const sources = `(SELECT source_id FROM owner_leads WHERE contact_id IN ${target} UNION SELECT source_id FROM demand_requirements WHERE contact_id IN ${target})`;
  // Held leads have no contact yet; match their stored answers on the 10 digits as typed without spaces.
  const ingestions = `(SELECT id FROM meta_lead_ingestions
      WHERE contact_id IN ${target}
         OR leadgen_id IN (SELECT meta_lead_id FROM lead_sources WHERE id IN ${sources} AND meta_lead_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM contacts c WHERE c.id IN ${target} AND length(c.phone_e164) >= 10
                    AND instr(meta_lead_ingestions.payload_json, substr(c.phone_e164, -10)) > 0))`;

  return [
    `UPDATE meta_ingestion_events SET message = '' WHERE ingestion_id IN ${ingestions}`,
    `UPDATE meta_lead_ingestions SET payload_json = '', last_error = '', updated_at = '${at}' WHERE id IN ${ingestions}`,
    `UPDATE lead_sources SET raw_payload_json = '{}' WHERE id IN ${sources}`,
    `UPDATE activities SET body = '' WHERE contact_id IN ${target} OR entity_id IN ${owned}`,
    `UPDATE followups SET reason = 'Erased', outcome_note = '',
       status = CASE WHEN status = 'Open' THEN 'Cancelled' ELSE status END
     WHERE contact_id IN ${target} OR entity_id IN ${owned}`,
    `UPDATE owner_leads SET notes = '', location_text = '', status_reason = '${ERASED_REASON}', role_review_note = '', next_followup_at = NULL,
       status = CASE WHEN status IN ('New', 'Contacted', 'Details pending') THEN 'Not interested' ELSE status END,
       updated_at = '${at}', updated_by = '${ERASURE_ACTOR}', row_version = row_version + 1
     WHERE contact_id IN ${target}`,
    `UPDATE demand_requirements SET notes = '', status_reason = '${ERASED_REASON}', quality_review_note = '', next_followup_at = NULL,
       status = CASE WHEN status IN ('Converted', 'Lost', 'Duplicate', 'Invalid') THEN status ELSE 'Lost' END,
       updated_at = '${at}', updated_by = '${ERASURE_ACTOR}', row_version = row_version + 1
     WHERE contact_id IN ${target}`,
    `INSERT INTO audit_log (id, occurred_at, actor_id, actor_email, actor_role, entity_type, entity_id, entity_label, action, changes_json, context_json)
     SELECT 'aud_erase_' || id, '${at}', '${ERASURE_ACTOR}', '${by}', 'super_admin', 'contact', id, code, 'erase', '{}', '{"reason":"${ERASED_REASON}"}'
     FROM contacts WHERE id IN ${target}`,
    `UPDATE contacts SET name = 'Erased contact', phone_e164 = 'erased:' || id, alt_phone_e164 = '', whatsapp_e164 = '',
       email = '', language = '', notes = '', do_not_contact = 1, do_not_contact_reason = '${ERASED_REASON}',
       updated_at = '${at}', updated_by = '${ERASURE_ACTOR}', row_version = row_version + 1
     WHERE id IN ${target}`,
  ];
}

/**
 * Contacts with no meaningful interaction for RETENTION_MONTHS: no record
 * change, call, note or follow-up on the contact, its owner leads or its
 * requirements. A super admin reviews this list; nothing is deleted by it.
 */
export function retentionReviewSql(asOf?: string): string {
  if (asOf !== undefined && Number.isNaN(Date.parse(asOf))) throw new Error("Bad timestamp");
  const cutoff = `datetime('${asOf ?? "now"}', '-${RETENTION_MONTHS} months')`;
  return `SELECT c.code, c.updated_at,
  MAX(c.updated_at,
      COALESCE((SELECT MAX(updated_at) FROM owner_leads WHERE contact_id = c.id), ''),
      COALESCE((SELECT MAX(updated_at) FROM demand_requirements WHERE contact_id = c.id), ''),
      COALESCE((SELECT MAX(occurred_at) FROM activities WHERE contact_id = c.id), ''),
      COALESCE((SELECT MAX(COALESCE(completed_at, created_at)) FROM followups WHERE contact_id = c.id), '')) AS last_interaction
FROM contacts c
WHERE c.name <> 'Erased contact' AND c.merged_into_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.owner_contact_id = c.id AND p.archived_at IS NULL)
GROUP BY c.id
HAVING last_interaction < strftime('%Y-%m-%dT%H:%M:%fZ', ${cutoff})
ORDER BY last_interaction;`;
}
