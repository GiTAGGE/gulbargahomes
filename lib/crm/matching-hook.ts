import type { SqlDb } from "../db/sql";

/** Raised after a lead is stored. Phase 2's matching engine implements this. */
export type CapturedRecord =
  | { kind: "requirement"; id: string; contactId: string; origin: string }
  | { kind: "owner_lead"; id: string; contactId: string; origin: string };

export interface MatchingTrigger {
  /** Must not throw: a matching failure never undoes or retries an ingested lead. */
  onCaptured(db: SqlDb, record: CapturedRecord): Promise<void>;
}

/**
 * Until the matching engine lands, nothing is matched. Owner leads never enter
 * matching; only verified, available properties do, after staff create them.
 */
export const noMatching: MatchingTrigger = {
  async onCaptured() {},
};

export type TimelineChange = {
  requirementId: string;
  reason: "extension" | "reopen";
};

/**
 * Called after a timeline extension or a reopen has been stored.
 * Matching will re-rank from here. A failure must not undo the timeline change.
 */
export async function onRequirementTimelineChanged(
  _db: SqlDb,
  _change: TimelineChange,
): Promise<void> {}
