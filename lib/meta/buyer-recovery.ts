import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { normalizeIndianMobile } from "../crm/phone";
import { newId, parseJson, type SqlDb } from "../db/sql";
import { getStoredForm, type StoredForm } from "./forms";
import type { MetaLead } from "./graph";
import { enqueueLead, processDue, type MetaRuntime } from "./ingest";
import { approvedBuyerRenterIntent } from "./values";
import { readPageToken } from "./connection";

/** The only forms this recovery may read. Mixed historical import stays closed. */
export const BUYER_RECOVERY_FORM_IDS = ["1071121499253613", "1489593689660590"] as const;

export const BUYER_RECOVERY_CAMPAIGN_ID = "120257140076410091";

const EXPECTED_BY_FORM: Record<(typeof BUYER_RECOVERY_FORM_IDS)[number], { total: number; buy: number; rent: number }> = {
  "1071121499253613": { total: 142, buy: 103, rent: 39 },
  "1489593689660590": { total: 1, buy: 1, rent: 0 },
};

export const BUYER_RECOVERY_EXPECTED = { total: 143, buy: 104, rent: 39, campaignId: BUYER_RECOVERY_CAMPAIGN_ID };

const BATCH = 20;

export type BuyerRecoveryLead = {
  leadgenId: string;
  formId: string;
  intent: "Buy" | "Rent" | "unclassified";
  campaignId: string;
  createdTime: string;
  phoneValid: boolean;
  alreadyQueued: boolean;
  existingContact: boolean;
};

export type BuyerRecoveryPreview = {
  total: number;
  buy: number;
  rent: number;
  unclassified: number;
  invalidPhone: number;
  alreadyQueued: number;
  existingContacts: number;
  campaigns: { id: string; count: number }[];
  createdMin: string;
  createdMax: string;
  leadIds: string[];
  forms: { formId: string; name: string; total: number; buy: number; rent: number; ready: boolean; reason: string }[];
  expected: typeof BUYER_RECOVERY_EXPECTED;
  discrepancies: string[];
  mappingIssues: string[];
  blocked: boolean;
};

export type BuyerRecoveryRun = {
  id: string;
  status: string;
  formIds: string[];
  preview: BuyerRecoveryPreview | null;
  createdBy: string;
  createdAt: string;
  confirmedAt: string;
  finishedAt: string;
  enqueueDuplicates: number;
  imported: number;
  duplicates: number;
  held: number;
  failed: number;
  lastError: string;
};

type RunRow = {
  id: string;
  status: string;
  form_ids_json: string;
  preview_json: string;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
  finished_at: string | null;
  enqueue_duplicates: number;
  imported: number;
  duplicates: number;
  held: number;
  failed: number;
  last_error: string;
};

function toRun(row: RunRow): BuyerRecoveryRun {
  return {
    id: row.id,
    status: row.status,
    formIds: parseJson<string[]>(row.form_ids_json, []),
    preview: parseJson<BuyerRecoveryPreview | null>(row.preview_json, null),
    createdBy: row.created_by,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? "",
    finishedAt: row.finished_at ?? "",
    enqueueDuplicates: Number(row.enqueue_duplicates),
    imported: Number(row.imported),
    duplicates: Number(row.duplicates),
    held: Number(row.held),
    failed: Number(row.failed),
    lastError: row.last_error,
  };
}

export function approvedRecoveryFormIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, "Choose the Buyer & Renter forms to preview.");
  const ids = value.filter((id): id is string => typeof id === "string");
  if (ids.length !== value.length || new Set(ids).size !== ids.length) {
    throw new HttpError(400, "Choose only the two approved Buyer & Renter forms.");
  }
  for (const id of ids) {
    if (!(BUYER_RECOVERY_FORM_IDS as readonly string[]).includes(id)) {
      throw new HttpError(400, "Only the two approved Buyer & Renter forms can be recovered. Other forms stay on their own workflows.");
    }
  }
  return ids;
}

