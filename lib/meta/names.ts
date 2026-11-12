import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { changedRows, type SqlDb } from "../db/sql";
import {
  getConnection,
  MARKETING_TOKEN_EXPIRED,
  MARKETING_TOKEN_INVALID,
  MARKETING_TOKEN_MISSING,
  markUserTokenRejected,
  readUserToken,
} from "./connection";
import { MetaApiError, type GraphClient } from "./graph";

const LEVELS = ["campaign", "adset", "ad"] as const;
type Level = (typeof LEVELS)[number];

const ID_COLUMN: Record<Level, string> = {
  campaign: "meta_campaign_id",
  adset: "meta_adset_id",
  ad: "meta_ad_id",
};
const NAME_COLUMN: Record<Level, string> = {
  campaign: "meta_campaign_name",
  adset: "meta_adset_name",
  ad: "meta_ad_name",
};

const ADS_READ_MESSAGE =
  "Campaign names need the optional ads_read permission. Tick ads_read under Optional on next connect, then reconnect. Sync names does not use ads_management and does not import leads again.";

export type NameSyncResult = {
  namesFound: number;
  entitiesUpdated: number;
  sourcesUpdated: number;
  keptExisting: number;
  emptyResponses: number;
  unresolved: number;
  incomplete: boolean;
  message: string;
};

type Target = { level: Level; id: string };

function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

function describe(error: unknown): string {
  if (error instanceof MetaApiError) return error.message;
  return error instanceof Error ? error.message : "Meta did not return this name.";
}

/**
 * Fill campaign, ad set and ad names for ids already stored in Gulbarga (Kalaburagi).
 * This does not re-import leads, rewrite attribution, or read spend.
 * An empty Marketing API name never replaces a name already stored.
 */
export async function syncCampaignNames(
  db: SqlDb,
  actor: AuditActor,
  tokenKey: string,
  graph: GraphClient,
  now: string,
): Promise<NameSyncResult> {
  const connection = await getConnection(db);
  if (connection.status !== "connected") {
    throw new HttpError(400, "Connect a Facebook Page before syncing campaign names.");
  }
  if (connection.userTokenError) {
    await record(db, actor, now, emptyResult(MARKETING_TOKEN_INVALID), connection.userTokenError);
    throw new HttpError(401, MARKETING_TOKEN_INVALID);
  }
  if (!connection.hasUserToken) {
    await record(db, actor, now, emptyResult(MARKETING_TOKEN_MISSING), MARKETING_TOKEN_MISSING);
    throw new HttpError(400, MARKETING_TOKEN_MISSING);
  }
  if (connection.userTokenExpiresAt && connection.userTokenExpiresAt <= now) {
    await record(db, actor, now, emptyResult(MARKETING_TOKEN_EXPIRED), MARKETING_TOKEN_EXPIRED);
    throw new HttpError(401, MARKETING_TOKEN_EXPIRED);
  }
  if (!connection.userTokenScopes.includes("ads_read")) {
    await record(db, actor, now, emptyResult(ADS_READ_MESSAGE), ADS_READ_MESSAGE);
    throw new HttpError(400, ADS_READ_MESSAGE);
  }
  const token = await readUserToken(db, tokenKey, now);
  if (!token) {
    await record(db, actor, now, emptyResult(MARKETING_TOKEN_MISSING), MARKETING_TOKEN_MISSING);
    throw new HttpError(400, MARKETING_TOKEN_MISSING);
  }

  const targets = await knownTargets(db);
  const found: { level: Level; id: string; name: string }[] = [];
  const errors: string[] = [];
  let stop: "auth" | "permission" | "rate_limit" | null = null;

  for (const target of targets) {
    try {
      const object = await graph.readMarketingObject(target.id, token);
      found.push({ ...target, name: object.name });
    } catch (error) {
      const kind = error instanceof MetaApiError ? error.kind : "permanent";
      errors.push(`${target.level} ${target.id}: ${describe(error)}`);
      if (kind === "auth" || kind === "permission" || kind === "rate_limit") {
        stop = kind;
        break;
      }
    }
  }

  if (stop === "auth") {
    await markUserTokenRejected(db, errors[0] ?? "Meta rejected the user token.", now);
    await record(db, actor, now, emptyResult(MARKETING_TOKEN_INVALID), errors.join(" | "));
    throw new HttpError(401, MARKETING_TOKEN_INVALID);
  }
  if (stop === "permission" && found.length === 0) {
    const message =
      "Meta refused to read campaign metadata. Reconnect with ads_read and a Facebook user who can see these campaigns. ads_management is not required, and this Page connection was left in place.";
    await record(db, actor, now, emptyResult(message), errors.join(" | "));
    throw new HttpError(400, message);
  }
  if (stop === "rate_limit" && found.length === 0) {
    const message = "Meta rate-limited the name sync. Wait and run Sync names again. Nothing was changed.";
    await record(db, actor, now, emptyResult(message), errors.join(" | "));
    throw new HttpError(429, message);
  }

  let entitiesUpdated = 0;
  let sourcesUpdated = 0;
  let keptExisting = 0;
  let emptyResponses = 0;
  for (const item of found) {
    if (!item.name) {
      const kept = await hasStoredName(db, item.level, item.id);
      if (kept) keptExisting += 1;
      else emptyResponses += 1;
      continue;
    }
    if (await writeEntityName(db, item.level, item.id, item.name, now)) entitiesUpdated += 1;
    sourcesUpdated += await writeSourceNames(db, item.level, item.id, item.name);
  }

  const result: NameSyncResult = {
    namesFound: found.filter((item) => item.name).length,
    entitiesUpdated,
    sourcesUpdated,
    keptExisting,
    emptyResponses,
    unresolved: errors.length,
    incomplete: errors.length > 0,
    message: "",
  };
  result.message = syncMessage(result);
  await record(db, actor, now, result, errors.join(" | "));
  return result;
}

