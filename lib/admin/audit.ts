import { maskEmail, maskPhone } from "../crm/phone";
import { newId, parseJson, type SqlDb, type SqlStatement, type SqlValue } from "../db/sql";

export type AuditActor = { id: string; email: string; role: string };

export type AuditEntity =
  | "property"
  | "contact"
  | "owner_lead"
  | "requirement"
  | "land_jv_enquiry"
  | "followup"
  | "admin_user"
  | "session"
  | "integration"
  | "meta_form"
  | "meta_import";

export type FieldChanges = Record<string, [unknown, unknown]>;

const PHONE_FIELDS = new Set(["phone_e164", "alt_phone_e164", "whatsapp_e164", "phone"]);
const EMAIL_FIELDS = new Set(["email"]);
const LONG_TEXT_LIMIT = 300;

function redact(field: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (PHONE_FIELDS.has(field)) return maskPhone(value);
  if (EMAIL_FIELDS.has(field)) return maskEmail(value);
  if (value.length > LONG_TEXT_LIMIT) return `${value.slice(0, LONG_TEXT_LIMIT)}… (${value.length} chars)`;
  return value;
}

function comparable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Field-level before/after pairs for values that actually changed. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[] = Object.keys(after),
): FieldChanges {
  const changes: FieldChanges = {};
  for (const field of fields) {
    if (comparable(before[field]) !== comparable(after[field])) {
      changes[field] = [redact(field, before[field]), redact(field, after[field])];
    }
  }
  return changes;
}

export function auditStatement(
  db: SqlDb,
  entry: {
    actor: AuditActor;
    entityType: AuditEntity;
    entityId: string;
    entityLabel?: string;
    action: string;
    changes?: FieldChanges;
    context?: Record<string, SqlValue | boolean>;
    at: string;
    /** In a batch, write the row only if the preceding statement changed something. */
    onlyIfPreviousChanged?: boolean;
  },
): SqlStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, occurred_at, actor_id, actor_email, actor_role, entity_type, entity_id, entity_label, action, changes_json, context_json)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11${entry.onlyIfPreviousChanged ? " WHERE changes() > 0" : ""}`,
    )
    .bind(
      newId("aud"),
      entry.at,
      entry.actor.id,
      entry.actor.email,
      entry.actor.role,
      entry.entityType,
      entry.entityId,
      entry.entityLabel ?? "",
      entry.action,
      JSON.stringify(entry.changes ?? {}),
      JSON.stringify(entry.context ?? {}),
    );
}

export type AuditEntry = {
  id: string;
  occurredAt: string;
  actorId: string;
  actorEmail: string;
  actorRole: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: string;
  changes: FieldChanges;
  context: Record<string, unknown>;
};

type AuditRow = {
  id: string;
  occurred_at: string;
  actor_id: string;
  actor_email: string;
  actor_role: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: string;
  changes_json: string;
  context_json: string;
};

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    action: row.action,
    changes: parseJson<FieldChanges>(row.changes_json, {}),
    context: parseJson<Record<string, unknown>>(row.context_json, {}),
  };
}

export async function listAudit(
  db: SqlDb,
  filter: { entityType?: string; entityId?: string; limit?: number },
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  if (filter.entityType && filter.entityId) {
    const { results } = await db
      .prepare(
        "SELECT * FROM audit_log WHERE entity_type = ?1 AND entity_id = ?2 ORDER BY occurred_at DESC LIMIT ?3",
      )
      .bind(filter.entityType, filter.entityId, limit)
      .all<AuditRow>();
    return results.map(toEntry);
  }
  const { results } = await db
    .prepare("SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT ?1")
    .bind(limit)
    .all<AuditRow>();
  return results.map(toEntry);
}
