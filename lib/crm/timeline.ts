import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import type { Permission } from "../admin/permissions";
import { changedRows, newId, type SqlDb, type SqlStatement } from "../db/sql";
import { logActivity } from "./activity";
import { text } from "./input";
import { endOfIstDay } from "./ist";
import { onRequirementTimelineChanged } from "./matching-hook";
import {
  CONFIRMATION_METHODS,
  CONFIRMED_TIMELINES,
  EXTENSION_REASONS,
  PAUSED_REQUIREMENT_STATUSES,
  REOPENABLE_REQUIREMENT_STATUSES,
  oneOf,
  strictOneOf,
  type ConfirmationMethod,
  type ConfirmedTimeline,
} from "./options";
import { defaultTarget, urgencyFor, type UrgencyBand } from "./urgency-policy";

/** Who may extend, reopen, or record an attempt. Routes must use these. */
export const TIMELINE_PERMISSION = {
  extend: "crm.edit",
  reopen: "crm.edit",
  attempt: "activity.log",
} as const satisfies Record<string, Permission>;

export const CLOSURE_REASON = {
  extension: "Client extension",
  lost: "Requirement lost",
  postponed: "Requirement postponed",
  converted: "Converted",
  duplicate: "Duplicate",
  invalid: "Invalid",
} as const;

const ATTEMPT_OUTCOMES = {
  call: ["no_answer", "busy", "switched_off", "wrong_number"],
  whatsapp: ["sent"],
} as const;

export type TimelineSubject = {
  id: string;
  code: string;
  contactId: string;
  contactName: string;
  status: string;
  timeline: string;
  neededBy: string | null;
  confirmedTimeline: string;
  confirmedNeededBy: string | null;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
  rowVersion: number;
  qualityReview: string;
  lastMeaningfulAt: string | null;
};

export type TimelineRevision = {
  id: string;
  requirementId: string;
  kind: "extension" | "reopen";
  previousTimeline: string;
  newTimeline: string;
  previousNeededBy: string | null;
  newNeededBy: string | null;
  reason: string;
  notes: string;
  confirmationMethod: ConfirmationMethod;
  actorId: string;
  createdAt: string;
};

export type UrgencyCycle = {
  id: string;
  requirementId: string;
  revisionId: string | null;
  cycleStart: string;
  timeline: string;
  targetDate: string | null;
  closedAt: string | null;
  closureReason: string;
  urgencyBand: string;
  overdue: boolean;
  createdAt: string;
};

type RevisionRow = {
  id: string;
  requirement_id: string;
  kind: string;
  previous_timeline: string;
  new_timeline: string;
  previous_needed_by: string | null;
  new_needed_by: string | null;
  reason: string;
  notes: string;
  confirmation_method: string;
  actor_id: string;
  created_at: string;
};

type CycleRow = {
  id: string;
  requirement_id: string;
  revision_id: string | null;
  cycle_start: string;
  timeline: string;
  target_date: string | null;
  closed_at: string | null;
  closure_reason: string;
  urgency_band: string;
  overdue: number;
  created_at: string;
};

function toRevision(row: RevisionRow): TimelineRevision {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    kind: row.kind === "reopen" ? "reopen" : "extension",
    previousTimeline: row.previous_timeline,
    newTimeline: row.new_timeline,
    previousNeededBy: row.previous_needed_by,
    newNeededBy: row.new_needed_by,
    reason: row.reason,
    notes: row.notes,
    confirmationMethod: oneOf(row.confirmation_method, CONFIRMATION_METHODS, "phone"),
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

function toCycle(row: CycleRow): UrgencyCycle {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    revisionId: row.revision_id,
    cycleStart: row.cycle_start,
    timeline: row.timeline,
    targetDate: row.target_date,
    closedAt: row.closed_at,
    closureReason: row.closure_reason,
    urgencyBand: row.urgency_band,
    overdue: row.overdue === 1,
    createdAt: row.created_at,
  };
}

export function closureReasonForStatus(status: string): string {
  switch (status) {
    case "Converted":
      return CLOSURE_REASON.converted;
    case "Lost":
      return CLOSURE_REASON.lost;
    case "Postponed":
      return CLOSURE_REASON.postponed;
    case "Duplicate":
      return CLOSURE_REASON.duplicate;
    case "Invalid":
      return CLOSURE_REASON.invalid;
    default:
      return "Requirement closed";
  }
}

