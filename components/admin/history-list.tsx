import type { AuditEntry } from "@/lib/admin/audit";
import { formatDateTime } from "@/lib/admin/format";

import { Empty } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Edited",
  update_with_price_change: "Edited, including price",
  status_change: "Status changed",
  submit_for_verification: "Submitted for verification",
  verify: "Verified",
  reject: "Rejected",
  publish: "Published on website",
  unpublish: "Unpublished",
  archive: "Archived",
  restore: "Restored from archive",
  set_availability: "Availability changed",
  confirm_availability: "Availability confirmed with owner",
  set_discreet: "Discreet matching changed",
  link_owner: "Owner linked",
  convert: "Converted to draft property",
  mark_not_owner: "Marked not an owner",
  restore_owner_role: "Owner classification restored",
  convert_additional: "Another property created from this lead",
  followup_done: "Follow-up done",
  followup_cancelled: "Follow-up cancelled",
  followup_open: "Follow-up reopened",
  login: "Signed in",
  backfill: "Brought into the new inventory",
};

const FIELD_LABEL: Record<string, string> = {
  status: "status",
  role_review: "classification",
  role_review_note: "classification note",
  verification_status: "verification",
  publication_status: "publication",
  price: "price",
  price_suffix: "price suffix",
  discreet_matching: "discreet",
  availability_verified_at: "availability checked",
  availability_valid_days: "valid for (days)",
  rejection_reason: "reason",
};

function actorName(entry: AuditEntry, names: Record<string, string>) {
  if (names[entry.actorId]) return names[entry.actorId];
  if (entry.actorId === "legacy") return "Primary admin";
  if (entry.actorId === "migration" || entry.actorId === "system") return "System";
  return entry.actorEmail;
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function HistoryList({ entries, names }: { entries: AuditEntry[]; names: Record<string, string> }) {
  if (entries.length === 0) return <Empty>No history yet.</Empty>;
  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const changes = Object.entries(entry.changes);
        return (
          <li key={entry.id} className="border-l-2 border-brand-100 pl-3">
            <p className="text-sm font-semibold text-ink">{ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, " ")}</p>
            <p className="text-xs text-ink-faint">
              {actorName(entry, names)} · {formatDateTime(entry.occurredAt)}
            </p>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {changes.slice(0, 8).map(([field, [before, after]]) => (
                  <li key={field}>
                    <span className="font-medium text-ink">{FIELD_LABEL[field] ?? field.replace(/_/g, " ")}</span>:{" "}
                    {show(before)} → {show(after)}
                  </li>
                ))}
                {changes.length > 8 && <li>and {changes.length - 8} more fields</li>}
              </ul>
            )}
            {typeof entry.context.reason === "string" && entry.context.reason && (
              <p className="mt-1 text-xs text-ink-muted">Reason: {entry.context.reason}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