function intentOf(lead: MetaLead): BuyerRecoveryLead["intent"] {
  const found = new Set<"Buy" | "Rent">();
  for (const field of lead.fieldData) {
    for (const value of field.values) {
      const approved = approvedBuyerRenterIntent(value.trim());
      if (approved) found.add(approved);
    }
  }
  return found.size === 1 ? [...found][0] : "unclassified";
}

function phoneOf(lead: MetaLead): string {
  for (const field of lead.fieldData) {
    if (field.name !== "phone" && field.name !== "phone_number") continue;
    return normalizeIndianMobile(field.values[0] ?? "") ?? "";
  }
  return "";
}

function formReady(form: StoredForm | null, formId: string): { ready: boolean; reason: string; name: string } {
  if (!form) return { ready: false, name: formId, reason: "Refresh forms before recovery. This form is not stored yet." };
  if (form.classification !== "mixed") {
    return {
      ready: false,
      name: form.name,
      reason: `${form.name} is not classified as Buyer or tenant, from the answer. Save that classification before recovery. Recovery will not classify it for you.`,
    };
  }
  const mapping = form.mapping;
  const targets = new Set(Object.values(mapping));
  if (targets.has("budget")) {
    return { ready: false, name: form.name, reason: `${form.name} still has a generic budget mapping. Save Purchase budget and Monthly rental budget before recovery.` };
  }
  if (!targets.has("intent")) return { ready: false, name: form.name, reason: `${form.name} has no Buy or Rent question mapped.` };
  if (!targets.has("purchase_budget")) return { ready: false, name: form.name, reason: `${form.name} has no purchase budget mapped.` };
  if (!targets.has("rent_budget")) return { ready: false, name: form.name, reason: `${form.name} has no rental budget mapped.` };
  const phoneMapped = form.questions.some((question) => mapping[question.key] === "phone" || question.key === "phone" || question.key === "phone_number");
  if (!phoneMapped) return { ready: false, name: form.name, reason: `${form.name} has no phone question.` };
  return { ready: true, name: form.name, reason: "" };
}

async function existingLeadIds(db: SqlDb, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const marks = ids.map(() => "?").join(", ");
  const queued = await db.prepare(`SELECT leadgen_id FROM meta_lead_ingestions WHERE leadgen_id IN (${marks})`).bind(...ids).all<{ leadgen_id: string }>();
  const sourced = await db.prepare(`SELECT meta_lead_id FROM lead_sources WHERE meta_lead_id IN (${marks})`).bind(...ids).all<{ meta_lead_id: string }>();
  return new Set([...queued.results.map((row) => row.leadgen_id), ...sourced.results.map((row) => row.meta_lead_id)]);
}

async function existingPhones(db: SqlDb, phones: string[]): Promise<Set<string>> {
  const unique = [...new Set(phones.filter(Boolean))];
  if (!unique.length) return new Set();
  const marks = unique.map(() => "?").join(", ");
  const { results } = await db.prepare(`SELECT phone_e164 FROM contacts WHERE phone_e164 IN (${marks})`).bind(...unique).all<{ phone_e164: string }>();
  return new Set(results.map((row) => row.phone_e164));
}

