import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { can, isRole } from "../admin/permissions";
import { newId, parseJson, type SqlDb, type SqlStatement } from "../db/sql";
import { matchingMode, type LifecycleState, type MatchMode } from "../inventory/lifecycle";
import { PAUSED_REQUIREMENT_STATUSES } from "./options";
import {
  scoreMatch,
  type MatchListing,
  type MatchRequest,
  type ScoredMatch,
} from "./match-score";

export const MATCH_STATUSES = [
  "Suggested",
  "Shortlisted",
  "Rejected",
  "Shared",
  "Visit scheduled",
  "Converted",
  "Expired",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_DECISIONS = ["Shortlisted", "Rejected", "Shared", "Visit scheduled", "Converted"] as const;
export type MatchDecision = (typeof MATCH_DECISIONS)[number];

const STAFF_DECISIONS = new Set<string>(MATCH_DECISIONS);
const PAUSED = new Set<string>(PAUSED_REQUIREMENT_STATUSES);

export type MatchRunTrigger =
  | "requirement_created"
  | "requirement_updated"
  | "timeline_extended"
  | "requirement_reopened"
  | "property_verified"
  | "property_content_changed"
  | "property_availability_changed"
  | "property_discreet_changed"
  | "property_eligibility_changed";

export type StoredMatch = {
  id: string;
  requirementId: string;
  propertyId: string;
  propertyCode: string;
  propertyTitle: string;
  locality: string;
  listing: string;
  propertyType: string;
  price: number;
  area: number;
  plotDimensions: string;
  score: number;
  localityScore: number;
  areaScore: number;
  budgetScore: number;
  explanation: string;
  rank: number;
  matchingMode: MatchMode;
  status: MatchStatus;
  decision: string;
  decidedAt: string | null;
  decisionReason: string;
  eligible: boolean;
  createdAt: string;
  updatedAt: string;
};

type MatchRow = {
  id: string;
  requirement_id: string;
  property_id: string;
  score: number;
  locality_score: number;
  area_score: number;
  budget_score: number;
  explanation: string;
  rank: number;
  matching_mode: string;
  status: string;
  decision: string;
  decided_at: string | null;
  decision_reason: string;
  eligible: number;
  created_at: string;
  updated_at: string;
  code: string;
  title: string;
  locality: string;
  listing: string;
  property_type: string;
  price: number;
  area: number;
  plot_dimensions: string | null;
};

type PropertyCandidate = {
  id: string;
  code: string;
  title: string;
  listing: "Rent" | "Sale";
  property_type: string;
  bhk: number | null;
  price: number;
  area: number;
  locality: string;
  plot_dimensions: string | null;
  verification_status: string;
  publication_status: string;
  status: string;
  discreet_matching: number;
  availability_verified_at: string | null;
  availability_valid_days: number;
  furnished: string;
  vegetarian: string;
  parking: string;
};

type RequirementCandidate = {
  id: string;
  status: string;
  intent: "Rent" | "Buy";
  property_types_json: string;
  localities_json: string;
  locality_flexible: number;
  area_min: number | null;
  budget_min: number | null;
  budget_max: number | null;
  bhk_min: number | null;
  bhk_max: number | null;
  furnishing: string;
  vegetarian: string;
  parking_required: number;
  preference_details_json: string | null;
  match_epoch: number;
};

/** One attempt plus retries after another isolate committed a newer snapshot. */
export const MATCH_ATTEMPT_LIMIT = 3;

type MatchGate = {
  /** The latest trigger that arrived while a pass was running. Several collapse into one. */
  followUp: MatchRunTrigger | null;
  /** Settles when this requirement has no pass left to run. */
  done: Promise<void>;
};

const gates = new Map<string, MatchGate>();

/**
 * Matches one requirement against the latest saved inventory and requirement.
 * A trigger that arrives during a pass is remembered, and the callers wait.
 * When that pass finishes, one follow-up reads the database again. Triggers
 * that arrive during the follow-up collapse into the next pass. Matching does
 * not enqueue itself, so a quiet pass ends the chain. The gate is removed on
 * success and on failure. A matching error is recorded and not thrown.
 */
export function safeRequirementMatch(db: SqlDb, requirementId: string, trigger: MatchRunTrigger): Promise<void> {
  const current = gates.get(requirementId);
  if (current) {
    current.followUp = trigger;
    return current.done;
  }

  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const gate: MatchGate = { followUp: null, done };
  gates.set(requirementId, gate);
  void pump(db, requirementId, trigger, gate).finally(finish);
  return done;
}

async function pump(db: SqlDb, requirementId: string, trigger: MatchRunTrigger, gate: MatchGate): Promise<void> {
  let next: MatchRunTrigger | null = trigger;
  try {
    while (next) {
      const current = next;
      next = null;
      try {
        await runSafely(db, requirementId, current);
      } catch (error) {
        // runSafely already records its own failure. This keeps one broken pass
        // from skipping a follow-up that was requested while it ran.
        console.error("requirement matching follow-up failed", { requirementId, trigger: current, error });
      } finally {
        // Taken synchronously after the pass, so a trigger cannot land between
        // the read and the clear. The next pass, if any, sees committed rows.
        next = gate.followUp;
        gate.followUp = null;
      }
    }
  } finally {
    if (gates.get(requirementId) === gate) gates.delete(requirementId);
  }
}

/**
 * Matches one requirement without the in-isolate gate.
 * A second Worker isolate has its own gate, so tests call this to run beside another pass.
 */
export function matchRequirementWithoutGate(db: SqlDb, requirementId: string, trigger: MatchRunTrigger): Promise<void> {
  return runSafely(db, requirementId, trigger);
}

/** Refreshes every open requirement after a property change. One failure does not stop the rest. */
export async function safeRematchOpenRequirements(db: SqlDb, trigger: MatchRunTrigger): Promise<void> {
  try {
    const { results } = await db
      .prepare(
        `SELECT id FROM demand_requirements WHERE status NOT IN (${[...PAUSED].map((status) => `'${status}'`).join(", ")})`,
      )
      .all<{ id: string }>();
    for (const row of results) {
      await safeRequirementMatch(db, row.id, trigger);
    }
  } catch (error) {
    console.error("property matching trigger failed", error);
  }
}

export async function listRequirementMatches(
  db: SqlDb,
  requirementId: string,
  access: { viewDiscreet: boolean },
): Promise<StoredMatch[]> {
  const { results } = await db
    .prepare(
      `SELECT matches.*, properties.code, properties.title, properties.locality, properties.listing,
              properties.property_type, properties.price, properties.area, properties.plot_dimensions
       FROM matches
       JOIN properties ON properties.id = matches.property_id
       WHERE matches.requirement_id = ?1
       ORDER BY matches.rank, matches.property_id`,
    )
    .bind(requirementId)
    .all<MatchRow>();
  const visible = results.filter((row) => access.viewDiscreet || row.matching_mode !== "internal");
  return visible.map((row, index) => toMatch(row, access.viewDiscreet ? Number(row.rank) : index + 1));
}

export async function recordMatchDecision(
  db: SqlDb,
  actor: AuditActor,
  matchId: string,
  decision: MatchDecision,
  reasonInput: unknown,
  now: string,
): Promise<StoredMatch> {
  if (!isRole(actor.role) || !can(actor.role, "match.manage")) {
    throw new HttpError(403, "Your role cannot decide a match.");
  }
  if (!STAFF_DECISIONS.has(decision)) throw new HttpError(400, "Choose a match decision.");
  const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 500) : "";
  if (reason.length < 2) throw new HttpError(400, "Say why this match decision was made.");
  const current = await db
    .prepare(
      `SELECT matches.*, properties.code, properties.title, properties.locality, properties.listing,
              properties.property_type, properties.price, properties.area, properties.plot_dimensions
       FROM matches JOIN properties ON properties.id = matches.property_id
       WHERE matches.id = ?1`,
    )
    .bind(matchId)
    .first<MatchRow>();
  if (!current) throw new HttpError(404, "That match was not found.");
  if (current.matching_mode === "internal" && !can(actor.role, "property.view_discreet")) {
    throw new HttpError(404, "That match was not found.");
  }
  await db.batch([
    db
      .prepare(
        `UPDATE matches SET status = ?1, decision = ?1, decided_at = ?2, decision_reason = ?3, updated_at = ?2 WHERE id = ?4`,
      )
      .bind(decision, now, reason, matchId),
    db.prepare(`UPDATE demand_requirements SET match_epoch = match_epoch + 1 WHERE id = ?1`).bind(current.requirement_id),
    auditStatement(db, {
      actor,
      entityType: "match",
      entityId: matchId,
      entityLabel: `${current.code} for ${current.requirement_id}`,
      action: "match_decision",
      changes: {
        status: [current.status, decision],
        decision_reason: [current.decision_reason, reason],
      },
      context: { requirement_id: current.requirement_id, property_id: current.property_id },
      at: now,
    }),
  ]);
  const saved = await db
    .prepare(
      `SELECT matches.*, properties.code, properties.title, properties.locality, properties.listing,
              properties.property_type, properties.price, properties.area, properties.plot_dimensions
       FROM matches JOIN properties ON properties.id = matches.property_id WHERE matches.id = ?1`,
    )
    .bind(matchId)
    .first<MatchRow>();
  return toMatch(saved!, Number(saved!.rank));
}

