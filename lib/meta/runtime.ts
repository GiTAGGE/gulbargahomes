import "server-only";

import type { SqlDb } from "../db/sql";
import { readMetaConfig } from "./config";
import { getConnection } from "./connection";
import { createGraphClient } from "./graph";
import type { MetaRuntime } from "./ingest";

export async function metaRuntime(db: SqlDb, origin = "") {
  const { config, missing } = readMetaConfig(process.env, origin);
  const connection = await getConnection(db);
  const runtime: MetaRuntime = {
    db,
    graph: createGraphClient(config),
    tokenKey: config.tokenKey,
    pageId: connection.pageId,
  };
  return { runtime, config, missing, connection };
}

/**
 * Keeps work running after the response is sent (Workers `waitUntil`). Under
 * `next dev` there is no execution context, so the promise simply runs on.
 */
export async function runAfterResponse(task: () => Promise<unknown>) {
  const promise = task().catch((error) => console.error("background task failed", error));
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { ctx } = await getCloudflareContext({ async: true });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(promise);
  } catch {
    // No Workers context: nothing else to do.
  }
}
