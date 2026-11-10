/** Shared with client components: no imports. */
export const INGESTION_STATUSES = [
  "pending",
  "processing",
  "retry",
  "waiting_token",
  "needs_mapping",
  "needs_review",
  "done",
  "duplicate",
  "ignored",
  "failed",
] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export const INGESTION_STATUS_LABEL: Record<IngestionStatus, string> = {
  pending: "Queued",
  processing: "Processing",
  retry: "Retrying",
  waiting_token: "Waiting for reconnection",
  needs_mapping: "Form not classified",
  needs_review: "Needs review",
  done: "Imported",
  duplicate: "Duplicate",
  ignored: "Ignored form",
  failed: "Failed",
};