function summarize(
  leads: BuyerRecoveryLead[],
  forms: BuyerRecoveryPreview["forms"],
): BuyerRecoveryPreview {
  const campaigns = new Map<string, number>();
  let buy = 0;
  let rent = 0;
  let unclassified = 0;
  let invalidPhone = 0;
  let alreadyQueued = 0;
  let existingContacts = 0;
  let createdMin = "";
  let createdMax = "";
  for (const lead of leads) {
    if (lead.intent === "Buy") buy += 1;
    else if (lead.intent === "Rent") rent += 1;
    else unclassified += 1;
    if (!lead.phoneValid) invalidPhone += 1;
    if (lead.alreadyQueued) alreadyQueued += 1;
    if (lead.existingContact) existingContacts += 1;
    campaigns.set(lead.campaignId || "(missing)", (campaigns.get(lead.campaignId || "(missing)") ?? 0) + 1);
    if (!createdMin || lead.createdTime < createdMin) createdMin = lead.createdTime;
    if (lead.createdTime > createdMax) createdMax = lead.createdTime;
  }
  const discrepancies: string[] = [];
  if (leads.length !== BUYER_RECOVERY_EXPECTED.total || buy !== BUYER_RECOVERY_EXPECTED.buy || rent !== BUYER_RECOVERY_EXPECTED.rent || unclassified !== 0) {
    discrepancies.push(
      `Meta returned ${leads.length} leads (${buy} Buy, ${rent} Rent, ${unclassified} unclassified). Expected ${BUYER_RECOVERY_EXPECTED.total} (${BUYER_RECOVERY_EXPECTED.buy} Buy, ${BUYER_RECOVERY_EXPECTED.rent} Rent). Nothing was imported.`,
    );
  }
  for (const form of forms) {
    const expected = EXPECTED_BY_FORM[form.formId as (typeof BUYER_RECOVERY_FORM_IDS)[number]];
    if (!expected) continue;
    if (form.total !== expected.total || form.buy !== expected.buy || form.rent !== expected.rent) {
      discrepancies.push(
        `${form.name} returned ${form.total} leads (${form.buy} Buy, ${form.rent} Rent). Expected ${expected.total} (${expected.buy} Buy, ${expected.rent} Rent).`,
      );
    }
  }
  const unexpectedCampaigns = [...campaigns.keys()].filter((id) => id !== BUYER_RECOVERY_CAMPAIGN_ID);
  if (leads.length && unexpectedCampaigns.length) {
    discrepancies.push(`Every lead must belong to campaign ${BUYER_RECOVERY_CAMPAIGN_ID}. Found ${unexpectedCampaigns.join(", ")}.`);
  }
  const mappingIssues = forms.filter((form) => !form.ready).map((form) => form.reason);
  return {
    total: leads.length,
    buy,
    rent,
    unclassified,
    invalidPhone,
    alreadyQueued,
    existingContacts,
    campaigns: [...campaigns.entries()].map(([id, count]) => ({ id, count })),
    createdMin,
    createdMax,
    leadIds: leads.map((lead) => lead.leadgenId),
    forms,
    expected: BUYER_RECOVERY_EXPECTED,
    discrepancies,
    mappingIssues,
    blocked: discrepancies.length > 0 || mappingIssues.length > 0,
  };
}

async function loadLeads(runtime: MetaRuntime, formIds: string[]): Promise<{ leads: MetaLead[]; preview: BuyerRecoveryPreview }> {
  const pageToken = await readPageToken(runtime.db, runtime.tokenKey);
  if (!pageToken) throw new HttpError(400, "Reconnect Meta before recovering leads. The Page token is missing.");
  const selected = new Set(formIds);
  const forms: BuyerRecoveryPreview["forms"] = [];
  const raw: MetaLead[] = [];
  for (const formId of BUYER_RECOVERY_FORM_IDS) {
    if (!selected.has(formId)) continue;
    const stored = await getStoredForm(runtime.db, formId);
    const ready = formReady(stored, formId);
    const fetched = await runtime.graph.listAllFormLeads(formId, pageToken, { adNames: runtime.adNames });
    raw.push(...fetched);
    const classified = fetched.map(intentOf);
    forms.push({
      formId,
      name: ready.name,
      total: fetched.length,
      buy: classified.filter((intent) => intent === "Buy").length,
      rent: classified.filter((intent) => intent === "Rent").length,
      ready: ready.ready,
      reason: ready.reason,
    });
  }
  const ids = raw.map((lead) => lead.id);
  const queued = await existingLeadIds(runtime.db, ids);
  const phones = raw.map(phoneOf);
  const knownPhones = await existingPhones(runtime.db, phones);
  const leads: BuyerRecoveryLead[] = raw.map((lead, index) => ({
    leadgenId: lead.id,
    formId: lead.formId,
    intent: intentOf(lead),
    campaignId: lead.campaignId,
    createdTime: lead.createdTime,
    phoneValid: Boolean(phones[index]),
    alreadyQueued: queued.has(lead.id),
    existingContact: Boolean(phones[index] && knownPhones.has(phones[index])),
  }));
  return { leads: raw, preview: summarize(leads, forms) };
}

