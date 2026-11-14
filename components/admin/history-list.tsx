import type { AuditEntry } from "@/lib/admin/audit";
import { formatDateTime } from "@/lib/admin/format";
import { formatHistoryChanges } from "@/lib/admin/history-format";

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
  confirm_owner: "Confirmed as a genuine owner",
  mark_owner_unqualified: "Marked not a genuine enquiry",
  mark_owner_pending: "Returned to pending review",
  confirm_buyer: "Confirmed as a genuine buyer",
  confirm_tenant: "Confirmed as a genuine tenant",
  mark_requirement_unqualified: "Marked not a genuine enquiry",
  mark_requirement_pending: "Returned to pending review",
  convert_additional: "Another property created from this lead",
  followup_done: "Follow-up done",
  followup_cancelled: "Follow-up cancelled",
  followup_open: "Follow-up reopened",
  match_decision: "Match decision",
  login: "Signed in",
  backfill: "Brought into the new inventory",
  sync_campaign_names: "Synced campaign names",
  select_ad_account: "Selected the ad account",
  import_campaign_spend: "Imported campaign spend",
};

function actorName(entry: AuditEntry, names: Record<string, string>) {
  if (names[entry.actorId]) return names[entry.actorId];
  if (entry.actorId === "legacy") return "Primary admin";
  if (entry.actorId === "migration" || entry.actorId === "system") return "System";
  return entry.actorEmail;
}

export function HistoryList({ entries, names }: { entries: AuditEntry[]; names: Record<string, string> }) {
  if (entries.length === 0) return <Empty>No history yet.</Empty>;
  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const lines = formatHistoryChanges(entry.changes);
        return (
          <li key={entry.id} className="border-l-2 border-brand-100 pl-3">
            <p className="text-sm font-semibold text-ink">{ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, " ")}</p>
            <p className="text-xs text-ink-faint">
              {actorName(entry, names)} · {formatDateTime(entry.occurredAt)}
            </p>
            {lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {lines.map((line) => (
                  <li key={line.key}>
                    <span className="font-medium text-ink">{line.label}</span>: {line.text}
                  </li>
                ))}
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
