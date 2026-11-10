import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { newId, type SqlDb, type SqlStatement, type SqlValue } from "../db/sql";
import { optionalInt, optionalIso, text } from "./input";
import {
  ACTIVITY_CHANNELS,
  ACTIVITY_KINDS,
  ACTIVITY_OUTCOMES,
  CONTACTED_OUTCOMES,
  CRM_ENTITY_TYPES,
  FOLLOWUP_PRIORITIES,
  oneOf,
  strictOneOf,
  type ActivityChannel,
  type ActivityKind,
  type ActivityOutcome,
  type CrmEntityType,
} from "./options";

const ENTITY_TABLE: Partial<Record<CrmEntityType, "owner_leads" | "demand_requirements">> = {
  owner_lead: "owner_leads",
  requirement: "demand_requirements",
};

export type Activity = {
  id: string;
  occurredAt: string;
  actorId: string;
  contactId: string | null;
  entityType: CrmEntityType;
  entityId: string;
  kind: ActivityKind;
  direction: "outbound" | "inbound";
  outcome: ActivityOutcome;
  body: string;
  durationSeconds: number | null;
  channel: ActivityChannel;
  externalId: string | null;
};

type ActivityRow = {
  id: string;
  occurred_at: string;
  actor_id: string;
  contact_id: string | null;
  entity_type: string;
  entity_id: string;
  kind: string;
  direction: string;
  outcome: string;
  body: string;
  duration_seconds: number | null;
  channel: string;
  external_id: string | null;
};

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    contactId: row.contact_id,
    entityType: oneOf(row.entity_type, CRM_ENTITY_TYPES, "contact"),
    entityId: row.entity_id,
    kind: oneOf(row.kind, ACTIVITY_KINDS, "note"),
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    outcome: oneOf(row.outcome, ACTIVITY_OUTCOMES, ""),
    body: row.body,
    durationSeconds: row.duration_seconds,
    channel: oneOf(row.channel, ACTIVITY_CHANNELS, "manual"),
    externalId: row.external_id,
  };
}

export type ActivityInput = {
  entityType: CrmEntityType;
  entityId: string;
  contactId: string | null;
  kind: ActivityKind;
  direction: "outbound" | "inbound";
  outcome: ActivityOutcome;
  body: string;
  durationSeconds: number | null;
  occurredAt: string | null;
  channel: ActivityChannel;
  externalId: string | null;
};

export function parseActivityInput(value: unknown): ActivityInput {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const entityType = strictOneOf(data.entityType, CRM_ENTITY_TYPES);
  const entityId = text(data.entityId, 40);
  const kind = strictOneOf(data.kind, ACTIVITY_KINDS);
  if (!entityType || !entityId) throw new HttpError(400, "Say which record this activity belongs to.");
  if (!kind) throw new HttpError(400, "Choose what kind of activity this was.");
  const body = text(data.body, 4000);
  if (kind === "note" && !body) throw new HttpError(400, "Write the note.");
  return {
    entityType,
    entityId,
    contactId: text(data.contactId, 40) || null,
    kind,
    direction: data.direction === "inbound" ? "inbound" : "outbound",
    outcome: oneOf(data.outcome, ACTIVITY_OUTCOMES, ""),
    body,
    durationSeconds: optionalInt(data.durationSeconds, { max: 86_400 }),
    occurredAt: optionalIso(data.occurredAt),
    channel: oneOf(data.channel, ACTIVITY_CHANNELS, "manual"),
    externalId: text(data.externalId, 128) || null,
  };
}

/**
 * Logs an interaction. Reaching the person stamps `last_contacted_at`, and moves
 * a brand-new lead or requirement to Contacted (with its own audit row).
 */