async function runSafely(db: SqlDb, requirementId: string, trigger: MatchRunTrigger): Promise<void> {
  const started = new Date().toISOString();
  try {
    const outcome = await runRequirementMatch(db, requirementId, started);
    await recordRun(db, requirementId, trigger, outcome.result, outcome.error, outcome.count, started);
  } catch (error) {
    console.error("requirement matching failed", { requirementId, trigger, error });
    await recordRun(db, requirementId, trigger, "failed", errorText(error), 0, started).catch((logError) => {
      console.error("match run was not recorded", logError);
    });
  }
}

async function runRequirementMatch(
  db: SqlDb,
  requirementId: string,
  now: string,
): Promise<{ result: "completed" | "skipped"; error: string; count: number }> {
  for (let attempt = 1; attempt <= MATCH_ATTEMPT_LIMIT; attempt += 1) {
    try {
      return await writeMatchAttempt(db, requirementId, now);
    } catch (error) {
      if (!isEpochConflict(error)) throw error;
      if (attempt === MATCH_ATTEMPT_LIMIT) {
        throw new Error(`Match epoch changed during the read. Gave up after ${MATCH_ATTEMPT_LIMIT} attempts.`);
      }
    }
  }
  throw new Error(`Match epoch changed during the read. Gave up after ${MATCH_ATTEMPT_LIMIT} attempts.`);
}

