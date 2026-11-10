"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatDateTime, fromIstInput, relativeTime, toIstInput } from "@/lib/admin/format";
import type { Activity, Followup } from "@/lib/crm/activity";
import { ACTIVITY_KIND_LABEL, ACTIVITY_OUTCOME_LABEL, type ActivityKind, type ActivityOutcome } from "@/lib/crm/options";

import { Empty, Pill, inputClass, labelClass } from "./ui";

type EntityRef = { entityType: "owner_lead" | "requirement" | "property" | "contact"; entityId: string; contactId: string | null };

const KINDS: ActivityKind[] = ["call", "whatsapp", "note", "visit", "owner_confirmation", "sms", "email"];

const OUTCOMES_FOR: Partial<Record<ActivityKind, ActivityOutcome[]>> = {
  call: ["connected", "no_answer", "busy", "switched_off", "wrong_number", "callback_requested"],
  whatsapp: ["sent", "replied"],
  sms: ["sent", "replied"],
  email: ["sent", "replied"],
  visit: ["connected"],
  owner_confirmation: ["connected", "no_answer"],
};

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error || "That did not save.";
}

function defaultFollowupTime(): string {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const value = toIstInput(tomorrow.toISOString());
  return `${value.slice(0, 10)}T11:00`;
}

export function TimelinePanel({
  entity,
  activities,
  names,
  canLog,
  canFollowUp,
}: {
  entity: EntityRef;
  activities: Activity[];
  names: Record<string, string>;
  canLog: boolean;
  canFollowUp: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ActivityKind>("call");
  const [outcome, setOutcome] = useState<ActivityOutcome>("connected");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [body, setBody] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [nextReason, setNextReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const outcomes = OUTCOMES_FOR[kind] ?? [];

  async function submit() {
    setPending(true);
    setError("");
    const problem = await send("/api/admin/activities", "POST", {
      ...entity,
      kind,
      direction,
      outcome: outcomes.includes(outcome) ? outcome : "",
      body,
    });
    if (!problem && canFollowUp && nextAt) {
      const followupProblem = await send("/api/admin/followups", "POST", {
        ...entity,
        dueAt: fromIstInput(nextAt),
        reason: nextReason || `Follow up after ${ACTIVITY_KIND_LABEL[kind].toLowerCase()}`,
      });
      if (followupProblem) setError(`Activity saved, but the follow-up was not: ${followupProblem}`);
    }
    setPending(false);
    if (problem) {
      setError(problem);
      return;
    }
    setBody("");
    setNextAt("");
    setNextReason("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canLog && (
        <div className="space-y-3 rounded-xl bg-surface-muted/60 p-3">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setKind(item);
                  setOutcome(OUTCOMES_FOR[item]?.[0] ?? "");
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  item === kind ? "bg-brand-700 text-white" : "bg-white text-ink ring-1 ring-brand-100"
                }`}
              >
                {ACTIVITY_KIND_LABEL[item]}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {outcomes.length > 0 && (
              <label className={labelClass}>
                Outcome
                <select value={outcome} onChange={(event) => setOutcome(event.target.value as ActivityOutcome)} className={inputClass}>
                  {outcomes.map((item) => (
                    <option key={item} value={item}>
                      {ACTIVITY_OUTCOME_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind !== "note" && (
              <label className={labelClass}>
                Direction
                <select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value === "inbound" ? "inbound" : "outbound")}
                  className={inputClass}
                >
                  <option value="outbound">We reached out</option>
                  <option value="inbound">They contacted us</option>
                </select>
              </label>
            )}
          </div>
          <label className={labelClass}>
            {kind === "note" ? "Note" : "What was said"}
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} className={inputClass} />
          </label>
          {canFollowUp && (
            <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
              <label className={labelClass}>
                Next follow-up (IST)
                <input
                  type="datetime-local"
                  value={nextAt}
                  onChange={(event) => setNextAt(event.target.value)}
                  onFocus={() => !nextAt && setNextAt(defaultFollowupTime())}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                For
                <input
                  value={nextReason}
                  onChange={(event) => setNextReason(event.target.value)}
                  placeholder="e.g. send photos, confirm visit time"
                  className={inputClass}
                />
              </label>
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn-primary" disabled={pending || (kind === "note" && !body.trim())} onClick={() => void submit()}>
            {pending ? "Saving…" : "Log activity"}
          </button>
        </div>
      )}

      {activities.length === 0 ? (
        <Empty>No calls, messages or notes yet.</Empty>
      ) : (
        <ol className="space-y-3">
          {activities.map((activity) => (
            <li key={activity.id} className="border-l-2 border-brand-100 pl-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-ink">{ACTIVITY_KIND_LABEL[activity.kind]}</span>
                {activity.direction === "inbound" && <Pill tone="blue">Inbound</Pill>}
                {activity.outcome && (
                  <Pill tone={activity.outcome === "connected" || activity.outcome === "replied" ? "green" : "amber"}>
                    {ACTIVITY_OUTCOME_LABEL[activity.outcome]}
                  </Pill>
                )}
                {activity.channel !== "manual" && (
                  <Pill tone="violet">{activity.channel === "wa_cloud_api" ? "WhatsApp API" : "WhatsApp Business"}</Pill>
                )}
              </div>
              {activity.body && <p className="mt-0.5 whitespace-pre-line text-sm text-ink-muted">{activity.body}</p>}
              <p className="mt-0.5 text-xs text-ink-faint">
                {names[activity.actorId] ?? (activity.actorId === "legacy" ? "Primary admin" : "Staff")} ·{" "}
                {formatDateTime(activity.occurredAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function FollowupsPanel({
  entity,
  followups,
  canManage,
}: {
  entity: EntityRef;
  followups: Followup[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const now = new Date();

  async function add() {
    setPending("add");
    setError("");
    const problem = await send("/api/admin/followups", "POST", { ...entity, dueAt: fromIstInput(dueAt), reason });
    setPending("");
    if (problem) return setError(problem);
    setDueAt("");
    setReason("");
    router.refresh();
  }

  async function close(followup: Followup, status: "Done" | "Cancelled") {
    setPending(followup.id);
    setError("");
    const problem = await send(`/api/admin/followups/${followup.id}`, "PATCH", { status });
    setPending("");
    if (problem) return setError(problem);
    router.refresh();
  }

  const open = followups.filter((item) => item.status === "Open");
  const closed = followups.filter((item) => item.status !== "Open").slice(0, 5);

  return (
    <div className="space-y-3">
      {open.length === 0 && <p className="text-sm text-ink-muted">Nothing scheduled.</p>}
      <ul className="space-y-2">
        {open.map((item) => {
          const overdue = new Date(item.dueAt) < now;
          return (
            <li key={item.id} className={`rounded-xl px-3 py-2 ${overdue ? "bg-red-50" : "bg-surface-muted/60"}`}>
              <p className="text-sm font-semibold text-ink">{item.reason}</p>
              <p className={`text-xs ${overdue ? "font-semibold text-red-800" : "text-ink-muted"}`}>
                {formatDateTime(item.dueAt)} · {relativeTime(item.dueAt, now)}
              </p>
              {canManage && (
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={Boolean(pending)}
                    onClick={() => void close(item, "Done")}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="rounded-full px-3 py-1 text-xs font-semibold text-ink-muted ring-1 ring-brand-100 disabled:opacity-50"
                    disabled={Boolean(pending)}
                    onClick={() => void close(item, "Cancelled")}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {closed.length > 0 && (
        <ul className="space-y-1 text-xs text-ink-faint">
          {closed.map((item) => (
            <li key={item.id}>
              {item.status === "Done" ? "✓" : "✕"} {item.reason} · {formatDateTime(item.completedAt)}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="space-y-2 border-t border-brand-50 pt-3">
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            onFocus={() => !dueAt && setDueAt(defaultFollowupTime())}
            aria-label="Follow-up time (IST)"
            className={inputClass}
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What to do"
            aria-label="Follow-up reason"
            className={inputClass}
          />
          <button
            type="button"
            className="btn-ghost w-full"
            disabled={Boolean(pending) || !dueAt || !reason.trim()}
            onClick={() => void add()}
          >
            {pending === "add" ? "Saving…" : "Schedule follow-up"}
          </button>
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
