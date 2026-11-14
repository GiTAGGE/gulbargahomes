import type { SqlDb } from "../db/sql";
import { safeRematchOpenRequirements, safeRequirementMatch, type MatchRunTrigger } from "./matching";

/** Raised after a lead is stored. Owner leads never enter matching. */
export type CapturedRecord =
  | { kind: "requirement"; id: string; contactId: string; origin: string }
  | { kind: "owner_lead"; id: string; contactId: string; origin: string };

export interface MatchingTrigger {
  /** Must not throw: a matching failure never undoes or retries an ingested lead. */
  onCaptured(db: SqlDb, record: CapturedRecord): Promise<void>;
}

/**
 * Requirements are matched against verified property inventory. Owner leads
 * stay out until staff turn one into a verified, available property.
 */
export const noMatching: MatchingTrigger = {
  async onCaptured(db, record) {
    if (record.kind !== "requirement") return;
    await safeRequirementMatch(db, record.id, "requirement_created");
  },
};

export type TimelineChange = {
  requirementId: string;
  reason: "extension" | "reopen";
};

/**
 * Called after a timeline extension or a reopen has been stored.
 * Scores are refreshed. Staff decisions are left as they were.
 * A failure must not undo the timeline change.
 */
export async function onRequirementTimelineChanged(db: SqlDb, change: TimelineChange): Promise<void> {
  await safeRequirementMatch(db, change.requirementId, change.reason === "extension" ? "timeline_extended" : "requirement_reopened");
}

/** Called after requirement details that affect ranking have been stored. */
export async function onRequirementDetailsChanged(db: SqlDb, requirementId: string): Promise<void> {
  await safeRequirementMatch(db, requirementId, "requirement_updated");
}

/** Called after a property change that can alter who is eligible or how they rank. */
export async function onPropertyMatchingChanged(db: SqlDb, trigger: MatchRunTrigger): Promise<void> {
  await safeRematchOpenRequirements(db, trigger);
}
