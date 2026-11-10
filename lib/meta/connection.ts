import { auditStatement, type AuditActor } from "../admin/audit";
import { parseJson, type SqlDb } from "../db/sql";
import { decryptToken, encryptToken } from "./crypto";

export const CONNECTION_ID = "primary";

export const CONNECTION_STATUSES = ["disconnected", "pending_page", "connected", "expired", "error"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

type ConnectionRow = {
  id: string;
  status: string;
  page_id: string;
  page_name: string;
  meta_user_name: string;
  user_token_enc: string;
  user_token_expires_at: string | null;
  page_token_enc: string;
  page_token_expires_at: string | null;
  data_access_expires_at: string | null;
  scopes_json: string;
  webhook_subscribed: number;
  connected_by: string | null;
  connected_at: string | null;
  last_checked_at: string | null;
  last_error: string;
  last_webhook_at: string | null;
  last_success_at: string | null;
  updated_at: string;
  row_version: number;
};

/** What the admin UI may see. Token ciphertext never leaves this module. */
export type MetaConnectionView = {
  status: ConnectionStatus;
  pageId: string;
  pageName: string;
  metaUserName: string;
  hasPageToken: boolean;
  awaitingPageChoice: boolean;
  pageTokenExpiresAt: string | null;
  dataAccessExpiresAt: string | null;
  scopes: string[];
  webhookSubscribed: boolean;
  connectedBy: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string;
  lastWebhookAt: string | null;
  lastSuccessAt: string | null;
};

const PURPOSE = { user: "meta_connection.user_token", page: "meta_connection.page_token" } as const;

async function row(db: SqlDb): Promise<ConnectionRow | null> {
  return db.prepare("SELECT * FROM meta_connection WHERE id = ?1").bind(CONNECTION_ID).first<ConnectionRow>();
}

async function ensureRow(db: SqlDb, now: string) {
  await db
    .prepare("INSERT INTO meta_connection (id, status, updated_at) VALUES (?1, 'disconnected', ?2) ON CONFLICT(id) DO NOTHING")
    .bind(CONNECTION_ID, now)
    .run();
}

export async function getConnection(db: SqlDb): Promise<MetaConnectionView> {
  const current = await row(db);
  const status = (current?.status ?? "disconnected") as ConnectionStatus;
  return {
    status: (CONNECTION_STATUSES as readonly string[]).includes(status) ? status : "error",
    pageId: current?.page_id ?? "",
    pageName: current?.page_name ?? "",
    metaUserName: current?.meta_user_name ?? "",
    hasPageToken: Boolean(current?.page_token_enc),
    awaitingPageChoice: Boolean(current?.user_token_enc),
    pageTokenExpiresAt: current?.page_token_expires_at ?? null,
    dataAccessExpiresAt: current?.data_access_expires_at ?? null,
    scopes: parseJson<string[]>(current?.scopes_json, []),
    webhookSubscribed: Boolean(current?.webhook_subscribed),
    connectedBy: current?.connected_by ?? null,
    connectedAt: current?.connected_at ?? null,
    lastCheckedAt: current?.last_checked_at ?? null,
    lastError: current?.last_error ?? "",
    lastWebhookAt: current?.last_webhook_at ?? null,
    lastSuccessAt: current?.last_success_at ?? null,
  };
}

export async function readPageToken(db: SqlDb, tokenKey: string): Promise<string | null> {
  const current = await row(db);
  if (!current?.page_token_enc || !tokenKey) return null;
  if (current.status !== "connected") return null;
  return decryptToken(tokenKey, current.page_token_enc, PURPOSE.page);
}

export async function readUserToken(db: SqlDb, tokenKey: string): Promise<string | null> {
  const current = await row(db);
  if (!current?.user_token_enc || !tokenKey) return null;
  return decryptToken(tokenKey, current.user_token_enc, PURPOSE.user);
}

/** After OAuth: keep the long-lived user token only until a Page is chosen. */
export async function storeUserToken(
  db: SqlDb,
  actor: AuditActor,
  input: { tokenKey: string; token: string; expiresAt: string | null; userName: string; scopes: string[]; now: string },
) {
  await ensureRow(db, input.now);
  const sealed = await encryptToken(input.tokenKey, input.token, PURPOSE.user);
  await db.batch([
    db
      .prepare(
        `UPDATE meta_connection SET user_token_enc = ?1, user_token_expires_at = ?2, meta_user_name = ?3, scopes_json = ?4,
           status = CASE WHEN status = 'connected' THEN status ELSE 'pending_page' END,
           last_error = '', updated_at = ?5, row_version = row_version + 1
         WHERE id = ?6`,
      )
      .bind(sealed, input.expiresAt, input.userName, JSON.stringify(input.scopes), input.now, CONNECTION_ID),
    auditStatement(db, {
      actor,
      entityType: "integration",
      entityId: "meta",
      entityLabel: "Meta Lead Ads",
      action: "authorize",
      context: { meta_user: input.userName, scopes: input.scopes.join(",") },
      at: input.now,
    }),
  ]);
}

export async function storePageConnection(
  db: SqlDb,
  actor: AuditActor,
  input: {
    tokenKey: string;
    pageId: string;
    pageName: string;
    pageToken: string;
    pageTokenExpiresAt: string | null;
    dataAccessExpiresAt: string | null;
    scopes: string[];
    webhookSubscribed: boolean;
    now: string;
  },
) {
  await ensureRow(db, input.now);
  const previous = await getConnection(db);
  const sealed = await encryptToken(input.tokenKey, input.pageToken, PURPOSE.page);
  await db.batch([
    db
      .prepare(
        `UPDATE meta_connection SET status = 'connected', page_id = ?1, page_name = ?2, page_token_enc = ?3,
           page_token_expires_at = ?4, data_access_expires_at = ?5, scopes_json = ?6, webhook_subscribed = ?7,
           user_token_enc = '', user_token_expires_at = NULL, connected_by = ?8, connected_at = ?9,
           last_checked_at = ?9, last_error = '', updated_at = ?9, row_version = row_version + 1
         WHERE id = ?10`,
      )
      .bind(
        input.pageId,
        input.pageName,
        sealed,
        input.pageTokenExpiresAt,
        input.dataAccessExpiresAt,
        JSON.stringify(input.scopes),
        input.webhookSubscribed ? 1 : 0,
        actor.id,
        input.now,
        CONNECTION_ID,
      ),
    auditStatement(db, {
      actor,
      entityType: "integration",
      entityId: "meta",
      entityLabel: "Meta Lead Ads",
      action: previous.pageId && previous.pageId !== input.pageId ? "change_page" : "connect",
      changes: previous.pageId !== input.pageId ? { page: [previous.pageName || null, input.pageName] } : {},
      context: { page_id: input.pageId, webhook_subscribed: input.webhookSubscribed },
      at: input.now,
    }),
    // Leads that were waiting for a working token can go again.
    db
      .prepare(
        "UPDATE meta_lead_ingestions SET status = 'pending', next_attempt_at = ?1, updated_at = ?1 WHERE status = 'waiting_token'",
      )
      .bind(input.now),
    db.prepare("UPDATE meta_import_jobs SET status = 'scanning', updated_at = ?1 WHERE status = 'paused'").bind(input.now),
  ]);
}

export async function recordCheck(
  db: SqlDb,
  input: {
    now: string;
    ok: boolean;
    error?: string;
    webhookSubscribed?: boolean;
    pageTokenExpiresAt?: string | null;
    dataAccessExpiresAt?: string | null;
    scopes?: string[];
  },
) {
  await db
    .prepare(
      `UPDATE meta_connection SET last_checked_at = ?1, last_error = ?2,
         webhook_subscribed = COALESCE(?3, webhook_subscribed),
         page_token_expires_at = CASE WHEN ?4 = 1 THEN ?5 ELSE page_token_expires_at END,
         data_access_expires_at = CASE WHEN ?4 = 1 THEN ?6 ELSE data_access_expires_at END,
         scopes_json = COALESCE(?7, scopes_json),
         updated_at = ?1
       WHERE id = ?8`,
    )
    .bind(
      input.now,
      input.ok ? "" : (input.error ?? "Check failed").slice(0, 300),
      input.webhookSubscribed === undefined ? null : input.webhookSubscribed ? 1 : 0,
      input.pageTokenExpiresAt !== undefined || input.dataAccessExpiresAt !== undefined ? 1 : 0,
      input.pageTokenExpiresAt ?? null,
      input.dataAccessExpiresAt ?? null,
      input.scopes ? JSON.stringify(input.scopes) : null,
      CONNECTION_ID,
    )
    .run();
}

/** Called when Graph rejects the Page token. Processing pauses until someone reconnects. */
export async function markTokenRejected(db: SqlDb, message: string, now: string) {
  await db
    .prepare(
      `UPDATE meta_connection SET status = 'expired', last_error = ?1, last_checked_at = ?2, updated_at = ?2,
         row_version = row_version + 1
       WHERE id = ?3 AND status = 'connected'`,
    )
    .bind(`Meta rejected the Page token: ${message}`.slice(0, 300), now, CONNECTION_ID)
    .run();
}

export async function touchConnection(db: SqlDb, field: "last_webhook_at" | "last_success_at", now: string) {
  await ensureRow(db, now);
  await db.prepare(`UPDATE meta_connection SET ${field} = ?1 WHERE id = ?2`).bind(now, CONNECTION_ID).run();
}

export async function disconnect(db: SqlDb, actor: AuditActor, now: string, note = "") {
  await ensureRow(db, now);
  const previous = await getConnection(db);
  await db.batch([
    db
      .prepare(
        `UPDATE meta_connection SET status = 'disconnected', page_token_enc = '', user_token_enc = '',
           user_token_expires_at = NULL, page_token_expires_at = NULL, data_access_expires_at = NULL,
           webhook_subscribed = 0, last_error = '', updated_at = ?1, row_version = row_version + 1
         WHERE id = ?2`,
      )
      .bind(now, CONNECTION_ID),
    auditStatement(db, {
      actor,
      entityType: "integration",
      entityId: "meta",
      entityLabel: "Meta Lead Ads",
      action: "disconnect",
      context: { page_id: previous.pageId, page_name: previous.pageName, note },
      at: now,
    }),
  ]);
}
