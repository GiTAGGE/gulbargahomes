import { maskEmail, maskPhone } from "../crm/phone";
import type { SqlDb, SqlValue } from "../db/sql";
import { parseStoredLead } from "./graph";
import { INGESTION_STATUSES, type IngestionStatus } from "./ingest";

export type IngestionStats = {
  byStatus: Record<IngestionStatus, number>;
  total: number;
  imported: number;
  /** Leads already in the CRM when processed, plus import rows that were already queued. */
  duplicateLeads: number;
  webhookRedeliveries: number;
  existingContacts: number;
  attention: number;
  byForm: Record<string, { imported: number; open: number; attention: number; waiting: number }>;
};

const ATTENTION: IngestionStatus[] = ["failed", "needs_review", "needs_mapping", "waiting_token"];

export async function ingestionStats(db: SqlDb): Promise<IngestionStats> {
  const { results } = await db
    .prepare(
      `SELECT form_id, status, COUNT(*) AS n, SUM(deliveries - 1) AS redeliveries,
         SUM(CASE WHEN contact_existing = 1 THEN 1 ELSE 0 END) AS existing
       FROM meta_lead_ingestions GROUP BY form_id, status`,
    )
    .all<{ form_id: string; status: string; n: number; redeliveries: number | null; existing: number | null }>();
  const byStatus = Object.fromEntries(INGESTION_STATUSES.map((status) => [status, 0])) as Record<IngestionStatus, number>;
  const byForm: IngestionStats["byForm"] = {};
  let redeliveries = 0;
  let existing = 0;
  for (const row of results) {
    const status = row.status as IngestionStatus;
    const n = Number(row.n);
    if (status in byStatus) byStatus[status] += n;
    redeliveries += Number(row.redeliveries ?? 0);
    existing += Number(row.existing ?? 0);
    const form = (byForm[row.form_id] ??= { imported: 0, open: 0, attention: 0, waiting: 0 });
    if (status === "done") form.imported += n;
    else if (ATTENTION.includes(status)) form.attention += n;
    else if (status === "pending" || status === "processing" || status === "retry") form.open += n;
    if (status === "needs_mapping" || status === "ignored") form.waiting += n;
  }
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const overlaps = await db.prepare("SELECT COALESCE(SUM(duplicates), 0) AS n FROM meta_import_jobs").first<{ n: number }>();
  return {
    byStatus,
    total,
    imported: byStatus.done,
    duplicateLeads: byStatus.duplicate + Number(overlaps?.n ?? 0),
    webhookRedeliveries: redeliveries,
    existingContacts: existing,
    attention: ATTENTION.reduce((sum, status) => sum + byStatus[status], 0),
    byForm,
  };
}

export type WebhookDelivery = {
  id: string;
  receivedAt: string;
  signatureValid: boolean;
  leadgenCount: number;
  newCount: number;
  repeatCount: number;
  note: string;
};

export async function recentDeliveries(db: SqlDb, limit = 15): Promise<WebhookDelivery[]> {
  const { results } = await db
    .prepare("SELECT * FROM meta_webhook_deliveries ORDER BY received_at DESC LIMIT ?1")
    .bind(limit)
    .all<{ id: string; received_at: string; signature_valid: number; leadgen_count: number; new_count: number; repeat_count: number; note: string }>();
  return results.map((row) => ({
    id: row.id,
    receivedAt: row.received_at,
    signatureValid: Boolean(row.signature_valid),
    leadgenCount: row.leadgen_count,
    newCount: row.new_count,
    repeatCount: row.repeat_count,
    note: row.note,
  }));
}

export type IngestionSummary = {
  id: string;
  leadgenId: string;
  formId: string;
  formName: string;
  origin: string;
  status: IngestionStatus;
  attempts: number;
  deliveries: number;
  lastError: string;
  lastErrorKind: string;
  receivedAt: string;
  leadCreatedAt: string | null;
  nextAttemptAt: string;
  processedAt: string | null;
  entityType: string | null;
  entityId: string | null;
  contactExisting: boolean | null;
  preview: { name: string; phone: string };
};