async function writeMatchAttempt(
  db: SqlDb,
  requirementId: string,
  now: string,
): Promise<{ result: "completed" | "skipped"; error: string; count: number }> {
  const requirement = await readRequirement(db, requirementId);
  if (!requirement) return { result: "skipped", error: "Requirement was not found.", count: 0 };
  if (PAUSED.has(requirement.status)) {
    return { result: "skipped", error: "A closed requirement is not rematched.", count: 0 };
  }

  const request = toRequest(requirement);
  const { results: properties } = await db
    .prepare(
      `SELECT id, code, title, listing, property_type, bhk, price, area, locality, plot_dimensions,
              verification_status, publication_status, status, discreet_matching, availability_verified_at,
              availability_valid_days, furnished, vegetarian, parking
       FROM properties`,
    )
    .all<PropertyCandidate>();
  const { results: existing } = await db
    .prepare("SELECT * FROM matches WHERE requirement_id = ?1")
    .bind(requirementId)
    .all<MatchRow>();
  const byProperty = new Map(existing.map((row) => [row.property_id, row]));

  const eligible: { property: PropertyCandidate; scored: ScoredMatch }[] = [];
  for (const property of properties) {
    const mode = matchingMode(lifecycleOf(property), new Date(now));
    if (!mode) continue;
    const scored = scoreMatch(request, toListing(property, mode));
    if (!scored.eligible) continue;
    eligible.push({ property, scored });
  }
  eligible.sort((left, right) => {
    if (right.scored.score !== left.scored.score) return right.scored.score - left.scored.score;
    if (left.property.price !== right.property.price) return left.property.price - right.property.price;
    return left.property.id < right.property.id ? -1 : 1;
  });

  const statements: SqlStatement[] = [];
  const seen = new Set<string>();
  let rank = 1;
  for (const candidate of eligible) {
    seen.add(candidate.property.id);
    const prior = byProperty.get(candidate.property.id);
    statements.push(prior ? updateMatch(db, prior, candidate.scored, rank, now, true) : insertMatch(db, requirementId, candidate.property.id, candidate.scored, rank, now));
    rank += 1;
  }
  for (const prior of existing) {
    if (seen.has(prior.property_id)) continue;
    const reason = ineligibleReason(request, properties.find((property) => property.id === prior.property_id) ?? null, now);
    statements.push(retireMatch(db, prior, reason, rank, now));
    rank += 1;
  }
  const token = newId("meg");
  await db.batch([
    db
      .prepare(`UPDATE demand_requirements SET match_epoch = match_epoch + 1 WHERE id = ?1 AND match_epoch = ?2`)
      .bind(requirementId, Number(requirement.match_epoch)),
    db.prepare(`INSERT INTO match_write_guard (token, ok) VALUES (?1, changes())`).bind(token),
    ...statements,
    db.prepare(`DELETE FROM match_write_guard WHERE token = ?1`).bind(token),
  ]);
  return { result: "completed", error: "", count: eligible.length };
}

