import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { changedRows, formatCode, newId, nextSequence, parseJson, type SqlDb, type SqlStatement, type SqlValue } from "../db/sql";
import { canonicalLocalityName } from "../locality";
import type { PropertyType } from "../types";
import { resolveContact, type ContactInput } from "./contacts";
import { assertVersion, optionalInt, optionalIso, stringArray, text } from "./input";
import { intentScore, type IntentScore } from "./intent-score";
import {
  DEMAND_INTENTS,
  FURNISHING_PREFERENCES,
  PROPERTY_TYPES,
  REQUIREMENT_CLOSED,
  REQUIREMENT_STATUSES,
  TENANT_PROFILES,
  TIMELINES,
  VEGETARIAN_PREFERENCES,
  oneOf,
  strictOneOf,
  type DemandIntent,
  type RequirementStatus,
  type Timeline,
} from "./options";
import { updateVersionedRecord } from "./records";
import {
  requirementReviewAction,
  storedFromDecision,
  storedReview,
  type RequirementReviewDecision,
  type StoredReview,
} from "./review";
import { readPreferenceDetails, type PreferenceDetails } from "../enquiry/questions";
import { ATTEMPT_ACTIVITY_SQL, MEANINGFUL_ACTIVITY_SQL } from "./engagement";
import { insertSourceStatement, sourceIdForMetaLead, type SourceInput } from "./sources";
import { noMatching, onRequirementDetailsChanged } from "./matching-hook";
import { initialCycleStatement, isPausedStatus, pauseUrgencyCycle } from "./timeline";

/**
 * The one budget range on a requirement. Purchase price and monthly rent are
 * never stored in separate columns: the intent says which one `budgetMin` and
 * `budgetMax` are. Matching must compare `purchase` with a sale price and
 * `monthly` with a monthly rent, and must not compare across the two.
 */
export function matchableBudget(requirement: Pick<Requirement, "intent" | "budgetMin" | "budgetMax">) {
  const purchase = requirement.intent === "Buy";
  return {
    basis: purchase ? ("purchase" as const) : ("monthly" as const),
    unit: purchase ? ("inr_total" as const) : ("inr_per_month" as const),
    min: requirement.budgetMin,
    max: requirement.budgetMax,
  };
}

export type Requirement = {
  id: string;
  code: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactCode: string;
  sourceId: string | null;
  channel: string;
  campaignName: string;
  formId: string;
  formName: string;
  intent: DemandIntent;
  propertyTypes: PropertyType[];
  bhkMin: number | null;
  bhkMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  localities: string[];
  localityFlexible: boolean;
  areaMin: number | null;
  furnishing: string;
  tenantProfile: string;
  vegetarian: string;
  parkingRequired: boolean;
  timeline: Timeline;
  neededBy: string | null;
  notes: string;
  preferenceDetails: PreferenceDetails;
  status: RequirementStatus;
  statusReason: string;
  priorityOverride: string;
  assignedTo: string | null;
  nextFollowupAt: string | null;
  lastContactedAt: string | null;
  outcome: string;
  closedAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  rowVersion: number;
  idempotencyKey: string | null;
  originOwnerLeadId: string | null;
  qualityReview: StoredReview;
  qualityReviewNote: string;
  confirmedTimeline: string;
  confirmedNeededBy: string | null;
  /** Meaningful conversations only. An unanswered call is an attempt, not engagement. */
  engagementCount: number;
  attemptCount: number;
  lastMeaningfulAt: string | null;
  intentScore: IntentScore;
};

type RequirementRow = {
  id: string;
  code: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  contact_code: string;
  source_id: string | null;
  channel: string | null;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  intent: string;
  property_types_json: string;
  bhk_min: number | null;
  bhk_max: number | null;
  budget_min: number | null;
  budget_max: number | null;
  localities_json: string;
  locality_flexible: number;
  area_min: number | null;
  furnishing: string;
  tenant_profile: string;
  vegetarian: string;
  parking_required: number;
  timeline: string;
  needed_by: string | null;
  notes: string;
  preference_details_json: string | null;
  status: string;
  status_reason: string;
  priority_override: string;
  assigned_to: string | null;
  next_followup_at: string | null;
  last_contacted_at: string | null;
  outcome: string;
  closed_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  row_version: number;
  idempotency_key: string | null;
  origin_owner_lead_id: string | null;
  quality_review: string | null;
  quality_review_note: string | null;
  confirmed_timeline?: string | null;
  confirmed_needed_by?: string | null;
  engagement_count?: number | null;
  attempt_count?: number | null;
  last_meaningful_at?: string | null;
};