export function isPausedStatus(status: string): boolean {
  return (PAUSED_REQUIREMENT_STATUSES as readonly string[]).includes(status);
}

/** A date-only value is the end of that day in India. A full timestamp is kept. */
export function parseDeadline(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const noon = new Date(`${trimmed}T12:00:00+05:30`);
    if (Number.isNaN(noon.getTime())) return null;
    return endOfIstDay(noon);
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listTimelineRevisions(db: SqlDb, requirementId: string): Promise<TimelineRevision[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM requirement_timeline_revisions WHERE requirement_id = ?1 ORDER BY created_at, id`,
    )
    .bind(requirementId)
    .all<RevisionRow>();
  return results.map(toRevision);
}

export async function listUrgencyCycles(db: SqlDb, requirementId: string): Promise<UrgencyCycle[]> {
  const { results } = await db
    .prepare(`SELECT * FROM requirement_urgency_cycles WHERE requirement_id = ?1 ORDER BY cycle_start, id`)
    .bind(requirementId)
    .all<CycleRow>();
  return results.map(toCycle);
}

/** Statement for the first cycle of a requirement that is being created now. */
export function initialCycleStatement(
  db: SqlDb,
  input: { id: string; requirementId: string; timeline: string; neededBy: string | null; startedAt: string },
): SqlStatement {
  const target = input.neededBy ?? defaultTarget(input.timeline, new Date(input.startedAt));
  return db
    .prepare(
      `INSERT INTO requirement_urgency_cycles (
         id, requirement_id, revision_id, cycle_start, timeline, target_date,
         closed_at, closure_reason, urgency_band, overdue, created_at
       ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, NULL, '', '', 0, ?3)`,
    )
    .bind(input.id, input.requirementId, input.startedAt, input.timeline, target);
}

type ConfirmedChange = {
  timeline: ConfirmedTimeline;
  neededBy: string | null;
  notes: string;
  confirmationMethod: ConfirmationMethod;
  reason: string;
  kind: "extension" | "reopen";
};

function parseConfirmation(value: unknown, kind: "extension" | "reopen"): ConfirmedChange {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const timeline = strictOneOf(data.timeline, CONFIRMED_TIMELINES);
  if (!timeline) throw new HttpError(400, "Choose the timeline the client confirmed.");
  const confirmationMethod = strictOneOf(data.confirmationMethod, CONFIRMATION_METHODS);
  if (!confirmationMethod) throw new HttpError(400, "Say how the client confirmed this timeline.");
  const notes = text(data.notes, 2000);
  let reason = "Client returned";
  if (kind === "extension") {
    const selected = strictOneOf(data.reason, EXTENSION_REASONS);
    if (!selected) throw new HttpError(400, "Choose why the client needs more time.");
    if (selected === "Other" && notes.length < 2) throw new HttpError(400, "Say why the client needs more time.");
    reason = selected;
  } else if (notes.length < 2) {
    throw new HttpError(400, "Say why the client is looking again.");
  }
  return {
    timeline,
    neededBy: parseDeadline(data.neededBy),
    notes,
    confirmationMethod,
    reason,
    kind,
  };
}

function versionGate(requirementId: string, nextVersion: number): string {
  return `EXISTS (SELECT 1 FROM demand_requirements WHERE id = '${requirementId.replace(/'/g, "")}' AND row_version = ${Number(nextVersion)})`;
}

/** Opening of the note written when staff record a confirmation. It is not a customer reply. */
export const STAFF_CONFIRMATION_LEAD = "Staff recorded a client confirmation";

function confirmationActivity(method: ConfirmationMethod, notes: string, kind: "extension" | "reopen"): {
  kind: "call" | "whatsapp" | "note";
  direction: "outbound";
  outcome: "connected";
  body: string;
} {
  const action = kind === "reopen" ? "that the client is still looking" : "a revised timeline";
  const channel = method === "phone" ? "phone" : method === "whatsapp" ? "WhatsApp" : "an in-person conversation";
  const lead = `${STAFF_CONFIRMATION_LEAD} by ${channel} ${action}. This was entered by staff and is not an inbound WhatsApp message.`;
  const body = notes ? `${lead} ${notes}` : lead;
  if (method === "phone") return { kind: "call", direction: "outbound", outcome: "connected", body };
  if (method === "whatsapp") return { kind: "whatsapp", direction: "outbound", outcome: "connected", body };
  return { kind: "note", direction: "outbound", outcome: "connected", body };
}

