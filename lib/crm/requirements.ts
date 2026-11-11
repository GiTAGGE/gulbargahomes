import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { formatCode, newId, nextSequence, parseJson, type SqlDb, type SqlValue } from "../db/sql";
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
import { insertSourceStatement, sourceIdForMetaLead, type SourceInput } from "./sources";

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
};

const SELECT = `SELECT r.*, c.name AS contact_name, c.phone_e164 AS contact_phone, c.code AS contact_code,
  s.channel AS channel, s.meta_campaign_name AS campaign_name, s.meta_form_id AS form_id, s.meta_form_name AS form_name
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

function columnsFor(input: RequirementInput): Record<string, SqlValue> {
  return {
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
}

export async function createRequirement(
  db: SqlDb,
  actor: AuditActor,
  contact: ContactInput,
  input: RequirementInput,
  source: SourceInput,
  now: string,
): Promise<Requirement> {
  if (await sourceIdForMetaLead(db, source.metaLeadId)) {
    throw new HttpError(409, "That Meta lead was already imported.");
  }
  const resolved = await resolveContact(db, actor, contact, "seeker", now);
  const insertSource = insertSourceStatement(db, actor, source, now);
  const id = newId("req");
  const code = formatCode("GH-D", await nextSequence(db, "seq_requirement"));
  const columns = {
    id,
    code,
    contact_id: resolved.contactId,
    source_id: insertSource.id,
    ...columnsFor(input),
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
        changes: diffFields({}, columnsFor(input)),
        context: { channel: source.channel, contact_created: resolved.created, contact_id: resolved.contactId },
        at: now,
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "That contact or Meta lead was just added by someone else. Search before retrying.");
    }
    throw error;
  }
  return (await getRequirement(db, id))!;
}

export async function updateRequirement(
  db: SqlDb,
  actor: AuditActor,
  current: Requirement,
  input: Record<string, unknown>,
  options: { now: string; expectedVersion?: number },
): Promise<Requirement> {
  assertVersion(options.expectedVersion, current.rowVersion);
  const next: Record<string, SqlValue> = {};

  if (input.details !== undefined) Object.assign(next, columnsFor(parseRequirementInput(input.details)));
  if (input.status !== undefined) {
    const status = strictOneOf(input.status, REQUIREMENT_STATUSES);
    if (!status) throw new HttpError(400, "Choose a valid status.");
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

  await updateVersionedRecord(db, actor, {
    table: "demand_requirements",
    entityType: "requirement",
    id: current.id,
    label: `${current.code} ${current.contactName}`,
    rowVersion: current.rowVersion,
    before: {
      ...columnsFor(current),
      status: current.status,
      status_reason: current.statusReason,
      closed_at: current.closedAt,
      outcome: current.outcome,
      priority_override: current.priorityOverride,
    },
    next,
    now: options.now,
  });
  return (await getRequirement(db, current.id))!;
}