const SELECT = `SELECT r.*, c.name AS contact_name, c.phone_e164 AS contact_phone, c.code AS contact_code,
  s.channel AS channel, s.meta_campaign_name AS campaign_name, s.meta_form_id AS form_id, s.meta_form_name AS form_name,
  (SELECT COUNT(*) FROM activities a WHERE a.entity_type = 'requirement' AND a.entity_id = r.id AND ${MEANINGFUL_ACTIVITY_SQL}) AS engagement_count,
  (SELECT COUNT(*) FROM activities a WHERE a.entity_type = 'requirement' AND a.entity_id = r.id AND ${ATTEMPT_ACTIVITY_SQL}) AS attempt_count,
  (SELECT MAX(a.occurred_at) FROM activities a WHERE a.entity_type = 'requirement' AND a.entity_id = r.id AND ${MEANINGFUL_ACTIVITY_SQL}) AS last_meaningful_at
  FROM demand_requirements r
  JOIN contacts c ON c.id = r.contact_id
  LEFT JOIN lead_sources s ON s.id = r.source_id`;

function toRequirement(row: RequirementRow, now: Date): Requirement {
  const propertyTypes = parseJson<string[]>(row.property_types_json, []).filter((type): type is PropertyType =>
    (PROPERTY_TYPES as string[]).includes(type),
  );
  const localities = parseJson<string[]>(row.localities_json, []);
  const timeline = oneOf(row.timeline, TIMELINES, "Exploring");
  const status = oneOf(row.status, REQUIREMENT_STATUSES, "New");
  const qualityReview = storedReview(row.quality_review);
  return {
    id: row.id,
    code: row.code,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactCode: row.contact_code,
    sourceId: row.source_id,
    channel: row.channel ?? "manual",
    campaignName: row.campaign_name ?? "",
    formId: row.form_id ?? "",
    formName: row.form_name ?? "",
    intent: oneOf(row.intent, DEMAND_INTENTS, "Rent"),
    propertyTypes,
    bhkMin: row.bhk_min,
    bhkMax: row.bhk_max,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    localities,
    localityFlexible: Boolean(row.locality_flexible),
    areaMin: row.area_min,
    furnishing: row.furnishing,
    tenantProfile: row.tenant_profile,
    vegetarian: row.vegetarian,
    parkingRequired: Boolean(row.parking_required),
    timeline,
    neededBy: row.needed_by,
    notes: row.notes,
    preferenceDetails: readPreferenceDetails(row.preference_details_json),
    status,
    statusReason: row.status_reason,
    priorityOverride: row.priority_override,
    assignedTo: row.assigned_to,
    nextFollowupAt: row.next_followup_at,
    lastContactedAt: row.last_contacted_at,
    outcome: row.outcome,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    rowVersion: Number(row.row_version),
    idempotencyKey: row.idempotency_key,
    originOwnerLeadId: row.origin_owner_lead_id,
    qualityReview: qualityReview === "misclassified" ? "" : qualityReview,
    qualityReviewNote: row.quality_review_note ?? "",
    confirmedTimeline: row.confirmed_timeline ?? "",
    confirmedNeededBy: row.confirmed_needed_by ?? null,
    engagementCount: Number(row.engagement_count ?? 0),
    attemptCount: Number(row.attempt_count ?? 0),
    lastMeaningfulAt: row.last_meaningful_at ?? null,
    intentScore: intentScore(
      {
        timeline,
        budgetMin: row.budget_min,
        budgetMax: row.budget_max,
        propertyTypes,
        localities,
        bhkMin: row.bhk_min,
        status,
        lastContactedAt: row.last_contacted_at,
        engagementCount: Number(row.engagement_count ?? 0),
        createdAt: row.created_at,
        priorityOverride: row.priority_override,
      },
      now,
    ),
  };
}

export async function getRequirement(db: SqlDb, id: string, now = new Date()): Promise<Requirement | null> {
  const row = await db.prepare(`${SELECT} WHERE r.id = ?1`).bind(id).first<RequirementRow>();
  return row ? toRequirement(row, now) : null;
}

const BAND_RANK = { High: 0, Medium: 1, Low: 2 } as const;