export async function logActivity(
  db: SqlDb,
  actor: AuditActor,
  input: ActivityInput,
  now: string,
): Promise<Activity> {
  const id = newId("act");
  const occurredAt = input.occurredAt ?? now;
  const statements: SqlStatement[] = [
    db
      .prepare(
        `INSERT INTO activities (id, occurred_at, actor_id, contact_id, entity_type, entity_id, kind, direction, outcome, body, duration_seconds, channel, external_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        id,
        occurredAt,
        actor.id,
        input.contactId,
        input.entityType,
        input.entityId,
        input.kind,
        input.direction,
        input.outcome,
        input.body,
        input.durationSeconds,
        input.channel,
        input.externalId,
        now,
      ),
  ];

  const table = ENTITY_TABLE[input.entityType];
  const reached = CONTACTED_OUTCOMES.includes(input.outcome) || input.direction === "inbound";
  if (table && reached) {
    statements.push(
      db
        .prepare(
          `UPDATE ${table} SET last_contacted_at = CASE WHEN last_contacted_at IS NULL OR last_contacted_at < ?1 THEN ?1 ELSE last_contacted_at END WHERE id = ?2`,
        )
        .bind(occurredAt, input.entityId),
      db
        .prepare(
          `UPDATE ${table} SET status = 'Contacted', updated_at = ?1, updated_by = ?2, row_version = row_version + 1 WHERE id = ?3 AND status = 'New'`,
        )
        .bind(now, actor.id, input.entityId),
      auditStatement(db, {
        actor,
        entityType: input.entityType === "owner_lead" ? "owner_lead" : "requirement",
        entityId: input.entityId,
        action: "status_change",
        changes: { status: ["New", "Contacted"] },
        context: { reason: "first successful contact", activity_id: id },
        at: now,
        onlyIfPreviousChanged: true,
      }),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "That message is already in the timeline.");
    throw error;
  }
  const row = await db.prepare("SELECT * FROM activities WHERE id = ?1").bind(id).first<ActivityRow>();
  return toActivity(row!);
}

export async function listActivities(
  db: SqlDb,
  filter: { entityType?: string; entityId?: string; contactId?: string; limit?: number },
): Promise<Activity[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  if (filter.contactId) {
    const { results } = await db
      .prepare("SELECT * FROM activities WHERE contact_id = ?1 ORDER BY occurred_at DESC LIMIT ?2")
      .bind(filter.contactId, limit)
      .all<ActivityRow>();
    return results.map(toActivity);
  }
  const { results } = await db
    .prepare("SELECT * FROM activities WHERE entity_type = ?1 AND entity_id = ?2 ORDER BY occurred_at DESC LIMIT ?3")
    .bind(filter.entityType ?? "", filter.entityId ?? "", limit)
    .all<ActivityRow>();
  return results.map(toActivity);
}

export type Followup = {
  id: string;
  entityType: CrmEntityType;
  entityId: string;
  contactId: string | null;
  dueAt: string;
  reason: string;
  priority: string;
  assignedTo: string | null;
  status: "Open" | "Done" | "Cancelled";
  completedAt: string | null;
  completedBy: string | null;
  outcomeNote: string;
  createdAt: string;
  createdBy: string;
  label?: string;
};

type FollowupRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  contact_id: string | null;
  due_at: string;
  reason: string;
  priority: string;
  assigned_to: string | null;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  outcome_note: string;
  created_at: string;
  created_by: string;
  label?: string | null;
};

function toFollowup(row: FollowupRow): Followup {
  return {
    id: row.id,
    entityType: oneOf(row.entity_type, CRM_ENTITY_TYPES, "contact"),
    entityId: row.entity_id,
    contactId: row.contact_id,
    dueAt: row.due_at,
    reason: row.reason,
    priority: row.priority,
    assignedTo: row.assigned_to,
    status: row.status === "Done" || row.status === "Cancelled" ? row.status : "Open",
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    outcomeNote: row.outcome_note,
    createdAt: row.created_at,
    createdBy: row.created_by,
    label: row.label ?? undefined,
  };
}

function syncNextFollowup(db: SqlDb, entityType: CrmEntityType, entityId: string): SqlStatement | null {
  const table = ENTITY_TABLE[entityType];
  if (!table) return null;
  return db
    .prepare(
      `UPDATE ${table} SET next_followup_at = (
         SELECT MIN(due_at) FROM followups WHERE entity_type = ?1 AND entity_id = ?2 AND status = 'Open'
       ) WHERE id = ?2`,
    )
    .bind(entityType, entityId);
}

export async function createFollowup(
  db: SqlDb,
  actor: AuditActor,
  value: unknown,
  now: string,
): Promise<Followup> {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const entityType = strictOneOf(data.entityType, CRM_ENTITY_TYPES);
  const entityId = text(data.entityId, 40);
  const dueAt = optionalIso(data.dueAt);
  const reason = text(data.reason, 300);
  if (!entityType || !entityId) throw new HttpError(400, "Say which record this follow-up belongs to.");
  if (!dueAt) throw new HttpError(400, "Choose when to follow up.");
  if (!reason) throw new HttpError(400, "Say what the follow-up is for.");

  const id = newId("fol");
  const statements: SqlStatement[] = [
    db
      .prepare(
        `INSERT INTO followups (id, entity_type, entity_id, contact_id, due_at, reason, priority, assigned_to, status, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'Open', ?9, ?10)`,
      )
      .bind(
        id,
        entityType,
        entityId,
        text(data.contactId, 40) || null,
        dueAt,
        reason,
        oneOf(data.priority, FOLLOWUP_PRIORITIES, "Normal"),
        text(data.assignedTo, 40) || actor.id,
        now,
        actor.id,
      ),
    auditStatement(db, {
      actor,
      entityType: "followup",
      entityId: id,
      entityLabel: reason,
      action: "create",
      changes: { due_at: [null, dueAt] },
      context: { entity_type: entityType, entity_id: entityId },
      at: now,
    }),
  ];
  const sync = syncNextFollowup(db, entityType, entityId);
  if (sync) statements.push(sync);
  await db.batch(statements);
  return (await getFollowup(db, id))!;
}

export async function getFollowup(db: SqlDb, id: string): Promise<Followup | null> {
  const row = await db.prepare("SELECT * FROM followups WHERE id = ?1").bind(id).first<FollowupRow>();
  return row ? toFollowup(row) : null;
}

export async function updateFollowup(
  db: SqlDb,
  actor: AuditActor,
  current: Followup,
  value: unknown,
  now: string,
): Promise<Followup> {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const set: Record<string, SqlValue> = {};
  const changes: Record<string, [unknown, unknown]> = {};

  if (data.status !== undefined) {
    const status = strictOneOf(data.status, ["Open", "Done", "Cancelled"] as const);
    if (!status) throw new HttpError(400, "Choose a valid follow-up status.");
    if (status !== current.status) {
      set.status = status;
      set.completed_at = status === "Open" ? null : now;
      set.completed_by = status === "Open" ? null : actor.id;
      changes.status = [current.status, status];
    }
  }
  if (data.outcomeNote !== undefined) set.outcome_note = text(data.outcomeNote, 1000);
  if (data.dueAt !== undefined) {
    const dueAt = optionalIso(data.dueAt);
    if (!dueAt) throw new HttpError(400, "Choose when to follow up.");
    if (dueAt !== current.dueAt) {
      set.due_at = dueAt;
      changes.due_at = [current.dueAt, dueAt];
    }
  }
  if (Object.keys(set).length === 0) return current;

  const names = Object.keys(set);
  const statements: SqlStatement[] = [
    db
      .prepare(`UPDATE followups SET ${names.map((name, index) => `${name} = ?${index + 1}`).join(", ")} WHERE id = ?${names.length + 1}`)
      .bind(...names.map((name) => set[name]), current.id),
    auditStatement(db, {
      actor,
      entityType: "followup",
      entityId: current.id,
      entityLabel: current.reason,
      action: changes.status ? `followup_${String(set.status).toLowerCase()}` : "update",
      changes,
      context: { entity_type: current.entityType, entity_id: current.entityId },
      at: now,
    }),
  ];
  const sync = syncNextFollowup(db, current.entityType, current.entityId);
  if (sync) statements.push(sync);
  await db.batch(statements);
  return (await getFollowup(db, current.id))!;
}

const FOLLOWUP_LABEL = `CASE f.entity_type
    WHEN 'owner_lead' THEN (SELECT l.code || ' · ' || c.name FROM owner_leads l JOIN contacts c ON c.id = l.contact_id WHERE l.id = f.entity_id)
    WHEN 'requirement' THEN (SELECT r.code || ' · ' || c.name FROM demand_requirements r JOIN contacts c ON c.id = r.contact_id WHERE r.id = f.entity_id)
    WHEN 'property' THEN (SELECT p.code || ' · ' || p.title FROM properties p WHERE p.id = f.entity_id)
    WHEN 'contact' THEN (SELECT c.code || ' · ' || c.name FROM contacts c WHERE c.id = f.entity_id)
  END AS label`;

export async function listFollowups(
  db: SqlDb,
  filter: { entityType?: string; entityId?: string; openDueBefore?: string; limit?: number },
): Promise<Followup[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  if (filter.openDueBefore) {
    const { results } = await db
      .prepare(
        `SELECT f.*, ${FOLLOWUP_LABEL} FROM followups f WHERE f.status = 'Open' AND f.due_at <= ?1 ORDER BY f.due_at LIMIT ?2`,
      )
      .bind(filter.openDueBefore, limit)
      .all<FollowupRow>();
    return results.map(toFollowup);
  }
  const { results } = await db
    .prepare(
      `SELECT f.*, ${FOLLOWUP_LABEL} FROM followups f WHERE f.entity_type = ?1 AND f.entity_id = ?2
       ORDER BY CASE f.status WHEN 'Open' THEN 0 ELSE 1 END, f.due_at LIMIT ?3`,
    )
    .bind(filter.entityType ?? "", filter.entityId ?? "", limit)
    .all<FollowupRow>();
  return results.map(toFollowup);
}