function emptyResult(message: string): NameSyncResult {
  return {
    namesFound: 0,
    entitiesUpdated: 0,
    sourcesUpdated: 0,
    keptExisting: 0,
    emptyResponses: 0,
    unresolved: 0,
    incomplete: true,
    message,
  };
}

function syncMessage(result: NameSyncResult): string {
  const parts = [
    `Found ${result.namesFound} names.`,
    `Updated ${result.entitiesUpdated} stored ${result.entitiesUpdated === 1 ? "entity" : "entities"} and ${result.sourcesUpdated} lead ${result.sourcesUpdated === 1 ? "source" : "sources"}.`,
  ];
  if (result.keptExisting > 0) {
    parts.push(
      `${result.keptExisting} existing ${result.keptExisting === 1 ? "name was" : "names were"} kept because Meta returned nothing for ${result.keptExisting === 1 ? "that id" : "those ids"}.`,
    );
  }
  if (result.unresolved > 0) {
    parts.push(`${result.unresolved} ${result.unresolved === 1 ? "id could" : "ids could"} not be read. Run Sync names again to retry.`);
  }
  return parts.join(" ");
}

async function knownTargets(db: SqlDb): Promise<Target[]> {
  const { results } = await db
    .prepare(
      `SELECT level, external_id FROM (
         SELECT 'campaign' AS level, meta_campaign_id AS external_id FROM lead_sources WHERE meta_campaign_id != ''
         UNION
         SELECT 'adset', meta_adset_id FROM lead_sources WHERE meta_adset_id != ''
         UNION
         SELECT 'ad', meta_ad_id FROM lead_sources WHERE meta_ad_id != ''
         UNION
         SELECT level, external_id FROM ad_entities
         WHERE platform = 'meta' AND external_id != '' AND level IN ('campaign', 'adset', 'ad')
       )`,
    )
    .all<{ level: string; external_id: string }>();
  const targets = results
    .filter((row): row is { level: Level; external_id: string } => isLevel(row.level) && /^\d{3,32}$/.test(row.external_id))
    .map((row) => ({ level: row.level, id: row.external_id }));
  const order: Record<Level, number> = { campaign: 0, adset: 1, ad: 2 };
  targets.sort((left, right) => order[left.level] - order[right.level] || left.id.localeCompare(right.id));
  return targets;
}

async function hasStoredName(db: SqlDb, level: Level, id: string): Promise<boolean> {
  const entity = await db
    .prepare("SELECT name FROM ad_entities WHERE platform = 'meta' AND level = ?1 AND external_id = ?2")
    .bind(level, id)
    .first<{ name: string }>();
  if (entity?.name) return true;
  const source = await db
    .prepare(`SELECT 1 AS ok FROM lead_sources WHERE ${ID_COLUMN[level]} = ?1 AND ${NAME_COLUMN[level]} != '' LIMIT 1`)
    .bind(id)
    .first<{ ok: number }>();
  return Boolean(source);
}

async function writeEntityName(db: SqlDb, level: Level, id: string, name: string, now: string): Promise<boolean> {
  const current = await db
    .prepare("SELECT name FROM ad_entities WHERE platform = 'meta' AND level = ?1 AND external_id = ?2")
    .bind(level, id)
    .first<{ name: string }>();
  await db
    .prepare(
      `INSERT INTO ad_entities (platform, level, external_id, name, parent_id, first_seen_at, last_seen_at)
       VALUES ('meta', ?1, ?2, ?3, '', ?4, ?4)
       ON CONFLICT(platform, level, external_id) DO UPDATE SET
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE ad_entities.name END,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(level, id, name, now)
    .run();
  return current?.name !== name;
}

async function writeSourceNames(db: SqlDb, level: Level, id: string, name: string): Promise<number> {
  const result = await db
    .prepare(`UPDATE lead_sources SET ${NAME_COLUMN[level]} = ?1 WHERE ${ID_COLUMN[level]} = ?2 AND ${NAME_COLUMN[level]} != ?1`)
    .bind(name, id)
    .run();
  return changedRows(result);
}

async function record(db: SqlDb, actor: AuditActor, now: string, result: NameSyncResult, errors: string) {
  await auditStatement(db, {
    actor,
    entityType: "integration",
    entityId: "meta",
    entityLabel: "Meta Lead Ads",
    action: "sync_campaign_names",
    context: {
      names_found: result.namesFound,
      entities_updated: result.entitiesUpdated,
      sources_updated: result.sourcesUpdated,
      kept_existing: result.keptExisting,
      empty_responses: result.emptyResponses,
      unresolved: result.unresolved,
      errors: errors.slice(0, 500),
    },
    at: now,
  }).run();
}