/** Open requirements sorted as a priority queue: band, then score, then age. */
export async function listRequirements(
  db: SqlDb,
  filter: { status?: string; timeline?: string; intent?: string; q?: string; contactId?: string; formId?: string; limit?: number; offset?: number } = {},
  now = new Date(),
): Promise<Requirement[]> {
  const conditions: string[] = [];
  const values: SqlValue[] = [];
  const add = (sql: string, value: SqlValue) => {
    values.push(value);
    conditions.push(sql.replace("?", `?${values.length}`));
  };
  const status = strictOneOf(filter.status, REQUIREMENT_STATUSES);
  if (status) add("r.status = ?", status);
  if (filter.status === "open") {
    conditions.push(`r.status NOT IN (${REQUIREMENT_CLOSED.map((item) => `'${item}'`).join(", ")})`);
  }
  if (filter.status === "closed") {
    conditions.push(`r.status IN (${REQUIREMENT_CLOSED.map((item) => `'${item}'`).join(", ")})`);
  }
  const timeline = strictOneOf(filter.timeline, TIMELINES);
  if (timeline) add("r.timeline = ?", timeline);
  const intent = strictOneOf(filter.intent, DEMAND_INTENTS);
  if (intent) add("r.intent = ?", intent);
  if (filter.contactId) add("r.contact_id = ?", filter.contactId);
  if (filter.formId) add("s.meta_form_id = ?", filter.formId);
  if (filter.q?.trim()) {
    values.push(`%${filter.q.trim()}%`);
    const n = values.length;
    conditions.push(`(c.name LIKE ?${n} OR r.code LIKE ?${n} OR r.localities_json LIKE ?${n} OR c.phone_e164 LIKE ?${n})`);
  }
  values.push(Math.min(Math.max(filter.limit ?? 300, 1), 1000));
  values.push(Math.max(0, Math.floor(filter.offset ?? 0)));
  const { results } = await db
    .prepare(
      `${SELECT} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY r.created_at DESC, r.id LIMIT ?${values.length - 1} OFFSET ?${values.length}`,
    )
    .bind(...values)
    .all<RequirementRow>();
  return results
    .map((row) => toRequirement(row, now))
    .sort(
      (a, b) =>
        BAND_RANK[a.intentScore.band] - BAND_RANK[b.intentScore.band] ||
        b.intentScore.score - a.intentScore.score ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export type RequirementInput = {
  intent: DemandIntent;
  propertyTypes: PropertyType[];
  bhkMin: number | null;
  bhkMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  localities: string[];
  localityFlexible: boolean;
  areaMin: number | null;
  furnishing: string;
  tenantProfile: string;
  vegetarian: string;
  parkingRequired: boolean;
  timeline: Timeline;
  neededBy: string | null;
  notes: string;
  preferenceDetails?: PreferenceDetails;
};

export function parseRequirementInput(value: unknown): RequirementInput {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const intent = strictOneOf(data.intent, DEMAND_INTENTS);
  if (!intent) throw new HttpError(400, "Choose whether they want to rent or buy.");
  const bhkMin = optionalInt(data.bhkMin, { max: 10 });
  const bhkMax = optionalInt(data.bhkMax, { max: 10 });
  const budgetMin = optionalInt(data.budgetMin);
  const budgetMax = optionalInt(data.budgetMax);
  if (bhkMin !== null && bhkMax !== null && bhkMin > bhkMax) throw new HttpError(400, "Minimum BHK is above maximum BHK.");
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
    throw new HttpError(400, "Minimum budget is above maximum budget.");
  }
  return {
    intent,
    propertyTypes: stringArray(data.propertyTypes, PROPERTY_TYPES) as PropertyType[],
    bhkMin,
    bhkMax,
    budgetMin,
    budgetMax,
    localities: stringArray(data.localities).map(canonicalLocalityName),
    localityFlexible: data.localityFlexible === true,
    areaMin: optionalInt(data.areaMin),
    furnishing: oneOf(data.furnishing, FURNISHING_PREFERENCES, "Any"),
    tenantProfile: oneOf(data.tenantProfile, TENANT_PROFILES, "Any"),
    vegetarian: oneOf(data.vegetarian, VEGETARIAN_PREFERENCES, "Any"),
    parkingRequired: data.parkingRequired === true,
    timeline: oneOf(data.timeline, TIMELINES, "Exploring"),
    neededBy: optionalIso(data.neededBy),
    notes: text(data.notes, 4000),
  };
}

export function requirementColumns(input: RequirementInput): Record<string, SqlValue> {
  const columns: Record<string, SqlValue> = {
    intent: input.intent,
    property_types_json: JSON.stringify(input.propertyTypes),
    bhk_min: input.bhkMin,
    bhk_max: input.bhkMax,
    budget_min: input.budgetMin,
    budget_max: input.budgetMax,
    localities_json: JSON.stringify(input.localities),
    locality_flexible: input.localityFlexible ? 1 : 0,
    area_min: input.areaMin,
    furnishing: input.furnishing,
    tenant_profile: input.tenantProfile,
    vegetarian: input.vegetarian,
    parking_required: input.parkingRequired ? 1 : 0,
    timeline: input.timeline,
    needed_by: input.neededBy,
    notes: input.notes,
  };
  if (input.preferenceDetails !== undefined) {
    columns.preference_details_json = JSON.stringify(input.preferenceDetails);
  }
  return columns;
}

export async function createRequirement(
  db: SqlDb,
  actor: AuditActor,
  contact: ContactInput,
  input: RequirementInput,
  source: SourceInput,
  now: string,
  write?: { id?: string; code?: string; alongside?: SqlStatement[] },
): Promise<Requirement> {
  if (await sourceIdForMetaLead(db, source.metaLeadId)) {
    throw new HttpError(409, "That Meta lead was already imported.");
  }
  const resolved = await resolveContact(db, actor, contact, "seeker", now);
  const insertSource = insertSourceStatement(db, actor, source, now);
  const id = write?.id || newId("req");
  const code = write?.code || formatCode("GH-D", await nextSequence(db, "seq_requirement"));
  const cycleId = newId("cyc");
  const columns = {
    id,
    code,
    contact_id: resolved.contactId,
    source_id: insertSource.id,
    ...requirementColumns(input),
    status: "New",
    created_at: now,
    created_by: actor.id,
    updated_at: now,
    updated_by: actor.id,
  } satisfies Record<string, SqlValue>;
  const names = Object.keys(columns) as (keyof typeof columns)[];

  try {
    await db.batch([
      ...resolved.statements,
      insertSource.statement,
      db
        .prepare(
          `INSERT INTO demand_requirements (${names.join(", ")}) VALUES (${names.map((_, index) => `?${index + 1}`).join(", ")})`,
        )
        .bind(...names.map((name) => columns[name])),
      auditStatement(db, {
        actor,
        entityType: "requirement",
        entityId: id,
        entityLabel: `${code} ${contact.name}`,
        action: "create",
        changes: diffFields({}, requirementColumns(input)),
        context: { channel: source.channel, contact_created: resolved.created, contact_id: resolved.contactId, cycle_id: cycleId },
        at: now,
      }),
      initialCycleStatement(db, {
        id: cycleId,
        requirementId: id,
        timeline: input.timeline,
        neededBy: input.neededBy,
        startedAt: now,
      }),
      ...(write?.alongside ?? []),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "That contact or Meta lead was just added by someone else. Search before retrying.");
    }
    throw error;
  }
  const created = (await getRequirement(db, id))!;
  await noMatching.onCaptured(db, { kind: "requirement", id, contactId: resolved.contactId, origin: source.channel });
  return created;
}

/** Stages that mean the enquiry is verified. Pending reviews cannot skip ahead to these. */
const ADVANCED_REQUIREMENT_STATUSES = new Set<RequirementStatus>([
  "Verified",
  "Qualified",
  "Matched",
  "Property shared",
  "Visit scheduled",
  "Visited",
  "Negotiation",
  "Converted",
]);

export async function updateRequirement(
  db: SqlDb,
  actor: AuditActor,
  current: Requirement,
  input: Record<string, unknown>,
  options: { now: string; expectedVersion?: number },
): Promise<Requirement> {
  assertVersion(options.expectedVersion, current.rowVersion);
  const next: Record<string, SqlValue> = {};

  if (input.details !== undefined) {
    const columns = requirementColumns(parseRequirementInput(input.details));
    delete columns.timeline;
    delete columns.needed_by;
    Object.assign(next, columns);
  }
  if (input.status !== undefined) {
    const status = strictOneOf(input.status, REQUIREMENT_STATUSES);
    if (!status) throw new HttpError(400, "Choose a valid status.");
    if (status !== current.status && current.status === "Converted") {
      throw new HttpError(400, "A converted requirement stays closed. Add a new requirement on this contact if they are looking again.");
    }
    if (status !== current.status && isPausedStatus(current.status) && !isPausedStatus(status)) {
      throw new HttpError(
        400,
        current.status === "Lost" || current.status === "Postponed"
          ? "Reopen this requirement and confirm the client's revised timeline."
          : "This requirement stays closed.",
      );
    }
    if (ADVANCED_REQUIREMENT_STATUSES.has(status) && current.qualityReview !== "genuine") {
      throw new HttpError(
        400,
        "This enquiry stays pending until a member of staff verifies the contact and the requirement.",
      );
    }
    next.status = status;
    next.status_reason = text(input.statusReason, 300);
    const closing = REQUIREMENT_CLOSED.includes(status);
    next.closed_at = closing ? (current.closedAt ?? options.now) : null;
    if (status === "Converted" || status === "Lost") {
      const outcome = text(input.outcome, 300);
      if (!outcome) {
        throw new HttpError(400, status === "Converted" ? "Describe the deal (property and terms)." : "Give the reason it was lost.");
      }
      next.outcome = outcome;
    }
  }
  if (input.priorityOverride !== undefined) {
    next.priority_override = oneOf(input.priorityOverride, ["", "High", "Medium", "Low"] as const, "");
  }

  const changed = await updateVersionedRecord(db, actor, {
    table: "demand_requirements",
    entityType: "requirement",
    id: current.id,
    label: `${current.code} ${current.contactName}`,
    rowVersion: current.rowVersion,
    before: {
      ...requirementColumns(current),
      status: current.status,
      status_reason: current.statusReason,
      closed_at: current.closedAt,
      outcome: current.outcome,
      priority_override: current.priorityOverride,
    },
    next,
    now: options.now,
  });
  if (changed && typeof next.status === "string" && next.status !== current.status && isPausedStatus(String(next.status))) {
    await pauseUrgencyCycle(db, actor, current, String(next.status), options.now);
  }
  const matchFields = [
    "intent",
    "property_types_json",
    "localities_json",
    "locality_flexible",
    "area_min",
    "budget_min",
    "budget_max",
    "bhk_min",
    "bhk_max",
    "furnishing",
    "vegetarian",
    "parking_required",
    "preference_details_json",
  ];
  const before = requirementColumns(current);
  const affectsMatch = matchFields.some((field) => field in next && next[field] !== before[field]);
  const resultingStatus = typeof next.status === "string" ? next.status : current.status;
  if (changed && affectsMatch && !isPausedStatus(resultingStatus)) {
    await onRequirementDetailsChanged(db, current.id);
  }
  return (await getRequirement(db, current.id))!;
}

/**
 * Records whether a buyer or tenant requirement is genuine.
 * Does not change its status, intent, or the Meta source it came from.
 * An empty review stays pending until someone chooses.
 */
export async function setRequirementQuality(
  db: SqlDb,
  actor: AuditActor,
  requirement: Requirement,
  decision: RequirementReviewDecision,
  noteInput: unknown,
  options: { now: string; expectedVersion?: number },
): Promise<Requirement> {
  assertVersion(options.expectedVersion, requirement.rowVersion);
  const review = storedFromDecision(decision);
  const note = text(noteInput, 300);
  if (note.length < 2) throw new HttpError(400, "Say why this classification changed.");
  if (requirement.qualityReview === review && requirement.qualityReviewNote === note) return requirement;

  const statements: SqlStatement[] = [
    db
      .prepare(
        `UPDATE demand_requirements SET quality_review = ?1, quality_review_note = ?2, updated_at = ?3, updated_by = ?4, row_version = row_version + 1
         WHERE id = ?5 AND row_version = ?6`,
      )
      .bind(review, note, options.now, actor.id, requirement.id, requirement.rowVersion),
    auditStatement(db, {
      actor,
      entityType: "requirement",
      entityId: requirement.id,
      entityLabel: `${requirement.code} ${requirement.contactName}`,
      action: requirementReviewAction(decision, requirement.intent),
      changes: diffFields(
        { quality_review: requirement.qualityReview, quality_review_note: requirement.qualityReviewNote },
        { quality_review: review, quality_review_note: note },
      ),
      context: { contact_id: requirement.contactId, intent: requirement.intent },
      at: options.now,
      onlyIfPreviousChanged: true,
    }),
  ];
  const results = await db.batch(statements);
  if (changedRows(results[0]) === 0) {
    throw new HttpError(409, "Someone else changed this requirement. Reload to see the latest version.");
  }
  return (await getRequirement(db, requirement.id))!;
}