export async function latestBuyerRecovery(db: SqlDb): Promise<BuyerRecoveryRun | null> {
  const row = await db.prepare(`SELECT * FROM meta_buyer_recovery_runs ORDER BY created_at DESC, id DESC LIMIT 1`).first<RunRow>();
  return row ? toRun(row) : null;
}

export async function getBuyerRecovery(db: SqlDb, id: string): Promise<BuyerRecoveryRun | null> {
  const row = await db.prepare(`SELECT * FROM meta_buyer_recovery_runs WHERE id = ?1`).bind(id).first<RunRow>();
  return row ? toRun(row) : null;
}

/** Reads Meta and stores a preview. It does not enqueue or create CRM records. */
export async function previewBuyerRecovery(runtime: MetaRuntime, actor: AuditActor, formIds: unknown, now: string): Promise<BuyerRecoveryRun> {
  const ids = approvedRecoveryFormIds(formIds);
  const { preview } = await loadLeads(runtime, ids);
  const id = newId("mbr");
  const status = preview.blocked ? "blocked" : "previewed";
  await runtime.db.batch([
    runtime.db
      .prepare(
        `INSERT INTO meta_buyer_recovery_runs (
           id, status, form_ids_json, preview_json, created_by, created_at, updated_at, last_error
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)`,
      )
      .bind(id, status, JSON.stringify(ids), JSON.stringify(preview), actor.id, now, preview.blocked ? preview.discrepancies.concat(preview.mappingIssues).join(" ") : ""),
    auditStatement(runtime.db, {
      actor,
      entityType: "meta_import",
      entityId: id,
      entityLabel: "Historical Buyer & Renter Recovery preview",
      action: "preview",
      context: {
        forms: ids.join(","),
        total: preview.total,
        buy: preview.buy,
        rent: preview.rent,
        blocked: preview.blocked,
        discrepancies: preview.discrepancies.join(" "),
        mapping_issues: preview.mappingIssues.join(" "),
      },
      at: now,
    }),
  ]);
  return (await getBuyerRecovery(runtime.db, id))!;
}

