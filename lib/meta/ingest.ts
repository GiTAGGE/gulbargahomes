import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { findContactByPhone } from "../crm/contacts";
import { createLandJvEnquiry } from "../crm/land-jv";
import { noMatching, type MatchingTrigger } from "../crm/matching-hook";
import { createOwnerLead } from "../crm/owner-leads";
import { normalizeIndianMobile } from "../crm/phone";
import { createRequirement } from "../crm/requirements";
import { sourceIdForMetaLead, type SourceInput } from "../crm/sources";
import { changedRows, newId, type SqlDb } from "../db/sql";
import { markTokenRejected, readPageToken, touchConnection } from "./connection";
import { getStoredForm, upsertDiscoveredForms } from "./forms";
import { MetaApiError, parseStoredLead, redactTokens, type GraphClient, type MetaLead } from "./graph";
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
  /** ads_read was granted, so lead fetches also ask for campaign, ad set and ad names. */
  adNames?: boolean;
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
  intent_override: string;
  resolved_by: string;
  resolved_at: string | null;
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
      redactTokens(fields.error ?? "").slice(0, 500),
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
       RETURNING id, leadgen_id, page_id, form_id, ad_id, origin, import_job_id, status, attempts, payload_json, received_at, intent_override, resolved_by, resolved_at`,
    )
    .bind(plusMinutes(now, LOCK_MINUTES), at, id)
    .first<IngestionRow>();
}

/**
 * The CRM record for this Meta lead, if any. `ours` means the integration
 * created it: leadgen ids are unique in the queue, so that can only be an
 * earlier attempt of this same row that stopped before it was marked done.
 */
async function existingEntity(db: SqlDb, leadgenId: string) {
  const sourceId = await sourceIdForMetaLead(db, leadgenId);
  if (!sourceId) return null;
  const owner = await db
    .prepare("SELECT id, contact_id, created_by FROM owner_leads WHERE source_id = ?1")
    .bind(sourceId)
    .first<{ id: string; contact_id: string; created_by: string }>();
  if (owner) return { entityType: "owner_lead", entityId: owner.id, contactId: owner.contact_id, ours: owner.created_by === META_ACTOR.id };
  const land = await db
    .prepare("SELECT id, contact_id, created_by FROM land_jv_enquiries WHERE source_id = ?1")
    .bind(sourceId)
    .first<{ id: string; contact_id: string; created_by: string }>();
  if (land) return { entityType: "land_jv_enquiry", entityId: land.id, contactId: land.contact_id, ours: land.created_by === META_ACTOR.id };
  const requirement = await db
    .prepare("SELECT id, contact_id, created_by FROM demand_requirements WHERE source_id = ?1")
    .bind(sourceId)
    .first<{ id: string; contact_id: string; created_by: string }>();
  if (requirement) {
    return { entityType: "requirement", entityId: requirement.id, contactId: requirement.contact_id, ours: requirement.created_by === META_ACTOR.id };
  }
  return { entityType: "lead_source", entityId: sourceId, contactId: undefined, ours: false };
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
    metaAdId: (lead.adId || row.ad_id).slice(0, 64),
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
        ad_id: lead.adId || row.ad_id,
        adset_id: lead.adsetId,
        campaign_id: lead.campaignId,
        platform: lead.platform,
        is_organic: lead.isOrganic,
        created_time: lead.createdTime,
        origin: row.origin,
      },
      answers: mapped.answers,
      decision: mapped.kind === "review" ? undefined : mapped.decision,
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
    if (runtime.pageId && row.page_id && row.page_id !== runtime.pageId) {
      await finish(db, row, at, "ignored", { error: `Lead belongs to Page ${row.page_id}, not the connected Page.`, kind: "ownership" });
      return "ignored";
    }
    const already = await existingEntity(db, row.leadgen_id);
    if (already?.ours) {
      const { ours: _ours, ...entity } = already;
      await finish(db, row, at, "done", { ...entity, error: "Recovered: the lead was created by an earlier attempt that stopped before finishing." });
      return "done";
    }
    if (already) {
      const { ours: _ours, ...entity } = already;
      await finish(db, row, at, "duplicate", { ...entity, error: "This Meta lead was already in the CRM." });
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
      lead = await runtime.graph.getLead(row.leadgen_id, token!, { adNames: runtime.adNames });
      await logEvent(db, row.id, at, "fetch", "ok", "Lead answers retrieved from Graph API");
    }
    const formId = lead.formId || row.form_id;
    let form = await getStoredForm(db, formId);
    const payload = JSON.stringify(lead);
    if (!form && formId) {
      const discovered = await runtime.graph.getForm(formId, token!);
      if (runtime.pageId && discovered.pageId && discovered.pageId !== runtime.pageId) {
        await finish(db, row, at, "ignored", { error: `Form ${formId} belongs to another Page.`, kind: "ownership", payload });
        return "ignored";
      }
      await upsertDiscoveredForms(db, META_ACTOR.id, discovered.pageId || row.page_id || runtime.pageId, [discovered], at);
      form = await getStoredForm(db, formId);
    }
    if (!form) {
      await finish(db, row, at, "needs_review", { error: "The lead has no form id.", kind: "data", payload });
      return "needs_review";
    }
    if (runtime.pageId && form.pageId && form.pageId !== runtime.pageId) {
      await finish(db, row, at, "ignored", { error: `Form “${form.name}” belongs to another Page.`, kind: "ownership", payload });
      return "ignored";
    }
    if (form.classification === "ignore") {
      await finish(db, row, at, "ignored", { error: `Form “${form.name}” is set to Ignore.`, kind: "mapping", payload });
      return "ignored";
    }
    if (form.classification === "unclassified") {
      await finish(db, row, at, "needs_mapping", {
        error: `Classify form “${form.name}” to import its leads.`,
        kind: "mapping",
        payload,
      });
      return "needs_mapping";
    }

    let mapped = mapLead(form, lead, row.intent_override ? { intent: row.intent_override, decidedBy: row.resolved_by } : {});
    if (mapped.kind === "review") {
      await finish(db, row, at, "needs_review", {
        error: mapped.reason,
        kind: mapped.choices.includes("Sale") ? "intent_owner" : "intent_demand",
        payload,
      });
      return "needs_review";
    }
    const phone = normalizeIndianMobile(mapped.contact.phone);
    if (!phone) {
      // The number itself stays in the (role-masked) answers, not in the error text and history.
      const reason = mapped.problems[0] ?? "The mobile number on the form is not a valid Indian mobile number.";
      await finish(db, row, at, "needs_review", { error: reason, kind: "data", payload });
      return "needs_review";
    }
    const contactExisting = Boolean(await findContactByPhone(db, phone));
    const source = sourceFor(lead, form, row, mapped);
    const contact = { ...mapped.contact, phone };

    let entityType: "owner_lead" | "requirement" | "land_jv_enquiry";
    let entityId: string;
    let contactId: string;
    try {
      if (mapped.kind === "owner") {
        const created = await createOwnerLead(db, META_ACTOR, contact, mapped.owner, source, at);
        entityType = "owner_lead";
        entityId = created.id;
        contactId = created.contactId;
      } else if (mapped.kind === "land_jv") {
        const created = await createLandJvEnquiry(db, META_ACTOR, contact, mapped.enquiry, source, at);
        entityType = "land_jv_enquiry";
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
          const { ours: _ours, ...entity } = raced;
          await finish(db, row, at, "duplicate", { ...entity, error: "Imported by a parallel delivery." });
          return "duplicate";
        }
        // Two different leads for the same new mobile number collided; the next attempt finds the contact.
        return scheduleRetry(db, row, now, "Contact was being created at the same moment. Retrying.", "conflict");
      }
      throw error;
    }

    if (row.resolved_by) {
      const staff = await db
        .prepare("SELECT id, email, role FROM admin_users WHERE id = ?1")
        .bind(row.resolved_by)
        .first<{ id: string; email: string; role: string }>();
      await auditStatement(db, {
        actor: staff ?? { id: row.resolved_by, email: "", role: "" },
        entityType,
        entityId,
        action: "decide_intent",
        changes: { intent: ["", mapped.decision.intent] },
        context: { leadgen_id: row.leadgen_id, ingestion_id: row.id, resolved_at: row.resolved_at },
        at,
      }).run();
    }

    await recordAdEntities(db, lead, at);
    await finish(db, row, at, "done", { entityType, entityId, contactId, contactExisting });
    await touchConnection(db, "last_success_at", at);
    try {
      if (entityType !== "land_jv_enquiry") {
        await (runtime.matching ?? noMatching).onCaptured(db, { kind: entityType, id: entityId, contactId, origin: row.origin });
      }
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

const IMPORT_AS = ["Buy", "Rent", "Sale", "Lease", "Land JV"] as const;
export type ImportAsIntent = (typeof IMPORT_AS)[number];

/**
 * A staff member chooses the intent for a lead the importer refused to guess.
 * The choice is stored on the queue row before anything is created, so a second
 * click, a retry, or the sweep finds the same decision and the leadgen id
 * still prevents a second CRM record.
 */
export async function resolveIngestionIntent(
  db: SqlDb,
  actor: AuditActor,
  id: string,
  intent: string,
  now: string,
): Promise<{ ready: boolean; entityType: string | null; entityId: string | null }> {
  if (!(IMPORT_AS as readonly string[]).includes(intent)) throw new HttpError(400, "Choose Buy, Rent, Sale, Lease or Land JV.");
  const row = await db
    .prepare("SELECT id, status, last_error_kind, form_id, entity_type, entity_id FROM meta_lead_ingestions WHERE id = ?1")
    .bind(id)
    .first<{ id: string; status: string; last_error_kind: string; form_id: string; entity_type: string | null; entity_id: string | null }>();
  if (!row) throw new HttpError(404, "Lead not found.");
  if (row.status === "done" || row.status === "duplicate") {
    return { ready: false, entityType: row.entity_type, entityId: row.entity_id };
  }
  const form = await getStoredForm(db, row.form_id);
  const allowed =
    form?.classification === "land_jv"
      ? ["Land JV", "Sale", "Rent", "Lease"]
      : form?.classification === "owner"
        ? ["Sale", "Rent", "Lease"]
        : ["Buy", "Rent"];
  if (!allowed.includes(intent)) {
    throw new HttpError(
      400,
      form?.classification === "land_jv"
        ? "Choose Record as Land JV, or Import as Sale, Rent or Lease."
        : form?.classification === "owner"
          ? "Choose Sale, Rent or Lease."
          : "Choose Buy or Rent.",
    );
  }
  if (row.status !== "needs_review" || (row.last_error_kind !== "intent_demand" && row.last_error_kind !== "intent_owner")) {
    throw new HttpError(409, "This lead is no longer waiting for that decision.");
  }
  const result = await db
    .prepare(
      `UPDATE meta_lead_ingestions
       SET intent_override = ?1, resolved_by = ?2, resolved_at = ?3, status = 'pending', attempts = 0,
           next_attempt_at = ?3, locked_until = NULL, last_error = '', updated_at = ?3
       WHERE id = ?4 AND status = 'needs_review' AND last_error_kind IN ('intent_demand', 'intent_owner')`,
    )
    .bind(intent, actor.id, now, id)
    .run();
  if (changedRows(result) === 0) {
    const again = await db
      .prepare("SELECT status, entity_type, entity_id FROM meta_lead_ingestions WHERE id = ?1")
      .bind(id)
      .first<{ status: string; entity_type: string | null; entity_id: string | null }>();
    if (again && (again.status === "done" || again.status === "duplicate")) {
      return { ready: false, entityType: again.entity_type, entityId: again.entity_id };
    }
    return { ready: false, entityType: null, entityId: null };
  }
  await auditStatement(db, {
    actor,
    entityType: "integration",
    entityId: "meta",
    entityLabel: "Meta Lead Ads",
    action: "resolve_intent",
    changes: { intent: ["", intent] },
    context: { ingestion_id: id },
    at: now,
  }).run();
  return { ready: true, entityType: null, entityId: null };
}

/** Statuses a scoped retry may move. Review holds stay put until someone resolves them one by one. */
const RETRYABLE_STATUSES = ["failed", "needs_mapping", "waiting_token", "retry"] as const;

/**
 * Put selected queue rows back to pending. Requires the lead ids and the one form they belong to.
 * An empty selection, a held review row, or an id from another form updates nothing.
 * The check and the write are one statement, so a status that changes at the same time does not leave a partial retry.
 */
export async function requeueIngestions(
  db: SqlDb,
  filter: { ids: string[]; formId: string },
  now: string,
): Promise<number> {
  const ids = [...new Set(filter.ids)].filter((id) => /^mli_[0-9a-f]{20}$/.test(id)).slice(0, 200);
  if (ids.length === 0) throw new HttpError(400, "Choose the leads to retry.");
  if (!/^\d{5,40}$/.test(filter.formId)) throw new HttpError(400, "Choose one form.");

  const statusList = RETRYABLE_STATUSES.map((status) => `'${status}'`).join(", ");
  const idPlaceholders = ids.map((_, index) => `?${index + 3}`).join(", ");
  const countPlaceholder = ids.length + 3;
  const result = await db
    .prepare(
      `WITH chosen AS (
         SELECT id FROM meta_lead_ingestions
         WHERE form_id = ?2 AND id IN (${idPlaceholders}) AND status IN (${statusList})
       )
       UPDATE meta_lead_ingestions
       SET status = 'pending', attempts = 0, next_attempt_at = ?1, updated_at = ?1
       WHERE id IN (SELECT id FROM chosen)
         AND (SELECT COUNT(*) FROM chosen) = ?${countPlaceholder}`,
    )
    .bind(now, filter.formId, ...ids, ids.length)
    .run();
  const changed = changedRows(result);
  if (changed !== ids.length) {
    throw new HttpError(400, "Those leads are not all failed leads on this form. Nothing was retried.");
  }
  return changed;
}

/** Staff decided not to import these. The queue's copy of the answers is dropped at once. */
export async function dismissIngestions(db: SqlDb, actor: AuditActor, ids: string[], now: string): Promise<number> {
  let total = 0;
  for (const id of ids.slice(0, 200)) {
    const [result] = await db.batch([
      db
        .prepare(
          `UPDATE meta_lead_ingestions SET status = 'ignored', last_error = 'Dismissed by an admin', payload_json = '', updated_at = ?1
           WHERE id = ?2 AND status IN ('failed', 'needs_review', 'needs_mapping')`,
        )
        .bind(now, id),
      auditStatement(db, {
        actor,
        entityType: "integration",
        entityId: "meta",
        entityLabel: "Meta Lead Ads",
        action: "dismiss_ingestion",
        context: { ingestion_id: id },
        at: now,
        onlyIfPreviousChanged: true,
      }),
    ]);
    total += changedRows(result);
  }
  return total;
}

/** Days the queue keeps a copy of answers it did not import, and the webhook delivery log. */
export const QUEUE_PAYLOAD_RETENTION_DAYS = 30;
export const DELIVERY_LOG_RETENTION_DAYS = 90;

/**
 * Housekeeping for integration data only. CRM records (contacts, leads,
 * requirements and their lead sources) are never touched here.
 */
export async function purgeExpiredQueueData(db: SqlDb, now: Date) {
  const payloadBefore = new Date(now.getTime() - QUEUE_PAYLOAD_RETENTION_DAYS * 86_400_000).toISOString();
  const deliveriesBefore = new Date(now.getTime() - DELIVERY_LOG_RETENTION_DAYS * 86_400_000).toISOString();
  const [payloads, deliveries] = await db.batch([
    db
      .prepare(
        `UPDATE meta_lead_ingestions SET payload_json = ''
         WHERE payload_json != '' AND status IN ('ignored', 'failed', 'done', 'duplicate') AND updated_at < ?1`,
      )
      .bind(payloadBefore),
    db.prepare("DELETE FROM meta_webhook_deliveries WHERE received_at < ?1").bind(deliveriesBefore),
  ]);
  return { payloadsCleared: changedRows(payloads), deliveriesDeleted: changedRows(deliveries) };
}
