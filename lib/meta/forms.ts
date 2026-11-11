import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { OWNER_INTENTS, type OwnerIntent } from "../crm/options";
import { changedRows, parseJson, type SqlDb } from "../db/sql";
import type { MetaForm, MetaQuestion } from "./graph";
import { ownerIntentsIn } from "./values";
import {
  FORM_CLASSIFICATIONS,
  isMappingTarget,
  suggestMapping,
  type FieldMapping,
  type FormClassification,
  type MappedForm,
} from "./mapping";

export type StoredForm = MappedForm & {
  pageId: string;
  status: string;
  locale: string;
  leadsCount: number | null;
  formCreatedAt: string | null;
  discoveredAt: string;
  syncedAt: string;
  updatedAt: string;
  updatedBy: string;
  rowVersion: number;
};

type FormRow = {
  form_id: string;
  page_id: string;
  name: string;
  status: string;
  locale: string;
  questions_json: string;
  classification: string;
  owner_intent: string;
  mapping_json: string;
  leads_count: number | null;
  form_created_at: string | null;
  discovered_at: string;
  synced_at: string;
  updated_at: string;
  updated_by: string;
  row_version: number;
};

function toForm(row: FormRow): StoredForm {
  const classification = (FORM_CLASSIFICATIONS as readonly string[]).includes(row.classification)
    ? (row.classification as FormClassification)
    : "unclassified";
  const questions = parseJson<MetaQuestion[]>(row.questions_json, []);
  const stored = parseJson<Record<string, unknown>>(row.mapping_json, {});
  const mapping: FieldMapping = Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, FieldMapping[string]] => isMappingTarget(entry[1])),
  );
  return {
    formId: row.form_id,
    pageId: row.page_id,
    name: row.name,
    status: row.status,
    locale: row.locale,
    questions,
    classification,
    ownerIntent: (OWNER_INTENTS as readonly string[]).includes(row.owner_intent) ? (row.owner_intent as OwnerIntent) : "",
    mapping,
    leadsCount: row.leads_count,
    formCreatedAt: row.form_created_at,
    discoveredAt: row.discovered_at,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    rowVersion: Number(row.row_version),
  };
}

export async function listForms(db: SqlDb, pageId?: string): Promise<StoredForm[]> {
  const { results } = pageId
    ? await db.prepare("SELECT * FROM meta_forms WHERE page_id = ?1 ORDER BY name").bind(pageId).all<FormRow>()
    : await db.prepare("SELECT * FROM meta_forms ORDER BY name").all<FormRow>();
  return results.map(toForm);
}

export async function getStoredForm(db: SqlDb, formId: string): Promise<StoredForm | null> {
  const row = await db.prepare("SELECT * FROM meta_forms WHERE form_id = ?1").bind(formId).first<FormRow>();
  return row ? toForm(row) : null;
}

/** Inserts new forms and refreshes names and questions. Classification and mapping are kept. */
export async function upsertDiscoveredForms(
  db: SqlDb,
  actorId: string,
  pageId: string,
  forms: MetaForm[],
  now: string,
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  for (const form of forms) {
    const existing = await getStoredForm(db, form.id);
    if (!existing) added += 1;
    else updated += 1;
    // New question keys on an already mapped form get a suggested target.
    const mapping =
      existing && Object.keys(existing.mapping).length > 0
        ? { ...suggestMapping(form.questions, existing.classification), ...existing.mapping }
        : existing?.mapping ?? {};
    await db
      .prepare(
        `INSERT INTO meta_forms (form_id, page_id, name, status, locale, questions_json, leads_count, form_created_at, mapping_json, discovered_at, synced_at, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10, ?11)
         ON CONFLICT(form_id) DO UPDATE SET page_id = excluded.page_id, name = excluded.name, status = excluded.status,
           locale = excluded.locale, questions_json = excluded.questions_json, leads_count = excluded.leads_count,
           form_created_at = excluded.form_created_at, mapping_json = excluded.mapping_json, synced_at = excluded.synced_at`,
      )
      .bind(
        form.id,
        pageId,
        form.name,
        form.status,
        form.locale,
        JSON.stringify(form.questions),
        form.leadsCount,
        form.createdTime,
        JSON.stringify(mapping),
        now,
        actorId,
      )
      .run();
  }
  return { added, updated };
}

export type FormSettingsInput = {
  classification: FormClassification;
  ownerIntent: OwnerIntent | "";
  mapping: FieldMapping;
};