async function readRequirement(db: SqlDb, requirementId: string): Promise<RequirementCandidate | null> {
  return db
    .prepare(
      `SELECT id, status, intent, property_types_json, localities_json, locality_flexible, area_min,
              budget_min, budget_max, bhk_min, bhk_max, furnishing, vegetarian, parking_required,
              preference_details_json, match_epoch
       FROM demand_requirements WHERE id = ?1`,
    )
    .bind(requirementId)
    .first<RequirementCandidate>();
}

function isEpochConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /CHECK constraint failed/i.test(message);
}

function updateMatch(db: SqlDb, prior: MatchRow, scored: ScoredMatch, rank: number, now: string, eligible: boolean): SqlStatement {
  const decided = STAFF_DECISIONS.has(prior.status);
  return db
    .prepare(
      `UPDATE matches
       SET score = ?1, locality_score = ?2, area_score = ?3, budget_score = ?4, explanation = ?5,
           rank = ?6, matching_mode = ?7, status = ?8, eligible = ?9, updated_at = ?10
       WHERE id = ?11`,
    )
    .bind(
      scored.score,
      scored.localityScore,
      scored.areaScore,
      scored.budgetScore,
      scored.explanation,
      rank,
      scored.mode,
      decided ? prior.status : "Suggested",
      eligible ? 1 : 0,
      now,
      prior.id,
    );
}

function insertMatch(db: SqlDb, requirementId: string, propertyId: string, scored: ScoredMatch, rank: number, now: string): SqlStatement {
  return db
    .prepare(
      `INSERT INTO matches (
         id, requirement_id, property_id, score, locality_score, area_score, budget_score, explanation,
         rank, matching_mode, status, decision, decided_at, decision_reason, eligible, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'Suggested', '', NULL, '', 1, ?11, ?11)`,
    )
    .bind(
      newId("mat"),
      requirementId,
      propertyId,
      scored.score,
      scored.localityScore,
      scored.areaScore,
      scored.budgetScore,
      scored.explanation,
      rank,
      scored.mode,
      now,
    );
}

function retireMatch(db: SqlDb, prior: MatchRow, reason: string, rank: number, now: string): SqlStatement {
  const decided = STAFF_DECISIONS.has(prior.status);
  const explanation = decided
    ? `No longer eligible: ${reason} The staff decision (${prior.status}${prior.decision_reason ? `: ${prior.decision_reason}` : ""}) is unchanged. Last score while eligible: ${prior.score}.`
    : `No longer eligible: ${reason} Last score while it qualified: ${prior.score}.`;
  return db
    .prepare(
      `UPDATE matches SET explanation = ?1, rank = ?2, status = ?3, eligible = 0, updated_at = ?4 WHERE id = ?5`,
    )
    .bind(explanation, rank, decided ? prior.status : "Expired", now, prior.id);
}

