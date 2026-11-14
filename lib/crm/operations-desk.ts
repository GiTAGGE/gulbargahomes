import { budgetLabel } from "../admin/format";
import type { SqlDb } from "../db/sql";
import { MEANINGFUL_ACTIVITY_SQL } from "./engagement";
import { listRequirements, type Requirement } from "./requirements";
import { redactContactPhone } from "./redact";
import { STAFF_CONFIRMATION_LEAD, isPausedStatus, loadTimelineViews, type RequirementTimelineView } from "./timeline";

/**
 * Why a requirement is on the desk. Urgency comes from `describeTimeline`.
 * Contact reasons use real conversations, not unanswered calls or staff-recorded WhatsApp handoffs.
 * Intent score is not a reason.
 */
export const DESK_REASONS = [
  "critical",
  "overdue",
  "high",
  "first_contact",
  "review",
  "extended",
  "reopened",
  "reattempt",
  "no_match",
  "shortlisted",
  "shared",
] as const;
export type DeskReason = (typeof DESK_REASONS)[number];

export const DESK_REASON_LABEL: Record<DeskReason, string> = {
  critical: "Critical",
  overdue: "Overdue",
  high: "High urgency",
  first_contact: "Awaiting first contact",
  review: "Pending verification",
  extended: "Timeline extended",
  reopened: "Reopened",
  reattempt: "Contact again",
  no_match: "No suitable match",
  shortlisted: "Shortlist to follow up",
  shared: "Shared, awaiting follow-up",
};

export const DESK_QUEUES = [
  { id: "all", label: "All open work", reasons: null },
  { id: "critical", label: "Critical and overdue", reasons: ["critical", "overdue"] },
  { id: "high", label: "High urgency", reasons: ["high"] },
  { id: "first_contact", label: "First contact", reasons: ["first_contact"] },
  { id: "review", label: "Pending review", reasons: ["review"] },
  { id: "extended", label: "Timeline extended", reasons: ["extended"] },
  { id: "reopened", label: "Reopened", reasons: ["reopened"] },
  { id: "reattempt", label: "Contact again", reasons: ["reattempt"] },
  { id: "no_match", label: "No suitable match", reasons: ["no_match"] },
  { id: "shortlisted", label: "Shortlisted", reasons: ["shortlisted"] },
  { id: "shared", label: "Shared or visit", reasons: ["shared"] },
] as const;
export type DeskQueueId = (typeof DESK_QUEUES)[number]["id"];

export const DESK_PAGE_SIZE = 25;

/** Classes the Today desk uses so rows wrap on a phone instead of scrolling sideways. */
export const DESK_LAYOUT = {
  filters: "flex flex-wrap gap-2",
  row: "min-w-0 break-words",
} as const;

const NEXT_ACTION: Array<{ reason: DeskReason; text: string }> = [
  { reason: "overdue", text: "Contact today. The confirmed deadline has passed." },
  { reason: "critical", text: "Contact today. This requirement is critical." },
  { reason: "reattempt", text: "Try again. The last attempt did not reach the client." },
  { reason: "first_contact", text: "Make the first meaningful contact." },
  { reason: "shortlisted", text: "Follow up the shortlisted property." },
  { reason: "shared", text: "Follow up the property already shared, or the visit." },
  { reason: "no_match", text: "No eligible property matches. Review the requirement or the inventory." },
  { reason: "review", text: "Verify the contact and the requirement before treating it as genuine." },
  { reason: "reopened", text: "The client is looking again. Confirm the next step." },
  { reason: "extended", text: "Work the timeline the client confirmed." },
  { reason: "high", text: "Contact soon. Urgency is high." },
];

const SHORTLISTED = new Set(["Shortlisted"]);
const SHARED_FOLLOW_UP = new Set(["Shared", "Visit scheduled", "Visited", "Negotiation"]);

const CUSTOMER_SQL = `(${MEANINGFUL_ACTIVITY_SQL} AND a.body NOT LIKE '${STAFF_CONFIRMATION_LEAD}%')`;

const BAND_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3, Paused: 4, Closed: 5 };

export type DeskAccess = {
  viewPhone: boolean;
  viewDiscreet: boolean;
  viewMatches: boolean;
};