export function parseFormSettings(value: unknown, form: StoredForm): FormSettingsInput {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const classification = (FORM_CLASSIFICATIONS as readonly string[]).includes(String(data.classification))
    ? (data.classification as FormClassification)
    : null;
  if (!classification) throw new HttpError(400, "Choose what this form collects.");
  const ownerIntent =
    typeof data.ownerIntent === "string" && (OWNER_INTENTS as readonly string[]).includes(data.ownerIntent)
      ? (data.ownerIntent as OwnerIntent)
      : "";
  const keys = new Set(form.questions.map((question) => question.key));
  const raw = data.mapping && typeof data.mapping === "object" ? (data.mapping as Record<string, unknown>) : null;
  const mapping: FieldMapping = raw
    ? Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, FieldMapping[string]] => keys.has(entry[0]) && isMappingTarget(entry[1]),
        ),
      )
    : Object.keys(form.mapping).length
      ? form.mapping
      : suggestMapping(form.questions, classification);
  if (["owner", "tenant", "buyer", "mixed"].includes(classification) && form.questions.length > 0) {
    const targets = new Set(Object.values(mapping));
    const hasPhone = targets.has("phone") || form.questions.some((question) => (question.key === "phone_number" || question.key === "phone") && !(question.key in mapping));
    if (!hasPhone) throw new HttpError(400, "Map one question to Mobile. Leads without a mobile number cannot be imported.");
    if (classification === "mixed" && !targets.has("intent")) {
      throw new HttpError(400, "Map the question that asks whether they want to buy or rent.");
    }
    if (classification === "mixed" && targets.has("budget")) {
      throw new HttpError(400, "On a buyer-or-tenant form, map each budget to Purchase budget or Monthly rental budget. One Budget target cannot tell them apart.");
    }
    if (classification === "owner") {
      const splitsIntent = form.questions.some((question) => {
        const options = question.options.map((option) => `${option.key} ${option.value}`).join(" ");
        return ownerIntentsIn(options).length > 1 && mapping[question.key] !== "intent";
      });
      if (splitsIntent) {
        throw new HttpError(400, "Map the question that asks sell, rent or lease to Rent / sale / buy. Otherwise a sale can be stored as a rent.");
      }
    }
  }
  return { classification, ownerIntent, mapping };
}

export async function updateFormSettings(
  db: SqlDb,
  actor: AuditActor,
  form: StoredForm,
  input: FormSettingsInput,
  options: { now: string; expectedVersion?: number },
): Promise<{ form: StoredForm; requeued: number }> {
  if (options.expectedVersion !== undefined && options.expectedVersion !== form.rowVersion) {
    throw new HttpError(409, "Someone else changed this form’s settings. Reload to see the latest version.");
  }
  const changes = diffFields(
    { classification: form.classification, owner_intent: form.ownerIntent, mapping: form.mapping },
    { classification: input.classification, owner_intent: input.ownerIntent, mapping: input.mapping },
  );
  if (Object.keys(changes).length === 0) return { form, requeued: 0 };
  const importable = ["owner", "tenant", "buyer", "mixed"].includes(input.classification);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE meta_forms SET classification = ?1, owner_intent = ?2, mapping_json = ?3, updated_at = ?4, updated_by = ?5,
           row_version = row_version + 1
         WHERE form_id = ?6 AND row_version = ?7`,
      )
      .bind(
        input.classification,
        input.ownerIntent,
        JSON.stringify(input.mapping),
        options.now,
        actor.id,
        form.formId,
        form.rowVersion,
      ),
    auditStatement(db, {
      actor,
      entityType: "meta_form",
      entityId: form.formId,
      entityLabel: form.name,
      action: "update_mapping",
      changes,
      at: options.now,
      onlyIfPreviousChanged: true,
    }),
    db
      .prepare(
        `UPDATE meta_lead_ingestions SET status = ?1, next_attempt_at = ?2, updated_at = ?2, last_error = ''
         WHERE form_id = ?3 AND status IN ('needs_mapping', 'ignored') AND ?4 = 1`,
      )
      .bind("pending", options.now, form.formId, importable ? 1 : 0),
  ]);
  if (changedRows(results[0]) === 0) {
    throw new HttpError(409, "Someone else changed this form’s settings. Reload to see the latest version.");
  }
  return { form: (await getStoredForm(db, form.formId))!, requeued: changedRows(results[2]) };
}