function ineligibleReason(request: MatchRequest, property: PropertyCandidate | null, now: string): string {
  if (!property) return "The property is no longer in the inventory.";
  const mode = matchingMode(lifecycleOf(property), new Date(now));
  if (!mode) return "It is not verified, available inventory with a current owner confirmation.";
  const scored = scoreMatch(request, toListing(property, mode));
  return scored.eligible ? "It no longer fits this requirement." : scored.reason;
}

function toRequest(row: RequirementCandidate): MatchRequest {
  const details = parseJson<{ plotArea?: string }>(row.preference_details_json, {});
  return {
    intent: row.intent,
    propertyTypes: parseJson<string[]>(row.property_types_json, []),
    localities: parseJson<string[]>(row.localities_json, []),
    localityFlexible: Boolean(row.locality_flexible),
    areaMin: row.area_min,
    plotArea: typeof details.plotArea === "string" ? details.plotArea : null,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    bhkMin: row.bhk_min,
    bhkMax: row.bhk_max,
    furnishing: row.furnishing,
    vegetarian: row.vegetarian,
    parkingRequired: Boolean(row.parking_required),
  };
}

function toListing(property: PropertyCandidate, mode: MatchMode): MatchListing {
  return {
    listing: property.listing,
    propertyType: property.property_type,
    locality: property.locality,
    area: Number(property.area) || 0,
    plotDimensions: property.plot_dimensions ?? "",
    price: Number(property.price) || 0,
    bhk: property.bhk === null || property.bhk === undefined ? null : Number(property.bhk),
    furnished: property.furnished,
    vegetarian: property.vegetarian,
    parking: property.parking,
    mode,
  };
}

function lifecycleOf(property: PropertyCandidate): LifecycleState {
  return {
    listing: property.listing,
    verification: property.verification_status === "Verified" || property.verification_status === "Pending" || property.verification_status === "Rejected" || property.verification_status === "Draft"
      ? property.verification_status
      : "Draft",
    publication: property.publication_status === "Published" || property.publication_status === "Archived" || property.publication_status === "Unpublished"
      ? property.publication_status
      : "Unpublished",
    availability: property.status === "Available" || property.status === "On Hold" || property.status === "Rented" || property.status === "Sold" || property.status === "Withdrawn"
      ? property.status
      : "Available",
    discreetMatching: Boolean(property.discreet_matching),
    availabilityVerifiedAt: property.availability_verified_at,
    availabilityValidDays: Number(property.availability_valid_days) || 0,
  };
}

function toMatch(row: MatchRow, rank: number): StoredMatch {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    propertyId: row.property_id,
    propertyCode: row.code,
    propertyTitle: row.title,
    locality: row.locality,
    listing: row.listing,
    propertyType: row.property_type,
    price: Number(row.price) || 0,
    area: Number(row.area) || 0,
    plotDimensions: row.plot_dimensions ?? "",
    score: Number(row.score),
    localityScore: Number(row.locality_score),
    areaScore: Number(row.area_score),
    budgetScore: Number(row.budget_score),
    explanation: row.explanation,
    rank,
    matchingMode: row.matching_mode === "internal" ? "internal" : "public",
    status: (MATCH_STATUSES as readonly string[]).includes(row.status) ? (row.status as MatchStatus) : "Suggested",
    decision: row.decision,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    eligible: Boolean(row.eligible),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function recordRun(
  db: SqlDb,
  requirementId: string,
  trigger: MatchRunTrigger,
  result: "completed" | "skipped" | "failed",
  error: string,
  count: number,
  started: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO match_runs (id, requirement_id, trigger, result, error, match_count, started_at, finished_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(newId("mrun"), requirementId, trigger, result, error.slice(0, 500), count, started, new Date().toISOString())
    .run();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Matching failed.";
}
