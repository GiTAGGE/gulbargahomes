import type { AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { findContactByPhone } from "../crm/contacts";
import { noMatching, type MatchingTrigger } from "../crm/matching-hook";
import { createOwnerLead } from "../crm/owner-leads";
import { normalizeIndianMobile } from "../crm/phone";
import { createRequirement } from "../crm/requirements";
import { sourceIdForMetaLead, type SourceInput } from "../crm/sources";
import { changedRows, newId, type SqlDb } from "../db/sql";
import { markTokenRejected, readPageToken, touchConnection } from "./connection";
import { getStoredForm, upsertDiscoveredForms } from "./forms";
import { MetaApiError, parseStoredLead, type GraphClient, type MetaLead } from "./graph";
import type { IngestionStatus } from "./labels";
import { mapLead, type MappedLead } from "./mapping";

/** Recorded as the actor on everything the integration creates. */
export const META_ACTOR: AuditActor = { id: "meta_lead_ads", email: "meta-lead-ads", role: "system" };

export { INGESTION_STATUS_LABEL, INGESTION_STATUSES, type IngestionStatus } from "./labels";

export type IngestionOriginKind = "webhook" | "import" | "reconcile";

export type MetaRuntime = {
  db: SqlDb;
  graph: GraphClient;
  tokenKey: string;
  pageId: string;
  matching?: MatchingTrigger;
  now?: () => Date;
};

/** Minutes before attempt n+1. After the last step the lead is marked failed. */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 720, 1440];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1;
const LOCK_MINUTES = 5;

const nowOf = (runtime: Pick<MetaRuntime, "now">) => (runtime.now ? runtime.now() : new Date());
const plusMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000).toISOString();

export type EnqueueInput = {
  leadgenId: string;
  pageId?: string;
  formId?: string;
  adId?: string;
  createdTime?: string | null;
  origin: IngestionOriginKind;
  importJobId?: string | null;
  lead?: MetaLead | null;
};

/**
 * Adds a lead to the durable queue. The leadgen id is unique, so a webhook
 * retry, a second webhook for the same lead, or an import that overlaps the
 * webhook only bumps a counter.
 */
