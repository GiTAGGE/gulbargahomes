import "server-only";

import { loadSeedProperties } from "../property-normalize";
import { prepareDatabase } from "./prepare";
import type { SqlDb } from "./sql";

export class DatabaseUnavailableError extends Error {
  constructor() {
    super(
      "Property database is not available. Create the Cloudflare D1 database named gulbargahomes and bind it as DB.",
    );
  }
}

let databaseReady: Promise<void> | null = null;

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

async function cloudflareEnv(): Promise<CloudflareEnv | null> {
  if (isBuildPhase()) return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return env as CloudflareEnv;
  } catch {
    return null;
  }
}

/** The bound D1 database with migrations applied, or null when none is bound. */
export async function getDatabase(): Promise<SqlDb | null> {
  const env = await cloudflareEnv();
  const db = (env?.DB as SqlDb | undefined) ?? null;
  if (!db) return null;
  if (!databaseReady) {
    databaseReady = prepareDatabase(db, loadSeedProperties).catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
  return db;
}

export async function requireDatabase(): Promise<SqlDb> {
  const db = await getDatabase();
  if (!db) throw new DatabaseUnavailableError();
  return db;
}

export function resetDatabaseReady() {
  databaseReady = null;
}

export async function getMediaBucket() {
  const env = await cloudflareEnv();
  return env?.MEDIA ?? null;
}
