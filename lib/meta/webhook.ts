import { newId, type SqlDb } from "../db/sql";
import type { MetaConfig } from "./config";
import { getConnection, touchConnection } from "./connection";
import { constantTimeEqual, verifyMetaSignature } from "./crypto";
import { enqueueLead } from "./ingest";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type LeadgenChange = {
  leadgenId: string;
  pageId: string;
  formId: string;
  adId: string;
  createdTime: string | null;
};

/** GET handshake from the Meta dashboard. Returns the challenge to echo, or null. */
export function verifySubscription(config: MetaConfig, params: URLSearchParams): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !config.verifyToken || !challenge) return null;
  if (!constantTimeEqual(token, config.verifyToken)) return null;
  return /^[\w-]{1,200}$/.test(challenge) ? challenge : null;
}

export function parseLeadgenChanges(body: unknown): { object: string; changes: LeadgenChange[] } {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const object = typeof data.object === "string" ? data.object : "";
  const entries = Array.isArray(data.entry) ? data.entry : [];
  const changes: LeadgenChange[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; changes?: unknown };
    for (const change of Array.isArray(record.changes) ? record.changes : []) {
      if (!change || typeof change !== "object") continue;
      const { field, value } = change as { field?: unknown; value?: Record<string, unknown> };
      if (field !== "leadgen" || !value || typeof value !== "object") continue;
      const leadgenId = String(value.leadgen_id ?? "");
      if (!/^\d{5,40}$/.test(leadgenId)) continue;
      const created = Number(value.created_time);
      changes.push({
        leadgenId,
        pageId: String(value.page_id ?? record.id ?? ""),
        formId: String(value.form_id ?? ""),
        adId: String(value.ad_id ?? ""),
        createdTime: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : null,
      });
    }
  }
  return { object, changes };
}

export type WebhookResult =
  | { status: 401 | 413 | 503; body: string; ids: [] }
  | { status: 200; body: string; ids: string[]; created: number; repeats: number; ignored: number };

/**
 * Verifies, stores and acknowledges. Processing happens afterwards. If the
 * database write fails the caller returns 500 and Meta redelivers.
 */
export async function receiveWebhook(
  db: SqlDb,
  config: MetaConfig,
  input: { rawBody: string; signature: string | null; now: string },
): Promise<WebhookResult> {
  if (!config.appSecret) return { status: 503, body: "Meta webhook is not configured.", ids: [] };
  if (input.rawBody.length > MAX_WEBHOOK_BYTES) return { status: 413, body: "Payload too large.", ids: [] };

  const valid = await verifyMetaSignature(config.appSecret, input.rawBody, input.signature);
  if (!valid) {
    await db
      .prepare(
        "INSERT INTO meta_webhook_deliveries (id, received_at, signature_valid, note) VALUES (?1, ?2, 0, 'Rejected: invalid or missing X-Hub-Signature-256')",
      )
      .bind(newId("mwd"), input.now)
      .run();
    return { status: 401, body: "Invalid signature.", ids: [] };
  }

  let parsed: { object: string; changes: LeadgenChange[] };
  try {
    parsed = parseLeadgenChanges(JSON.parse(input.rawBody));
  } catch {
    parsed = { object: "", changes: [] };
  }

  const connection = await getConnection(db);
  const ids: string[] = [];
  let created = 0;
  let repeats = 0;
  let ignored = 0;
  for (const change of parsed.changes) {
    if (connection.pageId && change.pageId && change.pageId !== connection.pageId) {
      ignored += 1;
      continue;
    }
    const result = await enqueueLead(
      db,
      {
        leadgenId: change.leadgenId,
        pageId: change.pageId,
        formId: change.formId,
        adId: change.adId,
        createdTime: change.createdTime,
        origin: "webhook",
      },
      input.now,
    );
    ids.push(result.id);
    if (result.isNew) created += 1;
    else repeats += 1;
  }

  await db
    .prepare(
      `INSERT INTO meta_webhook_deliveries (id, received_at, signature_valid, object, leadgen_count, new_count, repeat_count, note)
       VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      newId("mwd"),
      input.now,
      parsed.object.slice(0, 40),
      parsed.changes.length,
      created,
      repeats,
      ignored ? `${ignored} lead(s) for another Page ignored` : parsed.changes.length ? "" : "No leadgen changes",
    )
    .run();
  if (parsed.changes.length) await touchConnection(db, "last_webhook_at", input.now);

  return { status: 200, body: "EVENT_RECEIVED", ids, created, repeats, ignored };
}