export type DeskRow = {
  id: string;
  code: string;
  contactName: string;
  contactPhone: string;
  intent: Requirement["intent"];
  propertyTypes: string[];
  localities: string[];
  budget: string;
  originalTimeline: string;
  confirmedTimeline: string;
  urgency: string;
  overdue: boolean;
  lastMeaningfulAt: string | null;
  customerEngaged: boolean;
  attemptCount: number;
  reasons: DeskReason[];
  reasonLabels: string[];
  nextAction: string;
  createdAt: string;
};

export type DeskPage = {
  queue: DeskQueueId;
  rows: DeskRow[];
  total: number;
  page: number;
  pages: number;
  counts: Record<DeskQueueId, number>;
};

type MatchSignal = { requirement_id: string; matching_mode: string; status: string; eligible: number };
type RunSignal = { requirement_id: string; result: string; started_at: string };
type ContactSignal = { requirement_id: string; customer_hits: number; last_customer_at: string | null };

export function emptyDeskMessage(queue: string): string {
  const found = DESK_QUEUES.find((item) => item.id === queue);
  if (!found || found.id === "all") return "Nothing needs attention on this desk.";
  return `Nothing in ${found.label.toLowerCase()}.`;
}

export function paginateDesk<T>(rows: T[], page: number, pageSize = DESK_PAGE_SIZE): { rows: T[]; page: number; pages: number; total: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: current, pages, total };
}

function queueById(id: string | undefined): (typeof DESK_QUEUES)[number] {
  return DESK_QUEUES.find((item) => item.id === id) ?? DESK_QUEUES[0];
}

function nextAction(reasons: DeskReason[]): string {
  return NEXT_ACTION.find((item) => reasons.includes(item.reason))?.text ?? "Open the requirement and choose the next step.";
}

function compares(row: DeskRow, other: DeskRow): number {
  const rank = (item: DeskRow) => (item.overdue ? 0 : 10) + (BAND_RANK[item.urgency] ?? 9);
  return rank(row) - rank(other) || row.createdAt.localeCompare(other.createdAt) || row.id.localeCompare(other.id);
}

async function rowsFor<T>(db: SqlDb, sql: string, ids: string[]): Promise<T[]> {
  const collected: T[] = [];
  for (let index = 0; index < ids.length; index += 40) {
    const chunk = ids.slice(index, index + 40);
    const marks = chunk.map((_, place) => `?${place + 1}`).join(", ");
    const { results } = await db.prepare(sql.replaceAll("?", marks)).bind(...chunk).all<T>();
    collected.push(...results);
  }
  return collected;
}

function reasonsFor(
  requirement: Requirement,
  timeline: RequirementTimelineView,
  contact: ContactSignal | undefined,
  matches: MatchSignal[],
  latestRun: string | null,
  viewDiscreet: boolean,
  viewMatches: boolean,
): DeskReason[] {
  const reasons: DeskReason[] = [];
  const band = timeline.current.band;
  if (band === "Critical") reasons.push("critical");
  if (timeline.current.overdue) reasons.push("overdue");
  if (band === "High") reasons.push("high");

  const customerHits = Number(contact?.customer_hits ?? 0);
  const engaged = customerHits > 0;
  if (requirement.status === "New" && requirement.attemptCount === 0 && !engaged) reasons.push("first_contact");
  if (requirement.qualityReview === "") reasons.push("review");
  if (timeline.revisions.some((revision) => revision.kind === "extension")) reasons.push("extended");
  if (timeline.revisions.some((revision) => revision.kind === "reopen")) reasons.push("reopened");
  if (requirement.attemptCount > 0 && !engaged) reasons.push("reattempt");

  if (viewMatches) {
    const visible = matches.filter((match) => viewDiscreet || match.matching_mode !== "internal");
    const eligible = (match: MatchSignal) => Number(match.eligible) === 1;
    const hiddenEligible = !viewDiscreet && matches.some((match) => match.matching_mode === "internal" && eligible(match));
    if (visible.some((match) => eligible(match) && SHORTLISTED.has(match.status))) reasons.push("shortlisted");
    if (visible.some((match) => eligible(match) && SHARED_FOLLOW_UP.has(match.status))) reasons.push("shared");
    const eligibleVisible = visible.some((match) => eligible(match));
    if (latestRun === "completed" && !eligibleVisible && !hiddenEligible) reasons.push("no_match");
  }
  return reasons;
}

