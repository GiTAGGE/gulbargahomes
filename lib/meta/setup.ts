import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import type { SqlDb } from "../db/sql";
import { REQUIRED_SCOPES, type MetaConfig } from "./config";
import {
  CONNECTION_ID,
  disconnect,
  getConnection,
  markTokenRejected,
  readUserToken,
  recordCheck,
  storePageConnection,
} from "./connection";
import { decryptToken } from "./crypto";
import { upsertDiscoveredForms } from "./forms";
import { MetaApiError, type GraphClient } from "./graph";

export type CheckResult = { label: string; ok: boolean; detail: string };

async function anyPageToken(db: SqlDb, tokenKey: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT page_token_enc FROM meta_connection WHERE id = ?1")
    .bind(CONNECTION_ID)
    .first<{ page_token_enc: string }>();
  if (!row?.page_token_enc || !tokenKey) return null;
  return decryptToken(tokenKey, row.page_token_enc, "meta_connection.page_token");
}

function describe(error: unknown): string {
  if (error instanceof MetaApiError) return `${error.message}${error.code ? ` (code ${error.code})` : ""}`;
  return error instanceof Error ? error.message : "Unknown error";
}

/** Pages the authorising Facebook user manages. Names and ids only. */
export async function candidatePages(db: SqlDb, config: MetaConfig, graph: GraphClient, now = new Date().toISOString()) {
  const userToken = await readUserToken(db, config.tokenKey, now);
  if (!userToken) throw new HttpError(400, "Connect with Facebook first.");
  const pages = await graph.listPages(userToken);
  return pages.map((page) => ({ id: page.id, name: page.name, canManageLeads: page.tasks.length === 0 || page.tasks.some((task) => ["ADVERTISE", "MANAGE"].includes(task)) }));
}

export async function selectPage(
  db: SqlDb,
  actor: AuditActor,
  config: MetaConfig,
  graph: GraphClient,
  pageId: string,
  now: string,
) {
  const userToken = await readUserToken(db, config.tokenKey, now);
  if (!userToken) throw new HttpError(400, "The Facebook authorisation has expired. Connect again.");
  const page = (await graph.listPages(userToken)).find((item) => item.id === pageId);
  if (!page) throw new HttpError(400, "That Page is not available to the Facebook account you connected.");

  const info = await graph.debugToken(page.accessToken);
  if (!info.isValid) throw new HttpError(400, "Meta returned an invalid Page token. Connect again.");
  const missing = REQUIRED_SCOPES.filter((scope) => !info.scopes.includes(scope));
  if (missing.length) {
    throw new HttpError(400, `Meta did not grant: ${missing.join(", ")}. Connect again and allow every permission.`);
  }
  let subscribed = await graph.isLeadgenSubscribed(page.id, page.accessToken).catch(() => false);
  if (!subscribed) {
    await graph.subscribeLeadgen(page.id, page.accessToken);
    subscribed = await graph.isLeadgenSubscribed(page.id, page.accessToken).catch(() => false);
  }

  await storePageConnection(db, actor, {
    tokenKey: config.tokenKey,
    pageId: page.id,
    pageName: page.name,
    pageToken: page.accessToken,
    pageTokenExpiresAt: info.expiresAt,
    dataAccessExpiresAt: info.dataAccessExpiresAt,
    scopes: info.scopes,
    webhookSubscribed: subscribed,
    now,
  });
  const forms = await graph.listForms(page.id, page.accessToken);
  await upsertDiscoveredForms(db, actor.id, page.id, forms, now);
  return { page: { id: page.id, name: page.name }, forms: forms.length, webhookSubscribed: subscribed };
}

export async function syncForms(db: SqlDb, actor: AuditActor, config: MetaConfig, graph: GraphClient, now: string) {
  const connection = await getConnection(db);
  const token = await anyPageToken(db, config.tokenKey);
  if (connection.status !== "connected" || !token) throw new HttpError(400, "Connect a Facebook Page first.");
  try {
    const forms = await graph.listForms(connection.pageId, token);
    const result = await upsertDiscoveredForms(db, actor.id, connection.pageId, forms, now);
    await auditStatement(db, {
      actor,
      entityType: "integration",
      entityId: "meta",
      entityLabel: "Meta Lead Ads",
      action: "sync_forms",
      context: { added: result.added, updated: result.updated },
      at: now,
    }).run();
    return result;
  } catch (error) {
    if (error instanceof MetaApiError && (error.kind === "auth" || error.kind === "permission")) {
      await markTokenRejected(db, error.message, now);
    }
    throw new HttpError(502, `Meta did not return the forms: ${describe(error)}`);
  }
}