async function recount(db: SqlDb, runId: string, enqueueDuplicates: number) {
  const { results } = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM meta_lead_ingestions WHERE recovery_run_id = ?1 GROUP BY status`)
    .bind(runId)
    .all<{ status: string; n: number }>();
  const count = (status: string) => results.find((row) => row.status === status)?.n ?? 0;
  const open = count("pending") + count("retry") + count("processing") + count("waiting_token");
  return {
    imported: count("done"),
    duplicates: enqueueDuplicates + count("duplicate"),
    held: count("needs_review") + count("needs_mapping") + count("waiting_token") + count("ignored"),
    failed: count("failed"),
    open,
  };
}

/**
 * Re-reads Meta, and enqueues only when the live result still matches the preview
 * and the expected 104 Buy / 39 Rent split. A difference blocks the run.
 */
export async function confirmBuyerRecovery(runtime: MetaRuntime, actor: AuditActor, runId: string, now: string): Promise<BuyerRecoveryRun> {
  const current = await getBuyerRecovery(runtime.db, runId);
  if (!current || current.status !== "previewed" || !current.preview || current.preview.blocked) {
    throw new HttpError(409, "Preview the two forms again. A blocked or stale preview cannot be imported.");
  }
  const { leads, preview } = await loadLeads(runtime, current.formIds);
  const previewIds = new Set(current.preview.leadIds);
  const sameIds = preview.leadIds.length === current.preview.leadIds.length && preview.leadIds.every((id) => previewIds.has(id));
  if (preview.blocked || !sameIds) {
    const discrepancies = sameIds ? preview.discrepancies : ["Meta returned a different set of lead IDs than the preview. Nothing was imported.", ...preview.discrepancies];
    const blockedPreview = { ...preview, discrepancies, blocked: true };
    await runtime.db
      .prepare(`UPDATE meta_buyer_recovery_runs SET status = 'blocked', preview_json = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1`)
      .bind(runId, JSON.stringify(blockedPreview), discrepancies.concat(preview.mappingIssues).join(" "), now)
      .run();
    throw new HttpError(409, discrepancies[0] || preview.mappingIssues[0] || "Recovery is blocked. Nothing was imported.");
  }
  let queued = 0;
  let duplicates = 0;
  for (const lead of leads) {
    const result = await enqueueLead(runtime.db, {
      leadgenId: lead.id,
      pageId: runtime.pageId,
      formId: lead.formId,
      adId: lead.adId,
      createdTime: lead.createdTime,
      origin: "recovery",
      recoveryRunId: runId,
      lead,
    }, now);
    if (result.isNew) queued += 1;
    else duplicates += 1;
  }
  await runtime.db
    .prepare(
      `UPDATE meta_buyer_recovery_runs
       SET status = 'running', confirmed_at = ?2, enqueue_duplicates = ?3, duplicates = ?3, updated_at = ?2, last_error = ''
       WHERE id = ?1`,
    )
    .bind(runId, now, duplicates)
    .run();
  await runtime.db.batch([
    auditStatement(runtime.db, {
      actor,
      entityType: "meta_import",
      entityId: runId,
      entityLabel: "Historical Buyer & Renter Recovery",
      action: "confirm",
      context: { queued, duplicates, total: preview.total, buy: preview.buy, rent: preview.rent, forms: current.formIds.join(",") },
      at: now,
    }),
  ]);
  return runBuyerRecoveryStep(runtime, actor, runId, now);
}

/** Processes the next batch of this run. Safe to call again after a partial failure. */
export async function runBuyerRecoveryStep(runtime: MetaRuntime, actor: AuditActor, runId: string, now: string): Promise<BuyerRecoveryRun> {
  const current = await getBuyerRecovery(runtime.db, runId);
  if (!current || (current.status !== "running" && current.status !== "previewed")) {
    throw new HttpError(409, "There is no recovery in progress.");
  }
  const { results } = await runtime.db
    .prepare(
      `SELECT id FROM meta_lead_ingestions
       WHERE recovery_run_id = ?1 AND status IN ('pending', 'retry', 'processing')
       ORDER BY received_at LIMIT ?2`,
    )
    .bind(runId, BATCH)
    .all<{ id: string }>();
  let lastError = "";
  if (results.length) {
    const tally = await processDue(runtime, { ids: results.map((row) => row.id), limit: BATCH });
    if (tally.rate_limited) lastError = "Meta rate-limited this batch. Continue the recovery to retry the remaining leads.";
    else if (tally.waiting_token) lastError = "The Page token could not be read. Reconnect Meta, then continue the recovery.";
    else if (!Object.keys(tally).length) lastError = "The next batch is waiting for Meta's retry window. Continue the recovery again shortly.";
  }
  const counts = await recount(runtime.db, runId, current.enqueueDuplicates);
  const done = counts.open === 0 && !lastError;
  await runtime.db
    .prepare(
      `UPDATE meta_buyer_recovery_runs
       SET status = ?2, imported = ?3, duplicates = ?4, held = ?5, failed = ?6, last_error = ?7,
           finished_at = CASE WHEN ?2 = 'completed' THEN ?8 ELSE finished_at END, updated_at = ?8
       WHERE id = ?1`,
    )
    .bind(runId, done ? "completed" : "running", counts.imported, counts.duplicates, counts.held, counts.failed, lastError, now)
    .run();
  if (done) {
    await runtime.db.batch([
      auditStatement(runtime.db, {
        actor,
        entityType: "meta_import",
        entityId: runId,
        entityLabel: "Historical Buyer & Renter Recovery",
        action: "complete",
        context: counts,
        at: now,
      }),
    ]);
  }
  return (await getBuyerRecovery(runtime.db, runId))!;
}