export async function enqueueLead(db: SqlDb, input: EnqueueInput, now: string): Promise<{ id: string; isNew: boolean }> {
  const leadgenId = input.leadgenId.trim().slice(0, 64);
  if (!/^\d{5,40}$/.test(leadgenId)) throw new HttpError(400, "Invalid Meta lead id.");
  const existing = await db
    .prepare("SELECT id FROM meta_lead_ingestions WHERE leadgen_id = ?1")
    .bind(leadgenId)
    .first<{ id: string }>();
  const id = existing?.id ?? newId("mli");
  await db
    .prepare(
      `INSERT INTO meta_lead_ingestions (id, leadgen_id, page_id, form_id, ad_id, origin, import_job_id, status, next_attempt_at, lead_created_at, payload_json, received_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?8, ?8)
       ON CONFLICT(leadgen_id) DO UPDATE SET
         deliveries = meta_lead_ingestions.deliveries + CASE WHEN excluded.origin = 'webhook' THEN 1 ELSE 0 END,
         payload_json = CASE WHEN meta_lead_ingestions.payload_json = '' AND meta_lead_ingestions.status NOT IN ('done', 'duplicate')
           THEN excluded.payload_json ELSE meta_lead_ingestions.payload_json END,
         form_id = CASE WHEN meta_lead_ingestions.form_id = '' THEN excluded.form_id ELSE meta_lead_ingestions.form_id END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      leadgenId,
      input.pageId ?? "",
      input.formId ?? input.lead?.formId ?? "",
      input.adId ?? input.lead?.adId ?? "",
      input.origin,
      input.importJobId ?? null,
      now,
      input.createdTime ?? input.lead?.createdTime ?? null,
      input.lead ? JSON.stringify(input.lead) : "",
    )
    .run();
  if (!existing) await logEvent(db, id, now, "received", "queued", `via ${input.origin}`);
  else await logEvent(db, id, now, "received", "repeat", `again via ${input.origin}`);
  return { id, isNew: !existing };
}

async function logEvent(db: SqlDb, ingestionId: string, at: string, step: string, outcome: string, message = "") {
  await db
    .prepare(
      "INSERT INTO meta_ingestion_events (id, ingestion_id, occurred_at, step, outcome, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(newId("mie"), ingestionId, at, step, outcome, message.slice(0, 300))
    .run();
}

type IngestionRow = {
  id: string;
  leadgen_id: string;
  page_id: string;
  form_id: string;
  ad_id: string;
  origin: string;
  import_job_id: string | null;
  status: string;
  attempts: number;
  payload_json: string;
  received_at: string;
};

async function finish(
  db: SqlDb,
  row: IngestionRow,
  at: string,
  status: IngestionStatus,
  fields: { error?: string; kind?: string; nextAttemptAt?: string; entityType?: string; entityId?: string; contactId?: string; contactExisting?: boolean; payload?: string } = {},
) {
  const terminal = status === "done" || status === "duplicate";
  await db
    .prepare(
      `UPDATE meta_lead_ingestions SET status = ?1, last_error = ?2, last_error_kind = ?3, next_attempt_at = ?4, locked_until = NULL,
         entity_type = COALESCE(?5, entity_type), entity_id = COALESCE(?6, entity_id), contact_id = COALESCE(?7, contact_id),
         contact_existing = COALESCE(?8, contact_existing), payload_json = ?9,
         processed_at = CASE WHEN ?10 = 1 THEN ?11 ELSE processed_at END, updated_at = ?11
       WHERE id = ?12`,
    )
    .bind(
      status,
      (fields.error ?? "").slice(0, 500),
      fields.kind ?? "",
      fields.nextAttemptAt ?? at,
      fields.entityType ?? null,
      fields.entityId ?? null,
      fields.contactId ?? null,
      fields.contactExisting === undefined ? null : fields.contactExisting ? 1 : 0,
      // The answers live on the lead source once imported; the queue keeps no second copy.
      terminal ? "" : (fields.payload ?? row.payload_json),
      terminal ? 1 : 0,
      at,
      row.id,
    )
    .run();
  await logEvent(db, row.id, at, "process", status, fields.error ?? "");
}

/** Claims a due row so two isolates never process the same lead at once. */
async function claim(db: SqlDb, id: string, now: Date): Promise<IngestionRow | null> {
  const at = now.toISOString();
  return db
    .prepare(
      `UPDATE meta_lead_ingestions SET status = 'processing', attempts = attempts + 1, locked_until = ?1, updated_at = ?2
       WHERE id = ?3 AND (
         (status IN ('pending', 'retry') AND next_attempt_at <= ?2)
         OR (status = 'processing' AND locked_until < ?2)
       )
       RETURNING id, leadgen_id, page_id, form_id, ad_id, origin, import_job_id, status, attempts, payload_json, received_at`,
    )
    .bind(plusMinutes(now, LOCK_MINUTES), at, id)
    .first<IngestionRow>();
}

async function existingEntity(db: SqlDb, leadgenId: string) {
  const sourceId = await sourceIdForMetaLead(db, leadgenId);
  if (!sourceId) return null;
  const owner = await db.prepare("SELECT id, contact_id FROM owner_leads WHERE source_id = ?1").bind(sourceId).first<{ id: string; contact_id: string }>();
  if (owner) return { entityType: "owner_lead", entityId: owner.id, contactId: owner.contact_id };
  const requirement = await db
    .prepare("SELECT id, contact_id FROM demand_requirements WHERE source_id = ?1")
    .bind(sourceId)
    .first<{ id: string; contact_id: string }>();
  if (requirement) return { entityType: "requirement", entityId: requirement.id, contactId: requirement.contact_id };
  return { entityType: "lead_source", entityId: sourceId, contactId: undefined };
}

function sourceFor(lead: MetaLead, form: { formId: string; name: string }, row: IngestionRow, mapped: MappedLead): SourceInput {
  const platform = /^(ig|instagram)$/i.test(lead.platform) ? "instagram" : /^(fb|facebook)$/i.test(lead.platform) ? "facebook" : "";
  return {
    channel: "meta_lead_form",
    platform,
    metaLeadId: lead.id,
    metaFormId: form.formId,
    metaFormName: form.name.slice(0, 160),
    metaCampaignId: lead.campaignId.slice(0, 64),
    metaCampaignName: lead.campaignName.slice(0, 160),
    metaAdsetId: lead.adsetId.slice(0, 64),
    metaAdsetName: lead.adsetName.slice(0, 160),
    metaAdId: lead.adId.slice(0, 64),
    metaAdName: lead.adName.slice(0, 160),
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    utmTerm: "",
    submittedAt: lead.createdTime,
    metaPageId: row.page_id,
    metaIsOrganic: lead.isOrganic,
    ingestionOrigin: row.origin === "webhook" ? "webhook" : row.origin === "reconcile" ? "reconciliation" : "historical_import",
    receivedAt: row.received_at,
    rawPayload: {
      meta: {
        leadgen_id: lead.id,
        form_id: form.formId,
        form_name: form.name,
        page_id: row.page_id,
        ad_id: lead.adId,
        adset_id: lead.adsetId,
        campaign_id: lead.campaignId,
        platform: lead.platform,
        is_organic: lead.isOrganic,
        created_time: lead.createdTime,
        origin: row.origin,
      },
      answers: mapped.answers,
    },
  };
}

async function recordAdEntities(db: SqlDb, lead: MetaLead, at: string) {
  const entries: [string, string, string, string][] = [
    ["campaign", lead.campaignId, lead.campaignName, ""],
    ["adset", lead.adsetId, lead.adsetName, lead.campaignId],
    ["ad", lead.adId, lead.adName, lead.adsetId],
  ];
  for (const [level, id, name, parent] of entries) {
    if (!id) continue;
    await db
      .prepare(
        `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
         VALUES ('meta', ?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(platform, level, external_id) DO UPDATE SET
           name = CASE WHEN excluded.name != '' THEN excluded.name ELSE ad_entities.name END,
           parent_id = CASE WHEN excluded.parent_id != '' THEN excluded.parent_id ELSE ad_entities.parent_id END,
           last_seen_at = excluded.last_seen_at`,
      )
      .bind(level, id, name.slice(0, 200), parent, at)
      .run();
  }
}

async function scheduleRetry(db: SqlDb, row: IngestionRow, now: Date, error: string, kind: string, minimumSeconds = 0) {
  const at = now.toISOString();
  if (row.attempts >= MAX_ATTEMPTS) {
    await finish(db, row, at, "failed", { error: `Gave up after ${row.attempts} attempts: ${error}`, kind });
    return "failed" as const;
  }
  const minutes = Math.max(RETRY_BACKOFF_MINUTES[Math.min(row.attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)], minimumSeconds / 60);
  await finish(db, row, at, "retry", { error, kind, nextAttemptAt: plusMinutes(now, minutes) });
  return "retry" as const;
}

export type ProcessOutcome = IngestionStatus | "skipped" | "rate_limited";

/** The single ingestion path for webhook, historical import and reconciliation leads. */
export async function processIngestion(runtime: MetaRuntime, id: string): Promise<ProcessOutcome> {
  const { db } = runtime;
  const now = nowOf(runtime);
  const at = now.toISOString();
  const row = await claim(db, id, now);
  if (!row) return "skipped";

  try {
    const already = await existingEntity(db, row.leadgen_id);
    if (already) {
      await finish(db, row, at, "duplicate", { ...already, error: "This Meta lead was already in the CRM." });
      return "duplicate";
    }

    let lead = parseStoredLead(row.payload_json);
    const needsToken =
      !lead || !lead.fieldData.length || !(await getStoredForm(db, row.form_id || lead.formId || ""));
    const token = needsToken ? await readPageToken(db, runtime.tokenKey) : null;
    if (needsToken && !token) {
      await finish(db, row, at, "waiting_token", { error: "Meta is not connected. Reconnect to continue.", kind: "auth" });
      return "waiting_token";
    }

    if (!lead || !lead.fieldData.length) {
      lead = await runtime.graph.getLead(row.leadgen_id, token!);
      await logEvent(db, row.id, at, "fetch", "ok", "Lead answers retrieved from Graph API");
    }
    const formId = lead.formId || row.form_id;
    let form = await getStoredForm(db, formId);
    if (!form && formId) {
      const discovered = await runtime.graph.getForm(formId, token!);
      await upsertDiscoveredForms(db, META_ACTOR.id, discovered.pageId || row.page_id || runtime.pageId, [discovered], at);
      form = await getStoredForm(db, formId);
    }
    const payload = JSON.stringify(lead);
    if (!form) {
      await finish(db, row, at, "needs_review", { error: "The lead has no form id.", kind: "data", payload });
      return "needs_review";
    }
    if (form.classification === "ignore") {
      await finish(db, row, at, "ignored", { error: `Form “${form.name}” is set to Ignore.`, kind: "mapping", payload });
      return "ignored";
    }
    if (form.classification === "unclassified") {
      await finish(db, row, at, "needs_mapping", {
        error: `Classify form “${form.name}” as owner, tenant or buyer to import its leads.`,
        kind: "mapping",
        payload,
      });
      return "needs_mapping";
    }

    const mapped = mapLead(form, lead);
    const phone = normalizeIndianMobile(mapped.contact.phone);
    if (!phone) {
      const reason = mapped.problems[0] ?? `“${mapped.contact.phone}” is not a valid Indian mobile number.`;
      await finish(db, row, at, "needs_review", { error: reason, kind: "data", payload });
      return "needs_review";
    }
    const contactExisting = Boolean(await findContactByPhone(db, phone));
    const source = sourceFor(lead, form, row, mapped);
    const contact = { ...mapped.contact, phone };

    let entityType: "owner_lead" | "requirement";
    let entityId: string;
    let contactId: string;
    try {
      if (mapped.kind === "owner") {
        const created = await createOwnerLead(db, META_ACTOR, contact, mapped.owner, source, at);
        entityType = "owner_lead";
        entityId = created.id;
        contactId = created.contactId;
      } else {
        const created = await createRequirement(db, META_ACTOR, contact, mapped.requirement, source, at);
        entityType = "requirement";
        entityId = created.id;
        contactId = created.contactId;
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        const raced = await existingEntity(db, row.leadgen_id);
        if (raced) {
          await finish(db, row, at, "duplicate", { ...raced, error: "Imported by a parallel delivery." });
          return "duplicate";
        }
        // Two different leads for the same new mobile number collided; the next attempt finds the contact.
        return scheduleRetry(db, row, now, "Contact was being created at the same moment. Retrying.", "conflict");
      }
      throw error;
    }

    await recordAdEntities(db, lead, at);
    await finish(db, row, at, "done", { entityType, entityId, contactId, contactExisting });
    await touchConnection(db, "last_success_at", at);
    try {
      await (runtime.matching ?? noMatching).onCaptured(db, { kind: entityType, id: entityId, contactId, origin: row.origin });
    } catch (error) {
      console.error("matching trigger failed", error);
    }
    return "done";
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.kind === "auth" || error.kind === "permission") {
        await markTokenRejected(db, error.message, at);
        await finish(db, row, at, "waiting_token", { error: error.message, kind: error.kind });
        return "waiting_token";
      }
      if (error.kind === "permanent") {
        await finish(db, row, at, "failed", { error: error.message, kind: error.kind });
        return "failed";
      }
      const outcome = await scheduleRetry(db, row, now, error.message, error.kind, error.kind === "rate_limit" ? Math.max(900, error.retryAfterSeconds ?? 0) : 0);
      return error.kind === "rate_limit" && outcome === "retry" ? "rate_limited" : outcome;
    }
    console.error("meta ingestion failed", error);
    return scheduleRetry(db, row, now, error instanceof Error ? error.message : "Unexpected error", "internal");
  }
}

/** Due rows, oldest first. Stuck "processing" rows whose lock expired are picked up again. */
export async function dueIngestions(db: SqlDb, now: Date, limit: number, filter: { ids?: string[]; importJobId?: string } = {}) {
  const at = now.toISOString();
  if (filter.ids?.length) {
    const placeholders = filter.ids.map((_, index) => `?${index + 2}`).join(", ");
    const { results } = await db
      .prepare(`SELECT id FROM meta_lead_ingestions WHERE id IN (${placeholders}) AND status IN ('pending', 'retry') AND next_attempt_at <= ?1`)
      .bind(at, ...filter.ids)
      .all<{ id: string }>();
    return results.map((item) => item.id);
  }
  const job = filter.importJobId ? "AND import_job_id = ?3" : "";
  const { results } = await db
    .prepare(
      `SELECT id FROM meta_lead_ingestions
       WHERE ((status IN ('pending', 'retry') AND next_attempt_at <= ?1) OR (status = 'processing' AND locked_until < ?1)) ${job}
       ORDER BY next_attempt_at LIMIT ?2`,
    )
    .bind(...([at, limit, ...(filter.importJobId ? [filter.importJobId] : [])] as (string | number)[]))
    .all<{ id: string }>();
  return results.map((item) => item.id);
}

/** Works through due leads until the batch or time budget runs out, or Meta rate-limits us. */
export async function processDue(
  runtime: MetaRuntime,
  options: { limit?: number; budgetMs?: number; ids?: string[]; importJobId?: string } = {},
): Promise<Record<string, number>> {
  const started = Date.now();
  const tally: Record<string, number> = {};
  const ids = await dueIngestions(runtime.db, nowOf(runtime), options.limit ?? 25, options);
  for (const id of ids) {
    if (Date.now() - started > (options.budgetMs ?? 20_000)) break;
    const outcome = await processIngestion(runtime, id);
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    if (outcome === "rate_limited" || outcome === "waiting_token") break;
  }
  return tally;
}

/** Retry from the admin: failed, needs-review and waiting rows go back to the queue. */
export async function requeueIngestions(
  db: SqlDb,
  filter: { ids?: string[]; statuses: IngestionStatus[] },
  now: string,
): Promise<number> {
  const statuses = filter.statuses.filter((status) => ["failed", "needs_review", "needs_mapping", "waiting_token", "retry"].includes(status));
  if (statuses.length === 0) return 0;
  const statusList = statuses.map((status) => `'${status}'`).join(", ");
  if (filter.ids?.length) {
    let total = 0;
    for (const id of filter.ids.slice(0, 200)) {
      const result = await db
        .prepare(
          `UPDATE meta_lead_ingestions SET status = 'pending', attempts = 0, next_attempt_at = ?1, updated_at = ?1
           WHERE id = ?2 AND status IN (${statusList})`,
        )
        .bind(now, id)
        .run();
      total += changedRows(result);
    }
    return total;
  }
  const result = await db
    .prepare(
      `UPDATE meta_lead_ingestions SET status = 'pending', attempts = 0, next_attempt_at = ?1, updated_at = ?1
       WHERE status IN (${statusList})`,
    )
    .bind(now)
    .run();
  return changedRows(result);
}