type IngestionListRow = {
  id: string;
  leadgen_id: string;
  form_id: string;
  form_name: string | null;
  origin: string;
  status: string;
  attempts: number;
  deliveries: number;
  last_error: string;
  last_error_kind: string;
  received_at: string;
  lead_created_at: string | null;
  next_attempt_at: string;
  processed_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  contact_existing: number | null;
  payload_json: string;
};

function preview(payload: string, canViewPhone: boolean) {
  if (!payload) return { name: "", phone: "" };
  const lead = parseStoredLead(payload);
  if (!lead) return { name: "", phone: "" };
  const find = (pattern: RegExp) => lead.fieldData.find((field) => pattern.test(field.name))?.values[0] ?? "";
  const phone = find(/phone/);
  return { name: find(/full_name|^name$/), phone: canViewPhone ? phone : maskPhone(phone) };
}

function toSummary(row: IngestionListRow, canViewPhone: boolean): IngestionSummary {
  return {
    id: row.id,
    leadgenId: row.leadgen_id,
    formId: row.form_id,
    formName: row.form_name ?? "",
    origin: row.origin,
    status: row.status as IngestionStatus,
    attempts: row.attempts,
    deliveries: row.deliveries,
    lastError: row.last_error,
    lastErrorKind: row.last_error_kind,
    receivedAt: row.received_at,
    leadCreatedAt: row.lead_created_at,
    nextAttemptAt: row.next_attempt_at,
    processedAt: row.processed_at,
    entityType: row.entity_type,
    entityId: row.entity_id,
    contactExisting: row.contact_existing === null ? null : Boolean(row.contact_existing),
    preview: preview(row.payload_json, canViewPhone),
  };
}

const LIST_SELECT = `SELECT i.*, f.name AS form_name FROM meta_lead_ingestions i LEFT JOIN meta_forms f ON f.form_id = i.form_id`;

export async function listIngestions(
  db: SqlDb,
  filter: { statuses?: IngestionStatus[]; formId?: string; limit?: number; canViewPhone: boolean },
): Promise<IngestionSummary[]> {
  const statuses = (filter.statuses ?? []).filter((status) => (INGESTION_STATUSES as readonly string[]).includes(status));
  const clauses: string[] = [];
  const binds: SqlValue[] = [];
  if (statuses.length) clauses.push(`i.status IN (${statuses.map((status) => `'${status}'`).join(", ")})`);
  if (filter.formId) {
    binds.push(filter.formId);
    clauses.push(`i.form_id = ?${binds.length}`);
  }
  binds.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(`${LIST_SELECT} ${where} ORDER BY i.updated_at DESC LIMIT ?${binds.length}`)
    .bind(...binds)
    .all<IngestionListRow>();
  return results.map((row) => toSummary(row, filter.canViewPhone));
}

export type IngestionDetail = IngestionSummary & {
  answers: { key: string; values: string[] }[];
  events: { occurredAt: string; step: string; outcome: string; message: string }[];
};

export async function getIngestionDetail(db: SqlDb, id: string, canViewPhone: boolean): Promise<IngestionDetail | null> {
  const row = await db.prepare(`${LIST_SELECT} WHERE i.id = ?1`).bind(id).first<IngestionListRow>();
  if (!row) return null;
  const lead = parseStoredLead(row.payload_json);
  const { results } = await db
    .prepare("SELECT occurred_at, step, outcome, message FROM meta_ingestion_events WHERE ingestion_id = ?1 ORDER BY occurred_at, rowid")
    .bind(id)
    .all<{ occurred_at: string; step: string; outcome: string; message: string }>();
  return {
    ...toSummary(row, canViewPhone),
    answers: (lead?.fieldData ?? []).map((field) => ({
      key: field.name,
      values: canViewPhone
        ? field.values
        : field.values.map((value) => (/phone/.test(field.name) ? maskPhone(value) : /mail/.test(field.name) ? maskEmail(value) : value)),
    })),
    events: results.map((event) => ({
      occurredAt: event.occurred_at,
      step: event.step,
      outcome: event.outcome,
      message: event.message,
    })),
  };
}
