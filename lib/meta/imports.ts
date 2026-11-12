import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { newId, parseJson, type SqlDb } from "../db/sql";
import { markTokenRejected, readPageToken } from "./connection";
import { getStoredForm, listForms } from "./forms";
import { MetaApiError, redactTokens } from "./graph";
import { enqueueLead, processDue, purgeExpiredQueueData, type MetaRuntime } from "./ingest";
import { isHistoricalImportClassification, isReconcileClassification } from "./mapping";

export const IMPORT_STATUSES = ["scanning", "processing", "paused", "completed", "cancelled"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Meta keeps lead answers retrievable through the API for 90 days. */
export const LEAD_RETENTION_DAYS = 90;

type JobRow = {
  id: string;
  form_ids_json: string;
  since: string;
  until: string;
  status: string;
  cursor_json: string;
  found: number;
  queued: number;
  duplicates: number;
  last_error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

type Cursor = { formIndex: number; after: string | null };

export type ImportJob = {
  id: string;
  formIds: string[];
  since: string;
  until: string;
  status: ImportStatus;
  found: number;
  queued: number;
  duplicates: number;
  lastError: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  progress: { formIndex: number; forms: number; byStatus: Record<string, number> };
};

async function toJob(db: SqlDb, row: JobRow): Promise<ImportJob> {
  const formIds = parseJson<string[]>(row.form_ids_json, []);
  const cursor = parseJson<Cursor>(row.cursor_json, { formIndex: 0, after: null });
  const { results } = await db
    .prepare("SELECT status, COUNT(*) AS n FROM meta_lead_ingestions WHERE import_job_id = ?1 GROUP BY status")
    .bind(row.id)
    .all<{ status: string; n: number }>();
  return {
    id: row.id,
    formIds,
    since: row.since,
    until: row.until,
    status: (IMPORT_STATUSES as readonly string[]).includes(row.status) ? (row.status as ImportStatus) : "paused",
    found: row.found,
    queued: row.queued,
    duplicates: row.duplicates,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    progress: {
      formIndex: Math.min(cursor.formIndex, formIds.length),
      forms: formIds.length,
      byStatus: Object.fromEntries(results.map((item) => [item.status, Number(item.n)])),
    },
  };
}

export async function getImportJob(db: SqlDb, id: string): Promise<ImportJob | null> {
  const row = await db.prepare("SELECT * FROM meta_import_jobs WHERE id = ?1").bind(id).first<JobRow>();
  return row ? toJob(db, row) : null;
}

export async function listImportJobs(db: SqlDb, limit = 10): Promise<ImportJob[]> {
  const { results } = await db
    .prepare("SELECT * FROM meta_import_jobs ORDER BY created_at DESC LIMIT ?1")
    .bind(limit)
    .all<JobRow>();
  return Promise.all(results.map((row) => toJob(db, row)));
}

export function parseImportInput(value: unknown, now: Date): { formIds: string[]; since: string; until: string } {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const formIds = Array.isArray(data.formIds)
    ? [...new Set(data.formIds.filter((id): id is string => typeof id === "string" && /^\d{5,40}$/.test(id)))].slice(0, 20)
    : [];
  if (formIds.length === 0) throw new HttpError(400, "Choose at least one form.");
  const since = new Date(String(data.since ?? ""));
  const until = data.until ? new Date(String(data.until)) : now;
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) throw new HttpError(400, "Choose a valid date range.");
  // Dates from the form are whole days; include all of the last day.
  const untilEnd = /^\d{4}-\d{2}-\d{2}$/.test(String(data.until ?? "")) ? new Date(until.getTime() + 86_400_000) : until;
  const end = untilEnd > now ? now : untilEnd;
  if (since >= end) throw new HttpError(400, "The start date must be before the end date.");
  return { formIds, since: since.toISOString(), until: end.toISOString() };
}

export async function createImportJob(
  db: SqlDb,
  actor: AuditActor,
  input: { formIds: string[]; since: string; until: string },
  now: string,
): Promise<ImportJob> {
  for (const formId of input.formIds) {
    const form = await getStoredForm(db, formId);
    if (!form) throw new HttpError(400, "One of the forms is not on the connected Page. Refresh forms first.");
    if (!isHistoricalImportClassification(form.classification)) {
      throw new HttpError(400, `Classify “${form.name}” before importing its leads.`);
    }
  }
  const running = await db
    .prepare("SELECT id FROM meta_import_jobs WHERE status IN ('scanning', 'processing') LIMIT 1")
    .first<{ id: string }>();
  if (running) throw new HttpError(409, "An import is already running. Wait for it to finish or cancel it.");
  const id = newId("mij");
  await db.batch([
    db
      .prepare(
        `INSERT INTO meta_import_jobs (id, form_ids_json, since, until, status, cursor_json, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'scanning', ?5, ?6, ?7, ?7)`,
      )
      .bind(id, JSON.stringify(input.formIds), input.since, input.until, JSON.stringify({ formIndex: 0, after: null }), actor.id, now),
    auditStatement(db, {
      actor,
      entityType: "meta_import",
      entityId: id,
      entityLabel: "Historical Meta lead import",
      action: "start",
      context: { forms: input.formIds.join(","), since: input.since, until: input.until },
      at: now,
    }),
  ]);
  return (await getImportJob(db, id))!;
}

export async function cancelImportJob(db: SqlDb, actor: AuditActor, id: string, now: string) {
  await db.batch([
    db
      .prepare(
        "UPDATE meta_import_jobs SET status = 'cancelled', finished_at = ?1, updated_at = ?1 WHERE id = ?2 AND status IN ('scanning', 'processing', 'paused')",
      )
      .bind(now, id),
    auditStatement(db, { actor, entityType: "meta_import", entityId: id, action: "cancel", at: now, onlyIfPreviousChanged: true }),
  ]);
}

async function updateJob(db: SqlDb, id: string, fields: Record<string, string | number | null>, now: string) {
  const names = Object.keys(fields);
  await db
    .prepare(
      `UPDATE meta_import_jobs SET ${names.map((name, index) => `${name} = ?${index + 1}`).join(", ")}, updated_at = ?${names.length + 1} WHERE id = ?${names.length + 2}`,
    )
    .bind(...names.map((name) => (name === "last_error" ? redactTokens(String(fields[name] ?? "")) : fields[name])), now, id)
    .run();
}

/**
 * One unit of work: fetch one page of leads from Meta and queue it, or, once
 * every form is scanned, process queued leads. Safe to call repeatedly from
 * the browser, the cron sweep, or both.
 */
export async function runImportStep(runtime: MetaRuntime, id: string): Promise<ImportJob | null> {
  const { db } = runtime;
  const now = runtime.now ? runtime.now() : new Date();
  const at = now.toISOString();
  const row = await db.prepare("SELECT * FROM meta_import_jobs WHERE id = ?1").bind(id).first<JobRow>();
  if (!row) return null;

  if (row.status === "paused") {
    await updateJob(db, id, { status: "scanning", last_error: "" }, at);
    row.status = "scanning";
  }

  if (row.status === "scanning") {
    const formIds = parseJson<string[]>(row.form_ids_json, []);
    const cursor = parseJson<Cursor>(row.cursor_json, { formIndex: 0, after: null });
    const token = await readPageToken(db, runtime.tokenKey);
    if (!token) {
      await updateJob(db, id, { status: "paused", last_error: "Meta is not connected. Reconnect to continue." }, at);
      return getImportJob(db, id);
    }
    if (cursor.formIndex >= formIds.length) {
      await updateJob(db, id, { status: "processing" }, at);
    } else {
      try {
        const page = await runtime.graph.listFormLeads(formIds[cursor.formIndex], token, {
          since: row.since,
          until: row.until,
          after: cursor.after,
          limit: 50,
          adNames: runtime.adNames,
        });
        let queued = 0;
        let duplicates = 0;
        for (const lead of page.leads) {
          const result = await enqueueLead(
            db,
            { leadgenId: lead.id, pageId: runtime.pageId, formId: lead.formId, adId: lead.adId, origin: "import", importJobId: id, lead },
            at,
          );
          if (result.isNew) queued += 1;
          else duplicates += 1;
        }
        const next: Cursor = page.after ? { formIndex: cursor.formIndex, after: page.after } : { formIndex: cursor.formIndex + 1, after: null };
        await db
          .prepare(
            `UPDATE meta_import_jobs SET found = found + ?1, queued = queued + ?2, duplicates = duplicates + ?3, cursor_json = ?4,
               last_error = '', status = CASE WHEN status = 'scanning' AND ?5 = 1 THEN 'processing' ELSE status END, updated_at = ?6
             WHERE id = ?7`,
          )
          .bind(page.leads.length, queued, duplicates, JSON.stringify(next), next.formIndex >= formIds.length ? 1 : 0, at, id)
          .run();
      } catch (error) {
        if (error instanceof MetaApiError && (error.kind === "auth" || error.kind === "permission")) {
          await markTokenRejected(db, error.message, at);
          await updateJob(db, id, { status: "paused", last_error: error.message }, at);
        } else if (error instanceof MetaApiError && error.kind === "permanent") {
          // Skip a form Meta refuses (deleted, no access) and carry on with the rest.
          await updateJob(
            db,
            id,
            { cursor_json: JSON.stringify({ formIndex: cursor.formIndex + 1, after: null }), last_error: `Form ${formIds[cursor.formIndex]}: ${error.message}` },
            at,
          );
        } else {
          await updateJob(db, id, { last_error: error instanceof Error ? error.message.slice(0, 300) : "Import step failed" }, at);
        }
      }
    }
  }

  await processDue(runtime, { importJobId: id, limit: 20, budgetMs: 15_000 });

  const current = await db.prepare("SELECT status FROM meta_import_jobs WHERE id = ?1").bind(id).first<{ status: string }>();
  if (current?.status === "processing") {
    const open = await db
      .prepare("SELECT COUNT(*) AS n FROM meta_lead_ingestions WHERE import_job_id = ?1 AND status IN ('pending', 'processing')")
      .bind(id)
      .first<{ n: number }>();
    if (Number(open?.n ?? 0) === 0) await updateJob(db, id, { status: "completed", finished_at: at }, at);
  }
  return getImportJob(db, id);
}

const RECONCILE_KEY = "meta_reconciled_at";
const RECONCILE_EVERY_HOURS = 6;
const RECONCILE_WINDOW_HOURS = 48;

/**
 * Catches leads whose webhook never arrived: every few hours, list the last
 * two days of leads on each owner, tenant, buyer, mixed and land JV form and
 * queue any we have not seen. Unclassified and Ignore forms are not listed.
 * Historical import still does not accept mixed forms, so a buyer-or-tenant
 * copy is not pulled in with a date range. Land JV can be selected on purpose.
 */
export async function reconcileRecentLeads(runtime: MetaRuntime, options: { force?: boolean } = {}): Promise<{ checked: number; queued: number } | null> {
  const { db } = runtime;
  const now = runtime.now ? runtime.now() : new Date();
  const at = now.toISOString();
  const last = await db.prepare("SELECT value FROM app_meta WHERE key = ?1").bind(RECONCILE_KEY).first<{ value: string }>();
  if (!options.force && last && now.getTime() - Date.parse(last.value) < RECONCILE_EVERY_HOURS * 3_600_000) return null;
  const token = await readPageToken(db, runtime.tokenKey);
  if (!token) return null;

  const forms = (await listForms(db, runtime.pageId)).filter((form) => isReconcileClassification(form.classification));
  const since = new Date(now.getTime() - RECONCILE_WINDOW_HOURS * 3_600_000).toISOString();
  let checked = 0;
  let queued = 0;
  for (const form of forms) {
    let after: string | null = null;
    for (let pageCount = 0; pageCount < 10; pageCount += 1) {
      let page;
      try {
        page = await runtime.graph.listFormLeads(form.formId, token, { since, until: at, after, limit: 100, adNames: runtime.adNames });
      } catch (error) {
        if (error instanceof MetaApiError && (error.kind === "auth" || error.kind === "permission")) {
          await markTokenRejected(db, error.message, at);
          return { checked, queued };
        }
        break;
      }
      for (const lead of page.leads) {
        checked += 1;
        const result = await enqueueLead(
          db,
          { leadgenId: lead.id, pageId: runtime.pageId, formId: form.formId, adId: lead.adId, origin: "reconcile", lead },
          at,
        );
        if (result.isNew) queued += 1;
      }
      after = page.after;
      if (!after) break;
    }
  }
  await db
    .prepare("INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(RECONCILE_KEY, at)
    .run();
  return { checked, queued };
}

/** Everything the cron trigger does every few minutes. */
export async function runSweep(runtime: MetaRuntime, options: { budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = options.budgetMs ?? 25_000;
  const processed = await processDue(runtime, { limit: 25, budgetMs: budget / 2 });
  const { results } = await runtime.db
    .prepare("SELECT id FROM meta_import_jobs WHERE status IN ('scanning', 'processing') ORDER BY created_at LIMIT 2")
    .all<{ id: string }>();
  for (const job of results) {
    if (Date.now() - started > budget * 0.75) break;
    await runImportStep(runtime, job.id);
  }
  const reconciled = Date.now() - started < budget * 0.75 ? await reconcileRecentLeads(runtime) : null;
  const purged = await purgeExpiredQueueData(runtime.db, runtime.now ? runtime.now() : new Date());
  return { processed, imports: results.length, reconciled, purged };
}