export async function operationsDesk(
  db: SqlDb,
  access: DeskAccess,
  options: { now?: Date; queue?: string; page?: number } = {},
): Promise<DeskPage> {
  const now = options.now ?? new Date();
  const queue = queueById(options.queue);
  const open = (await listRequirements(db, { status: "open", limit: 500 }, now)).filter(
    (item) => !isPausedStatus(item.status),
  );
  const ids = open.map((item) => item.id);
  const [timelines, contacts, matches, runs] = await Promise.all([
    loadTimelineViews(db, open, now),
    rowsFor<ContactSignal>(
      db,
      `SELECT a.entity_id AS requirement_id,
              SUM(CASE WHEN ${CUSTOMER_SQL} THEN 1 ELSE 0 END) AS customer_hits,
              MAX(CASE WHEN ${CUSTOMER_SQL} THEN a.occurred_at ELSE NULL END) AS last_customer_at
       FROM activities a
       WHERE a.entity_type = 'requirement' AND a.entity_id IN (?)
       GROUP BY a.entity_id`,
      ids,
    ),
    access.viewMatches
      ? rowsFor<MatchSignal>(
          db,
          `SELECT requirement_id, matching_mode, status, eligible FROM matches WHERE requirement_id IN (?)`,
          ids,
        )
      : Promise.resolve([]),
    access.viewMatches
      ? rowsFor<RunSignal>(
          db,
          `SELECT requirement_id, result, started_at FROM match_runs WHERE requirement_id IN (?)`,
          ids,
        )
      : Promise.resolve([]),
  ]);

  const contactById = new Map(contacts.map((row) => [row.requirement_id, row]));
  const matchesById = new Map<string, MatchSignal[]>();
  for (const match of matches) {
    const list = matchesById.get(match.requirement_id) ?? [];
    list.push(match);
    matchesById.set(match.requirement_id, list);
  }
  const latestRun = new Map<string, RunSignal>();
  for (const run of runs) {
    const prior = latestRun.get(run.requirement_id);
    if (!prior || run.started_at >= prior.started_at) latestRun.set(run.requirement_id, run);
  }

  const built: DeskRow[] = [];
  for (const requirement of open) {
    const timeline = timelines.get(requirement.id);
    if (!timeline) continue;
    const contact = contactById.get(requirement.id);
    const reasons = reasonsFor(
      requirement,
      timeline,
      contact,
      matchesById.get(requirement.id) ?? [],
      latestRun.get(requirement.id)?.result ?? null,
      access.viewDiscreet,
      access.viewMatches,
    );
    if (reasons.length === 0) continue;
    const engaged = Number(contact?.customer_hits ?? 0) > 0;
    const row: DeskRow = {
      id: requirement.id,
      code: requirement.code,
      contactName: requirement.contactName,
      contactPhone: requirement.contactPhone,
      intent: requirement.intent,
      propertyTypes: requirement.propertyTypes,
      localities: requirement.localities,
      budget: budgetLabel(requirement.budgetMin, requirement.budgetMax, requirement.intent),
      originalTimeline: timeline.originalTimeline,
      confirmedTimeline: timeline.currentTimeline,
      urgency: timeline.current.band,
      overdue: timeline.current.overdue,
      lastMeaningfulAt: engaged ? (contact?.last_customer_at ?? null) : null,
      customerEngaged: engaged,
      attemptCount: requirement.attemptCount,
      reasons,
      reasonLabels: reasons.map((reason) => DESK_REASON_LABEL[reason]),
      nextAction: nextAction(reasons),
      createdAt: requirement.createdAt,
    };
    built.push(redactContactPhone(row, access.viewPhone));
  }
  built.sort(compares);

  const counts = Object.fromEntries(DESK_QUEUES.map((item) => [item.id, 0])) as Record<DeskQueueId, number>;
  counts.all = built.length;
  for (const item of DESK_QUEUES) {
    if (!item.reasons) continue;
    counts[item.id] = built.filter((row) => item.reasons.some((reason) => row.reasons.includes(reason))).length;
  }
  const filtered = queue.reasons
    ? built.filter((row) => queue.reasons.some((reason) => row.reasons.includes(reason)))
    : built;
  const page = paginateDesk(filtered, options.page ?? 1);
  return { queue: queue.id, rows: page.rows, total: page.total, page: page.page, pages: page.pages, counts };
}
