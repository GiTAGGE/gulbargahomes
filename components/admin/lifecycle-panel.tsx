"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { availabilityTone, formatDate, formatDateTime, publicationTone, verificationTone } from "@/lib/admin/format";

import { Pill, controlClass, inputClass } from "./ui";

const AVAILABILITY = ["Available", "On Hold", "Rented", "Sold", "Withdrawn"] as const;

export type LifecyclePanelProps = {
  slug: string;
  rowVersion: number;
  verification: string;
  publication: string;
  availability: string;
  discreet: boolean;
  rejectionReason: string;
  verifiedAt: string | null;
  availabilityVerifiedAt: string | null;
  availabilityExpiresAt: string | null;
  validDays: number;
  isPublic: boolean;
  matchMode: "public" | "internal" | null;
  blockers: string[];
  actions: string[];
  canChangeAvailability: boolean;
  canSeeDiscreet: boolean;
};

export function LifecyclePanel(props: LifecyclePanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [availability, setAvailability] = useState(props.availability);
  const [confirmNow, setConfirmNow] = useState(true);
  const [validDays, setValidDays] = useState("");
  const can = (action: string) => props.actions.includes(action);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setPending(action);
    setError("");
    const response = await fetch(`/api/admin/properties/${encodeURIComponent(props.slug)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, rowVersion: props.rowVersion, ...extra }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setPending("");
    if (!response.ok) {
      setError(data.error || "That did not work. Nothing changed.");
      return;
    }
    setRejecting(false);
    setReason("");
    router.refresh();
  }

  const button = (action: string, label: string, tone: "primary" | "ghost" | "danger" = "ghost", extra = {}) =>
    can(action) ? (
      <button
        type="button"
        disabled={Boolean(pending)}
        onClick={() => void run(action, extra)}
        className={
          tone === "primary"
            ? "btn-primary w-full"
            : `btn-ghost w-full ${tone === "danger" ? "text-red-800" : ""}`
        }
      >
        {pending === action ? "Working…" : label}
      </button>
    ) : null;

  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-4 shadow-soft">
      <h2 className="text-sm font-bold text-ink">Status</h2>
      <div className="mt-2 flex flex-wrap gap-1">
        <Pill tone={verificationTone(props.verification)}>{props.verification}</Pill>
        <Pill tone={publicationTone(props.publication)}>{props.publication}</Pill>
        <Pill tone={availabilityTone(props.availability)}>{props.availability}</Pill>
        {props.discreet && <Pill tone="violet">Discreet</Pill>}
      </div>

      <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${props.isPublic ? "bg-sky-50 text-sky-900" : "bg-surface-muted text-ink-muted"}`}>
        {props.isPublic ? "Visible on the website." : "Not on the website. Only staff can see this property."}
      </div>

      <div className="mt-2 rounded-xl border border-brand-50 px-3 py-2 text-sm">
        {props.matchMode === "public" && <p className="font-semibold text-brand-800">Eligible for matching</p>}
        {props.matchMode === "internal" && (
          <p className="font-semibold text-violet-800">Eligible for staff-only (discreet) matching</p>
        )}
        {!props.matchMode && (
          <>
            <p className="font-semibold text-ink">Not in active matching</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
              {props.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {props.rejectionReason && props.verification === "Rejected" && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">Rejected: {props.rejectionReason}</p>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {props.publication !== "Archived" && (
        <div className="mt-4 space-y-2 border-t border-brand-50 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Owner availability check</p>
          <p className="text-xs text-ink-muted">
            {props.availabilityVerifiedAt
              ? `Last confirmed ${formatDateTime(props.availabilityVerifiedAt)}. Valid until ${formatDate(props.availabilityExpiresAt)}.`
              : "Never confirmed with the owner."}
          </p>
          {can("confirm_availability") && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={Boolean(pending)}
                onClick={() => void run("confirm_availability", validDays ? { validDays: Number(validDays) } : {})}
                className="btn-primary w-full"
              >
                {pending === "confirm_availability" ? "Saving…" : "Owner confirmed available"}
              </button>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                Valid for
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={validDays}
                  onChange={(event) => setValidDays(event.target.value)}
                  placeholder={String(props.validDays)}
                  className={`${controlClass} w-20 py-1`}
                />
                days
              </label>
            </div>
          )}

          {props.canChangeAvailability && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  value={availability}
                  onChange={(event) => setAvailability(event.target.value)}
                  aria-label="Availability"
                  className={`${controlClass} min-w-0 flex-1`}
                >
                  {AVAILABILITY.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={Boolean(pending) || (availability === props.availability && !(availability === "Available" && confirmNow))}
                  onClick={() =>
                    void run("set_availability", { status: availability, confirm: availability === "Available" && confirmNow })
                  }
                >
                  {pending === "set_availability" ? "Saving…" : "Set"}
                </button>
              </div>
              {availability === "Available" && (
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={confirmNow} onChange={(event) => setConfirmNow(event.target.checked)} />
                  The owner confirmed this today
                </label>
              )}
              {availability === "Withdrawn" && props.publication === "Published" && (
                <p className="text-xs text-amber-800">Withdrawing also takes it off the website.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-brand-50 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Verification and publishing</p>
        {button("submit_for_verification", "Submit for verification", "primary")}
        {button("verify", "Mark verified (site and documents checked)", "primary")}
        {can("reject") &&
          (rejecting ? (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                placeholder="Why is it rejected? e.g. owner could not show documents"
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost flex-1 text-red-800"
                  disabled={Boolean(pending) || !reason.trim()}
                  onClick={() => void run("reject", { reason })}
                >
                  {pending === "reject" ? "Saving…" : "Confirm rejection"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-ghost w-full text-red-800" onClick={() => setRejecting(true)}>
              Reject
            </button>
          ))}
        {button("publish", "Publish on website", "primary")}
        {button("unpublish", "Take off website")}
        {props.canSeeDiscreet &&
          button(
            "set_discreet",
            props.discreet ? "Stop discreet matching" : "Allow discreet (staff-only) matching",
            "ghost",
            { enabled: !props.discreet },
          )}
        {button("restore", "Restore from archive", "primary")}
        {props.actions.length === 0 && <p className="text-xs text-ink-muted">Your role cannot change this property’s status.</p>}
      </div>
    </section>
  );
}
