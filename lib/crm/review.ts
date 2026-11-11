/** Staff quality decision. Empty stored text means pending and is never treated as genuine. */
export const REVIEW_DECISIONS = ["pending", "genuine", "misclassified", "unqualified"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REQUIREMENT_REVIEW_DECISIONS = ["pending", "genuine", "unqualified"] as const;
export type RequirementReviewDecision = (typeof REQUIREMENT_REVIEW_DECISIONS)[number];

export type StoredReview = "" | "genuine" | "misclassified" | "unqualified";

export function storedReview(value: string | null | undefined): StoredReview {
  if (value === "genuine" || value === "misclassified" || value === "unqualified") return value;
  return "";
}

export function storedFromDecision(decision: ReviewDecision): StoredReview {
  return decision === "pending" ? "" : decision;
}

/** Pending and confirmed owners keep the Owner badge. Misclassified and unqualified do not. */
export function keepsOwnerBadge(review: string): boolean {
  return review !== "misclassified" && review !== "unqualified";
}

export function reviewLabel(kind: "owner" | "buyer" | "tenant", review: StoredReview): string {
  if (review === "") return "Pending verification";
  if (review === "misclassified") return "Not an owner";
  if (review === "unqualified") return "Not a genuine enquiry";
  if (kind === "buyer") return "Genuine buyer";
  if (kind === "tenant") return "Genuine tenant";
  return "Genuine owner";
}

export function ownerReviewAction(decision: ReviewDecision): string {
  if (decision === "genuine") return "confirm_owner";
  if (decision === "misclassified") return "mark_not_owner";
  if (decision === "unqualified") return "mark_owner_unqualified";
  return "mark_owner_pending";
}

export function requirementReviewAction(decision: RequirementReviewDecision, intent: "Buy" | "Rent"): string {
  if (decision === "genuine") return intent === "Buy" ? "confirm_buyer" : "confirm_tenant";
  if (decision === "unqualified") return "mark_requirement_unqualified";
  return "mark_requirement_pending";
}
