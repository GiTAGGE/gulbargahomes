"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OWNER_LEAD_STATUSES, PRIORITIES, REQUIREMENT_STATUSES } from "@/lib/crm/options";

import { inputClass, labelClass } from "./ui";

async function patch(url: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error || "That did not save.";
}

export function OwnerLeadActions({
  id,
  status,
  priority,
  intent,
  rowVersion,
  canEdit,
  canConvert,
  converted,
}: {
  id: string;
  status: string;
  priority: string;
  intent: string;
  rowVersion: number;
  canEdit: boolean;
  canConvert: boolean;
  converted: boolean;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function save(body: Record<string, unknown>, key: string) {
    setPending(key);
    setError("");
    const problem = await patch(`/api/admin/owner-leads/${id}`, { ...body, rowVersion });
    setPending("");
    if (problem) return setError(problem);
    setReason("");
    router.refresh();
  }

  async function convert(listing?: "Rent" | "Sale") {
    setPending("convert");
    setError("");
    const response = await fetch(`/api/admin/owner-leads/${id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(listing ? { listing } : {}),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; property?: { slug: string } };
    setPending("");
    if (!response.ok || !data.property) return setError(data.error || "Could not create the draft.");
    router.push(`/admin/properties/${data.property.slug}/edit`);
  }

  const closing = ["Not interested", "Unreachable", "Duplicate", "Invalid"].includes(nextStatus);

  return (
    <div className="space-y-4">
      {canConvert && (
        <div className="rounded-xl bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-900">{converted ? "Add another property" : "Ready to list?"}</p>
          <p className="mt-0.5 text-xs text-brand-900/80">
            Creates an internal draft linked to this owner. It is not verified, not published and not used for matching
            until staff verify it.
          </p>
          {confirming ? (
            <div className="mt-2 space-y-2">
              {intent === "Lease" ? (
                <>
                  <p className="text-xs text-brand-900/80">
                    This lead stays a lease. Choose which public listing the draft will be, once it is verified.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary flex-1" disabled={Boolean(pending)} onClick={() => void convert("Rent")}>
                      {pending === "convert" ? "Creating…" : "Draft as rental"}
                    </button>
                    <button type="button" className="btn-primary flex-1" disabled={Boolean(pending)} onClick={() => void convert("Sale")}>
                      Draft as sale
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="btn-primary w-full" disabled={Boolean(pending)} onClick={() => void convert()}>
                  {pending === "convert" ? "Creating…" : "Yes, create draft"}
                </button>
              )}
              <button type="button" className="btn-ghost w-full" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary mt-2 w-full" onClick={() => setConfirming(true)}>
              {converted ? "Create another draft property" : "Convert to draft property"}
            </button>
          )}
        </div>
      )}

      {canEdit && !converted && (
        <div className="space-y-2">
          <label className={labelClass}>
            Status
            <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={inputClass}>
              {OWNER_LEAD_STATUSES.filter((item) => item !== "Converted").map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          {nextStatus !== status && (
            <>
              {closing && (
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Reason (helps campaign quality reports)"
                  className={inputClass}
                />
              )}
              <button
                type="button"
                className="btn-ghost w-full"
                disabled={Boolean(pending)}
                onClick={() => void save({ status: nextStatus, statusReason: reason }, "status")}
              >
                {pending === "status" ? "Saving…" : `Mark ${nextStatus}`}
              </button>
            </>
          )}
        </div>
      )}

      {canEdit && (
        <div>
          <p className={labelClass}>Priority</p>
          <div className="mt-1 flex gap-1.5">
            {PRIORITIES.map((item) => (
              <button
                key={item}
                type="button"
                disabled={Boolean(pending) || item === priority}
                onClick={() => void save({ priority: item }, "priority")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  item === priority ? "bg-brand-700 text-white" : "bg-white text-ink ring-1 ring-brand-100 hover:bg-brand-50"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
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

export function RequirementActions({
  id,
  status,
  priorityOverride,
  rowVersion,
}: {
  id: string;
  status: string;
  priorityOverride: string;
  rowVersion: number;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function save(body: Record<string, unknown>, key: string) {
    setPending(key);
    setError("");
    const problem = await patch(`/api/admin/requirements/${id}`, { ...body, rowVersion });
    setPending("");
    if (problem) return setError(problem);
    setReason("");
    setOutcome("");
    router.refresh();
  }

  const needsOutcome = nextStatus === "Converted" || nextStatus === "Lost";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className={labelClass}>
          Stage
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={inputClass}>
            {REQUIREMENT_STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        {nextStatus !== status && (
          <>
            {needsOutcome && (
              <input
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                placeholder={nextStatus === "Converted" ? "Deal: property code, rent/price, date" : "Why it was lost"}
                className={inputClass}
              />
            )}
            {!needsOutcome && (
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Note (optional)"
                className={inputClass}
              />
            )}
            <button
              type="button"
              className="btn-ghost w-full"
              disabled={Boolean(pending) || (needsOutcome && !outcome.trim())}
              onClick={() => void save({ status: nextStatus, statusReason: reason, outcome }, "status")}
            >
              {pending === "status" ? "Saving…" : `Move to ${nextStatus}`}
            </button>
          </>
        )}
      </div>
      <div>
        <p className={labelClass}>Priority</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {[
            ["", "Automatic"],
            ["High", "High"],
            ["Medium", "Medium"],
            ["Low", "Low"],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              disabled={Boolean(pending) || value === priorityOverride}
              onClick={() => void save({ priorityOverride: value }, "priority")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                value === priorityOverride ? "bg-brand-700 text-white" : "bg-white text-ink ring-1 ring-brand-100 hover:bg-brand-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
