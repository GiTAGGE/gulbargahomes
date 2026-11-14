"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CONFIRMATION_METHOD_LABEL,
  CONFIRMATION_METHODS,
  CONFIRMED_TIMELINES,
  EXTENSION_REASONS,
} from "@/lib/crm/options";

import { inputClass, labelClass } from "./ui";

async function post(url: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error || "That did not save.";
}

export function RequirementTimelineActions({
  id,
  rowVersion,
  canEdit,
  canLog,
  canReopen,
  canExtend,
}: {
  id: string;
  rowVersion: number;
  canEdit: boolean;
  canLog: boolean;
  canReopen: boolean;
  canExtend: boolean;
}) {
  const router = useRouter();
  const [timeline, setTimeline] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [attemptKind, setAttemptKind] = useState<"call" | "whatsapp">("call");
  const [attemptOutcome, setAttemptOutcome] = useState("no_answer");
  const [attemptNotes, setAttemptNotes] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function submit(url: string, body: Record<string, unknown>, key: string) {
    setPending(key);
    setError("");
    const problem = await post(url, { ...body, rowVersion });
    setPending("");
    if (problem) return setError(problem);
    setNotes("");
    setAttemptNotes("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canExtend && canEdit && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              `/api/admin/requirements/${id}/timeline`,
              { timeline, neededBy, reason, confirmationMethod: method, notes },
              "extend",
            );
          }}
        >
          <p className="text-sm font-semibold text-ink">Extend client timeline</p>
          <p className="text-xs text-ink-muted">
            Use this only after the client confirms a new timeline. The original enquiry date stays. This does not verify
            the requirement or make it critical by itself.
          </p>
          <label className={labelClass}>
            New timeline
            <select value={timeline} onChange={(event) => setTimeline(event.target.value)} className={inputClass} required>
              <option value="">Choose</option>
              {CONFIRMED_TIMELINES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            New target date
            <input type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Reason
            <select value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} required>
              <option value="">Choose</option>
              {EXTENSION_REASONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            How the client confirmed
            <select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass} required>
              <option value="">Choose</option>
              {CONFIRMATION_METHODS.map((item) => (
                <option key={item} value={item}>
                  {CONFIRMATION_METHOD_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What the client said"
            rows={2}
            className={inputClass}
          />
          <button type="submit" className="btn-primary w-full" disabled={Boolean(pending)}>
            {pending === "extend" ? "Saving…" : "Save extension"}
          </button>
        </form>
      )}

      {canReopen && canEdit && (
        <form
          className="space-y-2 border-t border-brand-50 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              `/api/admin/requirements/${id}/reopen`,
              { timeline, neededBy, confirmationMethod: method, notes },
              "reopen",
            );
          }}
        >
          <p className="text-sm font-semibold text-ink">Reopen requirement</p>
          <p className="text-xs text-ink-muted">
            The client has come back. The closed period stays in the history, and a new urgency cycle starts from the
            timeline they confirm now.
          </p>
          <label className={labelClass}>
            Timeline they confirmed
            <select value={timeline} onChange={(event) => setTimeline(event.target.value)} className={inputClass} required>
              <option value="">Choose</option>
              {CONFIRMED_TIMELINES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Target date
            <input type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            How they confirmed
            <select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass} required>
              <option value="">Choose</option>
              {CONFIRMATION_METHODS.map((item) => (
                <option key={item} value={item}>
                  {CONFIRMATION_METHOD_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Why they are looking again"
            rows={2}
            className={inputClass}
            required
          />
          <button type="submit" className="btn-primary w-full" disabled={Boolean(pending)}>
            {pending === "reopen" ? "Saving…" : "Reopen requirement"}
          </button>
        </form>
      )}

      {canLog && (
        <form
          className="space-y-2 border-t border-brand-50 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              `/api/admin/requirements/${id}/attempt`,
              { kind: attemptKind, outcome: attemptOutcome, notes: attemptNotes },
              "attempt",
            );
          }}
        >
          <p className="text-sm font-semibold text-ink">Record contact attempt</p>
          <p className="text-xs text-ink-muted">
            An unanswered call or a WhatsApp message that was only sent. This does not extend the deadline and does not
            count as the client responding.
          </p>
          <label className={labelClass}>
            Channel
            <select
              value={attemptKind}
              onChange={(event) => {
                const kind = event.target.value === "whatsapp" ? "whatsapp" : "call";
                setAttemptKind(kind);
                setAttemptOutcome(kind === "whatsapp" ? "sent" : "no_answer");
              }}
              className={inputClass}
            >
              <option value="call">Phone call</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <label className={labelClass}>
            What happened
            <select value={attemptOutcome} onChange={(event) => setAttemptOutcome(event.target.value)} className={inputClass}>
              {attemptKind === "call" ? (
                <>
                  <option value="no_answer">No answer</option>
                  <option value="busy">Busy</option>
                  <option value="switched_off">Switched off</option>
                  <option value="wrong_number">Wrong number</option>
                </>
              ) : (
                <option value="sent">Sent, no reply</option>
              )}
            </select>
          </label>
          <textarea
            value={attemptNotes}
            onChange={(event) => setAttemptNotes(event.target.value)}
            placeholder="Note (optional)"
            rows={2}
            className={inputClass}
          />
          <button type="submit" className="btn-ghost w-full" disabled={Boolean(pending)}>
            {pending === "attempt" ? "Saving…" : "Save attempt"}
          </button>
        </form>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