async function applyTimelineChange(
  db: SqlDb,
  actor: AuditActor,
  requirement: TimelineSubject,
  change: ConfirmedChange,
  now: string,
  statusPatch: { status: string; statusReason: string; clearClosed: boolean } | null,
): Promise<void> {
  const cycles = await listUrgencyCycles(db, requirement.id);
  const open = cycles.find((cycle) => !cycle.closedAt) ?? null;
  const previousTimeline = open?.timeline ?? (requirement.confirmedTimeline || requirement.timeline);
  const previousNeeded =
    open?.targetDate ??
    (requirement.confirmedTimeline ? requirement.confirmedNeededBy : requirement.neededBy) ??
    defaultTarget(requirement.timeline, new Date(requirement.createdAt));
  const nextVersion = requirement.rowVersion + 1;
  const gate = versionGate(requirement.id, nextVersion);
  const revisionId = newId("rev");
  const openedCycleId = newId("cyc");
  const activityId = newId("act");
  const activity = confirmationActivity(change.confirmationMethod, change.notes, change.kind);
  const meaningful =
    open !== null &&
    ((requirement.lastMeaningfulAt !== null && requirement.lastMeaningfulAt >= open.cycleStart) || open.revisionId !== null);
  const snapshot = open
    ? urgencyFor({
        status: "New",
        timeline: open.timeline,
        cycleStart: open.cycleStart,
        targetDate: open.targetDate,
        meaningfulSinceCycleStart: meaningful,
        now: new Date(now),
      })
    : urgencyFor({
        status: "New",
        timeline: requirement.timeline,
        cycleStart: requirement.createdAt,
        targetDate: previousNeeded,
        meaningfulSinceCycleStart: requirement.lastMeaningfulAt !== null,
        now: new Date(now),
      });
  const closureReason = change.kind === "extension" ? CLOSURE_REASON.extension : closureReasonForStatus(requirement.status);
  const nextStatus = statusPatch?.status ?? (requirement.status === "New" ? "Contacted" : requirement.status);
  const historicalId = !open && cycles.length === 0 ? newId("cyc") : null;
  const statements: SqlStatement[] = [
    db
      .prepare(
        `UPDATE demand_requirements
         SET confirmed_timeline = ?1,
             confirmed_needed_by = ?2,
             last_contacted_at = CASE WHEN last_contacted_at IS NULL OR last_contacted_at < ?3 THEN ?3 ELSE last_contacted_at END,
             status = CASE WHEN ?10 = 1 THEN ?4 WHEN status = 'New' THEN 'Contacted' ELSE status END,
             status_reason = CASE WHEN ?10 = 1 THEN ?5 ELSE status_reason END,
             closed_at = CASE WHEN ?10 = 1 AND ?6 = 1 THEN NULL ELSE closed_at END,
             updated_at = ?3,
             updated_by = ?7,
             row_version = row_version + 1
         WHERE id = ?8 AND row_version = ?9${statusPatch ? " AND status IN ('Lost', 'Postponed')" : ` AND status NOT IN (${PAUSED_REQUIREMENT_STATUSES.map((status) => `'${status}'`).join(", ")})`}`,
      )
      .bind(
        change.timeline,
        change.neededBy,
        now,
        statusPatch?.status ?? requirement.status,
        statusPatch?.statusReason ?? "",
        statusPatch?.clearClosed ? 1 : 0,
        actor.id,
        requirement.id,
        requirement.rowVersion,
        statusPatch ? 1 : 0,
      ),
  ];

  // A requirement created before cycles existed keeps its original period as history.
  if (!open && historicalId) {
    const historicalClosedAt =
      change.kind === "reopen" ? requirement.closedAt || requirement.updatedAt || now : now;
    statements.push(
      db
        .prepare(
          `INSERT INTO requirement_urgency_cycles (
             id, requirement_id, revision_id, cycle_start, timeline, target_date,
             closed_at, closure_reason, urgency_band, overdue, created_at
           )
           SELECT ?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
           WHERE ${gate}`,
        )
        .bind(
          historicalId,
          requirement.id,
          requirement.createdAt,
          requirement.timeline,
          previousNeeded,
          historicalClosedAt,
          closureReason,
          snapshot.band,
          snapshot.overdue ? 1 : 0,
          now,
        ),
    );
  }
  if (open) {
    statements.push(
      db
        .prepare(
          `UPDATE requirement_urgency_cycles
           SET closed_at = ?1, closure_reason = ?2, urgency_band = ?3, overdue = ?4
           WHERE id = ?5 AND closed_at IS NULL AND ${gate}`,
        )
        .bind(now, closureReason, snapshot.band, snapshot.overdue ? 1 : 0, open.id),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO requirement_timeline_revisions (
           id, requirement_id, kind, previous_timeline, new_timeline, previous_needed_by, new_needed_by,
           reason, notes, confirmation_method, actor_id, created_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
         WHERE ${gate}`,
      )
      .bind(
        revisionId,
        requirement.id,
        change.kind,
        previousTimeline,
        change.timeline,
        previousNeeded,
        change.neededBy,
        change.reason,
        change.notes,
        change.confirmationMethod,
        actor.id,
        now,
      ),
    db
      .prepare(
        `INSERT INTO requirement_urgency_cycles (
           id, requirement_id, revision_id, cycle_start, timeline, target_date,
           closed_at, closure_reason, urgency_band, overdue, created_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, NULL, '', '', 0, ?4
         WHERE ${gate}`,
      )
      .bind(openedCycleId, requirement.id, revisionId, now, change.timeline, change.neededBy),
    db
      .prepare(
        `INSERT INTO activities (
           id, occurred_at, actor_id, contact_id, entity_type, entity_id, kind, direction, outcome, body,
           duration_seconds, channel, external_id, created_at
         )
         SELECT ?1, ?2, ?3, ?4, 'requirement', ?5, ?6, ?7, ?8, ?9, NULL, 'manual', NULL, ?2
         WHERE ${gate}`,
      )
      .bind(
        activityId,
        now,
        actor.id,
        requirement.contactId,
        requirement.id,
        activity.kind,
        activity.direction,
        activity.outcome,
        activity.body,
      ),
    auditStatement(db, {
      actor,
      entityType: "requirement",
      entityId: requirement.id,
      entityLabel: `${requirement.code} ${requirement.contactName}`,
      action: change.kind === "extension" ? "timeline_extend" : "reopen",
      changes: diffFields(
        {
          confirmed_timeline: requirement.confirmedTimeline || requirement.timeline,
          confirmed_needed_by: previousNeeded,
          status: requirement.status,
        },
        {
          confirmed_timeline: change.timeline,
          confirmed_needed_by: change.neededBy,
          status: nextStatus,
        },
      ),
      context: {
        revision_id: revisionId,
        closed_cycle_id: open?.id ?? historicalId ?? "",
        opened_cycle_id: openedCycleId,
        closure_reason: closureReason,
        confirmation_method: change.confirmationMethod,
        reason: change.reason,
        activity_id: activityId,
      },
      at: now,
      onlyIfPreviousChanged: true,
    }),
  );

  const results = await db.batch(statements);
  if (changedRows(results[0]) === 0) {
    throw new HttpError(409, "Someone else changed this requirement. Reload to see the latest version.");
  }
  try {
    await onRequirementTimelineChanged(db, {
      requirementId: requirement.id,
      reason: change.kind === "extension" ? "extension" : "reopen",
    });
  } catch (error) {
    console.error("timeline matching hook failed", error);
  }
}

function assertExtendable(requirement: TimelineSubject) {
  if (requirement.status === "Converted") {
    throw new HttpError(400, "A converted requirement stays closed. Add a new requirement on this contact if they are looking again.");
  }
  if (isPausedStatus(requirement.status)) {
    throw new HttpError(400, "Reopen this requirement and confirm the client's revised timeline before extending it.");
  }
}

/**
 * Client confirmed they need more time. The original enquiry date and timeline stay.
 * The previous cycle is closed, a new cycle starts, and earlier activity is left in place.
 * The new cycle is not forced to Critical.
 */
export async function extendRequirementTimeline(
  db: SqlDb,
  actor: AuditActor,
  requirement: TimelineSubject,
  value: unknown,
  options: { now: string; expectedVersion?: number },
): Promise<void> {
  if (options.expectedVersion !== undefined && options.expectedVersion !== requirement.rowVersion) {
    throw new HttpError(409, "Someone else changed this requirement. Reload to see the latest version.");
  }
  assertExtendable(requirement);
  const change = parseConfirmation(value, "extension");
  change.neededBy = change.neededBy ?? defaultTarget(change.timeline, new Date(options.now));
  await applyTimelineChange(db, actor, requirement, change, options.now, null);
}

/**
 * A closed requirement becomes active again because the client confirmed they are still looking.
 * Converted, duplicate and invalid requirements stay closed. History is kept.
 */
export async function reopenRequirement(
  db: SqlDb,
  actor: AuditActor,
  requirement: TimelineSubject,
  value: unknown,
  options: { now: string; expectedVersion?: number },
): Promise<void> {
  if (options.expectedVersion !== undefined && options.expectedVersion !== requirement.rowVersion) {
    throw new HttpError(409, "Someone else changed this requirement. Reload to see the latest version.");
  }
  if (requirement.status === "Converted") {
    throw new HttpError(400, "A converted requirement stays closed. Add a new requirement on this contact if they are looking again.");
  }
  if (!(REOPENABLE_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status)) {
    throw new HttpError(400, "Only a lost or postponed requirement can be reopened.");
  }
  const change = parseConfirmation(value, "reopen");
  change.neededBy = change.neededBy ?? defaultTarget(change.timeline, new Date(options.now));
  const nextStatus = requirement.qualityReview === "genuine" ? "Verified" : "Contacted";
  await applyTimelineChange(db, actor, requirement, change, options.now, {
    status: nextStatus,
    statusReason: change.notes,
    clearClosed: true,
  });
}

/**
 * Staff tried to reach the client and did not. This is not a timeline extension
 * and it does not count as a conversation.
 */
export async function recordContactAttempt(
  db: SqlDb,
  actor: AuditActor,
  requirement: Pick<TimelineSubject, "id" | "contactId" | "status">,
  value: unknown,
  now: string,
) {
  if (isPausedStatus(requirement.status)) {
    throw new HttpError(400, `This requirement is closed (${requirement.status}). A contact attempt can be recorded only while it is open.`);
  }
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const kind = data.kind === "whatsapp" ? "whatsapp" : data.kind === "call" ? "call" : null;
  if (!kind) throw new HttpError(400, "Record a phone call or a WhatsApp message.");
  const outcome = strictOneOf(data.outcome, ATTEMPT_OUTCOMES[kind]);
  if (!outcome) throw new HttpError(400, "An attempt is an unanswered call or a WhatsApp message that was only sent.");
  return logActivity(
    db,
    actor,
    {
      entityType: "requirement",
      entityId: requirement.id,
      contactId: requirement.contactId,
      kind,
      direction: "outbound",
      outcome,
      body: text(data.notes, 4000),
      durationSeconds: null,
      occurredAt: null,
      channel: "manual",
      externalId: null,
    },
    now,
  );
}

/**
 * When staff close or postpone a requirement, keep the open cycle (or the original
 * period, if none was stored) instead of leaving urgency to keep climbing.
 */
export async function pauseUrgencyCycle(
  db: SqlDb,
  actor: AuditActor,
  requirement: TimelineSubject,
  status: string,
  now: string,
): Promise<void> {
  if (!isPausedStatus(status)) return;
  const cycles = await listUrgencyCycles(db, requirement.id);
  const open = cycles.find((cycle) => !cycle.closedAt) ?? null;
  if (!open && cycles.length > 0) return;
  const reason = closureReasonForStatus(status);
  const cycleStart = open?.cycleStart ?? requirement.createdAt;
  const timeline = open?.timeline ?? requirement.timeline;
  const target = open?.targetDate ?? requirement.neededBy ?? defaultTarget(requirement.timeline, new Date(requirement.createdAt));
  const meaningful =
    requirement.lastMeaningfulAt !== null && requirement.lastMeaningfulAt >= cycleStart;
  const snapshot = urgencyFor({
    status: "New",
    timeline,
    cycleStart,
    targetDate: target,
    meaningfulSinceCycleStart: meaningful || Boolean(open?.revisionId),
    now: new Date(now),
  });
  const statements: SqlStatement[] = [];
  let cycleId = open?.id ?? "";
  if (open) {
    cycleId = open.id;
    statements.push(
      db
        .prepare(
          `UPDATE requirement_urgency_cycles
           SET closed_at = ?1, closure_reason = ?2, urgency_band = ?3, overdue = ?4
           WHERE id = ?5 AND closed_at IS NULL`,
        )
        .bind(now, reason, snapshot.band, snapshot.overdue ? 1 : 0, open.id),
    );
  } else {
    cycleId = newId("cyc");
    statements.push(
      db
        .prepare(
          `INSERT INTO requirement_urgency_cycles (
             id, requirement_id, revision_id, cycle_start, timeline, target_date,
             closed_at, closure_reason, urgency_band, overdue, created_at
           ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(
          cycleId,
          requirement.id,
          requirement.createdAt,
          requirement.timeline,
          target,
          requirement.closedAt || now,
          reason,
          snapshot.band,
          snapshot.overdue ? 1 : 0,
          now,
        ),
    );
  }
  statements.push(
    auditStatement(db, {
      actor,
      entityType: "requirement",
      entityId: requirement.id,
      entityLabel: `${requirement.code} ${requirement.contactName}`,
      action: "urgency_cycle_close",
      context: {
        cycle_id: cycleId,
        closure_reason: reason,
        urgency_band: snapshot.band,
        overdue: snapshot.overdue,
        status,
      },
      at: now,
      onlyIfPreviousChanged: true,
    }),
  );
  await db.batch(statements);
}

export type CycleView = {
  id: string | null;
  stored: boolean;
  number: number;
  cycleStart: string;
  timeline: string;
  targetDate: string | null;
  closedAt: string | null;
  closureReason: string;
  band: UrgencyBand;
  overdue: boolean;
  current: boolean;
  source: "stored" | "original enquiry";
};

export type RequirementTimelineView = {
  enquiryAgeDays: number;
  originalTimeline: string;
  originalDeadline: string | null;
  currentTimeline: string;
  currentDeadline: string | null;
  extensionCount: number;
  revisions: TimelineRevision[];
  cycles: CycleView[];
  current: CycleView;
  lastMeaningfulAt: string | null;
  attemptCount: number;
};

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function describeTimeline(
  requirement: TimelineSubject & { attemptCount: number },
  revisions: TimelineRevision[],
  cycles: UrgencyCycle[],
  now: Date,
): RequirementTimelineView {
  const extensionCount = revisions.filter((revision) => revision.kind === "extension").length;
  const lastConfirmation = [...revisions].reverse().find((revision) => revision.kind === "extension" || revision.kind === "reopen");
  const lastMeaningfulAt = later(requirement.lastMeaningfulAt, lastConfirmation?.createdAt ?? null);
  const originalDeadline = requirement.neededBy ?? defaultTarget(requirement.timeline, new Date(requirement.createdAt));
  const views: CycleView[] = cycles.map((cycle, index) => {
    const confirmed = cycle.revisionId !== null || (lastMeaningfulAt !== null && lastMeaningfulAt >= cycle.cycleStart);
    const live = cycle.closedAt
      ? null
      : urgencyFor({
          status: requirement.status,
          timeline: cycle.timeline,
          cycleStart: cycle.cycleStart,
          targetDate: cycle.targetDate,
          meaningfulSinceCycleStart: confirmed,
          now,
        });
    return {
      id: cycle.id,
      stored: true,
      number: index + 1,
      cycleStart: cycle.cycleStart,
      timeline: cycle.timeline,
      targetDate: cycle.targetDate,
      closedAt: cycle.closedAt,
      closureReason: cycle.closureReason,
      band: live?.band ?? (oneOfBand(cycle.urgencyBand) || "Closed"),
      overdue: live?.overdue ?? cycle.overdue,
      current: !cycle.closedAt,
      source: "stored",
    };
  });

  if (views.length === 0) {
    const derivedTarget = requirement.confirmedNeededBy ?? originalDeadline;
    const derivedTimeline = requirement.confirmedTimeline || requirement.timeline;
    const live = urgencyFor({
      status: requirement.status,
      timeline: derivedTimeline,
      cycleStart: requirement.createdAt,
      targetDate: isPausedStatus(requirement.status) ? derivedTarget : derivedTarget,
      meaningfulSinceCycleStart: lastMeaningfulAt !== null,
      now,
    });
    views.push({
      id: null,
      stored: false,
      number: 1,
      cycleStart: requirement.createdAt,
      timeline: derivedTimeline,
      targetDate: derivedTarget,
      closedAt: isPausedStatus(requirement.status) ? requirement.closedAt || requirement.updatedAt : null,
      closureReason: isPausedStatus(requirement.status) ? closureReasonForStatus(requirement.status) : "",
      band: live.band,
      overdue: live.overdue,
      current: true,
      source: "original enquiry",
    });
  }

  const latest = [...views].reverse().find((cycle) => cycle.current) ?? views[views.length - 1];
  const current = isPausedStatus(requirement.status)
    ? {
        ...latest,
        ...urgencyFor({
          status: requirement.status,
          timeline: latest.timeline,
          cycleStart: latest.cycleStart,
          targetDate: latest.targetDate,
          meaningfulSinceCycleStart: false,
          now,
        }),
        current: false,
      }
    : latest;
  const ageMs = now.getTime() - new Date(requirement.createdAt).getTime();
  return {
    enquiryAgeDays: Math.max(0, Math.floor(ageMs / 86_400_000)),
    originalTimeline: requirement.timeline,
    originalDeadline,
    currentTimeline: requirement.confirmedTimeline || requirement.timeline,
    currentDeadline: current.targetDate,
    extensionCount,
    revisions,
    cycles: views,
    current,
    lastMeaningfulAt,
    attemptCount: requirement.attemptCount,
  };
}

function oneOfBand(value: string): UrgencyBand | null {
  const bands: UrgencyBand[] = ["Critical", "High", "Normal", "Low", "Paused", "Closed"];
  return (bands as string[]).includes(value) ? (value as UrgencyBand) : null;
}

export async function loadRequirementTimeline(
  db: SqlDb,
  requirement: TimelineSubject & { attemptCount: number },
  now = new Date(),
): Promise<RequirementTimelineView> {
  const [revisions, cycles] = await Promise.all([
    listTimelineRevisions(db, requirement.id),
    listUrgencyCycles(db, requirement.id),
  ]);
  return describeTimeline(requirement, revisions, cycles, now);
}

/** Same view as `loadRequirementTimeline`, loaded in batches for the operations desk. */
export async function loadTimelineViews(
  db: SqlDb,
  requirements: Array<TimelineSubject & { attemptCount: number }>,
  now: Date,
): Promise<Map<string, RequirementTimelineView>> {
  const views = new Map<string, RequirementTimelineView>();
  const revisions = new Map<string, TimelineRevision[]>();
  const cycles = new Map<string, UrgencyCycle[]>();
  for (let index = 0; index < requirements.length; index += 40) {
    const ids = requirements.slice(index, index + 40).map((item) => item.id);
    const marks = ids.map((_, place) => `?${place + 1}`).join(", ");
    const [revisionRows, cycleRows] = await Promise.all([
      db
        .prepare(
          `SELECT * FROM requirement_timeline_revisions WHERE requirement_id IN (${marks}) ORDER BY created_at, id`,
        )
        .bind(...ids)
        .all<RevisionRow>(),
      db
        .prepare(`SELECT * FROM requirement_urgency_cycles WHERE requirement_id IN (${marks}) ORDER BY cycle_start, id`)
        .bind(...ids)
        .all<CycleRow>(),
    ]);
    for (const row of revisionRows.results) {
      const revision = toRevision(row);
      const list = revisions.get(revision.requirementId) ?? [];
      list.push(revision);
      revisions.set(revision.requirementId, list);
    }
    for (const row of cycleRows.results) {
      const cycle = toCycle(row);
      const list = cycles.get(cycle.requirementId) ?? [];
      list.push(cycle);
      cycles.set(cycle.requirementId, list);
    }
  }
  for (const requirement of requirements) {
    views.set(
      requirement.id,
      describeTimeline(requirement, revisions.get(requirement.id) ?? [], cycles.get(requirement.id) ?? [], now),
    );
  }
  return views;
}

export async function countExtensions(db: SqlDb, requirementId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM requirement_timeline_revisions WHERE requirement_id = ?1 AND kind = 'extension'`,
    )
    .bind(requirementId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