/** Test connection. A passing check on an expired connection reactivates it. */
export async function testConnection(db: SqlDb, actor: AuditActor, config: MetaConfig, missing: string[], graph: GraphClient, now: string) {
  const checks: CheckResult[] = [];
  checks.push({
    label: "Worker secrets",
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : "META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN and META_TOKEN_KEY are set.",
  });
  const connection = await getConnection(db);
  const token = await anyPageToken(db, config.tokenKey);
  if (!connection.pageId || !token) {
    checks.push({ label: "Page connection", ok: false, detail: "No Page is connected." });
    return { ok: false, checks };
  }

  let tokenOk = false;
  let scopes: string[] | undefined;
  let expiry: { pageTokenExpiresAt: string | null; dataAccessExpiresAt: string | null } | null = null;
  try {
    const info = await graph.debugToken(token);
    tokenOk = info.isValid;
    scopes = info.scopes;
    expiry = { pageTokenExpiresAt: info.expiresAt, dataAccessExpiresAt: info.dataAccessExpiresAt };
    const lacking = REQUIRED_SCOPES.filter((scope) => !info.scopes.includes(scope));
    checks.push({
      label: "Page token",
      ok: info.isValid && lacking.length === 0,
      detail: !info.isValid
        ? "Meta says the token is no longer valid. Reconnect."
        : lacking.length
          ? `Missing permissions: ${lacking.join(", ")}. Reconnect and allow them.`
          : `Valid. ${info.expiresAt ? `Expires ${info.expiresAt.slice(0, 10)}.` : "Does not expire."}${
              info.dataAccessExpiresAt ? ` Data access until ${info.dataAccessExpiresAt.slice(0, 10)}.` : ""
            }`,
    });
  } catch (error) {
    checks.push({ label: "Page token", ok: false, detail: describe(error) });
  }

  let subscribed: boolean | undefined;
  if (tokenOk) {
    try {
      const page = await graph.page(connection.pageId, token);
      checks.push({ label: "Facebook Page", ok: true, detail: `${page.name} (${page.id})` });
    } catch (error) {
      checks.push({ label: "Facebook Page", ok: false, detail: describe(error) });
    }
    try {
      subscribed = await graph.isLeadgenSubscribed(connection.pageId, token);
      if (!subscribed) {
        await graph.subscribeLeadgen(connection.pageId, token);
        subscribed = await graph.isLeadgenSubscribed(connection.pageId, token);
      }
      checks.push({
        label: "Leadgen webhook subscription",
        ok: subscribed,
        detail: subscribed ? "The Page sends new leads to this app." : "The Page is not subscribed to leadgen for this app.",
      });
    } catch (error) {
      checks.push({ label: "Leadgen webhook subscription", ok: false, detail: describe(error) });
    }
  }

  const ok = checks.every((check) => check.ok);
  await recordCheck(db, {
    now,
    ok,
    error: checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.detail}`).join(" · "),
    webhookSubscribed: subscribed,
    scopes,
    ...(expiry ?? {}),
  });
  if (!tokenOk && connection.status === "connected") await markTokenRejected(db, "Test connection failed", now);
  if (tokenOk && connection.status === "expired") {
    await db.batch([
      db
        .prepare("UPDATE meta_connection SET status = 'connected', row_version = row_version + 1 WHERE id = ?1 AND status = 'expired'")
        .bind(CONNECTION_ID),
      db
        .prepare("UPDATE meta_lead_ingestions SET status = 'pending', next_attempt_at = ?1, updated_at = ?1 WHERE status = 'waiting_token'")
        .bind(now),
      db.prepare("UPDATE meta_import_jobs SET status = 'scanning', updated_at = ?1 WHERE status = 'paused'").bind(now),
    ]);
  }
  await auditStatement(db, {
    actor,
    entityType: "integration",
    entityId: "meta",
    entityLabel: "Meta Lead Ads",
    action: "test_connection",
    context: { ok },
    at: now,
  }).run();
  return { ok, checks };
}

/** Best effort at Meta, then always forgets the tokens locally. */
export async function disconnectMeta(db: SqlDb, actor: AuditActor, config: MetaConfig, graph: GraphClient, now: string) {
  const connection = await getConnection(db);
  const token = await anyPageToken(db, config.tokenKey);
  let note = "";
  if (connection.pageId && token) {
    try {
      await graph.unsubscribe(connection.pageId, token);
      note = "Page unsubscribed from leadgen";
    } catch (error) {
      note = `Could not unsubscribe at Meta: ${describe(error)}`;
    }
  }
  await disconnect(db, actor, now, note);
  return { note };
}
